import { z } from 'zod';

import { codeSchema, idSchema } from './common';

/**
 * Bulk lead import.
 *
 * The pipeline is deliberately four steps — parse, map, validate, commit —
 * rather than one upload endpoint. A salesperson joining with 500 rows will have
 * mis-keyed dates, missing mobiles and duplicates against the existing book, and
 * an all-or-nothing import either rejects the whole file over one bad row or
 * silently ingests rubbish. Both are worse than showing them the problems first.
 */

// ---------------------------------------------------------------------------
// Delimited text parsing
// ---------------------------------------------------------------------------

/**
 * RFC 4180-ish parser for CSV/TSV and pasted text.
 *
 * Hand-written rather than `split(',')` because real files from real people
 * contain quoted fields with embedded commas ("Shah, Asha"), embedded newlines
 * in address columns, doubled quotes as escapes, a UTF-8 BOM from Excel, and
 * CRLF line endings. Every one of those silently corrupts a naive split, and
 * the corruption shows up as a customer record with the wrong phone number.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  // Excel prefixes UTF-8 exports with a byte-order mark, which otherwise
  // becomes part of the first header and breaks column auto-mapping. Compared
  // by code point rather than matched with a literal, because an invisible
  // character in source is one careless re-encode away from disappearing.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = delimiter ?? detectDelimiter(input);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'; // Escaped quote.
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // Swallow; the \n that follows ends the row.
    } else {
      field += char;
    }
  }

  // Trailing field/row with no final newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty — trailing blank lines are universal.
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

/** Picks the delimiter by counting candidates in the header line. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: Array<[string, number]> = [
    [',', (firstLine.match(/,/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
    ['|', (firstLine.match(/\|/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/** Lead fields an import can populate. */
export const IMPORTABLE_FIELDS = [
  'firstName',
  'lastName',
  'mobile',
  'email',
  'pan',
  'city',
  'state',
  'pincode',
  'productInterest',
  'estimatedValue',
  'notes',
] as const;
export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

/**
 * Header aliases for auto-mapping.
 *
 * Drawn from what these files actually look like: exports from other CRMs,
 * spreadsheets maintained by hand, and event-desk captures. Auto-mapping is a
 * suggestion the user confirms — never applied silently, because a wrong guess
 * on `mobile` writes a phone number into `pan`.
 */
