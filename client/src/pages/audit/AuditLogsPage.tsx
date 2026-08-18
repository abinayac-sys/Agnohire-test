import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Download, Search, ShieldCheck, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/common/PageHeader.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { DateRangeFilter } from '../../components/common/DateRangeFilter.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Spinner } from '../../components/ui/Spinner.js';
import * as auditApi from '../../services/auditApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { useAuthStore } from '../../store/authStore.js';
import { ROLES, type AuditFilters } from '@agnohire/shared';

const PAGE_SIZE = 25;

function actionVariant(action: string): 'success' | 'danger' | 'warning' | 'info' {
  if (/DELETE|ERASURE|REJECT/i.test(action)) return 'danger';
  if (/CREATE|GDPR_REQUEST/i.test(action)) return 'success';
  if (/UPDATE|CONSENT|EXPORT/i.test(action)) return 'warning';
  return 'info';
}

export function AuditLogsPage() {
  const hasRole = useAuthStore((s) => s.hasRole);
  const canSeePlatform = hasRole(ROLES.SUPERADMIN);
  const [scope, setScope] = useState<'tenant' | 'platform'>('tenant');
  const [filters, setFilters] = useState<Partial<AuditFilters>>({ page: 1, limit: PAGE_SIZE, sortOrder: 'desc' });
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const qc = useQueryClient();

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => auditApi.deleteAuditLogsBulk(ids),
    onSuccess: () => {
      toast.success('Selected audit log entries deleted');
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['audit-logs'] });
      qc.invalidateQueries({ queryKey: ['audit-facets'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Bulk delete failed')),
  });

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    bulkDeleteMutation.mutate(selectedIds);
  };

  const { data: facets } = useQuery({ queryKey: ['audit-facets'], queryFn: auditApi.fetchAuditFacets });
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit-logs', scope, filters],
    queryFn: () => auditApi.fetchAuditLogs({ ...filters, scope }),
    placeholderData: keepPreviousData,
  });

  const patch = (p: Partial<AuditFilters>) => setFilters((f) => ({ ...f, ...p, page: 1 }));
  const items = data?.items ?? [];
  const total = data?.meta.total ?? 0;
  const page = filters.page ?? 1;
  const pages = data?.meta.totalPages ?? 1;

  const onExport = async () => {
    try {
      await auditApi.downloadAuditExcel({ ...filters, page: undefined, limit: undefined });
      toast.success('Audit log exported');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Export failed'));
    }
  };

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Every privileged action across AgnoHire, with the actor, target, and before/after snapshots."
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <Button
                variant="danger"
                onClick={handleBulkDelete}
                loading={bulkDeleteMutation.isPending}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete Selected ({selectedIds.length})
              </Button>
            )}
            <Button variant="outline" onClick={onExport}>
              <Download className="mr-1.5 h-4 w-4" /> Export Excel
            </Button>
          </div>
        }
      />

      {canSeePlatform && (
        <div className="mt-4 inline-flex rounded-lg border border-border bg-surface p-1">
          {(['tenant', 'platform'] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setScope(s); setFilters((f) => ({ ...f, page: 1 })); }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${scope === s ? 'bg-accent text-accent-fg' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {s === 'tenant' ? 'Workspace Activity' : 'Platform Activity'}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); patch({ search: search.trim() || undefined }); }}
          className="relative flex-1 min-w-[220px]"
        >
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <Input className="pl-9" placeholder="Search description, entity id, IP…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <Select
          className="w-44"
          placeholder="All actions"
          value={filters.action ?? ''}
          options={(facets?.actions ?? []).map((a) => ({ value: a, label: a }))}
          onChange={(e) => patch({ action: e.target.value || undefined })}
        />
        <Select
          className="w-44"
          placeholder="All entities"
          value={filters.entity ?? ''}
          options={(facets?.entities ?? []).map((a) => ({ value: a, label: a }))}
          onChange={(e) => patch({ entity: e.target.value || undefined })}
        />
        <DateRangeFilter
          from={(filters.from as unknown as string) || ''}
          to={(filters.to as unknown as string) || ''}
          onChange={(f, t) => patch({ from: (f || undefined) as never, to: (t || undefined) as never })}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="No audit entries" description="Nothing matches these filters yet." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-accent cursor-pointer"
                    checked={items.length > 0 && selectedIds.length === items.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(items.map((i) => i.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                  />
                </th>
                <th className="px-4 py-3 font-medium text-left">When</th>
                <th className="px-4 py-3 font-medium text-left">Action</th>
                <th className="px-4 py-3 font-medium text-left">Entity</th>
                <th className="px-4 py-3 font-medium text-left">Description</th>
                <th className="px-4 py-3 font-medium text-left">Actor</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setOpenId(l.id)}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-raised"
                >
                  <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border accent-accent cursor-pointer"
                      checked={selectedIds.includes(l.id)}
                      onChange={() => {
                        setSelectedIds((prev) =>
                          prev.includes(l.id) ? prev.filter((id) => id !== l.id) : [...prev, l.id]
                        );
                      }}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-muted">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge variant={actionVariant(l.action)}>{l.action}</Badge></td>
                  <td className="px-4 py-3 text-text-secondary">{l.entity ?? '—'}</td>
                  <td className="max-w-[420px] truncate px-4 py-3 text-text-primary">{l.description}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{l.userName ?? 'System'}{l.role ? ` · ${l.role}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-text-muted">
          <span>{total} entr{total === 1 ? 'y' : 'ies'}{isFetching ? ' · updating…' : ''}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))}><ChevronLeft className="h-4 w-4" /></Button>
            <span>Page {page} / {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      <AuditDetailDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function AuditDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: log, isLoading } = useQuery({
    queryKey: ['audit-log', id],
    queryFn: () => auditApi.fetchAuditLog(id!),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => auditApi.deleteAuditLog(id!),
    onSuccess: () => {
      toast.success('Audit log entry deleted');
      onClose();
      qc.invalidateQueries({ queryKey: ['audit-logs'] });
      qc.invalidateQueries({ queryKey: ['audit-facets'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Delete failed')),
  });

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title="Audit entry"
      subtitle={log?.action}
      footer={
        log && (
          <div className="flex w-full justify-end">
            <Button
              variant="danger"
              onClick={handleDelete}
              loading={deleteMutation.isPending}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete Entry
            </Button>
          </div>
        )
      }
    >
      {isLoading || !log ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-5 text-sm">
          <Field label="When" value={new Date(log.createdAt).toLocaleString()} />
          <Field label="Description" value={log.description} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Action" value={log.action} />
            <Field label="Entity" value={`${log.entity ?? '—'}${log.entityId ? ` (${log.entityId})` : ''}`} />
            <Field label="Actor" value={`${log.userName ?? 'System'}${log.role ? ` · ${log.role}` : ''}`} />
            <Field label="IP address" value={log.ipAddress ?? '—'} />
          </div>
          {log.userAgent && <Field label="User agent" value={log.userAgent} />}
          {(log.oldValue != null || log.newValue != null) && (
            <div className="grid grid-cols-2 gap-4">
              <JsonBlock label="Before" value={log.oldValue} />
              <JsonBlock label="After" value={log.newValue} />
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <p className="break-words text-text-primary">{value}</p>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-bg p-3 text-xs text-text-secondary">
        {value == null ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
