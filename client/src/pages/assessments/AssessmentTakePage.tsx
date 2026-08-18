import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, ClipboardCheck, ShieldAlert, ShieldX,
  Camera, Mic, Video,
} from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { apiErrorMessage } from '../../services/api.js';
import * as assessmentApi from '../../services/assessmentApi.js';
import { useMediaProctor } from '../interviews/useMediaProctor.js';
import { useAudioRecorder } from '../interviews/useAudioRecorder.js';
import { useFaceMonitor, useVideoAccessor } from '../interviews/useFaceMonitor.js';
import { CODE_LANGUAGES, type PublicAssessment, type PublicQuestion, type ViolationType } from '@agnohire/shared';
import { useConfirm } from '../../providers/ConfirmProvider.js';

type Phase = 'loading' | 'error' | 'unavailable' | 'devicecheck' | 'active' | 'submitted' | 'terminated';

interface AnswerState {
  answerText?: string;
  answerCode?: string;
  selectedOption?: string;
  language?: string;
}

const TERMINAL = ['SUBMITTED', 'EVALUATING', 'EVALUATED', 'CANCELLED', 'EXPIRED'];

export function AssessmentTakePage() {
  const { token = '' } = useParams<{ token: string }>();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [assessment, setAssessment] = useState<PublicAssessment | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [warning, setWarning] = useState<{ n: number; max: number } | null>(null);
  const [endMessage, setEndMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submittedRef = useRef(false);
  const endingRef = useRef(false);
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;

  const cameraRequired = !!assessment?.antiCheat.cameraRequired;
  const micRequired = !!assessment?.antiCheat.micRequired;
  const proctoringEnabled = !!assessment?.antiCheat.proctoringEnabled;

  const proctor = useMediaProctor({ video: cameraRequired, audio: micRequired });
  const { capture, stop: stopProctor, stopMeter } = proctor;
  const recorder = useAudioRecorder(proctor.getStream);

  // Latest answers, readable from callbacks that aren't re-created per keystroke.
  const answersRef = useRef<Record<string, AnswerState>>({});
  answersRef.current = answers;

  const load = useCallback(async () => {
    try {
      const { assessment: a } = await assessmentApi.getPublicAssessment(token);
      setAssessment(a);
      const seeded: Record<string, AnswerState> = {};
      a.savedAnswers.forEach((s) => {
        seeded[s.questionId] = {
          answerText: s.answerText ?? undefined,
          answerCode: s.answerCode ?? undefined,
          selectedOption: s.selectedOption ?? undefined,
          language: s.language ?? undefined,
        };
      });
      setAnswers(seeded);
      if (TERMINAL.includes(a.status)) setPhase('unavailable');
      else setPhase('devicecheck'); // PENDING or IN_PROGRESS → device check first
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
      setPhase('error');
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // Persist every answer currently held in state. Runs before submit so a
  // typed-but-not-yet-blurred answer (e.g. on a timer-driven auto-submit) isn't
  // lost. Best-effort per answer; saves while the assignment is still IN_PROGRESS.
  const flushAnswers = useCallback(async () => {
    await Promise.all(
      Object.entries(answersRef.current).map(([qid, a]) => {
        if (!a || (a.answerText == null && a.answerCode == null && a.selectedOption == null)) return Promise.resolve();
        return assessmentApi
          .savePublicAnswer(token, {
            questionId: qid,
            answerText: a.answerText,
            answerCode: a.answerCode,
            selectedOption: a.selectedOption,
            language: a.answerCode != null ? (a.language ?? 'python') : undefined,
          })
          .catch(() => {});
      }),
    );
  }, [token]);

  // ─── Submit ────────────────────────────────────────────────────────────────
  const submit = useCallback(async (auto = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    await flushAnswers(); // save any unsaved answers while still IN_PROGRESS
    const recording = await recorder.stop().catch(() => null);
    try { await assessmentApi.submitPublicAssessment(token); } catch { /* show submitted regardless */ }
    if (recording) void assessmentApi.savePublicAssessmentRecording(token, recording).catch(() => {});
    stopProctor();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setSubmitting(false);
    if (!endingRef.current) setPhase('submitted');
    if (auto && !endingRef.current) setEndMessage('Your time ran out — answers were submitted automatically.');
  }, [token, recorder, stopProctor, flushAnswers]);

  // ─── Central violation handler (unified warning budget) ───────────────────
  const lastViolationAt = useRef(0);
  const handleViolation = useCallback(async (type: ViolationType, detail?: string) => {
    if (phaseRef.current !== 'active' || endingRef.current) return;
    const now = Date.now();
    if (now - lastViolationAt.current < 800) return;
    lastViolationAt.current = now;

    const shot = capture();
    if (shot) void assessmentApi.savePublicAssessmentSnapshot(token, { reason: 'VIOLATION', image: shot }).catch(() => {});

    try {
      const res = await assessmentApi.recordPublicAssessmentViolation(token, type, detail);
      if (res.terminated) {
        endingRef.current = true;
        submittedRef.current = true; // backend already submitted
        const term = capture();
        if (term) void assessmentApi.savePublicAssessmentSnapshot(token, { reason: 'TERMINATION', image: term }).catch(() => {});
        void recorder.stop().then((rec) => { if (rec) void assessmentApi.savePublicAssessmentRecording(token, rec).catch(() => {}); }).catch(() => {});
        stopProctor();
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        setEndMessage('Your assessment was ended after repeated integrity violations. This has been reported to the hiring team.');
        setPhase('terminated');
      } else {
        setWarning({ n: res.warnings, max: res.maxWarnings });
      }
    } catch { /* ignore network errors on violation logging */ }
  }, [token, capture, recorder, stopProctor]);

  // ─── Overall timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active' || !assessment?.startedAt || !assessment.durationMin) { setTimeLeft(null); return; }
    const deadline = new Date(assessment.startedAt).getTime() + assessment.durationMin * 60_000;
    const tick = () => {
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) void submit(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, assessment?.startedAt, assessment?.durationMin, submit]);

  // ─── Anti-cheat listeners (tab / window focus / fullscreen / copy-paste) ──
  useEffect(() => {
    if (phase !== 'active') return;
    const onVisibility = () => { if (document.hidden) void handleViolation('TAB_SWITCH', 'Tab hidden / switched away'); };
    const onWindowBlur = () => { if (document.hasFocus && document.hasFocus()) return; void handleViolation('WINDOW_BLUR', 'Switched to another app or window'); };
    const onFullscreen = () => { if (!document.fullscreenElement) void handleViolation('FULLSCREEN_EXIT', 'Left fullscreen'); };
    const onCopyPaste = () => void handleViolation('COPY_PASTE', 'Copy/paste used');
    const blockContext = (e: Event) => e.preventDefault();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('copy', onCopyPaste);
    document.addEventListener('paste', onCopyPaste);
    document.addEventListener('contextmenu', blockContext);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('copy', onCopyPaste);
      document.removeEventListener('paste', onCopyPaste);
      document.removeEventListener('contextmenu', blockContext);
    };
  }, [phase, handleViolation]);

  // ─── Camera / mic liveness enforcement ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active' || !cameraRequired) return;
    if (!proctor.state.cameraLive) void handleViolation('CAMERA_BLOCKED', 'Camera turned off or blocked');
  }, [phase, cameraRequired, proctor.state.cameraLive, handleViolation]);

  useEffect(() => {
    if (phase !== 'active' || !micRequired) return;
    if (!proctor.state.micLive) void handleViolation('MIC_BLOCKED', 'Microphone turned off or blocked');
  }, [phase, micRequired, proctor.state.micLive, handleViolation]);

  // ─── Multiple-person / face-absence detection (BlazeFace) ─────────────────
  const getProctorVideo = useVideoAccessor(proctor.videoRef);
  useFaceMonitor({
    enabled: phase === 'active' && proctoringEnabled && cameraRequired,
    getVideo: getProctorVideo,
    onMultipleFaces: (n) => void handleViolation('MULTIPLE_FACES', `${n} people detected on camera`),
    onNoFace: () => void handleViolation('NO_FACE', 'Candidate not visible on camera'),
  });

  // ─── Periodic proctoring snapshots ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active' || !proctoringEnabled) return;
    const intervalMs = Math.max(5, assessment?.antiCheat.snapshotIntervalSec ?? 15) * 1000;
    const id = setInterval(() => {
      const s = capture();
      if (s) void assessmentApi.savePublicAssessmentSnapshot(token, { reason: 'PERIODIC', image: s }).catch(() => {});
    }, intervalMs);
    return () => clearInterval(id);
  }, [phase, proctoringEnabled, assessment?.antiCheat.snapshotIntervalSec, token, capture]);

  // ─── Persist a single answer ──────────────────────────────────────────────
  function setAnswer(qid: string, patch: AnswerState) {
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], ...patch } }));
  }
  async function persist(q: PublicQuestion) {
    // Read the latest answers from the ref, not the render closure: MCQ/language
    // save via setTimeout(onBlur, 0), which fires before this closure's `answers`
    // reflects the just-made selection — so the closure value is stale (and for a
    // first MCQ pick, undefined → skipped). The ref is always current.
    const a = answersRef.current[q.id];
    if (!a || (a.answerText == null && a.answerCode == null && a.selectedOption == null)) return;
    try {
      await assessmentApi.savePublicAnswer(token, { questionId: q.id, answerText: a.answerText, answerCode: a.answerCode, selectedOption: a.selectedOption, language: a.answerCode != null ? (a.language ?? 'python') : undefined });
    } catch { /* best-effort */ }
  }

  // ─── Start (from device check) ────────────────────────────────────────────
  async function handleStart() {
    try {
      const { startedAt, durationMin } = await assessmentApi.startPublicAssessment(token);
      setAssessment((prev) => (prev ? { ...prev, status: 'IN_PROGRESS', startedAt, durationMin } : prev));
      // Reference frame for biometric comparison.
      if (proctoringEnabled && cameraRequired) {
        const ref = capture();
        if (ref) void assessmentApi.savePublicAssessmentSnapshot(token, { reason: 'START', image: ref }).catch(() => {});
      }
      try { await document.documentElement.requestFullscreen(); } catch { /* fullscreen may be blocked */ }
      stopMeter();
      if (micRequired) recorder.start();
      setPhase('active');
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
      setPhase('error');
    }
  }

  // ─── Render: simple states ────────────────────────────────────────────────
  if (phase === 'loading') return <Shell><div className="flex items-center gap-3 text-text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading your assessment…</div></Shell>;
  if (phase === 'error') return <Shell><Centered icon={<AlertTriangle className="h-10 w-10 text-danger" />} title="Unable to load assessment" body={errorMsg || 'This link is invalid or has expired.'} /></Shell>;
  if (phase === 'unavailable') return <Shell><Centered icon={<CheckCircle2 className="h-10 w-10 text-success" />} title="This assessment is complete" body="Your responses have already been submitted. You may close this window." /></Shell>;
  if (phase === 'submitted') return <Shell><Centered icon={<CheckCircle2 className="h-10 w-10 text-success" />} title="Assessment submitted" body={endMessage ?? 'Thank you. Your responses have been recorded and will be reviewed shortly.'} /></Shell>;
  if (phase === 'terminated') return <Shell><Centered icon={<ShieldX className="h-10 w-10 text-danger" />} title="Assessment ended" body={endMessage ?? 'Your assessment was ended due to repeated policy violations.'} /></Shell>;
  if (!assessment) return null;

  // ─── Render: device check / intro ─────────────────────────────────────────
  if (phase === 'devicecheck') {
    return (
      <DeviceCheck
        assessment={assessment}
        proctor={proctor}
        proctoringEnabled={proctoringEnabled}
        cameraRequired={cameraRequired}
        micRequired={micRequired}
        onStart={handleStart}
      />
    );
  }

  const answered = assessment.questions.filter((q) => { const a = answers[q.id]; return a && (a.answerText || a.answerCode || a.selectedOption); }).length;
  const remaining = warning ? warning.max - warning.n : 0;

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium text-text-primary">{assessment.title}</p>
            <p className="text-xs text-text-muted">{answered}/{assessment.questions.length} answered</p>
          </div>
          <div className="flex items-center gap-3">
            {proctoringEnabled && (
              <div className="relative hidden sm:block">
                <video ref={proctor.bindVideo} muted playsInline className="h-12 w-[88px] rounded-md border border-border object-cover" />
                <span className={`absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface ${proctor.state.cameraLive ? 'bg-success' : 'bg-danger'}`} />
              </div>
            )}
            {timeLeft != null && (
              <div className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold tabular-nums ${timeLeft <= 60 ? 'bg-danger/15 text-danger' : 'bg-surface-raised text-text-primary'}`}>
                <Clock className="h-4 w-4" /> {formatTime(timeLeft)}
              </div>
            )}
          </div>
        </div>
        {warning && (
          <div className="flex items-center justify-center gap-2 border-t border-danger/40 bg-danger/10 px-4 py-2 text-center text-sm font-medium text-danger">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            Warning {warning.n} of {warning.max}.{' '}
            {remaining <= 0 ? 'Any further violation will end your assessment.' : `${remaining} more violation${remaining === 1 ? '' : 's'} will end your assessment.`}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {assessment.questions.map((q, i) => (
          <QuestionCard key={q.id} index={i} question={q} answer={answers[q.id]} onChange={(p) => setAnswer(q.id, p)} onBlur={() => void persist(q)} />
        ))}
        <div className="flex items-center justify-between border-t border-border pt-5">
          <p className="text-sm text-text-muted">{answered}/{assessment.questions.length} answered</p>
          <Button size="lg" loading={submitting} onClick={async () => { if (await confirm({ title: 'Submit Assessment', message: 'Submit your assessment? You cannot make changes after this.', confirmText: 'Submit assessment', variant: 'primary' })) void submit(false); }}>Submit assessment</Button>
        </div>
      </main>
    </div>
  );
}

// ─── Device check screen ─────────────────────────────────────────────────────

function DeviceCheck({ assessment, proctor, proctoringEnabled, cameraRequired, micRequired, onStart }: {
  assessment: PublicAssessment;
  proctor: ReturnType<typeof useMediaProctor>;
  proctoringEnabled: boolean;
  cameraRequired: boolean;
  micRequired: boolean;
  onStart: () => void;
}) {
  const [requested, setRequested] = useState(false);
  const [starting, setStarting] = useState(false);
  const needsMedia = proctoringEnabled && (cameraRequired || micRequired);

  // Auto-request media on mount when proctoring needs it.
  useEffect(() => {
    if (!needsMedia || requested) return;
    setRequested(true);
    void proctor.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsMedia]);

  const cameraOk = !cameraRequired || proctor.state.cameraLive;
  const micOk = !micRequired || proctor.state.micLive;
  const ready = !needsMedia || (cameraOk && micOk);

  return (
    <Shell>
      <div className="mx-auto max-w-lg space-y-6 py-8">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">{assessment.title}</h1>
          <p className="mt-2 text-sm text-text-muted">Hi {assessment.candidateName.split(' ')[0]}, you've been invited to complete this skills assessment.</p>
        </div>
        {assessment.description && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-secondary">{assessment.description}</p>}

        <div className="space-y-3 rounded-lg border border-border bg-surface p-5 text-sm">
          <Row label="Questions" value={`${assessment.questions.length}`} />
          <Row label="Time limit" value={assessment.durationMin ? `${assessment.durationMin} minutes` : 'Untimed'} />
        </div>

        {needsMedia && (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <ShieldAlert className="h-4 w-4 text-warning" /> This is a proctored assessment
            </div>
            <p className="text-xs text-text-muted">
              Your camera and microphone stay on, periodic snapshots are taken, and switching tabs or leaving full screen is recorded.
              Allow up to {assessment.antiCheat.maxWarnings} warning(s) before it auto-submits. Use a desktop Chrome or Edge browser.
            </p>
            {cameraRequired && (
              <div className="relative overflow-hidden rounded-md border border-border bg-bg">
                <video ref={proctor.bindVideo} muted playsInline className="h-44 w-full object-cover" />
              </div>
            )}
            <div className="flex flex-wrap gap-3 text-xs">
              {cameraRequired && <Status ok={proctor.state.cameraLive} icon={<Camera className="h-3.5 w-3.5" />} label="Camera" />}
              {micRequired && <Status ok={proctor.state.micLive} icon={<Mic className="h-3.5 w-3.5" />} label="Microphone" />}
            </div>
            {proctor.error && <p className="text-xs text-danger">{proctor.error}</p>}
            {!ready && (
              <Button variant="outline" size="sm" type="button" onClick={() => void proctor.request()}>
                <Video className="h-4 w-4" /> Re-check camera &amp; microphone
              </Button>
            )}
          </div>
        )}

        <Button
          className="w-full"
          size="lg"
          disabled={!ready || starting}
          loading={starting}
          onClick={() => { setStarting(true); onStart(); }}
        >
          <ClipboardCheck className="h-4 w-4" /> Start assessment
        </Button>
        {!ready && <p className="text-center text-xs text-text-muted">Allow camera and microphone access to begin.</p>}
      </div>
    </Shell>
  );
}

function Status({ ok, icon, label }: { ok: boolean; icon: React.ReactNode; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
      {icon} {label} {ok ? 'ready' : 'blocked'}
    </span>
  );
}

function QuestionCard({ index, question, answer, onChange, onBlur }: {
  index: number; question: PublicQuestion; answer: AnswerState | undefined;
  onChange: (patch: AnswerState) => void; onBlur: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-2"><span className="text-xs font-semibold text-text-muted">Question {index + 1} · {question.type} · {question.maxScore} pts</span></div>
      <p className="mb-4 whitespace-pre-wrap text-sm text-text-primary">{question.text}</p>
      {question.type === 'MCQ' && question.options ? (
        <div className="space-y-2">
          {question.options.map((opt) => (
            <label key={opt.text} className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition-colors ${answer?.selectedOption === opt.text ? 'border-accent bg-accent/5 text-text-primary' : 'border-border text-text-secondary hover:bg-surface-raised'}`}>
              <input type="radio" name={`q-${question.id}`} className="h-4 w-4 accent-accent" checked={answer?.selectedOption === opt.text} onChange={() => { onChange({ selectedOption: opt.text }); setTimeout(onBlur, 0); }} />
              {opt.text}
            </label>
          ))}
        </div>
      ) : question.type === 'CODE' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-text-muted">Language</label>
            <select
              value={answer?.language ?? 'python'}
              onChange={(e) => { onChange({ language: e.target.value }); setTimeout(onBlur, 0); }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {CODE_LANGUAGES.map((l) => (<option key={l.value} value={l.value}>{l.label}</option>))}
            </select>
          </div>
          <textarea spellCheck={false} className="min-h-[200px] w-full rounded-md border border-border bg-bg px-3 py-2.5 font-mono text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder="Write your code here…" value={answer?.answerCode ?? ''} onChange={(e) => onChange({ answerCode: e.target.value })} onBlur={onBlur} />
        </div>
      ) : (
        <textarea className="min-h-[140px] w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder="Type your answer…" value={answer?.answerText ?? ''} onChange={(e) => onChange({ answerText: e.target.value })} onBlur={onBlur} />
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-bg px-4"><div className="w-full max-w-3xl">{children}</div></div>;
}
function Centered({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return <div className="flex flex-col items-center text-center"><div className="mb-4">{icon}</div><h1 className="font-heading text-xl font-semibold text-text-primary">{title}</h1><p className="mt-2 max-w-md text-sm text-text-muted">{body}</p></div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-text-muted">{label}</span><span className="font-medium text-text-primary">{value}</span></div>;
}
function formatTime(seconds: number): string { const m = Math.floor(seconds / 60); const s = seconds % 60; return `${m}:${s.toString().padStart(2, '0')}`; }
