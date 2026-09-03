import 'server-only';

import { redirect } from 'next/navigation';
import type { ProblemDetails } from '@sihl-one/contracts';

import { forwardedHeaders } from './forwarded';
import { getAccessToken } from './session';

const BASE_URL =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Every API error carried through the app as one type, so a caller can catch
 * `ApiError` and read `problem.errors` for field-level messages instead of
 * parsing strings.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  /** Field → messages, for attaching errors to form inputs. */
  get fieldErrors(): Record<string, string[]> {
    return this.problem.errors ?? {};
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the automatic redirect-to-login on 401 (used by the login page itself). */
  allowUnauthenticated?: boolean;
}

/**
 * Server-side API client.
 *
 * Calls originate from the Next server, not the browser, which means the access
 * token never has to be exposed to client JavaScript and the API only ever
 * needs to trust one origin.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, allowUnauthenticated, headers, ...rest } = options;
  const token = await getAccessToken();

  const response = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Before `...headers`, so an explicit caller can still override, but after
      // the token, so nothing routine drops the audit attribution.
      ...(await forwardedHeaders()),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // CRM data is per-user and changes constantly; a cached lead list showing
    // another RM's leads would be both wrong and a data-protection incident.
    cache: 'no-store',
  });

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    const problem = await parseProblem(response);

    if (response.status === 401 && !allowUnauthenticated) {
      // The refresh token is deliberately not used here. Rotating a token
      // inside a server render that may be one of several in flight races with
      // itself and can revoke the session. Sending the user through /login is
      // slower but always correct.
      redirect('/login?reason=expired');
    }

    throw new ApiError(response.status, problem);
  }

  return (await response.json()) as T;
}

async function parseProblem(response: Response): Promise<ProblemDetails> {
  try {
    const data = (await response.json()) as ProblemDetails;
    if (data && typeof data === 'object' && 'title' in data) return data;
  } catch {
    // Fall through — a non-JSON error body means the request never reached the
    // application (gateway timeout, proxy error), which is worth saying plainly.
  }
  return {
    type: 'about:blank',
    title: response.status >= 500 ? 'Service unavailable' : 'Request failed',
    status: response.status,
    detail:
      response.status >= 500
        ? 'The SIHL ONE service is not responding. Try again in a moment.'
        : response.statusText,
  };
}

/** Builds a query string, dropping empty values so the URL stays readable. */
export function toQuery(params: Record<string, string | number | boolean | undefined | null | string[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item) search.append(key, item);
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
