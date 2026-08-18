import { useState } from 'react';
import { Plus, Search, CalendarClock, Users, Trash2, Download } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { PlanLimitNotice } from '../../components/common/PlanLimitNotice.js';
import { usePlanUsage } from '../../hooks/usePlanUsage.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { DateRangeFilter } from '../../components/common/DateRangeFilter.js';
import { ScheduleDrawer } from './ScheduleDrawer.js';
import { ScheduleDetailPanel } from './ScheduleDetailPanel.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS, type InterviewStatus } from '@agnohire/shared';
import * as scheduleApi from '../../services/scheduleApi.js';
import * as jobApi from '../../services/jobApi.js';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiErrorMessage } from '../../services/api.js';

const STATUS_VARIANT: Record<InterviewStatus, 'muted' | 'info' | 'success' | 'danger' | 'warning'> = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  EVALUATING: 'warning',
  EVALUATED: 'success',
  CANCELLED: 'danger',
  EXPIRED: 'danger',
};

const DECISION_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'muted'> = {
  PASS: 'success',
  FAIL: 'danger',
  HOLD: 'warning',
};

const STATUS_OPTIONS = [
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
];

const DECISION_OPTIONS = [
  { value: 'PASS', label: 'Pass' },
  { value: 'FAIL', label: 'Fail' },
  { value: 'HOLD', label: 'Hold' },
];

const formatDateInTimezone = (dateStr: string, ianatz: string) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: ianatz,
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
    return formatter.format(new Date(dateStr));
  } catch (e) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
    return formatter.format(new Date(dateStr));
  }
};

const formatTimeInTimezone = (dateStr: string, ianatz: string) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ianatz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${formatter.format(new Date(dateStr))} (${ianatz})`;
  } catch (e) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${formatter.format(new Date(dateStr))} (UTC)`;
  }
};

