import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ALLOWED_UPLOAD_TYPES,
  isAllowedUploadType,
  maxBytesFor,
  sanitiseFileName,
  type UploadedFile,
} from '@sihl-one/contracts';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import {
  FILE_SCANNER,
  STORAGE_DRIVER,
  type FileScanner,
  type StorageDriver,
} from './storage.types';

/**
 * Magic-number prefixes.
 *
 * The declared Content-Type is attacker-controlled, so it is checked against
 * what the bytes actually start with. Without this, `evil.html` announced as
 * `image/jpeg` sails through the allow-list and is later served back — and a
 * stored HTML file served from our own origin is stored XSS.
 */
const MAGIC_NUMBERS: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // RIFF....WEBP — the middle four bytes are the file size, so they are skipped.
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  // EBML header, shared by WebM audio and video.
  'audio/webm': [[0x1a, 0x45, 0xdf, 0xa3]],
  'audio/mpeg': [
    [0x49, 0x44, 0x33], // ID3
    [0xff, 0xfb],
    [0xff, 0xf3],
    [0xff, 0xf2],
  ],
  // ....ftyp — the box size precedes the type, so the check starts at offset 4.
  'audio/mp4': [[0x66, 0x74, 0x79, 0x70]],
};

const MAGIC_OFFSETS: Record<string, number> = { 'audio/mp4': 4 };

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(STORAGE_DRIVER) private readonly driver: StorageDriver,
    @Inject(FILE_SCANNER) private readonly scanner: FileScanner,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Validates, scans and stores an upload.
   *
   * Order matters: cheap checks first (type, size), then content sniffing, then
   * the scan, then the write. A file that fails any check is never persisted,
   * so a rejected upload leaves nothing behind to clean up.
   */
  async upload(input: {
    fileName: string;
    contentType: string;
    body: Buffer;
    prefix: string;
  }): Promise<UploadedFile> {
    const contentType = input.contentType.split(';')[0]?.trim().toLowerCase() ?? '';

    if (!isAllowedUploadType(contentType)) {
      throw new BadRequestException({
        title: 'Unsupported file type',
        detail: `${contentType || 'That file type'} cannot be uploaded. Allowed: ${Object.keys(ALLOWED_UPLOAD_TYPES).join(', ')}.`,
      });
    }

    const limit = maxBytesFor(contentType);
    if (input.body.byteLength === 0) {
      throw new BadRequestException({ title: 'Empty file', detail: 'The file contains no data.' });
    }
    if (input.body.byteLength > limit) {
      throw new BadRequestException({
        title: 'File is too large',
        detail: `The maximum size for this file type is ${Math.round(limit / (1024 * 1024))} MB.`,
      });
    }

    if (!this.matchesMagicNumber(contentType, input.body)) {
      throw new BadRequestException({
        title: 'File content does not match its type',
        detail:
          'The file contents do not look like the declared file type. Re-export the file and try again.',
      });
    }

    const scan = await this.scanner.scan({ key: input.prefix, body: input.body, contentType });
    if (scan.status === 'INFECTED') {
      this.logger.warn(
        `Rejected an infected upload (${scan.detail ?? 'no detail'}) under prefix ${input.prefix}`,
      );
      throw new BadRequestException({
        title: 'File rejected',
        detail: 'This file was identified as malicious and has not been stored.',
      });
    }

    const fileName = sanitiseFileName(input.fileName);
    const extension = ALLOWED_UPLOAD_TYPES[contentType]?.extension ?? 'bin';
    // The stored key never contains the user's filename: it is opaque and
    // generated, so nothing about the object path is attacker-influenced. The
    // original name is metadata, returned for display only.
    const key = `${input.prefix}/${new Date().getFullYear()}/${randomUUID()}.${extension}`;

    const stored = await this.driver.put({ key, body: input.body, contentType });

    return {
      storageKey: stored.key,
      fileName,
      contentType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      scanStatus: scan.status,
    };
  }

  async read(key: string): Promise<Buffer> {
    return this.driver.get(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }

  async remove(key: string): Promise<void> {
    await this.driver.delete(key);
  }

  /**
   * Signs a short-lived download grant.
   *
   * The signature covers the key, the user allowed to use it and the expiry, so
   * a link cannot be edited to point at another object, cannot be forwarded to
   * a colleague who lacks access, and stops working on its own. This is what
   * lets file URLs be handed to a browser at all — the alternative is streaming
   * every document through an authenticated endpoint, which does not survive
   * an `<img>` tag.
   */
  signDownload(key: string, userId: string, ttlSeconds = 300): { token: string; expiresAt: Date } {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const expiry = Math.floor(expiresAt.getTime() / 1000);
    const signature = this.sign(key, userId, expiry);
    return { token: `${expiry}.${signature}`, expiresAt };
  }

  verifyDownload(key: string, userId: string, token: string): boolean {
    const [expiryPart, signature] = token.split('.');
    if (!expiryPart || !signature) return false;

    const expiry = Number(expiryPart);
    if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return false;

    const expected = this.sign(key, userId, expiry);
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    // Constant-time compare: a naive === leaks the signature one byte at a time
    // to anyone willing to measure.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sign(key: string, userId: string, expiry: number): string {
    return createHmac('sha256', this.config.auth.accessSecret)
      .update(`${key}|${userId}|${expiry}`)
      .digest('hex');
  }

  private matchesMagicNumber(contentType: string, body: Buffer): boolean {
    const signatures = MAGIC_NUMBERS[contentType];
    if (!signatures) return false;

    const offset = MAGIC_OFFSETS[contentType] ?? 0;
    return signatures.some((signature) =>
      signature.every((byte, index) => body[offset + index] === byte),
    );
  }
}
