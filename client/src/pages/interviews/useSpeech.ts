import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser speech for the candidate interview:
 *  - `speak` reads a question aloud (Web Speech synthesis).
 *  - `startListening` transcribes the candidate's spoken answer in real time
 *    (Web Speech recognition — Chrome/Edge; callers fall back to typing when
 *    `recognitionSupported` is false).
 */

// Minimal typings — lib.dom omits the (still prefixed) SpeechRecognition API.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechResult {
  ttsSupported: boolean;
  recognitionSupported: boolean;
  speaking: boolean;
  listening: boolean;
  /** Live transcript of the current listening session (final + interim). */
  transcript: string;
  /** Read text aloud; resolves when speech ends (or immediately if unsupported). */
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  /** Begin transcribing; `baseText` is kept and new speech appends after it. */
  startListening: (baseText?: string) => void;
  /** Stop transcribing and return the final accumulated transcript. */
  stopListening: () => string;
}

export function useSpeech(): UseSpeechResult {
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const recognitionSupported = getRecognitionCtor() !== null;

  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  // base = text present before this listening session; finals accumulate after it.
  const baseRef = useRef('');
  const finalsRef = useRef('');
  const latestRef = useRef('');
  const lastInterimRef = useRef('');

  const stopSpeaking = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [ttsSupported]);

  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (!ttsSupported || !text.trim()) {
          resolve();
          return;
        }
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.95;
        utter.onend = () => {
          setSpeaking(false);
          resolve();
        };
        utter.onerror = () => {
          setSpeaking(false);
          resolve();
        };
        setSpeaking(true);
        window.speechSynthesis.speak(utter);
      }),
    [ttsSupported],
  );

  const composeTranscript = useCallback((interim: string) => {
    const joined = [baseRef.current.trim(), finalsRef.current.trim(), interim.trim()]
      .filter(Boolean)
      .join(' ');
    latestRef.current = joined;
    setTranscript(joined);
    return joined;
  }, []);

  const startListening = useCallback(
    (baseText = '') => {
      const Ctor = getRecognitionCtor();
      if (!Ctor || listeningRef.current) return;
      baseRef.current = baseText;
      finalsRef.current = '';
      lastInterimRef.current = '';
      composeTranscript('');

      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalsRef.current += (finalsRef.current ? ' ' : '') + r[0].transcript.trim();
          else interim += r[0].transcript;
        }
        lastInterimRef.current = interim.trim();
        composeTranscript(interim);
      };
      // Chrome ends recognition after silence — restart while still listening.
      rec.onend = () => {
        if (lastInterimRef.current) {
          finalsRef.current += (finalsRef.current ? ' ' : '') + lastInterimRef.current;
          lastInterimRef.current = '';
          composeTranscript('');
        }
        if (listeningRef.current) {
          try {
            rec.start();
          } catch {
            listeningRef.current = false;
            setListening(false);
          }
        }
      };
      rec.onerror = (e) => {
        // "no-speech"/"aborted" are routine; "not-allowed" means mic denied.
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          listeningRef.current = false;
          setListening(false);
        }
      };
      recRef.current = rec;
      listeningRef.current = true;
      setListening(true);
      try {
        rec.start();
      } catch {
        listeningRef.current = false;
        setListening(false);
      }
    },
    [composeTranscript],
  );

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
    return latestRef.current;
  }, []);

  // Clean up on unmount.
  useEffect(
    () => () => {
      listeningRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
      if (ttsSupported) window.speechSynthesis.cancel();
    },
    [ttsSupported],
  );

  return {
    ttsSupported,
    recognitionSupported,
    speaking,
    listening,
    transcript,
    speak,
    stopSpeaking,
    startListening,
    stopListening,
  };
}
