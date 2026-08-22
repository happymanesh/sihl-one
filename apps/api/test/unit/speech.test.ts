import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';

import { DisabledTranscriber, SarvamTranscriber } from '../../src/modules/speech/transcribers';

/**
 * Nest's HttpException carries an object payload; its `message` is the generic
 * class name. The text a rep actually sees lives in getResponse(), so that is
 * what these assertions read.
 */
async function refusalText(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const payload = (error as { getResponse?: () => unknown }).getResponse?.() ?? error;
    return JSON.stringify(payload);
  }
  throw new Error('expected a refusal, but the call succeeded');
}

const AUDIO = { audio: Buffer.from('not really audio'), contentType: 'audio/wav', fileName: 'note.wav' };

/** A stand-in Sarvam, so the client half is exercised without spending credits. */
async function fakeSarvam(handler: (req: http.IncomingMessage) => { status: number; body: unknown }) {
  const received: { auth?: string; hasFile: boolean }[] = [];
  const server = http.createServer((req, res) => {
    let size = 0;
    req.on('data', (c) => { size += c.length; });
    req.on('end', () => {
      received.push({
        auth: req.headers['api-subscription-key'] as string | undefined,
        hasFile: size > 0,
      });
      const answer = handler(req);
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });
  // fetch keeps its connections alive, and `server.close()` waits for open ones
  // to end — so without destroying them the test file never finishes.
  const sockets: import('node:net').Socket[] = [];
  server.on('connection', (socket) => sockets.push(socket));

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/stt`,
    received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('disabled transcriber', () => {
  it('refuses rather than returning silence', async () => {
    // Empty text would look identical to "the service ate my note", and a rep
    // who just dictated two minutes deserves to be told it went nowhere.
    assert.match(await refusalText(() => new DisabledTranscriber().transcribe()), /not switched on/i);
  });
});

describe('Sarvam transcriber', () => {
  it('returns the English text and the spoken language', async () => {
    const fake = await fakeSarvam(() => ({
      status: 200,
      body: { transcript: 'The client will send documents on Monday.', language_code: 'hi-IN' },
    }));

    const result = await new SarvamTranscriber('key', 'saaras:v3', fake.url, 5000).transcribe(AUDIO);
    assert.equal(result.text, 'The client will send documents on Monday.');
    assert.equal(result.languageCode, 'hi-IN');

    await fake.close();
  });

  it('sends the key in the provider-specific header, with the audio', async () => {
    const fake = await fakeSarvam(() => ({ status: 200, body: { transcript: 'ok' } }));

    await new SarvamTranscriber('secret-key', 'saaras:v3', fake.url, 5000).transcribe(AUDIO);
    assert.equal(fake.received[0]?.auth, 'secret-key');
    assert.equal(fake.received[0]?.hasFile, true);

    await fake.close();
  });

  it('treats an empty transcript as an ordinary outcome, not a fault', async () => {
    // Somebody tapped the button and said nothing. That is not an error.
    const fake = await fakeSarvam(() => ({ status: 200, body: { transcript: '   ' } }));

    const result = await new SarvamTranscriber('key', 'saaras:v3', fake.url, 5000).transcribe(AUDIO);
    assert.equal(result.text, '');

    await fake.close();
  });

  it('says the credentials were rejected when they were', async () => {
    const fake = await fakeSarvam(() => ({ status: 401, body: { error: 'bad key' } }));

    assert.match(
      await refusalText(() => new SarvamTranscriber('key', 'saaras:v3', fake.url, 5000).transcribe(AUDIO)),
      /administrator/i,
    );

    await fake.close();
  });

  it('tells the rep to type it when the provider errors', async () => {
    const fake = await fakeSarvam(() => ({ status: 500, body: { error: 'boom' } }));

    assert.match(
      await refusalText(() => new SarvamTranscriber('key', 'saaras:v3', fake.url, 5000).transcribe(AUDIO)),
      /try again, or type the note/i,
    );

    await fake.close();
  });

  it('fails clearly when the provider cannot be reached', async () => {
    const transcriber = new SarvamTranscriber('key', 'saaras:v3', 'http://127.0.0.1:1/stt', 1000);
    assert.match(await refusalText(() => transcriber.transcribe(AUDIO)), /could not be reached|type the note/i);
  });
});
