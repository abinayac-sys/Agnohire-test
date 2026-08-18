import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FileText, Sparkles, ShieldCheck, ClipboardCheck, Upload, Wand2, RefreshCw, ExternalLink, Save,
} from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { cn } from '../../utils/cn.js';
import { RECOMMENDATION_OPTIONS } from './reviewMeta.js';
import { useAuthStore } from '../../store/authStore.js';
import { formatTitleCase, PERMISSIONS, type ReviewDetail, type Recommendation } from '@agnohire/shared';
import * as reviewApi from '../../services/reviewApi.js';
import { getAccessToken, apiErrorMessage } from '../../services/api.js';

const TABS = [
  { key: 'transcript', label: 'Transcript', icon: FileText },
  { key: 'intelligence', label: 'Intelligence', icon: Sparkles },
  { key: 'integrity', label: 'Integrity', icon: ShieldCheck },
  { key: 'review', label: 'Review', icon: ClipboardCheck },
] as const;

export function ReviewDetailPanel({ open, onClose, reviewId }: { open: boolean; onClose: () => void; reviewId: string | null }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('transcript');
  useEffect(() => { if (open) setTab('transcript'); }, [open, reviewId]);

  const { data, isLoading } = useQuery({
    queryKey: ['review', reviewId],
    queryFn: () => reviewApi.fetchReview(reviewId!),
    enabled: !!reviewId && open,
  });
  const review = data?.review;

  return (
    <Drawer open={open} onClose={onClose} size="xl"
      title={review ? review.candidate.fullName : 'Interview review'}
      subtitle={review ? `${review.type} interview · ${review.candidate.email}` : undefined}>
      {isLoading || !review ? (
        <div className="flex h-full items-center justify-center"><Spinner /></div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-1 border-b border-border px-6">
            {TABS.map((t) => {
              const Icon = t.icon; const on = tab === t.key;
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={cn('flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                    on ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}>
                  <Icon className="h-4 w-4" /> {t.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'transcript' && <TranscriptTab review={review} />}
            {tab === 'intelligence' && <IntelligenceTab review={review} />}
            {tab === 'integrity' && <IntegrityTab review={review} />}
            {tab === 'review' && <ReviewTab review={review} onDone={onClose} />}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ─── TRANSCRIPT ──────────────────────────────────────────────────────────────

function TranscriptTab({ review }: { review: ReviewDetail }) {
  const qc = useQueryClient();
  const [recordingUrl, setRecordingUrl] = useState(review.recordingUrl ?? '');
  const [transcript, setTranscript] = useState(review.transcript ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: () => reviewApi.setReviewMedia(review.id, { recordingUrl: recordingUrl || '', transcript }),
    onSuccess: () => { toast.success('Media saved — analyzing transcript'); invalidate(qc, review.id); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });
  const transcribe = useMutation({
    mutationFn: () => reviewApi.transcribeReview(review.id),
    onSuccess: () => { toast.success('Transcribed — analyzing intelligence'); invalidate(qc, review.id); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setTranscript(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-secondary">Recording URL</label>
        <div className="flex gap-2">
          <Input placeholder="https://…" value={recordingUrl} onChange={(e) => setRecordingUrl(e.target.value)} />
          {review.recordingUrl && (
            <a href={review.recordingUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" size="icon" type="button"><ExternalLink className="h-4 w-4" /></Button>
            </a>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-sm font-medium text-text-secondary">Transcript</label>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".txt,.vtt,.srt,text/plain" className="hidden" onChange={onFile} />
            <Button variant="ghost" size="sm" type="button" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload .txt/.vtt</Button>
            <Button variant="ghost" size="sm" type="button" onClick={() => transcribe.mutate()} loading={transcribe.isPending}><Wand2 className="h-4 w-4" /> Transcribe (AI)</Button>
          </div>
        </div>
        <Textarea rows={14} placeholder={'Paste the interview transcript. Speaker labels like "Candidate:" / "Interviewer:" enable talk-ratio analysis.'}
          value={transcript} onChange={(e) => setTranscript(e.target.value)} className="font-mono text-xs" />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!recordingUrl && !transcript.trim()}>
          <Save className="h-4 w-4" /> Save & analyze
        </Button>
      </div>
    </div>
  );
}

// ─── INTELLIGENCE ────────────────────────────────────────────────────────────

function IntelligenceTab({ review }: { review: ReviewDetail }) {
  const qc = useQueryClient();
  const intel = review.intelligence;
  const reanalyze = useMutation({
    mutationFn: () => reviewApi.reanalyzeReview(review.id),
    onSuccess: () => { toast.success('Re-analyzing…'); setTimeout(() => invalidate(qc, review.id), 600); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  if (!intel) {
    return <p className="text-sm text-text-muted">No transcript yet. Add one in the Transcript tab to generate intelligence.</p>;
  }
  const m = intel.metrics;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {intel.aiGenerated
            ? <Badge variant="info"><Sparkles className="mr-1 h-3 w-3" /> AI analyzed</Badge>
            : <Badge variant="muted">Deterministic only — AI key not configured</Badge>}
        </div>
        <Button variant="outline" size="sm" onClick={() => reanalyze.mutate()} loading={reanalyze.isPending}><RefreshCw className="h-4 w-4" /> Re-analyze</Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ScoreCard label="Communication" value={intel.communicationScore} />
        <ScoreCard label="Skill match" value={intel.skillMatchScore} />
      </div>

      {intel.sentiment && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h4 className="mb-2 text-sm font-medium text-text-primary">Sentiment — {intel.sentiment.overall}</h4>
          <div className="flex h-3 overflow-hidden rounded-full">
            <div className="bg-success" style={{ width: `${intel.sentiment.positive}%` }} />
            <div className="bg-surface-overlay" style={{ width: `${intel.sentiment.neutral}%` }} />
            <div className="bg-danger" style={{ width: `${intel.sentiment.negative}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-text-muted">
            <span>+{intel.sentiment.positive}%</span><span>{intel.sentiment.neutral}% neutral</span><span>−{intel.sentiment.negative}%</span>
          </div>
        </div>
      )}

      {intel.transcriptSummary && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h4 className="mb-1.5 text-sm font-medium text-text-primary">AI summary</h4>
          <p className="text-sm leading-relaxed text-text-secondary">{intel.transcriptSummary}</p>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-sm font-medium text-text-primary">Keywords</h4>
        <div className="flex flex-wrap gap-1.5">
          {intel.keywords.length ? intel.keywords.map((k) => <Badge key={k} variant="outline">{k}</Badge>) : <span className="text-sm text-text-muted">—</span>}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-medium text-text-primary">Transcript metrics</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric label="Words" value={m.wordCount} />
          <Metric label="Words / min" value={m.wordsPerMinute ?? '—'} />
          <Metric label="Filler words" value={`${m.fillerCount} (${m.fillerRatio}%)`} />
          <Metric label="Questions" value={m.questionCount} />
          <Metric label="Candidate talk" value={m.candidateTalkRatio != null ? `${m.candidateTalkRatio}%` : '—'} />
        </div>
      </div>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 font-heading text-2xl font-bold text-text-primary">{value != null ? `${value}` : '—'}<span className="text-base text-text-muted">/100</span></p>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}

// ─── INTEGRITY ───────────────────────────────────────────────────────────────

const SEVERITY_VARIANT = { clean: 'success', low: 'info', medium: 'warning', high: 'danger' } as const;

function IntegrityTab({ review }: { review: ReviewDetail }) {
  const ig = review.integrity;
  const bio = review.biometricReport;

  const history = Array.isArray(bio?.matchHistory) ? bio.matchHistory : [];
  const validScores = history.filter((h: any) => h.score !== undefined);
  const avgScore = validScores.length > 0
    ? Math.round(validScores.reduce((acc: number, curr: any) => acc + curr.score, 0) / validScores.length)
    : 0;

  const bioStatusLabel = {
    VERIFIED: 'Verified Candidate',
    FLAGGED: 'Suspicious Activity',
    FAILED: 'Failed Verification'
  }[bio?.verificationStatus ?? 'VERIFIED'] || bio?.verificationStatus;

  const bioStatusVariant = {
    VERIFIED: 'success',
    FLAGGED: 'warning',
    FAILED: 'danger'
  }[bio?.verificationStatus ?? 'VERIFIED'] || 'muted';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Integrity Violations</h3>
        <div className="flex items-center gap-3 mb-3">
          <Badge variant={SEVERITY_VARIANT[ig.severity]}>{ig.severity.toUpperCase()}</Badge>
          <span className="text-sm text-text-secondary">{ig.totalStrikes} violation{ig.totalStrikes === 1 ? '' : 's'} captured</span>
        </div>

        {ig.byType.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {ig.byType.map((b) => <Badge key={b.type} variant="outline">{formatTitleCase(b.type)} × {b.count}</Badge>)}
          </div>
        )}

        {ig.timeline.length === 0 ? (
          <p className="text-sm text-text-muted mb-6">No proctoring violations recorded — clean session.</p>
        ) : (
          <ol className="space-y-2 border-l border-border pl-4 mb-6">
            {ig.timeline.map((v, i) => (
              <li key={i} className="relative text-sm">
                <span className="absolute -left-[1.31rem] top-1.5 h-2 w-2 rounded-full bg-warning" />
                <span className="font-medium text-text-secondary">{formatTitleCase(v.type)}</span>
                {v.at && <span className="ml-2 text-xs text-text-muted">{new Date(v.at).toLocaleString()}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-border pt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Biometric Verification Report</h3>
        {!bio ? (
          <p className="text-sm text-text-muted">No biometric enrollment recorded for this interview.</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Badge variant={bioStatusVariant as any}>{bioStatusLabel}</Badge>
              <span className="text-xs text-text-muted">Enrolled on {new Date(bio.enrollmentTimestamp).toLocaleString()}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Total Checks" value={bio.totalChecks} />
              <Metric label="Avg Match Score" value={bio.totalChecks > 0 ? `${avgScore}%` : '—'} />
              <Metric label="Warnings Issued" value={bio.warningsIssued} />
              <Metric label="Failed / No-Face" value={`${bio.failedMatches} / ${bio.noFaceEvents}`} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-1.5">Master Profile (Enrollment)</p>
                <div className="aspect-video overflow-hidden rounded-lg border border-border bg-black">
                  <img src={bio.enrollmentImage} alt="Master Profile" className="h-full w-full object-cover" />
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-1.5">Latest Captured Frame</p>
                <div className="aspect-video overflow-hidden rounded-lg border border-border bg-black">
                  {bio.latestImage ? (
                    <img src={bio.latestImage} alt="Latest Frame" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-text-muted text-xs">No verification frames captured</div>
                  )}
                </div>
              </div>
            </div>

            {history.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-2">Match History</p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-raised/40 p-3">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-text-muted border-b border-border">
                        <th className="pb-1.5 text-left">Time</th>
                        <th className="pb-1.5 text-left">Match Score</th>
                        <th className="pb-1.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {history.map((h: any, idx: number) => (
                        <tr key={idx} className="text-text-secondary">
                          <td className="py-1.5">{new Date(h.timestamp).toLocaleTimeString()}</td>
                          <td className="py-1.5">{h.noFace ? '—' : `${h.score}%`}</td>
                          <td className="py-1.5">
                            {h.noFace ? (
                              <span className="text-danger">No Face</span>
                            ) : h.multipleFaces ? (
                              <span className="text-danger">Multiple Faces</span>
                            ) : h.isMatch ? (
                              <span className="text-success">Matched</span>
                            ) : (
                              <span className="text-danger">Mismatch</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── REVIEW ──────────────────────────────────────────────────────────────────

function ReviewTab({ review, onDone }: { review: ReviewDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const canDecide = hasPermission(PERMISSIONS.INTERVIEW_DECIDE);
  const [recommendation, setRecommendation] = useState<Recommendation | ''>(review.recommendation ?? '');
  const [notes, setNotes] = useState(review.reviewerNotes ?? '');

  const submit = useMutation({
    mutationFn: () => reviewApi.submitReview(review.id, { recommendation: recommendation as Recommendation, reviewerNotes: notes || '' }),
    onSuccess: () => { toast.success('Review submitted'); invalidate(qc, review.id); onDone(); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  if (!canDecide) {
    return <p className="text-sm text-text-muted">You don't have permission to submit a hiring recommendation.</p>;
  }

  return (
    <div className="space-y-5">
      {review.percentageScore != null && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-secondary">Auto-graded interview score</span>
            <span className="text-lg font-bold text-text-primary">{Math.round(review.percentageScore)}%</span>
          </div>
          
          {review.decision && (
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-sm font-medium text-text-secondary">Decision</span>
              <Badge variant={review.decision === 'PASS' ? 'success' : review.decision === 'FAIL' ? 'danger' : 'info'}>{review.decision}</Badge>
            </div>
          )}

          {review.strengths && (
            <div className="border-t border-border pt-2">
              <span className="text-sm font-medium text-text-secondary block mb-1">Strengths</span>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{review.strengths}</p>
            </div>
          )}

          {review.improvements && (
            <div className="border-t border-border pt-2">
              <span className="text-sm font-medium text-text-secondary block mb-1">Areas for Improvement</span>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{review.improvements}</p>
            </div>
          )}

          {review.failureReason && (
            <div className="border-t border-border pt-2">
              <span className="text-sm font-medium text-danger block mb-1">Reason for Failure</span>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{review.failureReason}</p>
            </div>
          )}

          {review.recommendedLearning && (
            <div className="border-t border-border pt-2">
              <span className="text-sm font-medium text-text-secondary block mb-1">Recommended Learning Path</span>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{review.recommendedLearning}</p>
            </div>
          )}

          {review.feedbackPdfPath && (
            <div className="border-t border-border pt-3">
              <a href={`/api/reviews/${review.id}/report?token=${getAccessToken() ?? ''}`} target="_blank" rel="noreferrer" download>
                <Button variant="outline" size="sm" type="button">
                  <ExternalLink className="h-4 w-4 mr-2" /> Download Feedback PDF
                </Button>
              </a>
            </div>
          )}
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-secondary">Recommendation</label>
        <Select options={RECOMMENDATION_OPTIONS} placeholder="Select a recommendation…" value={recommendation} onChange={(e) => setRecommendation(e.target.value as Recommendation)} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-secondary">Reviewer notes</label>
        <Textarea rows={6} placeholder="Rationale, strengths, concerns…" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {review.reviewedAt && <p className="text-xs text-text-muted">Last reviewed {new Date(review.reviewedAt).toLocaleString()}</p>}
      <div className="flex justify-end">
        <Button onClick={() => submit.mutate()} loading={submit.isPending} disabled={!recommendation}>Submit review</Button>
      </div>
    </div>
  );
}

function invalidate(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ['review', id] });
  qc.invalidateQueries({ queryKey: ['reviews'] });
}
