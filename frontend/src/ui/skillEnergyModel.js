/**
 * D4120 (#4120): SkillEnergy's generator, style B (radiating rays), ported
 * from the SkillEnergy canvas (EN6's `skillEnergy`). Pure: nothing is read,
 * nothing is random, and the same input always gives the same picture.
 *
 *   · area  — the hue, the stroke rhythm and the direction: the longest rays
 *             point at the area's angle on the 8-axis radar.
 *   · level — density and intensity (SKILL_LEVELS), from a few faint rays at
 *             Aware to a layered burst at Expert.
 *   · slug  — the skill's own variation: an FNV-1a hash of it seeds every
 *             "random" choice (origin offset, spread, reach, spin).
 *   · size  — 48, 96 or 160 px. Strokes are scaled per pixel so they stay crisp.
 *
 * `skillEnergySpec` gives the drawing as data, which `SkillEnergy.jsx` renders.
 * `skillEnergySvg` gives the same drawing as the canvas's SVG string, which is
 * what the snapshot test compares with the canvas, cell by cell.
 *
 * Two departures from the canvas, both so the output is deterministic: only
 * style B is kept (the owner's pick), and the element ids take a caller's
 * suffix instead of the canvas's per-call counter.
 */
import { SKILL_AREAS, SKILL_LEVELS, areaOf } from '../lib/skillAreas.js';

export const SIZES = [48, 96, 160];
/** How far the strokes drift toward the area's angle in the optional shimmer (viewBox units). */
const DRIFT = 3.5;