const FIELD_ALIASES: Record<ImportableField, string[]> = {
  firstName: ['first name', 'firstname', 'fname', 'given name', 'name', 'full name', 'client name', 'lead name', 'customer name'],
  lastName: ['last name', 'lastname', 'lname', 'surname', 'family name'],
  mobile: ['mobile', 'mobile no', 'mobile number', 'phone', 'phone no', 'phone number', 'contact', 'contact no', 'contact number', 'cell', 'whatsapp'],
  email: ['email', 'email id', 'e-mail', 'email address', 'mail'],
  pan: ['pan', 'pan no', 'pan number', 'pan card'],
  city: ['city', 'town', 'location', 'place'],
  state: ['state', 'province', 'region'],
  pincode: ['pincode', 'pin code', 'pin', 'postal code', 'zip', 'zipcode'],
  productInterest: ['product', 'products', 'interest', 'product interest', 'interested in', 'segment'],
  estimatedValue: ['value', 'estimated value', 'potential', 'aum', 'investment', 'amount', 'ticket size'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments', 'description'],
};

/**
 * Suggests a field for each header. Returns null where nothing is confident
 * enough — a blank the user fills in beats a wrong guess they might not notice.
 */
export function suggestMapping(headers: readonly string[]): Array<ImportableField | null> {
  const used = new Set<ImportableField>();

  return headers.map((header) => {
    const cleaned = header.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    if (!cleaned) return null;

    for (const field of IMPORTABLE_FIELDS) {
      if (used.has(field)) continue;
      if (FIELD_ALIASES[field].includes(cleaned)) {
        used.add(field);
        return field;
      }
    }

    // Substring fallback, longest alias first so "mobile number" beats "number".
    for (const field of IMPORTABLE_FIELDS) {
      if (used.has(field)) continue;
      const aliases = [...FIELD_ALIASES[field]].sort((a, b) => b.length - a.length);
      if (aliases.some((alias) => alias.length >= 4 && cleaned.includes(alias))) {
        used.add(field);
        return field;
      }
    }

    return null;
  });
}

/**
 * Splits a free-text product cell into known products.
 *
 * Import files write these every possible way — "Equity, F&O", "equity/mf",
 * "Derivatives & Commodity". Anything unrecognised is dropped rather than
 * guessed at, and the row still imports.
 */
const PRODUCT_ALIASES: Record<string, string> = {
  equity: 'EQUITY', equities: 'EQUITY', cash: 'EQUITY', stocks: 'EQUITY', shares: 'EQUITY',
  fno: 'DERIVATIVES', 'f&o': 'DERIVATIVES', derivative: 'DERIVATIVES', derivatives: 'DERIVATIVES',
  futures: 'DERIVATIVES', options: 'DERIVATIVES',
  commodity: 'COMMODITY', commodities: 'COMMODITY', mcx: 'COMMODITY',
  currency: 'CURRENCY', forex: 'CURRENCY',
  mf: 'MUTUAL_FUNDS', 'mutual fund': 'MUTUAL_FUNDS', 'mutual funds': 'MUTUAL_FUNDS', sip: 'MUTUAL_FUNDS',
  ipo: 'IPO', ipos: 'IPO',
  pms: 'PMS', aif: 'AIF',
  insurance: 'INSURANCE', bond: 'BONDS', bonds: 'BONDS',
  nri: 'NRI', algo: 'ALGO', algos: 'ALGO',
};

export function parseProductInterest(value: string | undefined): Array<string> {
  if (!value) return [];
  const found = new Set<string>();

  // `&` only splits when it separates words (" Equity & Commodity "). Splitting
  // on a bare `&` destroys "F&O", which is how half of India writes derivatives.
  for (const token of value.split(/[,;/|+]|\s+&\s+|\s+and\s+/i)) {
    const cleaned = token.trim().toLowerCase();
    if (!cleaned) continue;
    const match = PRODUCT_ALIASES[cleaned];
    if (match) found.add(match);
  }

  return [...found];
}

/** Money as typed by humans: "₹12,50,000", "12.5 lakh", "1500000". */
export function parseImportedAmount(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/[₹,\s]/g, '');
  if (!cleaned) return null;

  const lakh = /^([\d.]+)(lakh|lac|l)$/.exec(cleaned);
  if (lakh) return Math.round(Number(lakh[1]) * 100_000);

  const crore = /^([\d.]+)(crore|cr)$/.exec(cleaned);
  if (crore) return Math.round(Number(crore[1]) * 10_000_000);

  const plain = Number(cleaned);
  return Number.isFinite(plain) && plain >= 0 ? Math.round(plain) : null;
}

/**
 * Splits a single "name" column into first and last.
 *
 * Import files very often carry one name column. Everything after the first
 * token becomes the surname, which is right for the overwhelming majority of
 * Indian names and harmless when it is not.
 */
export function splitFullName(value: string): { firstName: string; lastName: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { firstName: '', lastName: null };

  // "Shah, Nirav" — the surname-first convention almost every CRM export uses.
  // Without this the comma survives into the first name and every downstream
  // greeting reads "Dear Shah,".
  const commaIndex = trimmed.indexOf(',');
  if (commaIndex > 0) {
    const surname = trimmed.slice(0, commaIndex).trim();
    const given = trimmed.slice(commaIndex + 1).trim();
    if (surname && given) return { firstName: given, lastName: surname };
  }

  const tokens = trimmed.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: '', lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0]!, lastName: null };
  return { firstName: tokens[0]!, lastName: tokens.slice(1).join(' ') };
}

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

