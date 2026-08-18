import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { TagInput } from '../../components/ui/TagInput.js';
import { Drawer } from '../../components/ui/Drawer.js';
import * as bankApi from '../../services/questionBankApi.js';
import { apiErrorMessage } from '../../services/api.js';
import {
  DIFFICULTY_POINTS,
  type QuestionItem,
  type QuestionType,
  type Difficulty,
  type McqOption,
  type TestCase,
} from '@agnohire/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  bankId: string;
  /** Highest existing orderIndex, so a new question is appended at the end. */
  nextOrderIndex: number;
  question?: QuestionItem | null;
  onSaveDraft?: (q: any) => void;
}

const TYPE_OPTIONS = [
  { value: 'MCQ', label: 'Multiple choice' },
  { value: 'TEXT', label: 'Written answer' },
  { value: 'CODE', label: 'Coding' },
];
const DIFFICULTY_OPTIONS = [
  { value: 'EASY', label: 'Easy' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HARD', label: 'Hard' },
];

const emptyOption = (): McqOption => ({ text: '', correct: false });
const emptyTestCase = (): TestCase => ({ input: '', expectedOutput: '', hidden: false });

export function QuestionEditorDrawer({ open, onClose, bankId, nextOrderIndex, question, onSaveDraft }: Props) {
  const qc = useQueryClient();
  const editing = !!question;
  const [type, setType] = useState<QuestionType>('MCQ');
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [text, setText] = useState('');
  const [options, setOptions] = useState<McqOption[]>([emptyOption(), emptyOption()]);
  const [rubric, setRubric] = useState('');
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setType(question?.type ?? 'MCQ');
    setDifficulty(question?.difficulty ?? 'MEDIUM');
    setText(question?.text ?? '');
    setOptions(
      question?.options && question.options.length
        ? question.options.map((o) => ({ ...o }))
        : [emptyOption(), emptyOption()],
    );
    setRubric(question?.rubric ?? '');
    setTestCases(question?.testCases && question.testCases.length ? question.testCases.map((t) => ({ ...t })) : []);
    setTags(question?.tags ?? []);
  }, [open, question]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        text,
        type,
        difficulty,
        rubric: rubric || undefined,
        tags,
        orderIndex: question?.orderIndex ?? nextOrderIndex,
        options: type === 'MCQ' ? options.filter((o) => o.text.trim()) : undefined,
        testCases: type === 'CODE' ? testCases.filter((t) => t.expectedOutput.trim()) : undefined,
      };
      return editing
        ? bankApi.updateQuestion(bankId, question!.id, payload)
        : bankApi.addQuestion(bankId, payload);
    },
    onSuccess: () => {
      toast.success(editing ? 'Question updated' : 'Question added');
      qc.invalidateQueries({ queryKey: ['question-bank', bankId] });
      qc.invalidateQueries({ queryKey: ['question-banks'] });
      onClose();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const handleSave = () => {
    const payload = {
      text,
      type,
      difficulty,
      rubric: rubric || undefined,
      tags,
      orderIndex: question?.orderIndex ?? nextOrderIndex,
      options: type === 'MCQ' ? options.filter((o) => o.text.trim()) : undefined,
      testCases: type === 'CODE' ? testCases.filter((t) => t.expectedOutput.trim()) : undefined,
      aiGenerated: question?.aiGenerated || false,
    };
    if (onSaveDraft) {
      onSaveDraft(payload);
      toast.success(editing ? 'Question updated' : 'Question added');
      onClose();
    } else {
      mutation.mutate();
    }
  };

  function setOption(idx: number, patch: Partial<McqOption>) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }

  function setTestCase(idx: number, patch: Partial<TestCase>) {
    setTestCases((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }

  const mcqValid =
    type !== 'MCQ' ||
    (options.filter((o) => o.text.trim()).length >= 2 &&
      options.some((o) => o.correct && o.text.trim()));
  const valid = text.trim().length >= 3 && mcqValid;
  const maxScore = DIFFICULTY_POINTS[difficulty];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? 'Edit Question' : 'Add Question'}
      subtitle={`Worth ${maxScore} point${maxScore === 1 ? '' : 's'} at ${difficulty.toLowerCase()} difficulty`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!valid}
            loading={mutation.isPending}
            onClick={handleSave}
          >
            {editing ? 'Save changes' : 'Add question'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Type</label>
            <Select
              options={TYPE_OPTIONS}
              value={type}
              onChange={(e) => setType(e.target.value as QuestionType)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Difficulty</label>
            <Select
              options={DIFFICULTY_OPTIONS}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-primary">
            Question <span className="text-danger">*</span>
          </label>
          <Textarea
            placeholder="Write the question prompt…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {type === 'MCQ' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-primary">
                Options <span className="text-danger">*</span>
              </label>
              <span className="text-xs text-text-muted">Tick every correct answer</span>
            </div>
            {options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-accent"
                  checked={opt.correct}
                  onChange={(e) => setOption(idx, { correct: e.target.checked })}
                  aria-label={`Option ${idx + 1} correct`}
                />
                <Input
                  className="flex-1"
                  placeholder={`Option ${idx + 1}`}
                  value={opt.text}
                  onChange={(e) => setOption(idx, { text: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={options.length <= 2}
                  className="rounded-md p-2 text-text-muted transition-colors hover:text-danger disabled:opacity-30"
                  aria-label="Remove option"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setOptions((prev) => [...prev, emptyOption()])}
            >
              <Plus className="h-4 w-4" />
              Add option
            </Button>
          </div>
        )}

        {(type === 'TEXT' || type === 'CODE') && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Scoring rubric</label>
            <Textarea
              placeholder={
                type === 'CODE' && testCases.length
                  ? 'Optional — test cases below auto-grade the solution; this is just extra context'
                  : 'What a strong answer should contain — guides the AI scorer…'
              }
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
            />
          </div>
        )}

        {type === 'CODE' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-primary">Test cases</label>
              <span className="text-xs text-text-muted">
                Compares trimmed stdout to expected output. Hidden cases are never shown to candidates.
              </span>
            </div>
            {testCases.map((tc, idx) => (
              <div key={idx} className="space-y-2 rounded-lg border border-border p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-muted">Input (stdin)</label>
                    <Textarea
                      placeholder="Program stdin…"
                      value={tc.input}
                      onChange={(e) => setTestCase(idx, { input: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-muted">
                      Expected output <span className="text-danger">*</span>
                    </label>
                    <Textarea
                      placeholder="Expected stdout…"
                      value={tc.expectedOutput}
                      onChange={(e) => setTestCase(idx, { expectedOutput: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-text-muted">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={tc.hidden}
                      onChange={(e) => setTestCase(idx, { hidden: e.target.checked })}
                    />
                    Hidden (not shown to candidate, only checked on submit)
                  </label>
                  <button
                    type="button"
                    onClick={() => setTestCases((prev) => prev.filter((_, i) => i !== idx))}
                    className="rounded-md p-1.5 text-text-muted transition-colors hover:text-danger"
                    aria-label="Remove test case"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setTestCases((prev) => [...prev, emptyTestCase()])}
            >
              <Plus className="h-4 w-4" />
              Add test case
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-primary">Tags</label>
          <TagInput value={tags} onChange={setTags} placeholder="e.g. algorithms, sql…" />
        </div>
      </div>
    </Drawer>
  );
}
