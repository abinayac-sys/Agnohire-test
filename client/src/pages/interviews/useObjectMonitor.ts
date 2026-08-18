import { useEffect, useRef } from 'react';

/**
 * Module 4 proctoring — mobile phone / suspicious object detection
 * using TensorFlow.js COCO-SSD.
 *
 * Runs entirely on the candidate's machine. The model + tfjs are dynamically
 * imported so they are code-split into their own chunk. If the model can't
 * load (offline, blocked CDN), monitoring silently disables itself.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ObjectDetectionModel = { detect: (input: HTMLVideoElement) => Promise<any[]> };

interface Options {
  enabled: boolean;
  getVideo: () => HTMLVideoElement | null;
  /** Fired when a mobile phone is detected. */
  onMobilePhone: () => void;
  /** Fired when a suspicious object (e.g., book, notes) is detected. */
  onSuspiciousObject: (objectName: string) => void;
  /** Sampling cadence in ms (default 5s). */
  intervalMs?: number;
}

const VIOLATION_THROTTLE_MS = 15_000;

export function useObjectMonitor({
  enabled,
  getVideo,
  onMobilePhone,
  onSuspiciousObject,
  intervalMs = 5000,
}: Options) {
  const cbRef = useRef({ onMobilePhone, onSuspiciousObject, getVideo });
  cbRef.current = { onMobilePhone, onSuspiciousObject, getVideo };

  const modelRef = useRef<ObjectDetectionModel | null>(null);

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
        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        if (!cancelled) {
          modelRef.current = (await cocoSsd.load({ base: 'lite_mobilenet_v2' })) as unknown as ObjectDetectionModel;
        }
      } catch {
        // Silently disable on error
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const lastFiredAt: Record<string, number> = {};

    const fireThrottled = (key: string, fn: () => void) => {
      const now = Date.now();
      if (lastFiredAt[key] && now - lastFiredAt[key] < VIOLATION_THROTTLE_MS) return;
      lastFiredAt[key] = now;
      fn();
    };

    const tick = async () => {
      if (cancelled) return;
      const video = cbRef.current.getVideo();
      const model = modelRef.current;
      if (model && video && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const predictions = await model.detect(video);
          
          for (const p of predictions) {
            if (p.score < 0.6) continue; // Only confident detections
            
            if (p.class === 'cell phone') {
              fireThrottled('phone', () => cbRef.current.onMobilePhone());
            } else if (p.class === 'book') {
              fireThrottled('book', () => cbRef.current.onSuspiciousObject('book'));
            }
          }
        } catch {
          // Ignore single frame errors
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
