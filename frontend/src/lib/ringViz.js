/**
 * D660 (#1473), D1330 — the Recording View's three-band ring, as a pure engine.
 *
 * Ported from the design project's `ring-viz.js` (the Recording View Canvas,
 * RV1–RV13; `design/incoming/ring-viz.js`) so a React component can own the
 * canvas and the AnalyserNode. Three bands of the analyser's spectrum
 * (fftSize 2048) drive three rings: low 20–250 Hz outside and clockwise, mid
 * 250–2000 Hz clockwise, high 2000–8000 Hz inside and anticlockwise.
 *
 * THE RULES FROM THE CANVAS, kept as code a test can read:
 *   - No sound is a perfect circle. Each band has a soft noise gate
 *     (`gateOf`); at gate 0 its ring has no ripple, no swell and no breathing.
 *   - With sound a ring stays a circle: an even ripple of at most 10px
 *     (never petals), a swell of at most 6px and ±2px of slow breathing, all
 *     multiplied by the gate, and only for the band that hears it.
 *   - While there is sound, thin circular waves leave the outer ring.
 *   - Paused freezes time and the rings ease back to circles at 35%.
 *   - Reduced motion: no rotation, no breathing, no waves; the ripple and the
 *     swell still follow sound.
 */

export const FFT_SIZE = 2048;

export const BANDS = [
  { lo: 20, hi: 250, r: 150, w: 36, n: 32, speed: 0.08, lobes: 12, dir: 1, cols: ['#2e1065', '#5b21b6'], dark: ['#3b0764', '#5b21b6'], a: 0.85 },
  { lo: 250, hi: 2000, r: 112, w: 26, n: 32, speed: 0.14, lobes: 16, dir: 1, cols: ['#6d28d9', '#8b5cf6'], dark: ['#6d28d9', '#a855f7'], a: 0.75 },
  { lo: 2000, hi: 8000, r: 80, w: 16, n: 32, speed: 0.22, lobes: 22, dir: -1, cols: ['#a78bfa', '#c4b5fd'], dark: ['#c084fc', '#ede9fe'], a: 0.9 },
];

/** Smoothing: rises over 80ms, falls over 400ms. */
export const ATTACK_S = 0.08;
export const RELEASE_S = 0.4;
/** The noise gate: closed at or below 0.04, fully open at 0.12. */
export const GATE_FLOOR = 0.04;
export const GATE_SPAN = 0.08;
/** The most a ring moves, in px at the 400px reference size. */
export const RIPPLE_PX = 10;
export const SWELL_PX = 6;
export const BREATHE_PX = 2;
export const BREATHE_RATE = 0.6;
/** A second wave at lobes + 2, mixed in at 30%. */
export const SECOND_WAVE = 0.3;
/** The outer ring at its fullest stays this far inside the edge. */
export const EDGE_MARGIN = 14;
/** The spreading waves. */
export const WAVE = { threshold: 0.12, everyMs: 450, lifeMs: 1400, gap: 14, edge: 4, alpha: 0.45, line: 1.2, light: '#7c3aed', dark: '#c4b5fd' };
/** Devices with this many cores or fewer draw this share of the strands. */
export const LOW_POWER_CORES = 4;
export const LOW_POWER_SHARE = 0.6;
/** How far the outer ring can reach from the centre, before scaling. */
export const OUTER_REACH = BANDS[0].r + BANDS[0].w / 2 + SWELL_PX + RIPPLE_PX + BREATHE_PX;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

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

/** The soft noise gate: 0 (a still circle) to 1 (the band moves fully). */
export function gateOf(e) {
  return clamp01((e - GATE_FLOOR) / GATE_SPAN);
}

/** One smoothing step: attack while rising, release while falling. */
export function smooth(energy, sample, dt) {
  return energy.map((e, i) => {
    const s = sample[i] || 0;
    return e + (s - e) * Math.min(1, dt / (s > e ? ATTACK_S : RELEASE_S));
  });
}

