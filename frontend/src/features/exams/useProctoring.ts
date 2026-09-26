import { useEffect, useRef, useState } from 'react';
import { http } from '@/lib/api';
import type { EventType } from './api';
import type { useCamera } from './useCamera';

type FrameResult = { available: boolean; faces?: number; lookingAway?: boolean; activeSignals?: EventType[]; skipped?: boolean };

export type LiveStatus = {
  analysisAvailable: boolean | null; // null until the first frame result
  faces: number | null;
  activeSignals: EventType[];
};

const FRAME_INTERVAL_MS = 2000;
const UNAVAILABLE_BACKOFF_MS = 30_000;

/**
 * Runs during a proctored attempt:
 *  - samples a small JPEG every 2s and posts it for analysis (frames aren't kept);
 *  - reports browser signals: tab hidden, window focus lost, full-screen exit,
 *    copy/paste and camera loss, each as a start/end interval.
 */
export function useProctoring(sessionId: string, enabled: boolean, camera: ReturnType<typeof useCamera>) {
  const [status, setStatus] = useState<LiveStatus>({ analysisAvailable: null, faces: null, activeSignals: [] });
  const { capture, state: cameraState } = camera;

  // ─── Camera frames ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let pausedUntil = 0;
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden || Date.now() < pausedUntil) return;
      const blob = await capture();
      if (!blob) return;
      busy = true;
      try {
        const body = new FormData();
        body.append('frame', blob, 'frame.jpg');
        const r = await http.post<FrameResult>(`/api/exam-sessions/${sessionId}/frames`, body);
        if (r.skipped) return;
        if (!r.available) {
          pausedUntil = Date.now() + UNAVAILABLE_BACKOFF_MS;
          setStatus((s) => ({ ...s, analysisAvailable: false, activeSignals: [] }));
          return;
        }
        setStatus({ analysisAvailable: true, faces: r.faces ?? null, activeSignals: r.activeSignals ?? [] });
      } catch {
        pausedUntil = Date.now() + 5000; // transient network trouble: retry soon
      } finally {
        busy = false;
      }
    };
    const id = setInterval(() => void tick(), FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, sessionId, capture]);

  // ─── Browser signals ──────────────────────────────────────────────────────
  const openIntervals = useRef<Partial<Record<EventType, string>>>({});

  useEffect(() => {
    if (!enabled) return;
    const send = (type: EventType, startedAt: string, endedAt: string | null = new Date().toISOString()) =>
      void http.post(`/api/exam-sessions/${sessionId}/events`, { type, startedAt, endedAt }, { keepalive: true }).catch(() => undefined);
    const begin = (type: EventType) => {
      openIntervals.current[type] ??= new Date().toISOString();
    };
    const end = (type: EventType, minMs = 0) => {
      const started = openIntervals.current[type];
      if (!started) return;
      delete openIntervals.current[type];
      if (Date.now() - new Date(started).getTime() >= minMs) send(type, started);
    };

    let hiddenDuringBlur = false;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenDuringBlur = true;
        begin('TAB_HIDDEN');
      } else end('TAB_HIDDEN');
    };
    const onBlur = () => {
      hiddenDuringBlur = false;
      begin('WINDOW_BLUR');
    };
    // A tab switch fires blur *and* visibilitychange; count it once, as TAB_HIDDEN.
    // Sub-second focus blips (notifications, dev tools) are ignored.
    const onFocus = () => {
      if (hiddenDuringBlur) delete openIntervals.current.WINDOW_BLUR;
      else end('WINDOW_BLUR', 1000);
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement && sessionStorage.getItem(`fs:${sessionId}`) === '1') {
        const now = new Date().toISOString();
        send('FULLSCREEN_EXIT', now, now);
      }
    };
    const onClipboard = () => {
      const now = new Date().toISOString();
      send('COPY_PASTE', now, now);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('copy', onClipboard);
    document.addEventListener('paste', onClipboard);
    document.addEventListener('cut', onClipboard);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('copy', onClipboard);
      document.removeEventListener('paste', onClipboard);
      document.removeEventListener('cut', onClipboard);
      // Flush anything still open (e.g. submitting while the camera is off).
      for (const type of Object.keys(openIntervals.current) as EventType[]) end(type);
    };
  }, [enabled, sessionId]);

  // Camera turned off or unplugged mid-exam.
  useEffect(() => {
    if (!enabled) return;
    const started = openIntervals.current.CAMERA_UNAVAILABLE;
    if (cameraState === 'ended' || cameraState === 'denied' || cameraState === 'unavailable') {
      openIntervals.current.CAMERA_UNAVAILABLE ??= new Date().toISOString();
    } else if (cameraState === 'on' && started) {
      delete openIntervals.current.CAMERA_UNAVAILABLE;
      void http.post(`/api/exam-sessions/${sessionId}/events`, { type: 'CAMERA_UNAVAILABLE', startedAt: started, endedAt: new Date().toISOString() }).catch(() => undefined);
    }
  }, [enabled, cameraState, sessionId]);

  return status;
}
