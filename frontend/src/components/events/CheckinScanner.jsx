// Task #40 (E2) — Device-camera QR check-in scanner.
//
// Scanning needs a DECODER, which the `qrcode` dependency does not provide (it
// only generates). Rather than pull in a new library, this uses the native
// BarcodeDetector API (Chromium / Android / recent Safari) with a graceful
// manual code-entry fallback for browsers that lack it (or when the camera is
// denied). The decoded code is handed to onDetect(code); the parent calls
// `eventsApi.checkin(eventId, code)`.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Camera, Keyboard, AlertTriangle } from 'lucide-react';
import { useEscapeClose } from '../useEscapeClose';

export default function CheckinScanner({ onDetect, onClose, busy = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastRef = useRef('');
  const detectorRef = useRef(null);

  const [supported] = useState(
    () => typeof window !== 'undefined' && 'BarcodeDetector' in window,
  );
  const [mode, setMode] = useState(() =>
    (typeof window !== 'undefined' && 'BarcodeDetector' in window) ? 'camera' : 'manual',
  );
  const [error, setError] = useState('');
  const [manualCode, setManualCode] = useState('');

  useEscapeClose(onClose);

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleDetected = useCallback((code) => {
    if (!code || busy) return;
    // Debounce repeated reads of the same code within a short window.
    if (code === lastRef.current) return;
    lastRef.current = code;
    onDetect(code);
    setTimeout(() => { lastRef.current = ''; }, 2500);
  }, [busy, onDetect]);

  useEffect(() => {
    if (mode !== 'camera' || !supported) return undefined;
    let cancelled = false;

    (async () => {
      try {
        // eslint-disable-next-line no-undef
        detectorRef.current = new BarcodeDetector({ formats: ['qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const tick = async () => {
          if (cancelled || !videoRef.current || !detectorRef.current) return;
          try {
            const codes = await detectorRef.current.detect(videoRef.current);
            if (codes && codes.length) handleDetected(codes[0].rawValue);
          } catch { /* transient decode error — keep scanning */ }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          setError('Camera unavailable — enter the code manually instead.');
          setMode('manual');
        }
      }
    })();

    return () => { cancelled = true; stopCamera(); };
  }, [mode, supported, handleDetected, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  const submitManual = (e) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (code) { onDetect(code); setManualCode(''); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Check in attendees</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'camera' && supported ? (
            <div className="space-y-3">
              <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
                <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
                <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />
              </div>
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                Point the camera at an attendee's ticket QR code.
              </p>
              <button
                onClick={() => setMode('manual')}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Keyboard size={16} /> Enter code manually
              </button>
            </div>
          ) : (
            <form onSubmit={submitManual} className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Ticket code
              </label>
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Paste or type the code from the ticket"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy || !manualCode.trim()}
                  className="flex-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {busy ? 'Checking in…' : 'Check in'}
                </button>
                {supported && (
                  <button
                    type="button"
                    onClick={() => { setError(''); setMode('camera'); }}
                    className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <Camera size={16} /> Camera
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
