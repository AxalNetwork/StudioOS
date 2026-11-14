/**
 * D1330 — the Recording View's ring visualiser, to the Recording View Canvas
 * (RV1–RV13; `design/incoming/ring-viz.js`).
 *
 *   · the gate: below 0.04 a band is a perfect, still circle;
 *   · silence draws three circles, each strand within 1px of an ideal circle,
 *     and nothing moves from frame to frame;
 *   · a hum moves only the outer ring, a whistle only the inner one, and the
 *     ripple is even all round (never petals);
 *   · waves leave about twice a second with sound, and stop within 1.4s of silence;
 *   · the rings return to circles within about half a second;
 *   · reduced motion: no turn, no breathing, no waves, the ripple still follows sound;
 *   · paused: time freezes, the rings ease back to circles at 35%;
 *   · the square fits a 390px phone and a 1440px desktop, 14px inside the edge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANDS, EDGE_MARGIN, OUTER_REACH, RIPPLE_PX, SWELL_PX, WAVE,
  bandLevels, bandShape, drawRing, gateOf, geometry, initialState, ringRadius, runRing, step, strandCount,
} from '../src/lib/ringViz.js';

const SR = 48000;
const N = 1024; // fftSize 2048 → 1024 bins

/** A spectrum loud (255) between two frequencies and silent elsewhere. */
function tone(fromHz, toHz) {
  const f = new Uint8Array(N);
  const bin = (hz) => Math.round((hz / (SR / 2)) * N);
  for (let i = bin(fromHz); i <= bin(toHz); i += 1) f[i] = 255;
  return f;
}

/** How far one band's centre strand strays from a circle at this instant (max − min radius, px at the 400px reference). */
function spread(bi, energy, t = 0, reduced = false) {
  const shape = bandShape(bi, { energy, t, reduced });
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 720; k += 1) {
    const r = ringRadius(bi, (k / 720) * Math.PI * 2, shape);
    lo = Math.min(lo, r); hi = Math.max(hi, r);
  }
  return { lo, hi, d: hi - lo };
}

/** Run `step` for `seconds` at 60fps from `state`, hearing `sample`. */
function run(state, { seconds, sample, mode = 'speech', reduced = false, t0 = 0 }) {
  const dt = 1 / 60;
  let s = state, now = t0;
  const emitted = [];
  for (let i = 0; i < Math.round(seconds * 60); i += 1) {
    now += dt * 1000;
    const before = s.lastEcho;
    s = step(s, { sample, dt, now, mode, reduced });
    if (s.lastEcho !== before) emitted.push(now);
  }
  return { state: s, now, emitted };
}

/** A canvas context that records what is drawn. */
function recorder() {
  const log = { paths: [], arcs: [], alphas: [] };
  let path = null;
  const ctx = {
    clearRect() {}, save() {}, restore() {}, stroke() { if (path) log.paths.push({ pts: path, alpha: ctx.globalAlpha }); path = null; },
    beginPath() { path = []; }, closePath() {}, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    arc(cx, cy, r, a0, a1) { log.arcs.push({ cx, cy, r, a0, a1, alpha: ctx.globalAlpha }); path = null; },
    createLinearGradient() { return { addColorStop() {} }; },
    globalAlpha: 1, lineWidth: 1, strokeStyle: '', filter: 'none', globalCompositeOperation: 'source-over', lineCap: 'butt',
  };
  return { ctx, log };
}

test('the gate: closed at or below 0.04, half open at 0.08, open at 0.12', () => {
  assert.equal(gateOf(0), 0);
  assert.equal(gateOf(0.03), 0, 'background noise below the gate');
  assert.equal(gateOf(0.04), 0);
  assert.ok(Math.abs(gateOf(0.08) - 0.5) < 1e-9);
  assert.ok(Math.abs(gateOf(0.12) - 1) < 1e-9);
  assert.equal(gateOf(1), 1);
  // At gate 0 there is no ripple, no swell and no breathing, at any time.
  for (const t of [0, 1.3, 7.9]) {
    const s = bandShape(0, { energy: [0.035, 0, 0], t, reduced: false });
    assert.deepEqual([s.gate, s.amp, s.swell, s.breathe], [0, 0, 0, 0]);
  }
});

test('silence: three perfect, motionless circles, every strand within 1px of an ideal circle', () => {
  const noise = [0.03, 0.02, 0.035]; // under the gate: never moves a ring
  for (const bi of [0, 1, 2]) {
    const a = spread(bi, noise, 0), b = spread(bi, noise, 5.7);
    assert.ok(a.d < 1e-9, `band ${bi} is a circle`);
    assert.equal(a.lo, b.lo, `band ${bi} does not breathe or swell over time`);
  }
  const { ctx, log } = recorder();
  const g = geometry(440, 440);
  drawRing(ctx, { W: 440, H: 440, energy: noise, t: 3, mode: 'silence', dark: false, reduced: false, progress: null });
  assert.ok(log.paths.length >= 3 * 33, 'three rings of halo and strands');
  for (const p of log.paths) {
    const r = p.pts.map(([x, y]) => Math.hypot(x - g.cx, y - g.cy));
    assert.ok(Math.max(...r) - Math.min(...r) < 1, 'within 1px of an ideal circle');
  }
  assert.equal(log.arcs.length, 0, 'no waves in silence');
});

