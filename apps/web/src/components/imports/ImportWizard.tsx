'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IMPORTABLE_FIELDS,
  IMPORT_SOURCE_ORIGINS,
  type ImportRowPreview,
  type ImportableField,
} from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { ImportGuidance } from './ImportGuidance';
import { humanise } from '@/lib/format';

type Step = 'declare' | 'map' | 'review' | 'done';

interface ParseResult {
  batchId: string;
  reference: string;
  fileName: string;
  totalRows: number;
  headers: string[];
  suggestedMapping: Array<ImportableField | null>;
  sampleRows: string[][];
}

interface ValidateResult {
  totals: { total: number; valid: number; invalid: number; duplicate: number };
  rows: ImportRowPreview[];
}

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'declare', label: 'Source' },
  { id: 'map', label: 'Columns' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

/**
 * Four-step import.
 *
 * The order is deliberate and matches the API: nothing is created until the
 * user has seen exactly what will happen. A new joiner's 500-row spreadsheet
 * will contain mis-keyed mobiles and people SIHL already knows, and showing
 * them that *before* committing is the difference between a usable tool and one
 * that quietly pollutes the book.
 */
export function ImportWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('declare');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<Array<ImportableField | null>>([]);
  const [validated, setValidated] = useState<ValidateResult | null>(null);
  const [skipOverrides, setSkipOverrides] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  async function submitDeclaration(formData: FormData) {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError('Choose a CSV file to import.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        step: 'parse',
        origin: String(formData.get('origin') ?? ''),
        suppliedBy: String(formData.get('suppliedBy') ?? ''),
        description: String(formData.get('description') ?? ''),
        lawfulBasisConfirmed: formData.get('lawfulBasisConfirmed') === 'on' ? 'true' : 'false',
      });

      const body = new FormData();
      body.append('file', file);

      const response = await fetch(`/api/import?${params}`, { method: 'POST', body });
      const data = (await response.json()) as ParseResult & {
        title?: string;
        detail?: string;
        errors?: Record<string, string[]>;
      };

      if (!response.ok) {
        const fieldError = data.errors ? Object.values(data.errors)[0]?.[0] : undefined;
        setError(fieldError ?? data.detail ?? data.title ?? 'The file could not be read.');
        return;
      }

      setParsed(data);
      setMapping(data.suggestedMapping);
      setStep('map');
    } catch {
      setError('The file could not be uploaded. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function runValidation() {
    if (!parsed) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/import?step=validate&batchId=${parsed.batchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: mapping, hasHeaderRow: true, source: 'IMPORT' }),
      });
      const data = (await response.json()) as ValidateResult & { title?: string; detail?: string };

      if (!response.ok) {
        setError(data.detail ?? data.title ?? 'The mapping could not be validated.');
        return;
      }

      setValidated(data);
      setStep('review');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!parsed || !validated) return;
    setBusy(true);
    setError(null);

    try {
      // Only overrides are sent; the API applies the suggested decision to
      // everything else. Duplicates default to skip.
      const decisions = validated.rows
        .filter((row) => row.status !== 'INVALID')
        .map((row) => ({
          rowNumber: row.rowNumber,
          decision: skipOverrides.has(row.rowNumber)
            ? ('SKIP' as const)
            : row.status === 'DUPLICATE'
              ? ('SKIP' as const)
              : ('CREATE' as const),
        }));

      const response = await fetch(`/api/import?step=commit&batchId=${parsed.batchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions }),
      });
      const data = (await response.json()) as {
        imported: number;
        skipped: number;
        title?: string;
        detail?: string;
      };

      if (!response.ok) {
        setError(data.detail ?? data.title ?? 'The import could not be completed.');
        return;
      }

      setResult(data);
      setStep('done');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Checked here rather than after validation: letting someone reach the review
  // screen with no mobile column costs a round trip and shows 100% failures.
  const missingRequired = [
    mapping.includes('firstName') ? null : 'Name',
    mapping.includes('mobile') ? null : 'Mobile',
  ].filter((field): field is string => field !== null);

  const willCreate =
    validated?.rows.filter(
      (row) => row.status === 'VALID' && !skipOverrides.has(row.rowNumber),
    ).length ?? 0;

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2" aria-label="Import progress">
        {STEPS.map((entry, index) => {
          const currentIndex = STEPS.findIndex((s) => s.id === step);
          const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
          return (
            <li
              key={entry.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                state === 'current'
                  ? 'border-navy-500 bg-navy-500 text-white'
                  : state === 'done'
                    ? 'border-teal-500/40 text-teal-600 dark:text-teal-300'
                    : 'border-[var(--color-border)] text-[var(--color-text-subtle)]'
              }`}
            >
              <span>{index + 1}</span>
              {entry.label}
            </li>
          );
        })}
      </ol>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2.5 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {error}
        </div>
      ) : null}

      {step === 'declare' ? <ImportGuidance /> : null}

      {step === 'declare' ? (
        <form action={submitDeclaration} className="card space-y-4 p-5">
          <div>
            <h2 className="font-bold">Where did this data come from?</h2>
            {/*
              Not paperwork. SIHL becomes answerable for this personal data the
              moment it is ingested, and a list a new joiner brought from a
              previous employer is the common case. Saying so plainly is more
              honest than burying it in a tooltip.
            */}
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              SIHL becomes responsible for this personal data once it is imported, so we record
              its origin before anything is created. Imported leads can be called, but receive
              no marketing messages until consent is captured on the first call.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="origin">
                Origin <span className="text-danger-500">*</span>
              </label>
              <select id="origin" name="origin" className="input" required defaultValue="">
                <option value="" disabled>
                  Choose one
                </option>
                {IMPORT_SOURCE_ORIGINS.map((origin) => (
                  <option key={origin} value={origin}>
                    {humanise(origin)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="suppliedBy">
                Supplied by <span className="text-danger-500">*</span>
              </label>
              <input
                id="suppliedBy"
                name="suppliedBy"
                className="input"
                required
                placeholder="Name of the person or organisation"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="description">
              How was it obtained? <span className="text-danger-500">*</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={2}
              className="input resize-none"
              required
              minLength={10}
              placeholder="Contacts built up over eight years in the Ahmedabad market"
            />
          </div>

          <div>
            <label className="label" htmlFor="file">
              CSV file <span className="text-danger-500">*</span>
            </label>
            <input
              ref={fileInput}
              id="file"
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              className="input"
              required
            />
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              Working from Excel? Choose File → Save As → CSV first. Up to 5,000 rows.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs">
            <input
              type="checkbox"
              name="lawfulBasisConfirmed"
              required
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-teal-500)]"
            />
            <span>
              I confirm I am entitled to share this data with SIHL, and that it was not taken
              from a previous employer in breach of any agreement.
            </span>
          </label>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Reading file…' : 'Continue'}
          </button>
        </form>
      ) : null}

      {step === 'map' && parsed ? (
        <div className="card space-y-4 p-5">
          <div>
            <h2 className="font-bold">Check the columns</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {parsed.fileName} · {parsed.totalRows} rows. We have guessed these from your
              headers — correct anything that is wrong. Nothing is created yet.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="pb-2 pr-3">Your column</th>
                  <th className="pb-2 pr-3">Example</th>
                  <th className="pb-2">Import as</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {parsed.headers.map((header, index) => (
                  <tr key={`${header}-${index}`}>
                    <td className="py-2 pr-3 font-semibold">{header || <em>(blank)</em>}</td>
                    <td className="max-w-[14rem] truncate py-2 pr-3 text-xs text-[var(--color-text-subtle)]">
                      {parsed.sampleRows[0]?.[index] ?? '—'}
                    </td>
                    <td className="py-2">
                      <select
                        className="input h-9 w-auto"
                        value={mapping[index] ?? ''}
                        onChange={(event) => {
                          const next = [...mapping];
                          next[index] = (event.target.value || null) as ImportableField | null;
                          setMapping(next);
                        }}
                        aria-label={`Import ${header} as`}
                      >
                        <option value="">Ignore this column</option>
                        {IMPORTABLE_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {humanise(field)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {missingRequired.length > 0 ? (
            <p className="rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-600 dark:bg-warn-500/15">
              Map a column to {missingRequired.join(' and ')} before continuing — without{' '}
              {missingRequired.length === 1 ? 'it' : 'them'} every row would be rejected.
            </p>
          ) : null}

          <div className="flex gap-2 border-t border-[var(--color-border)] pt-4">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void runValidation()}
              disabled={busy || missingRequired.length > 0}
            >
              {busy ? 'Checking…' : 'Check the rows'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setStep('declare')}>
              Back
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' && validated ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Total rows', validated.totals.total, 'neutral'],
              ['Will import', willCreate, 'teal'],
              ['Already known', validated.totals.duplicate, 'amber'],
              ['Cannot import', validated.totals.invalid, 'red'],
            ].map(([label, value]) => (
              <div key={label as string} className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {label as string}
                </p>
                <p className="mt-1 text-2xl font-bold tnum">{value as number}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden p-0">
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
                  <tr>
                    <th className="px-3 py-2 text-xs font-bold uppercase">Row</th>
                    <th className="px-3 py-2 text-xs font-bold uppercase">Name</th>
                    <th className="px-3 py-2 text-xs font-bold uppercase">Mobile</th>
                    <th className="px-3 py-2 text-xs font-bold uppercase">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {validated.rows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="px-3 py-2 text-xs text-[var(--color-text-subtle)] tnum">
                        {row.rowNumber}
                      </td>
                      <td className="px-3 py-2">
                        {[row.mapped.firstName, row.mapped.lastName].filter(Boolean).join(' ') ||
                          '—'}
                      </td>
                      <td className="px-3 py-2 tnum">{row.mapped.mobile ?? '—'}</td>
                      <td className="px-3 py-2">
                        {row.status === 'INVALID' ? (
                          <div>
                            <Badge tone="red">Cannot import</Badge>
                            <p className="mt-1 text-xs text-danger-500">{row.errors[0]}</p>
                          </div>
                        ) : row.status === 'DUPLICATE' ? (
                          <div>
                            <Badge tone="amber">Already known</Badge>
                            {/* The incumbent owner is named. This is the whole
                                point of the ownership policy — the importer
                                sees who holds it and can escalate. */}
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                              {row.duplicateOf?.reference}
                              {row.duplicateOf?.ownerName
                                ? ` · owned by ${row.duplicateOf.ownerName}`
                                : ''}
                              {row.duplicateOf?.reasons[0] ? ` · ${row.duplicateOf.reasons[0]}` : ''}
                            </p>
                          </div>
                        ) : skipOverrides.has(row.rowNumber) ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--color-text-muted)] underline"
                            onClick={() => {
                              const next = new Set(skipOverrides);
                              next.delete(row.rowNumber);
                              setSkipOverrides(next);
                            }}
                          >
                            Skipped — import it
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => setSkipOverrides(new Set(skipOverrides).add(row.rowNumber))}
                          >
                            <Badge tone="teal">Will import</Badge>
                            <span className="ml-2 text-xs text-[var(--color-text-subtle)] underline">
                              skip
                            </span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-4 text-xs text-[var(--color-text-muted)]">
            Leads already in SIHL stay with their current owner. Importing them again would move
            a colleague&rsquo;s lead, so they are skipped and the claim is recorded against this
            import.
          </div>

          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void commit()} disabled={busy}>
              {busy ? 'Importing…' : `Import ${willCreate} lead${willCreate === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setStep('map')}>
              Back to columns
            </button>
          </div>
        </div>
      ) : null}

      {step === 'done' && result ? (
        <div className="card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-500 text-white">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="m5 13 4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h2 className="mt-3 text-lg font-bold">Import complete</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {result.imported} lead{result.imported === 1 ? '' : 's'} created
            {result.skipped > 0 ? `, ${result.skipped} skipped` : ''}.
          </p>
          <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
            These leads are marked consent-pending: call them, and record consent on that first
            call before sending any marketing.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <a href="/leads?source=IMPORT" className="btn btn-primary">
              View imported leads
            </a>
            <a href="/leads/import" className="btn btn-outline">
              Import another file
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
