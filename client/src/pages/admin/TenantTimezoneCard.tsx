import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Select } from '../../components/ui/Select.js';
import { Button } from '../../components/ui/Button.js';
import { updateTenantTimezone } from '../../services/billingApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { useAuthStore } from '../../store/authStore.js';

const TIMEZONES: string[] =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

/**
 * Lets a tenant admin correct the timezone auto-detected at signup (VPN,
 * shared machine, etc). Used by server-rendered artifacts — PDF reports and
 * transactional emails — that have no browser to implicitly localize into.
 */
export function TenantTimezoneCard() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [timezone, setTimezone] = useState(user?.tenantTimezone ?? 'UTC');
  const qc = useQueryClient();

  const options = useMemo(() => TIMEZONES.map((tz) => ({ value: tz, label: tz })), []);

  const mutation = useMutation({
    mutationFn: () => updateTenantTimezone(timezone),
    onSuccess: (res) => {
      toast.success('Workspace timezone updated');
      if (user) setUser({ ...user, tenantTimezone: res.timezone });
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update timezone')),
  });

  const dirty = timezone !== (user?.tenantTimezone ?? 'UTC');

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-text-primary">
        <Globe className="h-4 w-4" /> Workspace Timezone
      </p>
      <p className="mb-3 text-xs text-text-secondary">
        Used for interview report PDFs and emails sent by this workspace. Auto-detected at signup — correct it here if it's wrong.
      </p>
      <div className="flex items-center gap-2">
        <Select className="max-w-sm" options={options} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        <Button size="sm" disabled={!dirty} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
      </div>
    </div>
  );
}