const f = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/** FNV-1a over the slug's UTF-16 code units, as the canvas does. */
export function slugHash(slug) {
  const s = String(slug ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The canvas's seeded generator (mulberry32 on the slug's hash). */
function seeded(h) {
  let sd = h;
  const rnd = () => { sd = (sd + 0x6d2b79f5) | 0; let x = Math.imul(sd ^ (sd >>> 15), 1 | sd); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  return { rnd, r: (a, b) => a + (b - a) * rnd() };
}

/** Catmull-Rom through the points, as cubic Béziers (the canvas's `curve`). */
function curve(P, closed) {
  const m = P.length, g = (i) => (closed ? P[(i + m) % m] : P[Math.max(0, Math.min(m - 1, i))]);
  let d = 'M' + f(P[0][0]) + ' ' + f(P[0][1]);
  for (let i = 0; i < (closed ? m : m - 1); i++) {
    const a = g(i - 1), b = g(i), c = g(i + 1), e = g(i + 2);
    d += 'C' + f(b[0] + (c[0] - a[0]) / 6) + ' ' + f(b[1] + (c[1] - a[1]) / 6) + ' ' + f(c[0] - (e[0] - b[0]) / 6) + ' ' + f(c[1] - (e[1] - b[1]) / 6) + ' ' + f(c[0]) + ' ' + f(c[1]);
  }
  return d + (closed ? 'Z' : '');
}

/**
 * The drawing as data. `theme` is 'light' or 'dark'; `t` (0 to 1) is a still
 * frame of the drift; `motion` adds the 6 s shimmer (off under
 * prefers-reduced-motion). `idSuffix` keeps two copies on one page apart.
 */
export function skillEnergySpec({ slug = 'skill', area = 'Product', level = 3, size = 96, theme = 'light', t = 0, motion = false, idSuffix = '0' } = {}) {
  const A = areaOf(area) || SKILL_AREAS[0];
  const L = SKILL_LEVELS[Math.min(5, Math.max(1, Math.round(Number(level) || 3))) - 1];
  const h = slugHash(slug);
  const { r } = seeded(h);
  const dark = theme === 'dark', col = dark ? A.dark : A.light;
  const k = 100 / size, small = size <= 64;
  const sw = (small ? 1.15 : size <= 120 ? 1.3 : 1.5) * k * L.w;
  const count = (base) => Math.max(3, Math.round(base * L.n * (small ? 0.7 : 1)));
  const ang = A.angle * Math.PI / 180, dx = Math.sin(ang), dy = -Math.cos(ang), px = -dy, py = dx;
  const strokes = [];
  const add = (d, op, wf) => strokes.push({ d, op: r2(op), w: r2(sw * (wf || 1)) });

  // B · strokes radiate from one point behind the centre; the longest point at the area's angle.
  const M = count(52), ox = 50 - dx * 20 + px * r(-6, 6), oy = 50 - dy * 20 + py * r(-6, 6), sharp = r(1.4, 2.8), reach = r(80, 98), base = r(4, 8), rin = r(5, 8), spin = r(0, 6.28);
  for (let j = 0; j < M; j++) {
    const a = spin + j / M * 6.2832 + r(-0.05, 0.05), ux = Math.sin(a), uy = -Math.cos(a), c = Math.pow(Math.max(0, ux * dx + uy * dy), sharp), len = base + reach * c * r(0.7, 1);
    add('M' + f(ox + ux * rin) + ' ' + f(oy + uy * rin) + 'L' + f(ox + ux * (rin + len)) + ' ' + f(oy + uy * (rin + len)), L.op * (0.3 + 0.7 * Math.sqrt(c)), 1);
    if (L.layers > 1 && c > 0.35) { const s0 = rin + len + 3, s1 = s0 + len * r(0.12, 0.28); add('M' + f(ox + ux * s0) + ' ' + f(oy + uy * s0) + 'L' + f(ox + ux * s1) + ' ' + f(oy + uy * s1), L.op * 0.4, 0.7); }
  }
  if (L.layers > 2) { const P = []; for (let j = 0; j < 24; j++) { const a = j / 24 * 6.2832; P.push([ox + Math.cos(a) * rin * 1.7, oy + Math.sin(a) * rin * 1.7]); } add(curve(P, true), L.op * 0.35, 0.7); }

  const uid = 'se' + h.toString(36) + 'B' + size + (dark ? 'd' : 'l') + L.level + '_' + idSuffix;
  return {
    uid, size, col, dark,
    rx: f((small ? 10 : size <= 120 ? 14 : 16) * k),
    glow: { cx: f(50 + dx * 46), cy: f(50 + dy * 46), opacity: r2(L.glow * (dark ? 1.5 : 1)) },
    wash: dark ? 0.12 : 0.07,
    dash: A.dash ? A.dash.split(' ').map((v) => f(v * k)).join(' ') : '',
    still: t ? { x: f(dx * DRIFT * t), y: f(dy * DRIFT * t), opacity: r2(1 - 0.18 * t) } : null,
    motion: motion ? { dx: f(dx * DRIFT), dy: f(dy * DRIFT) } : null,
    strokes,
  };
}

/** The shimmer's keyframes, scoped to one drawing and stopped under prefers-reduced-motion. */
export function motionCss(spec) {
  if (!spec.motion) return '';
  const { uid, motion: m } = spec;
  return '@keyframes ' + uid + 'k{0%,100%{transform:translate(0px,0px);opacity:1}50%{transform:translate(' + m.dx + 'px,' + m.dy + 'px);opacity:.82}}.' + uid + 'm{animation:' + uid + 'k 6s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.' + uid + 'm{animation:none}}';
}

/** The drawing as the canvas's SVG string (the same bytes `skillEnergy({ style: 'B' })` returns there). */
export function skillEnergySvg(opts = {}) {
  const s = skillEnergySpec(opts);
  const css = s.motion ? '<style>' + motionCss(s) + '</style>' : '';
  const still = s.still ? ' style="transform:translate(' + s.still.x + 'px,' + s.still.y + 'px);opacity:' + s.still.opacity + '"' : '';
  const dash = s.dash ? ' stroke-dasharray="' + s.dash + '"' : '';
  const paths = s.strokes.map((p) => '<path d="' + p.d + '" stroke-opacity="' + p.op + '" stroke-width="' + p.w + '"/>').join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s.size + '" height="' + s.size + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false" style="display:block;flex:none">' + css +
    '<defs><clipPath id="' + s.uid + 'c"><rect width="100" height="100" rx="' + s.rx + '"/></clipPath><radialGradient id="' + s.uid + 'g" cx="' + s.glow.cx + '" cy="' + s.glow.cy + '" r="72" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="' + s.col + '" stop-opacity="' + s.glow.opacity + '"/><stop offset="1" stop-color="' + s.col + '" stop-opacity="0"/></radialGradient></defs>' +
    '<g clip-path="url(#' + s.uid + 'c)"><rect width="100" height="100" fill="' + s.col + '" fill-opacity="' + s.wash + '"/><rect width="100" height="100" fill="url(#' + s.uid + 'g)"/>' +
    '<g' + (s.motion ? ' class="' + s.uid + 'm"' : still) + ' fill="none" stroke="' + s.col + '" stroke-linecap="round" stroke-linejoin="round"' + dash + '>' + paths + '</g></g></svg>';
}
