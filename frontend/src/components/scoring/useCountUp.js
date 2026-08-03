// Composite count-up, ported from the design's componentDidMount
// (Scoring Engine.dc.html L338–347): cubic ease-out over 850ms.
//
// Animating a real number is presentation, not fabrication — the end value is
// always the snapshot's true composite. Honours prefers-reduced-motion, and
// returns 0 for a non-finite target so the DOM never shows NaN.

import { useEffect, useRef, useState } from 'react';

export default function useCountUp(target, ms = 850) {
  const finite = Number.isFinite(Number(target));
  const end = finite ? Math.round(Number(target)) : 0;
  const [value, setValue] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (!finite) {
      setValue(0);
      return undefined;
    }
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (reduced || end === 0) {
      setValue(end);
      return undefined;
    }
    const dur = Math.max(1, ms);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - p) ** 3;
      setValue(Math.round(end * e));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [end, ms, finite]);

  return value;
}
