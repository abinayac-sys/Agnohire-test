import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Plus, ListChecks, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { CandidateListDetailDrawer } from '../../components/candidates/CandidateListDetailDrawer.js';
import * as sourcingApi from '../../services/sourcingApi.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { usePrompt, useConfirm } from '../../providers/ConfirmProvider.js';
import { apiErrorMessage } from '../../services/api.js';


export function ListsTab() {
  const qc = useQueryClient();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission(PERMISSIONS.SOURCING_MANAGE);
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['candidate-lists'],
    queryFn: sourcingApi.fetchLists,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => sourcingApi.createCuratedList(name),
    onSuccess: () => { toast.success('List created'); qc.invalidateQueries({ queryKey: ['candidate-lists'] }); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sourcingApi.deleteList(id),
    onSuccess: () => { toast.success('List deleted'); qc.invalidateQueries({ queryKey: ['candidate-lists'] }); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  async function handleDelete(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    const confirmed = await confirm({
      title: 'Delete List',
      message: `Are you sure you want to delete "${name}"? This will also permanently remove the candidates it contains from the Candidates module.`,
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (confirmed) deleteMutation.mutate(id);
  }

  async function newList() {
    const name = await prompt({
      title: 'Create New List',
      message: 'Name for the new list?',
      placeholder: 'e.g. SDE Candidates',
    });
    if (name && name.trim().length >= 2) createMutation.mutate(name.trim());
  }

  const lists = data?.items ?? [];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={newList} loading={createMutation.isPending}>
            <Plus className="h-4 w-4" />
            New List
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center"><Spinner className="mx-auto" /></div>
      ) : lists.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-8 w-8" />} title="No lists yet" description="Create a curated list or import candidates in bulk." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((l) => (
            <button
              key={l.id}
              onClick={() => setOpen({ id: l.id, name: l.name })}
              className="rounded-lg border border-border bg-surface p-4 text-left hover:border-accent/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-text-primary truncate">{l.name}</p>
                <div className="flex items-center gap-2">
                  <Badge variant={l.status === 'COMPLETED' ? 'success' : l.status === 'FAILED' ? 'danger' : l.status === 'ALREADY_UPLOADED' ? 'info' : 'warning'}>
                    {l.status === 'PROCESSING'
                      ? 'importing'
                      : l.status === 'ALREADY_UPLOADED'
                        ? 'already uploaded'
                        : l.status.toLowerCase()}
                  </Badge>
                  {canManage && (
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, l.id, l.name)}
                      className="text-text-muted hover:text-danger transition-colors p-1 rounded hover:bg-surface-raised shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm text-text-secondary">{l.validCount} candidates</p>
              {l.errorCount > 0 && <p className="text-xs text-danger">{l.errorCount} import errors</p>}
              <p className="mt-1 text-xs text-text-muted">{format(new Date(l.createdAt), 'dd MMM yyyy')}</p>
            </button>
          ))}
        </div>
      )}

      <CandidateListDetailDrawer listId={open?.id ?? null} listName={open?.name ?? ''} onClose={() => setOpen(null)} />
    </div>
  );
}
