import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarSync, CalendarPlus, CalendarArrowDown, Ban, Pencil, Users, Link2, Clock, CheckCircle2, Copy, CalendarCheck2, AlertCircle, Video } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { SendInviteButton } from '../../components/common/SendInviteButton.js';
import { ScheduleDrawer } from './ScheduleDrawer.js';
import { formatUtcFull } from '../../utils/datetime.js';
import { googleCalendarUrl, downloadIcs, type CalendarEvent } from '../../utils/calendar.js';
import * as scheduleApi from '../../services/scheduleApi.js';
import * as interviewApi from '../../services/interviewApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS, type InterviewStatus } from '@agnohire/shared';
import { useConfirm } from '../../providers/ConfirmProvider.js';

interface Props {
  open: boolean;
  onClose: () => void;
  interviewId: string | null;
}

const STATUS_VARIANT: Record<InterviewStatus, 'muted' | 'info' | 'success' | 'danger' | 'warning'> = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  EVALUATING: 'warning',
  EVALUATED: 'success',
  CANCELLED: 'danger',
  EXPIRED: 'danger',
};

export function ScheduleDetailPanel({ open, onClose, interviewId }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission(PERMISSIONS.INTERVIEW_SCHEDULE);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['schedule', interviewId],
    queryFn: () => scheduleApi.fetchSchedule(interviewId!),
    enabled: open && !!interviewId,
  });
  const schedule = data?.schedule;

  const cancelMutation = useMutation({
    mutationFn: () => scheduleApi.cancelSchedule(interviewId!),
    onSuccess: () => {
      toast.success('Interview cancelled');
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedule', interviewId] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not cancel the interview')),
  });

  const syncMutation = useMutation({
    mutationFn: () => scheduleApi.syncCalendar(interviewId!),
    onSuccess: (r) => toast.success(r.message),
    onError: (e) => toast(apiErrorMessage(e, 'Calendar sync failed'), { icon: '🔌' }),
  });

  const meetMutation = useMutation({
    mutationFn: () => scheduleApi.generateMeet(interviewId!),
    onSuccess: () => {
      toast.success('Google Meet link generated');
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedule', interviewId] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not generate a Meet link')),
  });

  const completeMutation = useMutation({
    mutationFn: () => scheduleApi.completeSchedule(interviewId!),
    onSuccess: () => {
      toast.success('Interview marked completed');
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedule', interviewId] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not mark the interview completed')),
  });

  const inviteMutation = useMutation({
    mutationFn: (selectedChannels?: string[]) => scheduleApi.sendScheduleInvite(interviewId!, selectedChannels),
    onSuccess: ({ result }) => {
      const candidate = result.candidate as any;
      if (candidate.skipped === 'not-configured') {
        toast.error('Email is not configured — add SMTP settings in System Config → Email, then retry.', { duration: 6000 });
        return;
      }
      const who = [
        candidate.sent ? 'candidate' : null,
        result.interviewersSent > 0 ? `${result.interviewersSent}/${result.interviewersTotal} interviewer(s)` : null,
      ].filter(Boolean);
      if (who.length) toast.success(`Invite sent to ${who.join(' + ')}`);
      else toast.error(candidate.error || 'Invite could not be sent');

      if (candidate.whatsappStatus) {
        if (candidate.whatsappStatus === 'SENT') {
          toast.success('WhatsApp invitation sent successfully');
        } else if (candidate.whatsappStatus === 'SKIPPED') {
          toast(`WhatsApp invitation skipped: ${candidate.whatsappReason || 'Verification failed'}`, { icon: '⚠️' });
        } else if (candidate.whatsappStatus === 'FAILED') {
          toast.error(`WhatsApp invitation failed: ${candidate.whatsappReason || 'Meta API error'}`);
        }
      }
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not send the invite')),
  });

  const submitDecisionMutation = useMutation({
    mutationFn: (data: any) => interviewApi.submitDecision(schedule!.id, data), // ScheduleDetail.id IS the interview id (1:1)
    onSuccess: () => {
      toast.success('Decision submitted successfully');
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedule', interviewId] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not submit the decision')),
  });

  const active = schedule && ['SCHEDULED', 'IN_PROGRESS'].includes(schedule.status);
  const needsDecision = schedule && schedule.status === 'COMPLETED' && (!schedule.finalDecision || schedule.finalDecision === 'HOLD');

  const [decision, setDecision] = useState<string>('');
  const [comments, setComments] = useState('');
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');

  const handleClose = () => {
    onClose();
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={handleClose}
        title={schedule ? schedule.candidate.fullName : 'Scheduled Interview'}
        subtitle={schedule?.candidate.email}
        size="lg"
      >
        {isLoading || !schedule ? (
          <div className="py-12 text-center"><Spinner className="mx-auto" /></div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[schedule.status]}>{schedule.status.replace('_', ' ')}</Badge>
              <Badge variant="outline">{schedule.type}</Badge>
              {schedule.reminderSent && (
                <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                  <CheckCircle2 className="h-3.5 w-3.5" /> reminder sent
                </span>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <Row icon={<Clock className="h-4 w-4" />} label="When">
                {formatUtcFull(schedule.scheduledDate)} UTC
                <span className="text-text-muted"> · {schedule.duration} min · {schedule.timezone}</span>
              </Row>
              <Row icon={<Users className="h-4 w-4" />} label="Interviewers">
                <div className="flex flex-wrap gap-1.5">
                  {schedule.interviewers.map((i) => (
                    <Badge key={i.id} variant="muted">{i.fullName}</Badge>
                  ))}
                </div>
              </Row>
              {schedule.meetingLink && (
                <Row icon={<Link2 className="h-4 w-4" />} label="Meeting">
                  <div className="flex items-center gap-2">
                    <a href={schedule.meetingLink} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">
                      {schedule.meetingLink}
                    </a>
                    <button
                      type="button"
                      title="Copy meeting link"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(schedule.meetingLink!)
                          .then(() => toast.success('Meeting link copied'))
                          .catch(() => toast.error('Could not copy link'));
                      }}
                      className="shrink-0 rounded-md p-1 text-text-muted hover:bg-surface-raised hover:text-accent"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </Row>
              )}
              {schedule.recruiter && (
                <Row label="Booked by">{schedule.recruiter.fullName}</Row>
              )}
              <Row
                icon={schedule.calendarEventId ? <CalendarCheck2 className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4 text-text-muted" />}
                label="Calendar"
              >
                {schedule.calendarEventId ? (
                  <span className="text-success">Synced to Google Calendar</span>
                ) : (
                  <span className="text-text-muted">Not synced — use Auto-sync below to add</span>
                )}
              </Row>
            </div>

            {schedule.instructions && (
              <div>
                <h3 className="mb-1.5 text-sm font-semibold text-text-primary">Instructions</h3>
                <p className="whitespace-pre-wrap text-sm text-text-secondary">{schedule.instructions}</p>
              </div>
            )}

            {needsDecision && canManage && (
              <div className="border-t border-border pt-4 mt-6 space-y-4">
                <h3 className="text-lg font-semibold text-text-primary">Interview Decision</h3>
                <p className="text-sm text-text-muted">Please provide your final decision to progress the candidate.</p>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    {['PASS', 'FAIL', 'HOLD'].map(d => (
                      <label key={d} className={`flex-1 border rounded-md p-3 cursor-pointer transition-colors ${decision === d ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-raised'}`}>
                        <div className="flex items-center gap-2">
                          <input type="radio" name="decision" value={d} checked={decision === d} onChange={(e) => setDecision(e.target.value)} className="accent-accent" />
                          <span className="font-medium text-sm">{d}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text-primary mb-1 block">Decision Comments <span className="text-danger">*</span></label>
                    <textarea className="w-full rounded-md border border-border bg-surface p-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" rows={3} value={comments} onChange={e => setComments(e.target.value)} placeholder="Provide overall feedback..." required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-text-primary mb-1 block">Strengths</label>
                      <textarea className="w-full rounded-md border border-border bg-surface p-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" rows={2} value={strengths} onChange={e => setStrengths(e.target.value)} placeholder="Areas candidate did well..." />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-text-primary mb-1 block">Improvements</label>
                      <textarea className="w-full rounded-md border border-border bg-surface p-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" rows={2} value={improvements} onChange={e => setImprovements(e.target.value)} placeholder="Areas to improve..." />
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button 
                      type="button" 
                      onClick={() => submitDecisionMutation.mutate({ decision, interviewerComments: comments, strengths, improvements })}
                      disabled={!decision || !comments.trim()}
                      loading={submitDecisionMutation.isPending}
                    >
                      Submit Decision
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {canManage && active && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button variant="outline" type="button" onClick={() => setRescheduleOpen(true)}>
                  <Pencil className="h-4 w-4" /> Reschedule
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => window.open(googleCalendarUrl(toCalendarEvent(schedule)), '_blank')}
                >
                  <CalendarPlus className="h-4 w-4" /> Google Calendar
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() =>
                    downloadIcs(
                      toCalendarEvent(schedule),
                      `interview-${schedule.candidate.fullName.replace(/\s+/g, '-').toLowerCase()}.ics`,
                    )
                  }
                >
                  <CalendarArrowDown className="h-4 w-4" /> Download .ics
                </Button>
                <Button variant="outline" type="button" loading={syncMutation.isPending} onClick={() => syncMutation.mutate()}>
                  <CalendarSync className="h-4 w-4" /> Auto-sync
                </Button>
                {!schedule.meetingLink && (
                  <Button
                    variant="outline"
                    type="button"
                    loading={meetMutation.isPending}
                    title="Create a Google Meet link for this interview"
                    onClick={() => meetMutation.mutate()}
                  >
                    <Video className="h-4 w-4" /> Generate Meet link
                  </Button>
                )}
                <SendInviteButton
                  variant="outline"
                  size="sm"
                  loading={inviteMutation.isPending}
                  disabled={!schedule.meetingLink}
                  title={schedule.meetingLink ? 'Email the candidate their meeting details' : 'Add a meeting link first'}
                  onSend={(channels) => inviteMutation.mutate(channels)}
                />
                <Button
                  variant="outline"
                  type="button"
                  loading={completeMutation.isPending}
                  title="Mark this meeting interview as completed"
                  onClick={() => completeMutation.mutate()}
                >
                  <CheckCircle2 className="h-4 w-4" /> Mark as completed
                </Button>
                <Button
                  variant="danger"
                  type="button"
                  className="ml-auto"
                  loading={cancelMutation.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Cancel Interview',
                        message: 'Cancel this scheduled interview?',
                        confirmText: 'Cancel',
                        variant: 'danger',
                      })
                    ) {
                      cancelMutation.mutate();
                    }
                  }}
                >
                  <Ban className="h-4 w-4" /> Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ScheduleDrawer open={rescheduleOpen} onClose={() => setRescheduleOpen(false)} schedule={schedule ?? null} />
    </>
  );
}

function toCalendarEvent(schedule: {
  candidate: { fullName: string };
  scheduledDate: string;
  duration: number;
  meetingLink: string | null;
  instructions: string | null;
  interviewers: { fullName: string }[];
}): CalendarEvent {
  return {
    title: `Interview — ${schedule.candidate.fullName}`,
    start: schedule.scheduledDate,
    durationMin: schedule.duration,
    location: schedule.meetingLink ?? undefined,
    description: [
      schedule.meetingLink ? `Join: ${schedule.meetingLink}` : null,
      schedule.interviewers.length
        ? `Interviewers: ${schedule.interviewers.map((i) => i.fullName).join(', ')}`
        : null,
      schedule.instructions,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function Row({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="mt-0.5 flex w-28 shrink-0 items-center gap-1.5 text-text-muted">
        {icon}{label}
      </span>
      <div className="min-w-0 flex-1 text-text-secondary">{children}</div>
    </div>
  );
}
