import { useSearchParams } from 'react-router-dom';
import { Search, Gift, Radio, ListChecks } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { cn } from '../../utils/cn.js';
import { TalentSearchTab } from './TalentSearchTab.js';
import { ReferralsTab } from './ReferralsTab.js';
import { ChannelsTab } from './ChannelsTab.js';
import { ListsTab } from './ListsTab.js';

const TABS = [
  { key: 'search', label: 'Talent Search', icon: Search },
  { key: 'referrals', label: 'Referrals', icon: Gift },
  { key: 'channels', label: 'Channels', icon: Radio },
  { key: 'lists', label: 'Lists', icon: ListChecks },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function SourcingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = (searchParams.get('tab') as TabKey) || 'search';

  function setTab(tab: TabKey) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Sourcing" description="Find, refer, and organize talent across channels" />

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                on
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {active === 'search' && <TalentSearchTab />}
      {active === 'referrals' && <ReferralsTab />}
      {active === 'channels' && <ChannelsTab />}
      {active === 'lists' && <ListsTab />}
    </div>
  );
}
