import { useEffect, useRef } from 'react';
import { runRing } from '../../lib/ringViz';

/** Is reduced motion asked for? A `motion="reduced"` prop forces it. */
export function prefersReducedMotion(motion) {
  if (motion === 'reduced') return true;
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * The Recording View's ring (D660). Reads an `AnalyserNode`; with none (the
 * microphone is not yet open, or was denied) it draws the resting rings.
 */
export default function RingViz({ analyser = null, mode = 'speech', theme = 'light', motion, progress = 0, label, flash = null }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof canvas.getContext !== 'function') return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 320;
    canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return runRing({
      ctx, size: { w, h }, analyser, sampleRate: analyser?.context?.sampleRate || 48000,
      mode, dark: theme === 'dark', reduced: prefersReducedMotion(motion), progress,
      raf: (f) => requestAnimationFrame(f), caf: (id) => cancelAnimationFrame(id), now: () => performance.now(),
      // A new `flash` (a mark's time) lights the ring once, from now.
      flashAt: flash == null ? null : performance.now(),
    });
  }, [analyser, mode, theme, motion, progress, flash]);
  return <canvas ref={ref} data-testid="ring-viz" data-mode={mode} role="img" aria-label={label || 'Microphone level'} className="block h-full w-full" />;
}
