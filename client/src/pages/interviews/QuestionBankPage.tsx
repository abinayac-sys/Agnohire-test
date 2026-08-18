import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Search, Library, Pencil, Trash2, Globe, FileDown } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { BankFormDrawer } from './BankFormDrawer.js';
import { BankQuestionsDrawer } from './BankQuestionsDrawer.js';
import * as bankApi from '../../services/questionBankApi.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS, type QuestionBankListItem } from '@agnohire/shared';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { apiErrorMessage } from '../../services/api.js';

export function QuestionBankPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission(PERMISSIONS.QUESTION_BANK_MANAGE);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<QuestionBankListItem | null>(null);
  const [activeBankId, setActiveBankId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);

  const handleExportPdf = async () => {
    if (selectedIds.length === 0) return;
    setExporting(true);
    try {
      await bankApi.downloadBanksPdf(selectedIds);
      toast.success('PDF exported successfully');
      setSelectedIds([]);
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to export PDF'));
    } finally {
      setExporting(false);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ['question-banks', search],
    queryFn: () => bankApi.fetchBanks({ search: search || undefined, limit: 500 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => bankApi.deleteBank(id),
    onSuccess: () => {
      toast.success('Question bank deleted');
      qc.invalidateQueries({ queryKey: ['question-banks'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => bankApi.deleteBank(id)));
    },
    onSuccess: () => {
      toast.success('Question bank(s) deleted');
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['question-banks'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const banks = data?.items ?? [];

  function openCreate() {
    setEditingBank(null);
    setFormOpen(true);
  }
  function openEdit(bank: QuestionBankListItem) {
    setEditingBank(bank);
    setFormOpen(true);
  }

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete the selected ${selectedIds.length} question bank(s)?`)) {
      bulkDeleteMutation.mutate(selectedIds);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Question Bank"
        description="Author and organize interview questions by domain"
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <>
                <Button variant="outline" onClick={handleExportPdf} loading={exporting}>
                  <FileDown className="mr-2 h-4 w-4" />
                  Download PDF ({selectedIds.length})
                </Button>
                {canManage && (
                  <Button variant="danger" onClick={handleDelete} loading={bulkDeleteMutation.isPending}>
                    Delete Selected ({selectedIds.length})
                  </Button>
                )}
              </>
            )}
            {canManage && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New Bank
              </Button>
            )}
          </div>
        }
      />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
        <Input
          className="pl-9"
          placeholder="Search banks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="py-12 text-center">
          <Spinner className="mx-auto" />
        </div>
      ) : banks.length === 0 ? (
        <EmptyState
          icon={<Library className="h-8 w-8" />}
          title="No question banks"
          description={canManage ? 'Create a bank to start authoring questions.' : 'No question banks are available yet.'}
          action={
            canManage ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New Bank
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {banks.map((bank) => (
            <button
              key={bank.id}
              type="button"
              onClick={() => setActiveBankId(bank.id)}
              className="group flex flex-col rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-accent"
            >
              <div className="mb-2 flex items-start justify-between gap-2 w-full">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent cursor-pointer rounded"
                    checked={selectedIds.includes(bank.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => {
                      setSelectedIds(prev => prev.includes(bank.id) ? prev.filter(id => id !== bank.id) : [...prev, bank.id]);
                    }}
                  />
                  <h3 className="font-medium text-text-primary">{bank.name}</h3>
                </div>
                {bank.isPublic && (
                  <Globe className="h-4 w-4 shrink-0 text-text-muted" aria-label="Public" />
                )}
              </div>
              {bank.description && (
                <p className="mb-3 line-clamp-2 text-sm text-text-muted">{bank.description}</p>
              )}
              <div className="mt-auto flex items-center justify-between pt-2 w-full">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">
                    {bank._count.questions} question{bank._count.questions === 1 ? '' : 's'}
                  </span>
                  {bank.attachment && (
                    <a
                      href={`/api/files/${bank.attachment.id}/download`}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 flex items-center gap-1 text-xs font-medium text-accent hover:underline bg-accent/10 px-2 py-0.5 rounded-full"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FileDown className="h-3 w-3" />
                      Source
                    </a>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(bank);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation();
                          openEdit(bank);
                        }
                      }}
                      className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
                      aria-label="Edit bank"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (
                          await confirm({
                            title: 'Delete Question Bank',
                            message: `Delete "${bank.name}"? This cannot be undone.`,
                            confirmText: 'Delete',
                            variant: 'danger',
                          })
                        ) {
                          deleteMutation.mutate(bank.id);
                        }
                      }}
                      className="rounded-md p-1.5 text-text-muted transition-colors hover:text-danger"
                      aria-label="Delete bank"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <BankFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={(newBankId) => setActiveBankId(newBankId)}
        bank={editingBank}
      />
      <BankQuestionsDrawer
        open={!!activeBankId}
        onClose={() => setActiveBankId(null)}
        bankId={activeBankId}
      />
    </div>
  );
}
