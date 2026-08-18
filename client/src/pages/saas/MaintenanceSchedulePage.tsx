import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { MaintenanceWindowDto } from '@agnohire/shared';
import { PageHeader } from '../../components/common/PageHeader.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Badge } from '../../components/ui/Badge.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import * as platformApi from '../../services/platformApi.js';
import { apiErrorMessage } from '../../services/api.js';

function statusVariant(s: MaintenanceWindowDto['status']): 'success' | 'danger' | 'warning' | 'info' {
  if (s === 'ACTIVE') return 'warning';
  if (s === 'COMPLETED') return 'success';
  if (s === 'CANCELLED') return 'danger';
  return 'info';
}

/** Platform-superadmin: schedule maintenance windows that email staff/candidates and pop up a live warning. */
export function MaintenanceSchedulePage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);

  const { data: windows, isLoading } = useQuery({ queryKey: ['platform-maintenance'], queryFn: platformApi.fetchMaintenanceWindows });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform-maintenance'] });

  const cancel = useMutation({
    mutationFn: (id: string) => platformApi.cancelMaintenanceWindow(id),
    onSuccess: () => { toast.success('Maintenance window cancelled'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not cancel maintenance window')),
  });

  const rows = windows ?? [];

  return (
    <div>
      <PageHeader
        title="Scheduled Maintenance"
        description="Schedule a maintenance window to notify staff immediately, remind candidates beforehand, and warn active users live."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Schedule maintenance</Button>}
      />

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : !rows.length ? (
          <EmptyState
            icon={<AlertTriangle className="h-8 w-8" />}
            title="No maintenance windows scheduled"
            description="Schedule one to notify staff and candidates ahead of planned downtime."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Title</th>
                <th className="px-4 py-3 font-medium text-left">Window</th>
                <th className="px-4 py-3 font-medium text-left">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-border/60 last:border-0 hover:bg-surface-raised">
                  <td className="px-4 py-3">
                    <p className="text-text-primary">{w.title}</p>
                    <p className="max-w-md truncate text-xs text-text-muted">{w.message}</p>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {new Date(w.startAt).toLocaleString()} &rarr; {new Date(w.endAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3"><Badge variant={statusVariant(w.status)}>{w.status}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {(w.status === 'SCHEDULED' || w.status === 'NOTIFIED') && (
                        <Button size="sm" variant="ghost" className="text-danger" disabled={cancel.isPending}
                          onClick={async () => { if (await confirm({ title: 'Cancel maintenance', message: `Cancel "${w.title}"? Scheduled emails/warnings will not go out.`, confirmText: 'Cancel window', variant: 'danger' })) cancel.mutate(w.id); }}>
                          <Trash2 className="h-3.5 w-3.5" /> Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && <CreateMaintenanceDrawer onClose={() => setCreating(false)} onCreated={() => { setCreating(false); invalidate(); }} />}
    </div>
  );
}

function CreateMaintenanceDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  const create = useMutation({
    mutationFn: () => platformApi.createMaintenanceWindow({
      title: title.trim(),
      message: message.trim(),
      startAt: new Date(startAt),
      endAt: new Date(endAt),
    }),
    onSuccess: () => { toast.success('Maintenance scheduled — staff notified'); onCreated(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not schedule maintenance')),
  });

  const canSave = title.trim().length >= 2 && message.trim().length >= 2 && !!startAt && !!endAt && new Date(endAt) > new Date(startAt) && new Date(startAt) > new Date();

  return (
    <Drawer open onClose={onClose} title="Schedule maintenance" subtitle="Staff are emailed immediately; candidates are reminded 24h before start"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!canSave} onClick={() => create.mutate()}>Schedule</Button></div>}>
      <div className="space-y-4">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Database upgrade" /></Field>
        <Field label="Message"><textarea className="min-h-24 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What's happening and what users should expect." /></Field>
        <Field label="Start"><Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></Field>
        <Field label="End"><Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>{children}</div>;
}

export default MaintenanceSchedulePage;
