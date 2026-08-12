import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { LocalStorageDriver } from '../../src/modules/storage/local-storage.driver';
import { NoopFileScanner, PermissiveFileScanner } from '../../src/modules/storage/scanners';
import { StorageService } from '../../src/modules/storage/storage.service';
import type { AppConfig } from '../../src/config/configuration';

let root: string;
let driver: LocalStorageDriver;

const config = {
  auth: { accessSecret: 'test-secret-for-signing-download-grants-0123456789' },
} as AppConfig;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sihl-storage-'));
  driver = new LocalStorageDriver(root);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Structurally valid fixtures — the service checks magic numbers, not extensions. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF = Buffer.from('%PDF-1.7\n trailer');
const HTML = Buffer.from('<script>alert(1)</script>');

function service(scanner: NoopFileScanner | PermissiveFileScanner): StorageService {
  return new StorageService(driver, scanner, config);
}

/**
 * Reads the human-readable text out of a rejected upload.
 *
 * NestJS puts a structured payload in `getResponse()` and leaves `message` as
 * the generic "Bad Request Exception", so asserting on `message` would pass for
 * any 400 at all — including one thrown for the wrong reason.
 */
async function rejectionText(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    if (response && typeof response === 'object') {
      const { title, detail } = response as { title?: string; detail?: string };
      return `${title ?? ''} ${detail ?? ''}`.trim();
    }
    return String((error as Error).message ?? error);
  }
  throw new Error('Expected the upload to be rejected, but it succeeded.');
}

describe('local storage driver', () => {
  it('round-trips an object and reports its checksum', async () => {
    const stored = await driver.put({ key: 'a/b/test.bin', body: JPEG, contentType: 'image/jpeg' });
    assert.equal(stored.sizeBytes, JPEG.byteLength);
    assert.match(stored.checksum, /^[a-f0-9]{64}$/);
    assert.deepEqual(await driver.get('a/b/test.bin'), JPEG);
  });

  it('reports existence accurately', async () => {
    assert.equal(await driver.exists('a/b/test.bin'), true);
    assert.equal(await driver.exists('a/b/missing.bin'), false);
  });

  it('treats deleting a missing object as success', async () => {
    await assert.doesNotReject(() => driver.delete('never/existed.bin'));
  });

  it('refuses to escape the storage root', async () => {
    // Keys are generated server-side today, but this is the function that turns
    // a string into a filesystem path — the check must not depend on that.
    await assert.rejects(
      () => driver.put({ key: '../escaped.bin', body: JPEG, contentType: 'image/jpeg' }),
      /outside the root/,
    );
    await assert.rejects(() => driver.get('../../etc/passwd'), /outside the root/);
  });
});

describe('upload validation', () => {
  const storage = () => service(new PermissiveFileScanner());

  it('accepts each allowed type when the bytes match', async () => {
    for (const [contentType, body] of [
      ['image/jpeg', JPEG],
      ['image/png', PNG],
      ['application/pdf', PDF],
    ] as const) {
      const result = await storage().upload({
        fileName: 'file',
        contentType,
        body,
        prefix: 'test',
      });
      assert.equal(result.contentType, contentType);
    }
  });

  it('rejects a type outside the allow-list', async () => {
    const text = await rejectionText(() =>
      storage().upload({
        fileName: 'page.html',
        contentType: 'text/html',
        body: HTML,
        prefix: 'test',
      }),
    );
    assert.match(text, /Unsupported file type/);
  });

  it('rejects content that does not match its declared type', async () => {
    // The declared Content-Type is attacker-controlled. Without the magic-number
    // check, HTML announced as JPEG is stored and can later be served back.
    const text = await rejectionText(() =>
      storage().upload({
        fileName: 'not-really.jpg',
        contentType: 'image/jpeg',
        body: HTML,
        prefix: 'test',
      }),
    );
    assert.match(text, /does not match its type/);
  });

  it('rejects an empty file', async () => {
    const text = await rejectionText(() =>
      storage().upload({
        fileName: 'empty.jpg',
        contentType: 'image/jpeg',
        body: Buffer.alloc(0),
        prefix: 'test',
      }),
    );
    assert.match(text, /Empty file/);
  });

  it('rejects a file over the per-type limit', async () => {
    const oversized = Buffer.concat([JPEG, Buffer.alloc(11 * 1024 * 1024)]);
    const text = await rejectionText(() =>
      storage().upload({
        fileName: 'huge.jpg',
        contentType: 'image/jpeg',
        body: oversized,
        prefix: 'test',
      }),
    );
    assert.match(text, /too large/);
  });

  it('never puts the supplied filename into the storage key', async () => {
    const result = await storage().upload({
      fileName: '../../evil name.jpg',
      contentType: 'image/jpeg',
      body: JPEG,
      prefix: 'test',
    });

    assert.equal(result.storageKey.includes('evil'), false);
    assert.equal(result.storageKey.includes('..'), false);
    assert.match(result.storageKey, /^test\/\d{4}\/[0-9a-f-]{36}\.jpg$/);
    // The original name survives as display metadata, sanitised.
    assert.equal(result.fileName, 'evil name.jpg');
  });

  it('tolerates a charset parameter on the content type', async () => {
    const result = await storage().upload({
      fileName: 'doc.pdf',
      contentType: 'application/pdf; charset=binary',
      body: PDF,
      prefix: 'test',
    });
    assert.equal(result.contentType, 'application/pdf');
  });
});

