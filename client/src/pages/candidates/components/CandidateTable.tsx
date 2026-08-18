import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import {
  Eye,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  FileText,
  FileSearch,
  Briefcase,
  Mail,
  Download,
  Sparkles,
  FileX2,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '../../../components/ui/Button.js';
import { Spinner } from '../../../components/ui/Spinner.js';
import { ExperienceBadge, SourceBadge, FitScoreBadge } from './CandidateBadges.js';
import * as candidateApi from '../../../services/candidateApi.js';
import type { CandidateListItem, CandidateFilters, PaginationMeta } from '@agnohire/shared';
import { useAuthStore } from '../../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { useConfirm } from '../../../providers/ConfirmProvider.js';
import { apiErrorMessage } from '../../../services/api.js';
import { cn } from '../../../utils/cn.js';

interface Props {
  items: CandidateListItem[];
  meta: PaginationMeta;
  loading: boolean;
  filters: Partial<CandidateFilters>;
  onFilterChange: (next: Partial<CandidateFilters>) => void;
  onView: (c: CandidateListItem) => void;
  onEdit: (c: CandidateListItem) => void;
  onDelete: (c: CandidateListItem) => void;
  selectionMode?: boolean;
  selectedIds?: string[];
  onSelect?: (ids: string[]) => void;
}

function SortHeader({
  label,
  field,
  filters,
  onSort,
}: {
  label: string;
  field: NonNullable<CandidateFilters['sortBy']>;
  filters: Partial<CandidateFilters>;
  onSort: (f: NonNullable<CandidateFilters['sortBy']>) => void;
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

export function CandidateTable({
  items,
  meta,
  loading,
  filters,
  onFilterChange,
  onView,
  onEdit,
  onDelete,
  selectionMode,
  selectedIds = [],
  onSelect,
}: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { hasPermission } = useAuthStore();
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

  const handleActionsClick = (e: React.MouseEvent<HTMLButtonElement>, candidateId: string) => {
    e.stopPropagation();
    if (openMenuId === candidateId) {
      setOpenMenuId(null);
      setMenuPosition(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < 280; // dynamically detect if dropdown height fits (approx 250px max for candidate menu)

      setMenuPosition({
        left: rect.right - 200, // w-50 is 200px
        top: openUpward ? undefined : rect.bottom + 4,
        bottom: openUpward ? window.innerHeight - rect.top + 4 : undefined,
        openUpward,
      });
      setOpenMenuId(candidateId);
    }
  };

  async function viewResume(c: CandidateListItem) {
    if (!c.primaryResume) return;
    // Open synchronously (popup-blocker safe), then point at the authed blob.
    const win = window.open('', '_blank');
    try {
      const url = await candidateApi.fetchResumeBlobUrl(c.id, c.primaryResume.id);
      if (win) win.location = url;
    } catch (e) {
      win?.close();
      toast.error(apiErrorMessage(e, 'Could not open the resume'));
    }
  }

  async function downloadResume(c: CandidateListItem) {
    if (!c.primaryResume) return;
    try {
      const url = await candidateApi.fetchResumeBlobUrl(c.id, c.primaryResume.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = c.primaryResume.fileName || 'resume';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not download the resume'));
    }
  }

  const parseMutation = useMutation({
    mutationFn: (c: CandidateListItem) => candidateApi.reparseResume(c.id, c.primaryResume!.id),
    onSuccess: (_d, c) => {
      toast.success('Resume parsing queued');
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['candidate', c.id] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const deleteResumeMutation = useMutation({
    mutationFn: (c: CandidateListItem) => candidateApi.deleteResume(c.id, c.primaryResume!.id),
    onSuccess: (_d, c) => {
      toast.success('Resume deleted');
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['candidate', c.id] });
      qc.invalidateQueries({ queryKey: ['candidate-stats'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  function sort(field: NonNullable<CandidateFilters['sortBy']>) {
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
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised">
                <th className="px-4 py-3 w-10 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent cursor-pointer"
                    checked={items.length > 0 && selectedIds.length === items.length}
                    onChange={(e) => {
                      if (e.target.checked) onSelect?.(items.map(i => i.id));
                      else onSelect?.([]);
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left">
                  <SortHeader label="Candidate" field="fullName" filters={filters} onSort={sort} />
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Experience
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Source
                </th>
                <th className="px-4 py-3 text-center">
                  <SortHeader label="Fit" field="fitScore" filters={filters} onSort={sort} />
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Activity
                </th>
                <th className="px-4 py-3 text-left">
                  <SortHeader label="Added" field="createdAt" filters={filters} onSort={sort} />
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
                    No candidates found. Add your first candidate to get started.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((c) => {
                  return (
                    <tr
                      key={c.id}
                      className="group border-b border-border last:border-0 hover:bg-surface-raised/50 transition-colors cursor-pointer"
                      onClick={() => onView(c)}
                    >
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent cursor-pointer"
                          checked={selectedIds.includes(c.id)}
                          onChange={(e) => {
                            if (e.target.checked) onSelect?.([...selectedIds, c.id]);
                            else onSelect?.(selectedIds.filter((id) => id !== c.id));
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary group-hover:text-accent transition-colors">
                          {c.fullName}
                        </p>
                        <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {c.email}
                        </p>
                        {(c.currentRole || c.jobApplied) && (
                          <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1 truncate max-w-48">
                            {c.jobApplied ? (
                              <span className="font-semibold text-text-secondary" title={`Job: ${c.jobApplied.title}`}>
                                <Briefcase className="h-3 w-3 inline mr-1" />
                                {c.jobApplied.title}
                              </span>
                            ) : (
                              c.currentRole
                            )}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ExperienceBadge level={c.experienceLevel} />
                      </td>
                      <td className="px-4 py-3">
                        <SourceBadge source={c.source} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <FitScoreBadge score={c.fitScore} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-3 text-text-secondary">
                          <span className="inline-flex items-center gap-1" title="Resumes">
                            <FileText className="h-3.5 w-3.5" />
                            {c._count.resumes}
                          </span>
                          <span className="inline-flex items-center gap-1" title="Applications">
                            <Briefcase className="h-3.5 w-3.5" />
                            {c._count.applications}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                      </td>
                      {!selectionMode && (
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="relative inline-block">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => handleActionsClick(e, c.id)}
                              aria-label="Actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                            {openMenuId === c.id && menuPosition &&
                              createPortal(
                                <>
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
                                      width: '200px',
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
                                      label="View Details"
                                      onClick={() => { onView(c); setOpenMenuId(null); setMenuPosition(null); }}
                                    />
                                    {hasPermission(PERMISSIONS.CANDIDATE_EDIT) && (
                                      <MenuItem
                                        icon={Pencil}
                                        label="Edit"
                                        onClick={() => { onEdit(c); setOpenMenuId(null); setMenuPosition(null); }}
                                      />
                                    )}
                                    {c.primaryResume && (
                                      <>
                                        <div className="my-1 border-t border-border" />
                                        <MenuItem
                                          icon={FileSearch}
                                          label="View Resume"
                                          onClick={() => { void viewResume(c); setOpenMenuId(null); setMenuPosition(null); }}
                                        />
                                        <MenuItem
                                          icon={Download}
                                          label="Download Resume"
                                          onClick={() => { void downloadResume(c); setOpenMenuId(null); setMenuPosition(null); }}
                                        />
                                        {hasPermission(PERMISSIONS.CANDIDATE_EDIT) && (
                                          <MenuItem
                                            icon={Sparkles}
                                            label="Parse Resume"
                                            onClick={() => { parseMutation.mutate(c); setOpenMenuId(null); setMenuPosition(null); }}
                                          />
                                        )}
                                        {hasPermission(PERMISSIONS.CANDIDATE_EDIT) && (
                                          <MenuItem
                                            icon={FileX2}
                                            label="Delete Resume"
                                            onClick={async () => {
                                              setOpenMenuId(null);
                                              setMenuPosition(null);
                                              if (
                                                await confirm({
                                                  title: 'Delete Resume',
                                                  message: `Delete the resume "${c.primaryResume!.fileName}"?`,
                                                  confirmText: 'Delete',
                                                  variant: 'danger',
                                                })
                                              ) {
                                                deleteResumeMutation.mutate(c);
                                              }
                                            }}
                                            className="text-danger"
                                          />
                                        )}
                                      </>
                                    )}
                                    {hasPermission(PERMISSIONS.CANDIDATE_EDIT) && (
                                      <>
                                        <div className="my-1 border-t border-border" />
                                        <MenuItem
                                          icon={Trash2}
                                          label="Delete Candidate"
                                          onClick={() => { onDelete(c); setOpenMenuId(null); setMenuPosition(null); }}
                                          className="text-danger"
                                        />
                                      </>
                                    )}
                                  </div>
                                </>,
                                document.body
                              )
                            }
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-text-muted">
          <span>
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={meta.page === 1} onClick={() => goPage(meta.page - 1)}>
              Previous
            </Button>
            {(() => {
              const total = meta.totalPages;
              const cur = meta.page;
              const WINDOW = 5;
              let start = Math.max(1, cur - Math.floor(WINDOW / 2));
              const end = Math.min(total, start + WINDOW - 1);
              start = Math.max(1, end - WINDOW + 1);
              const pages: (number | '…')[] = [];
              if (start > 1) { pages.push(1); if (start > 2) pages.push('…'); }
              for (let p = start; p <= end; p++) pages.push(p);
              if (end < total) { if (end < total - 1) pages.push('…'); pages.push(total); }
              return pages.map((p, i) =>
                p === '…' ? (
                  <span key={`e-${i}`} className="px-1 text-text-muted select-none">…</span>
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
