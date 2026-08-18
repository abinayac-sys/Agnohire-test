import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Copy, Check, AlertTriangle, Ban, ShieldX, Camera, Mic, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { SendInviteButton } from '../../components/common/SendInviteButton.js';
import * as interviewApi from '../../services/interviewApi.js';
import { useAuthStore } from '../../store/authStore.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { formatTitleCase, PERMISSIONS, SOCKET_EVENTS,
  type InterviewStatus,
  type CandidateAnswerItem,
  type ViolationType,
  type ProctorShotMeta,
  type InterviewUpdatedEvent,
  type QuestionItem, } from '@agnohire/shared';
import { getSocket } from '../../services/socket.js';

const VIOLATION_LABELS: Record<ViolationType, string> = {
  TAB_SWITCH: 'Switched tab / left the window',
  FULLSCREEN_EXIT: 'Exited fullscreen',
  WINDOW_BLUR: 'Left the interview window',
  COPY_PASTE: 'Copy / paste detected',
  CAMERA_BLOCKED: 'Camera turned off or blocked',
  MIC_BLOCKED: 'Microphone turned off or blocked',
  NO_FACE: 'No face visible on camera',
  MULTIPLE_FACES: 'Multiple faces detected',
  MULTIPLE_VOICES: 'Another voice detected (audio analysis)',
  FREQUENT_MOVEMENT: 'Frequent face movement detected',
  MOBILE_PHONE: 'Mobile phone detected',
  SUSPICIOUS_OBJECT: 'Suspicious object detected',
  UNUSUAL_NOISE: 'Unusual background noise detected',
  FACE_MISMATCH: 'Biometric mismatch detected',
  INTEGRITY_VIOLATION: 'Biometric verification failed (repeated mismatch)',
};

const SHOT_REASON_LABELS: Record<ProctorShotMeta['reason'], string> = {
  START: 'Start',
  PERIODIC: 'Routine',
  VIOLATION: 'On violation',
  TERMINATION: 'At termination',
};

/** Lazily loads one proctoring snapshot as an authenticated blob thumbnail. */
function ProctorThumb({ interviewId, shot }: { interviewId: string; shot: ProctorShotMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let made: string | null = null;
    interviewApi
      .fetchProctorShot(interviewId, shot.id)
      .then((u) => {
        if (revoked) {
          URL.revokeObjectURL(u);
        } else {
          made = u;
          setUrl(u);
        }
      })
      .catch(() => {});
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [interviewId, shot.id]);

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="group relative block aspect-video overflow-hidden rounded-md border border-border bg-surface-raised"
      title={`${SHOT_REASON_LABELS[shot.reason]} · ${format(new Date(shot.capturedAt), 'HH:mm:ss')}`}
    >
      {url ? (
        <img src={url} alt="Proctor snapshot" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-text-muted">
          <Camera className="h-4 w-4 animate-pulse" />
        </div>
      )}
      <span
        className={`absolute bottom-0 left-0 right-0 px-1.5 py-0.5 text-[10px] font-medium ${
          shot.reason === 'VIOLATION' || shot.reason === 'TERMINATION'
            ? 'bg-danger/80 text-white'
            : 'bg-black/55 text-white'
        }`}
      >
        {SHOT_REASON_LABELS[shot.reason]} · {format(new Date(shot.capturedAt), 'HH:mm:ss')}
      </span>
    </a>
  );
}

