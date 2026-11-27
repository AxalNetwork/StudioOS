// Task #40 (E2) — Ticket QR renderer. Reuses the existing `qrcode` dependency
// (the same generator used by ReferEarn / Register / VerifyEmail) to paint the
// per-registration check-in code onto a canvas. The code is whatever the E1
// backend returns on the attending ticket (event_checkins.code).
import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export default function EventQRCode({ value, size = 148, className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    QRCode.toCanvas(ref.current, String(value), { width: size, margin: 2 }, () => {
      /* best-effort — a render error just leaves a blank canvas */
    });
  }, [value, size]);

  if (!value) return null;
  return (
    <canvas
      ref={ref}
      className={`rounded-lg bg-white p-1 ${className}`}
      aria-label="Ticket check-in QR code"
    />
  );
}
