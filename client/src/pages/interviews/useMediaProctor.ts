import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Camera + microphone proctoring primitive for the candidate interview.
 *
 * Owns a single `getUserMedia` stream and exposes:
 *  - a `videoRef` to attach a live preview / self-view,
 *  - liveness flags (`cameraLive` / `micLive`) that flip false the moment a
 *    track ends or is muted (camera covered, unplugged, permission revoked),
 *  - a real-time `micLevel` (0–1) for the device-check meter,
 *  - `capture()` to grab a downscaled JPEG data URL for snapshot evidence.
 *
 * The hook is deliberately self-contained so the page can stay declarative.
 */
export interface MediaProctorState {
  cameraGranted: boolean;
  micGranted: boolean;
  cameraLive: boolean;
  micLive: boolean;
}

interface Options {
  video: boolean;
  audio: boolean;
}

export function useMediaProctor({ video, audio }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const [state, setState] = useState<MediaProctorState>({
    cameraGranted: false,
    micGranted: false,
    cameraLive: false,
    micLive: false,
  });
  const [micLevel, setMicLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const attachLiveness = useCallback((stream: MediaStream) => {
    const watch = (kind: 'video' | 'audio') => {
      const track = stream.getTracks().find((t) => t.kind === kind);
      if (!track) return;
      const flag = kind === 'video' ? 'cameraLive' : 'micLive';
      const setLive = (live: boolean) => setState((s) => ({ ...s, [flag]: live }));
      track.addEventListener('ended', () => setLive(false));
      track.addEventListener('mute', () => setLive(false));
      track.addEventListener('unmute', () => setLive(true));
    };
    watch('video');
    watch('audio');
  }, []);

  /** Re-derive liveness from the live stream's track state. Used on a
   *  `devicechange` event so a camera/mic unplugged mid-interview is caught
   *  even when the browser doesn't fire a track `ended`/`mute` event. */
  const syncLiveness = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const vt = stream.getVideoTracks()[0];
    const at = stream.getAudioTracks()[0];
    setState((s) => ({
      ...s,
      cameraLive: video ? !!vt && vt.readyState === 'live' && !vt.muted : s.cameraLive,
      micLive: audio ? !!at && at.readyState === 'live' && !at.muted : s.micLive,
    }));
  }, [video, audio]);

  const startMeter = useCallback((stream: MediaStream) => {
    if (!audio || stream.getAudioTracks().length === 0) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setMicLevel((prev) => prev * 0.6 + Math.min(1, rms * 3) * 0.4);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* metering is best-effort */
    }
  }, [audio]);

  /** Request camera/mic permission and begin the live preview + meter. */
  const request = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // `mediaDevices` is absent. Disambiguate the real reason so the message is
      // actionable — the generic "use https/localhost" text is wrong (and
      // confusing) when the page is already on localhost but embedded.
      const inEmbeddedFrame = (() => {
        try {
          return window.self !== window.top;
        } catch {
          // Cross-origin parent threw on access → we are framed by another origin.
          return true;
        }
      })();
      if (inEmbeddedFrame) {
        setError(
          'Camera/microphone are blocked because this interview is embedded inside another app (e.g. Microsoft Teams or Slack). Copy the interview link and open it directly in a standalone Chrome or Edge tab, then retry.',
        );
      } else if (!window.isSecureContext) {
        setError(
          'Camera access needs a secure page. Open this link over https:// or on http://localhost (a plain http:// network address is blocked by the browser).',
        );
      } else {
        setError(
          'Your browser is blocking camera/microphone access. Open this interview link directly in a standalone Chrome or Edge tab — not inside another app such as Microsoft Teams or Slack. If it still fails, a corporate device policy may be disabling the camera.',
        );
      }
      return false;
    }

    const describe = (kind: string, e: unknown): string => {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError')
        return `${kind} blocked — click the camera/lock icon in the address bar, allow access, then retry.`;
      if (name === 'NotFoundError' || name === 'OverconstrainedError')
        return `No ${kind.toLowerCase()} found on this device.`;
      if (name === 'NotReadableError' || name === 'AbortError')
        return `Your ${kind.toLowerCase()} is in use by another app (Zoom, Teams, Meet…). Close it and retry.`;
      return `Could not access your ${kind.toLowerCase()}.`;
    };

    // Tear down any previous stream + meter first. Without this, a re-check
    // ("Re-check Camera & Mic") leaves the prior tracks running (camera light
    // stays on) and spawns a second metering rAF loop — and the device often
    // reports busy (NotReadableError) on the retry.
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    // Acquire camera and microphone *independently* so a single missing or busy
    // device doesn't sink both — and so the checklist can show exactly which failed.
    const merged = new MediaStream();
    const problems: string[] = [];

    if (video) {
      try {
        const v = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        });
        v.getVideoTracks().forEach((t) => merged.addTrack(t));
      } catch (e) {
        problems.push(describe('Camera', e));
      }
    }
    if (audio) {
      try {
        const a = await navigator.mediaDevices.getUserMedia({ audio: true });
        a.getAudioTracks().forEach((t) => merged.addTrack(t));
      } catch (e) {
        problems.push(describe('Microphone', e));
      }
    }

    const hasVideo = merged.getVideoTracks().length > 0;
    const hasAudio = merged.getAudioTracks().length > 0;

    if (merged.getTracks().length === 0) {
      setError(problems.join(' ') || 'No camera or microphone was detected.');
      return false;
    }

    streamRef.current = merged;
    if (videoRef.current) {
      videoRef.current.srcObject = merged;
      await videoRef.current.play().catch(() => {});
    }
    attachLiveness(merged);
    startMeter(merged);
    setState({
      cameraGranted: video ? hasVideo : true,
      micGranted: audio ? hasAudio : true,
      cameraLive: video ? hasVideo : true,
      micLive: audio ? hasAudio : true,
    });
    // Partial success (e.g. mic OK, camera busy) — surface what's still wrong.
    setError(problems.length ? problems.join(' ') : null);
    return true;
  }, [video, audio, attachLiveness, startMeter]);

  /** Re-attach the existing stream to a (possibly remounted) video element.
   *  Ignores unmount (`null`): the wizard steps and the live-interview header
   *  share this one callback ref, and React does not guarantee it fires the new
   *  element's bind before the old element's unbind. Clearing on `null` could
   *  leave `videoRef` empty even though a live element is mounted, which would
   *  silently break `capture()` (biometric frame + every proctoring snapshot). */
  const bindVideo = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    videoRef.current = el;
    if (streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => {});
    }
  }, []);

  /** Capture a downscaled JPEG data URL of the current camera frame. */
  const capture = useCallback((): string | null => {
    const v = videoRef.current;
    const stream = streamRef.current;
    if (!v || !stream || v.videoWidth === 0) return null;
    const w = 480;
    const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const cx = canvas.getContext('2d');
    if (!cx) return null;
    cx.drawImage(v, 0, 0, w, h);
    try {
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch {
      return null;
    }
  }, []);

  /** Stop only the audio-level meter (keeps tracks alive for liveness checks).
   *  Used when entering the interview so the rAF loop stops re-rendering the
   *  page ~60fps — which would otherwise reset timers/snapshot intervals. */
  const stopMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stopMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [stopMeter]);

  // Tear down on unmount.
  useEffect(() => () => stop(), [stop]);

  // Catch a camera/mic physically disconnected mid-session and re-sync liveness.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => syncLiveness();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [syncLiveness]);

  /** The live MediaStream (or null) — lets callers tap the audio track for
   *  post-hoc recording without taking ownership of the stream lifecycle. */
  const getStream = useCallback(() => streamRef.current, []);

  return { videoRef, bindVideo, state, micLevel, error, request, capture, stop, stopMeter, getStream };
}
