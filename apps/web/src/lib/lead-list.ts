import 'server-only';

import type { LeadListItem } from '@sihl-one/contracts';

import { apiFetch, toQuery } from './api';

type RawParams = Record<string, string | string[] | undefined>;

/** The leads list envelope, as the API returns it. */
export interface LeadListPage {
  items: LeadListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Filters that may repeat — `status=NEW&status=CONTACTED`. */
const MULTI_VALUE = ['status', 'source', 'productInterest'] as const;

/**
 * Every other filter the leads list understands, one value each.
 *
 * This list is load-bearing in two directions. The list page builds its own
 * query from it, and the lead detail page rebuilds the *same* query from it to
 * work out which lead comes next. A filter added to one and not the other
 * widens the list silently on whichever side was forgotten — the reader walks
 * Next through leads that were never on their screen — so both read this.
 */
const SINGLE_VALUE = [
  'q',
  'priority',
  'ownerId',
  // The unowned pile. Not an id, so it needs its own parameter.
  'owned',
  'eventId',
  'attendedEventId',
  'capturedById',
  'captured',
  'returningAtEventId',
  'mobileVerified',
  'campaignId',
  'partnerId',
  'overdueOnly',
  'contact',
  'minScore',
] as const;

export const LEAD_LIST_PAGE_SIZE = 20;

/** The API query for a set of list filters, with the list's own defaults. */
export function leadListQuery(params: RawParams): string {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const built: Record<string, string | string[] | undefined> = {};
  for (const key of SINGLE_VALUE) built[key] = first(key);
  // Passed through as-is: `toQuery` appends an array and sets a single value,
  // so one status and five both come out right.
  for (const key of MULTI_VALUE) built[key] = params[key];
  built.sortBy = first('sortBy') ?? 'createdAt';
  built.sortDir = first('sortDir') ?? 'desc';
  built.page = first('page') ?? '1';
  built.pageSize = String(LEAD_LIST_PAGE_SIZE);

  return toQuery(built);
}

/**
 * The same query, rebuilt from a string that came in off the address bar.
 *
 * The lead page receives the list it was opened from as `?list=…`, and that
 * value is about to be concatenated onto an API path. Parsing it and rebuilding
 * it through the allowlist above is what stops a crafted `list` from addressing
 * a different endpoint — and reusing the list's own builder is what stops the
 * two screens disagreeing about what the filter was.
 *
 * Anything unrecognised is dropped rather than refused: a stale link from
 * before a filter was renamed should still walk the list, just more widely than
 * it did, and the position shown alongside says so honestly.
 */
export function sanitiseLeadListQuery(raw: string): string {
  const parsed = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const params: RawParams = {};
  for (const key of new Set(parsed.keys())) params[key] = parsed.getAll(key);
  return leadListQuery(params);
}

function withPage(query: string, page: number): string {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  params.set('page', String(page));
  return `?${params.toString()}`;
}

export interface LeadCursor {
  /** 1-based position of this lead within the filtered list. */
  position: number;
  total: number;
  /** The list this position was read from, canonical and safe to hand on. */
  listQuery: string;
  next: { id: string; fullName: string; listQuery: string } | null;
}

/**
 * Where this lead sits in the list it was opened from, and which one follows.
 *
 * Resolved against the list query rather than against the lead, because "next"
 * is a property of the list: the same lead has a different neighbour under a
 * different filter or a different sort. Re-running the query is what makes the
 * filter count — including a filter the reader set after the page they are on,
 * which no stored snapshot of row ids would know about.
 *
 * Null whenever the answer cannot be trusted: no list, the list unreachable, or
 * this lead no longer in it because somebody changed a status while it was
 * open. A Next that quietly skipped to the wrong record would be worse than no
 * Next at all, so the control simply does not appear.
 */
export async function resolveLeadCursor(leadId: string, raw: string): Promise<LeadCursor | null> {
  const listQuery = sanitiseLeadListQuery(raw);

  const page = await apiFetch<LeadListPage>(`/leads${listQuery}`).catch(() => null);
  if (!page) return null;

  const index = page.items.findIndex((item) => item.id === leadId);
  if (index === -1) return null;

  const position = (page.page - 1) * page.pageSize + index + 1;
  const onThisPage = page.items[index + 1];
  if (onThisPage) {
    return {
      position,
      total: page.total,
      listQuery,
      next: { id: onThisPage.id, fullName: onThisPage.fullName, listQuery },
    };
  }

  // Last row of the page. The next lead is the first of the page after, and the
  // link carries that page forward so the one after it resolves from there
  // rather than fetching backwards from a page it is no longer on.
  if (page.page >= page.totalPages) {
    return { position, total: page.total, listQuery, next: null };
  }

  const nextQuery = withPage(listQuery, page.page + 1);
  const nextPage = await apiFetch<LeadListPage>(`/leads${nextQuery}`).catch(() => null);
  const first = nextPage?.items[0];
  if (!first) return { position, total: page.total, listQuery, next: null };

  return {
    position,
    total: page.total,
    listQuery,
    next: { id: first.id, fullName: first.fullName, listQuery: nextQuery },
  };
}

/** The address of a lead, carrying the list it is being read from. */
export function leadHref(leadId: string, listQuery: string | null): string {
  return listQuery ? `/leads/${leadId}?list=${encodeURIComponent(listQuery)}` : `/leads/${leadId}`;
}
