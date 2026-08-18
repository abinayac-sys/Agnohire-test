import { Badge } from '../../../components/ui/Badge.js';
import type { JobStatus } from '@agnohire/shared';

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; variant: 'success' | 'warning' | 'muted' | 'info' | 'danger' }
> = {
  DRAFT: { label: 'Draft', variant: 'muted' },
  PENDING_APPROVAL: { label: 'Pending Approval', variant: 'warning' },
  OPEN: { label: 'Open', variant: 'success' },
  CLOSED: { label: 'Closed', variant: 'danger' },
  REJECTED: { label: 'Rejected', variant: 'danger' },
};

interface StatusBadgeProps {
  status: JobStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, variant: 'muted' as const };
  return (
    <Badge variant={cfg.variant} className={className}>
      {cfg.label}
    </Badge>
  );
}

const WORK_MODE_LABELS: Record<string, string> = {
  ONSITE: 'On-site',
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
};

export function WorkModeBadge({ mode }: { mode: string | null }) {
  if (!mode) return null;
  return (
    <Badge variant="info" className="font-normal">
      {WORK_MODE_LABELS[mode] ?? mode}
    </Badge>
  );
}
