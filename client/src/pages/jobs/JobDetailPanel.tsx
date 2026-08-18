import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { apiErrorMessage } from '../../services/api.js';
import {
  Briefcase,
  MapPin,
  Users,
  Calendar,
  DollarSign,
  Sparkles,
  SendHorizonal,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  Pencil,
  List,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Select } from '../../components/ui/Select.js';
import { StatusBadge, WorkModeBadge } from './components/StatusBadge.js';
import { ApprovalTimeline } from './components/ApprovalTimeline.js';
import * as jobApi from '../../services/jobApi.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';

interface JobDetailPanelProps {
  jobId: string | null;
  onClose: () => void;
  onEdit: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted border-b border-border pb-1.5">
        {title}
      </h3>
      {children}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.FC<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="h-4 w-4 text-text-muted shrink-0" />
      <span className="text-text-muted w-28 shrink-0">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}

// ─── Submit modal ─────────────────────────────────────────────────────────────

function SubmitModal({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [approverId, setApproverId] = useState('');
  const { data } = useQuery({
    queryKey: ['approvers'],
    queryFn: jobApi.fetchApprovers,
  });

  const mutation = useMutation({
    mutationFn: () => jobApi.submitJob(jobId, approverId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['jobs-stats'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Job submitted for approval');
      onDone();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const approvers = data?.approvers ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Select an approver. They will review and approve or reject this job.
      </p>
      <Select
        options={approvers.map((a) => ({
          value: a.id,
          label: `${a.fullName} (${a.roleDisplayName})`,
        }))}
        placeholder="Select approver…"
        value={approverId}
        onChange={(e) => setApproverId(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone} type="button">
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!approverId}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          type="button"
        >
          Submit
        </Button>
      </div>
    </div>
  );
}

// ─── Reject modal ─────────────────────────────────────────────────────────────

function RejectModal({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [comments, setComments] = useState('');

  const mutation = useMutation({
    mutationFn: () => jobApi.rejectJob(jobId, comments),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['jobs-stats'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Job rejected');
      onDone();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        Provide a reason for rejection. The job will be moved back to Draft.
      </p>
      <Textarea
        placeholder="Reason for rejection…"
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        rows={3}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone} type="button">
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!comments.trim()}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          type="button"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

type ModalType = 'submit' | 'reject' | 'approve' | null;

export function JobDetailPanel({ jobId, onClose, onEdit }: JobDetailPanelProps) {
  const qc = useQueryClient();
  const { hasPermission, user } = useAuthStore();
  const [modal, setModal] = useState<ModalType>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobApi.fetchJob(jobId!),
    enabled: Boolean(jobId),
  });

  const approveMutation = useMutation({
    mutationFn: () => jobApi.approveJob(jobId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['jobs-stats'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Job approved and set to Open');
      setModal(null);
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const closeMutation = useMutation({
    mutationFn: () => jobApi.closeJob(jobId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['jobs-stats'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Job closed');
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const reopenMutation = useMutation({
    mutationFn: () => jobApi.reopenJob(jobId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['jobs-stats'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Job reopened');
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const job = data?.job;

  const isCreator = user?.id === job?.createdBy.id;
  const canEdit =
    hasPermission(PERMISSIONS.JOB_EDIT) &&
    (job?.status === 'DRAFT' ||
      (job?.status === 'PENDING_APPROVAL' &&
        (isCreator || hasPermission(PERMISSIONS.JOB_APPROVE))));
  const canSubmit = job?.status === 'DRAFT' && (isCreator || hasPermission(PERMISSIONS.JOB_APPROVE));
  const canApprove = job?.status === 'PENDING_APPROVAL' && hasPermission(PERMISSIONS.JOB_APPROVE);
  const canClose = job?.status === 'OPEN' && hasPermission(PERMISSIONS.JOB_EDIT);
  const canReopen = job?.status === 'CLOSED' && hasPermission(PERMISSIONS.JOB_EDIT);

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && (
        <Button variant="outline" size="sm" onClick={onEdit} type="button">
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      )}
      {canSubmit && (
        <Button size="sm" onClick={() => setModal('submit')} type="button">
          <SendHorizonal className="h-3.5 w-3.5" />
          Submit for Approval
        </Button>
      )}
      {canApprove && (
        <>
          <Button
            size="sm"
            className="bg-success text-white hover:opacity-90"
            loading={approveMutation.isPending}
            onClick={() => approveMutation.mutate()}
            type="button"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setModal('reject')}
            type="button"
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </Button>
        </>
      )}
      {canClose && (
        <Button
          variant="outline"
          size="sm"
          loading={closeMutation.isPending}
          onClick={() => closeMutation.mutate()}
          type="button"
        >
          <Lock className="h-3.5 w-3.5" />
          Close Job
        </Button>
      )}
      {canReopen && (
        <Button
          variant="outline"
          size="sm"
          loading={reopenMutation.isPending}
          onClick={() => reopenMutation.mutate()}
          type="button"
        >
          <Unlock className="h-3.5 w-3.5" />
          Reopen
        </Button>
      )}
    </div>
  );

  return (
    <Drawer
      open={Boolean(jobId)}
      onClose={onClose}
      title={job?.title ?? 'Job Details'}
      subtitle={job ? `${job.sector.name} · ${job.domain.name}` : undefined}
      size="xl"
      footer={job && !isLoading ? actions : undefined}
    >
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!isLoading && job && (
        <div className="space-y-8">
          {/* Status + meta row */}
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={job.status} />
            <WorkModeBadge mode={job.workMode} />
            {job.aiGeneratedJd && (
              <Badge variant="info" className="gap-1">
                <Sparkles className="h-3 w-3" />
                AI Generated
              </Badge>
            )}
          </div>



          {/* Key info */}
          <Section title="Overview">
            <div className="grid grid-cols-1 gap-2.5">
              <InfoRow
                icon={Briefcase}
                label="Headcount"
                value={`${job.filled} filled / ${job.headcount} total`}
              />
              {job.location && (
                <InfoRow icon={MapPin} label="Location" value={job.location} />
              )}
              {job.deadline && (
                <InfoRow
                  icon={Calendar}
                  label="Deadline"
                  value={format(new Date(job.deadline), 'dd MMM yyyy, HH:mm')}
                />
              )}
              {(job.experienceMin != null || job.experienceMax != null) && (
                <InfoRow
                  icon={Users}
                  label="Experience"
                  value={`${job.experienceMin ?? 0}–${job.experienceMax ?? '∞'} years`}
                />
              )}
              {(job.budgetMin != null || job.budgetMax != null) && (
                <InfoRow
                  icon={DollarSign}
                  label="Budget"
                  value={`₹${Number(job.budgetMin ?? 0).toLocaleString()} – ₹${Number(job.budgetMax ?? 0).toLocaleString()}`}
                />
              )}
              <InfoRow
                icon={Calendar}
                label="Created"
                value={format(new Date(job.createdAt), 'dd MMM yyyy')}
              />
              <InfoRow
                icon={Users}
                label="Created by"
                value={job.createdBy.fullName}
              />
              {job.approvedBy && (
                <InfoRow
                  icon={CheckCircle2}
                  label="Approved by"
                  value={job.approvedBy.fullName}
                />
              )}
              {job.workflowRounds && (
                <InfoRow
                  icon={List}
                  label="Interview Rounds"
                  value={String(job.workflowRounds.length)}
                />
              )}
            </div>
          </Section>

          {/* Skills */}
          {job.skills.length > 0 && (
            <Section title="Required Skills">
              <div className="flex flex-wrap gap-2">
                {job.skills.map((skill) => (
                  <Badge key={skill} variant="outline">
                    {skill}
                  </Badge>
                ))}
              </div>
            </Section>
          )}

          {/* Description */}
          <Section title="Job Description">
            <div className="prose prose-sm max-w-none text-text-secondary whitespace-pre-wrap rounded-md border border-border bg-surface-raised p-4 text-sm leading-relaxed">
              {job.description}
            </div>
          </Section>

          {/* Submit / Reject modal area */}
          {modal === 'submit' && jobId && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              {/* Backdrop */}
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModal(null)} />
              
              {/* Modal Box */}
              <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-2xl transition-all space-y-4">
                <h3 className="font-heading text-lg font-semibold text-text-primary">
                  Submit for Approval
                </h3>
                <SubmitModal jobId={jobId} onDone={() => setModal(null)} />
              </div>
            </div>,
            document.body
          )}
          {modal === 'reject' && jobId && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              {/* Backdrop */}
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModal(null)} />
              
              {/* Modal Box */}
              <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-2xl transition-all space-y-4">
                <h3 className="font-heading text-lg font-semibold text-danger">
                  Reject Job
                </h3>
                <RejectModal jobId={jobId} onDone={() => setModal(null)} />
              </div>
            </div>,
            document.body
          )}

          {/* Applications stat */}
          <Section title="Applications">
            <div className="flex items-center gap-3 text-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent font-bold">
                {job._count.applications}
              </div>
              <span className="text-text-secondary">
                {job._count.applications === 0
                  ? 'No applications yet'
                  : `${job._count.applications} application${job._count.applications !== 1 ? 's' : ''} received`}
              </span>
            </div>
          </Section>

          {/* Approval timeline */}
          {job.approvalWorkflows.length > 0 && (
            <Section title="Approval History">
              <ApprovalTimeline workflows={job.approvalWorkflows} />
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}
