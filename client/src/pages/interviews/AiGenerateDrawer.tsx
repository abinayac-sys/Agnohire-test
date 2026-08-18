import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Drawer } from '../../components/ui/Drawer.js';
import * as bankApi from '../../services/questionBankApi.js';
import { apiErrorMessage } from '../../services/api.js';
import type { QuestionType, Difficulty } from '@agnohire/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  bankId: string;
  /** Bank domain name, shown as the default focus. */
  domainName?: string;
  onSuccessDraft?: (questions: any[]) => void;
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
const COUNT_OPTIONS = [
  ...[1, 2, 3, 5, 8, 10].map((n) => ({ value: String(n), label: `${n} question${n === 1 ? '' : 's'}` })),
  { value: 'custom', label: 'Custom' },
];

export function AiGenerateDrawer({ open, onClose, bankId, domainName, onSuccessDraft }: Props) {
  const qc = useQueryClient();
  const [type, setType] = useState<QuestionType>('MCQ');
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [count, setCount] = useState('3');
  const [customCount, setCustomCount] = useState('15');
  const [topic, setTopic] = useState('');

  useEffect(() => {
    if (open) {
      setType('MCQ'); setDifficulty('MEDIUM'); setCount('3'); setCustomCount('15'); setTopic('');
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      const finalCount = count === 'custom' ? Math.max(1, Math.min(50, Math.floor(Number(customCount) || 1))) : Number(count);
      return bankApi.generateQuestions(bankId, {
        type,
        difficulty,
        count: finalCount,
        topic: topic || '',
      });
    },
    onSuccess: (res) => {
      toast.success(`Added ${res.questions.length} AI question${res.questions.length === 1 ? '' : 's'}`);
      if (onSuccessDraft) {
        onSuccessDraft(res.questions);
      } else {
        qc.invalidateQueries({ queryKey: ['question-bank', bankId] });
        qc.invalidateQueries({ queryKey: ['question-banks'] });
      }
      onClose();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Generate with AI"
      subtitle="Draft questions with OpenAI — review and edit them after"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            <Sparkles className="h-4 w-4" />
            Generate
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Type</label>
            <Select options={TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value as QuestionType)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Difficulty</label>
            <Select options={DIFFICULTY_OPTIONS} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-primary">How many</label>
          <Select options={COUNT_OPTIONS} value={count} onChange={(e) => setCount(e.target.value)} />
        </div>

        {count === 'custom' && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Number of questions</label>
            <Input
              type="number"
              min="1"
              max="50"
              placeholder="e.g. 15"
              value={customCount}
              onChange={(e) => setCustomCount(e.target.value)}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-primary">Topic / focus</label>
          <Input
            placeholder={domainName ? `Defaults to “${domainName}”` : 'e.g. React hooks, SQL joins…'}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <p className="text-xs text-text-muted">
            Leave blank to use the bank’s domain. Generated questions are tagged as AI and can be edited or removed.
          </p>
        </div>

        {mutation.isPending && (
          <p className="text-sm text-text-muted">Generating… this can take a few seconds.</p>
        )}
      </div>
    </Drawer>
  );
}
