import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { GitBranch, Search, StickyNote, GripVertical } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { cn } from '../../utils/cn.js';
import { useAuthStore } from '../../store/authStore.js';
import { PipelineCardDrawer } from './PipelineCardDrawer.js';
import { STAGE_ACCENT, fitVariant } from './pipelineMeta.js';
import { formatTitleCase, PERMISSIONS, SOCKET_EVENTS, type PipelineBoard, type PipelineCard, type PipelineMovedEvent } from '@agnohire/shared';
import { Button } from '../../components/ui/Button.js';
import * as pipelineApi from '../../services/pipelineApi.js';
import * as jobApi from '../../services/jobApi.js';
import { getSocket } from '../../services/socket.js';
import { apiErrorMessage } from '../../services/api.js';

export function PipelinePage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission(PERMISSIONS.PIPELINE_MANAGE);

  const [jobId, setJobId] = useState('');
  const [search, setSearch] = useState('');
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ id: string; fromStage: string; toStage: string; candidateName: string } | null>(null);

  const { data: jobsData } = useQuery({
    queryKey: ['pipeline-jobs'],
    // No status filter: a job can carry applications (and need pipeline
    // management) in any status — e.g. candidates assigned before formal
    // approval, or still-active candidates on a job that's since closed.
    // Restricting this to OPEN made those candidates permanently unreachable
    // from this page once their job left OPEN status.
    queryFn: () => jobApi.fetchJobs({ limit: 500, sortBy: 'createdAt', sortOrder: 'desc' }),
  });
  const jobOptions = useMemo(
    () => (jobsData?.items ?? []).map((j) => ({ value: j.id, label: j.title })),
    [jobsData],
  );

  // Default to the first job once the list loads.
  useEffect(() => {
    if (!jobId && jobOptions.length > 0) setJobId(jobOptions[0].value);
  }, [jobId, jobOptions]);

  const boardKey = ['pipeline-board', jobId, search] as const;
  const { data, isLoading } = useQuery({
    queryKey: boardKey,
    queryFn: () => pipelineApi.fetchBoard({ jobRequisitionId: jobId, search: search || undefined }),
    enabled: !!jobId,
  });
  const board = data?.board;

  // Live board: subscribe to this job's pipeline room and refetch on remote moves.
  useEffect(() => {
    if (!jobId) return;
    const socket = getSocket();
    socket.emit(SOCKET_EVENTS.PIPELINE_SUBSCRIBE, jobId);
    const onMoved = (evt: PipelineMovedEvent) => {
      if (evt.jobRequisitionId === jobId) {
        qc.invalidateQueries({ queryKey: ['pipeline-board', jobId] });
      }
    };
    socket.on(SOCKET_EVENTS.PIPELINE_MOVED, onMoved);
    return () => {
      socket.emit(SOCKET_EVENTS.PIPELINE_UNSUBSCRIBE, jobId);
      socket.off(SOCKET_EVENTS.PIPELINE_MOVED, onMoved);
    };
  }, [jobId, qc]);

  const move = useMutation({
    mutationFn: ({ id, toStage }: { id: string; toStage: string }) =>
      pipelineApi.moveApplication(id, { toStage }),
    onMutate: async ({ id, toStage }) => {
      await qc.cancelQueries({ queryKey: boardKey });
      const prev = qc.getQueryData<{ board: PipelineBoard }>(boardKey);
      if (prev) qc.setQueryData(boardKey, { board: moveCardInBoard(prev.board, id, toStage) });
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev);
      toast.error(apiErrorMessage(e));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-board', jobId] });
      // A move changes the application status too, so refresh the Screening list.
      qc.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  function onDrop(toStage: string) {
    setOverStage(null);
    const id = dragId;
    setDragId(null);
    if (!id || !board) return;
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === id);
    if (!card || card.stage === toStage) return;

    if (toStage === 'HR_APPROVAL' || toStage === 'OFFER' || toStage === 'HIRED') {
      toast.error('Manual drag-and-drop is disabled for this stage. Candidate progression to HR Approval, Offer, and Hired is handled automatically by the recruitment workflow.');
      return;
    }

    if (toStage === 'REJECTED') {
      setActiveCard(card);
    } else {
      setPendingMove({ id, fromStage: card.stage, toStage, candidateName: card.candidate.fullName });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="ATS Pipeline" description="Track candidates through hiring stages — drag cards to move them" />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          className="w-72"
          options={jobOptions}
          placeholder={jobOptions.length ? 'Select a job…' : 'No jobs available'}
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
        />
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <Input className="pl-9" placeholder="Search candidates…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {board && <span className="text-sm text-text-muted">{board.total} candidate{board.total === 1 ? '' : 's'}</span>}
      </div>

      {!jobId ? (
        <EmptyState icon={<GitBranch className="h-8 w-8" />} title="No job selected"
          description="Select a job requisition above to view its candidate pipeline." />
      ) : isLoading || !board ? (
        <div className="py-16 text-center"><Spinner className="mx-auto" /></div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {board.columns.map((col) => (
            <div
              key={col.stage}
              onDragOver={(e) => { if (canManage) { e.preventDefault(); setOverStage(col.stage); } }}
              onDragLeave={() => setOverStage((s) => (s === col.stage ? null : s))}
              onDrop={() => onDrop(col.stage)}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-lg border border-border bg-surface-raised/50 transition-colors',
                overStage === col.stage && 'border-accent bg-accent/5',
              )}
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 rounded-full', (col.stage in STAGE_ACCENT) ? STAGE_ACCENT[col.stage as keyof typeof STAGE_ACCENT] : 'bg-info')} />
                  <span className="text-sm font-semibold text-text-primary">{formatTitleCase(col.stage)}</span>
                </div>
                <Badge variant="muted">{col.count}</Badge>
              </div>

              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ minHeight: '8rem' }}>
                {col.cards.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-text-muted">No candidates</p>
                ) : (
                  col.cards.map((card) => (
                    <Card
                      key={card.id}
                      card={card}
                      draggable={canManage}
                      dragging={dragId === card.id}
                      onDragStart={() => setDragId(card.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setActiveCard(card)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <PipelineCardDrawer
        open={!!activeCard}
        card={activeCard}
        canManage={canManage}
        onClose={() => setActiveCard(null)}
        stages={board?.stages}
        onMoved={() => {
          qc.invalidateQueries({ queryKey: ['pipeline-board', jobId] });
          // A move changes the application status too, so refresh the Screening list.
          qc.invalidateQueries({ queryKey: ['applications'] });
        }}
      />

      {pendingMove && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl space-y-4 mx-4">
            <h3 className="text-lg font-semibold text-text-primary">Confirm Candidate Stage Change</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              You are about to move <strong className="text-text-primary">{pendingMove.candidateName}</strong> from:
              <br />
              <strong className="text-text-primary">{formatTitleCase(pendingMove.fromStage)}</strong> → <strong className="text-text-primary">{formatTitleCase(pendingMove.toStage)}</strong>.
              <br /><br />
              This action will update the candidate's workflow stage. Do you want to continue?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setPendingMove(null)} type="button">
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  move.mutate({ id: pendingMove.id, toStage: pendingMove.toStage });
                  setPendingMove(null);
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
    </div>
  );
}

function Card({
  card, draggable, dragging, onDragStart, onDragEnd, onClick,
}: {
  card: PipelineCard;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'group cursor-pointer rounded-md border border-border bg-surface p-3 shadow-sm transition-all hover:border-accent/50 hover:shadow',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{card.candidate.fullName}</p>
          <p className="truncate text-xs text-text-muted">{card.candidate.currentRole ?? card.candidate.email}</p>
        </div>
        {draggable && <GripVertical className="h-4 w-4 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <Badge variant={fitVariant(card.fitScore)}>
          {card.fitScore != null ? `${Math.round(card.fitScore)}% fit` : 'unscored'}
        </Badge>
        {card.noteCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-text-muted">
            <StickyNote className="h-3 w-3" /> {card.noteCount}
          </span>
        )}
      </div>
      {card.stage === 'REJECTED' && (card.rejectedRound || card.rejectionReason) && (
        <div className="mt-2 border-t border-border pt-1.5 text-[11px] text-text-muted space-y-0.5">
          {card.rejectedRound && (
            <p>
              <span className="font-semibold text-danger">Rejected in:</span> {formatTitleCase(card.rejectedRound)}
            </p>
          )}
          {card.rejectionReason && (
            <p className="line-clamp-1 italic">
              "{card.rejectionReason}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Optimistically move a card between columns in the cached board. */
function moveCardInBoard(board: PipelineBoard, id: string, toStage: string): PipelineBoard {
  let moved: PipelineCard | undefined;
  const stripped = board.columns.map((col) => {
    const idx = col.cards.findIndex((c) => c.id === id);
    if (idx === -1) return col;
    moved = { ...col.cards[idx], stage: toStage };
    return { ...col, count: col.count - 1, cards: col.cards.filter((c) => c.id !== id) };
  });
  if (!moved) return board;
  const columns = stripped.map((col) =>
    col.stage === toStage ? { ...col, count: col.count + 1, cards: [moved!, ...col.cards] } : col,
  );
  return { ...board, columns };
}