/** Loads the interview audio recording as an authenticated blob and plays it. */
function RecordingPlayer({ recordingUrl }: { recordingUrl: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = false;
    let made: string | null = null;
    interviewApi
      .fetchRecording(recordingUrl)
      .then((u) => {
        if (revoked) URL.revokeObjectURL(u);
        else {
          made = u;
          setUrl(u);
        }
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [recordingUrl]);

  if (failed) return <p className="text-sm text-text-muted">Recording unavailable.</p>;
  if (!url) return <p className="text-sm text-text-muted">Loading recording…</p>;
  return <audio controls src={url} className="w-full" />;
}

interface Props {
  open: boolean;
  onClose: () => void;
  interviewId: string | null;
}

const STATUS_VARIANT: Record<InterviewStatus, 'muted' | 'info' | 'warning' | 'success' | 'danger'> = {
  SCHEDULED: 'muted',
  IN_PROGRESS: 'info',
  COMPLETED: 'info',
  EVALUATING: 'warning',
  EVALUATED: 'success',
  CANCELLED: 'danger',
  EXPIRED: 'danger',
};

function interviewLink(token: string): string {
  return `${window.location.origin}/interview/${token}`;
}

/** Surfaces the outcome of an email send, distinguishing the SMTP-not-configured case. */
function notifySend(result: any, okMsg: string) {
  if (result.sent) toast.success(okMsg);
  else if (result.skipped)
    toast('Email skipped — SMTP isn’t set up yet (Admin → System Config → Email).', { icon: '✉️' });
  else toast.error(result.error || 'Email failed to send');

  if (result.whatsappStatus) {
    if (result.whatsappStatus === 'SENT') {
      toast.success('WhatsApp invitation sent successfully');
    } else if (result.whatsappStatus === 'SKIPPED') {
      toast(`WhatsApp invitation skipped: ${result.whatsappReason || 'Verification failed'}`, { icon: '⚠️' });
    } else if (result.whatsappStatus === 'FAILED') {
      toast.error(`WhatsApp invitation failed: ${result.whatsappReason || 'Meta API error'}`);
    }
  }
}

export function InterviewDetailPanel({ open, onClose, interviewId }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { hasPermission } = useAuthStore();
  const canCancel = hasPermission(PERMISSIONS.INTERVIEW_SCHEDULE);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['interview', interviewId],
    queryFn: () => interviewApi.fetchInterview(interviewId!),
    enabled: open && !!interviewId,
  });

  const interview = data?.interview;

  // Live progress while this drawer is open — refetch when the socket says
  // THIS interview changed, instead of waiting for a manual refresh.
  useEffect(() => {
    if (!open || !interviewId) return;
    const socket = getSocket();
    const onUpdate = (evt: InterviewUpdatedEvent) => {
      if (evt.interviewId === interviewId) {
        qc.invalidateQueries({ queryKey: ['interview', interviewId] });
      }
    };
    socket.on(SOCKET_EVENTS.INTERVIEW_UPDATED, onUpdate);
    return () => {
      socket.off(SOCKET_EVENTS.INTERVIEW_UPDATED, onUpdate);
    };
  }, [open, interviewId, qc]);

  const cancelMutation = useMutation({
    mutationFn: () => interviewApi.cancelInterview(interviewId!),
    onSuccess: () => {
      toast.success('Interview cancelled');
      qc.invalidateQueries({ queryKey: ['interview', interviewId] });
      qc.invalidateQueries({ queryKey: ['interviews'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => interviewApi.deleteInterview(interviewId!),
    onSuccess: () => {
      toast.success('Interview deleted');
      qc.invalidateQueries({ queryKey: ['interviews'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inviteMutation = useMutation({
    mutationFn: (selectedChannels?: string[]) => interviewApi.sendInterviewInvite(interviewId!, selectedChannels),
    onSuccess: ({ result }) => notifySend(result, 'Interview invite emailed to the candidate'),
    onError: (e: Error) => toast.error(e.message),
  });

  async function copyLink() {
    if (!interview?.accessToken) return;
    await navigator.clipboard.writeText(interviewLink(interview.accessToken));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const answerByQuestion = new Map<string, CandidateAnswerItem>();
  interview?.answers.forEach((a) => answerByQuestion.set(a.questionId, a));

  // The stored question order is deliberately shuffled per candidate (see
  // interviewService's question selection) and doesn't keep sections
  // contiguous, so listing `interview.questions` as-is interleaves sections
  // seemingly at random. Group by section (stable, first-appearance order)
  // for review — same grouping the candidate saw as section folders.
  const groupedQuestions: QuestionItem[] = (() => {
    const list = interview?.questions ?? [];
    const bucket = new Map<string, QuestionItem[]>();
    const order: string[] = [];
    for (const q of list) {
      const name = (q as any).section?.name ?? 'Uncategorized';
      if (!bucket.has(name)) {
        bucket.set(name, []);
        order.push(name);
      }
      bucket.get(name)!.push(q);
    }
    return order.flatMap((name) => bucket.get(name)!);
  })();

  const result = interview?.result;
  const cancellable = interview && ['SCHEDULED', 'IN_PROGRESS'].includes(interview.status);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={interview ? interview.candidate.fullName : 'Interview'}
      subtitle={interview?.candidate.email}
      size="xl"
    >
      {isLoading || !interview ? (
        <div className="py-12 text-center">
          <Spinner className="mx-auto" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[interview.status]}>{interview.status.replace('_', ' ')}</Badge>
            {interview.questionBank && <Badge variant="outline">{interview.questionBank.name}</Badge>}
            <span className="text-xs text-text-muted">{interview._count.questions} questions</span>
            {interview.duration && (
              <span className="text-xs text-text-muted">· {interview.duration} min limit</span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-text-muted">Created</dt>
              <dd className="text-text-secondary">{format(new Date(interview.createdAt), 'dd MMM yyyy')}</dd>
            </div>
            {interview.startedAt && (
              <div>
                <dt className="text-xs text-text-muted">Started</dt>
                <dd className="text-text-secondary">{format(new Date(interview.startedAt), 'dd MMM HH:mm')}</dd>
              </div>
            )}
            {interview.completedAt && (
              <div>
                <dt className="text-xs text-text-muted">Completed</dt>
                <dd className="text-text-secondary">{format(new Date(interview.completedAt), 'dd MMM HH:mm')}</dd>
              </div>
            )}
          </dl>

          {/* Shareable link (only while pending) */}
          {interview.accessToken && ['SCHEDULED', 'IN_PROGRESS'].includes(interview.status) && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised p-3">
              <code className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                {interviewLink(interview.accessToken)}
              </code>
              <Button variant="outline" size="sm" type="button" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {canCancel && (
                <SendInviteButton
                  variant="primary"
                  size="sm"
                  loading={inviteMutation.isPending}
                  onSend={(channels) => inviteMutation.mutate(channels)}
                />
              )}
            </div>
          )}

          {/* AI result */}
          {result && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-text-primary">Results</h3>
                {result.percentageScore != null && (
                  <span className="text-2xl font-bold text-text-primary">
                    {Math.round(result.percentageScore)}%
                  </span>
                )}
                {result.totalScore != null && result.maxScore != null && (
                  <span className="text-xs text-text-muted">
                    {result.totalScore}/{result.maxScore} points
                  </span>
                )}
                {result.aiDecision && (
                  <Badge variant="info">AI: {result.aiDecision}</Badge>
                )}
              </div>
              {result.aiSummary && (
                <p className="whitespace-pre-wrap text-sm text-text-secondary">{result.aiSummary}</p>
              )}
              {result.aiReasoning && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-text-muted">AI reasoning</summary>
                  <p className="mt-1 whitespace-pre-wrap text-text-secondary">{result.aiReasoning}</p>
                </details>
              )}
            </div>
          )}

          {/* Auto-termination banner */}
          {interview.terminatedReason && (
            <div className="flex items-start gap-3 rounded-lg border border-danger/50 bg-danger/10 p-4">
              <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
              <div>
                <p className="text-sm font-semibold text-danger">Ended for malpractice</p>
                <p className="mt-0.5 text-xs text-text-secondary">{interview.terminatedReason}</p>
              </div>
            </div>
          )}

          {/* Proctoring Summary & Violations Dashboard */}
          {interview.violations && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-text-primary">Proctoring Dashboard</h3>
              
              {(() => {
                const logs = interview.violations;
                const total = logs.length;
                let multiPerson = false;
                let phone = false;
                let audio = false;
                let faceMissing = 0;
                let tabSwitch = 0;
                
                let integrityScore = 100;

                logs.forEach(v => {
                  if (v.type === 'MULTIPLE_FACES') { multiPerson = true; integrityScore -= 20; }
                  else if (v.type === 'MOBILE_PHONE') { phone = true; integrityScore -= 20; }
                  else if (v.type === 'MULTIPLE_VOICES' || v.type === 'UNUSUAL_NOISE') { audio = true; integrityScore -= 15; }
                  else if (v.type === 'SUSPICIOUS_OBJECT') { integrityScore -= 15; }
                  else if (v.type === 'NO_FACE') { faceMissing++; integrityScore -= 5; }
                  else if (v.type === 'TAB_SWITCH' || v.type === 'WINDOW_BLUR' || v.type === 'FULLSCREEN_EXIT') { tabSwitch++; integrityScore -= 5; }
                  else if (v.type === 'COPY_PASTE') { integrityScore -= 10; }
                  else if (v.type === 'FREQUENT_MOVEMENT') { integrityScore -= 5; }
                  else { integrityScore -= 5; }
                });
                
                integrityScore = Math.max(0, integrityScore);
                let riskLevel = 'Low Risk';
                if (integrityScore < 70) riskLevel = 'High Risk';
                else if (integrityScore < 90) riskLevel = 'Medium Risk';

                const severityLevel = (type: string) => {
                  if (['MULTIPLE_FACES', 'MOBILE_PHONE', 'MULTIPLE_VOICES', 'SUSPICIOUS_OBJECT', 'UNUSUAL_NOISE'].includes(type)) return 'High';
                  if (['COPY_PASTE', 'FREQUENT_MOVEMENT', 'CAMERA_BLOCKED', 'MIC_BLOCKED'].includes(type)) return 'Medium';
                  return 'Low';
                };

                return (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {/* Proctoring Summary */}
                    <div className="rounded-lg border border-border bg-surface-raised p-4">
                      <h4 className="mb-3 text-sm font-medium text-text-primary">Proctoring Summary</h4>
                      <dl className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><dt className="text-text-muted">Multiple Person Detected</dt><dd className="font-medium text-text-secondary">{multiPerson ? 'Yes' : 'No'}</dd></div>
                        <div className="flex justify-between"><dt className="text-text-muted">Tab / Window Switching</dt><dd className="font-medium text-text-secondary">{tabSwitch} Times</dd></div>
                        <div className="flex justify-between"><dt className="text-text-muted">Face Missing Events</dt><dd className="font-medium text-text-secondary">{faceMissing}</dd></div>
                        <div className="flex justify-between"><dt className="text-text-muted">Mobile Phone Detected</dt><dd className="font-medium text-text-secondary">{phone ? 'Yes' : 'No'}</dd></div>
                        <div className="flex justify-between"><dt className="text-text-muted">Multiple Voices / Noise</dt><dd className="font-medium text-text-secondary">{audio ? 'Yes' : 'No'}</dd></div>
                        <div className="mt-3 flex justify-between border-t border-border pt-2"><dt className="font-medium text-text-primary">Overall Integrity Score</dt><dd className={`font-bold ${integrityScore < 70 ? 'text-danger' : integrityScore < 90 ? 'text-warning' : 'text-success'}`}>{integrityScore}%</dd></div>
                        <div className="flex justify-between"><dt className="font-medium text-text-primary">Final Status</dt><dd className={`font-bold ${riskLevel === 'High Risk' ? 'text-danger' : riskLevel === 'Medium Risk' ? 'text-warning' : 'text-success'}`}>{riskLevel}</dd></div>
                      </dl>
                    </div>

                    {/* Violations Log */}
                    <div className="flex flex-col rounded-lg border border-border p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
                        <AlertTriangle className={`h-4 w-4 ${total > 0 ? 'text-danger' : 'text-text-muted'}`} />
                        Violation Details ({total})
                      </div>
                      <div className="flex-1 overflow-y-auto max-h-[220px] space-y-2 pr-1">
                        {total === 0 ? (
                          <p className="text-xs text-text-muted">No integrity violations recorded.</p>
                        ) : (
                          logs.map((v, i) => {
                            const sev = severityLevel(v.type);
                            return (
                              <div key={i} className="flex flex-col gap-1 rounded border border-border/50 bg-surface px-2 py-1.5 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-text-primary">{VIOLATION_LABELS[v.type as ViolationType] ?? formatTitleCase(v.type)}</span>
                                  <Badge variant={sev === 'High' ? 'danger' : sev === 'Medium' ? 'warning' : 'outline'} className="text-[9px] px-1.5 py-0">
                                    {sev} Severity
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-between text-text-muted">
                                  <span>{v.detail || '—'}</span>
                                  <span className="tabular-nums">{format(new Date(v.at), 'HH:mm:ss')}</span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Proctoring snapshots */}
              {interview.proctorShots && interview.proctorShots.length > 0 && (
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Camera className="h-4 w-4 text-text-muted" />
                    Evidence Screenshots
                    <span className="text-xs font-normal text-text-muted">
                      ({interview.proctorShots.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                    {interview.proctorShots.map((shot) => (
                      <ProctorThumb key={shot.id} interviewId={interview.id} shot={shot} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Audio recording + post-hoc voice analysis */}
          {interview.recordingUrl && (
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
                <Mic className="h-4 w-4 text-text-muted" />
                Interview audio recording
              </div>
              <RecordingPlayer recordingUrl={interview.recordingUrl} />
              <p className="mt-1.5 text-xs text-text-muted">
                Analyzed for additional speakers — any detection appears in the integrity
                violations above.
              </p>
            </div>
          )}

          {/* Transcript & AI Analysis */}
          {(interview.transcript || result?.communicationScore != null) && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold text-text-primary">Transcript & AI Analysis</h3>
              
              {result?.communicationScore != null && (
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-text-muted">Communication</dt>
                    <dd className="font-medium text-text-secondary">{result.communicationScore}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">Skill Match</dt>
                    <dd className="font-medium text-text-secondary">{result.skillMatchScore ?? 'N/A'}%</dd>
                  </div>
                  {result.sentimentResult && (
                    <div>
                      <dt className="text-xs text-text-muted">Sentiment</dt>
                      <dd className="font-medium text-text-secondary capitalize">
                        {result.sentimentResult.overall}
                      </dd>
                    </div>
                  )}
                </div>
              )}

              {result?.keywordAnalysis?.keywords?.length > 0 && (
                <div>
                  <dt className="text-xs text-text-muted mb-1.5">Top Keywords</dt>
                  <div className="flex flex-wrap gap-1.5">
                    {result?.keywordAnalysis?.keywords?.map((kw: string) => (
                      <Badge key={kw} variant="outline" className="text-[10px]">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {interview.transcript && (
                <details className="text-sm mt-3">
                  <summary className="cursor-pointer font-medium text-text-muted hover:text-text-primary">View full audio transcript</summary>
                  <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-raised p-3 text-xs text-text-secondary">
                    {interview.transcript}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Questions & answers — grouped by section (see groupedQuestions above) */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Questions & Answers</h3>
            {groupedQuestions.map((q, i) => {
              const ans = answerByQuestion.get(q.id);
              const section = (q as any).section;
              const prevSection = i > 0 ? (groupedQuestions[i - 1] as any).section : null;
              const sectionName = section?.name ?? 'Uncategorized';
              const prevSectionName = i > 0 ? (prevSection?.name ?? 'Uncategorized') : null;
              const showSectionHeader = section && sectionName !== prevSectionName;
              return (
                <div key={q.id}>
                  {showSectionHeader && (
                    <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted first:mt-0">
                      {sectionName}
                    </p>
                  )}
                <div className="rounded-lg border border-border p-4">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-text-muted">Q{i + 1}</span>
                    <Badge variant="outline">{q.type}</Badge>
                    {section && <Badge variant="outline">{section.name}</Badge>}
                    {ans?.aiScore != null && ans.maxScore != null ? (
                      <Badge variant={ans.aiScore >= ans.maxScore * 0.6 ? 'success' : 'danger'}>
                        {ans.aiScore}/{ans.maxScore}
                      </Badge>
                    ) : ans?.isCorrect != null ? (
                      <Badge variant={ans.isCorrect ? 'success' : 'danger'}>
                        {ans.isCorrect ? 'Correct' : 'Incorrect'}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-text-primary">{q.text}</p>

                  <div className="mt-2 border-t border-border pt-2">
                    {!ans ? (
                      <p className="text-xs italic text-text-muted">No answer submitted</p>
                    ) : q.type === 'MCQ' ? (
                      <p className="text-sm text-text-secondary">
                        Selected: <span className="font-medium">{ans.selectedOption ?? '—'}</span>
                      </p>
                    ) : (
                      <>
                        {q.type === 'CODE' && ans.language && (
                          <p className="mb-1 text-xs text-text-muted">
                            Language: <span className="font-medium text-text-secondary">{ans.language}</span>
                          </p>
                        )}
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-text-secondary">
                          {ans.answerCode ?? ans.answerText ?? '—'}
                        </pre>
                      </>
                    )}
                    {ans?.aiEvaluation && (
                      <p className="mt-1.5 text-xs text-text-muted">
                        <span className="font-medium">AI: </span>
                        {ans.aiEvaluation}
                      </p>
                    )}
                  </div>
                </div>
                </div>
              );
            })}
          </div>



          {/* Actions */}
          {(canCancel && cancellable) || canCancel ? (
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              {canCancel && cancellable && (
                <Button
                  variant="outline"
                  type="button"
                  loading={cancelMutation.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Cancel Interview',
                        message: 'Cancel this interview? The candidate link will stop working.',
                        confirmText: 'Cancel Interview',
                        variant: 'danger',
                      })
                    ) {
                      cancelMutation.mutate();
                    }
                  }}
                >
                  <Ban className="h-4 w-4" />
                  Cancel interview
                </Button>
              )}
              {canCancel && (
                <Button
                  variant="danger"
                  type="button"
                  loading={deleteMutation.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Delete Interview',
                        message: 'Delete this interview completely? This cannot be undone.',
                        confirmText: 'Delete interview',
                        variant: 'danger',
                      })
                    ) {
                      deleteMutation.mutate();
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete interview
                </Button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
