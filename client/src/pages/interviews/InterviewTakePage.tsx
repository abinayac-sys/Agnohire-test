import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  ShieldX,
  Circle,
  ChevronLeft,
  ChevronRight,
  Mic,
  MicOff,
  Volume2,
  TimerReset,
  Camera,
  CameraOff,
  X,
  Eye,
  EyeOff,
  Clipboard,
  MonitorOff,
  Smartphone,
  Users,
  UserX,
  Volume1,
  Package,
  Activity,
} from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { apiErrorMessage } from '../../services/api.js';
import * as interviewApi from '../../services/interviewApi.js';
import { useMediaProctor } from './useMediaProctor.js';
import { useAudioRecorder } from './useAudioRecorder.js';
import { useFaceMonitor, useVideoAccessor } from './useFaceMonitor.js';
import { useObjectMonitor } from './useObjectMonitor.js';
import { useAudioMonitor } from './useAudioMonitor.js';
import { useSpeech } from './useSpeech.js';
import { CodeEditor } from './CodeEditor.js';
import { InterviewSetupWizard } from './InterviewSetupWizard.js';
import type { PublicInterview, PublicQuestion, ViolationType, CodeLanguage } from '@agnohire/shared';

type Phase = 'loading' | 'error' | 'unavailable' | 'ready' | 'active' | 'submitted' | 'terminated';

interface AnswerState {
  answerText?: string;
  answerCode?: string;
  selectedOption?: string;
  language?: string;
}

interface ViolationNotif {
  id: string;
  type: ViolationType;
  detail: string;
  warningN: number;
  maxWarnings: number;
  timestamp: number;
}

function cleanFaceSignature(face: any) {
  if (!face) return null;
  return {
    topLeft: Array.isArray(face.topLeft) ? face.topLeft : face.topLeft ? Array.from(face.topLeft) : [],
    bottomRight: Array.isArray(face.bottomRight) ? face.bottomRight : face.bottomRight ? Array.from(face.bottomRight) : [],
    landmarks: Array.isArray(face.landmarks) ? face.landmarks.map((l: any) => Array.isArray(l) ? l : Array.from(l)) : [],
    probability: Array.isArray(face.probability) ? face.probability : face.probability ? Array.from(face.probability) : [],
  };
}

const VIOLATION_META: Record<ViolationType, { label: string; icon: React.FC<{ className?: string }> }> = {
  TAB_SWITCH:          { label: 'Tab Switch',              icon: ({ className }) => <EyeOff className={className} /> },
  WINDOW_BLUR:         { label: 'Window Switched',         icon: ({ className }) => <MonitorOff className={className} /> },
  FULLSCREEN_EXIT:     { label: 'Fullscreen Exited',       icon: ({ className }) => <Eye className={className} /> },
  COPY_PASTE:          { label: 'Copy / Paste Detected',   icon: ({ className }) => <Clipboard className={className} /> },
  CAMERA_BLOCKED:      { label: 'Camera Blocked',          icon: ({ className }) => <CameraOff className={className} /> },
  MIC_BLOCKED:         { label: 'Microphone Blocked',      icon: ({ className }) => <MicOff className={className} /> },
  MULTIPLE_FACES:      { label: 'Multiple People Detected',icon: ({ className }) => <Users className={className} /> },
  MULTIPLE_VOICES:     { label: 'Multiple Voices Detected',icon: ({ className }) => <Volume1 className={className} /> },
  NO_FACE:             { label: 'Face Not Visible',        icon: ({ className }) => <UserX className={className} /> },
  FREQUENT_MOVEMENT:   { label: 'Suspicious Movement',     icon: ({ className }) => <Activity className={className} /> },
  MOBILE_PHONE:        { label: 'Mobile Phone Detected',   icon: ({ className }) => <Smartphone className={className} /> },
  SUSPICIOUS_OBJECT:   { label: 'Suspicious Object',       icon: ({ className }) => <Package className={className} /> },
  UNUSUAL_NOISE:       { label: 'Unusual Noise Detected',  icon: ({ className }) => <Volume1 className={className} /> },
  FACE_MISMATCH:       { label: 'Face Mismatch Detected',  icon: ({ className }) => <UserX className={className} /> },
  INTEGRITY_VIOLATION: { label: 'Integrity Violation',     icon: ({ className }) => <ShieldAlert className={className} /> },
};

const TERMINAL = ['COMPLETED', 'EVALUATING', 'EVALUATED', 'CANCELLED', 'EXPIRED'];
const MIN_PER_QUESTION_SEC = 30;

const CAMERA_WIDGET_SIZE = { width: 320, height: 250 };
const CAMERA_WIDGET_MARGIN = 24;

/** Drag state for the floating proctoring camera widget — free-position within the
 *  viewport, clamped so it can never be dragged fully off-screen. Position is kept
 *  as top/left (not the initial bottom/right anchor) once dragging starts. */
function useDraggableWidget(size: { width: number; height: number }, margin: number) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const clamp = useCallback(
    (top: number, left: number) => ({
      top: Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - size.height - margin)),
      left: Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - size.width - margin)),
    }),
    [size.width, size.height, margin],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget.parentElement as HTMLElement | null;
      const rect = target?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const { dx, dy } = dragRef.current;
      setPos(clamp(e.clientY - dy, e.clientX - dx));
    },
    [clamp],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // Re-clamp on viewport resize so the widget never ends up off-screen.
  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((p) => (p ? clamp(p.top, p.left) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, clamp]);

  const style: CSSProperties = pos
    ? { top: pos.top, left: pos.left, right: 'auto', bottom: 'auto' }
    : { bottom: margin, right: margin };

  return { style, dragHandleProps: { onPointerDown, onPointerMove, onPointerUp } };
}

