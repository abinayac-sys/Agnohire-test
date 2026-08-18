import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ShieldCheck, Download, Trash2, Check, X, Clock, UserCheck, FileDown, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/common/PageHeader.js';
import { StatCard } from '../../components/common/StatCard.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { cn } from '../../utils/cn.js';
import * as gdprApi from '../../services/gdprApi.js';
import { apiErrorMessage } from '../../services/api.js';
import type { GdprRequestItem, GdprRequestStatus } from '@agnohire/shared';
import { useConfirm } from '../../providers/ConfirmProvider.js';

type Tab = 'requests' | 'consent' | 'retention';

const STATUS_VARIANT: Record<GdprRequestStatus, 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning', COMPLETED: 'success', REJECTED: 'danger',
};

export function CompliancePage() {
  const [tab, setTab] = useState<Tab>('requests');
  const { data: summary } = useQuery({ queryKey: ['gdpr-summary'], queryFn: gdprApi.fetchComplianceSummary });

  return (
    <div>
      <PageHeader
        title="Compliance"
        description="GDPR subject-access, portability, and erasure requests, consent records, and data-retention policies."
      />

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Pending requests" value={summary?.pendingRequests ?? 0} icon={Clock} />
        <StatCard label="Completed" value={summary?.completedRequests ?? 0} icon={Check} />
        <StatCard label="Candidates" value={summary?.totalCandidates ?? 0} icon={UserCheck} />
        <StatCard label="Consented" value={summary?.consentedCandidates ?? 0} icon={ShieldCheck} />
        <StatCard label="Erased" value={summary?.erasedCandidates ?? 0} icon={Trash2} />
      </div>

      <div className="mt-6 flex gap-1 border-b border-border">
        {(['requests', 'consent', 'retention'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition-colors',
              tab === t ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'requests' && <RequestsTab />}
        {tab === 'consent' && <ConsentTab onChanged={() => setTab('requests')} />}
        {tab === 'retention' && <RetentionTab />}
      </div>
    </div>
  );
}

// ─── REQUESTS ────────────────────────────────────────────────────────────────

function RequestsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<GdprRequestStatus | ''>('');
  const { data, isLoading } = useQuery({
    queryKey: ['gdpr-requests', status],
    queryFn: () => gdprApi.fetchGdprRequests({ status: status || undefined, limit: 50 }),
    placeholderData: keepPreviousData,
  });

  const process = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'fulfil' | 'reject' }) => gdprApi.processGdprRequest(id, { action }),
    onSuccess: ({ request, bundle }) => {
      if (bundle) {
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `agnohire-gdpr-export-${request.candidateId}.json`; a.click();
        URL.revokeObjectURL(url);
        toast.success('Request fulfilled — data exported');
      } else {
        toast.success(`Request ${request.status.toLowerCase()}`);
      }
      qc.invalidateQueries({ queryKey: ['gdpr-requests'] });
      qc.invalidateQueries({ queryKey: ['gdpr-summary'] });
      qc.invalidateQueries({ queryKey: ['gdpr-consent'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not process request')),
  });

  const items = data?.items ?? [];
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {(['', 'PENDING', 'COMPLETED', 'REJECTED'] as const).map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={cn('rounded-full border px-3 py-1 text-xs', status === s ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted hover:bg-surface-raised')}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex justify-center py-14"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="No requests" description="Raise a request from the Consent tab." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Candidate</th>
                <th className="px-4 py-3 font-medium text-left">Type</th>
                <th className="px-4 py-3 font-medium text-left">Status</th>
                <th className="px-4 py-3 font-medium text-left">Requested</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r: GdprRequestItem) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <p className="text-text-primary">{r.candidateName ?? '—'}</p>
                    <p className="text-xs text-text-muted">{r.candidateEmail}</p>
                  </td>
                  <td className="px-4 py-3"><Badge variant={r.type === 'DELETION' ? 'danger' : 'info'}>{r.type}</Badge></td>
                  <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-muted">{new Date(r.requestedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    {r.status === 'PENDING' ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant={r.type === 'DELETION' ? 'danger' : 'primary'} loading={process.isPending} onClick={() => process.mutate({ id: r.id, action: 'fulfil' })}>
                          {r.type === 'DELETION' ? <><Trash2 className="h-3.5 w-3.5" /> Erase</> : <><FileDown className="h-3.5 w-3.5" /> Fulfil</>}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => process.mutate({ id: r.id, action: 'reject' })}><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    ) : (
                      <span className="text-xs text-text-muted">{r.processedAt ? new Date(r.processedAt).toLocaleDateString() : '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── CONSENT ─────────────────────────────────────────────────────────────────

function ConsentTab({ onChanged }: { onChanged: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['gdpr-consent'], queryFn: () => gdprApi.fetchConsent({ limit: 50 }) });

  const consent = useMutation({
    mutationFn: ({ candidateId, given }: { candidateId: string; given: boolean }) => gdprApi.setConsent({ candidateId, given }),
    onSuccess: () => { toast.success('Consent updated'); qc.invalidateQueries({ queryKey: ['gdpr-consent'] }); qc.invalidateQueries({ queryKey: ['gdpr-summary'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update consent')),
  });

  const erase = useMutation({
    mutationFn: (candidateId: string) => gdprApi.createGdprRequest({ candidateId, type: 'DELETION' }),
    onSuccess: () => { toast.success('Erasure request raised'); qc.invalidateQueries({ queryKey: ['gdpr-requests'] }); qc.invalidateQueries({ queryKey: ['gdpr-summary'] }); onChanged(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not raise request')),
  });

  const onExport = async (candidateId: string) => {
    try { await gdprApi.downloadCandidateExport(candidateId); toast.success('Data exported'); }
    catch (e) { toast.error(apiErrorMessage(e, 'Export failed')); }
  };

  const items = data?.items ?? [];
  if (isLoading) return <div className="flex justify-center py-14"><Spinner /></div>;
  if (items.length === 0) return <EmptyState icon={<UserCheck className="h-8 w-8" />} title="No candidates" description="Candidate consent records will appear here." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
          <tr>
            <th className="px-4 py-3 font-medium text-left">Candidate</th>
            <th className="px-4 py-3 font-medium text-left">Consent</th>
            <th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.candidateId} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-3">
                <p className="text-text-primary">{c.candidateName}</p>
                <p className="text-xs text-text-muted">{c.candidateEmail}</p>
              </td>
              <td className="px-4 py-3">
                {c.gdprDeletedAt ? <Badge variant="danger">Erased</Badge>
                  : c.consentGiven ? <Badge variant="success">Given{c.consentAt ? ` · ${new Date(c.consentAt).toLocaleDateString()}` : ''}</Badge>
                  : <Badge variant="warning">Not given</Badge>}
              </td>
              <td className="px-4 py-3">
                {c.gdprDeletedAt ? <span className="block text-right text-xs text-text-muted">—</span> : (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => consent.mutate({ candidateId: c.candidateId, given: !c.consentGiven })}>
                      {c.consentGiven ? 'Withdraw' : 'Record consent'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onExport(c.candidateId)}><Download className="h-3.5 w-3.5" /> Export</Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={async () => {
                      if (
                        await confirm({
                          title: 'GDPR Erasure Request',
                          message: `Raise an erasure request for ${c.candidateName}?`,
                          confirmText: 'Erase',
                          variant: 'danger',
                        })
                      ) {
                        erase.mutate(c.candidateId);
                      }
                    }}>
                      <Trash2 className="h-3.5 w-3.5" /> Erase
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── RETENTION ───────────────────────────────────────────────────────────────

function RetentionTab() {
  const qc = useQueryClient();
  const { data: policies, isLoading } = useQuery({ queryKey: ['gdpr-retention'], queryFn: gdprApi.fetchRetentionPolicies });
  const [entityType, setEntityType] = useState('');
  const [retentionDays, setRetentionDays] = useState('365');
  const [autoDelete, setAutoDelete] = useState(false);

  const save = useMutation({
    mutationFn: () => gdprApi.upsertRetentionPolicy({ entityType: entityType.trim(), retentionDays: Number(retentionDays), autoDeleteEnabled: autoDelete }),
    onSuccess: () => { toast.success('Policy saved'); setEntityType(''); setRetentionDays('365'); setAutoDelete(false); qc.invalidateQueries({ queryKey: ['gdpr-retention'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save policy')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => gdprApi.deleteRetentionPolicy(id),
    onSuccess: () => { toast.success('Policy removed'); qc.invalidateQueries({ queryKey: ['gdpr-retention'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not remove policy')),
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex justify-center py-14"><Spinner /></div>
        ) : (policies ?? []).length === 0 ? (
          <EmptyState icon={<Clock className="h-8 w-8" />} title="No retention policies" description="Add a policy to define how long each entity is kept." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr><th className="px-4 py-3 font-medium text-left">Entity</th><th className="px-4 py-3 font-medium text-left">Retention</th><th className="px-4 py-3 font-medium text-left">Auto-delete</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {(policies ?? []).map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 text-text-primary">{p.entityType}</td>
                  <td className="px-4 py-3 text-text-secondary">{p.retentionDays} days</td>
                  <td className="px-4 py-3">{p.autoDeleteEnabled ? <Badge variant="warning">On</Badge> : <Badge>Off</Badge>}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" className="text-danger" onClick={() => remove.mutate(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (entityType.trim()) save.mutate(); }}
        className="h-fit space-y-3 rounded-xl border border-border bg-surface p-4"
      >
        <p className="font-medium text-text-primary">Add / update policy</p>
        <div>
          <label className="mb-1 block text-xs text-text-muted">Entity type</label>
          <Input placeholder="e.g. Candidate, AuditLog" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">Retention (days)</label>
          <Input type="number" min={1} value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={autoDelete} onChange={(e) => setAutoDelete(e.target.checked)} className="h-4 w-4 rounded border-border" />
          Enable auto-delete
        </label>
        <Button type="submit" className="w-full" loading={save.isPending} disabled={!entityType.trim()}><Plus className="h-4 w-4" /> Save policy</Button>
      </form>
    </div>
  );
}
