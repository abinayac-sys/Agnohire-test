import { formatTitleCase } from '@agnohire/shared';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Lock, Send, Trash2 } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Spinner } from '../../components/ui/Spinner.js';
import type { PipelineCard } from '@agnohire/shared';
import { fitVariant } from './pipelineMeta.js';
import * as pipelineApi from '../../services/pipelineApi.js';
import { useAuthStore } from '../../store/authStore.js';
import { apiErrorMessage } from '../../services/api.js';

export function PipelineCardDrawer({
  open, card, canManage, onClose, onMoved, stages = [],
}: {
  open: boolean;
  card: PipelineCard | null;
  canManage: boolean;
  onClose: () => void;
  onMoved: () => void;
  stages?: string[];
}) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [stage, setStage] = useState<string>('APPLIED');
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [showRejectionForm, setShowRejectionForm] = useState(false);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [rejectedRoundInput, setRejectedRoundInput] = useState('Initial Screening');

  useEffect(() => {
    if (card) {
      setStage(card.stage);
      setContent('');
      setIsPrivate(false);
      setRejectionReasonInput(card.rejectionReason || card.aiRejectionReason || '');
      setRejectedRoundInput(card.rejectedRound || card.aiRejectedRound || 'Initial Screening');
      setShowRejectionForm(card.stage === 'REJECTED');
    }
  }, [card]);

  const { data, isLoading } = useQuery({
    queryKey: ['pipeline-notes', card?.id],
    queryFn: () => pipelineApi.fetchNotes(card!.id),
    enabled: !!card && open,
  });
  const notes = data?.notes ?? [];

  const move = useMutation({
    mutationFn: (params: { toStage: string; rejectionReason?: string; rejectedRound?: string }) =>
      pipelineApi.moveApplication(card!.id, params),
    onSuccess: (_res, variables) => {
      const label = formatTitleCase(variables.toStage);
      toast.success(`Moved to ${label}`);
      onMoved();
    },
    onError: (e: Error) => { toast.error(apiErrorMessage(e)); if (card) setStage(card.stage); },
  });

  const addNote = useMutation({
    mutationFn: () => pipelineApi.addNote(card!.id, { content, isPrivate }),
    onSuccess: () => {
      toast.success('Note added');
      setContent(''); setIsPrivate(false);
      qc.invalidateQueries({ queryKey: ['pipeline-notes', card?.id] });
      onMoved(); // refresh note counts on the board
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => pipelineApi.deleteNote(card!.id, noteId),
    onSuccess: () => {
      toast.success('Note deleted');
      qc.invalidateQueries({ queryKey: ['pipeline-notes', card?.id] });
      onMoved(); // refresh note counts on the board
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  function onStageChange(next: string) {
    if (next === card?.stage) return;
    if (next === 'REJECTED') {
      setStage(next);
      setShowRejectionForm(true);
    } else {
      setPendingStage(next);
    }
  }

  const stageOptions = stages.map((s) => ({ value: s, label: formatTitleCase(s) }));

  const roundOptions = [
    { value: 'Initial Screening', label: 'Initial Screening' },
    ...stages
      .filter((s) => !['SOURCED', 'APPLIED', 'HR_APPROVAL', 'OFFER', 'HIRED', 'REJECTED'].includes(s))
      .map((s) => ({ value: s, label: formatTitleCase(s) }))
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="md"
      title={card?.candidate.fullName ?? 'Candidate'}
      subtitle={card ? (card.candidate.currentRole ?? card.candidate.email) : undefined}
    >
      {!card ? null : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={fitVariant(card.fitScore)}>
              {card.fitScore != null ? `${Math.round(card.fitScore)}% fit` : 'unscored'}
            </Badge>
            {card.fitRecommendation && <Badge variant="outline">{formatTitleCase(card.fitRecommendation)}</Badge>}
            <span className="text-xs text-text-muted">Applied {format(new Date(card.appliedAt), 'dd MMM yyyy')}</span>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Pipeline stage</label>
            <Select
              options={stageOptions}
              value={stage}
              disabled={!canManage || move.isPending}
              onChange={(e) => onStageChange(e.target.value)}
            />
            {!canManage && <p className="mt-1 text-xs text-text-muted">You don't have permission to move candidates.</p>}
          </div>

          {showRejectionForm && (
            <div className="rounded-lg border border-border bg-surface-raised p-4 space-y-4">
              <h5 className="text-sm font-semibold text-text-primary">Specify Rejection Details</h5>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Rejected Round</label>
                <Select
                  options={roundOptions}
                  value={rejectedRoundInput}
                  onChange={(e) => setRejectedRoundInput(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Rejection Reason</label>
                <Textarea
                  rows={2}
                  placeholder="Why was this candidate rejected?"
                  value={rejectionReasonInput}
                  onChange={(e) => setRejectionReasonInput(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => move.mutate({ toStage: 'REJECTED', rejectionReason: rejectionReasonInput, rejectedRound: rejectedRoundInput })}
                  loading={move.isPending}
                  disabled={!rejectionReasonInput.trim()}
                >
                  Confirm Rejection
                </Button>
              </div>
            </div>
          )}

          {card.stage === 'REJECTED' && !showRejectionForm && (
            <div className="rounded-lg border border-danger/20 bg-danger/5 p-4 space-y-2">
              <h5 className="text-sm font-semibold text-danger">Rejection Details</h5>
              <p className="text-xs text-text-secondary">
                <span className="font-semibold">Round:</span> {card.rejectedRound ? formatTitleCase(card.rejectedRound) : 'Initial Screening'}
              </p>
              <p className="text-xs text-text-secondary">
                <span className="font-semibold">Reason:</span> {card.rejectionReason || 'No reason provided.'}
              </p>
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-medium text-text-primary">Notes</h4>

            {canManage && (
              <div className="mb-4 space-y-2 rounded-lg border border-border bg-surface p-3">
                <Textarea
                  rows={3}
                  placeholder="Add a note about this candidate…"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
                    <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="h-4 w-4 rounded border-border" />
                    <Lock className="h-3 w-3" /> Private (only you)
                  </label>
                  <Button size="sm" onClick={() => addNote.mutate()} loading={addNote.isPending} disabled={!content.trim()}>
                    <Send className="h-3.5 w-3.5" /> Add note
                  </Button>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="py-6 text-center"><Spinner className="mx-auto" /></div>
            ) : notes.length === 0 ? (
              <p className="text-sm text-text-muted">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg border border-border bg-surface p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-text-secondary">{n.author.name}</span>
                      <div className="flex items-center gap-2">
                        {n.isPrivate && <Badge variant="muted"><Lock className="mr-1 h-3 w-3" />private</Badge>}
                        <span className="text-xs text-text-muted">{format(new Date(n.createdAt), 'dd MMM, HH:mm')}</span>
                        {(n.isPrivate || n.author.id === user?.id) && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm('Are you sure you want to delete this note?')) {
                                deleteNoteMutation.mutate(n.id);
                              }
                            }}
                            className="text-text-muted hover:text-danger p-0.5 rounded transition-colors"
                            title="Delete note"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-text-primary">{n.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {pendingStage && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl space-y-4 mx-4">
            <h3 className="text-lg font-semibold text-text-primary">Confirm Candidate Stage Change</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              You are about to move <strong className="text-text-primary">{card?.candidate.fullName}</strong> from:
              <br />
              <strong className="text-text-primary">{formatTitleCase(card?.stage ?? '')}</strong> → <strong className="text-text-primary">{formatTitleCase(pendingStage)}</strong>.
              <br /><br />
              This action will update the candidate's workflow stage. Do you want to continue?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStage(card?.stage ?? 'APPLIED');
                  setPendingStage(null);
                }}
                type="button"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setStage(pendingStage);
                  setShowRejectionForm(false);
                  move.mutate({ toStage: pendingStage });
                  setPendingStage(null);
                }}
                type="button"
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </Drawer>
  );
}
