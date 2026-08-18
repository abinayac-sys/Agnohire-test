import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Search, FileVideo, Mic, ShieldAlert, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { ReviewDetailPanel } from './ReviewDetailPanel.js';
import { RECOMMENDATION_LABEL, RECOMMENDATION_VARIANT } from './reviewMeta.js';
import type { InterviewType, Recommendation } from '@agnohire/shared';
import * as jobApi from '../../services/jobApi.js';
import * as reviewApi from '../../services/reviewApi.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { Button } from '../../components/ui/Button.js';
import { DateRangeFilter } from '../../components/common/DateRangeFilter.js';
import { apiErrorMessage } from '../../services/api.js';

const TYPE_OPTIONS = [
  { value: 'AI', label: 'AI' },
  { value: 'LIVE', label: 'Live' },
  { value: 'PANEL', label: 'Panel' },
];

export function ReviewsPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<InterviewType | ''>('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [jobRequisitionId, setJobRequisitionId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const canDecide = hasPermission(PERMISSIONS.INTERVIEW_DECIDE);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: jobsData } = useQuery({
    queryKey: ['jobs', { limit: 500 }],
    queryFn: () => jobApi.fetchJobs({ limit: 500 }),
    staleTime: 60_000,
  });
  const jobs = jobsData?.items ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['reviews', search, type, pendingOnly, jobRequisitionId, fromDate, toDate],
    queryFn: () =>
      reviewApi.fetchReviews({
        search: search || undefined,
        type: type || undefined,
        pendingOnly: pendingOnly || undefined,
        jobRequisitionId: jobRequisitionId || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        limit: 500,
      }),
  });
  const items = data?.items ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => reviewApi.deleteReview(id),
    onSuccess: () => {
      toast.success('Review deleted successfully');
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => reviewApi.deleteReview(id)));
    },
    onSuccess: () => {
      toast.success('Reviews deleted successfully');
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview Reviews"
        description="Transcript intelligence, proctoring integrity, and reviewer recommendations"
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <Input className="pl-9" placeholder="Search by candidate…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="w-48" options={jobs.map((j) => ({ value: j.id, label: j.title }))} placeholder="All Jobs" value={jobRequisitionId} onChange={(e) => setJobRequisitionId(e.target.value)} />
        <Select className="w-40" options={TYPE_OPTIONS} placeholder="All types" value={type} onChange={(e) => setType(e.target.value as InterviewType)} />
        <DateRangeFilter
          from={fromDate}
          to={toDate}
          onChange={(f, t) => {
            setFromDate(f || '');
            setToDate(t || '');
          }}
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} className="h-4 w-4 rounded border-border" />
          Pending review only
        </label>
        {(search || jobRequisitionId || type || fromDate || toDate || pendingOnly) && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setSearch('');
              setJobRequisitionId('');
              setType('');
              setFromDate('');
              setToDate('');
              setPendingOnly(false);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-16 text-center"><Spinner className="mx-auto" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={<FileVideo className="h-8 w-8" />} title="No interviews to review"
          description="Completed interviews with a transcript or recording appear here for intelligence analysis and review." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3 w-10 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={items.length > 0 && selectedIds.length === items.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(items.map(r => r.id));
                      else setSelectedIds([]);
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left">Candidate</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Media</th>
                <th className="px-4 py-3 text-left">Score</th>
                <th className="px-4 py-3 text-left">Decision</th>
                <th className="px-4 py-3 text-left">Integrity</th>
                <th className="px-4 py-3 text-left">Recommendation</th>
                <th className="px-4 py-3 text-left">Completed</th>
                {canDecide && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((r: any) => (
                <tr
                  key={r.id}
                  onClick={() => setActiveId(r.id)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-raised/50"
                >
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent cursor-pointer"
                      checked={selectedIds.includes(r.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds([...selectedIds, r.id]);
                        else setSelectedIds(selectedIds.filter(id => id !== r.id));
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary">{r.candidate.fullName}</p>
                    <p className="text-xs text-text-muted">{r.candidate.email}</p>
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline">{r.type}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-text-muted">
                      {r.hasTranscript && <Mic className="h-4 w-4 text-accent" aria-label="Has transcript" />}
                      {r.hasRecording && <FileVideo className="h-4 w-4 text-accent" aria-label="Has recording" />}
                      {!r.hasTranscript && !r.hasRecording && <span className="text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{r.percentageScore != null ? `${Math.round(r.percentageScore)}%` : '—'}</td>
                  <td className="px-4 py-3">
                    {r.decision 
                      ? <Badge variant={r.decision === 'PASS' ? 'success' : r.decision === 'FAIL' ? 'danger' : 'info'}>{r.decision}</Badge>
                      : <span className="text-text-muted">pending</span>}
                  </td>
                  <td className="px-4 py-3">
                    {r.violationCount > 0
                      ? <Badge variant="warning"><ShieldAlert className="mr-1 h-3 w-3" />{r.violationCount}</Badge>
                      : <Badge variant="success">clean</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    {r.recommendation
                      ? <Badge variant={RECOMMENDATION_VARIANT[r.recommendation as Recommendation]}>{RECOMMENDATION_LABEL[r.recommendation as Recommendation]}</Badge>
                      : <span className="text-text-muted">pending</span>}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{r.completedAt ? format(new Date(r.completedAt), 'dd MMM yyyy') : '—'}</td>
                  {canDecide && (
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-text-muted hover:text-danger hover:bg-danger/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                        onClick={() => {
                          if (window.confirm(`Are you sure you want to delete interview review for "${r.candidate.fullName}"?`)) {
                            deleteMutation.mutate(r.id);
                          }
                        }}
                        title="Delete Review"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReviewDetailPanel open={!!activeId} onClose={() => setActiveId(null)} reviewId={activeId} />


    </div>
  );
}
