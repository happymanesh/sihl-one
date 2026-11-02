import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS, type Permission } from '@sihl-one/contracts';

import { collectRoutes, type RouteEntry } from './support/route-inventory';

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
 * Everything a route requires, in either form.
 *
 * `PermissionsGuard` enforces `@RequirePermissions` (all of them) and
 * `@RequireAnyPermission` (one of them) alike, so for the question these tests
 * ask — is this route guarded, and by what — the two belong together. Reading
 * only `route.permissions` is how five guarded import routes came to be
 * reported as open.
 */
function requires(route: RouteEntry): string[] {
  return [...route.permissions, ...route.anyPermissions];
}

function unguarded(exempt: ReadonlySet<string>): RouteEntry[] {
  return routes.filter((route) => requires(route).length === 0 && !exempt.has(route.route));
}

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
  /*
    Mobile verification for a capture that has already happened. Public because
    the person holding the phone at the stall has no account and never will.

    Neither takes a mobile number — only the unguessable verification id handed
    back at capture — so they cannot be pointed at a stranger's number or used
    to ask whether one has a code outstanding. Both are throttled at the route,
    and OtpService caps attempts per code and sends per number behind that.
  */
  'POST /leads/capture/resend-code',
  'POST /leads/capture/verify-mobile',
  /*
    The visitor-facing half of event talks, and the same front door as the
    capture routes above: somebody standing at a stall with a QR code and no
    account, who will never have one.

    Neither is a way in. The listing takes the event code the QR carries, not
    an id, and returns only talks that are still bookable — no attendee names,
    no lead data. The booking is authorised by the token issued when that
    visitor's own number was confirmed, so it cannot be pointed at a stranger,
    and every slot is re-checked server-side on arrival. Both are throttled on
    the route at the capture limit, sized for a hall sharing one address.
  */
  'GET /presentations/public/:eventCode',
  'POST /presentations/public/book',
];

/**
 * Authenticated, carrying no permission, because the thing being read is
 * announced to everybody.
 *
 * Distinct from the self-service list below, which rests on the resource being
 * the caller — that argument does not apply here and borrowing it would be
 * dishonest. This rests on a product decision recorded in `rbac.ts`: a
 * training session is announced to the branches expected to attend it, and
 * gating the announcement behind a permission would defeat the point of
 * announcing it. Scheduling, editing and uploading material are all gated by
 * `training:manage`; only reading is open, and only to signed-in staff.
 */
const OPEN_TO_EVERY_USER = [
  'GET /training',
  'GET /training/:id',
  // The material itself, not just the fact of the session. Still staff-only —
  // there is no @Public() here — and the file is served through the storage
  // layer's signed, expiring grant rather than as a bare object URL.
  'GET /training/:id/material/:materialId',
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
    const exempt = new Set([...PUBLIC_ROUTES, ...SELF_SERVICE_ROUTES, ...OPEN_TO_EVERY_USER]);
    const open = unguarded(exempt).map((route) => `${route.route}  (${route.controller})`);

    assert.deepEqual(
      open,
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

  it('the routes reachable with a token but no permission are exactly the two allow-lists', () => {
    assert.deepEqual(
      sorted(unguarded(new Set(PUBLIC_ROUTES)).map((route) => route.route)),
      sorted([...SELF_SERVICE_ROUTES, ...OPEN_TO_EVERY_USER]),
    );
  });

  it('every permission named on a route exists', () => {
    const known = new Set<string>(PERMISSIONS as readonly Permission[]);
    const unknown = routes
      .flatMap((route) => requires(route).map((permission) => ({ route, permission })))
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
      .filter((route) => requires(route).length > 0)
      .filter((route) => requires(route).every((permission) => permission.endsWith(':read')))
      .map((route) => `${route.route}  requires ${requires(route).join(', ')}`);

    assert.deepEqual(
      sorted(offenders),
      sorted(
        WRITES_GUARDED_BY_READ.map((route) => {
          const found = routes.find((candidate) => candidate.route === route);
          return `${route}  requires ${found ? requires(found).join(', ') : ''}`;
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
      .filter((route) => !requires(route).some((permission) => ADMIN_PERMISSIONS.has(permission)))
      .map((route) => `${route.route}  requires ${requires(route).join(', ') || '(nothing)'}`);

    assert.deepEqual(sorted(offenders), []);
  });
});
