import net from 'node:net';

import { Injectable, Logger } from '@nestjs/common';

import type { FileScanner, ScanResult } from './storage.types';

/**
 * Real malware scanning, against a clamd daemon over TCP.
 *
 * Speaks clamd's INSTREAM protocol directly rather than pulling in a client
 * library. The protocol is four rules long and has not changed in years, and
 * this is the one code path in the system whose whole job is to be suspicious
 * of its input — adding a dependency to it buys a hundred lines and costs a
 * supply-chain surface.
 *
 * The protocol, in full:
 *
 *   1. Send `zINSTREAM\0`. The `z` prefix means commands and replies are
 *      NUL-terminated, which is unambiguous where the newline form is not.
 *   2. Send the file as chunks, each preceded by its length as a 4-byte
 *      big-endian unsigned integer.
 *   3. Send a zero length to mark the end.
 *   4. Read the reply: `stream: OK`, `stream: <signature> FOUND`, or an error.
 *
 * The single most important property of this class: **it never returns CLEAN
 * unless clamd said so.** A refused connection, a timeout, a truncated reply
 * or an oversized file all return FAILED. FAILED keeps the file undownloadable
 * and keeps the gap on the record; CLEAN would launder it. Scanning is the one
 * place where an outage must not degrade into an allow.
 */
@Injectable()
export class ClamAvFileScanner implements FileScanner {
  readonly name = 'clamav';
  private readonly logger = new Logger(ClamAvFileScanner.name);

  /**
   * 64 KiB. Comfortably under clamd's default MaxScanSize, and small enough
   * that a slow link makes progress rather than stalling on one huge write.
   */
  private static readonly CHUNK_BYTES = 64 * 1024;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  async scan(input: { key: string; body: Buffer; contentType: string }): Promise<ScanResult> {
    try {
      const reply = await this.instream(input.body);
      return this.interpret(reply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown scanner error';
      // Logged at error, not warn: uploads silently becoming undownloadable is
      // exactly the sort of thing that goes unnoticed for a month.
      this.logger.error(`clamd scan failed for ${input.key}: ${detail}`);
      return { status: 'FAILED', detail: `Scanner unavailable: ${detail}` };
    }
  }

  /** Parses clamd's reply. Anything unrecognised is a failure, never a pass. */
  private interpret(reply: string): ScanResult {
    const text = reply.replace(/\0+$/, '').trim();

    if (text.endsWith('OK') && !text.includes('FOUND')) {
      return { status: 'CLEAN', detail: 'Scanned by ClamAV' };
    }

    if (text.endsWith('FOUND')) {
      // `stream: Eicar-Signature FOUND` → `Eicar-Signature`
      const signature = text.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '');
      return { status: 'INFECTED', detail: signature || 'Malware detected' };
    }

    // Includes `INSTREAM size limit exceeded. ERROR`, which is a real outcome
    // when clamd's StreamMaxLength is below the app's upload ceiling. Treated
    // as a failure so the mismatch surfaces rather than passing files through.
    return { status: 'FAILED', detail: `Unexpected clamd reply: ${text.slice(0, 120)}` };
  }

  private instream(body: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (error: Error | null, reply?: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(reply ?? '');
      };

      // Covers connect, write and read alike: clamd loads its signature
      // database at startup and refuses connections until it is ready, so a
      // deploy-time restart must time out rather than hang the request thread.
      socket.setTimeout(this.timeoutMs, () =>
        finish(new Error(`No reply from clamd within ${this.timeoutMs} ms`)),
      );

      socket.on('error', (error) => finish(error));
      socket.on('data', (chunk) => chunks.push(chunk));

      // clamd closes the connection after replying, which is the signal that
      // the reply is complete.
      socket.on('close', () => finish(null, Buffer.concat(chunks).toString('utf8')));

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');

        for (let offset = 0; offset < body.length; offset += ClamAvFileScanner.CHUNK_BYTES) {
          const slice = body.subarray(offset, offset + ClamAvFileScanner.CHUNK_BYTES);
          const header = Buffer.allocUnsafe(4);
          header.writeUInt32BE(slice.length, 0);
          socket.write(header);
          socket.write(slice);
        }

        // Zero-length chunk: end of stream.
        socket.write(Buffer.from([0, 0, 0, 0]));
      });
    });
  }

  /**
   * Liveness check used at boot, so a misconfigured host is reported once on
   * startup instead of once per upload for the rest of the deployment.
   */
  async ping(): Promise<boolean> {
    try {
      const reply = await this.instream(Buffer.alloc(0));
      return reply.includes('OK') || reply.includes('FOUND');
    } catch {
      return false;
    }
  }
}
