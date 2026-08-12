import { Injectable, Logger } from '@nestjs/common';

import type { FileScanner, ScanResult } from './storage.types';

/**
 * Development scanner.
 *
 * Does not scan. It returns FAILED rather than CLEAN, and that choice is the
 * whole point: a no-op that reports CLEAN would silently launder every file
 * through the system and make an unscanned production deployment invisible.
 * FAILED keeps `downloadable` false in the UI and keeps the gap on the record.
 *
 * The one exception is the EICAR test string, which is detected so the
 * infected-file path is exercised by tests rather than only in theory.
 */
@Injectable()
export class NoopFileScanner implements FileScanner {
  readonly name = 'noop';
  private readonly logger = new Logger(NoopFileScanner.name);
  private warned = false;

  private static readonly EICAR =
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

  async scan(input: { key: string; body: Buffer; contentType: string }): Promise<ScanResult> {
    if (!this.warned) {
      this.logger.warn(
        'No malware scanner is configured. Uploads are recorded as unscanned and are not ' +
          'downloadable. Wire ClamAV (or an equivalent) before production — see the ' +
          'production checklist.',
      );
      this.warned = true;
    }

    if (input.body.includes(NoopFileScanner.EICAR)) {
      return { status: 'INFECTED', detail: 'EICAR test signature' };
    }

    return { status: 'FAILED', detail: 'No scanner configured in this environment' };
  }
}

/**
 * Trusts every file. Exists only so CI and local end-to-end runs can exercise
 * the full upload → attach → download path without a scanner container.
 *
 * Selected by `FILE_SCANNER_MODE=permissive`, and the configuration validator
 * refuses that value when NODE_ENV is production.
 */
@Injectable()
export class PermissiveFileScanner implements FileScanner {
  readonly name = 'permissive';
  private readonly logger = new Logger(PermissiveFileScanner.name);
  private warned = false;

  async scan(): Promise<ScanResult> {
    if (!this.warned) {
      this.logger.warn(
        'FILE_SCANNER_MODE=permissive — every upload is marked CLEAN without being scanned. ' +
          'This must never be set outside development or CI.',
      );
      this.warned = true;
    }
    return { status: 'CLEAN', detail: 'Marked clean without scanning (permissive mode)' };
  }
}
