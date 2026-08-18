import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Video, Calendar, Clock, CheckCircle2, PlayCircle, Lock, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Badge, type BadgeProps } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { fetchMyInterviews, fetchMyApplications } from '../../services/candidatePortalApi.js';
import type { MyInterviewItem, MyApplicationItem } from '@agnohire/shared';
import { cn } from '../../utils/cn.js';
import { getAccessToken } from '../../services/api.js';

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  EVALUATED: 'success',
  CANCELLED: 'muted',
  EXPIRED: 'danger',
  TERMINATED: 'danger',
};

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : 'Not scheduled yet';

function formatTitleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

// The Google Meet join opens shortly before the slot (so a candidate can't join
// hours early) and expires a fixed 24h after the start — the link is valid for
// at most one day, then it's dead.
const JOIN_OPEN_LEAD_MIN = 10;
const LINK_MAX_VALID_HOURS = 24;

type JoinState =
  | { state: 'open' }
  | { state: 'upcoming'; opensAt: Date }
  | { state: 'expired' }
  | { state: 'unscheduled' };

function joinWindow(scheduledAt: string | null, _durationMin: number | null, now: number): JoinState {
  if (!scheduledAt) return { state: 'unscheduled' }; // no slot → leave the link available
  const start = new Date(scheduledAt).getTime();
  if (Number.isNaN(start)) return { state: 'unscheduled' };
  const opensAt = start - JOIN_OPEN_LEAD_MIN * 60_000;
  const expiresAt = start + LINK_MAX_VALID_HOURS * 60 * 60_000;
  if (now < opensAt) return { state: 'upcoming', opensAt: new Date(opensAt) };
  if (now > expiresAt) return { state: 'expired' };
  return { state: 'open' };
}

