import { useCallback, useEffect, useRef } from 'react';

/**
 * Module 4 proctoring — multiple-person / absence detection on the candidate's
 * camera using TensorFlow.js BlazeFace.
 *
 * Runs entirely on the candidate's machine. The model + tfjs are dynamically
 * imported so they are code-split into their own chunk and only downloaded once
 * a proctored interview actually starts. If the model can't load (offline,
 * blocked CDN), face monitoring silently disables itself — it must never break
 * the interview.
 *
 * Detection is sampled (not per-frame) to stay cheap, and each violation type is
 * throttled so a sustained condition (two people on screen) raises a warning the
 * candidate can react to rather than instantly burning the whole warning budget.
 */

// Loaded lazily; `any` avoids pulling tfjs types into the main bundle's graph.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlazeModel = { estimateFaces: (input: HTMLVideoElement, returnTensors: boolean) => Promise<any[]> };

interface Options {
  enabled: boolean;
  /** Returns the live proctoring <video> element (or null if not mounted). */
  getVideo: () => HTMLVideoElement | null;
  /** Fired when more than one face is visible. */
  onMultipleFaces: (count: number) => void;
  /** Fired when the candidate's face has been absent for a sustained window. */
  onNoFace: () => void;
  /** Fired when the candidate's face exhibits frequent/large movements or turning away. */
  onFrequentMovement?: () => void;
  /** Sampling cadence in ms (default 2s). */
  intervalMs?: number;
}

const VIOLATION_THROTTLE_MS = 15_000; // don't re-flag the same condition more often
const NO_FACE_READS = 1; // consecutive empty samples before flagging absence
const MOVEMENT_THRESHOLD_PX = 100; // pixels of movement to count as a 'large movement'
const FREQUENT_MOVEMENT_COUNT = 3; // number of large movements within the reset window

export function useFaceMonitor({
  enabled,
  getVideo,
  onMultipleFaces,
  onNoFace,
  onFrequentMovement,
  intervalMs = 2000,
}: Options) {
  // Keep the latest callbacks without re-subscribing the detection loop.
  const cbRef = useRef({ onMultipleFaces, onNoFace, onFrequentMovement, getVideo });
  cbRef.current = { onMultipleFaces, onNoFace, onFrequentMovement, getVideo };

  const modelRef = useRef<BlazeModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
        if (!(await useBackend('webgl')) && !(await useBackend('cpu'))) return;
        const blazeface = await import('@tensorflow-models/blazeface');
        if (!cancelled) {
          modelRef.current = (await blazeface.load()) as unknown as BlazeModel;
        }
      } catch {
        return;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let noFaceStreak = 0;
    const lastFiredAt: Record<'multi' | 'none' | 'movement', number> = { multi: 0, none: 0, movement: 0 };
    
    let lastFaceCenter: { x: number; y: number } | null = null;
    let largeMovements = 0;

    const fireThrottled = (key: 'multi' | 'none' | 'movement', fn: () => void) => {
      const now = Date.now();
      if (now - lastFiredAt[key] < VIOLATION_THROTTLE_MS) return;
      lastFiredAt[key] = now;
      fn();
    };

    const tick = async () => {
      if (cancelled) return;
      const video = cbRef.current.getVideo();
      const model = modelRef.current;
      if (model && video && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const faces = await model.estimateFaces(video, false);
          const count = Array.isArray(faces) ? faces.length : 0;
          if (count > 1) {
            noFaceStreak = 0;
            fireThrottled('multi', () => cbRef.current.onMultipleFaces(count));
          } else if (count === 0) {
            noFaceStreak += 1;
            if (noFaceStreak >= NO_FACE_READS) {
              noFaceStreak = 0;
              fireThrottled('none', () => cbRef.current.onNoFace());
            }
          } else {
            noFaceStreak = 0;
            // Check frequent movement for a single face
            const face = faces[0];
            if (face.topLeft && face.bottomRight) {
              const cx = (face.topLeft[0] + face.bottomRight[0]) / 2;
              const cy = (face.topLeft[1] + face.bottomRight[1]) / 2;
              if (lastFaceCenter) {
                const dx = cx - lastFaceCenter.x;
                const dy = cy - lastFaceCenter.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > MOVEMENT_THRESHOLD_PX) {
                  largeMovements++;
                  if (largeMovements >= FREQUENT_MOVEMENT_COUNT) {
                    largeMovements = 0; // reset
                    if (cbRef.current.onFrequentMovement) {
                      fireThrottled('movement', () => cbRef.current.onFrequentMovement!());
                    }
                  }
                } else {
                  // Decay the movement count slowly if stable
                  largeMovements = Math.max(0, largeMovements - 0.5);
                }
              }
              lastFaceCenter = { x: cx, y: cy };
            }
          }
        } catch {
          /* a single bad frame — ignore and keep sampling */
        }
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}

/** Stable accessor helper for callers that hold the proctor video ref. */
export function useVideoAccessor(ref: React.RefObject<HTMLVideoElement | null>) {
  return useCallback(() => ref.current, [ref]);
}