describe('malware scanning', () => {
  const EICAR = Buffer.from(
    '%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  );

  it('rejects a file the scanner flags as infected', async () => {
    const text = await rejectionText(() =>
      service(new NoopFileScanner()).upload({
        fileName: 'virus.pdf',
        contentType: 'application/pdf',
        body: EICAR,
        prefix: 'test',
      }),
    );
    assert.match(text, /malicious/i);
  });

  it('records FAILED rather than CLEAN when no scanner is configured', async () => {
    // The critical property: an unscanned file must never be recorded as clean,
    // because "clean" is what makes it downloadable.
    const result = await service(new NoopFileScanner()).upload({
      fileName: 'doc.pdf',
      contentType: 'application/pdf',
      body: PDF,
      prefix: 'test',
    });
    assert.equal(result.scanStatus, 'FAILED');
    assert.notEqual(result.scanStatus, 'CLEAN');
  });

  it('marks clean only in explicit permissive mode', async () => {
    const result = await service(new PermissiveFileScanner()).upload({
      fileName: 'doc.pdf',
      contentType: 'application/pdf',
      body: PDF,
      prefix: 'test',
    });
    assert.equal(result.scanStatus, 'CLEAN');
  });
});

describe('signed download grants', () => {
  const storage = () => service(new PermissiveFileScanner());

  it('verifies a grant it issued', () => {
    const s = storage();
    const { token } = s.signDownload('docs/a.pdf', 'user-1');
    assert.equal(s.verifyDownload('docs/a.pdf', 'user-1', token), true);
  });

  it('refuses a grant issued for a different object', () => {
    const s = storage();
    const { token } = s.signDownload('docs/a.pdf', 'user-1');
    assert.equal(s.verifyDownload('docs/b.pdf', 'user-1', token), false);
  });

  it('refuses a grant issued to a different user', () => {
    // A link forwarded to a colleague must not work.
    const s = storage();
    const { token } = s.signDownload('docs/a.pdf', 'user-1');
    assert.equal(s.verifyDownload('docs/a.pdf', 'user-2', token), false);
  });

  it('refuses an expired grant', () => {
    const s = storage();
    const { token } = s.signDownload('docs/a.pdf', 'user-1', -10);
    assert.equal(s.verifyDownload('docs/a.pdf', 'user-1', token), false);
  });

  it('refuses a tampered or malformed grant', () => {
    const s = storage();
    const { token } = s.signDownload('docs/a.pdf', 'user-1');
    const [expiry, signature] = token.split('.');

    assert.equal(s.verifyDownload('docs/a.pdf', 'user-1', `${expiry}.deadbeef`), false);
    assert.equal(s.verifyDownload('docs/a.pdf', 'user-1', signature ?? ''), false);
    assert.equal(s.verifyDownload('docs/a.pdf', 'user-1', ''), false);
    // Extending the expiry without re-signing must not work.
    assert.equal(
      s.verifyDownload('docs/a.pdf', 'user-1', `${Number(expiry) + 99999}.${signature}`),
      false,
    );
  });
});
