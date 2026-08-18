import { useEffect, useRef } from 'react';

interface Options {
  enabled: boolean;
  getStream: () => MediaStream | null;
  /** Fired when unusual high volume/noise levels are detected continuously. */
  onUnusualNoise: () => void;
  intervalMs?: number;
}

const VIOLATION_THROTTLE_MS = 15_000;
const VOLUME_THRESHOLD = 50; // Threshold out of 255
const SUSTAINED_NOISE_COUNT = 1; // Consecutive samples above threshold

export function useAudioMonitor({
  enabled,
  getStream,
  onUnusualNoise,
  intervalMs = 1000,
}: Options) {
  const cbRef = useRef({ onUnusualNoise, getStream });
  cbRef.current = { onUnusualNoise, getStream };

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let noiseCount = 0;
    let lastFiredAt = 0;

    const fireThrottled = () => {
      const now = Date.now();
      if (now - lastFiredAt < VIOLATION_THROTTLE_MS) return;
      lastFiredAt = now;
      cbRef.current.onUnusualNoise();
    };

    const setupAudio = () => {
      const stream = cbRef.current.getStream();
      if (!stream || stream.getAudioTracks().length === 0) return false;

      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        return true;
      } catch {
        return false;
      }
    };

    const tick = () => {
      if (cancelled) return;
      
      if (!analyser && !setupAudio()) {
        timer = setTimeout(tick, intervalMs);
        return;
      }

      if (analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        if (average > VOLUME_THRESHOLD) {
          noiseCount++;
          if (noiseCount >= SUSTAINED_NOISE_COUNT) {
            noiseCount = 0;
            fireThrottled();
          }
        } else {
          noiseCount = Math.max(0, noiseCount - 1);
        }
      }

      timer = setTimeout(tick, intervalMs);
    };

    timer = setTimeout(tick, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (source) source.disconnect();
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    };
  }, [enabled, intervalMs]);
}
