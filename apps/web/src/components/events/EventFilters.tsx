import { EVENT_STATUSES } from '@sihl-one/contracts';

import { FilterBar } from '@/components/ui/FilterBar';
import { humanise } from '@/lib/format';

export function EventFilters() {
  return (
    <FilterBar
      searchLabel="Search events"
      searchPlaceholder="Name, code or venue…"
      selects={[
        {
          name: 'status',
          label: 'All statuses',
          options: EVENT_STATUSES.map((value) => ({ value, label: humanise(value) })),
        },
      ]}
    />
  );
}
