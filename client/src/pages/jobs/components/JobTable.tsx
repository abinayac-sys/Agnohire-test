import { formatDistanceToNow, format, isPast } from 'date-fns';
import {
  Eye,
  Pencil,
  Trash2,
  SendHorizonal,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  ChevronDown,
  ChevronUp,
  Users,
  ArrowUpDown,
  MoreHorizontal,
  Download,
  Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../components/ui/Button.js';
import { Spinner } from '../../../components/ui/Spinner.js';
import { StatusBadge, WorkModeBadge } from './StatusBadge.js';
import type { JobListItem, JobFilters } from '@agnohire/shared';
import type { PaginationMeta } from '@agnohire/shared';
import { useAuthStore } from '../../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { cn } from '../../../utils/cn.js';

interface JobTableProps {
  items: JobListItem[];
  meta: PaginationMeta;
  loading: boolean;
  filters: Partial<JobFilters>;
  onFilterChange: (next: Partial<JobFilters>) => void;
  onView: (job: JobListItem) => void;
  onEdit: (job: JobListItem) => void;
  onSubmit: (job: JobListItem) => void;
  onApprove: (job: JobListItem) => void;
  onReject: (job: JobListItem) => void;
  onClose: (job: JobListItem) => void;
  onReopen: (job: JobListItem) => void;
  onDelete: (job: JobListItem) => void;
  onDownload: (job: JobListItem) => void;
}

function SortHeader({
  label,
  field,
  filters,
  onSort,
}: {
  label: string;
  field: JobFilters['sortBy'];
  filters: Partial<JobFilters>;
  onSort: (f: JobFilters['sortBy']) => void;
}) {
  const active = filters.sortBy === field;
  const asc = filters.sortOrder === 'asc';
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider hover:text-text-primary transition-colors',
        active ? 'text-text-primary' : 'text-text-muted',
      )}
      onClick={() => onSort(field)}
    >
      {label}
      {active ? (
        asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

export function JobTable({
  items,
  meta,
  loading,
  filters,
  onFilterChange,
  onView,
  onEdit,
  onSubmit,
  onApprove,
  onReject,
  onClose,
  onReopen,
  onDelete,
  onDownload,
}: JobTableProps) {
  const { hasPermission, user } = useAuthStore();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    openUpward: boolean;
  } | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const handleScroll = () => {
      setOpenMenuId(null);
      setMenuPosition(null);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [openMenuId]);

  const handleActionsClick = (e: React.MouseEvent<HTMLButtonElement>, jobId: string) => {
    e.stopPropagation();
    if (openMenuId === jobId) {
      setOpenMenuId(null);
      setMenuPosition(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < 185; // dynamically detect if dropdown height fits (approx 160px)

      setMenuPosition({
        left: rect.right - 192, // w-48 is 192px
        top: openUpward ? undefined : rect.bottom + 4,
        bottom: openUpward ? window.innerHeight - rect.top + 4 : undefined,
        openUpward,
      });
      setOpenMenuId(jobId);
    }
  };

  function sort(field: JobFilters['sortBy']) {
    onFilterChange({
      ...filters,
      sortBy: field,
      sortOrder: filters.sortBy === field && filters.sortOrder === 'asc' ? 'desc' : 'asc',
    });
  }

  function goPage(p: number) {
    onFilterChange({ ...filters, page: p });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised">
                <th className="px-4 py-3 text-left">
                  <SortHeader label="Title" field="title" filters={filters} onSort={sort} />
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                  JOB ID
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Domain
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Headcount
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Mode
                </th>
                <th className="px-4 py-3 text-left">
                  <SortHeader label="Deadline" field="deadline" filters={filters} onSort={sort} />
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Apps
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <Spinner className="mx-auto" />
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-text-muted">
                    No jobs found. Create your first job to get started.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((job) => {
                  const isCreator = user?.id === job.createdBy.id;
                  const deadlinePast = job.deadline && isPast(new Date(job.deadline));

                  return (
                    <tr
                      key={job.id}
                      className="group border-b border-border last:border-0 hover:bg-surface-raised/50 transition-colors cursor-pointer"
                      onClick={() => onView(job)}
                    >
                      {/* Title */}
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary group-hover:text-accent transition-colors">
                          {job.title}
                        </p>
                        <p className="text-xs text-text-muted mt-0.5">{job.sector.name}</p>
                      </td>

                      {/* ID */}
                      <td className="px-4 py-3 text-center font-mono text-xs text-text-secondary" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5">
                          <span>{job.id.substring(0, 8)}...</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(job.id);
                              toast.success('Copied Job ID to clipboard');
                            }}
                            className="p-1 hover:bg-accent-muted hover:text-accent rounded transition-colors text-text-muted hover:text-text-primary"
                            title="Copy Job ID"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* Domain */}
                      <td className="px-4 py-3 text-center text-text-secondary">{job.domain.name}</td>

                      {/* Headcount */}
                      <td className="px-4 py-3 text-center">
                        <span className="font-medium text-text-primary">{job.filled}</span>
                        <span className="text-text-muted">/{job.headcount}</span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={job.status} />
                      </td>

                      {/* Work mode */}
                      <td className="px-4 py-3 text-center">
                        <WorkModeBadge mode={job.workMode} />
                      </td>

                      {/* Deadline */}
                      <td className="px-4 py-3">
                        {job.deadline ? (
                          <span
                            className={cn(
                              'text-sm',
                              deadlinePast
                                ? 'text-danger font-medium'
                                : 'text-text-secondary',
                            )}
                            title={format(new Date(job.deadline), 'PPP')}
                          >
                            {formatDistanceToNow(new Date(job.deadline), {
                              addSuffix: true,
                            })}
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>

                      {/* Applications */}
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-text-secondary">
                          <Users className="h-3.5 w-3.5" />
                          {job._count.applications}
                        </span>
                      </td>

                      {/* Actions */}
                      <td
                        className="px-4 py-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="relative inline-block">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => handleActionsClick(e, job.id)}
                            aria-label="Actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>

                          {openMenuId === job.id && menuPosition &&
                            createPortal(
                              <>
                                {/* click-away overlay */}
                                <div
                                  className="fixed inset-0 z-40 bg-transparent"
                                  onClick={() => { setOpenMenuId(null); setMenuPosition(null); }}
                                />
                                <div
                                  style={{
                                    position: 'fixed',
                                    left: `${menuPosition.left}px`,
                                    top: menuPosition.top !== undefined ? `${menuPosition.top}px` : 'auto',
                                    bottom: menuPosition.bottom !== undefined ? `${menuPosition.bottom}px` : 'auto',
                                    width: '192px',
                                  }}
                                  className={cn(
                                    'z-50 rounded-lg panel-glass shadow-elev-3 p-1',
                                    menuPosition.openUpward
                                      ? 'origin-bottom-right animate-scale-in-up'
                                      : 'origin-top-right animate-scale-in',
                                  )}
                                >
                                  <MenuItem
                                    icon={Eye}
                                    label="View details"
                                    onClick={() => { onView(job); setOpenMenuId(null); setMenuPosition(null); }}
                                  />
                                  <MenuItem
                                    icon={Download}
                                    label="Download PDF"
                                    onClick={() => { onDownload(job); setOpenMenuId(null); setMenuPosition(null); }}
                                  />
                                  {hasPermission(PERMISSIONS.JOB_EDIT) &&
                                    (job.status === 'DRAFT' || job.status === 'PENDING_APPROVAL') && (
                                      <MenuItem
                                        icon={Pencil}
                                        label="Edit"
                                        onClick={() => { onEdit(job); setOpenMenuId(null); setMenuPosition(null); }}
                                      />
                                    )}
                                  {job.status === 'DRAFT' && (isCreator || hasPermission(PERMISSIONS.JOB_APPROVE)) && (
                                    <MenuItem
                                      icon={SendHorizonal}
                                      label="Submit for approval"
                                      onClick={() => { onSubmit(job); setOpenMenuId(null); setMenuPosition(null); }}
                                    />
                                  )}
                                  {job.status === 'PENDING_APPROVAL' &&
                                    hasPermission(PERMISSIONS.JOB_APPROVE) && (
                                      <>
                                        <MenuItem
                                          icon={CheckCircle2}
                                          label="Approve"
                                          onClick={() => { onApprove(job); setOpenMenuId(null); setMenuPosition(null); }}
                                          className="text-success"
                                        />
                                        <MenuItem
                                          icon={XCircle}
                                          label="Reject"
                                          onClick={() => { onReject(job); setOpenMenuId(null); setMenuPosition(null); }}
                                          className="text-danger"
                                        />
                                      </>
                                    )}
                                  {job.status === 'OPEN' && hasPermission(PERMISSIONS.JOB_EDIT) && (
                                    <MenuItem
                                      icon={Lock}
                                      label="Close job"
                                      onClick={() => { onClose(job); setOpenMenuId(null); setMenuPosition(null); }}
                                    />
                                  )}
                                  {job.status === 'CLOSED' && hasPermission(PERMISSIONS.JOB_EDIT) && (
                                    <MenuItem
                                      icon={Unlock}
                                      label="Reopen job"
                                      onClick={() => { onReopen(job); setOpenMenuId(null); setMenuPosition(null); }}
                                    />
                                  )}
                                  {hasPermission(PERMISSIONS.JOB_DELETE) && (
                                    <MenuItem
                                      icon={Trash2}
                                      label="Delete"
                                      onClick={() => { onDelete(job); setOpenMenuId(null); setMenuPosition(null); }}
                                      className="text-danger"
                                    />
                                  )}
                                </div>
                              </>,
                              document.body
                            )
                          }
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-text-muted">
          <span>
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page === 1}
              onClick={() => goPage(meta.page - 1)}
            >
              Previous
            </Button>
            {(() => {
              const total = meta.totalPages;
              const cur = meta.page;
              const WINDOW = 5;
              let start = Math.max(1, cur - Math.floor(WINDOW / 2));
              const end = Math.min(total, start + WINDOW - 1);
              // Shift start left if window is cut short on the right
              start = Math.max(1, end - WINDOW + 1);
              const pages: (number | '…')[] = [];
              if (start > 1) { pages.push(1); if (start > 2) pages.push('…'); }
              for (let p = start; p <= end; p++) pages.push(p);
              if (end < total) { if (end < total - 1) pages.push('…'); pages.push(total); }
              return pages.map((p, i) =>
                p === '…' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-text-muted select-none">…</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === cur ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => goPage(p as number)}
                  >
                    {p}
                  </Button>
                ),
              );
            })()}
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page === meta.totalPages}
              onClick={() => goPage(meta.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-text-secondary hover:bg-accent-muted hover:text-accent transition-colors',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
