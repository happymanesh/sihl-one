import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ImportWizard } from '@/components/imports/ImportWizard';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDate, humanise } from '@/lib/format';

export const metadata = { title: 'Import leads' };

interface BatchRow {
  id: string;
  reference: string;
  fileName: string;
  status: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  origin: string;
  suppliedBy: string;
  importedByName: string | null;
  createdAt: string;
}

export default async function ImportLeadsPage() {
  const user = await requireUser();
  if (!can(user, 'lead:import')) redirect('/leads');

  const history = await apiFetch<BatchRow[]>('/leads/import').catch(() => [] as BatchRow[]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/leads" className="hover:underline">
          Leads
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span>Import</span>
      </nav>

      <header>
        <h1 className="text-2xl font-bold">Import leads</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          For a new joiner&rsquo;s contact list, an event capture sheet, or any spreadsheet of
          prospects. Nothing is created until you have seen exactly what will happen.
        </p>
      </header>

      <ImportWizard />

      {history.length > 0 ? (
        <section className="card p-5">
          <h2 className="font-bold">Previous imports</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            Kept permanently — a provenance question years from now is one lookup.
          </p>
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {history.map((batch) => (
              <li key={batch.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{batch.fileName}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                    <span className="font-mono">{batch.reference}</span>
                    {' · '}
                    {humanise(batch.origin)} · supplied by {batch.suppliedBy}
                    {batch.importedByName ? ` · imported by ${batch.importedByName}` : ''}
                  </p>
                </div>
                <span className="text-xs text-[var(--color-text-muted)] tnum">
                  {batch.importedRows} of {batch.totalRows} imported
                </span>
                <span className="text-xs text-[var(--color-text-subtle)]">
                  {formatDate(batch.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
