import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, FileQuestion, Sparkles, FileSpreadsheet } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { QuestionEditorDrawer } from './QuestionEditorDrawer.js';
import { QuestionBulkImportDrawer } from './QuestionBulkImportDrawer.js';
import { AiGenerateDrawer } from './AiGenerateDrawer.js';
import * as bankApi from '../../services/questionBankApi.js';
import { useAuthStore } from '../../store/authStore.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { PERMISSIONS, type QuestionItem, type QuestionType, type Difficulty } from '@agnohire/shared';
import { apiErrorMessage } from '../../services/api.js';

interface Props {
  open: boolean;
  onClose: () => void;
  bankId: string | null;
}

const TYPE_VARIANT: Record<QuestionType, 'info' | 'success' | 'warning'> = {
  MCQ: 'info',
  TEXT: 'success',
  CODE: 'warning',
};
const DIFFICULTY_VARIANT: Record<Difficulty, 'muted' | 'default' | 'danger'> = {
  EASY: 'muted',
  MEDIUM: 'default',
  HARD: 'danger',
};

export function BankQuestionsDrawer({ open, onClose, bankId }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission(PERMISSIONS.QUESTION_BANK_MANAGE);
  const [editorOpen, setEditorOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<QuestionItem | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['question-bank', bankId],
    queryFn: () => bankApi.fetchBank(bankId!),
    enabled: open && !!bankId,
  });

  const deleteMutation = useMutation({
    mutationFn: (qid: string) => bankApi.deleteQuestion(bankId!, qid),
    onSuccess: () => {
      toast.success('Question removed');
      qc.invalidateQueries({ queryKey: ['question-bank', bankId] });
      qc.invalidateQueries({ queryKey: ['question-banks'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const bank = data?.bank;
  const questions = bank?.questions ?? [];
  const nextOrderIndex = questions.reduce((m, q) => Math.max(m, q.orderIndex + 1), 0);

  function openEditor(q: QuestionItem | null) {
    setEditing(q);
    setEditorOpen(true);
  }

  async function handleExportPdf() {
    if (!bankId) return;
    setExporting(true);
    try {
      await bankApi.downloadBanksPdf([bankId]);
      toast.success('PDF exported successfully');
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to export PDF'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={bank?.name ?? 'Question Bank'}
        subtitle={`${questions.length} question${questions.length === 1 ? '' : 's'}`}
        size="xl"
        footer={
          <div className="flex justify-between gap-2 w-full">
            <div className="flex gap-2">
              <Button variant="outline" type="button" onClick={onClose}>
                Close
              </Button>
              <Button variant="outline" type="button" onClick={handleExportPdf} loading={exporting}>
                <FileQuestion className="h-4 w-4" />
                Export PDF
              </Button>
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button variant="outline" type="button" onClick={() => setBulkOpen(true)}>
                  <FileSpreadsheet className="h-4 w-4" />
                  Bulk import
                </Button>
                <Button variant="outline" type="button" onClick={() => setAiOpen(true)}>
                  <Sparkles className="h-4 w-4" />
                  Generate with AI
                </Button>
                <Button type="button" onClick={() => openEditor(null)}>
                  <Plus className="h-4 w-4" />
                  Add question
                </Button>
              </div>
            )}
          </div>
        }
      >
        {isLoading ? (
          <div className="py-12 text-center">
            <Spinner className="mx-auto" />
          </div>
        ) : questions.length === 0 ? (
          <EmptyState
            icon={<FileQuestion className="h-8 w-8" />}
            title="No questions yet"
            description={canManage ? 'Author questions manually or generate a starter set with AI.' : 'This bank has no questions.'}
            action={
              canManage ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" type="button" onClick={() => setBulkOpen(true)}>
                    <FileSpreadsheet className="h-4 w-4" />
                    Bulk import
                  </Button>
                  <Button variant="outline" type="button" onClick={() => setAiOpen(true)}>
                    <Sparkles className="h-4 w-4" />
                    Generate with AI
                  </Button>
                  <Button type="button" onClick={() => openEditor(null)}>
                    <Plus className="h-4 w-4" />
                    Add question
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <ol className="space-y-3">
            {questions.map((q, i) => (
              <li key={q.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-text-muted">Q{i + 1}</span>
                      <Badge variant={TYPE_VARIANT[q.type]}>{q.type}</Badge>
                      <Badge variant={DIFFICULTY_VARIANT[q.difficulty]}>{q.difficulty}</Badge>
                      <span className="text-xs text-text-muted">{q.maxScore} pts</span>
                      {q.aiGenerated && (
                        <span className="inline-flex items-center gap-1 text-xs text-accent">
                          <Sparkles className="h-3 w-3" /> AI
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-text-primary">{q.text}</p>
                    {q.type === 'MCQ' && q.options && (
                      <ul className="mt-2 space-y-1">
                        {q.options.map((o, oi) => (
                          <li
                            key={oi}
                            className={
                              o.correct
                                ? 'text-xs font-medium text-success'
                                : 'text-xs text-text-muted'
                            }
                          >
                            {o.correct ? '✓' : '·'} {o.text}
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {q.tags.map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => openEditor(q)}
                        className="rounded-md p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
                        aria-label="Edit question"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (
                            await confirm({
                              title: 'Remove Question',
                              message: 'Remove this question from the bank?',
                              confirmText: 'Remove',
                              variant: 'danger',
                            })
                          ) {
                            deleteMutation.mutate(q.id);
                          }
                        }}
                        className="rounded-md p-2 text-text-muted transition-colors hover:text-danger"
                        aria-label="Delete question"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Drawer>

      {bankId && (
        <QuestionEditorDrawer
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          bankId={bankId}
          nextOrderIndex={nextOrderIndex}
          question={editing}
        />
      )}
      {bankId && (
        <AiGenerateDrawer
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          bankId={bankId}
          domainName={bank?.domain?.name}
        />
      )}
      {bankId && (
        <QuestionBulkImportDrawer
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          bankId={bankId}
          nextOrderIndex={nextOrderIndex}
        />
      )}
    </>
  );
}
