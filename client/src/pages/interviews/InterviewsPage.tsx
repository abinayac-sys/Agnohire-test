import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Plus, Search, Video, Trash2, Download } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { DateRangeFilter } from '../../components/common/DateRangeFilter.js';
import { LaunchInterviewDrawer } from './LaunchInterviewDrawer.js';
import { InterviewDetailPanel } from './InterviewDetailPanel.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS, SOCKET_EVENTS, type InterviewStatus, type Decision, type InterviewUpdatedEvent } from '@agnohire/shared';
import * as interviewApi from '../../services/interviewApi.js';
import { getSocket } from '../../services/socket.js';
import * as jobApi from '../../services/jobApi.js';
import { apiErrorMessage } from '../../services/api.js';

const STATUS_VARIANT: Record<InterviewStatus, 'muted' | 'info' | 'warning' | 'success' | 'danger'> = {
  SCHEDULED: 'muted',
  IN_PROGRESS: 'info',
  COMPLETED: 'info',
  EVALUATING: 'warning',
  EVALUATED: 'success',
  CANCELLED: 'danger',
  EXPIRED: 'danger',
};

const DECISION_VARIANT: Record<Decision, 'success' | 'danger' | 'warning'> = {
  PASS: 'success',
  FAIL: 'danger',
  HOLD: 'warning',
};

const STATUS_OPTIONS = [
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'EVALUATING', label: 'Evaluating' },
  { value: 'EVALUATED', label: 'Evaluated' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
];

const DECISION_OPTIONS = [
  { value: 'PASS', label: 'Pass' },
  { value: 'FAIL', label: 'Fail' },
  { value: 'HOLD', label: 'Hold' },
];

