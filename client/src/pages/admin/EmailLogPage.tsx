import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Mail, Search, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Button } from '../../components/ui/Button.js';
import * as adminApi from '../../services/adminApi.js';
import type { EmailLogFilters, EmailLogItem } from '@agnohire/shared';

const STATUS_META: Record<EmailLogItem['status'], { variant: 'success' | 'danger' | 'muted'; icon: typeof Mail }> = {
  SENT: { variant: 'success', icon: CheckCircle2 },
  FAILED: { variant: 'danger', icon: XCircle },
  SKIPPED: { variant: 'muted', icon: MinusCircle },
};

export function EmailLogPage() {
  const [filters, setFilters] = useState<Partial<EmailLogFilters>>({ page: 1, limit: 25 });
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['email-logs', filters],
    queryFn: () => adminApi.fetchEmailLogs(filters),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div>
      <PageHeader title="Email Log" description="Every email the system has attempted to send." />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); setFilters((f) => ({ ...f, search: search.trim() || undefined, page: 1 })); }}
          className="relative min-w-[220px] flex-1"
        >
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <Input className="pl-9" placeholder="Search recipient or subject…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <Select
          className="w-40" placeholder="All statuses" value={filters.status ?? ''}
          options={[{ value: 'SENT', label: 'Sent' }, { value: 'FAILED', label: 'Failed' }, { value: 'SKIPPED', label: 'Skipped' }]}
          onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value || undefined) as EmailLogFilters['status'], page: 1 }))}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Mail className="h-8 w-8" />} title="No emails yet" description="Sent emails will appear here." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Status</th>
                <th className="px-4 py-3 font-medium text-left">Recipient</th>
                <th className="px-4 py-3 font-medium text-left">Subject</th>
                <th className="px-4 py-3 font-medium text-left">Type</th>
                <th className="px-4 py-3 font-medium text-left">When</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const m = STATUS_META[e.status];
                const Icon = m.icon;
                return (
                  <tr key={e.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <Badge variant={m.variant}><Icon className="mr-1 inline h-3 w-3" />{e.status}</Badge>
                      {e.errorMsg && <p className="mt-1 max-w-[200px] truncate text-xs text-danger" title={e.errorMsg}>{e.errorMsg}</p>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{e.toEmail}</td>
                    <td className="px-4 py-3 text-text-primary">{e.subject}</td>
                    <td className="px-4 py-3 text-text-muted">{e.templateId ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-text-muted">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-text-muted">
          <span>{meta.total} emails</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>Previous</Button>
            <span>Page {meta.page} of {meta.totalPages}</span>
            <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
