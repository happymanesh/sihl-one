import { z } from 'zod';

/** CUID2-ish / UUID tolerant id. Prisma emits cuid() values in Phase 1. */
export const idSchema = z.string().min(8).max(64);

/**
 * Indian mobile number, stored E.164-normalised without the country code.
 * SEBI-regulated onboarding means we will eventually reconcile these against
 * KRA records, so normalisation happens at the edge, once.
 */
export const indianMobileSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, '').replace(/^(\+91|91|0)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

/** PAN — the primary identity key for every SEBI-regulated account in India. */
export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid 10-character PAN');

export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().max(40).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * RFC 9457 Problem Details. Every non-2xx response from the API uses this
 * shape, so the web client has exactly one error contract to handle.
 */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  traceId: z.string().optional(),
  errors: z.record(z.array(z.string())).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/** UTM attribution captured on any inbound lead-generating surface. */
export const attributionSchema = z.object({
  utmSource: z.string().max(120).optional(),
  utmMedium: z.string().max(120).optional(),
  utmCampaign: z.string().max(160).optional(),
  utmTerm: z.string().max(160).optional(),
  utmContent: z.string().max(160).optional(),
  referrerUrl: z.string().url().max(500).optional(),
  landingPath: z.string().max(500).optional(),
  gclid: z.string().max(200).optional(),
  fbclid: z.string().max(200).optional(),
});
export type Attribution = z.infer<typeof attributionSchema>;

/**
 * A master code, as it appears on a lead or a rule.
 *
 * Shape only. Whether the code names a row that exists and is active is a
 * database question, so the API checks it — this package cannot, and pretending
 * otherwise with a frozen list is exactly what made these masters necessary.
 */
export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Codes are uppercase letters, numbers and underscores');