test('a hum moves only the outer ring, a whistle only the inner ring; the ripple stays even and circular', () => {
  const hum = bandLevels(tone(60, 140), SR);
  assert.ok(hum[0] > 0.2 && hum[1] === 0 && hum[2] === 0, `hum ${hum}`);
  const h = run(initialState(), { seconds: 0.5, sample: hum }).state;
  assert.ok(spread(0, h.energy, 1).d > 1, 'the outer ring ripples');
  assert.ok(spread(1, h.energy, 1).d < 1e-9 && spread(2, h.energy, 1).d < 1e-9, 'the others stay circles');

  const whistle = bandLevels(tone(2900, 7000), SR);
  assert.ok(whistle[2] > 0.5 && whistle[0] === 0 && whistle[1] === 0, `whistle ${whistle}`);
  const w = run(initialState(), { seconds: 0.5, sample: whistle }).state;
  assert.ok(spread(2, w.energy, 1).d > 1, 'the inner ring ripples');
  assert.ok(spread(0, w.energy, 1).d < 1e-9 && spread(1, w.energy, 1).d < 1e-9);

  // Full volume: the ripple is at most 10px and the swell at most 6px on a 150px ring — a circle, never petals.
  for (const bi of [0, 1, 2]) {
    const s = spread(bi, [1, 1, 1], 2);
    assert.ok(s.d <= RIPPLE_PX + 1e-9, `band ${bi} ripple ${s.d}`);
    assert.ok(s.lo >= BANDS[bi].r - 2, 'the ring never caves in');
    assert.ok(s.hi <= BANDS[bi].r + SWELL_PX + RIPPLE_PX + 2 + 1e-9);
  }
  // An even wave: lobes 12/16/22 with lobes + 2 at 30%, so the ripple has as many crests all the way round.
  assert.deepEqual(BANDS.map((b) => b.lobes), [12, 16, 22]);
  assert.deepEqual(BANDS.map((b) => b.dir), [1, 1, -1], 'outer and middle clockwise, inner anticlockwise');
});

test('waves: about twice a second with sound, none in silence, gone within 1.4s of it, perfect circles inside the edge', () => {
  const voice = [0.3, 0.6, 0.2];
  const talk = run(initialState(), { seconds: 3, sample: voice });
  assert.ok(talk.emitted.length >= 6 && talk.emitted.length <= 7, `${talk.emitted.length} waves in 3s`);
  for (let i = 1; i < talk.emitted.length; i += 1) assert.ok(talk.emitted[i] - talk.emitted[i - 1] >= WAVE.everyMs - 1e-6, 'at most every 450ms');
  const hush = run(talk.state, { seconds: 1.45, sample: [0, 0, 0], t0: talk.now });
  assert.equal(hush.emitted.length, 0, 'no new wave once it is silent');
  assert.equal(hush.state.echo.length, 0, 'the last wave is gone within 1.4s');
  assert.equal(run(initialState(), { seconds: 2, sample: [0.11, 0.1, 0.05] }).emitted.length, 0, 'not below 0.12');

  const { ctx, log } = recorder();
  drawRing(ctx, { W: 440, H: 440, energy: talk.state.energy, t: 1, mode: 'speech', dark: false, reduced: false, echo: talk.state.echo, now: talk.now });
  const g = geometry(440, 440);
  assert.ok(log.arcs.length > 0);
  for (const a of log.arcs) {
    assert.equal(a.a1 - a.a0, Math.PI * 2, 'a whole circle');
    assert.deepEqual([a.cx, a.cy], [g.cx, g.cy], 'centred on the rings');
    assert.ok(a.r >= g.r0 && a.r <= g.rMax && g.rMax <= 220 - 4 + 1e-9, 'from 14px outside the outer ring to 4px inside the edge');
  }
});

test('the rings return to circles within about half a second of silence', () => {
  const talk = run(initialState(), { seconds: 1, sample: [0.35, 0.35, 0.35] }).state;
  assert.ok(spread(1, talk.energy, 1).d > 2);
  const after = run(talk, { seconds: 0.6, sample: [0, 0, 0] }).state;
  for (const bi of [0, 1, 2]) assert.ok(spread(bi, after.energy, 1).d < 1, `band ${bi} is a circle again (within 1px)`);
  // By a second the gate has closed: the circle is back at its resting radius, and still.
  const rest = run(after, { seconds: 0.4, sample: [0, 0, 0] }).state;
  for (const bi of [0, 1, 2]) {
    const s = spread(bi, rest.energy, 1);
    assert.ok(s.d < 1e-9 && Math.abs(s.lo - BANDS[bi].r) < 1e-9, `band ${bi} at rest`);
  }
});

