import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';

import { RequestContextMiddleware } from '../../src/common/middleware/request-context.middleware';
import { RequestContextStore } from '../../src/common/request-context';

/**
 * Nearly every request to this API arrives from the Next server rather than a
 * browser, so X-Forwarded-For describes the hop between our own two services.
 * Left to that, `audit_log.ipAddress` held one address for the whole company —
 * a column that reads as evidence of where somebody acted from, recording
 * nothing of the sort. The web tier now states the caller explicitly.
 */
function contextFor(headers: Record<string, string>, socketIp = '10.0.0.9') {
  const middleware = new RequestContextMiddleware();
  const req = {
    headers,
    ip: undefined,
    socket: { remoteAddress: socketIp },
  } as unknown as Request;
  const res = { setHeader() {} } as unknown as Response;

  let captured: ReturnType<typeof RequestContextStore.get>;
  middleware.use(req, res, () => {
    captured = RequestContextStore.get();
  });
  return captured!;
}

describe('client ip attribution', () => {
  it('prefers the ip the web tier states over the hop between services', () => {
    const context = contextFor({
      'x-sihl-client-ip': '49.36.100.7',
      'x-forwarded-for': '10.1.2.3',
    });
    assert.equal(context.ipAddress, '49.36.100.7');
  });

  it('falls back to the leftmost forwarded address when none is stated', () => {
    const context = contextFor({ 'x-forwarded-for': '49.36.100.7, 10.1.2.3' });
    assert.equal(context.ipAddress, '49.36.100.7');
  });

  it('falls back to the socket for a direct connection', () => {
    assert.equal(contextFor({}).ipAddress, '10.0.0.9');
  });

  it('ignores an empty stated header rather than recording a blank', () => {
    const context = contextFor({ 'x-sihl-client-ip': '   ', 'x-forwarded-for': '49.36.100.7' });
    assert.equal(context.ipAddress, '49.36.100.7');
  });

  it('truncates to the width of the audit column', () => {
    const context = contextFor({ 'x-sihl-client-ip': 'f'.repeat(80) });
    assert.equal(context.ipAddress?.length, 45);
  });
});

describe('trace propagation', () => {
  it('honours a trace id supplied by the web tier, so the two logs correlate', () => {
    const context = contextFor({ 'x-request-id': 'trace-from-web-tier' });
    assert.equal(context.traceId, 'trace-from-web-tier');
  });

  it('mints one when the caller supplies none', () => {
    const context = contextFor({});
    assert.match(context.traceId, /^[0-9a-f-]{36}$/);
  });

  it('refuses an over-long trace id rather than carrying it into the logs', () => {
    const context = contextFor({ 'x-request-id': 'x'.repeat(80) });
    assert.notEqual(context.traceId, 'x'.repeat(80));
  });
});
