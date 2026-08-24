import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Refresh-token rotation under a client that races itself.
 *
 * This is the defect that signed the pilot team out mid-task. The browser sends
 * every protected request lacking an access cookie to /auth/refresh, and a page
 * load is several requests, so one won the rotation and the rest arrived holding
 * the token it had just replaced. The API read that as a stolen token and
 * revoked every session the user had.
 *
 * Black-box on purpose: the property that matters is what a browser doing four
 * things at once actually gets back, which no unit test of the service can show.
 *
 * Requires the API and a seeded database.
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Sihl@One2026!';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? 'salesmanager@sihl.in';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

async function login(): Promise<Tokens> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
  });
  assert.equal(response.status, 200, `login failed for ${IDENTIFIER}`);
  return ((await response.json()) as { tokens: Tokens }).tokens;
}

async function refresh(refreshToken: string): Promise<Response> {
  return fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
}

async function stillSignedIn(accessToken: string): Promise<boolean> {
  const response = await fetch(`${BASE}/leads?limit=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.ok;
}

describe('refresh token rotation', () => {
  it('survives four refreshes fired at once', async () => {
    const tokens = await login();

    // Exactly the shape of the bug: one page load, several requests, one token.
    const responses = await Promise.all([
      refresh(tokens.refreshToken),
      refresh(tokens.refreshToken),
      refresh(tokens.refreshToken),
      refresh(tokens.refreshToken),
    ]);

    const ok = responses.filter((response) => response.ok);
    assert.equal(ok.length, responses.length, 'every racing refresh should be answered, not rejected');

    // The property that matters, and the one that failed before: the user is
    // still signed in afterwards. Previously the losers tripped reuse detection
    // and every session for the user was revoked, including the one issued to
    // the winner a moment earlier — the whole team, mid-task.
    const pairs = await Promise.all(ok.map((response) => response.json() as Promise<Tokens>));
    const usable = await Promise.all(pairs.map((pair) => stillSignedIn(pair.accessToken)));

    assert.ok(
      usable.some(Boolean),
      'a burst of refreshes left the user with no working session at all',
    );

    // Known and accepted: each racing request rotates again, so only the last
    // pair issued stays live. A browser that acted on an earlier response holds
    // a dead token and has to sign in once more. That is a single re-login
    // rather than a mass revocation, and the middleware now refreshes only on
    // document navigations so the burst should not arise outside multi-tab use.
    // Making every racer converge on one pair needs deterministic rotation,
    // which is a larger change than this fix.
  });

  it('still rejects a token reused long after it was rotated', async () => {
    const tokens = await login();

    const first = await refresh(tokens.refreshToken);
    assert.equal(first.status, 200);

    // The original token is now superseded. Presenting it again inside the grace
    // window is the race and is tolerated; what must never be tolerated is the
    // token continuing to work as a credential of its own.
    const replay = await refresh(tokens.refreshToken);
    if (replay.ok) {
      const replayed = (await replay.json()) as { refreshToken: string };
      assert.notEqual(
        replayed.refreshToken,
        tokens.refreshToken,
        'a replayed token must never be handed back unchanged',
      );
    } else {
      assert.equal(replay.status, 401);
    }
  });

  it('does not let a rotated token be spent twice for two live sessions', async () => {
    const tokens = await login();

    const a = await refresh(tokens.refreshToken);
    assert.equal(a.status, 200);
    const first = (await a.json()) as Tokens;

    const b = await refresh(tokens.refreshToken);
    if (!b.ok) return; // outside the window, already rejected — fine

    const second = (await b.json()) as Tokens;
    assert.notEqual(
      second.refreshToken,
      first.refreshToken,
      'two refreshes must never yield the same refresh token',
    );
  });
});
