import { useEffect, useRef, useState } from 'react';

/** A QR code of `text`, drawn as one SVG path (dark modules on white, with the quiet zone it needs). */
export function QrCode({ text, size = 220, label }: { text: string; size?: number; label: string }) {
  const [path, setPath] = useState<{ d: string; n: number } | null>(null);
  useEffect(() => {
    let live = true;
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      if (live) setPath({ d, n: n + 8 });
    });
    return () => {
      live = false;
    };
  }, [text]);
  return (
    <svg
      className="gc-qr"
      width={size}
      height={size}
      viewBox={`0 0 ${path?.n ?? 33} ${path?.n ?? 33}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="#fff" />
      {path && <path d={path.d} fill="#111" />}
    </svg>
  );
}

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };

/**
 * The camera, looking for a QR code. Uses the browser's own barcode reader where there is one
 * (Chrome on Android), and jsQR elsewhere (Safari, Firefox).
 */
export function QrScanner({ onCode, onError }: { onCode: (text: string) => boolean; onError: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'NotSupportedError' });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
      } catch (err) {
        const name = (err as Error).name;
        onError(
          name === 'NotAllowedError'
            ? 'The camera is blocked for this site. Allow it in the browser’s settings, or paste the link instead.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No camera was found. Paste the link instead.'
              : 'The camera could not be opened. Paste the link instead.',
        );
        return;
      }
      const Native = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const native = Native ? new Native({ formats: ['qr_code'] }) : null;
      const jsQR = native ? null : (await import('jsqr')).default;
      const look = async () => {
        if (stopped) return;
        const el = video.current;
        if (el && el.readyState >= 2 && el.videoWidth) {
          let found: string | undefined;
          if (native) found = (await native.detect(el).catch(() => []))[0]?.rawValue;
          else if (jsQR && ctx) {
            const scale = Math.min(1, 720 / Math.max(el.videoWidth, el.videoHeight));
            canvas.width = Math.round(el.videoWidth * scale);
            canvas.height = Math.round(el.videoHeight * scale);
            ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data;
          }
          if (found && onCodeRef.current(found)) return;
        }
        timer = setTimeout(() => void look(), 180);
      };
      void look();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onError]);
  return (
    <div className="gc-scanner">
      <video ref={video} playsInline muted aria-label="Camera" />
      <span className="gc-scanner-frame" aria-hidden="true" />
    </div>
  );
}
