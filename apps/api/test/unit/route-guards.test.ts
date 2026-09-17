import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS, type Permission } from '@sihl-one/contracts';

import { collectRoutes } from './support/route-inventory';

/**
 * Every route, checked against the access rules it is supposed to obey.
 *
 * The failure this exists to prevent is mundane and common: somebody adds an
 * endpoint, forgets the permission decorator, and it ships reachable by anyone
 * holding a valid token. Nothing else catches that — a unit test covers the
 * service, an e2e test covers routes somebody thought to test, and the new one
 * is by definition the one nobody thought of.
 *
 * So the rule is inverted here. Rather than listing what must be guarded, every
 * route must be guarded *unless* it appears in one of the allow-lists below.
 * Adding a route reachable without a permission then requires editing this
 * file, which is a code review of exactly the decision that matters.
 */

const routes = collectRoutes('src');

/**
 * Reachable with no token at all.
 *
 * Each one is a deliberate front door: sign-in, the token refresh that sign-in
 * depends on, the two health probes the platform calls, and the two event
 * capture routes a prospect's phone hits after scanning a QR code at a venue.
 */
const PUBLIC_ROUTES = [
  'GET /events/capture-context/:kind/:code',
  'GET /live',
  'GET /ready',
  // Self-service password reset. Public of necessity — the whole point is that
  // the caller cannot sign in. Both are throttled harder than login, and
  // /auth/forgot-password answers identically whether or not the account
  // exists, so it cannot be used to test who holds one.
  'POST /auth/forgot-password',
  'POST /auth/login',
  'POST /auth/mfa/challenge',
  'POST /auth/refresh',
  'POST /auth/reset-password',
  'POST /leads/capture',
];

/**
 * Authenticated, but carrying no permission — because the resource *is* the
 * caller. A permission here would be meaningless: there is no version of this
 * product where a user may not read their own notifications or change their own
 * password.
 *
 * The obligation these carry instead is that the service scopes every one of
 * them to the caller's own id, which a static check cannot see. The behavioural
 * matrix in test/e2e/authorisation-matrix.e2e-test.ts asserts that separately,
 * and the two tests are only meaningful together.
 */
const SELF_SERVICE_ROUTES = [
  'GET /auth/me',
  'GET /auth/mfa',
  'GET /notifications',
  'GET /notifications/unread-count',
  'GET /users/me/sessions',
  'POST /auth/change-password',
  'POST /auth/logout',
  'POST /auth/logout-all',
  'POST /auth/mfa/disable',
  'POST /auth/mfa/enable',
  'POST /auth/mfa/setup',
  'POST /notifications/read',
  'POST /notifications/read-all',
];

/**
 * Reachable with a machine credential.
 *
 * Kept to the CEO Command Centre's three read-only dashboard calls. A service
 * key lives unattended in another system's configuration, so the set of doors
 * it opens should be a short list somebody chose.
 */
const SERVICE_ACCOUNT_ROUTES = [
  'GET /dashboard/lead-trend',
  'GET /dashboard/overview',
  'GET /dashboard/top-performers',
];

/**
 * Write routes whose only permission is a read.
 *
 * Listed, not forbidden, because each is arguably right — uploading a document
 * against a customer you may read, setting a target for a team you may see. But
 * a read permission opening a write is the shape of a privilege-escalation bug,
 * so the list is short, explicit, and reviewed when it grows.
 */
