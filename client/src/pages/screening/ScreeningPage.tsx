import { Fragment, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Search, Sparkles, ChevronDown, ChevronUp, ArrowUpDown, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Badge } from '../../components/ui/Badge.js';
import { apiErrorMessage } from '../../services/api.js';
import {
  FitScoreBadge,
  ApplicationStatusBadge,
  RecommendationBadge,
} from '../candidates/components/CandidateBadges.js';
import * as candidateApi from '../../services/candidateApi.js';
import * as jobApi from '../../services/jobApi.js';
import type { ApplicationFilters } from '@agnohire/shared';
import { useAuthStore } from '../../store/authStore.js';
import { formatTitleCase, PERMISSIONS } from '@agnohire/shared';
import { cn } from '../../utils/cn.js';
import { DateRangeFilter } from '../../components/common/DateRangeFilter.js';

const STATUS_OPTIONS = [
  { value: 'APPLIED', label: 'Applied' },
  { value: 'SCREENING', label: 'Screening' },
  { value: 'ASSESSMENT', label: 'Assessment' },
  { value: 'INTERVIEW', label: 'Interview' },
  { value: 'SCHEDULE', label: 'Schedule' },
  { value: 'SUBMITTED_TO_HR', label: 'HR Approval' },
  { value: 'OFFER', label: 'Offer' },
  { value: 'ONBOARDING', label: 'Onboarding' },
  { value: 'HIRED', label: 'Hired' },
  { value: 'REJECTED', label: 'Rejected' },
];

