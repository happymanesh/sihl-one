'use client';

import { useEffect, useRef, useState } from 'react';
import { formatBytes, type DocumentListItem } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { formatDate, humanise } from '@/lib/format';

const CATEGORIES = [
  'IDENTITY',
  'ADDRESS_PROOF',
  'BANK_PROOF',
  'INCOME_PROOF',
  'SIGNED_FORM',
  'AGREEMENT',
  'OTHER',
] as const;

/**
 * Documents attached to a lead, customer or partner.
 *
 * A client component because uploading is inherently interactive — progress,
 * per-file errors, and an immediate list update. It talks to same-origin route
 * handlers, so the access token stays in its httpOnly cookie.
 */
export function DocumentPanel({
  entityType,
  entityId,
  canUpload,
}: {
  entityType: 'LEAD' | 'CUSTOMER' | 'PARTNER';
  entityId: string;
  canUpload: boolean;
}) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('OTHER');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const response = await fetch(
        `/api/documents?entityType=${entityType}&entityId=${entityId}`,
        { cache: 'no-store' },
      );
      if (response.ok) setDocuments((await response.json()) as DocumentListItem[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const onFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const body = new FormData();
      body.append('file', file);

      const response = await fetch(
        `/api/documents?entityType=${entityType}&entityId=${entityId}&category=${category}`,
        { method: 'POST', body },
      );
      const result = (await response.json()) as DocumentListItem & {
        title?: string;
        detail?: string;
      };

      if (!response.ok) {
        setError(result.detail ?? result.title ?? 'The file could not be uploaded.');
        return;
      }

      await load();
    } catch {
      setError('The file could not be uploaded. Check your connection and try again.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const download = async (id: string) => {
    const response = await fetch(`/api/documents/${id}/download`);
    const result = (await response.json()) as { url?: string; detail?: string; title?: string };

    if (!response.ok || !result.url) {
      setError(result.detail ?? result.title ?? 'This file cannot be downloaded.');
      return;
    }
    window.open(`/api/documents/content?path=${encodeURIComponent(result.url)}`, '_blank');
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">Documents</h2>
        <span className="text-xs text-[var(--color-text-subtle)]">
          {documents.length} attached
        </span>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {error}
        </p>
      ) : null}

      {canUpload ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="input h-9 w-auto"
            aria-label="Document category"
          >
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </select>

          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(event) => void onFileChosen(event)}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="btn btn-outline h-9"
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Attach a file'}
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 space-y-2">
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
        </div>
      ) : documents.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          Nothing attached yet. PDFs and images up to 20 MB.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{document.fileName}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                  {formatBytes(document.sizeBytes)}
                  {document.category ? ` · ${humanise(document.category)}` : ''} ·{' '}
                  {formatDate(document.uploadedAt)}
                </p>
              </div>

              {document.downloadable ? (
                <button
                  type="button"
                  onClick={() => void download(document.id)}
                  className="btn btn-ghost h-8 text-xs"
                >
                  Download
                </button>
              ) : (
                // The reason is shown rather than the button being silently
                // absent — "why can't I open this" is otherwise a support call.
                <Badge
                  tone={document.scanStatus === 'INFECTED' ? 'red' : 'amber'}
                  title={
                    document.scanStatus === 'INFECTED'
                      ? 'This file was identified as malicious.'
                      : 'Not yet confirmed free of malware, so it cannot be downloaded.'
                  }
                >
                  {document.scanStatus === 'INFECTED' ? 'Blocked' : 'Unscanned'}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
