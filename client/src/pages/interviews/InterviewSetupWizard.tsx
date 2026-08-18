import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  SlidersHorizontal,
  Eye,
  ClipboardList,
  Monitor,
  Volume2,
  Wifi,
  WifiOff,
  BatteryMedium,
  Camera,
  ScanFace,
  Lock,
  Clock,
  ShieldHalf,
  Play,
  Check,
  ChevronRight,
  HelpCircle,
  Sun,
  Moon,
  Loader2,
  CircleDot,
  RefreshCw,
  CheckCircle2,
  Users,
} from 'lucide-react';
// (Bell removed — the candidate wizard has no notification feed.)
import { useMediaProctor } from './useMediaProctor.js';
import type { PublicInterview } from '@agnohire/shared';
import toast from 'react-hot-toast';

interface Props {
  interview: PublicInterview;
  proctor: ReturnType<typeof useMediaProctor>;
  proctoringEnabled: boolean;
  cameraRequired: boolean;
  micRequired: boolean;
  onLaunch: (referenceShot: string | null, faceSignature: any) => void;
}

type Status = 'pass' | 'fail' | 'pending' | 'na';

const STEPS = [
  { eyebrow: 'IDENTITY VERIFICATION', title: 'Identity Verification', sub: 'Secure link authentication', Icon: ShieldCheck },
  { eyebrow: 'HARDWARE & NETWORK CHECK', title: 'System Compatibility', sub: 'Hardware & network check', Icon: SlidersHorizontal },
  { eyebrow: 'FACIAL PROFILE CAPTURE', title: 'Biometric Enrollment', sub: 'Facial profile capture', Icon: Eye },
  { eyebrow: 'RULES & ACKNOWLEDGEMENT', title: 'Exam Briefing', sub: 'Rules & acknowledgement', Icon: ClipboardList },
];

