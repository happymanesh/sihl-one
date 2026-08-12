import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import type { StorageDriver, StoredObject } from './storage.types';

/**
 * Filesystem-backed storage for development and CI.
 *
 * Production uses the S3 driver; this exists because the object store is not
 * always available locally (no Docker on some developer machines), and stubbing
 * uploads out entirely would leave the whole visit and document flow untested
 * until deployment.
 *
 * It implements the same interface as the S3 driver, so nothing above it knows
 * which is in use — including the tests.
 */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly logger = new Logger(LocalStorageDriver.name);

  constructor(private readonly root: string) {}

  async put(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    const target = this.resolve(input.key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.body);

    return {
      key: input.key,
      sizeBytes: input.body.byteLength,
      checksum: createHash('sha256').update(input.body).digest('hex'),
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (error) {
      // A missing object is the desired end state, so deleting twice is not an
      // error worth propagating to a caller.
      this.logger.debug(`delete(${key}) — nothing to remove: ${String(error)}`);
    }
  }

  /**
   * Resolves a key inside the storage root and refuses to escape it.
   *
   * Keys are generated server-side, so traversal should be impossible — but
   * this is the function that turns a string into a filesystem path, and a
   * future caller passing a user-supplied key must not be able to write to
   * `../../etc`. The check is cheap; the failure is catastrophic.
   */
  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    const root = path.resolve(this.root);

    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Refusing to access a storage key outside the root: ${key}`);
    }
    return target;
  }
}