/** Modes whose input counts as no sound: their rings are perfect circles. */
const QUIET = new Set(['silence', 'paused', 'denied', 'nosound', 'stopping']);
export const isQuiet = (mode) => QUIET.has(mode);

/** Does time move? Paused freezes it; reduced motion never turns or breathes. */
export function animates({ reduced, paused }) {
  return !reduced && !paused;
}

/**
 * The square's geometry. `scale` maps the 400px reference onto the element so
 * the outer ring at its fullest stays EDGE_MARGIN inside the edge; the waves
 * run from 14px outside the outer ring to 4px inside the edge.
 */
export function geometry(W, H) {
  const half = Math.min(W, H) / 2;
  const scale = Math.max(0, half - EDGE_MARGIN) / OUTER_REACH;
  return {
    cx: W / 2, cy: H / 2, scale,
    r0: (BANDS[0].r + BANDS[0].w / 2 + WAVE.gap) * scale,
    rMax: half - WAVE.edge,
  };
}

/** One band's motion now, before scaling: its gate, ripple, swell, breathing and turn. */
export function bandShape(bi, { energy, t, reduced }) {
  const e = clamp01(energy[bi] || 0);
  const gate = gateOf(e);
  return {
    gate,
    amp: RIPPLE_PX * e * gate,
    swell: SWELL_PX * e * gate,
    breathe: reduced || gate === 0 ? 0 : Math.sin(t * BREATHE_RATE + bi) * BREATHE_PX * gate,
    rot: reduced ? 0 : t * BANDS[bi].speed * BANDS[bi].dir,
  };
}

/**
 * A strand's radius at angle `a`, before scaling. The ripple is an even wave
 * all the way round (lobes, plus lobes + 2 at 30%), never petals, so the
 * outline stays a circle; at gate 0 every term but the base is 0.
 */
export function ringRadius(bi, a, shape, { off = 0, ph = 0 } = {}) {
  const b = BANDS[bi];
  const wave = 0.5 + 0.5 * Math.sin(a * b.lobes + shape.rot + ph);
  const wave2 = 0.5 + 0.5 * Math.sin(a * (b.lobes + 2) - shape.rot * 0.7 + ph * 1.3);
  return b.r + shape.swell + shape.breathe + off + shape.amp * (wave * (1 - SECOND_WAVE) + wave2 * SECOND_WAVE);
}

/** How many strands a band draws: 60% of them on a device with 4 cores or fewer. */
export function strandCount(b, cores) {
  return Number(cores) > 0 && Number(cores) <= LOW_POWER_CORES ? Math.round(b.n * LOW_POWER_SHARE) : b.n;
}

/** Is a wave due? Only with sound, never paused, stopping or under reduced motion; at most every 450ms. */
export function shouldEmit({ loud, now, lastEcho, mode, reduced }) {
  return !reduced && !isQuiet(mode) && loud > WAVE.threshold && (lastEcho == null || now - lastEcho >= WAVE.everyMs);
}

/** A wave `p` (0..1) of the way through its life: its radius and its opacity. */
export function waveAt(p, k, g) {
  return { r: g.r0 + (g.rMax - g.r0) * p, alpha: (1 - p) * WAVE.alpha * k };
}

export function initialState() {
  return { energy: [0, 0, 0], t: 0, echo: [], lastEcho: null };
}

/**
 * One tick. `sample` is the raw band levels (or null with no analyser); a
 * quiet mode reads as silence. A wave is emitted on the raw level, so the
 * last one leaves within one frame of silence and fades within 1.4s.
 */
export function step(state, { sample, dt, now, mode, reduced }) {
  const heard = !isQuiet(mode) && sample ? sample : [0, 0, 0];
  const energy = smooth(state.energy, heard, dt);
  const t = mode === 'paused' || reduced ? state.t : state.t + dt;
  const loud = Math.max(heard[0], heard[1], heard[2]);
  let { echo, lastEcho } = state;
  if (shouldEmit({ loud, now, lastEcho, mode, reduced })) { echo = [...echo, { t0: now, k: Math.min(1, loud) }]; lastEcho = now; }
  echo = echo.filter((w) => now - w.t0 < WAVE.lifeMs);
  return { energy, t, echo, lastEcho };
}

