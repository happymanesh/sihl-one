import {
  ACTIVITY_METRICS,
  ACTIVITY_METRIC_LABELS,
  ACTIVITY_METRIC_SHORT_LABELS,
  type ActivityMetric,
} from '@sihl-one/contracts';

/**
 * The columns of the daily report, in reading order.
 *
 * Derived from ACTIVITY_METRICS rather than listed again, so a metric added to
 * the contract cannot go missing from the table — the commonest way a report
 * quietly stops matching its own API.
 *
 * Open leads leads deliberately: it is the backlog a reader judges the rest of
 * the row against.
 */
export const ACTIVITY_COLUMNS: ReadonlyArray<{
  key: ActivityMetric;
  short: string;
  long: string;
}> = ACTIVITY_METRICS.map((key) => ({
  key,
  short: ACTIVITY_METRIC_SHORT_LABELS[key],
  long: ACTIVITY_METRIC_LABELS[key],
}));
