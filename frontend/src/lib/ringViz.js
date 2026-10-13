/**
 * D660 (#1473) — the Recording View's three-band ring, as a pure engine.
 *
 * Ported from `design/canvases/integrated/ring-viz.js` (a custom element) so a
 * React component can own the canvas and the AnalyserNode. Three bands of the
 * analyser's spectrum (fftSize 2048) drive three rings: low 20–250 Hz outside
 * and clockwise, mid 250–2000 Hz, high 2000–8000 Hz inside and counter-clockwise.
 *
 * TWO RULES FROM THE CANVAS, kept as code a test can read:
 *   - Reduced motion draws ONE static frame and never asks for another.
 *   - Paused does not advance time: the rings hold still and dim.
 */

export const FFT_SIZE = 2048;

export const BANDS = [
  { lo: 20, hi: 250, r: 150, w: 36, n: 20, speed: 0.08, lobes: 7, dir: 1, cols: ['#2e1065', '#5b21b6'], dark: ['#3b0764', '#5b21b6'], a: 0.85 },
  { lo: 250, hi: 2000, r: 112, w: 26, n: 20, speed: 0.14, lobes: 9, dir: 1, cols: ['#6d28d9', '#8b5cf6'], dark: ['#6d28d9', '#a855f7'], a: 0.75 },
  { lo: 2000, hi: 8000, r: 80, w: 16, n: 20, speed: 0.22, lobes: 11, dir: -1, cols: ['#a78bfa', '#c4b5fd'], dark: ['#c084fc', '#ede9fe'], a: 0.9 },
];

/** Each band's mean level, 0..1, from `getByteFrequencyData` output. */
export function bandLevels(freq, sampleRate) {
  const nyq = sampleRate / 2;
  const N = freq.length;
  return BANDS.map((b) => {
    const i0 = Math.floor((b.lo / nyq) * N);
    const i1 = Math.min(N - 1, Math.ceil((b.hi / nyq) * N));
    let s = 0;
    for (let i = i0; i <= i1; i += 1) s += freq[i];
    return Math.min(1, s / (i1 - i0 + 1) / 160);
  });
}

/** Does this state move? Reduced motion and pause never do. */
export function animates({ reduced, paused }) {
  return !reduced && !paused;
}

/** Draw one frame. `progress` (0..1) draws the stopping arc instead of rings. */
/** How long a marked moment lights the ring (D685 §5.7.4, RV5). */
export const FLASH_MS = 450;

/** The flash's strength at `elapsed` ms after the mark: 1 → 0, nothing under reduced motion. */
export function flashLevel(elapsed, reduced) {
  if (reduced || elapsed == null || elapsed < 0 || elapsed >= FLASH_MS) return 0;
  return 1 - elapsed / FLASH_MS;
}

export function drawRing(ctx, { W, H, energy, t, mode, dark, reduced, progress, flash = 0 }) {
  const cx = W / 2, cy = H / 2, scale = Math.min(W, H) / 400;
  ctx.clearRect(0, 0, W, H);
  if (mode === 'stopping') {
    ctx.beginPath(); ctx.arc(cx, cy, 90 * scale, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? '#4c1d95' : '#ddd6fe'; ctx.lineWidth = 6; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 90 * scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, progress || 0)));
    ctx.strokeStyle = dark ? '#ede9fe' : '#2e1065'; ctx.lineCap = 'round'; ctx.stroke();
    return;
  }
  const dim = mode === 'paused' ? 0.35 : mode === 'denied' ? 0.3 : 1;
  const bands = mode === 'denied' ? [BANDS[1]] : BANDS;
  bands.forEach((b, bi) => {
    const e = mode === 'denied' ? 0 : energy[bi] || 0;
    const base = b.r * scale, amp = (6 + 34 * e) * scale;
    const rot = reduced ? 0 : t * b.speed * b.dir;
    const cols = dark ? b.dark : b.cols;
    ctx.save();
    ctx.globalAlpha = b.a * dim;
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = cols[1];
    for (let s = 0; s < b.n; s += 1) {
      const off = (s / (b.n - 1) - 0.5) * b.w * scale, ph = (s / b.n) * 0.9;
      ctx.beginPath();
      for (let k = 0; k <= 180; k += 1) {
        const a = (k / 180) * Math.PI * 2;
        const wave = 0.5 + 0.5 * Math.sin(a * b.lobes + rot + ph);
        const r = base + off + amp * wave;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  });
  if (flash > 0) {
    ctx.save();
    ctx.globalAlpha = 0.55 * flash;
    ctx.beginPath(); ctx.arc(cx, cy, 150 * scale, 0, Math.PI * 2);
    ctx.lineWidth = 10 * scale; ctx.strokeStyle = dark ? '#c4b5fd' : '#7c3aed'; ctx.stroke();
    ctx.restore();
  }
}

/**
 * Run the ring on a canvas context. Returns a stop function.
 * `raf`/`caf`/`now` are injected so a test can count the frames asked for.
 */
export function runRing({ ctx, size, analyser, sampleRate, mode, dark, reduced, progress, raf, caf, now, flashAt = null }) {
  const energy = [0, 0, 0];
  const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  let t = 0, last = now(), id = null, alive = true;
  const paused = mode === 'paused' || mode === 'stopping';
  const frame = () => {
    if (!alive) return;
    const n = now(), dt = Math.min(0.05, (n - last) / 1000); last = n;
    if (animates({ reduced, paused })) t += dt;
    if (analyser && freq && mode !== 'denied') {
      analyser.getByteFrequencyData(freq);
      const s = bandLevels(freq, sampleRate);
      for (let i = 0; i < 3; i += 1) energy[i] += (s[i] - energy[i]) * Math.min(1, s[i] > energy[i] ? dt / 0.08 : dt / 0.4);
    }
    const flash = flashAt == null ? 0 : flashLevel(n - flashAt, reduced);
    drawRing(ctx, { W: size.w, H: size.h, energy, t, mode, dark, reduced, progress, flash });
    // Reduced motion and pause are one still frame; nothing is scheduled after
    // it, except to finish a flash that is still fading.
    if (animates({ reduced, paused }) || flash > 0) id = raf(frame);
  };
  frame();
  return () => { alive = false; if (id != null) caf(id); };
}
