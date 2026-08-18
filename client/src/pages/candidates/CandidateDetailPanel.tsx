import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { apiErrorMessage } from '../../services/api.js';
import {
  Upload,
  FileText,
  Download,
  Eye,
  RefreshCw,
  Trash2,
  Sparkles,
  Mail,
  Phone,
  MapPin,
  Linkedin,
  Github,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Pencil,
  UserPlus,
  AlertTriangle,
} from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Select } from '../../components/ui/Select.js';
import { Spinner } from '../../components/ui/Spinner.js';
import {
  ExperienceBadge,
  SourceBadge,
  FitScoreBadge,
  ParseStatusBadge,
  ApplicationStatusBadge,
  RecommendationBadge,
} from './components/CandidateBadges.js';
import * as candidateApi from '../../services/candidateApi.js';
import * as jobApi from '../../services/jobApi.js';
import * as refApi from '../../services/referenceApi.js';
import { useAuthStore } from '../../store/authStore.js';
import { formatTitleCase, PERMISSIONS } from '@agnohire/shared';
import type { ResumeItem, ApplicationListItem } from '@agnohire/shared';

interface Props {
  candidateId: string | null;
  onClose: () => void;
  onEdit: () => void;
}

const ACCEPT =
  '.pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,.bmp,.tiff,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/jpeg,image/png,image/webp,image/bmp,image/tiff';

