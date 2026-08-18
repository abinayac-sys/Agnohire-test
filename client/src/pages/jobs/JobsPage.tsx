import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Briefcase, CheckCircle2, Clock, XCircle, Layers } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { PageHeader } from '../../components/common/PageHeader.js';
import { PlanLimitNotice } from '../../components/common/PlanLimitNotice.js';
import { usePlanUsage } from '../../hooks/usePlanUsage.js';
import { StatCard } from '../../components/common/StatCard.js';
import { JobFiltersBar } from './components/JobFilters.js';
import { JobTable } from './components/JobTable.js';
import { JobDrawer } from './JobDrawer.js';
import { JobDetailPanel } from './JobDetailPanel.js';
import { JobTemplatesDrawer } from './JobTemplatesDrawer.js';
import * as jobApi from '../../services/jobApi.js';
import * as refApi from '../../services/referenceApi.js';
import type { JobListItem, JobFilters } from '@agnohire/shared';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { apiErrorMessage } from '../../services/api.js';

// ─── Confirmation dialog ──────────────────────────────────────────────────────

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  loading,
  confirmLabel = 'Confirm',
  variant = 'danger',
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-xl">
        <p className="text-sm text-text-secondary">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="sm"
            loading={loading}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function JobsPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const { isReached } = usePlanUsage();
  const activeJobsFull = isReached('ACTIVE_JOBS');
  const [searchParams, setSearchParams] = useSearchParams();

  // Persist filters in URL
  const filters: Partial<JobFilters> = {
    page: Number(searchParams.get('page') ?? 1),
    limit: 25,
    search: searchParams.get('search') ?? undefined,
    status: (searchParams.get('status') as JobFilters['status']) ?? undefined,
    domainId: searchParams.get('domainId') ?? undefined,
    sectorId: searchParams.get('sectorId') ?? undefined,
    workMode: (searchParams.get('workMode') as JobFilters['workMode']) ?? undefined,
    sortBy: (searchParams.get('sortBy') as JobFilters['sortBy']) ?? 'createdAt',
    sortOrder: (searchParams.get('sortOrder') as JobFilters['sortOrder']) ?? 'desc',
  };

  function setFilters(next: Partial<JobFilters>) {
    const params = new URLSearchParams();
    const entries: Record<string, string | undefined> = {
      page: String(next.page ?? 1),
      search: next.search,
      status: next.status,
      domainId: next.domainId,
      sectorId: next.sectorId,
      workMode: next.workMode,
      sortBy: next.sortBy,
      sortOrder: next.sortOrder,
    };
    for (const [k, v] of Object.entries(entries)) {
      if (v) params.set(k, v);
    }
    setSearchParams(params, { replace: true });
  }

  // Drawer / panel state
  const [createOpen, setCreateOpen] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobListItem | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Data
  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => jobApi.fetchJobs(filters),
  });

  const { data: sectorsData } = useQuery({
    queryKey: ['sectors'],
    queryFn: refApi.fetchSectors,
    staleTime: 120_000,
  });

  const { data: domainsData } = useQuery({
    queryKey: ['domains', filters.sectorId],
    queryFn: () => refApi.fetchDomains(filters.sectorId),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => jobApi.deleteJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['jobs-stats'] });
      toast.success('Job deleted');
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const jobs = jobsData?.items ?? [];
  const meta = jobsData?.meta ?? { page: 1, pageSize: 25, total: 0, totalPages: 1 };
  const sectors = sectorsData?.sectors ?? [];
  const domains = domainsData?.domains ?? [];

  const { data: statsData } = useQuery({
    queryKey: ['jobs-stats'],
    queryFn: () => jobApi.fetchJobStats(),
    staleTime: 30_000,
  });

  // Handlers
  const handleView = useCallback((job: JobListItem) => {
    setDetailJobId(job.id);
  }, []);

  const handleEdit = useCallback((job: JobListItem) => {
    setEditJobId(job.id);
    setDetailJobId(null);
  }, []);

  // Fetch the job detail for the edit drawer
  const { data: editJobData } = useQuery({
    queryKey: ['job', editJobId],
    queryFn: () => jobApi.fetchJob(editJobId!),
    enabled: Boolean(editJobId),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Job Requisitions"
        description="Manage open positions across your organization"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
              <Layers className="h-4 w-4" />
              Templates
            </Button>
            {hasPermission(PERMISSIONS.JOB_CREATE) && (
              <span title={activeJobsFull ? 'Plan limit reached — upgrade to open more active jobs' : undefined}>
                <Button onClick={() => setCreateOpen(true)} disabled={activeJobsFull}>
                  <Plus className="h-4 w-4" />
                  Create Job
                </Button>
              </span>
            )}
          </div>
        }
      />

      <PlanLimitNotice metric="ACTIVE_JOBS" />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total Jobs"
          value={statsData?.stats.total ?? '—'}
          icon={Briefcase}
        />
        <StatCard
          label="Open"
          value={statsData?.stats.open ?? '—'}
          icon={CheckCircle2}
        />
        <StatCard
          label="Pending Approval"
          value={statsData?.stats.pending ?? '—'}
          icon={Clock}
        />
        <StatCard
          label="Closed"
          value={statsData?.stats.closed ?? '—'}
          icon={XCircle}
        />
      </div>

      {/* Filters */}
      <JobFiltersBar
        filters={filters}
        onChange={setFilters}
        sectors={sectors}
        domains={domains}
      />

      {/* Table */}
      <JobTable
        items={jobs}
        meta={meta}
        loading={jobsLoading}
        filters={filters}
        onFilterChange={setFilters}
        onView={handleView}
        onEdit={handleEdit}
        onSubmit={(job) => {
          setDetailJobId(job.id);
        }}
        onApprove={(job) => {
          setDetailJobId(job.id);
        }}
        onReject={(job) => {
          setDetailJobId(job.id);
        }}
        onClose={(job) => {
          setDetailJobId(job.id);
        }}
        onReopen={(job) => {
          setDetailJobId(job.id);
        }}
        onDelete={(job) => setDeleteTarget(job)}
        onDownload={async (job) => {
          try {
            await jobApi.downloadJobPdf(job.id);
            toast.success('Downloaded job PDF');
          } catch (e: any) {
            toast.error(apiErrorMessage(e, 'Failed to download PDF'));
          }
        }}
      />

      {/* Create drawer */}
      <JobDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      {/* Edit drawer */}
      <JobDrawer
        open={Boolean(editJobId)}
        onClose={() => setEditJobId(null)}
        job={editJobData?.job ?? null}
      />

      {/* Templates management */}
      <JobTemplatesDrawer
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
      />

      {/* Detail panel */}
      <JobDetailPanel
        jobId={detailJobId}
        onClose={() => setDetailJobId(null)}
        onEdit={() => {
          if (detailJobId) {
            setEditJobId(detailJobId);
            setDetailJobId(null);
          }
        }}
      />

      {/* Delete confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          message={`Delete "${deleteTarget.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
