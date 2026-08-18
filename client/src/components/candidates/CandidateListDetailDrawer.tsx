import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2, UserPlus, Briefcase, FileSpreadsheet } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Select } from '../ui/Select.js';
import { Spinner } from '../ui/Spinner.js';
import { Drawer } from '../ui/Drawer.js';
import { FitScoreBadge } from '../../pages/candidates/components/CandidateBadges.js';
import * as sourcingApi from '../../services/sourcingApi.js';
import * as refApi from '../../services/referenceApi.js';
import * as jobApi from '../../services/jobApi.js';
import * as candidateApi from '../../services/candidateApi.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { apiErrorMessage } from '../../services/api.js';

interface Props {
  listId: string | null;
  listName: string;
  onClose: () => void;
}

/**
 * A candidate list's full detail view: members, import errors, and the
 * actions that make a list actually reusable — assign it to a recruiter or a
 * job requisition, or drop in more candidates via CSV. Shared between
 * Sourcing's Lists tab and the candidate-import drawer's "recent imports" so
 * an imported batch is something you can act on, not just look at.
 */
export function CandidateListDetailDrawer({ listId, listName, onClose }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission(PERMISSIONS.SOURCING_MANAGE);
  const canAssign = hasPermission(PERMISSIONS.CANDIDATE_ASSIGN);
  const canAssignJob = hasPermission(PERMISSIONS.CANDIDATE_EDIT) || hasPermission(PERMISSIONS.CANDIDATE_ASSIGN) || hasPermission(PERMISSIONS.SOURCING_MANAGE);
  const [recruiterId, setRecruiterId] = useState('');
  const [jobId, setJobId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['list-members', listId],
    queryFn: () => sourcingApi.fetchListMembers(listId!),
    enabled: Boolean(listId),
  });
  const { data: listDetail } = useQuery({
    queryKey: ['candidate-list-detail', listId],
    queryFn: () => candidateApi.fetchCandidateList(listId!),
    enabled: Boolean(listId),
  });
  const { data: usersData } = useQuery({
    queryKey: ['ref-users'],
    queryFn: refApi.fetchUsers,
    enabled: Boolean(listId) && canAssign,
    staleTime: 120_000,
  });
  const { data: jobsData } = useQuery({
    queryKey: ['jobs', { status: 'OPEN', limit: 500 }],
    queryFn: () => jobApi.fetchJobs({ status: 'OPEN', limit: 500 }),
    enabled: Boolean(listId) && canAssignJob,
    staleTime: 60_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['list-members', listId] });
    qc.invalidateQueries({ queryKey: ['candidate-list-detail', listId] });
    qc.invalidateQueries({ queryKey: ['candidate-lists'] });
  }

  const removeMutation = useMutation({
    mutationFn: (candidateId: string) => sourcingApi.removeListItems(listId!, [candidateId]),
    onSuccess: () => { toast.success('Removed from list'); invalidate(); },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  const assignMutation = useMutation({
    mutationFn: () => sourcingApi.assignList(listId!, recruiterId),
    onSuccess: (r) => { toast.success(`Assigned ${r.assigned} candidate(s)`); setRecruiterId(''); invalidate(); qc.invalidateQueries({ queryKey: ['candidates'] }); },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  const assignJobMutation = useMutation({
    mutationFn: () => sourcingApi.assignJobToList(listId!, jobId),
    onSuccess: (r) => {
      toast.success(
        r.skipped > 0
          ? `Assigned ${r.applied} candidate(s) · ${r.skipped} already applied`
          : `Assigned ${r.applied} candidate(s) to the job`,
      );
      setJobId('');
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['passed-candidates'] });
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  const uploadCsvMutation = useMutation({
    mutationFn: (file: File) => candidateApi.uploadCsvToExistingList(listId!, file),
    onSuccess: () => {
      toast.success('CSV upload started. Candidates are importing in the background.');
      invalidate();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  const members = data?.members ?? [];
  const users = usersData?.users ?? [];
  const jobs = jobsData?.items ?? [];

  const errors = (listDetail?.list?.errorReport as any[]) || [];

  return (
    <Drawer open={Boolean(listId)} onClose={onClose} title={listName} subtitle={`${members.length} candidates`} size="lg">
      <div className="space-y-4">
        {canManage && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised p-3">
            <input
              type="file"
              accept=".csv"
              id="csv-file-input"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  uploadCsvMutation.mutate(file);
                  e.target.value = '';
                }
              }}
            />
            <label
              htmlFor="csv-file-input"
              className="flex-1 cursor-pointer rounded-md border border-dashed border-border bg-surface hover:bg-surface-raised transition-colors py-2 px-3 text-sm text-text-muted hover:text-text-primary text-center"
            >
              Click to select a CSV file to import candidates…
            </label>
            <Button
              size="sm"
              loading={uploadCsvMutation.isPending}
              onClick={() => document.getElementById('csv-file-input')?.click()}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Import CSV
            </Button>
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-lg border border-danger/25 bg-danger/5 p-4 space-y-2">
            <h4 className="text-sm font-semibold text-danger flex items-center gap-1.5">
              <span>Import Errors ({errors.length})</span>
            </h4>
            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 divide-y divide-border/20">
              {errors.map((err, idx) => (
                <div key={idx} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs text-text-secondary gap-3">
                  <div className="min-w-0">
                    <span className="font-medium text-text-primary">Row {err.row}: </span>
                    <span className="text-danger">{err.reason}</span>
                  </div>
                  {err.email && <span className="shrink-0 text-text-muted select-all">{err.email}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {canAssign && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised p-3">
            <Select
              className="flex-1"
              options={users.map((u) => ({ value: u.id, label: `${u.fullName} · ${u.role.displayName}` }))}
              placeholder="Assign whole list to recruiter…"
              value={recruiterId}
              onChange={(e) => setRecruiterId(e.target.value)}
            />
            <Button size="sm" disabled={!recruiterId || members.length === 0} loading={assignMutation.isPending} onClick={() => assignMutation.mutate()}>
              <UserPlus className="h-3.5 w-3.5" />
              Assign list
            </Button>
          </div>
        )}

        {canAssignJob && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised p-3">
            <Select
              className="flex-1"
              options={jobs.map((j) => ({ value: j.id, label: j.title }))}
              placeholder={jobs.length ? 'Assign whole list to a job requisition…' : 'No open job requisitions available'}
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            />
            <Button size="sm" disabled={!jobId || members.length === 0} loading={assignJobMutation.isPending} onClick={() => assignJobMutation.mutate()}>
              <Briefcase className="h-3.5 w-3.5" />
              Assign job requisition
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="py-12 text-center"><Spinner className="mx-auto" /></div>
        ) : members.length === 0 ? (
          <p className="rounded-md border border-dashed border-border py-8 text-center text-sm text-text-muted">
            No candidates in this list yet.
          </p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-md border border-border bg-surface p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{m.fullName}</p>
                  <p className="text-xs text-text-muted">{m.currentRole ?? m.email}</p>
                </div>
                <FitScoreBadge score={m.fitScore} />
                {canManage && (
                  <Button variant="ghost" size="icon" className="text-danger" onClick={() => removeMutation.mutate(m.id)} aria-label="Remove">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