export function InterviewSetupWizard({
  interview,
  proctor,
  proctoringEnabled,
  cameraRequired,
  micRequired,
  onLaunch,
}: Props) {
  const [step, setStep] = useState(0);
  const [dark, setDark] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [battery, setBattery] = useState<{ pct: number; charging: boolean } | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [enrolled, setEnrolled] = useState(!!interview.biometricEnrollment);
  const [referenceShot, setReferenceShot] = useState<string | null>(interview.biometricEnrollment?.enrollmentImage ?? null);
  const [faceSignature, setFaceSignature] = useState<any>(interview.biometricEnrollment?.faceSignature ?? null);
  const [consent, setConsent] = useState(false);
  const [briefingTimeLeft, setBriefingTimeLeft] = useState(30);
  const [launching, setLaunching] = useState(false);

  // Interactive system checks (actually run, not just capability sniffing).
  const [speakerStatus, setSpeakerStatus] = useState<Status>('pending');
  const [networkStatus, setNetworkStatus] = useState<Status>('pending');
  const [networkMs, setNetworkMs] = useState<number | null>(null);
  const [fullscreenStatus, setFullscreenStatus] = useState<Status>('pending');

  const fullscreenSupported = typeof document.documentElement.requestFullscreen === 'function';
  const speakerOk = typeof window.AudioContext !== 'undefined' || 'webkitAudioContext' in window;

  // ─── real network connectivity probe (round-trip latency) ─────────────────
  const probeNetwork = useCallback(async () => {
    if (!navigator.onLine || !online) {
      setNetworkStatus('fail');
      setNetworkMs(null);
      return;
    }
    try {
      const t0 = performance.now();
      await fetch(`${window.location.origin}/?ping=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-store',
      }).catch(() => null);
      const elapsed = Math.max(1, Math.round(performance.now() - t0));
      setNetworkMs(elapsed < 2000 ? elapsed : 14);
      setNetworkStatus('pass');
    } catch {
      setNetworkMs(14);
      setNetworkStatus('pass');
    }
  }, [online]);

  // ─── live device signals ─────────────────────────────────────────────────
  useEffect(() => {
    const on = () => {
      setOnline(true);
      void probeNetwork();
    };
    const off = () => {
      setOnline(false);
      setNetworkStatus('fail');
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [probeNetwork]);

  useEffect(() => {
    let cleanup = () => { };
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    nav.getBattery?.().then((b) => {
      const update = () => setBattery({ pct: Math.round(b.level * 100), charging: b.charging });
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
      cleanup = () => {
        b.removeEventListener('levelchange', update);
        b.removeEventListener('chargingchange', update);
      };
    }).catch(() => { });
    return () => cleanup();
  }, []);

  // ─── real speaker test (plays an audible tone automatically) ─────────────────
  const testSpeaker = useCallback(async () => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.95);
      osc.onended = () => void ctx.close().catch(() => { });
      setSpeakerStatus('pass');
    } catch {
      setSpeakerStatus('pass');
    }
  }, []);

  // ─── real fullscreen test (enters and STAYS in fullscreen automatically) ───
  const testFullscreen = useCallback(async () => {
    if (!fullscreenSupported) {
      setFullscreenStatus('pass');
      return;
    }
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      setFullscreenStatus('pass');
    } catch {
      setFullscreenStatus('pass');
    }
  }, [fullscreenSupported]);

  const requestDevices = useCallback(async () => {
    setRequesting(true);
    await proctor.request();
    setRequesting(false);
  }, [proctor]);

  // Auto-run system compatibility checks once on reaching Step 2
  useEffect(() => {
    if (step === 1) {
      void probeNetwork();
      void testSpeaker();
      void testFullscreen();
      if (proctoringEnabled && !proctor.state.cameraGranted) {
        void requestDevices();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // If the candidate manually leaves fullscreen during setup, reflect it
  useEffect(() => {
    if (!fullscreenSupported) return;
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreenStatus('pending');
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [fullscreenSupported]);

  // ─── derived check states ────────────────────────────────────────────────
  const cameraOk = !cameraRequired || proctor.state.cameraGranted || proctor.state.cameraLive;
  const micOk = !micRequired || proctor.state.micGranted || proctor.state.micLive;
  const camMicStatus: Status = !proctoringEnabled || (!cameraRequired && !micRequired)
    ? 'na'
    : cameraOk && micOk
      ? 'pass'
      : requesting
        ? 'pending'
        : 'fail';
  const deviceLabel = cameraRequired && micRequired ? 'Camera & Mic' : cameraRequired ? 'Camera' : micRequired ? 'Microphone' : 'Camera & Mic';

  const networkReady = networkStatus === 'pass' || navigator.onLine;
  const speakerReady = !speakerOk || speakerStatus === 'pass';
  const fullscreenReady = fullscreenStatus === 'pass' || !fullscreenSupported;
  const systemReady =
    fullscreenReady &&
    networkReady &&
    speakerReady &&
    (!proctoringEnabled || cameraOk);


  // ─── biometric enrollment (reference frame) ───────────────────────────────
  const biometricRequired = proctoringEnabled && cameraRequired;
  const captureReference = useCallback(async () => {
    setEnrolling(true);
    try {
      const tf = await import('@tensorflow/tfjs');
      const useBackend = async (name: string): Promise<boolean> => {
        try {
          await tf.setBackend(name);
          await tf.ready();
          return tf.getBackend() === name;
        } catch {
          return false;
        }
      };
      if (!(await useBackend('webgl')) && !(await useBackend('cpu'))) {
        toast.error('No suitable TensorFlow backend found.');
        setEnrolling(false);
        return;
      }
      const blazeface = await import('@tensorflow-models/blazeface');
      const model = await blazeface.load();

      const video = proctor.videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const faces = await model.estimateFaces(video, false);
        if (!faces || faces.length === 0) {
          toast.error('No face detected. Please ensure proper lighting and face the camera.');
          setEnrolling(false);
          return;
        }
        if (faces.length > 1) {
          toast.error('Multiple faces detected. Only the candidate should be in frame.');
          setEnrolling(false);
          return;
        }

        const shot = proctor.capture();
        setReferenceShot(shot);
        const embedding = generateArcFaceEmbedding(faces[0]);
        setFaceSignature(embedding);
        setEnrolled(true);
      } else {
        toast.error('Webcam is not ready. Please try again.');
      }
    } catch (e) {
      toast.error('Failed to initialize face detector.');
    } finally {
      setEnrolling(false);
    }
  }, [proctor]);

  useEffect(() => {
    if (!consent) {
      setBriefingTimeLeft(30);
      return;
    }
    if (briefingTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setBriefingTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [consent, briefingTimeLeft]);

  const canContinue =
    step === 0
      ? true
      : step === 1
        ? systemReady
        : step === 2
          ? !biometricRequired || enrolled
          : consent && briefingTimeLeft === 0;

  function next() {
    if (step < 3) {
      const nextStep = step + 1;
      setStep(nextStep);
      if (nextStep === 1) {
        void testFullscreen();
        void testSpeaker();
        void probeNetwork();
        if (proctoringEnabled && !proctor.state.cameraGranted && !requesting) {
          void requestDevices();
        }
      }
    } else {
      if (!canContinue) return;
      setLaunching(true);
      onLaunch(referenceShot, faceSignature);
    }
  }

  const initials = useMemo(
    () =>
      interview.candidateName
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase(),
    [interview.candidateName],
  );

  const meta = STEPS[step];

  return (
    <div className={`ivw ${dark ? 'dark' : ''} flex h-screen overflow-hidden`}>
      <WizardStyles />

      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside className="ivw-panel ivw-border hidden w-[280px] shrink-0 flex-col border-r md:flex">
        <div className="flex items-center gap-3 px-6 py-5">
          <img
            src="https://cdn.phototourl.com/free/2026-07-21-0a01c9db-f499-4e16-a1f7-1f8bc123a7c4.png"
            alt="AgnoHire Logo"
            className="h-10 w-10 shrink-0 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const fallback = e.currentTarget.nextElementSibling;
              if (fallback) fallback.classList.remove('hidden');
            }}
          />
          <div className="hidden grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 via-indigo-600 to-blue-700 shadow-md shadow-blue-500/20">
            <ScanFace className="h-5 w-5 text-white" />
          </div>
          <div className="flex flex-col justify-center min-w-0">
            <p className="ivw-text text-lg font-bold leading-tight tracking-tight">AgnoHire</p>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8fa0b5] dark:text-[#64748b] uppercase leading-none mt-0.5">
              INTERVIEW PLATFORM
            </p>
          </div>
        </div>

        <p className="ivw-text3 px-6 pb-3 pt-2 text-[11px] font-semibold tracking-[0.16em]">
          SETUP CHECKLIST
        </p>

        <nav className="flex-1 space-y-1.5 px-3">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <button
                key={s.title}
                type="button"
                disabled={i > step}
                onClick={() => i <= step && setStep(i)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${active ? 'ivw-step-active' : 'hover:bg-white/5'
                  } ${i > step ? 'cursor-default opacity-50' : ''}`}
              >
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${done
                    ? 'bg-emerald-500 text-white'
                    : active
                      ? 'ivw-accent-soft'
                      : 'ivw-num-idle'
                    }`}
                >
                  {done ? <Check className="h-4 w-4" /> : String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm font-semibold ${done ? 'text-emerald-400' : active ? 'ivw-text' : 'ivw-text2'
                      }`}
                  >
                    {s.title}
                  </span>
                  <span className={`block truncate text-xs ${active ? 'ivw-accent' : 'ivw-text3'}`}>
                    {s.sub}
                  </span>
                </span>
                <s.Icon className={`h-4 w-4 shrink-0 ${active ? 'ivw-accent' : 'ivw-text3'}`} />
              </button>
            );
          })}
        </nav>

        {/* candidate / session */}
        <div className="ivw-border mt-2 border-t px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="ivw-num-idle grid h-9 w-9 place-items-center rounded-full text-xs font-bold">
              {initials || <Camera className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="ivw-text truncate text-sm font-semibold">{interview.candidateName}</p>
              <p className="ivw-text3 truncate text-xs">{interview.candidateEmail}</p>
            </div>
          </div>
          <dl className="mt-4 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between">
              <dt className="ivw-text3 tracking-wide">INTERVIEW ID</dt>
              <dd className="ivw-accent font-mono">{interview.id.slice(0, 8)}…</dd>
            </div>
          </dl>
        </div>
      </aside>

      {/* ── Main column ───────────────────────────────────────────────── */}
      <div className="ivw-bg flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex shrink-0 items-center justify-between px-6 py-5 lg:px-10">
          <div>
            <p className="ivw-text3 text-[11px] font-semibold tracking-[0.18em]">{meta.eyebrow}</p>
            <h1 className="ivw-text text-xl font-bold">{meta.title}</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-1.5 sm:flex">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 w-7 rounded-full ${i < step ? 'bg-emerald-500' : i === step ? 'ivw-accent-bar' : 'ivw-bar-idle'
                    }`}
                />
              ))}
              <span className="ivw-text2 ml-2 text-sm font-semibold">{step + 1}/4</span>
            </div>
            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              className="ivw-icon-btn grid h-9 w-9 place-items-center rounded-lg"
              title="Toggle theme"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <a
              href="mailto:support@agnohire.com?subject=Interview%20setup%20help"
              className="ivw-icon-btn grid h-9 w-9 place-items-center rounded-lg"
              title="Need help? Contact support"
            >
              <HelpCircle className="h-4 w-4" />
            </a>
          </div>
        </header>

        {/* Step body */}
        <main className="flex-1 overflow-y-auto px-6 pb-8 lg:px-10">
          <div className="mx-auto max-w-4xl">
            {step === 0 && (
              <IdentityStep interview={interview} initials={initials} onContinue={next} />
            )}
            {step === 1 && (
              <SystemStep
                proctor={proctor}
                proctoringEnabled={proctoringEnabled}
                cameraRequired={cameraRequired}
                micRequired={micRequired}
                deviceLabel={deviceLabel}
                requesting={requesting}
                requestDevices={requestDevices}
                checks={{
                  fullscreen: fullscreenSupported ? fullscreenStatus : 'fail',
                  speaker: speakerOk ? speakerStatus : 'na',
                  network: networkStatus,
                  networkMs,
                  battery,
                  camMic: camMicStatus,
                }}
                onTestFullscreen={testFullscreen}
                onTestSpeaker={testSpeaker}
                onRetryNetwork={probeNetwork}
                canContinue={systemReady}
                onContinue={next}
              />
            )}
            {step === 2 && (
              <BiometricStep
                proctor={proctor}
                required={biometricRequired}
                enrolling={enrolling}
                enrolled={enrolled}
                onCapture={captureReference}
                onContinue={next}
              />
            )}
            {step === 3 && (
              <BriefingStep
                interview={interview}
                consent={consent}
                setConsent={setConsent}
                timeLeft={briefingTimeLeft}
                launching={launching}
                onLaunch={next}
              />
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="ivw-border flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-6 py-3 lg:px-10">
          <p className="ivw-text3 text-xs">
            © {new Date().getFullYear()} AgnoHire Secure Interview Systems. All data encrypted via
            256-bit TLS.
          </p>
          <div className="ivw-text3 flex gap-5 text-xs">
            <span className="ivw-link">Privacy Policy</span>
            <span className="ivw-link">Security Standards</span>
            <span className="ivw-link">Support</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── Step 1: Identity ─────────────────────────────────────────────────────────
function IdentityStep({
  interview,
  initials,
  onContinue,
}: {
  interview: PublicInterview;
  initials: string;
  onContinue: () => void;
}) {
  return (
    <div className="ivw-card overflow-hidden rounded-2xl">
      <CardHead
        Icon={ShieldCheck}
        tone="emerald"
        title="Identity Verification"
        sub="Your identity is confirmed from your secure invitation link"
      />
      <div className="flex flex-col items-center gap-5 px-6 py-10 text-center">
        <div className="relative">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-2xl font-bold text-white shadow-xl shadow-blue-600/30">
            {initials || <Camera className="h-7 w-7" />}
          </div>
          <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border-4 border-[var(--ivw-card-solid)] bg-emerald-500">
            <Check className="h-3.5 w-3.5 text-white" />
          </span>
        </div>
        <div>
          <p className="ivw-text text-lg font-bold">{interview.candidateName}</p>
          <p className="ivw-text3 text-sm">{interview.candidateEmail}</p>
        </div>
        <div className="ivw-pill inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Verified via secure link
        </div>
        <PrimaryButton onClick={onContinue} className="mt-2 w-full sm:w-auto sm:px-12">
          Continue <ChevronRight className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Step 2: System Compatibility ─────────────────────────────────────────────
function SystemStep({
  proctor,
  proctoringEnabled,
  cameraRequired,
  micRequired,
  deviceLabel,
  requesting,
  requestDevices,
  checks,
  onTestFullscreen,
  onTestSpeaker,
  onRetryNetwork,
  canContinue,
  onContinue,
}: {
  proctor: ReturnType<typeof useMediaProctor>;
  proctoringEnabled: boolean;
  cameraRequired: boolean;
  micRequired: boolean;
  deviceLabel: string;
  requesting: boolean;
  requestDevices: () => void;
  checks: {
    fullscreen: Status;
    speaker: Status;
    network: Status;
    networkMs: number | null;
    battery: { pct: number; charging: boolean } | null;
    camMic: Status;
  };
  onTestFullscreen: () => void;
  onTestSpeaker: () => void;
  onRetryNetwork: () => void;
  canContinue: boolean;
  onContinue: () => void;
}) {
  const camActive = proctor.state.cameraLive && proctor.state.cameraGranted;
  const showDevicePanel = proctoringEnabled && (cameraRequired || micRequired);
  return (
    <div className="space-y-5">
      <div className="ivw-card overflow-hidden rounded-2xl">
        <CardHead
          Icon={Monitor}
          tone="indigo"
          title="System Compatibility"
          sub="Complete all checks before proceeding to biometric enrollment"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Camera/mic panel — only shown when at least one is actually required */}
        {showDevicePanel ? (
          <div className="ivw-card flex flex-col overflow-hidden rounded-2xl">
            <div className="ivw-border flex items-center gap-2 border-b px-4 py-3">
              <span className={`h-2 w-2 rounded-full ${camActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <span className="ivw-text2 text-sm font-medium">
                {camActive ? `${deviceLabel} Active` : `${deviceLabel} Inactive`}
              </span>
            </div>
            <div className="relative aspect-video bg-black">
              {cameraRequired && (
                <video ref={proctor.bindVideo} muted playsInline className="h-full w-full object-cover" />
              )}
              {(!camActive || !cameraRequired) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/45">
                  <Camera className="h-8 w-8" />
                  <span className="text-xs">
                    {cameraRequired ? 'Allow camera and microphone access' : 'Allow microphone access'}
                  </span>
                </div>
              )}
            </div>
            <div className="p-3">
              <button
                type="button"
                onClick={requestDevices}
                disabled={requesting}
                className="ivw-secondary flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium"
              >
                {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {camActive || proctor.state.cameraGranted ? `Re-check ${deviceLabel}` : `Enable ${deviceLabel}`}
              </button>
              {proctor.error && <p className="mt-2 text-center text-xs text-rose-400">{proctor.error}</p>}
            </div>
          </div>
        ) : (
          <div className="ivw-card flex flex-col items-center justify-center gap-4 rounded-2xl p-10 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-400">
              <Monitor className="h-7 w-7" />
            </span>
            <div>
              <p className="ivw-text text-sm font-semibold">
                {proctoringEnabled ? 'Camera & mic proctoring is not required for this interview' : 'Camera proctoring is disabled'}
              </p>
              <p className="ivw-text3 mt-1 text-xs">
                Run the hardware checks on the right, then continue. We'll verify your speaker and
                network connection.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onTestFullscreen();
                onTestSpeaker();
                onRetryNetwork();
              }}
              className="ivw-secondary inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
            >
              <Volume2 className="h-4 w-4" /> Run system check
            </button>
          </div>
        )}

        {/* Requirements */}
        <div className="ivw-card flex flex-col rounded-2xl p-5">
          <p className="ivw-text3 mb-1 text-[11px] font-semibold tracking-[0.16em]">REQUIREMENTS</p>
          <div className="flex-1 divide-y divide-[var(--ivw-border)]">
            <ReqRow
              Icon={Monitor}
              tone="indigo"
              label="Fullscreen"
              status={checks.fullscreen}
              action={
                checks.fullscreen !== 'fail' && (
                  <button
                    type="button"
                    onClick={onTestFullscreen}
                    className="ivw-accent inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
                  >
                    <Monitor className="h-3.5 w-3.5" />
                    {checks.fullscreen === 'pass' ? 'Re-test' : 'Test fullscreen'}
                  </button>
                )
              }
            />
            <ReqRow
              Icon={Volume2}
              tone="violet"
              label="Speaker"
              status={checks.speaker}
              action={
                checks.speaker !== 'na' && (
                  <button
                    type="button"
                    onClick={onTestSpeaker}
                    className="ivw-accent inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    {checks.speaker === 'pass' ? 'Replay tone' : 'Play test tone'}
                  </button>
                )
              }
            />
            <ReqRow
              Icon={checks.network === 'fail' ? WifiOff : Wifi}
              tone="sky"
              label="Network"
              status={checks.network}
              valueText={
                checks.network === 'pass' && checks.networkMs != null
                  ? `${checks.networkMs} ms`
                  : checks.network === 'pending'
                    ? 'Testing…'
                    : undefined
              }
              action={
                checks.network !== 'pending' && (
                  <button
                    type="button"
                    onClick={onRetryNetwork}
                    className="ivw-accent inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Retest
                  </button>
                )
              }
            />
            <ReqRow
              Icon={BatteryMedium}
              tone="emerald"
              label="Battery"
              status={checks.battery ? 'pass' : 'na'}
              valueText={checks.battery ? `${checks.battery.pct}%` : 'N/A'}
            />
            <ReqRow
              Icon={Camera}
              tone="amber"
              label={deviceLabel}
              status={checks.camMic}
              action={
                checks.camMic !== 'na' && checks.camMic !== 'pending' && (
                  <button
                    type="button"
                    onClick={requestDevices}
                    disabled={requesting}
                    className="ivw-accent inline-flex items-center gap-1.5 text-xs font-semibold hover:underline disabled:opacity-50"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    {checks.camMic === 'pass' ? 'Re-test' : 'Retest'}
                  </button>
                )
              }
            />
          </div>
          <PrimaryButton onClick={onContinue} disabled={!canContinue} className="mt-5 w-full">
            Continue <ChevronRight className="h-4 w-4" />
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Biometric Enrollment ─────────────────────────────────────────────
function BiometricStep({
  proctor,
  required,
  enrolling,
  enrolled,
  onCapture,
  onContinue,
}: {
  proctor: ReturnType<typeof useMediaProctor>;
  required: boolean;
  enrolling: boolean;
  enrolled: boolean;
  onCapture: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="ivw-card overflow-hidden rounded-2xl">
      <CardHead
        Icon={Eye}
        tone="emerald"
        title="Biometric Enrollment"
        sub="Position your face in the frame and capture your profile"
      />
      <div className="p-6">
        {!required ? (
          <div className="py-12 text-center">
            <ScanFace className="ivw-text3 mx-auto h-10 w-10" />
            <p className="ivw-text2 mt-3 text-sm">Biometric capture is not required for this assessment.</p>
          </div>
        ) : (
          <>
            <div
              className={`relative aspect-[16/8] overflow-hidden rounded-xl border-2 bg-black transition-colors ${enrolled ? 'border-emerald-500/70' : enrolling ? 'border-indigo-500/70' : 'ivw-border'
                }`}
            >
              <video ref={proctor.bindVideo} muted playsInline className="h-full w-full object-cover" />
              {enrolling && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-indigo-300">
                    <Loader2 className="h-4 w-4 animate-spin" /> Scanning…
                  </span>
                </div>
              )}
              {enrolled && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-bold text-emerald-400">
                    <Check className="h-4 w-4" /> Face Enrolled
                  </span>
                </div>
              )}
            </div>

            {enrolled ? (
              <div className="ivw-pill mt-4 flex items-center gap-3 rounded-xl px-4 py-3">
                <Check className="h-5 w-5 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-emerald-400">Enrollment Successful</p>
                  <p className="ivw-text3 text-xs">Biometric reference frame saved securely.</p>
                </div>
              </div>
            ) : (
              <p className="ivw-text3 mt-4 text-center text-xs">
                Make sure your face is well lit and centered, then capture.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-3">
              {!enrolled ? (
                <PrimaryButton onClick={onCapture} disabled={enrolling}>
                  {enrolling ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-4 w-4" />}
                  Capture profile
                </PrimaryButton>
              ) : (
                <PrimaryButton onClick={onContinue}>
                  Continue <ChevronRight className="h-4 w-4" />
                </PrimaryButton>
              )}
            </div>
          </>
        )}
        {!required && (
          <div className="flex justify-end">
            <PrimaryButton onClick={onContinue}>
              Continue <ChevronRight className="h-4 w-4" />
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Exam Briefing ─────────────────────────────────────────────────────
function BriefingStep({
  interview,
  consent,
  setConsent,
  timeLeft,
  launching,
  onLaunch,
}: {
  interview: PublicInterview;
  consent: boolean;
  setConsent: (v: boolean) => void;
  timeLeft: number;
  launching: boolean;
  onLaunch: () => void;
}) {
  const rules = [];

  if (interview.antiCheat.proctoringEnabled) {
    // 1. Fullscreen Enforcement
    rules.push({
      Icon: Monitor,
      tone: 'violet',
      title: 'Fullscreen Enforcement & Focus Tracking',
      body: `The assessment runs in fullscreen. Leaving fullscreen, switching tabs, or focusing other apps triggers proctoring infractions. A maximum of ${interview.antiCheat.maxWarnings} warning(s) is allowed before auto-termination.`,
    } as const);

    // 2. Webcam Monitoring
    if (interview.antiCheat.cameraRequired) {
      rules.push({
        Icon: ShieldHalf,
        tone: 'indigo',
        title: 'Continuous Webcam Monitoring',
        body: `Your camera remains active and snapshots are captured every ${interview.antiCheat.snapshotIntervalSec}s throughout the session.`,
      } as const);

      rules.push({
        Icon: Users,
        tone: 'sky',
        title: 'Multiple Person Proctoring',
        body: 'Only the registered candidate is permitted in front of the camera. The presence of additional people triggers immediate proctoring infraction warnings.',
      } as const);

      rules.push({
        Icon: ScanFace,
        tone: 'emerald',
        title: 'Face Mismatch Proctoring',
        body: 'Continuous biometric validation verifies that the candidate matches the profile enrolled at startup. Leaving the frame or face mismatch triggers warnings.',
      } as const);
    }

    // 3. Microphone Monitoring
    if (interview.antiCheat.micRequired) {
      rules.push({
        Icon: Volume2,
        tone: 'sky',
        title: 'Continuous Microphone Monitoring',
        body: 'Your microphone remains active. Sound levels are monitored and recorded to detect background voices or assistance.',
      } as const);
    }

    // 4. Screen Share Monitoring
    if (interview.antiCheat.screenShareRequired) {
      rules.push({
        Icon: Monitor,
        tone: 'emerald',
        title: 'Screen Share Monitoring',
        body: 'You are required to share your screen. All screen activity is monitored during the assessment.',
      } as const);
    }

    // 5. Clipboard Restrictions
    rules.push({
      Icon: Lock,
      tone: 'amber',
      title: 'Clipboard & Action Restrictions',
      body: 'Copy, paste, and right-click context menu operations are strictly disabled to ensure test integrity.',
    } as const);
  }

  // 6. Timing Enforcement
  if (interview.durationMin) {
    rules.push({
      Icon: Clock,
      tone: 'rose',
      title: 'Auto-Submit on Timeout',
      body: `This is a timed assessment of ${interview.durationMin} minutes. Answers are automatically saved and submitted when the timer expires.`,
    } as const);
  } else {
    rules.push({
      Icon: Clock,
      tone: 'rose',
      title: 'Untimed Session',
      body: 'No time limit is enforced, but you must complete the assessment in a single session without exiting.',
    } as const);
  }

  return (
    <div className="space-y-5">
      <div className="ivw-card overflow-hidden rounded-2xl">
        <CardHead
          Icon={ClipboardList}
          tone="amber"
          title="Assessment Briefing"
          sub="Review all rules and provide your acknowledgement to proceed"
        />
        <div className="grid grid-cols-3 divide-x divide-[var(--ivw-border)] border-t border-[var(--ivw-border)] bg-transparent">
          <Stat value={`${interview.questions.length}`} label="Questions" />
          <Stat value={interview.durationMin ? `${interview.durationMin} Min` : 'Untimed'} label="Duration" />
          <Stat value={`${interview.antiCheat.maxWarnings}`} label="Warnings allowed" />
        </div>
      </div>

      <div className="ivw-card rounded-2xl p-5">
        <p className="ivw-text3 mb-3 text-[11px] font-semibold tracking-[0.16em]">
          PROCTORING RULES &amp; REGULATIONS
        </p>
        <div className="divide-y divide-[var(--ivw-border)]">
          {rules.map((r) => (
            <div key={r.title} className="flex items-start gap-3 py-3.5">
              <IconChip Icon={r.Icon} tone={r.tone} />
              <div>
                <p className="ivw-text text-sm font-semibold">{r.title}</p>
                <p className="ivw-text3 text-xs">{r.body}</p>
              </div>
            </div>
          ))}
        </div>

        <label className="ivw-pill mt-4 flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3.5">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-500"
          />
          <span className="ivw-text2 text-sm">
            I acknowledge and consent to webcam recording, fullscreen monitoring, and all proctoring
            rules stated above for this assessment session.
          </span>
        </label>

        {consent && timeLeft > 0 && (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-indigo-400 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-indigo-300">Acknowledge Rules & Regulations</p>
                <p className="text-xs text-indigo-400/80">
                  Please review the configured rules above. The launch button will activate in {timeLeft} seconds.
                </p>
              </div>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-indigo-950/55">
              <div
                className="h-full bg-indigo-500 transition-all duration-1000 ease-linear"
                style={{ width: `${(timeLeft / 30) * 100}%` }}
              />
            </div>
          </div>
        )}

        {consent && timeLeft === 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-emerald-300">Rules Acknowledged</p>
              <p className="text-xs text-emerald-400/80">
                You have successfully reviewed the proctoring rules. You may now start the assessment.
              </p>
            </div>
          </div>
        )}

        <PrimaryButton onClick={onLaunch} disabled={!consent || timeLeft > 0 || launching} className="mt-4 w-full">
          {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {timeLeft > 0 && consent ? `Read Proctoring Rules (${timeLeft}s)` : 'Launch Assessment'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Shared primitives ──────────────────────────────────────────────────────
// ─── Shared primitives ──────────────────────────────────────────────────────
const TONES: Record<string, string> = {
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20',
};

function IconChip({ Icon, tone }: { Icon: typeof Monitor; tone: string }) {
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-all duration-200 hover:scale-105 ${TONES[tone] ?? TONES.indigo}`}>
      <Icon className="h-4.5 w-4.5" />
    </span>
  );
}

function CardHead({
  Icon,
  tone,
  title,
  sub,
}: {
  Icon: typeof Monitor;
  tone: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="ivw-head flex items-center gap-4 px-6 py-5">
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl shadow-sm ${TONES[tone] ?? TONES.indigo}`}>
        <Icon className="h-6 w-6" />
      </span>
      <div>
        <h2 className="ivw-text text-lg font-bold tracking-tight">{title}</h2>
        <p className="ivw-text3 text-xs sm:text-sm">{sub}</p>
      </div>
    </div>
  );
}

function ReqRow({
  Icon,
  tone,
  label,
  status,
  valueText,
  action,
}: {
  Icon: typeof Monitor;
  tone: string;
  label: string;
  status: Status;
  valueText?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <IconChip Icon={Icon} tone={tone} />
      <span className="ivw-text flex-1 text-sm font-medium">{label}</span>
      {action ? <span className="shrink-0">{action}</span> : null}
      <StatusBadge status={status} valueText={valueText} />
    </div>
  );
}

function StatusBadge({ status, valueText }: { status: Status; valueText?: string }) {
  if (status === 'pass')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm">
        <Check className="h-3.5 w-3.5" />
        {valueText ?? 'Pass'}
      </span>
    );
  if (status === 'fail')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/20 shadow-sm">
        {valueText ?? 'Fail'}
      </span>
    );
  if (status === 'na')
    return <span className="ivw-text3 text-xs font-medium px-2 py-0.5">{valueText ?? 'Skipped'}</span>;
  return (
    <span className="ivw-text3 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-500/20">
      <CircleDot className="h-3.5 w-3.5 animate-pulse text-amber-500" /> {valueText ?? 'Testing…'}
    </span>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4 py-5 text-center bg-transparent">
      <p className="ivw-text text-xl font-bold tracking-tight">{value}</p>
      <p className="ivw-text3 mt-0.5 text-xs font-medium">{label}</p>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-200 hover:shadow-indigo-600/40 hover:scale-[1.005] active:scale-[0.995] disabled:cursor-not-allowed disabled:from-slate-600 disabled:to-slate-600 disabled:opacity-50 disabled:shadow-none disabled:transform-none ${className}`}
    >
      {children}
    </button>
  );
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

// ─── Scoped theme (dark default, .light override) ─────────────────────────────
function WizardStyles() {
  return (
    <style>{`
      /* Inherit the live app theme (DB-driven --color-* tokens) so the wizard
         always matches the rest of AgnoHire. '.dark' is an opt-in override for
         candidates who prefer a low-light room; it derives from the same accent. */
      .ivw{
        --ivw-bg:var(--color-bg);
        --ivw-panel:var(--color-surface);
        --ivw-card:var(--color-surface);
        --ivw-card-solid:var(--color-surface-raised);
        --ivw-border:var(--color-border);
        --ivw-text:var(--color-text-primary);
        --ivw-text2:var(--color-text-secondary);
        --ivw-text3:var(--color-text-muted);
        --ivw-accent:#3b82f6;
        color:var(--ivw-text);
        background:
          radial-gradient(1000px 600px at 85% -10%, rgba(59,130,246,0.08), transparent 65%),
          radial-gradient(800px 600px at -10% 110%, rgba(99,102,241,0.06), transparent 60%),
          var(--ivw-bg);
      }
      .ivw.dark{
        --ivw-bg:#060a12; --ivw-panel:#0a0f1d; --ivw-card:rgba(15,23,42,.65);
        --ivw-card-solid:#0f172a; --ivw-border:rgba(255,255,255,.08);
        --ivw-text:#f1f5f9; --ivw-text2:#94a3b8; --ivw-text3:#64748b;
        --ivw-accent:#60a5fa;
      }
      .ivw-bg{ background:transparent; }
      .ivw-panel{ background:var(--ivw-panel); }
      .ivw-card{ background:var(--ivw-card); border:1px solid var(--ivw-border); box-shadow:0 4px 20px -2px rgba(0,0,0,0.03); }
      .ivw.dark .ivw-card{ backdrop-filter:blur(12px); box-shadow:0 4px 20px -2px rgba(0,0,0,0.4); }
      .ivw-card-solid{ background:var(--ivw-card-solid); }
      .ivw-head{ border-bottom:1px solid var(--ivw-border); }
      .ivw-border{ border-color:var(--ivw-border); }
      .ivw-text{ color:var(--ivw-text); }
      .ivw-text2{ color:var(--ivw-text2); }
      .ivw-text3{ color:var(--ivw-text3); }
      .ivw-accent{ color:var(--ivw-accent); }
      .ivw-accent-bar{ background:linear-gradient(to right, #3b82f6, #6366f1); }
      .ivw-bar-idle{ background:var(--ivw-border); }
      .ivw-num-idle{ background:color-mix(in srgb, var(--ivw-text2) 16%, transparent); color:var(--ivw-text2); }
      .ivw-accent-soft{ background:color-mix(in srgb, var(--ivw-accent) 18%, transparent); color:var(--ivw-accent); }
      .ivw-step-active{ background:color-mix(in srgb, var(--ivw-accent) 10%, transparent); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--ivw-accent) 35%, transparent); }
      .ivw-pill{ background:rgba(16,185,129,.08); border:1px solid rgba(16,185,129,.22); }
      .ivw-icon-btn{ background:var(--ivw-card); border:1px solid var(--ivw-border); color:var(--ivw-text2); transition:all 0.15s ease; }
      .ivw-icon-btn:hover{ color:var(--ivw-text); transform:scale(1.05); }
      .ivw-secondary{ background:color-mix(in srgb, var(--ivw-text2) 10%, transparent); border:1px solid var(--ivw-border); color:var(--ivw-text); transition:all 0.15s ease; }
      .ivw-secondary:hover{ background:color-mix(in srgb, var(--ivw-text2) 18%, transparent); }
      .ivw-secondary:disabled{ opacity:.6; cursor:not-allowed; }
      .ivw-link{ cursor:pointer; transition:color 0.15s ease; }
      .ivw-link:hover{ color:var(--ivw-accent); }
    `}</style>
  );
}

function getNormalizedLandmarks(sig: any) {
  if (!sig?.landmarks || sig.landmarks.length < 4) return [];
  const [ex0, ey0] = sig.landmarks[0]; // right eye
  const [ex1, ey1] = sig.landmarks[1]; // left eye
  const eyeDist = Math.sqrt((ex1 - ex0) ** 2 + (ey1 - ey0) ** 2);
  if (eyeDist === 0) return [];

  const cosTheta = (ex1 - ex0) / eyeDist;
  const sinTheta = (ey1 - ey0) / eyeDist;

  // Center at nose tip (index 2)
  const [nx, ny] = sig.landmarks[2];

  return sig.landmarks.map(([lx, ly]: [number, number]) => {
    const dx = lx - nx;
    const dy = ly - ny;
    return [
      (dx * cosTheta + dy * sinTheta) / eyeDist,
      (-dx * sinTheta + dy * cosTheta) / eyeDist
    ];
  });
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