test('reduced motion: no turn, no breathing, no waves; the ripple and swell still follow sound', () => {
  const r = run(initialState(), { seconds: 1, sample: [0.5, 0.5, 0.5], reduced: true });
  assert.equal(r.state.t, 0, 'time does not turn the rings');
  assert.equal(r.emitted.length, 0, 'no spreading waves');
  const shape = bandShape(1, { energy: r.state.energy, t: 9, reduced: true });
  assert.equal(shape.rot, 0); assert.equal(shape.breathe, 0);
  assert.ok(shape.amp > 1 && shape.swell > 1, 'still feedback');
  // With a microphone it keeps drawing to follow sound; with none it is one still frame.
  const frames = (analyser) => {
    let n = 0;
    const stop = runRing({ ctx: recorder().ctx, size: { w: 200, h: 200 }, analyser, sampleRate: SR, mode: 'speech', reduced: true, raf: () => { n += 1; return n; }, caf: () => {}, now: () => 0 });
    stop();
    return n;
  };
  const analyser = { frequencyBinCount: N, getByteFrequencyData(a) { a.set(tone(300, 1500)); } };
  assert.equal(frames(analyser), 1);
  assert.equal(frames(null), 0);
});

test('paused: time freezes, no waves, the rings ease back to circles and draw at 35%', () => {
  const talk = run(initialState(), { seconds: 1, sample: [0.5, 0.5, 0.5] }).state;
  const p = run(talk, { seconds: 0.7, sample: [0.9, 0.9, 0.9], mode: 'paused' });
  assert.equal(p.state.t, talk.t, 'time freezes');
  assert.equal(p.emitted.length, 0);
  for (const bi of [0, 1, 2]) assert.ok(spread(bi, p.state.energy, 0).d < 1, 'eased back to a circle');
  const { ctx, log } = recorder();
  drawRing(ctx, { W: 400, H: 400, energy: p.state.energy, t: 0, mode: 'paused', dark: false, reduced: false });
  const strands = log.paths.filter((x) => x.alpha > 0.2);
  assert.ok(strands.length > 0);
  for (const s of strands) assert.ok(BANDS.some((b) => Math.abs(s.alpha - b.a * 0.35) < 1e-9), 'at 35%');
  // A paused ring that has already settled asks for no frame (one still frame).
  let n = 0;
  runRing({ ctx, size: { w: 100, h: 100 }, analyser: null, sampleRate: SR, mode: 'paused', reduced: false, raf: () => { n += 1; return n; }, caf: () => {}, now: () => 0 })();
  assert.equal(n, 0);
  // One that was moving keeps drawing until it has eased back.
  n = 0;
  runRing({ ctx, size: { w: 100, h: 100 }, analyser: null, sampleRate: SR, mode: 'paused', reduced: false, raf: () => { n += 1; return n; }, caf: () => {}, now: () => 0, memory: { state: talk } })();
  assert.equal(n, 1);
});

test('microphone denied: one dim middle ring, a perfect circle; low-power devices draw 60% of the strands', () => {
  const { ctx, log } = recorder();
  drawRing(ctx, { W: 400, H: 400, energy: [1, 1, 1], t: 2, mode: 'denied', dark: false, reduced: false });
  assert.equal(log.paths.length, 1 + 32, 'one ring: its halo and its strands');
  const g = geometry(400, 400);
  for (const p of log.paths) {
    const r = p.pts.map(([x, y]) => Math.hypot(x - g.cx, y - g.cy));
    assert.ok(Math.max(...r) - Math.min(...r) < 1);
  }
  assert.equal(strandCount(BANDS[0], 4), 19);
  assert.equal(strandCount(BANDS[0], 8), 32);
  const low = recorder();
  drawRing(low.ctx, { W: 400, H: 400, energy: [0, 0, 0], t: 0, mode: 'speech', dark: false, reduced: false, cores: 2 });
  assert.equal(low.log.paths.length, 3 * (1 + 19));
});

test('a hidden tab draws nothing more until it is shown again', () => {
  let hidden = true, n = 0, wake = null;
  const stop = runRing({
    ctx: recorder().ctx, size: { w: 200, h: 200 }, analyser: null, sampleRate: SR, mode: 'speech', reduced: false,
    raf: () => { n += 1; return n; }, caf: () => {}, now: () => 0,
    hidden: () => hidden, watchVisibility: (cb) => { wake = cb; return () => { wake = null; }; },
  });
  assert.equal(n, 0, 'nothing scheduled while hidden');
  hidden = false; wake();
  assert.equal(n, 1, 'shown again: drawing resumes');
  stop();
  assert.equal(wake, null, 'the listener is removed');
});

test('the square fits a 390px phone and a 1440px desktop, the outer ring 14px inside the edge', () => {
  // The stage: min(100%, 440px) inside 24px of padding each side.
  for (const [viewport, side] of [[390, Math.min(390 - 48, 440)], [1440, 440]]) {
    const g = geometry(side, side);
    assert.ok(OUTER_REACH * g.scale <= side / 2 - EDGE_MARGIN + 1e-9, `${viewport}: the outer ring at full volume stays 14px inside`);
    assert.ok(g.r0 < g.rMax, `${viewport}: waves have room to spread`);
    assert.equal(g.cx, g.cy, `${viewport}: centred in a square`);
  }
});