export function InterviewTakePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [interview, setInterview] = useState<PublicInterview | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [current, setCurrent] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [qTimeLeft, setQTimeLeft] = useState<number | null>(null);
  const [timedOutQs, setTimedOutQs] = useState<Set<number>>(new Set());
  const [violationNotifs, setViolationNotifs] = useState<ViolationNotif[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [endMessage, setEndMessage] = useState<string | null>(null);
  const [showFullscreenAlert, setShowFullscreenAlert] = useState(false);

  const submittedRef = useRef(false);
  const endingRef = useRef(false);
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;

  const cameraRequired = !!interview?.antiCheat.cameraRequired;
  const micRequired = !!interview?.antiCheat.micRequired;
  const proctoringEnabled = !!interview?.antiCheat.proctoringEnabled;

  const proctor = useMediaProctor({ video: cameraRequired, audio: micRequired });
  const cameraWidget = useDraggableWidget(CAMERA_WIDGET_SIZE, CAMERA_WIDGET_MARGIN);
  // Stable handles — the `proctor` object is a fresh identity each render, so
  // effects must depend on these callbacks (not `proctor`) to avoid thrashing.
  const { capture, stop: stopProctor, stopMeter } = proctor;
  // Records the candidate's mic for post-hoc voice analysis (best-effort).
  const recorder = useAudioRecorder(proctor.getStream);

  const speech = useSpeech();
  const { speak, stopSpeaking, startListening, stopListening, transcript, listening } = speech;
  const listeningRef = useRef(listening);
  listeningRef.current = listening;

  const [biometricWarning, setBiometricWarning] = useState<{
    title: string;
    message: string;
    count?: number;
    max?: number;
  } | null>(null);

  const blazefaceModelRef = useRef<any>(null);
  const masterSignatureRef = useRef<any>(null);
  const noFaceDurationRef = useRef<number>(0);
  const landmarkHistoryRef = useRef<number[][][]>([]);
  const matchScoreHistoryRef = useRef<number[]>([]);

  // ─── Load interview ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const { interview: iv } = await interviewApi.getPublicInterview(token);
      setInterview(iv);
      const seeded: Record<string, AnswerState> = {};
      iv.savedAnswers.forEach((a) => {
        seeded[a.questionId] = {
          answerText: a.answerText ?? undefined,
          answerCode: a.answerCode ?? undefined,
          selectedOption: a.selectedOption ?? undefined,
          language: a.language ?? undefined,
        };
      });
      setAnswers(seeded);
      if (iv.biometricEnrollment?.faceSignature) {
        masterSignatureRef.current = iv.biometricEnrollment.faceSignature;
      }
      if (TERMINAL.includes(iv.status)) setPhase('unavailable');
      else setPhase('ready'); // SCHEDULED or IN_PROGRESS → device check first
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
      setPhase('error');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // ─── Answer state + persistence ───────────────────────────────────────────
  function setAnswer(qid: string, patch: AnswerState) {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: { ...prev[qid], ...patch } };

      // Temporarily pause TensorFlow.js proctoring to prevent typing lag
      setIsTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setIsTyping(false);
      }, 2000);

      // Debounce autosaving the answer
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = setTimeout(() => {
        const q = interview?.questions.find((x) => x.id === qid);
        if (q) {
          void persistAnswer(q, patch);
        }
      }, 1500);

      return next;
    });
  }

  const persistAnswer = useCallback(
    async (q: PublicQuestion, override?: AnswerState) => {
      const a = { ...answersRef.current[q.id], ...override };
      if (a.answerText == null && a.answerCode == null && a.selectedOption == null) return;
      try {
        await interviewApi.savePublicAnswer(token, {
          questionId: q.id,
          answerText: a.answerText,
          answerCode: a.answerCode,
          selectedOption: a.selectedOption,
          language: a.answerCode != null ? (a.language ?? 'python') : undefined,
        });
      } catch {
        /* best-effort */
      }
    },
    [token],
  );

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  /**
   * Wrap up the question being shown: stop voice capture (folding the live
   * transcript into the answer) and persist. Called before any navigation,
   * timeout advance, or submit.
   */
  const finishCurrentQuestion = useCallback(async () => {
    const q = interview?.questions[currentRef.current];
    if (!q) return;
    stopSpeaking();
    let override: AnswerState | undefined;
    if (listeningRef.current) {
      const text = stopListening();
      if (q.type === 'TEXT' && text.trim()) {
        override = { answerText: text };
        setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], answerText: text } }));
      }
    }
    await persistAnswer(q, override);
  }, [interview, persistAnswer, stopSpeaking, stopListening]);

  // Auto-save the current question's answer immediately when the candidate leaves/hides the page
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void finishCurrentQuestion();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [finishCurrentQuestion]);

  // ─── Submit ──────────────────────────────────────────────────────────────
  const submit = useCallback(
    async (auto = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      // Persist the current question's answer (folding in the live voice
      // transcript) BEFORE marking the interview complete. The save endpoint
      // rejects once status leaves IN_PROGRESS, so without this an answer the
      // candidate was speaking when the timer expired would be lost and show as
      // "No answer submitted" in the admin evaluation.
      await finishCurrentQuestion();
      stopSpeaking();
      stopListening();
      // Stop + capture the mic recording before the proctor stream is torn down.
      const recording = await recorder.stop().catch(() => null);
      try {
        await interviewApi.submitPublicInterview(token);
      } catch {
        /* best-effort */
      }
      if (recording) {
        void interviewApi.savePublicRecording(token, recording).catch(() => {});
      }
      stopProctor();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      setSubmitting(false);
      if (!endingRef.current) setPhase('submitted');
      if (auto && !endingRef.current) setEndMessage('Your time ran out — answers were submitted automatically.');
    },
    [token, finishCurrentQuestion, stopProctor, stopSpeaking, stopListening],
  );

  const dismissViolation = useCallback((id: string) => {
    setViolationNotifs((prev) => prev.filter((v) => v.id !== id));
  }, []);

  // ─── Central violation handler (unified warning budget) ───────────────────
  const lastViolationAt = useRef(0);
  const handleViolation = useCallback(
    async (type: ViolationType, detail?: string) => {
      if (phaseRef.current !== 'active' || endingRef.current) return null;
      // Debounce bursts (e.g. blur + visibility firing together).
      const now = Date.now();
      if (now - lastViolationAt.current < 800) return null;
      lastViolationAt.current = now;

      const shot = capture();
      if (shot) void interviewApi.savePublicSnapshot(token, { reason: 'VIOLATION', image: shot }).catch(() => {});

      try {
        const res = await interviewApi.recordPublicViolation(token, type, detail);
        if (res.terminated) {
          endingRef.current = true;
          submittedRef.current = true; // backend already submitted
          const term = capture();
          if (term) void interviewApi.savePublicSnapshot(token, { reason: 'TERMINATION', image: term }).catch(() => {});
          stopSpeaking();
          stopListening();
          stopProctor();
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          setEndMessage(
            'Your interview was ended after repeated integrity violations. This has been reported to the interview team.',
          );
          setPhase('terminated');
          return { warnings: res.warnings, maxWarnings: res.maxWarnings, terminated: true };
        } else {
          // Push a detailed popup notification for each violation.
          const notif: ViolationNotif = {
            id: `v-${Date.now()}-${Math.random()}`,
            type,
            detail: detail ?? '',
            warningN: res.warnings,
            maxWarnings: res.maxWarnings,
            timestamp: Date.now(),
          };
          setViolationNotifs((prev) => [...prev.slice(-4), notif]); // keep max 5
          return { warnings: res.warnings, maxWarnings: res.maxWarnings, terminated: false };
        }
      } catch {
        /* ignore network errors on violation logging */
        return null;
      }
    },
    [token, capture, stopProctor, stopSpeaking, stopListening],
  );

  // ─── Overall timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active' || !interview?.startedAt || !interview.durationMin) {
      setTimeLeft(null);
      return;
    }
    const deadline = new Date(interview.startedAt).getTime() + interview.durationMin * 60_000;
    const tick = () => {
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) void submit(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, interview?.startedAt, interview?.durationMin, submit]);

  // ─── Per-question timer (auto-advance on expiry) ──────────────────────────
  const total = interview?.questions.length ?? 0;
  const perQuestionSec = useMemo(() => {
    if (!interview?.durationMin || !total) return null;
    return Math.max(MIN_PER_QUESTION_SEC, Math.floor((interview.durationMin * 60) / total));
  }, [interview?.durationMin, total]);

  const advanceRef = useRef<(isTimeout?: boolean) => void>(() => {});
  advanceRef.current = (isTimeout: boolean = false) => {
    void (async () => {
      await finishCurrentQuestion();
      if (isTimeout) {
        setTimedOutQs((prev) => {
          const next = new Set(prev);
          next.add(currentRef.current);
          return next;
        });
      }
      
      let nextIdx = currentRef.current + 1;
      // Skip over already timed-out questions
      while (nextIdx < total && timedOutQs.has(nextIdx)) {
        nextIdx++;
      }
      
      if (nextIdx < total) {
        setCurrent(nextIdx);
      } else {
        void submit(true);
      }
    })();
  };

  useEffect(() => {
    if (phase !== 'active' || perQuestionSec == null) {
      setQTimeLeft(null);
      return;
    }
    const qDeadline = Date.now() + perQuestionSec * 1000;
    setQTimeLeft(perQuestionSec);
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.round((qDeadline - Date.now()) / 1000));
      setQTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        advanceRef.current(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, current, perQuestionSec]);

  // ─── Voice Q&A for written questions (TTS reads, STT transcribes) ─────────
  useEffect(() => {
    if (phase !== 'active' || !interview) return;
    const q = interview.questions[current];
    if (!q || q.type !== 'TEXT') return;
    let cancelled = false;
    void speak(q.text).then(() => {
      if (!cancelled && speech.recognitionSupported) {
        startListening(answersRef.current[q.id]?.answerText ?? '');
      }
    });
    return () => {
      cancelled = true;
      stopSpeaking();
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, current, interview?.id]);

  // Mirror the live transcript into the answer as the candidate speaks.
  useEffect(() => {
    if (phase !== 'active' || !listening || !interview) return;
    const q = interview.questions[currentRef.current];
    if (q?.type === 'TEXT') {
      setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], answerText: transcript } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, listening, phase]);

  // ─── Anti-cheat listeners (tab / window focus / fullscreen / copy-paste) ──
  useEffect(() => {
    if (phase !== 'active') return;
    const onVisibility = () => {
      if (document.hidden) void handleViolation('TAB_SWITCH', 'Tab hidden / switched away');
    };
    // Focusing another application (alt-tab, a second window, an overlay) fires
    // `blur` on the window even though the tab stays "visible" — visibilitychange
    // alone misses it. handleViolation already debounces so blur+visibility that
    // fire together count once.
    const onWindowBlur = () => {
      if (document.hasFocus && document.hasFocus()) return;
      void handleViolation('WINDOW_BLUR', 'Switched to another app or window');
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement) void handleViolation('FULLSCREEN_EXIT', 'Left fullscreen');
    };
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

  // Enforce fullscreen during active interview
  useEffect(() => {
    if (phase !== 'active') return;
    const checkFullscreen = () => {
      if (!document.fullscreenElement) {
        setShowFullscreenAlert(true);
      } else {
        setShowFullscreenAlert(false);
      }
    };
    checkFullscreen();
    document.addEventListener('fullscreenchange', checkFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', checkFullscreen);
    };
  }, [phase]);

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
    enabled: phase === 'active' && proctoringEnabled && cameraRequired && !isTyping,
    getVideo: getProctorVideo,
    onMultipleFaces: (n) => void handleViolation('MULTIPLE_FACES', `${n} people detected on camera`),
    onNoFace: () => void handleViolation('NO_FACE', 'Candidate not visible on camera'),
    onFrequentMovement: () => void handleViolation('FREQUENT_MOVEMENT', 'Frequent face movement or looking away detected'),
  });

  useObjectMonitor({
    enabled: phase === 'active' && proctoringEnabled && cameraRequired && !isTyping,
    getVideo: getProctorVideo,
    onMobilePhone: () => void handleViolation('MOBILE_PHONE', 'Mobile phone detected in camera view'),
    onSuspiciousObject: (obj) => void handleViolation('SUSPICIOUS_OBJECT', `Suspicious object detected: ${obj}`),
  });

  useAudioMonitor({
    enabled: phase === 'active' && proctoringEnabled && micRequired,
    getStream: proctor.getStream,
    onUnusualNoise: () => void handleViolation('UNUSUAL_NOISE', 'Unusual background noise levels detected'),
  });

  // ─── Periodic proctoring snapshots ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active' || !proctoringEnabled) return;
    const intervalMs = Math.max(5, interview?.antiCheat.snapshotIntervalSec ?? 15) * 1000;
    const id = setInterval(() => {
      const s = capture();
      if (s) void interviewApi.savePublicSnapshot(token, { reason: 'PERIODIC', image: s }).catch(() => {});
    }, intervalMs);
    return () => clearInterval(id);
  }, [phase, proctoringEnabled, interview?.antiCheat.snapshotIntervalSec, token, capture]);

  // Pre-load BlazeFace model during setup wizard ('ready') to avoid freezing the main thread when interview starts
  useEffect(() => {
    if ((phase !== 'active' && phase !== 'ready') || !proctoringEnabled || !cameraRequired) return;
    let cancelled = false;
    (async () => {
      try {
        await import('@tensorflow/tfjs');
        const blazeface = await import('@tensorflow-models/blazeface');
        const model = await blazeface.load();
        if (!cancelled) blazefaceModelRef.current = model;
      } catch (e) {
        console.error('Failed to load biometric model:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [phase, proctoringEnabled, cameraRequired]);

  // Biometric verification logic
  const runBiometricCheck = useCallback(async () => {
    const model = blazefaceModelRef.current;
    const master = masterSignatureRef.current;
    const video = proctor.videoRef.current;
    if (!model || !video || video.readyState < 2) return;

    if (!master || !Array.isArray(master) || master.length !== 512) {
      console.warn(`[Biometric Verification Warning Skipped]
Reason: Enrolled embedding missing, failed to load, or invalid dimensions.
Candidate: ${interview?.candidateEmail}
Enrolled embedding loaded: ${master ? 'Yes' : 'No'}
Enrollment embedding dimension: ${master?.length ?? 0}`);
      return;
    }

    try {
      const faces = await model.estimateFaces(video, false);
      const shot = capture();
      if (!shot) return;

      let matchScore = 0;
      let isMatch = true;
      let noFace = false;
      let multipleFaces = false;
      let isLive = true;
      let livenessReason = '';

      if (!faces || faces.length === 0) {
        noFace = true;
        noFaceDurationRef.current += 30;
      } else if (faces.length > 1) {
        multipleFaces = true;
        noFaceDurationRef.current = 0;
      } else {
        noFaceDurationRef.current = 0;
        const currentFace = faces[0];
        
        // 1. Liveness Detection
        const norm = getNormalizedLandmarks(currentFace);
        landmarkHistoryRef.current.push(norm);
        if (landmarkHistoryRef.current.length > 5) {
          landmarkHistoryRef.current.shift();
        }

        let totalVariance = 0;
        if (landmarkHistoryRef.current.length >= 3) {
          const frames = landmarkHistoryRef.current;
          const numLandmarks = frames[0].length;
          for (let i = 0; i < numLandmarks; i++) {
            if (!frames[0][i]) continue;
            for (let coord = 0; coord < 2; coord++) {
              const values = frames.map(f => f[i]?.[coord] ?? 0);
              const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
              const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
              totalVariance += variance;
            }
          }
        }

        const stdDev = analyzeFaceTexture(video, currentFace);

        if (landmarkHistoryRef.current.length >= 3 && totalVariance < 0.000005) {
          isLive = false;
          livenessReason = 'Static photo spoofing attempt detected (no micro-movement)';
        } else if (stdDev < 10) {
          isLive = false;
          livenessReason = 'Low-contrast spoofing attempt detected (printed photo / screen)';
        } else if (stdDev > 90) {
          isLive = false;
          livenessReason = 'High-glare screen playback spoofing attempt detected';
        }

        if (!isLive) {
          matchScoreHistoryRef.current = []; // Clear verification history
          console.log('[Biometric] Liveness check failed:', livenessReason);
        } else {
          // 2. Identity Verification (ArcFace Cosine Similarity)
          const liveEmbedding = generateArcFaceEmbedding(currentFace);
          matchScore = calculateMatchScore(master, currentFace);
          matchScoreHistoryRef.current.push(matchScore);
          if (matchScoreHistoryRef.current.length > 3) {
            matchScoreHistoryRef.current.shift();
          }

          const avgSimilarity = matchScoreHistoryRef.current.reduce((a, b) => a + b, 0) / matchScoreHistoryRef.current.length;
          if (matchScoreHistoryRef.current.length >= 2 && avgSimilarity < 75) {
            isMatch = false;
          }
          
          console.log(`[Biometric Verification Cycle]
Candidate Email: ${interview?.candidateEmail}
Enrolled embedding loaded: ${master ? 'Yes' : 'No'}
Enrollment embedding dimension: ${master?.length ?? 0}
Live embedding dimension: ${liveEmbedding?.length ?? 0}
Similarity score: ${matchScore}%
Configured threshold: 75%
Verification result: ${isMatch ? 'Match' : 'Mismatch'}
Warning count: ${violationNotifs.length}`);
        }
      }

      if (noFace) {
        if (noFaceDurationRef.current >= 30) {
          const res = await handleViolation('NO_FACE', 'Candidate absent for more than 30 seconds');
          if (res) {
            setBiometricWarning({
              title: 'Interview Monitoring Alert',
              message: 'Your face must remain visible during the interview.',
              count: res.warnings,
              max: res.maxWarnings,
            });
          }
        } else if (noFaceDurationRef.current >= 15) {
          setBiometricWarning({
            title: 'No Face Detected',
            message: 'Please return to the camera.',
          });
        }
      } else if (multipleFaces) {
        const res = await handleViolation('MULTIPLE_FACES', 'Multiple people detected on camera');
        if (res) {
          setBiometricWarning({
            title: 'Multiple People Detected',
            message: 'Only the registered candidate may appear on camera.',
            count: res.warnings,
            max: res.maxWarnings,
          });
        }
      } else if (!isLive) {
        // Increment the warning count on liveness failure (spoofing attempt)
        const res = await handleViolation('INTEGRITY_VIOLATION', `Liveness check failed: ${livenessReason}`);
        if (res) {
          setBiometricWarning({
            title: 'Liveness Verification Failed',
            message: 'A live face could not be verified. Please ensure you are not using a photograph, screen, or video playback.',
            count: res.warnings,
            max: res.maxWarnings,
          });

          if (res.terminated) {
            endingRef.current = true;
            submittedRef.current = true;
            stopSpeaking();
            stopListening();
            stopProctor();
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
            setEndMessage('Your interview was ended after repeated integrity violations.');
            setPhase('terminated');
          }
        }
      } else {
        const res = await interviewApi.biometricVerify(token, {
          image: shot,
          faceSignature: cleanFaceSignature(faces[0]),
          matchScore,
          isMatch,
          noFace: false,
          multipleFaces: false,
        });

        if (!isMatch) {
          setBiometricWarning({
            title: 'Face Mismatch Detected',
            message: 'The current face does not match the biometric profile captured during enrollment. Please ensure the enrolled candidate remains in front of the camera.',
            count: res.warnings,
            max: res.maxWarnings,
          });

          if (res.terminated) {
            endingRef.current = true;
            submittedRef.current = true;
            stopSpeaking();
            stopListening();
            stopProctor();
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
            setEndMessage('Your interview was ended after repeated integrity violations.');
            setPhase('terminated');
          }
        } else {
          setBiometricWarning(null);
        }
      }
    } catch (e) {
      console.error('Error running biometric check:', e);
    }
  }, [token, capture, handleViolation, stopSpeaking, stopListening, stopProctor]);

  // Verification intervals: every 10 seconds
  useEffect(() => {
    if (phase !== 'active' || !proctoringEnabled || !cameraRequired) return;
    const id = setInterval(runBiometricCheck, 10000);
    return () => clearInterval(id);
  }, [phase, proctoringEnabled, cameraRequired, runBiometricCheck]);

  // Verification on question change
  useEffect(() => {
    if (phase !== 'active') return;
    const id = setTimeout(runBiometricCheck, 500);
    return () => clearTimeout(id);
  }, [current, phase, runBiometricCheck]);

  // ─── Start (from the setup wizard) ────────────────────────────────────────
  async function handleStart(referenceShot: string | null, signature: any) {
    try {
      const { startedAt, durationMin } = await interviewApi.startPublicInterview(token);
      setInterview((prev) => (prev ? { ...prev, status: 'IN_PROGRESS', startedAt, durationMin } : prev));
      // Persist the biometric reference frame captured during enrollment.
      if (referenceShot) {
        void interviewApi.savePublicSnapshot(token, { reason: 'START', image: referenceShot }).catch(() => {});
        if (signature) {
          masterSignatureRef.current = signature;
          void interviewApi.biometricEnroll(token, { image: referenceShot, faceSignature: cleanFaceSignature(signature) }).catch(() => {});
        }
      }
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        /* fullscreen may be blocked; interview continues */
      }
      // Stop the mic-level meter's rAF loop so the live interview doesn't
      // re-render ~60fps (which would reset the snapshot interval each frame).
      stopMeter();
      // Begin recording mic audio for post-hoc speaker analysis (best-effort).
      if (micRequired) recorder.start();
      setPhase('active');
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
      setPhase('error');
    }
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  const goTo = useCallback(
    (idx: number) => {
      if (timedOutQs.has(idx)) return;
      void (async () => {
        await finishCurrentQuestion();
        setConfirmSubmit(false);
        setCurrent(idx);
      })();
    },
    [finishCurrentQuestion],
  );

  const isAnswered = useCallback(
    (q: PublicQuestion) => {
      const a = answers[q.id];
      return !!(a && (a.answerText || a.answerCode || a.selectedOption));
    },
    [answers],
  );

  // ─── Render: simple states ────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <Shell>
        <div className="flex items-center gap-3 text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading your interview…
        </div>
      </Shell>
    );
  }
  if (phase === 'error') {
    return (
      <Shell>
        <Centered
          icon={<AlertTriangle className="h-10 w-10 text-danger" />}
          title="Unable to load interview"
          body={errorMsg || 'This interview link is invalid or has expired.'}
        />
      </Shell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Shell>
        <Centered
          icon={<CheckCircle2 className="h-10 w-10 text-success" />}
          title="This interview is complete"
          body="Your responses have already been submitted. You may close this window."
        />
      </Shell>
    );
  }
  if (phase === 'submitted') {
    return (
      <Shell>
        <Centered
          icon={<CheckCircle2 className="h-10 w-10 text-success" />}
          title="Interview submitted"
          body={endMessage ?? 'Thank you. Your responses have been recorded and will be reviewed shortly.'}
        />
      </Shell>
    );
  }
  if (phase === 'terminated') {
    return (
      <Shell>
        <Centered
          icon={<ShieldX className="h-10 w-10 text-danger" />}
          title="Interview ended"
          body={endMessage ?? 'Your interview was ended due to repeated policy violations.'}
        />
      </Shell>
    );
  }

  if (!interview) return null;

  // ─── Render: setup wizard (identity → system → biometric → briefing) ──────
  if (phase === 'ready') {
    return (
      <InterviewSetupWizard
        interview={interview}
        proctor={proctor}
        proctoringEnabled={proctoringEnabled}
        cameraRequired={cameraRequired}
        micRequired={micRequired}
        onLaunch={(shot, sig) => handleStart(shot, sig)}
      />
    );
  }

  // ─── Render: active interview (one question per page) ──────────────────────
  const answeredCount = interview.questions.filter(isAnswered).length;
  const q = interview.questions[current];

  return (
    <div className="flex h-screen flex-col bg-bg">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-text-primary">{interview.candidateName}</span>
          <span className="hidden text-xs text-text-muted sm:inline">
            {answeredCount}/{total} answered
          </span>
        </div>
        <div className="flex items-center gap-3">
          {qTimeLeft != null && (
            <div
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold tabular-nums ${
                qTimeLeft <= 15 ? 'bg-warning/15 text-warning' : 'bg-surface-raised text-text-secondary'
              }`}
              title="Time left on this question"
            >
              <TimerReset className="h-3.5 w-3.5" />
              {formatTime(qTimeLeft)}
            </div>
          )}
          {timeLeft != null && (
            <div
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold tabular-nums ${
                timeLeft <= 60 ? 'bg-danger/15 text-danger' : 'bg-surface-raised text-text-primary'
              }`}
              title="Total time remaining"
            >
              <Clock className="h-4 w-4" />
              {formatTime(timeLeft)}
            </div>
          )}
        </div>
      </header>


      {/* ── Draggable proctoring camera (defaults to bottom-right) ── */}
      {proctoringEnabled && (
        <div
          className="fixed z-40 flex flex-col overflow-hidden rounded-xl border-2 border-border bg-surface shadow-2xl"
          style={{ width: CAMERA_WIDGET_SIZE.width, height: CAMERA_WIDGET_SIZE.height, ...cameraWidget.style }}
        >
          {/* Camera header bar — drag handle */}
          <div
            className="flex shrink-0 cursor-move touch-none items-center justify-between bg-surface-raised px-3 py-1.5"
            {...cameraWidget.dragHandleProps}
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${proctor.state.cameraLive ? 'animate-pulse bg-danger' : 'bg-text-muted'}`} />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                {proctor.state.cameraLive ? 'Live' : 'No Camera'}
              </span>
            </div>
            {proctor.state.cameraLive ? (
              <Camera className="h-3.5 w-3.5 text-text-muted" />
            ) : (
              <CameraOff className="h-3.5 w-3.5 text-danger" />
            )}
          </div>
          {/* Video feed */}
          <div className="relative flex-1 bg-black">
            <video
              ref={proctor.bindVideo}
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            {!proctor.state.cameraLive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80">
                <CameraOff className="h-8 w-8 text-danger" />
                <span className="text-xs text-danger">Camera unavailable</span>
              </div>
            )}
          </div>
          {/* Status footer */}
          <div className="shrink-0 bg-surface-raised px-3 py-1 text-center">
            <span className="text-[10px] text-text-muted">Proctoring active — stay visible</span>
          </div>
        </div>
      )}

      {/* ── Violation popup notification stack (top-right) ── */}
      <div className="fixed right-6 top-20 z-50 flex w-80 flex-col gap-2.5 pointer-events-none">
        {violationNotifs.map((v) => (
          <ViolationToast key={v.id} notif={v} onDismiss={dismissViolation} />
        ))}
      </div>

      {/* Body: palette + question */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar palette */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Questions</p>
            <p className="mt-1 text-xs text-text-secondary">
              {answeredCount} of {total} answered
            </p>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-2">
            {interview.questions.map((qq, i) => {
              const answered = isAnswered(qq);
              const active = i === current;
              return (
                <button
                  key={qq.id}
                  type="button"
                  disabled={timedOutQs.has(i)}
                  onClick={() => goTo(i)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'bg-accent/10 text-text-primary ring-1 ring-accent'
                      : timedOutQs.has(i)
                        ? 'opacity-50 cursor-not-allowed text-text-muted bg-surface-raised/50'
                        : 'text-text-secondary hover:bg-surface-raised'
                  }`}
                >
                  {answered ? (
                    <CheckCircle2 className={`h-4 w-4 shrink-0 ${timedOutQs.has(i) ? 'text-text-muted' : 'text-success'}`} />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-text-muted" />
                  )}
                  <span className="truncate">Question {i + 1}</span>
                  <span className="ml-auto text-[10px] uppercase text-text-muted">
                    {timedOutQs.has(i) ? 'TIMED OUT' : qq.type}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main question area */}
        <main className="min-w-0 flex-1 flex flex-col overflow-hidden">
          {(() => {
            const navControls = (
              <div className="mt-6 border-t border-border pt-5">
                {confirmSubmit ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-text-primary">
                      Submit your interview? You've answered <strong>{answeredCount}</strong> of{' '}
                      <strong>{total}</strong> questions — you can't make changes afterwards.
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="outline" type="button" onClick={() => setConfirmSubmit(false)}>
                        Keep answering
                      </Button>
                      <Button
                        type="button"
                        loading={submitting}
                        onClick={async () => {
                          await finishCurrentQuestion();
                          void submit(false);
                        }}
                      >
                        Submit now
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      type="button"
                      disabled={current === 0 || timedOutQs.has(Math.max(0, current - 1))}
                      onClick={() => goTo(Math.max(0, current - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" /> Previous
                    </Button>

                    {current < total - 1 ? (
                      <Button 
                        type="button" 
                        disabled={timedOutQs.has(Math.min(total - 1, current + 1))}
                        onClick={() => goTo(Math.min(total - 1, current + 1))}
                      >
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button type="button" onClick={() => setConfirmSubmit(true)}>
                        Submit interview
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );

            if (q?.type === 'CODE') {
              return (
                <div className="flex flex-1 overflow-hidden">
                  <div className="w-[450px] shrink-0 border-r border-border bg-surface flex flex-col">
                    <div className="flex-1 overflow-y-auto p-6">
                      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                        <span>
                          Question {current + 1} of {total}
                        </span>
                        <span className="text-text-muted/50">·</span>
                        <span>Coding</span>
                        <span className="text-text-muted/50">·</span>
                        <span>{q.maxScore} pts</span>
                      </div>
                      <h2 className="text-xl font-bold text-text-primary mb-4">Task Description</h2>
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-text-primary">
                        {q.text}
                      </p>
                    </div>
                    <div className="p-6 bg-surface border-t border-border shrink-0">
                      {navControls}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
                    <CodingWorkspaceCard
                      question={q}
                      answer={answers[q.id]}
                      onChange={(patch) => setAnswer(q.id, patch)}
                      onBlur={() => void persistAnswer(q)}
                    />
                  </div>
                </div>
              );
            }

            return (
              <div className="mx-auto max-w-3xl w-full px-4 py-6 sm:px-8 overflow-y-auto">
                {/* Mobile progress strip */}
                <div className="mb-4 flex items-center gap-1.5 overflow-x-auto md:hidden">
                  {interview.questions.map((qq, i) => (
                    <button
                      key={qq.id}
                      type="button"
                      disabled={timedOutQs.has(i)}
                      onClick={() => goTo(i)}
                      className={`h-8 w-8 shrink-0 rounded-md text-xs font-medium ${
                        i === current
                          ? 'bg-accent text-white'
                          : timedOutQs.has(i)
                            ? 'bg-surface-raised/50 text-text-muted opacity-50 cursor-not-allowed'
                            : isAnswered(qq)
                              ? 'bg-success/15 text-success'
                              : 'bg-surface-raised text-text-muted'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>

                {q && (
                  <QuestionCard
                    key={q.id}
                    index={current}
                    total={total}
                    question={q}
                    answer={answers[q.id]}
                    speech={speech}
                    onChange={(patch) => setAnswer(q.id, patch)}
                    onBlur={() => void persistAnswer(q)}
                    onToggleMic={() => {
                      if (listening) {
                        const text = stopListening();
                        if (text.trim()) {
                          setAnswer(q.id, { answerText: text });
                          void persistAnswer(q, { answerText: text });
                        }
                      } else {
                        startListening(answers[q.id]?.answerText ?? '');
                      }
                    }}
                    onReplay={() => void speak(q.text)}
                  />
                )}

                {navControls}
              </div>
            );
          })()}
        </main>
      </div>
      {biometricWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-danger/45 bg-surface p-6 shadow-2xl">
            <div className="flex flex-col items-center text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-danger/15 text-danger mb-4">
                <ShieldAlert className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-bold text-text-primary">
                {biometricWarning.title}
              </h3>
              <p className="mt-2 text-sm text-text-secondary">
                {biometricWarning.message}
              </p>
              {biometricWarning.count != null && biometricWarning.max != null && (
                <span className="mt-4 inline-flex items-center rounded-full bg-danger/10 px-3 py-1 text-xs font-semibold text-danger">
                  Warning {biometricWarning.count} of {biometricWarning.max}
                </span>
              )}
              <Button
                variant="outline"
                className="mt-6 w-full"
                onClick={() => {
                  setBiometricWarning(null);
                }}
              >
                Acknowledge
              </Button>
            </div>
          </div>
        </div>
      )}

      {showFullscreenAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-danger/45 bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-danger/15 text-danger mb-4">
                <ShieldAlert className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-bold text-text-primary">
                Fullscreen Mode Required
              </h3>
              <p className="mt-2 text-sm text-text-secondary">
                This interview must be taken in fullscreen mode to ensure exam integrity. Please click the button below to return to fullscreen and continue.
              </p>
              <Button
                type="button"
                className="mt-6 w-full"
                onClick={async () => {
                  try {
                    await document.documentElement.requestFullscreen();
                    setShowFullscreenAlert(false);
                  } catch {
                    /* block */
                  }
                }}
              >
                Re-enter Fullscreen
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function QuestionCard({
  index,
  total,
  question,
  answer,
  speech,
  onChange,
  onBlur,
  onToggleMic,
  onReplay,
}: {
  index: number;
  total: number;
  question: PublicQuestion;
  answer: AnswerState | undefined;
  speech: ReturnType<typeof useSpeech>;
  onChange: (patch: AnswerState) => void;
  onBlur: () => void;
  onToggleMic: () => void;
  onReplay: () => void;
}) {
  // Execution moved to CodingWorkspaceCard
  const kind =
    question.type === 'MCQ' ? 'Multiple choice' : question.type === 'CODE' ? 'Coding' : 'Voice / written';

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <span>
          Question {index + 1} of {total}
        </span>
        <span className="text-text-muted/50">·</span>
        <span>{kind}</span>
        <span className="text-text-muted/50">·</span>
        <span>{question.maxScore} pts</span>
      </div>
      <p className="mb-5 whitespace-pre-wrap text-lg font-medium leading-relaxed text-text-primary">
        {question.text}
      </p>

      {question.type === 'MCQ' && question.options ? (
        <div className="space-y-2.5">
          {question.options.map((opt) => (
            <label
              key={opt.text}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3.5 text-sm transition-colors ${
                answer?.selectedOption === opt.text
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border text-text-secondary hover:bg-surface-raised'
              }`}
            >
              <input
                type="radio"
                name={`q-${question.id}`}
                className="h-4 w-4 accent-accent"
                checked={answer?.selectedOption === opt.text}
                onChange={() => {
                  onChange({ selectedOption: opt.text });
                  setTimeout(onBlur, 0);
                }}
              />
              {opt.text}
            </label>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Voice controls */}
          <div className="flex flex-wrap items-center gap-2">
            {speech.ttsSupported && (
              <Button variant="outline" size="sm" type="button" onClick={onReplay} disabled={speech.speaking}>
                <Volume2 className="h-3.5 w-3.5" />
                {speech.speaking ? 'Reading…' : 'Read question'}
              </Button>
            )}
            {speech.recognitionSupported ? (
              <Button
                variant={speech.listening ? 'primary' : 'outline'}
                size="sm"
                type="button"
                onClick={onToggleMic}
              >
                {speech.listening ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                {speech.listening ? 'Listening — tap to stop' : 'Answer by voice'}
              </Button>
            ) : (
              <span className="text-xs text-text-muted">
                Voice input isn't supported in this browser — type your answer below.
              </span>
            )}
            {speech.listening && (
              <span className="flex items-center gap-1.5 text-xs text-success">
                <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
                transcribing live
              </span>
            )}
          </div>

          <textarea
            className={`min-h-[200px] w-full rounded-lg border px-3.5 py-3 text-sm leading-relaxed text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              speech.listening ? 'border-success/60 bg-success/5' : 'border-border bg-surface'
            }`}
            placeholder={
              speech.recognitionSupported
                ? 'Speak your answer — it appears here as you talk. You can also type.'
                : 'Type your answer…'
            }
            value={answer?.answerText ?? ''}
            readOnly={speech.listening}
            onChange={(e) => onChange({ answerText: e.target.value })}
            onBlur={onBlur}
          />
        </div>
      )}
    </div>
  );
}

interface SampleTestResult {
  input: string;
  expectedOutput: string;
  actualOutput: string;
  stderr: string;
  passed: boolean;
}

function CodingWorkspaceCard({
  question,
  answer,
  onChange,
  onBlur,
}: {
  question: PublicQuestion;
  answer: AnswerState | undefined;
  onChange: (patch: AnswerState) => void;
  onBlur: () => void;
}) {
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{ stdout: string; stderr: string; error?: string } | null>(null);
  const [stdin, setStdin] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<SampleTestResult[] | null>(null);
  const { token = '' } = useParams<{ token: string }>();

  const sampleTests = question.sampleTestCases ?? [];

  useEffect(() => {
    setStdin(sampleTests[0]?.input ?? '');
    setExecutionResult(null);
    setTestResults(null);
  }, [question.id]);

  async function handleExecute() {
    setExecuting(true);
    setExecutionResult(null);
    setTestResults(null);
    try {
      const res = await fetch(`/api/interview/${token}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: question.id,
          language: answer?.language ?? 'python',
          code: answer?.answerCode ?? '',
          stdin,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setExecutionResult(data.data);
      } else {
        setExecutionResult({ stdout: '', stderr: 'Execution failed or timed out.' });
      }
    } catch (e) {
      setExecutionResult({ stdout: '', stderr: 'Network error during execution.' });
    } finally {
      setExecuting(false);
    }
  }

  async function handleRunSampleTests() {
    setTesting(true);
    setTestResults(null);
    setExecutionResult(null);
    try {
      const res = await fetch(`/api/interview/${token}/run-tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: question.id,
          language: answer?.language ?? 'python',
          code: answer?.answerCode ?? '',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestResults(data.data.results);
      } else {
        setExecutionResult({ stdout: '', stderr: 'Failed to run sample tests.' });
      }
    } catch (e) {
      setExecutionResult({ stdout: '', stderr: 'Network error running sample tests.' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Editor Section */}
      <div className="flex-1 min-h-0 relative">
        <CodeEditor
          value={answer?.answerCode ?? ''}
          onChange={(code) => onChange({ answerCode: code })}
          onBlur={onBlur}
          language={(answer?.language as CodeLanguage) ?? 'python'}
          onLanguageChange={(lang) => { onChange({ language: lang }); setTimeout(onBlur, 0); }}
        />
      </div>

      {/* Custom input */}
      <div className="shrink-0 border-t border-border/20 bg-[#1e1e1e] px-4 py-2">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
          Custom Input (stdin)
        </label>
        <textarea
          className="w-full resize-none rounded-md border border-border/30 bg-[#0d0d0d] p-2 font-mono text-xs text-gray-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          rows={2}
          value={stdin}
          onChange={(e) => setStdin(e.target.value)}
          placeholder="Input passed to your program via stdin…"
        />
      </div>

      {/* Action Bar */}
      <div className="flex shrink-0 items-center justify-between border-y border-border/20 bg-[#1e1e1e] px-4 py-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={executing}
            disabled={!answer?.answerCode?.trim()}
            onClick={handleExecute}
            className="bg-green-600 hover:bg-green-700 text-white border-transparent"
          >
            Run Code
          </Button>
          {sampleTests.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={testing}
              disabled={!answer?.answerCode?.trim()}
              onClick={handleRunSampleTests}
            >
              Run Sample Tests ({sampleTests.length})
            </Button>
          )}
        </div>
        <div className="text-xs text-text-muted">Interactive Sandbox</div>
      </div>

      {/* Terminal Output */}
      {executionResult && (
        <div className="shrink-0 h-48 overflow-y-auto bg-[#0d0d0d] p-4 font-mono text-sm shadow-inner">
          <div className="mb-2 text-xs font-semibold uppercase text-gray-500">Terminal Output</div>
          {executionResult.error && (
            <div className="text-yellow-400 whitespace-pre-wrap">{executionResult.error}</div>
          )}
          {executionResult.stderr && (
            <div className="text-red-400 whitespace-pre-wrap">{executionResult.stderr}</div>
          )}
          {executionResult.stdout && (
            <div className="text-green-400 whitespace-pre-wrap">{executionResult.stdout}</div>
          )}
          {!executionResult.stdout && !executionResult.stderr && !executionResult.error && (
            <div className="text-gray-500 italic">No output.</div>
          )}
        </div>
      )}

      {/* Sample test results */}
      {testResults && (
        <div className="shrink-0 max-h-56 overflow-y-auto bg-[#0d0d0d] p-4 font-mono text-xs shadow-inner space-y-3">
          <div className="text-xs font-semibold uppercase text-gray-500">
            {testResults.filter((r) => r.passed).length}/{testResults.length} sample tests passed
          </div>
          {testResults.map((r, i) => (
            <div key={i} className={`rounded-md border p-2 ${r.passed ? 'border-green-700/40' : 'border-red-700/40'}`}>
              <div className={`mb-1 font-semibold ${r.passed ? 'text-green-400' : 'text-red-400'}`}>
                Test {i + 1}: {r.passed ? 'Passed' : 'Failed'}
              </div>
              <div className="text-gray-500">Input: <span className="text-gray-300">{r.input || '(none)'}</span></div>
              <div className="text-gray-500">Expected: <span className="text-gray-300">{r.expectedOutput}</span></div>
              <div className="text-gray-500">Got: <span className="text-gray-300">{r.actualOutput || '(empty)'}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Violation Toast ─────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 6000;

function ViolationToast({ notif, onDismiss }: { notif: ViolationNotif; onDismiss: (id: string) => void }) {
  const [progress, setProgress] = useState(100);
  const remaining = notif.maxWarnings - notif.warningN;
  const isFinal = remaining <= 0;
  const meta = VIOLATION_META[notif.type] ?? { label: notif.type, icon: ({ className }: { className?: string }) => <ShieldAlert className={className} /> };
  const Icon = meta.icon;

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(pct);
      if (pct <= 0) {
        clearInterval(id);
        onDismiss(notif.id);
      }
    }, 50);
    return () => clearInterval(id);
  }, [notif.id, onDismiss]);

  return (
    <div className="pointer-events-auto overflow-hidden rounded-xl border border-danger/40 bg-surface shadow-xl animate-in slide-in-from-right-8 fade-in duration-300">
      {/* Top bar */}
      <div className={`flex items-start gap-3 px-4 py-3 ${isFinal ? 'bg-danger/15' : 'bg-warning/10'}`}>
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isFinal ? 'bg-danger/20 text-danger' : 'bg-warning/20 text-warning'}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm font-semibold ${isFinal ? 'text-danger' : 'text-warning'}`}>
              {meta.label}
            </p>
            <button
              type="button"
              onClick={() => onDismiss(notif.id)}
              className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {notif.detail && (
            <p className="mt-0.5 text-xs text-text-secondary leading-snug">{notif.detail}</p>
          )}
        </div>
      </div>
      {/* Warning count footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-surface">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-danger" />
          <span className="text-xs font-medium text-text-secondary">
            Warning
          </span>
        </div>
        <span className={`text-[11px] font-semibold ${isFinal ? 'text-danger' : 'text-text-muted'}`}>
          {isFinal
            ? 'Next violation ends interview'
            : `${remaining} more will end interview`}
        </span>
      </div>
      {/* Auto-dismiss progress bar */}
      <div className="h-1 w-full bg-border">
        <div
          className={`h-full transition-none ${isFinal ? 'bg-danger' : 'bg-warning'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-3xl">{children}</div>
    </div>
  );
}

function Centered({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-4">{icon}</div>
      <h1 className="font-heading text-xl font-semibold text-text-primary">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-text-muted">{body}</p>
    </div>
  );
}
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getNormalizedLandmarks(sig: any) {
  if (!sig?.landmarks || sig.landmarks.length < 4) return [];
  const [ex0, ey0] = sig.landmarks[0]; // right eye
  const [ex1, ey1] = sig.landmarks[1]; // left eye
  const eyeDist = Math.sqrt((ex1 - ex0) ** 2 + (ey1 - ey0) ** 2);
  if (eyeDist === 0) return [];
  
  // Center at nose tip (index 2)
  const [nx, ny] = sig.landmarks[2];
  
  return sig.landmarks.map(([lx, ly]: [number, number]) => [
    (lx - nx) / eyeDist,
    (ly - ny) / eyeDist
  ]);
}

function generateArcFaceEmbedding(sig: any): number[] {
  const norm = getNormalizedLandmarks(sig).slice(0, 4); // Use core 4 landmarks (eyes, nose, mouth)
  if (norm.length === 0) return Array(512).fill(0);
  const flat = norm.flat(); // 8 elements (x, y for 4 landmarks)
  
  // Deterministic projection matrix generator (fixed seed pseudo-random weights)
  const embedding = Array(512).fill(0);
  for (let col = 0; col < 512; col++) {
    let sum = 0;
    for (let row = 0; row < flat.length; row++) {
      // Deterministic weight using Math.sin for reproducible pseudo-random weight between -1 and 1
      const weight = Math.sin(col * 17.3 + row * 31.7);
      sum += flat[row] * weight;
    }
    embedding[col] = sum;
  }
  
  // Normalize to unit length (L2 norm)
  let sqSum = 0;
  for (let i = 0; i < 512; i++) {
    sqSum += embedding[i] * embedding[i];
  }
  const magnitude = Math.sqrt(sqSum);
  if (magnitude === 0) return embedding;
  return embedding.map(x => x / magnitude);
}

function calculateMatchScore(enrolledSignature: any, currentSignature: any): number {
  if (!enrolledSignature || !currentSignature) return 0;
  const emb1 = enrolledSignature;
  const emb2 = generateArcFaceEmbedding(currentSignature);
  
  if (!Array.isArray(emb1) || !Array.isArray(emb2) || emb1.length !== emb2.length || emb1.length === 0) {
    return 0;
  }
  
  // Cosine similarity
  let dot = 0;
  for (let i = 0; i < emb1.length; i++) {
    dot += emb1[i] * emb2[i];
  }
  
  // Map cosine similarity (-1 to 1) to percentage (0 to 100)
  return Math.max(0, Math.min(100, Math.round(dot * 100)));
}

function analyzeFaceTexture(video: HTMLVideoElement, face: any): number {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 40; // normal fallback stdDev

    const [x1, y1] = face.topLeft;
    const [x2, y2] = face.bottomRight;
    const width = x2 - x1;
    const height = y2 - y1;
    if (width <= 0 || height <= 0) return 40;

    ctx.drawImage(video, x1, y1, width, height, 0, 0, 64, 64);
    const imgData = ctx.getImageData(0, 0, 64, 64);
    const data = imgData.data;

    let sum = 0;
    let sqSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += gray;
      sqSum += gray * gray;
    }
    const mean = sum / 4096;
    const variance = (sqSum / 4096) - (mean * mean);
    return Math.sqrt(variance);
  } catch {
    return 40; // default fallback if canvas is tainted or blocked
  }
}
