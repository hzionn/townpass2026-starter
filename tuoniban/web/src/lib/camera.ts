/**
 * In-browser QR scanning for when we are not inside TownPass: getUserMedia plus jsQR.
 * Tracks are always stopped on success, cancel and unmount, so the camera light goes off.
 */
const FRAME_INTERVAL_MS = 200; // About 5 frames per second is plenty, and kind to old phones.
const MAX_FRAME_SIDE = 720;

export interface CameraScan {
  /** Resolves when the camera is showing. Rejects if it is denied or unavailable. */
  ready: Promise<void>;
  stop(): void;
}

export function startCameraScan(video: HTMLVideoElement, onCode: (text: string) => void): CameraScan {
  let stopped = false;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop(): void {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  }

  async function begin(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable');
    const [acquired, { default: jsQR }] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }),
      import('jsqr'),
    ]);
    stream = acquired;
    // The user may have pressed cancel while the permission prompt was open.
    if (stopped) {
      stop();
      return;
    }
    video.srcObject = acquired;
    await video.play();

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');

    const scanFrame = () => {
      if (stopped) return;
      if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          stop();
          onCode(code.data);
          return;
        }
      }
      timer = setTimeout(scanFrame, FRAME_INTERVAL_MS);
    };
    scanFrame();
  }

  const ready = begin().catch((error: unknown) => {
    stop();
    throw error;
  });
  return { ready, stop };
}