export function InterviewsPage() {
  const { hasPermission } = useAuthStore();
  const canSchedule = hasPermission(PERMISSIONS.INTERVIEW_SCHEDULE);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<InterviewStatus | ''>('');
  const [decision, setDecision] = useState<Decision | ''>('');
  const [jobRequisitionId, setJobRequisitionId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [launchOpen, setLaunchOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);

  const qc = useQueryClient();

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
    queryKey: ['interviews', search, status, decision, jobRequisitionId, fromDate, toDate, page],
    queryFn: () =>
      interviewApi.fetchInterviews({
        search: search || undefined,
        status: (status || undefined) as InterviewStatus | undefined,
        decision: (decision || undefined) as Decision | undefined,
        jobRequisitionId: jobRequisitionId || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        page,
        limit: 10,
      }),
  });

  const interviews = data?.items ?? [];
  const meta = data?.meta ?? { page: 1, pageSize: 10, total: 0, totalPages: 1 };

  // Live progress: a candidate starting/submitting or AI scoring completing
  // happens in the background, with nobody on this page taking any action —
  // without this, staff only ever see it after a manual refresh.
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (_evt: InterviewUpdatedEvent) => {
      qc.invalidateQueries({ queryKey: ['interviews'] });
    };
    socket.on(SOCKET_EVENTS.INTERVIEW_UPDATED, onUpdate);
    return () => {
      socket.off(SOCKET_EVENTS.INTERVIEW_UPDATED, onUpdate);
    };
  }, [qc]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => interviewApi.deleteInterview(id),
    onSuccess: () => {
      toast.success('Interview deleted successfully');
      setDeleteConfirmId(null);
      qc.invalidateQueries({ queryKey: ['interviews'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const handleDownloadReport = async (id: string, candidateName: string) => {
    setDownloadingId(id);
    try {
      await interviewApi.downloadInterviewReport(id, candidateName);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to download report');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadAllReports = async () => {
    setBulkDownloading(true);
    try {
      await interviewApi.downloadBulkInterviewReports(
        selectedIds.length > 0
          ? { ids: selectedIds }
          : { 
              search: search || undefined, 
              status: status || undefined,
              decision: decision || undefined,
              jobRequisitionId: jobRequisitionId || undefined,
              from: fromDate || undefined,
              to: toDate || undefined
            },
      );
    } catch (e) {
      toast.error((e as Error).message || 'Failed to download reports');
    } finally {
      setBulkDownloading(false);
    }
  };

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => interviewApi.deleteInterview(id)));
    },
    onSuccess: () => {
      toast.success('Interviews deleted successfully');
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['interviews'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  /** Reset page to 1 whenever any filter changes */
  function resetPage() {
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interviews"
        description="Launch AI interviews, share candidate links, and review results"
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <>
                <Button variant="danger" onClick={() => bulkDeleteMutation.mutate(selectedIds)} disabled={bulkDeleteMutation.isPending}>
                  Delete Selected ({selectedIds.length})
                </Button>
                <Button variant="outline" onClick={() => setSelectedIds([])}>
                  Cancel
                </Button>
              </>
            )}
            {interviews.length > 0 && (
              <Button variant="outline" onClick={handleDownloadAllReports} loading={bulkDownloading}>
                <Download className="h-4 w-4" />
                {selectedIds.length > 0 ? `Download Reports (${selectedIds.length})` : 'Download All Reports'}
              </Button>
            )}
            {canSchedule && (
              <Button onClick={() => setLaunchOpen(true)}>
                <Plus className="h-4 w-4" />
                Launch Interview
              </Button>
            )}
          </div>
        }
      />

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
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

        {/* Pass / Fail / Hold filter */}
        <Select
          className="w-36"
          options={DECISION_OPTIONS}
          placeholder="All decisions"
          value={decision}
          onChange={(e) => { setDecision(e.target.value as Decision); resetPage(); }}
        />

        {/* From date */}
        <DateRangeFilter
          from={fromDate}
          to={toDate}
          onChange={(f, t) => {
            setFromDate(f || '');
            setToDate(t || '');
            resetPage();
          }}
        />

        {/* Clear all filters */}
        {(search || status || decision || jobRequisitionId || fromDate || toDate) && (
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
        <div className="py-12 text-center">
          <Spinner className="mx-auto" />
        </div>
      ) : interviews.length === 0 ? (
        <EmptyState
          icon={<Video className="h-8 w-8" />}
          title="No interviews yet"
          description={canSchedule ? 'Launch an interview to generate a candidate link.' : 'No interviews to show.'}
          action={
            canSchedule ? (
              <Button onClick={() => setLaunchOpen(true)}>
                <Plus className="h-4 w-4" />
                Launch Interview
              </Button>
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
                    className="h-4 w-4 cursor-pointer rounded border-border accent-accent"
                    checked={interviews.length > 0 && selectedIds.length === interviews.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(interviews.map((i) => i.id));
                      else setSelectedIds([]);
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left">Candidate</th>
                <th className="px-4 py-3 text-left">Job Title</th>
                <th className="px-4 py-3 text-left">Question Bank</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Score</th>
                <th className="px-4 py-3 text-left">Decision</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {interviews.map((iv) => (
                <tr
                  key={iv.id}
                  onClick={() => setActiveId(iv.id)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-raised/50"
                >
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer rounded border-border accent-accent"
                      checked={selectedIds.includes(iv.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds([...selectedIds, iv.id]);
                        else setSelectedIds(selectedIds.filter((id) => id !== iv.id));
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary">{iv.candidate.fullName}</p>
                    <p className="text-xs text-text-muted">{iv.candidate.email}</p>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{iv.jobRequisition?.title ?? '—'}</td>
                  <td className="px-4 py-3 text-text-secondary">{iv.questionBank?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[iv.status]}>{iv.status.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {iv.result?.percentageScore != null
                      ? `${Math.round(iv.result.percentageScore)}%`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {iv.result?.decision ? (
                      <Badge variant={DECISION_VARIANT[iv.result.decision]}>{iv.result.decision}</Badge>
                    ) : iv.result?.aiDecision ? (
                      <Badge variant={DECISION_VARIANT[iv.result.aiDecision as Decision]} className="opacity-70">
                        AI: {iv.result.aiDecision}
                      </Badge>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted text-xs">
                    {format(new Date(iv.createdAt), 'dd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {iv.result?.percentageScore != null && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-text-muted hover:text-accent hover:bg-accent/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                          loading={downloadingId === iv.id}
                          onClick={() => handleDownloadReport(iv.id, iv.candidate.fullName)}
                          title="Download report"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      )}
                      {canSchedule && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-text-muted hover:text-danger hover:bg-danger/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete interview for "${iv.candidate.fullName}"?`)) {
                              deleteMutation.mutate(iv.id);
                            }
                          }}
                          title="Delete Interview"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
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

      <LaunchInterviewDrawer open={launchOpen} onClose={() => setLaunchOpen(false)} />
      <InterviewDetailPanel
        open={!!activeId}
        onClose={() => setActiveId(null)}
        interviewId={activeId}
      />

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-text-primary">Delete Interview</h3>
            <p className="mb-6 text-sm text-text-secondary">
              Are you sure you want to delete this interview record?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteConfirmId)}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