const fmtClock = (d: Date) =>
  d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Live clock that re-renders every 30s so the join window opens without a refresh. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function MyInterviewsPage() {
  const now = useNow();
  const { data: interviews, isLoading: isInterviewsLoading, isError: isInterviewsError } = useQuery({
    queryKey: ['my-interviews'],
    queryFn: fetchMyInterviews,
  });

  const { data: applications, isLoading: isApplicationsLoading, isError: isApplicationsError } = useQuery({
    queryKey: ['my-applications'],
    queryFn: fetchMyApplications,
  });

  const isLoading = isInterviewsLoading || isApplicationsLoading;
  const isError = isInterviewsError || isApplicationsError;

  return (
    <div>
      <PageHeader title="My Interviews" description="Your scheduled and completed interviews." />

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : isError ? (
        <Empty icon={Video} title="Could not load your data" hint="Please try again in a moment." />
      ) : (
        <div className="space-y-8">
          {/* Applications / Interview Progress */}
          {applications && applications.length > 0 && (
            <div className="space-y-4">
              <h2 className="font-heading text-lg font-semibold text-text-primary">Interview Progress</h2>
              <div className="space-y-3">
                {applications.map(app => (
                  <ApplicationProgressCard key={app.id} app={app} />
                ))}
              </div>
            </div>
          )}

          {/* Interviews */}
          <div className="space-y-4">
            <h2 className="font-heading text-lg font-semibold text-text-primary">Scheduled Interviews</h2>
            {(!interviews || interviews.length === 0) ? (
              <Empty icon={Video} title="No interviews yet" hint="When a recruiter schedules an interview, it will appear here." />
            ) : (
              <div className="space-y-3">
                {interviews.map((iv) => (
                  <InterviewCard key={iv.id} iv={iv} now={now} applications={applications || []} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InterviewCard({ iv, now, applications }: { iv: MyInterviewItem; now: number; applications: MyApplicationItem[] }) {
  let canTake = Boolean(iv.accessToken);
  let lockedMessage: string | null = null;
  const closed = ['CANCELLED', 'EXPIRED', 'COMPLETED', 'EVALUATED'].includes(iv.status);
  const join = joinWindow(iv.scheduledAt, iv.duration, now);

  // Round-gating: a candidate can't start a later round before clearing the prior
  // one, and a rejected workflow locks the interview entirely.
  if (iv.jobRequisitionId && iv.roundNumber) {
    const app = applications.find(a => a.jobRequisitionId === iv.jobRequisitionId);
    if (app) {
      if (app.workflowStatus === 'REJECTED') {
        canTake = false;
        lockedMessage = 'Candidate did not qualify for this round.';
      } else if (iv.roundNumber > app.currentRound) {
        canTake = false;
        lockedMessage = `You must complete Round ${app.currentRound} first.`;
      }
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-raised p-5 shadow-elev-1">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Video className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-sm font-semibold text-text-primary">{formatTitleCase(iv.type)} Interview</h3>
            <Badge variant={STATUS_VARIANT[iv.status] ?? 'muted'}>{formatTitleCase(iv.status)}</Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {fmtDateTime(iv.scheduledAt)}</span>
            {iv.duration != null && (
              <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {iv.duration} min</span>
            )}
            {iv.completedAt && (
              <span className="inline-flex items-center gap-1.5 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Completed</span>
            )}
            {iv.roundNumber && (
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-accent" /> Round {iv.roundNumber}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
        {iv.meetingLink && !closed && <MeetingJoin join={join} link={iv.meetingLink} />}
        {lockedMessage && (
          <div className="inline-flex items-center gap-1.5 rounded-xl bg-surface-raised px-3.5 py-2 text-sm font-semibold text-text-muted cursor-not-allowed border border-border" title={lockedMessage}>
            <Lock className="h-4 w-4" /> Locked
          </div>
        )}
        {canTake && !lockedMessage && (
          <Link
            to={`/interview/${iv.accessToken}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
          >
            <PlayCircle className="h-4 w-4" /> {iv.status === 'IN_PROGRESS' ? 'Resume' : 'Start'} interview
          </Link>
        )}
      </div>
      </div>

      {iv.result && (
        <div className="mt-4 w-full rounded-xl border border-border bg-surface p-4 sm:col-span-full">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-heading text-sm font-semibold text-text-primary">Performance Report</h4>
            {iv.result.hasFeedbackPdf && (
              <a href={`/api/me/interviews/${iv.id}/report?token=${getAccessToken() ?? ''}`} target="_blank" rel="noreferrer" download>
                <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                  Download PDF
                </button>
              </a>
            )}
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Final Result</p>
              <div className="flex items-center gap-2">
                <Badge variant={iv.result.decision === 'PASS' ? 'success' : iv.result.decision === 'FAIL' ? 'danger' : 'info'}>
                  {iv.result.decision ?? iv.result.aiDecision ?? 'Pending'}
                </Badge>
                {iv.result.percentageScore != null && (
                  <span className="text-sm font-medium text-text-secondary">{Math.round(iv.result.percentageScore)}%</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Summary</p>
              <p className="text-sm text-text-secondary line-clamp-2">
                {iv.result.aiSummary || 'Candidate evaluated based on standard interview criteria.'}
              </p>
            </div>
            
            {iv.result.strengths && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-text-muted mb-1">Strengths</p>
                <p className="whitespace-pre-wrap text-sm text-text-secondary">{iv.result.strengths}</p>
              </div>
            )}
            
            {iv.result.improvements && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-text-muted mb-1">Areas for Improvement</p>
                <p className="whitespace-pre-wrap text-sm text-text-secondary">{iv.result.improvements}</p>
              </div>
            )}

            {iv.result.failureReason && (
              <div className="sm:col-span-2 rounded-lg bg-danger/5 p-3 border border-danger/10">
                <p className="text-xs font-medium text-danger mb-1">Reason for Failure</p>
                <p className="whitespace-pre-wrap text-sm text-danger/90">{iv.result.failureReason}</p>
              </div>
            )}
            
            {iv.result.recommendedLearning && (
              <div className="sm:col-span-2 rounded-lg bg-accent/5 p-3 border border-accent/10">
                <p className="text-xs font-medium text-accent mb-1">Recommended Learning Path</p>
                <p className="whitespace-pre-wrap text-sm text-text-secondary">{iv.result.recommendedLearning}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MeetingJoin({ join, link }: { join: JoinState; link: string }) {
  if (join.state === 'open' || join.state === 'unscheduled') {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
      >
        <Video className="h-4 w-4" /> Join Google Meet
      </a>
    );
  }
  if (join.state === 'upcoming') {
    return (
      <span
        title={`The meeting link opens ${fmtClock(join.opensAt)}`}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-text-muted"
      >
        <Clock className="h-4 w-4" /> Join opens {fmtClock(join.opensAt)}
      </span>
    );
  }
  // expired
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-text-muted">
      <Lock className="h-4 w-4" /> Link expired
    </span>
  );
}

function Empty({ icon: Icon, title, hint }: { icon: typeof Video; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-raised px-6 py-16 text-center">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-text-muted">
        <Icon className="h-7 w-7" />
      </span>
      <h3 className="font-heading text-base font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-text-muted">{hint}</p>
    </div>
  );
}

function ApplicationProgressCard({ app }: { app: MyApplicationItem }) {
  const rounds = app.workflowRounds || [];

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-elev-1">
      <div className="mb-4">
        <h3 className="font-heading text-sm font-semibold text-text-primary">{app.jobTitle}</h3>
        <p className="text-xs text-text-muted mt-1">Status: <span className="font-medium text-text-secondary">{formatTitleCase(app.status)}</span></p>
      </div>

      {rounds.length === 0 ? (
        <p className="text-sm text-text-muted">No specific interview rounds defined for this position.</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0 mt-4 relative">
          {rounds.map((round, index) => {
            const isCompleted = index < app.completedRounds;
            const isCurrent = index === app.currentRound;
            const isFailed = index === app.failedRound;


            let dotColor = 'bg-border';
            let textColor = 'text-text-muted';
            let statusText = 'Locked';

            if (isCompleted) {
              dotColor = 'bg-success';
              textColor = 'text-text-primary';
              statusText = 'Completed';
            } else if (isCurrent) {
              dotColor = 'bg-accent';
              textColor = 'text-accent';
              statusText = 'In Progress';
            } else if (isFailed) {
              dotColor = 'bg-danger';
              textColor = 'text-danger';
              statusText = 'Failed';
            }

            return (
              <div key={round.id} className="flex-1 relative flex flex-col sm:items-center">
                <div className="flex items-center w-full sm:justify-center relative z-10">
                  <div className={cn("h-4 w-4 rounded-full border-2 border-surface shrink-0 z-10", dotColor)} />
                  {/* Connecting line */}
                  {index < rounds.length - 1 && (
                    <div className={cn(
                      "absolute top-1/2 left-1/2 w-full h-0.5 -translate-y-1/2 hidden sm:block",
                      isCompleted ? "bg-success" : "bg-border"
                    )} />
                  )}
                </div>
                
                <div className="ml-6 sm:ml-0 sm:mt-3 sm:text-center">
                  <p className={cn("text-xs font-semibold", textColor)}>{formatTitleCase(round.roundName)}</p>
                  <p className="text-[10px] text-text-muted mt-0.5">{statusText}</p>
                </div>

                {/* Mobile line */}
                {index < rounds.length - 1 && (
                  <div className={cn(
                    "absolute left-[7px] top-4 bottom-[-16px] w-0.5 sm:hidden",
                    isCompleted ? "bg-success" : "bg-border"
                  )} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
