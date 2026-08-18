import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Plus, Gift, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import * as sourcingApi from '../../services/sourcingApi.js';
import * as candidateApi from '../../services/candidateApi.js';
import * as jobApi from '../../services/jobApi.js';

import * as referenceApi from '../../services/referenceApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { lazy, Suspense } from 'react';

const CandidateDrawer = lazy(() =>
  import('../candidates/CandidateDrawer.js').then((m) => ({ default: m.CandidateDrawer })),
);

const CandidateDetailPanel = lazy(() =>
  import('../candidates/CandidateDetailPanel.js').then((m) => ({ default: m.CandidateDetailPanel })),
);

function NewReferralDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedCandidates, setSelectedCandidates] = useState<Map<string, { id: string; fullName: string; email: string }>>(new Map());
  const [jobId, setJobId] = useState('');
  const [recruiterId, setRecruiterId] = useState('');
  const [isOpenDropdown, setIsOpenDropdown] = useState(false);
  const [candidateDrawerOpen, setCandidateDrawerOpen] = useState(false);

  const { data: candData } = useQuery({
    queryKey: ['candidates', { search, limit: 20 }],
    queryFn: () => candidateApi.fetchCandidates({ search: search || undefined, limit: 20 }),
    enabled: open,
  });
  const { data: jobsData } = useQuery({
    queryKey: ['jobs', { limit: 500 }],
    queryFn: () => jobApi.fetchJobs({ limit: 500 }),
    enabled: open,
    staleTime: 60_000,
  });
  const { data: usersData } = useQuery({
    queryKey: ['ref-users'],
    queryFn: referenceApi.fetchUsers,
    enabled: open,
    staleTime: 120_000,
  });

  useEffect(() => {
    const handleOutsideClick = () => {
      if (isOpenDropdown) {
        setIsOpenDropdown(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [isOpenDropdown]);

  function toggleCandidate(c: { id: string; fullName: string; email: string }) {
    setSelectedCandidates((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) {
        next.delete(c.id);
      } else {
        next.set(c.id, c);
      }
      return next;
    });
  }

  const candidates = candData?.items ?? [];
  const jobs = jobsData?.items ?? [];

  const allSelected = candidates.length > 0 && candidates.every((c) => selectedCandidates.has(c.id));

  const handleSelectAll = () => {
    setSelectedCandidates((prev) => {
      const next = new Map(prev);
      if (allSelected) {
        for (const c of candidates) {
          next.delete(c.id);
        }
      } else {
        for (const c of candidates) {
          next.set(c.id, { id: c.id, fullName: c.fullName, email: c.email });
        }
      }
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const promises = Array.from(selectedCandidates.keys()).map(async (id) => {
        const res = await sourcingApi.createReferral({
          candidateId: id,
          jobId: jobId || null,
        });
        if (recruiterId) {
          await candidateApi.assignCandidate(id, recruiterId);
        }
        return res;
      });
      return Promise.all(promises);
    },
    onSuccess: () => {
      toast.success('Referral(s) created');
      qc.invalidateQueries({ queryKey: ['referrals'] });
      onClose();
      setSelectedCandidates(new Map());
      setJobId('');
      setSearch('');
      setRecruiterId('');
      setIsOpenDropdown(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not create referral(s)')),
  });

  const selectedNamesText = Array.from(selectedCandidates.values()).map(c => c.fullName).join(', ');

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="New Referral"
        subtitle="Refer an existing candidate"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={selectedCandidates.size === 0 || !jobId} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
              Submit referral
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1 text-sm font-medium text-text-primary">
                For job <span className="text-danger">*</span>
              </label>
              <button
                type="button"
                className="text-xs font-medium text-accent hover:underline"
                onClick={() => setCandidateDrawerOpen(true)}
              >
                + Create new candidate
              </button>
            </div>
            <Select
              options={jobs.map((j) => ({ value: j.id, label: j.title }))}
              placeholder="Select a job..."
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            />
          </div>

          <div className="space-y-1.5 relative" onClick={(e) => e.stopPropagation()}>
            <label className="text-sm font-medium text-text-primary">Find candidate <span className="text-danger">*</span></label>
            <Input 
              placeholder="Search by name or email…" 
              value={isOpenDropdown ? search : (selectedCandidates.size > 0 ? selectedNamesText : '')} 
              onChange={(e) => {
                setSearch(e.target.value);
                setIsOpenDropdown(true);
              }}
              onFocus={() => setIsOpenDropdown(true)}
            />
            <div className="flex items-center justify-between mt-1 px-1">
              <span className="text-xs text-text-muted font-medium">
                Selected ({selectedCandidates.size} candidates)
              </span>
              {candidates.length > 0 && (
                <button
                  type="button"
                  className="text-xs font-medium text-accent hover:underline"
                  onClick={handleSelectAll}
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
              )}
            </div>
            {isOpenDropdown && (
              <div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-surface shadow-lg p-2">
                {candidates.length === 0 ? (
                  <div className="px-3 py-2.5 text-sm text-text-muted">No matches found</div>
                ) : (
                  <ul className="space-y-1">
                    {candidates.map((c) => (
                      <li key={c.id}>
                        <label className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-surface-raised">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                            checked={selectedCandidates.has(c.id)}
                            onChange={() => toggleCandidate({ id: c.id, fullName: c.fullName, email: c.email })}
                          />
                          <span className="min-w-0">
                            <span className="font-semibold text-text-primary block">{c.fullName}</span>
                            <span className="text-xs text-text-muted block">{c.email}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Source</label>
            <Input value="Referral" readOnly className="bg-surface-raised text-text-primary cursor-not-allowed" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Assign Recruiter (optional)</label>
            <Select
              options={(usersData?.users ?? []).map((u) => ({ value: u.id, label: `${u.fullName} (${u.role.displayName})` }))}
              placeholder="Select a recruiter…"
              value={recruiterId}
              onChange={(e) => setRecruiterId(e.target.value)}
            />
          </div>
        </div>
      </Drawer>

      {candidateDrawerOpen && (
        <Suspense fallback={null}>
          <CandidateDrawer
            open={candidateDrawerOpen}
            onClose={() => setCandidateDrawerOpen(false)}
            mode="referral"
            defaultJobRequisitionId={jobId}
            onSuccess={(res) => {
              const newCand = res?.candidate || res;
              if (!newCand) return;
              setSelectedCandidates((prev) => {
                const next = new Map(prev);
                next.set(newCand.id, {
                  id: newCand.id,
                  fullName: newCand.fullName,
                  email: newCand.email,
                });
                return next;
              });
              if (newCand.jobApplied?.id) {
                setJobId(newCand.jobApplied.id);
              }
            }}
          />
        </Suspense>
      )}
    </>
  );
}

export function ReferralsTab() {
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: editData } = useQuery({
    queryKey: ['candidate', editId],
    queryFn: () => candidateApi.fetchCandidate(editId!),
    enabled: Boolean(editId),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['referrals'],
    queryFn: () => sourcingApi.fetchReferrals({ limit: 50 }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => sourcingApi.deleteReferral(id)));
    },
    onSuccess: () => {
      toast.success('Referral(s) deleted');
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['referrals'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not delete referral(s)')),
  });

  const referrals = data?.items ?? [];



  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <Button
                variant="danger"
                onClick={() => deleteMutation.mutate(selectedIds)}
                disabled={deleteMutation.isPending}
              >
                Delete Selected ({selectedIds.length})
              </Button>
              <Button variant="outline" onClick={() => setSelectedIds([])}>
                Cancel
              </Button>
            </>
          )}
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus className="h-4 w-4" />
            New Referral
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><Spinner className="mx-auto" /></div>
      ) : referrals.length === 0 ? (
        <EmptyState icon={<Gift className="h-8 w-8" />} title="No referrals yet" description="Refer a candidate to get started." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent cursor-pointer rounded"
                    checked={referrals.length > 0 && selectedIds.length === referrals.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(referrals.map((r) => r.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left">Candidate</th>
                <th className="px-4 py-3 text-left">Job</th>
                <th className="px-4 py-3 text-left">Referrer</th>
                <th className="px-4 py-3 text-left">Referred</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-0 hover:bg-surface-raised/50 cursor-pointer group"
                  onClick={() => r.candidate?.id && setDetailId(r.candidate.id)}
                >
                  <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent cursor-pointer rounded"
                      checked={selectedIds.includes(r.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds((prev) => [...prev, r.id]);
                        } else {
                          setSelectedIds((prev) => prev.filter((id) => id !== r.id));
                        }
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary group-hover:text-accent transition-colors">{r.candidate?.fullName ?? '—'}</p>
                    <p className="text-xs text-text-muted">{r.candidate?.email}</p>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{r.job?.title ?? '—'}</td>
                  <td className="px-4 py-3 text-text-secondary">{r.referrer?.fullName ?? '—'}</td>
                  <td className="px-4 py-3 text-text-muted">{format(new Date(r.createdAt), 'dd MMM yyyy')}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-text-muted hover:text-danger hover:bg-danger/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to delete this referral?`)) {
                          deleteMutation.mutate([r.id]);
                        }
                      }}
                      title="Delete Referral"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewReferralDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {detailId && (
        <Suspense fallback={null}>
          <CandidateDetailPanel
            candidateId={detailId}
            onClose={() => setDetailId(null)}
            onEdit={() => {
              setEditId(detailId);
              setDetailId(null);
            }}
          />
        </Suspense>
      )}

      {editId && (
        <Suspense fallback={null}>
          <CandidateDrawer
            open={Boolean(editId)}
            onClose={() => setEditId(null)}
            candidate={editData?.candidate ?? null}
          />
        </Suspense>
      )}
    </div>
  );
}
