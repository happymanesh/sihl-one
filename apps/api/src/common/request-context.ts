import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { AuthenticatedPrincipal } from './types';

export interface RequestContext {
  traceId: string;
  ipAddress?: string;
  userAgent?: string;
  user?: AuthenticatedPrincipal;
}

/**
 * Ambient per-request context.
 *
 * Used by the audit service and the logger so that "who did this, on which
 * request" does not have to be threaded through every service signature. It is
 * deliberately read-only to callers other than the middleware and the auth
 * guard — services read it, they never invent it.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run<T>(context: RequestContext, callback: () => T): T {
    return storage.run(context, callback);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  traceId(): string {
    return storage.getStore()?.traceId ?? 'no-trace';
  },

  user(): AuthenticatedPrincipal | undefined {
    return storage.getStore()?.user;
  },

  /** Called by the auth guard once the principal is known. */
  setUser(user: AuthenticatedPrincipal): void {
    const store = storage.getStore();
    if (store) store.user = user;
  },

  newTraceId(): string {
    return randomUUID();
  },
};
