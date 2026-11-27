import { useEffect, useRef } from 'react';
import { runRing } from '../../lib/ringViz';

/** Is reduced motion asked for? A `motion="reduced"` prop forces it. */
export function prefersReducedMotion(motion) {
  if (motion === 'reduced') return true;
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Size the canvas bitmap to the element at a device pixel ratio capped at 2, so the circle is never stretched. */
export function fitCanvas(canvas, ctx, size) {
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const w = canvas.clientWidth || 320, h = canvas.clientHeight || 320;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  size.w = w; size.h = h;
  return size;
}

/**
 * The Recording View's ring (D660, D1330). Reads an `AnalyserNode`; with none
 * (the microphone is not yet open, or was denied) it draws the resting rings:
 * perfect circles. It stops drawing while the tab is hidden, and follows the
 * element's size (ResizeObserver).
 */
export default function RingViz({ analyser = null, mode = 'speech', theme = 'light', motion, progress = null, label, flash = null }) {
  const ref = useRef(null);
  // The rings' state outlives a restart (a new mode or a mark), so a pause eases back to circles.
  const memory = useRef({});
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof canvas.getContext !== 'function') return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const size = fitCanvas(canvas, ctx, {});
    const doc = typeof document !== 'undefined' ? document : null;
    const stop = runRing({
      ctx, size, analyser, sampleRate: analyser?.context?.sampleRate || 48000,
      mode, dark: theme === 'dark', reduced: prefersReducedMotion(motion), progress,
      raf: (f) => requestAnimationFrame(f), caf: (id) => cancelAnimationFrame(id), now: () => performance.now(),
      // A new `flash` (a mark's time) lights the ring once, from now.
      flashAt: flash == null ? null : performance.now(),
      cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
      hidden: () => !!doc?.hidden,
      watchVisibility: doc && typeof doc.addEventListener === 'function'
        ? (cb) => { doc.addEventListener('visibilitychange', cb); return () => doc.removeEventListener('visibilitychange', cb); }
        : null,
      memory: memory.current,
    });
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => { fitCanvas(canvas, ctx, size); stop.redraw(); });
      ro.observe(canvas);
    }
    return () => { if (ro) ro.disconnect(); stop(); };
  }, [analyser, mode, theme, motion, progress, flash]);
  return <canvas ref={ref} data-testid="ring-viz" data-mode={mode} data-theme={theme} role="img" aria-label={label || 'Microphone level'} className="block h-full w-full" />;
}
