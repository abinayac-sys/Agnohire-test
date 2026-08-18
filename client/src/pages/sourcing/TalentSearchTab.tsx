import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Search, Plus, Trash2 } from 'lucide-react';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Button } from '../../components/ui/Button.js';
import { TagInput } from '../../components/ui/TagInput.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { ExperienceBadge, FitScoreBadge } from '../candidates/components/CandidateBadges.js';
import * as sourcingApi from '../../services/sourcingApi.js';
import * as candidateApi from '../../services/candidateApi.js';
import * as jobApi from '../../services/jobApi.js';
import type { TalentSearchParams } from '../../services/sourcingApi.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { usePrompt } from '../../providers/ConfirmProvider.js';
import { apiErrorMessage } from '../../services/api.js';

const EXPERIENCE = [
  { value: 'ENTRY', label: 'Entry' },
  { value: 'JUNIOR', label: 'Junior' },
  { value: 'MID', label: 'Mid' },
  { value: 'SENIOR', label: 'Senior' },
  { value: 'LEAD', label: 'Lead' },
  { value: 'PRINCIPAL', label: 'Principal' },
];

export function TalentSearchTab() {
  const qc = useQueryClient();
  const prompt = usePrompt();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission(PERMISSIONS.SOURCING_MANAGE);

  const [params, setParams] = useState<TalentSearchParams>({ page: 1, limit: 25, sortBy: 'fitScore', sortOrder: 'desc' });
  const [skillsAll, setSkillsAll] = useState<string[]>([]);
  const [skillsAny, setSkillsAny] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetList, setTargetList] = useState('');

  const query = { ...params, skillsAll, skillsAny };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['talent-search', query],
    queryFn: () => sourcingApi.searchCandidates(query),
  });

  const { data: listsData } = useQuery({
    queryKey: ['candidate-lists'],
    queryFn: sourcingApi.fetchLists,
    enabled: canManage,
    staleTime: 30_000,
  });

  const { data: jobsData } = useQuery({
    queryKey: ['jobs', { limit: 500 }],
    queryFn: () => jobApi.fetchJobs({ limit: 500 }),
    staleTime: 60_000,
  });
  const jobs = jobsData?.items ?? [];

  const addMutation = useMutation({
    mutationFn: (listId: string) => sourcingApi.addListItems(listId, [...selected]),
    onSuccess: ({ list }) => {
      toast.success(`Added ${selected.size} to “${list.name}”`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['candidate-lists'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const createListMutation = useMutation({
    mutationFn: (name: string) => sourcingApi.createCuratedList(name),
    onSuccess: ({ list }) => {
      toast.success(`List “${list.name}” created`);
      setTargetList(list.id);
      qc.invalidateQueries({ queryKey: ['candidate-lists'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => candidateApi.deleteCandidate(id)));
    },
    onSuccess: () => {
      toast.success('Candidates deleted successfully');
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['talent-search'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const items = data?.items ?? [];
  const meta = data?.meta ?? { page: 1, pageSize: 25, total: 0, totalPages: 1 };
  const lists = listsData?.items ?? [];

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function newList() {
    const name = await prompt({
      title: 'Create New List',
      message: 'Name for the new list?',
      placeholder: 'e.g. SDE Candidates',
    });
    if (name && name.trim().length >= 2) createListMutation.mutate(name.trim());
  }



  return (
    <div className="space-y-4">
      {/* Search controls */}
      <div className="rounded-lg border border-border bg-surface-raised p-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <Input
            className="pl-9"
            placeholder="Search name, email, or role…"
            value={params.q ?? ''}
            onChange={(e) => setParams((p) => ({ ...p, q: e.target.value || undefined, page: 1 }))}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-text-muted">Must have ALL skills</label>
            <TagInput value={skillsAll} onChange={setSkillsAll} placeholder="e.g. Python, AWS" />
          </div>
          <div>
            <label className="text-xs font-medium text-text-muted">Any of these skills</label>
            <TagInput value={skillsAny} onChange={setSkillsAny} placeholder="e.g. React, Vue" />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              className="w-40"
              options={EXPERIENCE}
              placeholder="Any experience"
              value={params.experienceLevel ?? ''}
              onChange={(e) => setParams((p) => ({ ...p, experienceLevel: e.target.value || undefined, page: 1 }))}
            />
            <Select
              className="w-48"
              options={jobs.map((j) => ({ value: j.id, label: j.title }))}
              placeholder="All Jobs"
              value={params.jobRequisitionId ?? ''}
              onChange={(e) => setParams((p) => ({ ...p, jobRequisitionId: e.target.value || undefined, page: 1 }))}
            />
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent cursor-pointer"
                checked={Boolean(params.hasResume)}
                onChange={(e) => setParams((p) => ({ ...p, hasResume: e.target.checked || undefined, page: 1 }))}
              />
              Has resume
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent cursor-pointer"
                checked={Boolean(params.unassignedOnly)}
                onChange={(e) => setParams((p) => ({ ...p, unassignedOnly: e.target.checked || undefined, page: 1 }))}
              />
              Unassigned only
            </label>
            {isFetching && <Spinner className="h-4 w-4" />}
          </div>
          
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <>
                <Button
                  variant="danger"
                  onClick={() => deleteMutation.mutate([...selected])}
                  disabled={deleteMutation.isPending}
                >
                  Delete Selected ({selected.size})
                </Button>
                <Button variant="outline" onClick={() => setSelected(new Set())}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bulk add toolbar */}
      {canManage && selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <span className="text-sm text-text-secondary">{selected.size} selected</span>
          <Select
            className="w-56"
            options={lists.map((l) => ({ value: l.id, label: `${l.name} (${l.validCount})` }))}
            placeholder="Choose a list…"
            value={targetList}
            onChange={(e) => setTargetList(e.target.value)}
          />
          <Button size="sm" disabled={!targetList} loading={addMutation.isPending} onClick={() => addMutation.mutate(targetList)}>
            Add to list
          </Button>
          <Button variant="ghost" size="sm" onClick={newList} loading={createListMutation.isPending}>
            <Plus className="h-3.5 w-3.5" />
            New list
          </Button>
        </div>
      )}

      {/* Results */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-raised text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
              {canManage && (
                <th className="px-3 py-3 w-10 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent cursor-pointer rounded"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelected(new Set(items.map((item) => item.id)));
                      } else {
                        setSelected(new Set());
                      }
                    }}
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left">Candidate</th>
              <th className="px-4 py-3 text-left">Experience</th>
              <th className="px-4 py-3 text-left">Skills</th>
              <th className="px-4 py-3 text-center">Fit</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={canManage ? 7 : 5} className="py-12 text-center"><Spinner className="mx-auto" /></td></tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={canManage ? 7 : 5} className="py-12 text-center text-text-muted">No candidates match these criteria.</td></tr>
            )}
            {!isLoading && items.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-raised/50">
                {canManage && (
                  <td className="px-3 py-3">
                    <input type="checkbox" className="h-4 w-4 accent-accent cursor-pointer" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                )}
                <td className="px-4 py-3">
                  <p className="font-medium text-text-primary">{c.fullName}</p>
                  <p className="text-xs text-text-muted">{c.currentRole ?? c.email}</p>
                </td>
                <td className="px-4 py-3"><ExperienceBadge level={c.experienceLevel} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 max-w-xs">
                    {c.skills.slice(0, 4).map((s) => (
                      <span key={s} className="rounded bg-surface-overlay px-1.5 py-0.5 text-xs text-text-secondary">{s}</span>
                    ))}
                    {c.skills.length > 4 && <span className="text-xs text-text-muted">+{c.skills.length - 4}</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-center"><FitScoreBadge score={c.fitScore} /></td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-text-muted hover:text-danger hover:bg-danger/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to delete candidate "${c.fullName}"?`)) {
                          deleteMutation.mutate([c.id]);
                        }
                      }}
                      title="Delete Candidate"
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

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-text-muted">
          <span>{meta.total} candidates</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={meta.page === 1} onClick={() => setParams((p) => ({ ...p, page: (p.page ?? 1) - 1 }))}>Previous</Button>
            <span className="px-2">Page {meta.page} / {meta.totalPages}</span>
            <Button variant="outline" size="sm" disabled={meta.page === meta.totalPages} onClick={() => setParams((p) => ({ ...p, page: (p.page ?? 1) + 1 }))}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

