import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';

import { ClamAvFileScanner } from '../../src/modules/storage/clamav.scanner';

/**
 * A stand-in clamd.
 *
 * Speaks the server half of INSTREAM so the client half is exercised for real —
 * the framing, the terminator, the reply parsing — without a 1 GB signature
 * database in CI. It also records what it received, which is the only way to
 * catch a length prefix that is subtly wrong: clamd would simply scan the wrong
 * bytes and still answer OK.
 */
class FakeClamd {
  readonly received: Buffer[] = [];
  private server!: net.Server;

  constructor(private readonly reply: (payload: Buffer) => string | null) {}

  async listen(): Promise<number> {
    this.server = net.createServer((socket) => {
      const frames: Buffer[] = [];
      let buffer = Buffer.alloc(0);
      let sawCommand = false;

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (!sawCommand) {
          const end = buffer.indexOf(0);
          if (end === -1) return;
          assert.equal(buffer.subarray(0, end).toString(), 'zINSTREAM');
          buffer = buffer.subarray(end + 1);
          sawCommand = true;
        }

        // Length-prefixed frames; a zero length ends the stream.
        for (;;) {
          if (buffer.length < 4) return;
          const size = buffer.readUInt32BE(0);

          if (size === 0) {
            const payload = Buffer.concat(frames);
            this.received.push(payload);
            const answer = this.reply(payload);
            if (answer === null) {
              socket.destroy(); // Simulates clamd dying mid-scan.
              return;
            }
            socket.write(answer + '\0');
            socket.end();
            return;
          }

          if (buffer.length < 4 + size) return;
          frames.push(buffer.subarray(4, 4 + size));
          buffer = buffer.subarray(4 + size);
        }
      });
    });

    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return (this.server.address() as net.AddressInfo).port;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

const scanOf = (port: number, body: Buffer) =>
  new ClamAvFileScanner('127.0.0.1', port, 3000).scan({
    key: 'test/file.jpg',
    body,
    contentType: 'image/jpeg',
  });

describe('ClamAV scanner', () => {
  it('reports a clean file as CLEAN', async () => {
    const clamd = new FakeClamd(() => 'stream: OK');
    const port = await clamd.listen();

    const result = await scanOf(port, Buffer.from('an ordinary file'));
    assert.equal(result.status, 'CLEAN');

    await clamd.close();
  });

  it('delivers the file byte-for-byte, across chunk boundaries', async () => {
    // Larger than the 64 KiB chunk size, so the framing loop runs more than
    // once. A length prefix that is off by one would corrupt the payload here
    // while still producing a valid-looking OK.
    const body = Buffer.alloc(200_000);
    for (let i = 0; i < body.length; i += 1) body[i] = i % 251;

    const clamd = new FakeClamd(() => 'stream: OK');
    const port = await clamd.listen();

    await scanOf(port, body);
    assert.equal(clamd.received.length, 1);
    assert.ok(body.equals(clamd.received[0]!), 'clamd received exactly what was uploaded');

    await clamd.close();
  });

  it('reports a detection as INFECTED, naming the signature', async () => {
    const clamd = new FakeClamd(() => 'stream: Eicar-Test-Signature FOUND');
    const port = await clamd.listen();

    const result = await scanOf(port, Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR'));
    assert.equal(result.status, 'INFECTED');
    assert.equal(result.detail, 'Eicar-Test-Signature');

    await clamd.close();
  });

  it('never returns CLEAN when clamd cannot be reached', async () => {
    // Nothing is listening on this port. An outage must not become an allow.
    const result = await scanOf(1, Buffer.from('anything'));
    assert.equal(result.status, 'FAILED');
  });

  it('never returns CLEAN when clamd dies mid-scan', async () => {
    const clamd = new FakeClamd(() => null);
    const port = await clamd.listen();

    const result = await scanOf(port, Buffer.from('anything'));
    assert.notEqual(result.status, 'CLEAN');

    await clamd.close();
  });

  it('treats an oversized-stream error as a failure, not a pass', async () => {
    // Real clamd answers this when StreamMaxLength is below the app's upload
    // ceiling — a misconfiguration that would otherwise pass files through.
    const clamd = new FakeClamd(() => 'INSTREAM size limit exceeded. ERROR');
    const port = await clamd.listen();

    const result = await scanOf(port, Buffer.from('a large file'));
    assert.equal(result.status, 'FAILED');
    assert.match(result.detail ?? '', /size limit/);

    await clamd.close();
  });

  it('treats an unrecognised reply as a failure', async () => {
    const clamd = new FakeClamd(() => 'something nobody expected');
    const port = await clamd.listen();

    const result = await scanOf(port, Buffer.from('file'));
    assert.equal(result.status, 'FAILED');

    await clamd.close();
  });

  it('does not mistake a signature named "...OK" for a pass', async () => {
    const clamd = new FakeClamd(() => 'stream: Win.Trojan.NotOK FOUND');
    const port = await clamd.listen();

    const result = await scanOf(port, Buffer.from('file'));
    assert.equal(result.status, 'INFECTED');

    await clamd.close();
  });
});

describe('ClamAV scanner timeout', () => {
  let silent: net.Server;
  let port = 0;

  // Held so they can be destroyed at the end. `server.close()` stops accepting
  // new connections but waits for open ones to end, and this server never ends
  // any — so without this the test file hangs rather than finishing.
  const accepted: net.Socket[] = [];

  before(async () => {
    // Accepts the connection and then says nothing, which is what clamd looks
    // like while it is still loading its signature database.
    silent = net.createServer((socket) => accepted.push(socket));
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    port = (silent.address() as net.AddressInfo).port;
  });

  after(async () => {
    for (const socket of accepted) socket.destroy();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  });

  it('gives up rather than hanging the request, and fails closed', async () => {
    const scanner = new ClamAvFileScanner('127.0.0.1', port, 1000);
    const started = Date.now();

    const result = await scanner.scan({
      key: 'test/file.jpg',
      body: Buffer.from('file'),
      contentType: 'image/jpeg',
    });

    assert.equal(result.status, 'FAILED');
    assert.ok(Date.now() - started < 5000, 'returned promptly rather than hanging');
  });
});
