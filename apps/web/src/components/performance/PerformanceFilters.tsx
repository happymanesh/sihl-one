'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  PERFORMANCE_PERIODS,
  PERFORMANCE_SCOPES,
  type PerformancePeriodKind,
  type PerformanceScope,
} from '@sihl-one/contracts';

const SCOPE_LABEL: Record<PerformanceScope, string> = {
  TEAM: 'Team wise',
  REGION: 'Region wise',
  BRANCH: 'Branch wise',
};

const PERIOD_LABEL: Record<PerformancePeriodKind, string> = {
  AS_ON_DATE: 'As on date',
  MONTH: 'Month wise',
  QUARTER: 'Quarter wise',
};

/**
 * What the report covers, chosen in the address bar.
 *
 * The filters push to the URL rather than holding state, so a report can be
 * sent to somebody as a link and arrive showing the same thing — which is what
 * happens to any report a manager finds interesting.
 *
 * Team, Region and Branch are three independent choices, not a drill-down.
 * Only Team narrows further, because only a team is a set of people rather
 * than a place: designation, then one person within it.
 */
export function PerformanceFilters({
  scope,
  period,
  designationId,
  userId,
  orgUnitId,
  designations,
  orgUnits,
  people,
}: {
  scope: PerformanceScope;
  period: PerformancePeriodKind;
  designationId: string;
  userId: string;
  orgUnitId: string;
  designations: Array<{ id: string; name: string }>;
  orgUnits: Array<{ id: string; name: string; type: string }>;
  /** Drawn from the report itself, so the list can only offer people in it. */
  people: Array<{ userId: string; fullName: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const go = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`/performance?${next.toString()}` as Route);
  };

  const units = orgUnits.filter((unit) =>
    scope === 'REGION' ? unit.type === 'REGION' : unit.type === 'BRANCH',
  );

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label" htmlFor="perf-scope">
          View
        </label>
        <select
          id="perf-scope"
          className="input h-9 w-auto text-sm"
          value={scope}
          /* Changing the view clears what the old one had selected: a
             designation means nothing once you are looking at a branch, and
             leaving it in the URL makes the next report silently narrower
             than it says it is. */
          onChange={(event) =>
            go({ scope: event.target.value, designationId: '', userId: '', orgUnitId: '' })
          }
        >
          {PERFORMANCE_SCOPES.map((value) => (
            <option key={value} value={value}>
              {SCOPE_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      {scope === 'TEAM' ? (
        <>
          <div>
            <label className="label" htmlFor="perf-designation">
              Designation
            </label>
            <select
              id="perf-designation"
              className="input h-9 w-auto text-sm"
              value={designationId}
              // Picking a different designation drops the person: they will
              // not be in the new list.
              onChange={(event) => go({ designationId: event.target.value, userId: '' })}
            >
              <option value="">Everyone</option>
              {designations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>

          {/* Only once a designation is chosen, because "a user belonging to
              that designation" is what this list is. */}
          {designationId ? (
            <div>
              <label className="label" htmlFor="perf-user">
                User
              </label>
              <select
                id="perf-user"
                className="input h-9 w-auto text-sm"
                value={userId}
                onChange={(event) => go({ userId: event.target.value })}
              >
                <option value="">All in this designation</option>
                {people.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.fullName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      ) : (
        <div>
          <label className="label" htmlFor="perf-unit">
            {scope === 'REGION' ? 'Region' : 'Branch'}
          </label>
          <select
            id="perf-unit"
            className="input h-9 w-auto text-sm"
            value={orgUnitId}
            onChange={(event) => go({ orgUnitId: event.target.value })}
          >
            <option value="">{scope === 'REGION' ? 'All regions' : 'All branches'}</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="label" htmlFor="perf-period">
          Period
        </label>
        <select
          id="perf-period"
          className="input h-9 w-auto text-sm"
          value={period}
          onChange={(event) => go({ period: event.target.value })}
        >
          {PERFORMANCE_PERIODS.map((value) => (
            <option key={value} value={value}>
              {PERIOD_LABEL[value]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
