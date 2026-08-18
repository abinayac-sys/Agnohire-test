import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, Radio, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import * as sourcingApi from '../../services/sourcingApi.js';
import type { SourcingChannelType } from '@agnohire/shared';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { apiErrorMessage } from '../../services/api.js';

const TYPE_OPTIONS = [
  { value: 'LINKEDIN', label: 'LinkedIn' },
  { value: 'JOB_BOARD', label: 'Job Board' },
  { value: 'AGENCY', label: 'Agency' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'INTERNAL', label: 'Internal' },
  { value: 'CAREER_SITE', label: 'Career Site' },
  { value: 'OTHER', label: 'Other' },
];

export function ChannelsTab() {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const confirm = useConfirm();
  const canManage = hasPermission(PERMISSIONS.SOURCING_MANAGE);

  const [name, setName] = useState('');
  const [type, setType] = useState<SourcingChannelType>('JOB_BOARD');

  const { data, isLoading } = useQuery({
    queryKey: ['sourcing-channels'],
    queryFn: () => sourcingApi.fetchChannels(),
  });

  const createMutation = useMutation({
    mutationFn: () => sourcingApi.createChannel({ name: name.trim(), type, isActive: true }),
    onSuccess: () => { toast.success('Channel added'); setName(''); qc.invalidateQueries({ queryKey: ['sourcing-channels'] }); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      sourcingApi.updateChannel(id, { isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sourcing-channels'] }); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => sourcingApi.syncChannel(id),
    onSuccess: (r) => toast.success(r.message),
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sourcingApi.deleteChannel(id),
    onSuccess: () => { toast.success('Channel deleted'); qc.invalidateQueries({ queryKey: ['sourcing-channels'] }); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const channels = data?.channels ?? [];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-raised p-4">
          <div className="flex-1 min-w-48">
            <label className="text-xs font-medium text-text-muted">Channel name</label>
            <Input placeholder="e.g. LinkedIn Recruiter" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="w-44">
            <label className="text-xs font-medium text-text-muted">Type</label>
            <Select options={TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value as SourcingChannelType)} />
          </div>
          <Button disabled={name.trim().length < 2} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            <Plus className="h-4 w-4" />
            Add Channel
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center"><Spinner className="mx-auto" /></div>
      ) : channels.length === 0 ? (
        <EmptyState icon={<Radio className="h-8 w-8" />} title="No channels yet" description="Add a sourcing channel to track where candidates come from." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {channels.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-surface p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-text-primary">{c.name}</p>
                  <p className="text-xs text-text-muted">{c.type.replace('_', ' ')}</p>
                </div>
                <Badge variant={c.isActive ? 'success' : 'muted'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>
              </div>
              {c.needsCredential && (
                <p className="rounded bg-warning/10 px-2 py-1 text-xs text-warning">
                  Needs credentials — connect in Admin Console → Integrations
                </p>
              )}
              {canManage && (
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => toggleMutation.mutate({ id: c.id, isActive: !c.isActive })}>
                    {c.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={syncMutation.isPending && syncMutation.variables === c.id}
                    onClick={() => syncMutation.mutate(c.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Sync
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger ml-auto"
                    onClick={async () => { if (await confirm({ title: 'Delete Channel', message: 'Delete this channel?', confirmText: 'Delete', variant: 'danger' })) deleteMutation.mutate(c.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