const WRITES_GUARDED_BY_READ = ['POST /documents', 'POST /performance/targets'];

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('route guards', () => {
  it('found the controllers', () => {
    // A parser that silently matches nothing would pass every test below.
    assert.ok(routes.length > 120, `expected the full route table, got ${routes.length}`);
    assert.ok(
      routes.some((route) => route.route === 'GET /leads'),
      'GET /leads missing — the parser is not reading controllers correctly',
    );
  });

  it('no route is reachable without either a permission or a deliberate exemption', () => {
    const exempt = new Set([...PUBLIC_ROUTES, ...SELF_SERVICE_ROUTES]);
    const unguarded = routes
      .filter((route) => route.permissions.length === 0 && !exempt.has(route.route))
      .map((route) => `${route.route}  (${route.controller})`);

    assert.deepEqual(
      unguarded,
      [],
      'These routes carry no @RequirePermissions and are not on an allow-list. ' +
        'Add the permission, or — if the route really is public or self-service — ' +
        'add it to the list in this file so the decision is reviewed.',
    );
  });

  it('the set of routes reachable without a token is exactly the allow-list', () => {
    assert.deepEqual(
      sorted(routes.filter((route) => route.public).map((route) => route.route)),
      sorted(PUBLIC_ROUTES),
    );
  });

  it('the set of routes reachable with a service key is exactly the allow-list', () => {
    assert.deepEqual(
      sorted(routes.filter((route) => route.allowsServiceAccount).map((route) => route.route)),
      sorted(SERVICE_ACCOUNT_ROUTES),
    );
  });

  it('the set of self-service routes is exactly the allow-list', () => {
    const exempt = new Set(PUBLIC_ROUTES);
    assert.deepEqual(
      sorted(
        routes
          .filter((route) => route.permissions.length === 0 && !exempt.has(route.route))
          .map((route) => route.route),
      ),
      sorted(SELF_SERVICE_ROUTES),
    );
  });

  it('every permission named on a route exists', () => {
    const known = new Set<string>(PERMISSIONS as readonly Permission[]);
    const unknown = routes
      .flatMap((route) => route.permissions.map((permission) => ({ route, permission })))
      .filter((entry) => !known.has(entry.permission))
      .map((entry) => `${entry.route.route} requires "${entry.permission}"`);

    // A typo'd permission is never granted to anyone, so the route becomes
    // unreachable rather than open — annoying, not dangerous, and invisible
    // until somebody complains that a button does nothing.
    assert.deepEqual(unknown, []);
  });

  it('a write is not guarded only by a read permission', () => {
    const offenders = routes
      .filter((route) => /^(POST|PATCH|PUT|DELETE)/.test(route.route))
      .filter((route) => route.permissions.length > 0)
      .filter((route) => route.permissions.every((permission) => permission.endsWith(':read')))
      .map((route) => `${route.route}  requires ${route.permissions.join(', ')}`);

    assert.deepEqual(
      sorted(offenders),
      sorted(
        WRITES_GUARDED_BY_READ.map((route) => {
          const found = routes.find((candidate) => candidate.route === route);
          return `${route}  requires ${found?.permissions.join(', ')}`;
        }),
      ),
      'A write reachable with only a read permission. Either give it a write ' +
        'permission, or add it to WRITES_GUARDED_BY_READ with a reason.',
    );
  });

  it('administrative surfaces are not writable on an operational permission', () => {
    /*
      Reading these is operational — a sales manager who assigns leads may
      reasonably look at the assignment rules, and does so on `lead:assign`.
      Changing them is administration, and that is the line this asserts: who
      the users are, what the org chart looks like, and how leads are routed
      must not be editable by anyone holding only a sales permission.
    */
    const ADMIN_PERMISSIONS = new Set([
      'system:configure',
      'role:manage',
      'user:create',
      'user:update',
      'user:read',
      'audit:read',
    ]);
    /*
      POSTs that change nothing. Both are dry runs — they are POSTs only
      because they take a body, and treating them as writes would force an
      administrative permission onto a preview a sales manager is meant to run.
    */
    const DRY_RUNS = new Set(['POST /assignment-rules/preview']);

    const offenders = routes
      .filter(
        (route) =>
          / \/admin\b/.test(route.route) ||
          (/^(POST|PATCH|PUT|DELETE)/.test(route.route) &&
            !DRY_RUNS.has(route.route) &&
            / \/(org-units|assignment-rules)\b/.test(route.route)),
      )
      .filter(
        (route) => !route.permissions.some((permission) => ADMIN_PERMISSIONS.has(permission)),
      )
      .map((route) => `${route.route}  requires ${route.permissions.join(', ') || '(nothing)'}`);

    assert.deepEqual(sorted(offenders), []);
  });
});
