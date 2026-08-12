import { z } from 'zod';

import { ENTITY_TYPES } from './activity';
import { idSchema } from './common';

/**
 * Document and file-upload contracts.
 *
 * The upload is deliberately a two-step flow — upload the bytes, then reference
 * the returned key — rather than a multipart field on every business endpoint.
 * That keeps business endpoints JSON-only and lets one hardened upload path
 * carry all the type, size and scanning checks.
 */

export const DOCUMENT_CATEGORIES = [
  'IDENTITY',
  'ADDRESS_PROOF',
  'BANK_PROOF',
  'INCOME_PROOF',
  'SIGNED_FORM',
  'AGREEMENT',
  'VISIT_PHOTO',
  'VOICE_NOTE',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/**
 * Allow-list, not a block-list.
 *
 * A block-list of dangerous types is always incomplete — the next format nobody
 * thought of is permitted by default. Everything here is something a broker
 * genuinely needs to attach to a client file.
 */
export const ALLOWED_UPLOAD_TYPES: Record<string, { extension: string; maxBytes: number }> = {
  'image/jpeg': { extension: 'jpg', maxBytes: 10 * 1024 * 1024 },
  'image/png': { extension: 'png', maxBytes: 10 * 1024 * 1024 },
  'image/webp': { extension: 'webp', maxBytes: 10 * 1024 * 1024 },
  'application/pdf': { extension: 'pdf', maxBytes: 20 * 1024 * 1024 },
  'audio/webm': { extension: 'webm', maxBytes: 25 * 1024 * 1024 },
  'audio/mpeg': { extension: 'mp3', maxBytes: 25 * 1024 * 1024 },
  'audio/mp4': { extension: 'm4a', maxBytes: 25 * 1024 * 1024 },
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function isAllowedUploadType(contentType: string): boolean {
  return Object.hasOwn(ALLOWED_UPLOAD_TYPES, contentType);
}

export function maxBytesFor(contentType: string): number {
  return ALLOWED_UPLOAD_TYPES[contentType]?.maxBytes ?? 0;
}

/** Code points that must never survive into a stored filename. */
function isDisplaySafe(codePoint: number): boolean {
  // C0 controls and DEL.
  if (codePoint < 0x20 || codePoint === 0x7f) return false;
  // C1 controls.
  if (codePoint >= 0x80 && codePoint <= 0x9f) return false;
  // Bidirectional embedding and override characters.
  if (codePoint >= 0x202a && codePoint <= 0x202e) return false;
  // Bidirectional isolates.
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return false;
  return true;
}

/**
 * Filename sanitiser.
 *
 * The original name is shown to users and used as the download filename, so it
 * must not be able to carry a path traversal, a control character, or a
 * bidirectional override — the classic spoof where a name ending in "exe" is
 * made to render as though it ended in "pdf".
 *
 * Written as a code-point filter rather than a regular expression on purpose:
 * a regex covering these ranges has to embed literal control characters or
 * escapes, and both are easy to corrupt silently when the file is edited or
 * moved between tools.
 */
export function sanitiseFileName(input: string): string {
  const withoutPath = input.replace(/^.*[\\/]/, '');

  const cleaned = [...withoutPath]
    .filter((character) => isDisplaySafe(character.codePointAt(0) ?? 0))
    .join('')
    // Reserved on Windows filesystems.
    .replace(/[<>:"|?*]/g, '_')
    // Leading dots hide the file on Unix and confuse extension detection.
    .replace(/^\.+/, '')
    .trim();

  const safe = cleaned.length > 0 ? cleaned : 'upload';
  return safe.slice(0, 200);
}

export const attachDocumentSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: idSchema,
  storageKey: z.string().min(1).max(300),
  category: z.enum(DOCUMENT_CATEGORIES).default('OTHER'),
});
export type AttachDocumentInput = z.infer<typeof attachDocumentSchema>;

export const documentQuerySchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: idSchema,
});
export type DocumentQuery = z.infer<typeof documentQuerySchema>;

export interface UploadedFile {
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';
}

export interface DocumentListItem {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  category: string | null;
  scanStatus: string;
  downloadable: boolean;
  uploadedAt: string;
}

/** Human-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