/** Is any ring still off its circle (more than 0.05px)? */
export function moving(state) {
  return state.energy.some((e) => RIPPLE_PX * e * gateOf(e) > 0.05 || SWELL_PX * e * gateOf(e) > 0.05);
}

/** How long a marked moment lights the ring (D685 §5.7.4, RV5). */
export const FLASH_MS = 450;

/** The flash's strength at `elapsed` ms after the mark: 1 → 0, nothing under reduced motion. */
export function flashLevel(elapsed, reduced) {
  if (reduced || elapsed == null || elapsed < 0 || elapsed >= FLASH_MS) return 0;
  return 1 - elapsed / FLASH_MS;
}

/** The share of the circle the indeterminate arc covers (D685 §5.9.2). */
export const INDETERMINATE_SWEEP = 0.25;

/**
 * Where the stopping arc starts and how far it goes. A count (0..1) is drawn
 * from the top; null is no count, so a quarter arc turns with `t` instead of
 * claiming a percentage, and holds still under reduced motion.
 */
export function stoppingArc(progress, t, reduced) {
  const top = -Math.PI / 2;
  if (progress == null || !Number.isFinite(Number(progress))) {
    const start = top + (reduced ? 0 : t * Math.PI * 1.5);
    return { start, end: start + Math.PI * 2 * INDETERMINATE_SWEEP, indeterminate: true };
  }
  return { start: top, end: top + Math.PI * 2 * Math.max(0, Math.min(1, Number(progress))), indeterminate: false };
}