const MIN_FIT_OPTIONS = [
  { value: '75', label: 'Fit ≥ 75%' },
  { value: '50', label: 'Fit ≥ 50%' },
  { value: '25', label: 'Fit ≥ 25%' },
];

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  loading,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-xl">
        <p className="text-sm text-text-secondary">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={loading} onClick={onConfirm} type="button">
            Delete
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ScreeningPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission(PERMISSIONS.CANDIDATE_EDIT);
  const [searchParams, setSearchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => candidateApi.deleteApplication(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['passed-candidates'] });
      toast.success('Application deleted');
      setDeleteTarget(null);
      setSelectedIds((prev) => prev.filter((id) => id !== deleteTarget));
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => candidateApi.deleteApplication(id)));
    },
    onSuccess: () => {
      toast.success('Applications deleted successfully');

      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['passed-candidates'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const filterVal = searchParams.get('statusOrStage') ?? '';
  let statusFilter: any = undefined;
  let stageFilter: string | undefined = undefined;
  if (filterVal.startsWith('status:')) {
    statusFilter = filterVal.replace('status:', '');
  } else if (filterVal.startsWith('stage:')) {
    stageFilter = filterVal.replace('stage:', '');
  } else if (filterVal) {
    statusFilter = filterVal;
  }

  const filters: Partial<ApplicationFilters> & { statusOrStage?: string } = {
    page: Number(searchParams.get('page') ?? 1),
    limit: 25,
    jobRequisitionId: searchParams.get('jobRequisitionId') ?? undefined,
    status: statusFilter,
    stage: stageFilter,
    statusOrStage: filterVal || undefined,
    search: searchParams.get('search') ?? undefined,
    minFitScore: searchParams.get('minFitScore')
      ? Number(searchParams.get('minFitScore'))
      : undefined,
    sortBy: (searchParams.get('sortBy') as ApplicationFilters['sortBy']) ?? 'fitScore',
    sortOrder: (searchParams.get('sortOrder') as ApplicationFilters['sortOrder']) ?? 'desc',
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  };

  const { data: jobDetailData } = useQuery({
    queryKey: ['job-detail', filters.jobRequisitionId],
    queryFn: () => jobApi.fetchJob(filters.jobRequisitionId!),
    enabled: !!filters.jobRequisitionId,
  });
  const selectedJob = jobDetailData?.job;

  const statusOptions = useMemo(() => {
    if (!selectedJob || !selectedJob.workflowRounds || selectedJob.workflowRounds.length === 0) {
      return STATUS_OPTIONS.map(opt => ({
        value: `status:${opt.value}`,
        label: opt.label
      }));
    }
    const roundsOptions = selectedJob.workflowRounds.map((r: any) => ({
      value: `stage:${formatTitleCase(r.roundName)}`,
      label: formatTitleCase(r.roundName),
    }));
    return [
      { value: 'status:APPLIED', label: 'Applied' },
      { value: 'status:SCREENING', label: 'Screening' },
      ...roundsOptions,
      { value: 'status:SUBMITTED_TO_HR', label: 'HR Approval' },
      { value: 'status:OFFER', label: 'Offer' },
      { value: 'status:ONBOARDING', label: 'Onboarding' },
      { value: 'status:HIRED', label: 'Hired' },
      { value: 'status:REJECTED', label: 'Rejected' },
    ];
  }, [selectedJob]);

  function setFilters(next: Partial<ApplicationFilters> & { statusOrStage?: string }) {
    const params = new URLSearchParams();
    const entries: Record<string, string | undefined> = {
      page: String(next.page ?? 1),
      jobRequisitionId: next.jobRequisitionId,
      statusOrStage: next.statusOrStage,
      search: next.search,
      minFitScore: next.minFitScore != null ? String(next.minFitScore) : undefined,
      sortBy: next.sortBy,
      sortOrder: next.sortOrder,
      from: next.from,
      to: next.to,
    };
    for (const [k, v] of Object.entries(entries)) if (v) params.set(k, v);
    setSearchParams(params, { replace: true });
  }

  const { data: listData, isLoading } = useQuery({
    queryKey: ['applications', filters],
    queryFn: () => candidateApi.fetchApplications(filters as any),
  });

  const { data: jobsData } = useQuery({
    queryKey: ['jobs', { limit: 500, sortBy: 'createdAt', sortOrder: 'desc' }],
    queryFn: () => jobApi.fetchJobs({ limit: 500, sortBy: 'createdAt', sortOrder: 'desc' }),
    staleTime: 60_000,
  });

  const scoreMutation = useMutation({
    mutationFn: (id: string) => candidateApi.scoreApplication(id, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Fit score updated');
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });



  const apps = (listData?.items ?? []) as any[];
  const meta = listData?.meta ?? { page: 1, pageSize: 25, total: 0, totalPages: 1 };
  const jobs = jobsData?.items ?? [];

  function sortByFit() {
    setFilters({
      ...filters,
      sortBy: 'fitScore',
      sortOrder: filters.sortBy === 'fitScore' && filters.sortOrder === 'desc' ? 'asc' : 'desc',
    });
  }
  const fitActive = filters.sortBy === 'fitScore';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Screening"
        description="Review applications ranked by AI fit score"
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
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <Input
            className="pl-9"
            placeholder="Search candidates…"
            value={filters.search ?? ''}
            onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined, page: 1 })}
          />
        </div>
        <Select
          className="w-56"
          options={jobs.map((j) => ({ value: j.id, label: j.title }))}
          placeholder="All jobs"
          value={filters.jobRequisitionId ?? ''}
          onChange={(e) =>
            setFilters({ ...filters, jobRequisitionId: e.target.value || undefined, page: 1, statusOrStage: undefined })
          }
        />
        <Select
          className="w-40"
          options={statusOptions}
          placeholder="All statuses"
          value={filters.statusOrStage ?? ''}
          onChange={(e) =>
            setFilters({
              ...filters,
              statusOrStage: e.target.value || undefined,
              page: 1,
            })
          }
        />
        <Select
          className="w-36"
          options={MIN_FIT_OPTIONS}
          placeholder="Any fit"
          value={filters.minFitScore != null ? String(filters.minFitScore) : ''}
          onChange={(e) =>
            setFilters({
              ...filters,
              minFitScore: e.target.value ? Number(e.target.value) : undefined,
              page: 1,
            })
          }
        />
        <DateRangeFilter
          from={filters.from}
          to={filters.to}
          onChange={(from, to) => setFilters({ ...filters, from, to, page: 1 })}
        />
        {(filters.search || filters.jobRequisitionId || filters.statusOrStage || filters.minFitScore !== undefined || filters.from || filters.to) && (
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              setFilters({
                page: 1,
                sortBy: filters.sortBy,
                sortOrder: filters.sortOrder,
              })
            }
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised">
                {canEdit && (
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={apps.length > 0 && selectedIds.length === apps.length}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = selectedIds.length > 0 && selectedIds.length < apps.length;
                        }
                      }}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(apps.map((a) => a.id));
                        } else {
                          setSelectedIds([]);
                        }
                      }}
                      className="rounded border-border accent-accent h-4 w-4"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Candidate
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Job
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Current Stage
                </th>
                <th className="px-4 py-3 text-center">
                  <button
                    className={cn(
                      'flex items-center gap-1 text-xs font-semibold uppercase tracking-wider mx-auto hover:text-text-primary transition-colors',
                      fitActive ? 'text-text-primary' : 'text-text-muted',
                    )}
                    onClick={sortByFit}
                  >
                    Fit
                    {fitActive ? (
                      filters.sortOrder === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="py-12 text-center">
                    <Spinner className="mx-auto" />
                  </td>
                </tr>
              )}
              {!isLoading && apps.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="py-12 text-center text-text-muted">
                    No applications match these filters.
                  </td>
                </tr>
              )}
              {!isLoading &&
                apps.map((a) => {
                  const fit = a.fitScoreData;
                  const isOpen = expanded === a.id;
                  return (
                    <Fragment key={a.id}>
                      <tr
                        className="border-b border-border last:border-0 hover:bg-surface-raised/50 transition-colors"
                      >
                        {canEdit && (
                          <td className="px-4 py-3 w-10">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(a.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                    setSelectedIds([...selectedIds, a.id]);
                                } else {
                                  setSelectedIds(selectedIds.filter((id) => id !== a.id));
                                }
                              }}
                              className="rounded border-border accent-accent h-4 w-4"
                            />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <p className="font-medium text-text-primary">{a.candidate.fullName}</p>
                          <p className="text-xs text-text-muted">{a.candidate.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-text-secondary">{a.job.title}</p>
                          <div className="flex flex-col gap-0.5 text-xs text-text-muted">
                            <span>{a.job.domain.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const status = a.status;
                            const workflowRounds = a.job?.workflowRounds ?? [];
                            
                            if (status === 'REJECTED' || a.workflowStatus === 'FAILED') {
                              const failedNum = a.failedRound ?? a.currentRound;
                              const r = workflowRounds.find((r: any) => r.roundNumber === failedNum);
                              const stageLabel = r ? r.roundName : `Failed at Round ${failedNum}`;
                              return <Badge variant="danger">{stageLabel}</Badge>;
                            }

                            const isStatic = ['SOURCED', 'APPLIED', 'SCREENING', 'SUBMITTED_TO_HR', 'OFFER', 'ONBOARDING', 'HIRED', 'REJECTED'].includes(status);
                            if (!isStatic) {
                              const r = workflowRounds.find((r: any) => r.roundNumber === a.currentRound);
                              const stageLabel = r ? r.roundName : (a.stage ?? 'Applied');
                              return <Badge variant="info">{stageLabel}</Badge>;
                            }

                            return <ApplicationStatusBadge status={status} />;
                          })()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            className="inline-flex items-center gap-1"
                            onClick={() => fit && setExpanded(isOpen ? null : a.id)}
                          >
                            <FitScoreBadge score={a.fitScore} />
                            {fit &&
                              (isOpen ? (
                                <ChevronUp className="h-3 w-3 text-text-muted" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-text-muted" />
                              ))}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {canEdit && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  loading={scoreMutation.isPending && scoreMutation.variables === a.id}
                                  onClick={() => scoreMutation.mutate(a.id)}
                                >
                                  <Sparkles className="h-3.5 w-3.5" />
                                  {a.fitScore == null ? 'Score' : 'Re-score'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-text-muted hover:text-danger hover:bg-danger/10 h-8 w-8 p-0 flex items-center justify-center"
                                  onClick={() => setDeleteTarget(a.id)}
                                  title="Delete Application"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && fit && (
                        <tr className="border-b border-border bg-surface-raised/30">
                          <td colSpan={canEdit ? 6 : 5} className="px-4 py-3">
                            <div className="space-y-2 text-sm">
                              <div className="flex items-center gap-2">
                                <RecommendationBadge recommendation={fit.recommendation} />
                                <span className="text-xs text-text-muted">
                                  Skill {fit.skillMatch}% · Experience {fit.experienceMatch}%
                                </span>
                              </div>
                              {fit.summary && <p className="text-text-secondary">{fit.summary}</p>}
                              <div className="grid grid-cols-2 gap-4">
                                {fit.matchedSkills.length > 0 && (
                                  <p className="text-xs">
                                    <span className="font-medium text-success">Matched: </span>
                                    <span className="text-text-secondary">
                                      {fit.matchedSkills.join(', ')}
                                    </span>
                                  </p>
                                )}
                                {fit.missingSkills.length > 0 && (
                                  <p className="text-xs">
                                    <span className="font-medium text-danger">Missing: </span>
                                    <span className="text-text-secondary">
                                      {fit.missingSkills.join(', ')}
                                    </span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-text-muted">
          <span>
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page === 1}
              onClick={() => setFilters({ ...filters, page: meta.page - 1 })}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page === meta.totalPages}
              onClick={() => setFilters({ ...filters, page: meta.page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          message="Delete this application? This cannot be undone."
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}


    </div>
  );
}
