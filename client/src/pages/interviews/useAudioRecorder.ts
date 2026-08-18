import { useCallback, useRef } from 'react';

/**
 * Records the candidate's microphone audio for the duration of the interview so
 * it can be analyzed server-side for additional speakers (post-hoc proctoring).
 *
 * Audio-only and low-bitrate (Opus ~16 kbps) so a full interview stays well
 * under the API's 5 MB JSON body cap. Everything is best-effort: if the browser
 * lacks MediaRecorder, the stream has no audio track, or the blob is oversized,
 * we silently skip — recording must never affect the interview itself.
 */

const MAX_UPLOAD_BYTES = 3_300_000; // mirrors the server ceiling

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? null;
}

export function useAudioRecorder(getStream: () => MediaStream | null) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('audio/webm');

  const start = useCallback(() => {
    if (recorderRef.current) return; // already recording
    const stream = getStream();
    const audioTracks = stream?.getAudioTracks() ?? [];
    if (!stream || audioTracks.length === 0) return;
    const mimeType = pickMimeType();
    if (!mimeType) return;

    try {
      // Record only the audio track — never the camera.
      const audioOnly = new MediaStream(audioTracks);
      const recorder = new MediaRecorder(audioOnly, { mimeType, audioBitsPerSecond: 16000 });
      chunksRef.current = [];
      mimeRef.current = mimeType;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(5000); // flush a chunk every 5s so a crash still leaves data
      recorderRef.current = recorder;
    } catch {
      /* unsupported config — skip recording */
    }
  }, [getStream]);

  /** Stop recording and resolve a data URL (or null if nothing usable). */
  const stop = useCallback((): Promise<string | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve(null);
    recorderRef.current = null;

    return new Promise((resolve) => {
      const finish = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        chunksRef.current = [];
        if (blob.size === 0 || blob.size > MAX_UPLOAD_BYTES) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      };
      recorder.onstop = finish;
      try {
        recorder.stop();
      } catch {
        finish();
      }
    });
  }, []);

  return { start, stop };
}