function strokeRing(ctx, g, bi, shape, off, ph, steps) {
  ctx.beginPath();
  for (let k = 0; k <= steps; k += 1) {
    const a = (k / steps) * Math.PI * 2;
    const r = ringRadius(bi, a, shape, { off, ph }) * g.scale;
    const x = g.cx + Math.cos(a) * r, y = g.cy + Math.sin(a) * r;
    if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.stroke();
}

/** Draw one frame. In `stopping`, the processing arc (`stoppingArc`) replaces the rings. */
export function drawRing(ctx, { W, H, energy, t, mode, dark, reduced, progress, flash = 0, echo = [], now = 0, cores = 8 }) {
  const g = geometry(W, H);
  ctx.clearRect(0, 0, W, H);
  if (mode === 'stopping') {
    ctx.beginPath(); ctx.arc(g.cx, g.cy, 90 * g.scale, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? '#4c1d95' : '#ddd6fe'; ctx.lineWidth = 6; ctx.stroke();
    const arc = stoppingArc(progress, t, reduced);
    ctx.beginPath(); ctx.arc(g.cx, g.cy, 90 * g.scale, arc.start, arc.end);
    ctx.strokeStyle = dark ? '#ede9fe' : '#2e1065'; ctx.lineCap = 'round'; ctx.stroke();
    return;
  }
  const dim = mode === 'paused' ? 0.35 : mode === 'denied' ? 0.3 : 1;
  const quiet = mode === 'denied' ? [0, 0, 0] : energy;
  const which = mode === 'denied' ? [1] : [0, 1, 2];
  for (const bi of which) {
    const b = BANDS[bi];
    const shape = bandShape(bi, { energy: quiet, t, reduced });
    const cols = dark ? b.dark : b.cols;
    ctx.save();
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    // The soft halo pass, on the band's outer edge.
    ctx.filter = dark ? 'blur(24px)' : 'blur(28px)';
    ctx.globalAlpha = (dark ? 0.35 : 0.18) * dim;
    ctx.strokeStyle = cols[0]; ctx.lineWidth = b.w * g.scale;
    strokeRing(ctx, g, bi, shape, b.w / 2, 0, 180);
    ctx.filter = 'none';
    // The strands, offset across the band's width.
    const grad = typeof ctx.createLinearGradient === 'function' ? ctx.createLinearGradient(g.cx - b.r * g.scale, g.cy, g.cx + b.r * g.scale, g.cy) : null;
    if (grad && typeof grad.addColorStop === 'function') { grad.addColorStop(0, cols[0]); grad.addColorStop(1, cols[1]); ctx.strokeStyle = grad; } else ctx.strokeStyle = cols[1];
    ctx.lineWidth = 0.6; ctx.globalAlpha = b.a * dim;
    const n = strandCount(b, cores);
    for (let s = 0; s < n; s += 1) strokeRing(ctx, g, bi, shape, (s / Math.max(1, n - 1) - 0.5) * b.w, (s / n) * 0.9, 240);
    ctx.restore();
  }
  if (g.rMax > g.r0) {
    for (const w of echo) {
      const p = (now - w.t0) / WAVE.lifeMs;
      if (p < 0 || p >= 1) continue;
      const { r, alpha } = waveAt(p, w.k, g);
      ctx.save();
      ctx.globalAlpha = alpha * dim;
      ctx.beginPath(); ctx.arc(g.cx, g.cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = dark ? WAVE.dark : WAVE.light; ctx.lineWidth = WAVE.line; ctx.stroke();
      ctx.restore();
    }
  }
  if (flash > 0) {
    // "Mark this moment": the violet arc at the top of the outer ring.
    ctx.save();
    ctx.globalAlpha = 0.5 * flash;
    ctx.beginPath(); ctx.arc(g.cx, g.cy, (BANDS[0].r + 30) * g.scale, -Math.PI / 2 - 0.08, -Math.PI / 2 + 0.08);
    ctx.strokeStyle = dark ? WAVE.dark : WAVE.light; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
  }
}

/**
 * Run the ring on a canvas context. Returns a stop function, whose `redraw`
 * asks for a frame (after a resize). `raf`/`caf`/`now` are injected so a test
 * can count the frames asked for; `hidden` and `watchVisibility` stop drawing
 * while the tab is hidden; `size` is read on every frame. `memory` carries the
 * rings' state across a restart (a new mode or a mark), so a pause eases the
 * rings back to circles instead of snapping them.
 */
export function runRing({ ctx, size, analyser, sampleRate, mode, dark, reduced, progress, raf, caf, now, flashAt = null, cores = 8, hidden = () => false, watchVisibility = null, memory = null }) {
  let state = memory?.state || initialState();
  const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  let last = now(), id = null, alive = true;
  const live = !!analyser && mode === 'speech';
  const wants = (flash) => {
    if (mode === 'stopping') return !reduced && stoppingArc(progress, 0, true).indeterminate;
    return flash > 0 || state.echo.length > 0 || moving(state) || (mode === 'speech' && (live || animates({ reduced, paused: false })));
  };
  const frame = () => {
    id = null;
    if (!alive) return;
    const n = now(), dt = Math.min(0.05, (n - last) / 1000); last = n;
    let sample = null;
    if (live && freq) { analyser.getByteFrequencyData(freq); sample = bandLevels(freq, sampleRate); }
    state = step(state, { sample, dt, now: n, mode, reduced });
    if (memory) memory.state = state;
    const flash = flashAt == null ? 0 : flashLevel(n - flashAt, reduced);
    drawRing(ctx, { W: size.w, H: size.h, energy: state.energy, t: state.t, mode, dark, reduced, progress, flash, echo: state.echo, now: n, cores });
    if (!hidden() && wants(flash)) id = raf(frame);
  };
  const unwatch = typeof watchVisibility === 'function'
    ? watchVisibility(() => { if (alive && id == null && !hidden()) { last = now(); id = raf(frame); } })
    : null;
  frame();
  const stop = () => { alive = false; if (id != null) caf(id); if (unwatch) unwatch(); };
  stop.redraw = () => { if (alive && id == null) id = raf(frame); };
  return stop;
}