/**
 * Provenance declaration — mandatory, and the reason it is mandatory is legal
 * rather than clerical.
 *
 * A salesperson arriving with a spreadsheet has very likely obtained it from a
 * previous employer. The moment SIHL ingests it, SIHL becomes the Data
 * Fiduciary under the DPDP Act for people who never consented to hear from it.
 * Recording who supplied the data, where it came from and on what basis is what
 * makes the import a documented process rather than an undiscoverable liability.
 */
export const IMPORT_SOURCE_ORIGINS = [
  'PERSONAL_NETWORK',
  'EVENT_OR_EXHIBITION',
  'PURCHASED_LIST',
  'REFERRAL_PARTNER',
  'EXISTING_SIHL_RECORDS',
  'PUBLIC_DIRECTORY',
  'OTHER',
] as const;
export type ImportSourceOrigin = (typeof IMPORT_SOURCE_ORIGINS)[number];

export const importDeclarationSchema = z.object({
  origin: z.enum(IMPORT_SOURCE_ORIGINS),
  suppliedBy: z
    .string()
    .trim()
    .min(2, 'Say who supplied this data')
    .max(160),
  description: z
    .string()
    .trim()
    .min(10, 'Describe how this data was obtained — one line is enough')
    .max(500),
  /** The importer affirms they are entitled to bring this data to SIHL. */
  lawfulBasisConfirmed: z.literal(true, {
    errorMap: () => ({
      message:
        'You must confirm you are entitled to share this data with SIHL before it can be imported',
    }),
  }),
});
export type ImportDeclaration = z.infer<typeof importDeclarationSchema>;

export const importMappingSchema = z.object({
  /** One entry per source column, in order. `null` means "ignore this column". */
  columns: z.array(z.enum(IMPORTABLE_FIELDS).nullable()).min(1).max(100),
  hasHeaderRow: z.boolean().default(true),
  source: codeSchema.default('IMPORT'),
  /** Optional campaign to attribute the whole batch to (event imports). */
  campaignId: idSchema.optional(),
  /** Assign every imported lead to one owner, or leave to the rules engine. */
  ownerId: idSchema.optional(),
});
export type ImportMapping = z.infer<typeof importMappingSchema>;

export const IMPORT_ROW_STATUSES = ['VALID', 'INVALID', 'DUPLICATE', 'IMPORTED', 'SKIPPED'] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const commitImportSchema = z.object({
  /** Row-level overrides; anything absent uses the suggested decision. */
  decisions: z
    .array(
      z.object({
        rowNumber: z.number().int().min(1),
        decision: z.enum(['CREATE', 'SKIP']),
      }),
    )
    .max(10_000)
    .default([]),

  /**
   * Whether the numbers in this file have already been spoken to.
   *
   * Defaults to false, and the default is the important part. A list bought
   * from a vendor or scraped from an event has not been verified by anyone, and
   * marking it otherwise would put an unearned tick against every row and make
   * the unverified rate — which is the only measure of whether reps are
   * actually calling people — meaningless.
   *
   * True is for the case it exists for: a file the team built themselves from
   * calls they made, where ticking each one afterwards is busywork.
   */
  markMobileVerified: z.boolean().default(false),

  /**
   * Who owns everything in this file.
   *
   * Absent means the existing behaviour — each row goes to whoever the
   * assignment rules choose, or to the importer. Supplied, every row goes to
   * that person, which is what a manager loading a territory list wants.
   */
  assignToUserId: idSchema.optional(),
});
export type CommitImportInput = z.infer<typeof commitImportSchema>;

export interface ImportRowPreview {
  rowNumber: number;
  status: ImportRowStatus;
  mapped: Record<string, string | null>;
  errors: string[];
  duplicateOf: {
    id: string;
    reference: string;
    fullName: string;
    ownerName: string | null;
    status: string;
    confidence: string;
    score: number;
    reasons: string[];
  } | null;
  suggestedDecision: 'CREATE' | 'SKIP' | 'REVIEW';
}

export interface ImportBatchSummary {
  id: string;
  reference: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  importedRows: number;
  skippedRows: number;
  declaration: ImportDeclaration | null;
  importedByName: string | null;
  createdAt: string;
  committedAt: string | null;
}
