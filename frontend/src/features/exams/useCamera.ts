import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraState = 'idle' | 'requesting' | 'on' | 'denied' | 'unavailable' | 'ended';

/** Owns the webcam MediaStream. Video only; audio is never requested. */
export function useCamera() {
  const [state, setState] = useState<CameraState>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => undefined);
    }
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return false;
    }
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => setState('ended'));
      if (videoRef.current) attach(videoRef.current);
      setState('on');
      return true;
    } catch (e) {
      setState(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      return false;
    }
  }, [attach]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState('idle');
  }, []);

  useEffect(() => stop, [stop]);

  /** Grabs one downscaled JPEG frame from the live video, or null if not ready. */
  const capture = useCallback(async (width = 320, quality = 0.6): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * width);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
  }, []);

  return { state, start, stop, attach, capture };
}
