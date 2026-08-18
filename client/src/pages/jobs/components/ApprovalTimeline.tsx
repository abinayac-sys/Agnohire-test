import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import type { ApprovalWorkflowItem } from '@agnohire/shared';

const STATUS_ICON = {
  PENDING: <Clock className="h-4 w-4 text-warning" />,
  APPROVED: <CheckCircle2 className="h-4 w-4 text-success" />,
  REJECTED: <XCircle className="h-4 w-4 text-danger" />,
};

const STATUS_LABEL = {
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

interface ApprovalTimelineProps {
  workflows: ApprovalWorkflowItem[];
}

export function ApprovalTimeline({ workflows }: ApprovalTimelineProps) {
  if (workflows.length === 0) {
    return (
      <p className="text-sm text-text-muted italic">No approval actions yet.</p>
    );
  }

  return (
    <ol className="space-y-4">
      {workflows.map((w, i) => (
        <li key={w.id} className="flex gap-3">
          {/* connector line */}
          <div className="flex flex-col items-center">
            <div className="mt-0.5">{STATUS_ICON[w.status]}</div>
            {i < workflows.length - 1 && (
              <div className="mt-1 h-full w-px bg-border" />
            )}
          </div>

          <div className="pb-4">
            <p className="text-sm font-medium text-text-primary">
              {STATUS_LABEL[w.status]}
            </p>
            {w.actionedAt && (
              <p className="text-xs text-text-muted">
                {format(new Date(w.actionedAt), 'dd MMM yyyy, HH:mm')}
              </p>
            )}
            {w.comments && (
              <p className="mt-1 text-sm text-text-secondary italic">
                "{w.comments}"
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
