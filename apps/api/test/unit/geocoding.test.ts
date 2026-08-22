import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

import { DisabledGeocoder, MapplsGeocoder } from '../../src/modules/geocoding/geocoders';

/** A stand-in Mappls: issues a token, then answers reverse-geocode calls. */
class FakeMappls {
  readonly reverseCalls: string[] = [];
  private server!: http.Server;
  private tokenIssued = 0;

  constructor(
    private readonly reply: (lat: string, lng: string) => { status: number; body: unknown },
    private readonly tokenStatus = 200,
  ) {}

  async listen(): Promise<string> {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname === '/token') {
        this.tokenIssued += 1;
        res.writeHead(this.tokenStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'tok-' + this.tokenIssued, expires_in: 3600 }));
        return;
      }

      const lat = url.searchParams.get('lat') ?? '';
      const lng = url.searchParams.get('lng') ?? '';
      this.reverseCalls.push(`${lat},${lng}`);

      // A request without the bearer token is a bug worth failing loudly on.
      assert.match(req.headers.authorization ?? '', /^Bearer tok-/);

      const answer = this.reply(lat, lng);
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });

    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as { port: number };
    return `http://127.0.0.1:${port}`;
  }

  get tokenRequests(): number {
    return this.tokenIssued;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

const geocoderFor = (base: string) =>
  new MapplsGeocoder('id', 'secret', `${base}/token`, `${base}/rev`, 2000);

const AHMEDABAD = { latitude: 23.0225, longitude: 72.5714 };

describe('disabled geocoder', () => {
  it('returns no address rather than throwing', async () => {
    assert.equal(await new DisabledGeocoder().reverse(), null);
  });
});

describe('Mappls geocoder', () => {
  it('returns the formatted address', async () => {
    const fake = new FakeMappls(() => ({
      status: 200,
      body: { results: [{ formatted_address: 'Sindhu Bhavan Road, Bodakdev, Ahmedabad' }] },
    }));
    const base = await fake.listen();

    const address = await geocoderFor(base).reverse(AHMEDABAD);
    assert.equal(address, 'Sindhu Bhavan Road, Bodakdev, Ahmedabad');

    await fake.close();
  });

  it('assembles the parts when no formatted address is present', async () => {
    // Their payload has carried the address under different keys across API
    // versions, so the parser falls back rather than returning nothing.
    const fake = new FakeMappls(() => ({
      status: 200,
      body: { results: [{ street: 'Sindhu Bhavan Road', locality: 'Bodakdev', city: 'Ahmedabad' }] },
    }));
    const base = await fake.listen();

    assert.equal(
      await geocoderFor(base).reverse(AHMEDABAD),
      'Sindhu Bhavan Road, Bodakdev, Ahmedabad',
    );

    await fake.close();
  });

  it('reuses the token instead of authenticating per call', async () => {
    const fake = new FakeMappls(() => ({ status: 200, body: { results: [{ address: 'A' }] } }));
    const base = await fake.listen();
    const geocoder = geocoderFor(base);

    await geocoder.reverse({ latitude: 23.1, longitude: 72.1 });
    await geocoder.reverse({ latitude: 24.2, longitude: 73.2 });

    assert.equal(fake.tokenRequests, 1);
    await fake.close();
  });

  it('caches nearby coordinates, because the upstream is metered', async () => {
    const fake = new FakeMappls(() => ({ status: 200, body: { results: [{ address: 'A' }] } }));
    const base = await fake.listen();
    const geocoder = geocoderFor(base);

    // Within about a metre of each other: the same doorway, not a new place.
    await geocoder.reverse({ latitude: 23.02251, longitude: 72.57141 });
    await geocoder.reverse({ latitude: 23.02252, longitude: 72.57142 });

    assert.equal(fake.reverseCalls.length, 1, 'the second lookup was served from cache');
    await fake.close();
  });

  it('returns no address when the provider errors', async () => {
    const fake = new FakeMappls(() => ({ status: 500, body: { error: 'boom' } }));
    const base = await fake.listen();

    assert.equal(await geocoderFor(base).reverse(AHMEDABAD), null);
    await fake.close();
  });

  it('returns no address when nothing was found', async () => {
    const fake = new FakeMappls(() => ({ status: 200, body: { results: [] } }));
    const base = await fake.listen();

    assert.equal(await geocoderFor(base).reverse(AHMEDABAD), null);
    await fake.close();
  });

  it('returns no address when authentication fails', async () => {
    const fake = new FakeMappls(() => ({ status: 200, body: { results: [] } }), 401);
    const base = await fake.listen();

    assert.equal(await geocoderFor(base).reverse(AHMEDABAD), null);
    await fake.close();
  });

  it('returns no address when the host does not exist', async () => {
    // Nothing listening. A rep must never wait on a dead vendor.
    const geocoder = new MapplsGeocoder(
      'id',
      'secret',
      'http://127.0.0.1:1/token',
      'http://127.0.0.1:1/rev',
      1000,
    );
    assert.equal(await geocoder.reverse(AHMEDABAD), null);
  });
});

describe('Mappls geocoder timeout', () => {
  let server: http.Server;
  let base = '';
  const held: import('node:net').Socket[] = [];

  before(async () => {
    // Accepts and never answers, which is what a hung vendor looks like.
    server = http.createServer(() => undefined);
    server.on('connection', (socket) => held.push(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  after(async () => {
    for (const socket of held) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('gives up quickly and yields no address', async () => {
    const geocoder = new MapplsGeocoder('id', 'secret', `${base}/token`, `${base}/rev`, 800);
    const started = Date.now();

    assert.equal(await geocoder.reverse(AHMEDABAD), null);
    assert.ok(Date.now() - started < 4000, 'returned promptly rather than hanging the check-in');
  });
});
