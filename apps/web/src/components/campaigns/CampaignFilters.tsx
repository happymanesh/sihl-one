import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES } from '@sihl-one/contracts';

import { FilterBar } from '@/components/ui/FilterBar';
import { humanise } from '@/lib/format';

export function CampaignFilters() {
  return (
    <FilterBar
      searchLabel="Search campaigns"
      searchPlaceholder="Name, code or reference…"
      selects={[
        {
          name: 'status',
          label: 'All statuses',
          options: CAMPAIGN_STATUSES.map((value) => ({ value, label: humanise(value) })),
        },
        {
          name: 'channel',
          label: 'All channels',
          options: CAMPAIGN_CHANNELS.map((value) => ({ value, label: humanise(value) })),
        },
      ]}
    />
  );
}