export function SchedulePage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const { isReached } = usePlanUsage();
  const schedulesFull = isReached('SCHEDULES');
  const canSchedule = hasPermission(PERMISSIONS.INTERVIEW_SCHEDULE);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<InterviewStatus | ''>('');
  const [decision, setDecision] = useState('');
  const [jobRequisitionId, setJobRequisitionId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionMode = selectedIds.length > 0;
  const [page, setPage] = useState(1);

  // Fetch jobs for the job filter dropdown
  const { data: jobsData } = useQuery({
    queryKey: ['jobs-for-filter'],
    queryFn: () => jobApi.fetchJobs({ limit: 200, page: 1 }),
    staleTime: 60000,
  });
  const jobOptions = (jobsData?.items ?? []).map((j) => ({
    value: j.id,
    label: j.title,
  }));

  const { data, isLoading } = useQuery({
    queryKey: ['schedules', search, status, decision, jobRequisitionId, fromDate, toDate, page],
    queryFn: () =>
      scheduleApi.fetchSchedules({
        search: search || undefined,
        status: (status || undefined) as InterviewStatus | undefined,
        decision: (decision as 'PASS' | 'FAIL' | 'HOLD') || undefined,
        jobRequisitionId: jobRequisitionId || undefined,
        // Send plain date strings; backend converts to Date range
        from: fromDate ? `${fromDate}T00:00:00.000Z` : undefined,
        to: toDate ? `${toDate}T23:59:59.999Z` : undefined,
        sortBy: 'scheduledDate',
        sortOrder: 'asc',
        page,
        limit: 10,
      }),
  });

  const schedules = data?.items ?? [];
  const meta = data?.meta ?? { page: 1, pageSize: 10, total: 0, totalPages: 1 };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduleApi.deleteSchedule(id),
    onSuccess: () => {
      toast.success('Schedule deleted successfully');
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => scheduleApi.deleteSchedule(id)));
    },
    onSuccess: () => {
      toast.success('Schedules deleted successfully');
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  function resetPage() {
    setPage(1);
  }

  const hasActiveFilters = !!(search || status || decision || jobRequisitionId || fromDate || toDate);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule"
        description="Book and manage live & panel interviews"
        actions={
          <div className="flex items-center gap-2">
            {selectionMode && selectedIds.length > 0 && (
              <>
                <Button variant="outline" onClick={() => {
                  toast.promise(scheduleApi.downloadBulkScheduleReports({ ids: selectedIds }), {
                    loading: 'Preparing download...',
                    success: 'Report downloaded',
                    error: 'Download failed',
                  });
                }}>
                  <Download className="h-4 w-4 mr-2" /> Download Reports ({selectedIds.length})
                </Button>
                <Button variant="danger" onClick={() => bulkDeleteMutation.mutate(selectedIds)} disabled={bulkDeleteMutation.isPending}>
                  Delete Selected ({selectedIds.length})
                </Button>
              </>
            )}
            {selectionMode && (
              <Button variant="outline" onClick={() => setSelectedIds([])}>
                Cancel
              </Button>
            )}
            {!selectionMode && canSchedule && (
              <>
                <Button variant="outline" onClick={() => {
                  toast.promise(
                    scheduleApi.downloadBulkScheduleReports({
                      search: search || undefined,
                      status: status || undefined,
                      decision: decision || undefined,
                      jobRequisitionId: jobRequisitionId || undefined,
                      from: fromDate ? `${fromDate}T00:00:00.000Z` : undefined,
                      to: toDate ? `${toDate}T23:59:59.999Z` : undefined,
                    }),
                    {
                      loading: 'Preparing download...',
                      success: 'Report downloaded',
                      error: 'Download failed',
                    }
                  );
                }}>
                  <Download className="h-4 w-4 mr-2" /> Download All Reports
                </Button>
                <span title={schedulesFull ? 'Plan limit reached — upgrade to schedule more interviews' : undefined}>
                  <Button onClick={() => setCreateOpen(true)} disabled={schedulesFull}>
                    <Plus className="h-4 w-4" /> Schedule Interview
                  </Button>
                </span>
              </>
            )}
          </div>
        }
      />

      <PlanLimitNotice metric="SCHEDULES" />

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <Input
            className="pl-9"
            placeholder="Search by candidate…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          />
        </div>

        {/* Status filter */}
        <Select
          className="w-44"
          options={STATUS_OPTIONS}
          placeholder="All statuses"
          value={status}
          onChange={(e) => { setStatus(e.target.value as InterviewStatus); resetPage(); }}
        />

        {/* Job filter */}
        <Select
          className="w-52"
          options={jobOptions}
          placeholder="All jobs"
          value={jobRequisitionId}
          onChange={(e) => { setJobRequisitionId(e.target.value); resetPage(); }}
        />

        {/* Decision filter (Pass / Fail / Hold) */}
        <Select
          className="w-36"
          options={DECISION_OPTIONS}
          placeholder="All decisions"
          value={decision}
          onChange={(e) => { setDecision(e.target.value); resetPage(); }}
        />

        {/* Date range pickers */}
        <DateRangeFilter
          from={fromDate}
          to={toDate}
          onChange={(f, t) => {
            setFromDate(f || '');
            setToDate(t || '');
            resetPage();
          }}
        />

        {/* Clear all */}
        {hasActiveFilters && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setSearch('');
              setStatus('');
              setDecision('');
              setJobRequisitionId('');
              setFromDate('');
              setToDate('');
              resetPage();
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><Spinner className="mx-auto" /></div>
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" />}
          title="No interviews scheduled"
          description={canSchedule ? 'Book a live or panel interview to get started.' : 'No scheduled interviews to show.'}
          action={
            canSchedule ? (
              <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Schedule Interview</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3 w-10 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={schedules.length > 0 && selectedIds.length === schedules.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(schedules.map((s: any) => s.id));
                      else setSelectedIds([]);
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left">Candidate</th>
                <th className="px-4 py-3 text-left">Job Title</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Time</th>
                <th className="px-4 py-3 text-left">Interviewers</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Decision</th>
                {canSchedule && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {schedules.map((s: any) => (
                <tr
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-raised/50"
                >
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent cursor-pointer"
                      checked={selectedIds.includes(s.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds([...selectedIds, s.id]);
                        else setSelectedIds(selectedIds.filter((id: string) => id !== s.id));
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary">{s.candidate.fullName}</p>
                    <p className="text-xs text-text-muted">{s.candidate.email}</p>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{s.jobRequisition?.title ?? '—'}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {formatDateInTimezone(s.scheduledDate, s.timezone)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                    <span>{formatTimeInTimezone(s.scheduledDate, s.timezone)}</span>
                    <span className="text-text-muted"> · {s.duration}m</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-text-secondary">
                      <Users className="h-3.5 w-3.5 text-text-muted" />
                      {s.interviewers.length === 1
                        ? s.interviewers[0].fullName
                        : `${s.interviewers.length} interviewers`}
                    </span>
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline">{s.type}</Badge></td>
                  <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[s.status as InterviewStatus]}>{s.status.replace('_', ' ')}</Badge></td>
                  <td className="px-4 py-3">
                    {s.finalDecision ? (
                      <Badge variant={DECISION_VARIANT[s.finalDecision] || 'muted'}>{s.finalDecision}</Badge>
                    ) : (
                      <span className="text-text-muted">-</span>
                    )}
                  </td>
                  {canSchedule && (
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-text-muted hover:text-primary hover:bg-primary/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                          onClick={() => {
                            toast.promise(scheduleApi.downloadBulkScheduleReports({ ids: [s.id] }), {
                              loading: 'Preparing download...',
                              success: 'Report downloaded',
                              error: 'Download failed',
                            });
                          }}
                          title="Download Report"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-text-muted hover:text-danger hover:bg-danger/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete the schedule for "${s.candidate.fullName}"?`)) {
                              deleteMutation.mutate(s.id);
                            }
                          }}
                          title="Delete Schedule"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-text-muted mt-4">
          <span>
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={meta.page === 1} onClick={() => setPage(meta.page - 1)}>
              Previous
            </Button>
            {(() => {
              const total = meta.totalPages;
              const cur = meta.page;
              const WINDOW = 5;
              let start = Math.max(1, cur - Math.floor(WINDOW / 2));
              const end = Math.min(total, start + WINDOW - 1);
              start = Math.max(1, end - WINDOW + 1);
              const pages: (number | '…')[] = [];
              if (start > 1) { pages.push(1); if (start > 2) pages.push('…'); }
              for (let p = start; p <= end; p++) pages.push(p);
              if (end < total) { if (end < total - 1) pages.push('…'); pages.push(total); }
              return pages.map((p, i) =>
                p === '…' ? (
                  <span key={`e-${i}`} className="px-1 text-text-muted select-none">…</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === cur ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setPage(p as number)}
                  >
                    {p}
                  </Button>
                ),
              );
            })()}
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page === meta.totalPages}
              onClick={() => setPage(meta.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ScheduleDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
      <ScheduleDetailPanel open={!!activeId} onClose={() => setActiveId(null)} interviewId={activeId} />
    </div>
  );
}
