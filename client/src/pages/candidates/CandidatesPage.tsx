import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Users, FileText, Sparkles, UserPlus, UploadCloud } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { ExportDropdown } from '../../components/ui/ExportDropdown.js';
import { PageHeader } from '../../components/common/PageHeader.js';
import { PlanLimitNotice } from '../../components/common/PlanLimitNotice.js';
import { usePlanUsage } from '../../hooks/usePlanUsage.js';
import { StatCard } from '../../components/common/StatCard.js';
import { CandidateFiltersBar } from './components/CandidateFilters.js';
import { CandidateTable } from './components/CandidateTable.js';
import { CandidateDrawer } from './CandidateDrawer.js';
import { CandidateDetailPanel } from './CandidateDetailPanel.js';
import { BulkUploadDrawer } from './BulkUploadDrawer.js';
import * as candidateApi from '../../services/candidateApi.js';
import * as refApi from '../../services/referenceApi.js';
import * as jobApi from '../../services/jobApi.js';
import type { CandidateListItem, CandidateFilters } from '@agnohire/shared';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { apiErrorMessage } from '../../services/api.js';

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

export function CandidatesPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const { isBlocked } = usePlanUsage();
  const candidatesFull = isBlocked('CANDIDATES');
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: Partial<CandidateFilters> = {
    page: Number(searchParams.get('page') ?? 1),
    limit: 25,
    search: searchParams.get('search') ?? undefined,
    sectorId: searchParams.get('sectorId') ?? undefined,
    domainId: searchParams.get('domainId') ?? undefined,
    jobRequisitionId: searchParams.get('jobRequisitionId') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    source: (searchParams.get('source') as CandidateFilters['source']) ?? undefined,
    experienceLevel:
      (searchParams.get('experienceLevel') as CandidateFilters['experienceLevel']) ?? undefined,
    hasResume:
      searchParams.get('hasResume') === null
        ? undefined
        : searchParams.get('hasResume') === 'true',
    sortBy: (searchParams.get('sortBy') as CandidateFilters['sortBy']) ?? 'createdAt',
    sortOrder: (searchParams.get('sortOrder') as CandidateFilters['sortOrder']) ?? 'desc',
  };

  function setFilters(next: Partial<CandidateFilters>) {
    const params = new URLSearchParams();
    const entries: Record<string, string | undefined> = {
      page: String(next.page ?? 1),
      search: next.search,
      sectorId: next.sectorId,
      domainId: next.domainId,
      jobRequisitionId: next.jobRequisitionId,
      from: next.from,
      to: next.to,
      source: next.source,
      experienceLevel: next.experienceLevel,
      hasResume: next.hasResume === undefined ? undefined : String(next.hasResume),
      sortBy: next.sortBy,
      sortOrder: next.sortOrder,
    };
    for (const [k, v] of Object.entries(entries)) if (v) params.set(k, v);
    setSearchParams(params, { replace: true });
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CandidateListItem | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionMode = selectedIds.length > 0;

  const { data: listData, isLoading } = useQuery({
    queryKey: ['candidates', filters],
    queryFn: () => candidateApi.fetchCandidates(filters),
  });

  const { data: statsData } = useQuery({
    queryKey: ['candidate-stats', filters.jobRequisitionId],
    queryFn: () => candidateApi.fetchCandidateStats({ jobRequisitionId: filters.jobRequisitionId }),
    staleTime: 30_000,
  });

  const { data: sectorsData } = useQuery({
    queryKey: ['sectors'],
    queryFn: () => refApi.fetchSectors(),
    staleTime: 60_000,
  });

  const { data: domainsData } = useQuery({
    queryKey: ['domains'],
    queryFn: () => refApi.fetchDomains(),
    staleTime: 60_000,
  });

  const { data: jobsData } = useQuery({
    queryKey: ['jobs', { limit: 100 }],
    queryFn: () => jobApi.fetchJobs({ limit: 100 }),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => candidateApi.deleteCandidate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['candidate-stats'] });
      toast.success('Candidate deleted');
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => candidateApi.deleteCandidate(id)));
    },
    onSuccess: () => {
      toast.success('Candidates deleted successfully');
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['candidate-stats'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const candidates = listData?.items ?? [];
  const meta = listData?.meta ?? { page: 1, pageSize: 25, total: 0, totalPages: 1 };

  const { data: editData } = useQuery({
    queryKey: ['candidate', editId],
    queryFn: () => candidateApi.fetchCandidate(editId!),
    enabled: Boolean(editId),
  });

  const handleView = useCallback((c: CandidateListItem) => setDetailId(c.id), []);
  const handleEdit = useCallback((c: CandidateListItem) => {
    setEditId(c.id);
    setDetailId(null);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates"
        description="Manage your talent pool, resumes, and applications"
        actions={
          <div className="flex items-center gap-2">
            {selectionMode && selectedIds.length > 0 && (
              <Button variant="danger" onClick={() => bulkDeleteMutation.mutate(selectedIds)} disabled={bulkDeleteMutation.isPending}>
                Delete Selected ({selectedIds.length})
              </Button>
            )}
            {selectionMode && (
              <Button variant="outline" onClick={() => setSelectedIds([])}>
                Cancel
              </Button>
            )}
            {!selectionMode && (
              <>
                <ExportDropdown
                  variant="outline"
                  loadingCsv={exportingCsv}
                  loadingPdf={exportingPdf}
                  onExportCsv={async () => {
                    setExportingCsv(true);
                    try {
                      await candidateApi.exportCandidatesCsv(filters);
                      toast.success('CSV exported successfully');
                    } catch (e: any) {
                      toast.error(apiErrorMessage(e, 'Failed to export CSV'));
                    } finally {
                      setExportingCsv(false);
                    }
                  }}
                  onExportPdf={async () => {
                    setExportingPdf(true);
                    try {
                      await candidateApi.exportCandidatesPdf(filters);
                      toast.success('PDF exported successfully');
                    } catch (e: any) {
                      toast.error(apiErrorMessage(e, 'Failed to export PDF'));
                    } finally {
                      setExportingPdf(false);
                    }
                  }}
                />
                {hasPermission(PERMISSIONS.CANDIDATE_UPLOAD) && (
                  <Button variant="outline" onClick={() => setBulkOpen(true)}>
                    <UploadCloud className="h-4 w-4" />
                    Bulk Import
                  </Button>
                )}
                {hasPermission(PERMISSIONS.CANDIDATE_CREATE) && (
                  <span title={candidatesFull ? 'Plan limit reached — upgrade to add more candidates' : undefined}>
                    <Button onClick={() => setCreateOpen(true)} disabled={candidatesFull}>
                      <Plus className="h-4 w-4" />
                      Add Candidate
                    </Button>
                  </span>
                )}
              </>
            )}
          </div>
        }
      />

      <PlanLimitNotice metric="CANDIDATES" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Candidates" value={statsData?.stats.total ?? '—'} icon={Users} />
        <StatCard label="With Resume" value={statsData?.stats.withResume ?? '—'} icon={FileText} />
        <StatCard label="Fit Scored" value={statsData?.stats.scored ?? '—'} icon={Sparkles} />
        <StatCard label="New This Week" value={statsData?.stats.newThisWeek ?? '—'} icon={UserPlus} />
      </div>

      <CandidateFiltersBar
        filters={filters}
        onChange={setFilters}
        sectors={sectorsData?.sectors ?? []}
        domains={domainsData?.domains ?? []}
        jobs={jobsData?.items ?? []}
      />

      <CandidateTable
        items={candidates}
        meta={meta}
        loading={isLoading}
        filters={filters}
        onFilterChange={setFilters}
        onView={handleView}
        onEdit={handleEdit}
        onDelete={(c) => setDeleteTarget(c)}
        selectedIds={selectedIds}
        onSelect={(ids) => setSelectedIds(ids)}
      />

      <CandidateDrawer open={createOpen} onClose={() => setCreateOpen(false)} />

      <BulkUploadDrawer open={bulkOpen} onClose={() => setBulkOpen(false)} />

      <CandidateDrawer
        open={Boolean(editId)}
        onClose={() => setEditId(null)}
        candidate={editData?.candidate ?? null}
      />

      <CandidateDetailPanel
        candidateId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={() => {
          if (detailId) {
            setEditId(detailId);
            setDetailId(null);
          }
        }}
      />

      {deleteTarget && (
        <ConfirmDialog
          message={`Delete "${deleteTarget.fullName}"? This cannot be undone.`}
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}


    </div>
  );
}
