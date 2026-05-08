'use client';

import { useRef, useState, useCallback } from 'react';

/**
 * usePipelineVoice - STT/TTS-Pipeline-Voice-Modus
 *
 * Im Gegensatz zum Realtime-Hook:
 * - Push-to-Talk: User hält den Button, gibt los um zu senden
 * - Sequenziell: Audio aufnehmen → Server-Pipeline → Antwort-Audio abspielen
 * - Eine Anfrage pro Tap, keine kontinuierliche Konversation
 *
 * Auf iOS Safari nutzen wir MediaRecorder (seit iOS 14.5 supported).
 * Bei älteren Browsern könnte das fehlschlagen - wir prüfen Support beim Start.
 */

export type PipelineState =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'playing'
  | 'error';

export interface PipelineTurn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

interface UsePipelineOptions {
  voiceId: string | null;
  onTurn: (turn: PipelineTurn) => void;
  onError: (msg: string) => void;
}

export function usePipelineVoice(opts: UsePipelineOptions) {
  const [state, setState] = useState<PipelineState>('idle');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const turnIdRef = useRef(0);

  const isSupported = typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined';

  /**
   * Audio-Element gemeinsam für alle Antworten - wir recyceln und hängen
   * es ans DOM, sonst pausiert iOS es manchmal früh.
   */
  const ensureAudioEl = useCallback((): HTMLAudioElement => {
    if (audioElRef.current) return audioElRef.current;
    const el = document.createElement('audio');
    el.setAttribute('playsinline', 'true');
    el.setAttribute('webkit-playsinline', 'true');
    el.style.display = 'none';
    document.body.appendChild(el);
    audioElRef.current = el;
    return el;
  }, []);

  const stopMicrophone = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  /**
   * Aufnahme starten. Mikrofon-Permission wird beim ersten Aufruf abgefragt.
   */
  const startRecording = useCallback(async () => {
    if (!isSupported) {
      opts.onError('MediaRecorder nicht unterstützt');
      return;
    }
    if (state === 'recording') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // mimeType: webm/opus ist Standard, aber iOS Safari nutzt audio/mp4
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || 'audio/webm',
        });
        stopMicrophone();
        await processAudio(blob);
      };

      recorder.start();
      recorderRef.current = recorder;
      setState('recording');
    } catch (err: any) {
      console.error('[pipeline] mic failed:', err);
      opts.onError(
        err?.name === 'NotAllowedError'
          ? 'Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.'
          : 'Mikrofon konnte nicht gestartet werden.'
      );
      setState('error');
    }
  }, [isSupported, state, opts, stopMicrophone]);

  /**
   * Aufnahme stoppen → triggert recorder.onstop → schickt Audio an Server.
   */
  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
      // State wechselt erst nach Server-Antwort, hier nur "processing" anzeigen
      setState('processing');
    }
  }, []);

  /**
   * Audio an Server-Pipeline senden, Antwort abspielen.
   */
  const processAudio = useCallback(async (blob: Blob) => {
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');
      if (opts.voiceId) form.append('voiceId', opts.voiceId);

      const res = await fetch('/api/pipeline', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Pipeline-Fehler (${res.status})`);
      }

      // Transkripte aus Headers lesen (base64-encoded UTF-8)
      const transcriptB64 = res.headers.get('X-Transcript');
      const replyB64 = res.headers.get('X-Reply');
      const transcript = transcriptB64
        ? decodeURIComponent(escape(atob(transcriptB64)))
        : '';
      const reply = replyB64
        ? decodeURIComponent(escape(atob(replyB64)))
        : '';

      // Turns ans UI weiterreichen
      if (transcript) {
        opts.onTurn({
          id: ++turnIdRef.current,
          role: 'user',
          text: transcript,
          timestamp: Date.now(),
        });
      }
      if (reply) {
        opts.onTurn({
          id: ++turnIdRef.current,
          role: 'assistant',
          text: reply,
          timestamp: Date.now(),
        });
      }

      // Audio abspielen
      const audioBuf = await res.arrayBuffer();
      const audioBlob = new Blob([audioBuf], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(audioBlob);

      const audio = ensureAudioEl();
      audio.src = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setState('idle');
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setState('idle');
      };
      setState('playing');
      await audio.play().catch(err => {
        console.warn('[pipeline] audio play failed:', err);
        URL.revokeObjectURL(url);
        setState('idle');
      });
    } catch (err: any) {
      console.error('[pipeline] processing failed:', err);
      opts.onError(err?.message || 'Verarbeitung fehlgeschlagen');
      setState('error');
    }
  }, [opts, ensureAudioEl]);

  /**
   * Komplettes Cleanup: Mikrofon stoppen, Audio stoppen, States räumen.
   */
  const cleanup = useCallback(() => {
    stopMicrophone();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = '';
    }
    setState('idle');
  }, [stopMicrophone]);

  return {
    state,
    isSupported,
    startRecording,
    stopRecording,
    cleanup,
  };
}