export function CandidateDetailPanel({ candidateId, onClose, onEdit }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [expandedResume, setExpandedResume] = useState<string | null>(null);
  const [recruiterId, setRecruiterId] = useState('');

  const canEdit = hasPermission(PERMISSIONS.CANDIDATE_EDIT);
  const canAssign = hasPermission(PERMISSIONS.CANDIDATE_ASSIGN);

  const { data, isLoading } = useQuery({
    queryKey: ['candidate', candidateId],
    queryFn: () => candidateApi.fetchCandidate(candidateId!),
    enabled: Boolean(candidateId),
    refetchInterval: (query) => {
      const c = query.state.data?.candidate;
      const parsing = c?.resumes.some(
        (r) => r.parseStatus === 'PENDING' || r.parseStatus === 'PROCESSING',
      );
      return parsing ? 2500 : false;
    },
  });

  const candidate = data?.candidate;



  // Users for the recruiter-assignment picker
  const { data: usersData } = useQuery({
    queryKey: ['ref-users'],
    queryFn: refApi.fetchUsers,
    enabled: Boolean(candidateId) && canAssign,
    staleTime: 120_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
    qc.invalidateQueries({ queryKey: ['candidates'] });
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) => candidateApi.uploadResume(candidateId!, file),
    onSuccess: () => {
      toast.success('Resume uploaded — parsing started');
      invalidate();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const reparseMutation = useMutation({
    mutationFn: (resumeId: string) => candidateApi.reparseResume(candidateId!, resumeId),
    onSuccess: () => {
      toast.success('Re-parsing started');
      invalidate();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const deleteResumeMutation = useMutation({
    mutationFn: (resumeId: string) => candidateApi.deleteResume(candidateId!, resumeId),
    onSuccess: () => {
      toast.success('Resume deleted');
      invalidate();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });



  const [confirmDeleteAppId, setConfirmDeleteAppId] = useState<string | null>(null);

  const deleteApplicationMutation = useMutation({
    mutationFn: (appId: string) => candidateApi.deleteApplication(appId),
    onSuccess: () => {
      toast.success('Application deleted');
      setConfirmDeleteAppId(null);
      // Invalidate candidate detail + list + all related views
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['passed-candidates'] });
      qc.invalidateQueries({ queryKey: ['interviews'] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const scoreMutation = useMutation({
    mutationFn: (appId: string) => candidateApi.scoreApplication(appId, true),
    onSuccess: () => {
      toast.success('Fit score updated');
      invalidate();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const assignMutation = useMutation({
    mutationFn: (rid: string) => candidateApi.assignCandidate(candidateId!, rid),
    onSuccess: () => {
      toast.success('Candidate assigned');
      setRecruiterId('');
      invalidate();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const unassignMutation = useMutation({
    mutationFn: () => candidateApi.unassignCandidate(candidateId!),
    onSuccess: () => {
      toast.success('Candidate unassigned');
      invalidate();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      if (candidate && candidate.resumes.length > 0) {
        toast.error('Resume is already uploaded. Please delete the existing one first.');
        return;
      }
      uploadMutation.mutate(file);
    }
    e.target.value = '';
  }



  return (
    <Drawer
      open={Boolean(candidateId)}
      onClose={onClose}
      title={candidate?.fullName ?? 'Candidate'}
      subtitle={candidate?.currentRole ?? undefined}
      size="xl"
      footer={
        canEdit ? (
          <div className="flex justify-end">
            <Button variant="outline" onClick={onEdit} type="button">
              <Pencil className="h-4 w-4" />
              Edit candidate
            </Button>
          </div>
        ) : undefined
      }
    >
      {isLoading || !candidate ? (
        <div className="py-16 text-center">
          <Spinner className="mx-auto" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Contact + meta */}
          <div className="rounded-lg border border-border bg-surface-raised p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ExperienceBadge level={candidate.experienceLevel} />
              <SourceBadge source={candidate.source} />
              {candidate.fitScore != null && (
                <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                  Best fit: <FitScoreBadge score={candidate.fitScore} />
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <InfoLine icon={Mail} value={candidate.email} />
              {candidate.phone && <InfoLine icon={Phone} value={candidate.phone} />}
              {candidate.location && <InfoLine icon={MapPin} value={candidate.location} />}
              {candidate.linkedinUrl && (
                <InfoLine icon={Linkedin} value="LinkedIn" href={candidate.linkedinUrl} />
              )}
              {candidate.githubUrl && (
                <InfoLine icon={Github} value="GitHub" href={candidate.githubUrl} />
              )}
            </div>
            {candidate.skills.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-text-muted">Skills</p>
                <div className="flex flex-wrap gap-1">
                  {candidate.skills.map((s) => (
                    <span key={s} className="rounded bg-surface-overlay px-1.5 py-0.5 text-xs text-text-secondary">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Assignment */}
          {(canAssign || candidate.assignments.some((a) => a.status === 'ASSIGNED')) && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
                Assignment
              </h3>
              {(() => {
                const users = usersData?.users ?? [];
                const current = candidate.assignments.find((a) => a.status === 'ASSIGNED') ?? null;
                const assignedUser = current
                  ? users.find((u) => u.id === current.recruiterId)
                  : null;
                return (
                  <div className="rounded-md border border-border bg-surface p-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <UserPlus className="h-4 w-4 text-text-muted" />
                      {current ? (
                        <span className="text-text-secondary">
                          Assigned to{' '}
                          <span className="font-medium text-text-primary">
                            {assignedUser?.fullName ?? 'a recruiter'}
                          </span>
                        </span>
                      ) : (
                        <span className="text-text-muted">Not assigned to anyone</span>
                      )}
                    </div>
                    {canAssign && (
                      <div className="flex items-center gap-2">
                        <Select
                          className="flex-1"
                          options={users.map((u) => ({
                            value: u.id,
                            label: `${u.fullName} · ${u.role.displayName}`,
                          }))}
                          placeholder="Select a recruiter…"
                          value={recruiterId}
                          onChange={(e) => setRecruiterId(e.target.value)}
                        />
                        <Button
                          size="sm"
                          type="button"
                          disabled={!recruiterId}
                          loading={assignMutation.isPending}
                          onClick={() => recruiterId && assignMutation.mutate(recruiterId)}
                        >
                          Assign
                        </Button>
                        {current && (
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            loading={unassignMutation.isPending}
                            onClick={() => unassignMutation.mutate()}
                          >
                            Unassign
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </section>
          )}

          {/* Resumes */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
                Resumes
              </h3>
              {canEdit && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={onFilePicked}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    loading={uploadMutation.isPending}
                    onClick={() => fileRef.current?.click()}
                    disabled={candidate.resumes.length > 0}
                    title={candidate.resumes.length > 0 ? 'A resume is already uploaded. Please delete the existing one first.' : undefined}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                  </Button>
                </>
              )}
            </div>

            {candidate.resumes.length === 0 ? (
              <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-text-muted">
                No resume uploaded yet.
              </p>
            ) : (
              <div className="space-y-2">
                {candidate.resumes.map((r) => (
                  <ResumeRow
                    key={r.id}
                    resume={r}
                    candidateId={candidate.id}
                    expanded={expandedResume === r.id}
                    onToggle={() => setExpandedResume(expandedResume === r.id ? null : r.id)}
                    canEdit={canEdit}
                    onReparse={() => reparseMutation.mutate(r.id)}
                    onDelete={() => deleteResumeMutation.mutate(r.id)}
                    reparsing={reparseMutation.isPending}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Applications */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              Applications
            </h3>



            {candidate.applications.length === 0 ? (
              <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-text-muted">
                Not applied to any jobs yet.
              </p>
            ) : (
              <div className="space-y-2">
                {candidate.applications.map((a) => (
                  <ApplicationRow
                    key={a.id}
                    app={a}
                    canEdit={canEdit}
                    onScore={() => scoreMutation.mutate(a.id)}
                    scoring={scoreMutation.isPending}
                    onDelete={() => setConfirmDeleteAppId(a.id)}
                    deleting={deleteApplicationMutation.isPending && confirmDeleteAppId === a.id}
                    confirmingDelete={confirmDeleteAppId === a.id}
                    onCancelDelete={() => setConfirmDeleteAppId(null)}
                    onConfirmDelete={() => deleteApplicationMutation.mutate(a.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function InfoLine({
  icon: Icon,
  value,
  href,
}: {
  icon: React.FC<{ className?: string }>;
  value: string;
  href?: string;
}) {
  const content = (
    <span className="inline-flex items-center gap-1.5 text-text-secondary">
      <Icon className="h-3.5 w-3.5 text-text-muted" />
      {href ? <span className="text-accent hover:underline">{value}</span> : value}
    </span>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    content
  );
}

function ResumeRow({
  resume,
  candidateId,
  expanded,
  onToggle,
  canEdit,
  onReparse,
  onDelete,
  reparsing,
}: {
  resume: ResumeItem;
  candidateId: string;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  onReparse: () => void;
  onDelete: () => void;
  reparsing: boolean;
}) {
  const parsed = resume.parsedData;
  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex items-center gap-3 p-3">
        <FileText className="h-5 w-5 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">{resume.fileName}</p>
          <p className="text-xs text-text-muted">
            {(resume.fileSize / 1024).toFixed(0)} KB · {format(new Date(resume.createdAt), 'dd MMM yyyy')}
          </p>
        </div>
        <ParseStatusBadge status={resume.parseStatus} />
        <div className="flex items-center gap-1">
          {resume.parseStatus === 'COMPLETED' && parsed && (
            <Button variant="ghost" size="icon" type="button" onClick={onToggle} aria-label="Toggle details">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={async () => {
              // Open a tab synchronously (avoids popup blockers), then point it
              // at the authenticated blob once it's fetched.
              const tab = window.open('', '_blank');
              try {
                const url = await candidateApi.fetchResumeBlobUrl(candidateId, resume.id);
                if (tab) tab.location.href = url;
                else window.open(url, '_blank');
              } catch {
                tab?.close();
                toast.error('Could not open the resume.');
              }
            }}
            aria-label="View resume"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={async () => {
              try {
                const url = await candidateApi.fetchResumeBlobUrl(candidateId, resume.id);
                const a = document.createElement('a');
                a.href = url;
                a.download = resume.fileName;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
              } catch {
                toast.error('Could not download the resume.');
              }
            }}
            aria-label="Download resume"
          >
            <Download className="h-4 w-4" />
          </Button>
          {canEdit && (
            <>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                loading={reparsing}
                onClick={onReparse}
                aria-label="Re-parse"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={onDelete}
                aria-label="Delete"
                className="text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {resume.parseStatus === 'FAILED' && resume.parseError && (
        <p className="border-t border-border px-3 py-2 text-xs text-danger">{resume.parseError}</p>
      )}

      {expanded && parsed && (
        <div className="border-t border-border p-3 space-y-3 text-sm">
          {parsed.summary && <p className="text-text-secondary">{parsed.summary}</p>}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {parsed.totalExperienceYears != null && (
              <Detail label="Experience" value={`${parsed.totalExperienceYears} years`} />
            )}
            {parsed.location && <Detail label="Location" value={parsed.location} />}
          </div>
          {parsed.skills.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">Skills</p>
              <div className="flex flex-wrap gap-1">
                {parsed.skills.map((s) => (
                  <span key={s} className="rounded bg-surface-overlay px-1.5 py-0.5 text-xs text-text-secondary">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {parsed.experience.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">Experience</p>
              <ul className="space-y-1">
                {parsed.experience.slice(0, 5).map((e, i) => (
                  <li key={i} className="text-xs text-text-secondary">
                    <span className="font-medium text-text-primary">{e.title}</span> @ {e.company}
                    {e.duration ? ` · ${e.duration}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {parsed.education.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">Education</p>
              <ul className="space-y-1">
                {parsed.education.map((ed, i) => (
                  <li key={i} className="text-xs text-text-secondary">
                    {ed.degree} — {ed.institution}
                    {ed.year ? ` (${ed.year})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApplicationRow({
  app,
  canEdit,
  onScore,
  scoring,
  onDelete,
  deleting,
  confirmingDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  app: ApplicationListItem;
  canEdit: boolean;
  onScore: () => void;
  scoring: boolean;
  onDelete: () => void;
  deleting: boolean;
  confirmingDelete: boolean;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fit = app.fitScoreData;
  const { data: jobDetailResponse } = useQuery({
    queryKey: ['job', app.job.id],
    queryFn: () => jobApi.fetchJob(app.job.id),
    staleTime: 60000,
  });
  const workflowRounds = jobDetailResponse?.job?.workflowRounds || [];
  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex items-center gap-3 p-3">
        <Briefcase className="h-4 w-4 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">{app.job.title}</p>
          <div className="text-xs text-text-muted flex gap-2 items-center">
            <span>{app.job.domain.name}</span>
            {app.workflowStatus && (
              <>
                <span>&bull;</span>
                <span className="font-medium">{formatTitleCase(app.workflowStatus)}</span>
              </>
            )}
            {app.currentRound > 0 && (
              <>
                <span>&bull;</span>
                <span>Round {app.currentRound}</span>
              </>
            )}
          </div>
        </div>
        <ApplicationStatusBadge status={app.status} />
        <FitScoreBadge score={app.fitScore} />
        {fit && (
          <Button variant="ghost" size="icon" type="button" onClick={() => setOpen((v) => !v)} aria-label="Toggle">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
        {canEdit && (
          <>
            <Button variant="ghost" size="sm" type="button" loading={scoring} onClick={onScore}>
              <Sparkles className="h-3.5 w-3.5" />
              {app.fitScore == null ? 'Score' : 'Re-score'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={onDelete}
              aria-label="Delete application"
              className="text-danger hover:bg-danger/10"
              title="Delete this application"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Inline delete confirmation */}
      {confirmingDelete && (
        <div className="border-t border-danger/30 bg-danger/5 px-3 py-2.5 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
          <p className="text-xs text-danger flex-1">
            Delete this application? Interviews, schedules and offers for this job will also be removed.
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={onCancelDelete}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              type="button"
              loading={deleting}
              onClick={onConfirmDelete}
              className="text-xs bg-danger hover:bg-danger/90 text-white border-danger"
            >
              Delete
            </Button>
          </div>
        </div>
      )}

      {workflowRounds.length > 0 && (
        <div className="border-t border-border px-3 py-2 flex flex-wrap gap-2 items-center bg-surface-raised/50">
          <span className="text-xs font-medium text-text-secondary">Workflow:</span>
          {workflowRounds.map((r: any, idx: number) => {
            const rNum = idx + 1;
            let status = 'Locked';
            let color = 'text-text-muted';
            const isFailed = app.workflowStatus === 'FAILED' || app.workflowStatus === 'REJECTED';
            
            if (isFailed) {
              if (rNum === app.failedRound) {
                status = 'Failed';
                color = 'text-danger font-medium';
              } else if (rNum < app.currentRound) {
                status = 'Completed';
                color = 'text-success font-medium';
              } else {
                status = 'Locked';
                color = 'text-text-muted opacity-60';
              }
            } else {
              if (rNum < app.currentRound) {
                status = 'Completed';
                color = 'text-success font-medium';
              } else if (rNum === app.currentRound && app.workflowStatus !== 'SELECTED') {
                status = 'Available';
                color = 'text-accent font-medium';
              } else if (rNum <= app.currentRound && app.workflowStatus === 'SELECTED') {
                status = 'Completed';
                color = 'text-success font-medium';
              } else {
                status = 'Locked';
                color = 'text-text-muted opacity-60';
              }
            }
            
            return (
              <span key={r.id} className={`text-[11px] ${color} flex items-center gap-1 bg-surface border border-border px-1.5 py-0.5 rounded-sm`}>
                <span className="truncate max-w-[120px]" title={formatTitleCase(r.roundName)}>{formatTitleCase(r.roundName)}</span>
                <span className="opacity-50">→</span>
                <span>{status}</span>
              </span>
            );
          })}
        </div>
      )}

      {open && fit && (
        <div className="border-t border-border p-3 space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <RecommendationBadge recommendation={fit.recommendation} />
            <span className="text-xs text-text-muted">
              Skill {fit.skillMatch}% · Experience {fit.experienceMatch}%
            </span>
          </div>
          {fit.summary && <p className="text-text-secondary">{fit.summary}</p>}
          <div className="grid grid-cols-2 gap-3">
            {fit.matchedSkills.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-success">Matched skills</p>
                <p className="text-xs text-text-secondary">{fit.matchedSkills.join(', ')}</p>
              </div>
            )}
            {fit.missingSkills.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-danger">Missing skills</p>
                <p className="text-xs text-text-secondary">{fit.missingSkills.join(', ')}</p>
              </div>
            )}
          </div>
          {fit.strengths.length > 0 && (
            <Bullets title="Strengths" items={fit.strengths} className="text-success" />
          )}
          {fit.concerns.length > 0 && (
            <Bullets title="Concerns" items={fit.concerns} className="text-warning" />
          )}
        </div>
      )}
    </div>
  );
}

function Bullets({ title, items, className }: { title: string; items: string[]; className?: string }) {
  return (
    <div>
      <p className={`mb-1 text-xs font-medium ${className ?? ''}`}>{title}</p>
      <ul className="list-disc pl-4 space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="text-xs text-text-secondary">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-text-muted">{label}: </span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}
