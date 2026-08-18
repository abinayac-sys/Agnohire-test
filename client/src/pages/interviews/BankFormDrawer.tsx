import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, FileQuestion, Sparkles, FileSpreadsheet } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Badge } from '../../components/ui/Badge.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { QuestionEditorDrawer } from './QuestionEditorDrawer.js';
import { QuestionBulkImportDrawer } from './QuestionBulkImportDrawer.js';
import { AiGenerateDrawer } from './AiGenerateDrawer.js';
import * as bankApi from '../../services/questionBankApi.js';
import { DIFFICULTY_POINTS, type QuestionItem, type QuestionType, type Difficulty } from '@agnohire/shared';
import { apiErrorMessage } from '../../services/api.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: (newBankId: string) => void;
  /** When set, the drawer edits this bank; otherwise it creates a new one. */
  bank?: any | null;
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

export function BankFormDrawer({ open, onClose, onSuccess, bank }: Props) {
  const qc = useQueryClient();
  const editing = !!bank;
  const [name, setName] = useState('');
  const [questions, setQuestions] = useState<QuestionItem[]>([]);

  // Sub-drawer states
  const [editorOpen, setEditorOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionItem | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(bank?.name ?? '');
    setQuestions([]);
  }, [open, bank]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = editing
        ? { name, isPublic: bank?.isPublic ?? true }
        : {
            name,
            isPublic: true,
            questions: questions.map((q) => ({
              text: q.text,
              type: q.type,
              difficulty: q.difficulty,
              rubric: q.rubric || undefined,
              tags: q.tags || [],
              orderIndex: q.orderIndex,
              aiGenerated: q.aiGenerated || false,
              options: q.options || undefined,
            })),
          };
      return editing ? bankApi.updateBank(bank.id, payload) : bankApi.createBank(payload);
    },
    onSuccess: (data) => {
      toast.success(editing ? 'Question bank updated' : 'Question bank created');
      qc.invalidateQueries({ queryKey: ['question-banks'] });
      onClose();
      if (!editing && data?.bank?.id && onSuccess) {
        onSuccess(data.bank.id);
      }
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const valid = name.trim().length >= 2;
  const nextOrderIndex = questions.reduce((m, q) => Math.max(m, q.orderIndex + 1), 0);

  function openEditor(q: any | null) {
    setEditingQuestion(q);
    setEditorOpen(true);
  }

  function handleSaveQuestionDraft(qPayload: any) {
    if (editingQuestion) {
      // Editing existing draft question
      setQuestions((prev) =>
        prev.map((item) => (item.id === editingQuestion.id ? { ...item, ...qPayload } : item))
      );
    } else {
      // Adding new draft question
      setQuestions((prev) => [
        ...prev,
        {
          ...qPayload,
          id: Math.random().toString(),
          orderIndex: nextOrderIndex,
        },
      ]);
    }
  }

  function handleImportDraft(imported: any[]) {
    setQuestions((prev) => [
      ...prev,
      ...imported.map((item, idx) => ({
        ...item,
        id: Math.random().toString(),
        orderIndex: prev.length + idx,
      })),
    ]);
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={editing ? 'Edit Question Bank' : 'New Question Bank'}
        subtitle={editing ? bank?.name : 'Create a new question bank and start authoring questions'}
        size="xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!valid}
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {editing ? 'Save changes' : 'Create Question Bank'}
            </Button>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">
              Question Bank Name <span className="text-danger">*</span>
            </label>
            <Input
              placeholder="e.g. Java Interview Questions"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {!editing && (
            <div className="border-t border-border pt-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-primary">Questions</h3>
                {questions.length > 0 && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" type="button" onClick={() => setBulkOpen(true)}>
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      Bulk import
                    </Button>
                    <Button variant="outline" size="sm" type="button" onClick={() => setAiOpen(true)}>
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate with AI
                    </Button>
                    <Button size="sm" type="button" onClick={() => openEditor(null)}>
                      <Plus className="h-3.5 w-3.5" />
                      Add question
                    </Button>
                  </div>
                )}
              </div>

              {questions.length === 0 ? (
                <EmptyState
                  icon={<FileQuestion className="h-8 w-8" />}
                  title="No questions yet"
                  description="Author questions manually or generate a starter set with AI."
                  action={
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
                            <Badge variant={TYPE_VARIANT[q.type as QuestionType]}>{q.type}</Badge>
                            <Badge variant={DIFFICULTY_VARIANT[q.difficulty as Difficulty]}>{q.difficulty}</Badge>
                            <span className="text-xs text-text-muted">
                              {DIFFICULTY_POINTS[q.difficulty as Difficulty]} pts
                            </span>
                            {q.aiGenerated && (
                              <span className="inline-flex items-center gap-1 text-xs text-accent">
                                <Sparkles className="h-3 w-3" /> AI
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-text-primary">{q.text}</p>
                          {q.type === 'MCQ' && q.options && (
                            <ul className="mt-2 space-y-1">
                              {q.options.map((o: any, oi: number) => (
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
                          {q.tags && q.tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {q.tags.map((t: string) => (
                                <Badge key={t} variant="outline">
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
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
                            onClick={() => {
                              setQuestions((prev) => prev.filter((x) => x.id !== q.id));
                            }}
                            className="rounded-md p-2 text-text-muted transition-colors hover:text-danger"
                            aria-label="Delete question"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </Drawer>

      <QuestionEditorDrawer
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        bankId="draft"
        nextOrderIndex={nextOrderIndex}
        question={editingQuestion}
        onSaveDraft={handleSaveQuestionDraft}
      />

      <AiGenerateDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        bankId="draft"
        domainName=""
        onSuccessDraft={handleImportDraft}
      />

      <QuestionBulkImportDrawer
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        bankId="draft"
        nextOrderIndex={nextOrderIndex}
        onSuccessDraft={handleImportDraft}
      />
    </>
  );
}
