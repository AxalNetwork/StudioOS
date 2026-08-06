/**
 * axal_spinout_demoday_app.tsx — Axal VC 28-day Spin-Out Lab · Demo Day deck.
 *
 * In-app React renderer for the registry key `axal_spinout_demoday`. Renders
 * the 10-slide BASEPOINT editorial design (restrained white/ink + a single
 * blue accent, `#2C4BE0`) one-to-one with the PPTX export produced by
 * `../spinout/buildDeck.js`. Both sides share a single source of truth —
 * `../spinout/deckData.js` (THEME / fmt / SAMPLE_DATA / SAMPLE_NOTES) — so the
 * editor, picker thumbnail, preview modal, share view and PDF export all show
 * the same deck.
 *
 * Slide order (11): Cover · Problem (+ validation evidence) · Solution ·
 * Product demo · Market · Competitive · Traction · Roadmap · Team & network ·
 * Ask (+ cap table) · Review the deal. The narrative arc runs problem (with
 * its validation proof) → solution → proof → opportunity → traction → plan →
 * team → the raise: the standalone Validation slide is merged into Problem
 * (discovery funnel strip) and the standalone Cap Table slide into Ask (donut
 * + entity status), while Competitive and Traction are new slides. The
 * `validation.*` / `captable.*` field sections remain unchanged — the merged
 * slides read them in place.
 *
 * Geometry: the PPTX canvas is 13.33in × 7.5in (= 960pt × 540pt). It maps to
 * the shared 1920 × 1080 `<Slide16x9>` frame at exactly 144px / inch and
 * 2px / pt, so every `addText`/`addShape`/`addChart` call in `buildDeck.js`
 * translates to a positioned element here via `inch()` / `pt()`.
 *
 * ── Autofill / field contract ────────────────────────────────────────────
 * `buildTemplateData()` (PitchDeckPrintPage.jsx) flattens the editor's
 * `slides[].fields[]` into one flat dict keyed by each field's `key`, and
 * `updateField()` (PitchDeckPage.jsx) writes edits back by that same key.
 * `hydrate()` below rebuilds the nested SpinoutDeckData shape from that flat
 * dict using a dotted-key contract:
 *   - scalar narrative fields  → key = dotted path,  value = string
 *       e.g. `cover.thesis`, `problem.title`, `deal.closingLine`
 *   - structured viz fields    → key = dotted path + `_json`, value = JSON
 *       e.g. `problem.pains_json`, `validation.stages_json`, `team.nodes_json`
 * Recognised keys merge onto SAMPLE_DATA (BASEPOINT) via `mergeShape()` with a
 * type-mismatch guard; unrecognised / legacy keys are ignored, so a deck with
 * no spinout fields (or only old-shape keys) renders the BASEPOINT sample as
 * the autofill default. Wiring the worker/dev autofill to emit these keys is a
 * follow-up; this module only consumes them.
 */
import React from 'react';
import type { DeckProps } from '../DeckBase';
import { Slide16x9, Editable } from '../DeckBase';
import { THEME, SAMPLE_DATA as SPINOUT_SAMPLE_DATA } from '../spinout/deckData';

/* ─────────────────────────── sample re-export ─────────────────────────── */
// Re-exported so `sample.ts::previewDataFor('axal_spinout_demoday')` and the
// deck test import the single canonical fixture. Passing this nested object as
// `data` is equivalent to passing `{}` — `hydrate()` finds no flat keys and
// returns the sample.
export const SAMPLE_DATA = SPINOUT_SAMPLE_DATA;

/* ───────────────────── Brand Builder font pairings ────────────────────── */
// `FONT_PAIRING_OPTIONS` is imported by BrandBuilderPage's <select>; the ids
// persist to `landing_pages`, so keep them stable.
type FontPairingId = 'editorial' | 'modern' | 'humanist' | 'classic';
const FONT_PAIRINGS: Record<FontPairingId, { label: string }> = {
  editorial: { label: 'Editorial · Serif' },
  modern: { label: 'Modern · Sans' },
  humanist: { label: 'Humanist · Serif + Sans' },
  classic: { label: 'Classic · Serif + Sans' },
};
export const FONT_PAIRING_OPTIONS: Array<{ value: FontPairingId; label: string }> =
  (Object.keys(FONT_PAIRINGS) as FontPairingId[]).map((k) => ({ value: k, label: FONT_PAIRINGS[k].label }));

/* ─────────────────────────── units + theme ───────────────────────────── */
const PXIN = 144;                 // 1 inch  → 144 px  (1920 / 13.33)
const inch = (n: number) => n * PXIN;
const pt = (n: number) => n * 2;  // 1 point → 2 px    (1920 / 960pt)
const W = 13.33, MARGIN = 0.7, CW = W - MARGIN * 2;
const ML = MARGIN;

/* Palette. DERIVED from `THEME.color` in ../spinout/deckData — not a second
 * copy of it. That module's header promises "the React template derives K from
 * this object … so preview and export cannot drift apart on palette"; until
 * now K was a hand-maintained near-miss (ink #171321 vs the design's #1A202C,
 * panel #F7F7F9 vs #F8F8FA, dbg #09080D vs #17142E …), so the promise held for
 * the accent and nothing else. THEME stores bare hex for pptxgenjs, which never
 * wants a '#'; the browser always does. That is the only difference. */
const K = Object.fromEntries(
  Object.entries(THEME.color).map(([k, hex]) => [k, `#${hex}`]),
) as Record<keyof typeof THEME.color, string>;

const FF = '"Inter", "Helvetica Neue", system-ui, sans-serif';
const SERIF = '"Inter", system-ui, sans-serif';

type OnEdit = (path: string, value: string) => void;
type Data = Record<string, any>;
type Status = 'done' | 'active' | 'pending';

/* ─────────────────────────── hydrate ─────────────────────────── */
const SECTIONS = new Set([
  'brand', 'cover', 'problem', 'validation', 'market', 'solution',
  'productDemo', 'competitive', 'traction', 'roadmap', 'team', 'captable',
  'ask', 'deal',
]);

const clone = (o: any) => JSON.parse(JSON.stringify(o));

// Field dicts can come from stored / API-provided data, so dotted paths and
// `_json` payloads are untrusted. These segments would let a crafted key walk
// up the prototype chain (`cover.__proto__.x`) or, after JSON.parse, smuggle an
// own `__proto__` key into a structured value — both classic prototype-pollution
// sinks. They are never legitimate deck fields, so we drop them everywhere.
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function setPath(obj: Data, dotted: string, value: any): boolean {
  const keys = dotted.split('.');
  if (keys.some((k) => FORBIDDEN_KEYS.has(k))) return false;
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return true;
}

// Merge `inc` onto `base` preserving `base`'s typed shape. A non-object /
// array value never replaces a typed object base, and vice-versa, so a
// malformed incoming field can't crash a slide that reads a nested path.
// Forbidden keys are skipped so a JSON.parse'd `__proto__` own-key can't mutate
// the merged object's prototype.
function mergeShape(base: any, inc: any): any {
  if (inc === undefined || inc === null) return base;
  if (Array.isArray(base)) return Array.isArray(inc) ? inc : base;
  if (typeof base === 'object') {
    if (typeof inc !== 'object' || Array.isArray(inc)) return base;
    const out: Data = { ...base };
    for (const k of Object.keys(inc)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = k in base ? mergeShape(base[k], inc[k]) : inc[k];
    }
    return out;
  }
  return typeof inc === 'object' ? base : inc;
}

function hydrate(raw: any): Data {
  const base = clone(SAMPLE_DATA);
  if (!raw || typeof raw !== 'object') return base;
  const incoming: Data = {};
  let touched = false;
  for (const [key, val] of Object.entries(raw)) {
    if (!key.includes('.')) continue; // ignore legacy / non-spinout flat keys
    let path = key;
    let value: any = val;
    if (key.endsWith('_json')) {
      path = key.slice(0, -5);
      if (typeof val === 'string') {
        try { value = JSON.parse(val); } catch { continue; }
      }
    }
    if (!SECTIONS.has(path.split('.')[0])) continue;
    if (setPath(incoming, path, value)) touched = true;
  }
  return touched ? mergeShape(base, incoming) : base;
}

/* ─────────────────────────── primitives ─────────────────────────── */
type VAlign = 'top' | 'middle' | 'bottom';
const justify = (v?: VAlign) => (v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start');

const boxStyle = (
  l: number, t: number, w: number, h: number | undefined, v: VAlign | undefined, extra?: React.CSSProperties,
): React.CSSProperties => ({
  position: 'absolute', left: inch(l), top: inch(t), width: inch(w),
  height: h != null ? inch(h) : undefined,
  display: 'flex', flexDirection: 'column', justifyContent: justify(v),
  ...extra,
});

interface TxtProps {
  l: number; t: number; w: number; h?: number;
  size: number; bold?: boolean; color: string; align?: 'left' | 'center' | 'right';
  valign?: VAlign; spacing?: number; lh?: number; italic?: boolean; face?: string;
  children: React.ReactNode; style?: React.CSSProperties; z?: number;
}
const Txt: React.FC<TxtProps> = ({
  l, t, w, h, size, bold, color, align, valign, spacing, lh, italic, face, children, style, z,
}) => (
  <div style={boxStyle(l, t, w, h, valign, z != null ? { zIndex: z } : undefined)}>
    <div style={{
      width: '100%', textAlign: align || 'left', fontFamily: face || FF, fontSize: pt(size),
      fontWeight: bold ? 700 : 400, color, letterSpacing: spacing != null ? pt(spacing) : undefined,
      lineHeight: lh ?? 1.1, fontStyle: italic ? 'italic' : undefined, ...style,
    }}>{children}</div>
  </div>
);

interface EdProps extends Omit<TxtProps, 'children'> {
  value: any; path: string; editable?: boolean; onEdit?: OnEdit; placeholder?: string;
}
const Ed: React.FC<EdProps> = ({
  l, t, w, h, size, bold, color, align, valign, spacing, lh, italic, face,
  value, path, editable, onEdit, placeholder, style, z,
}) => (
  <div style={boxStyle(l, t, w, h, valign, z != null ? { zIndex: z } : undefined)}>
    <Editable
      as="div" value={String(value ?? '')} path={path} editable={editable} onEdit={onEdit}
      placeholder={placeholder}
      style={{
        width: '100%', textAlign: align || 'left', fontFamily: face || FF, fontSize: pt(size),
        fontWeight: bold ? 700 : 400, color, letterSpacing: spacing != null ? pt(spacing) : undefined,
        lineHeight: lh ?? 1.1, fontStyle: italic ? 'italic' : undefined, ...style,
      }} />
  </div>
);

const Rect: React.FC<{
  l: number; t: number; w: number; h: number; fill?: string; line?: string | false;
  lineW?: number; r?: number; shadow?: boolean; z?: number;
}> = ({ l, t, w, h, fill = K.white, line = K.line, lineW = 1, r = 0.08, shadow = true, z }) => (
  <div style={{
    position: 'absolute', left: inch(l), top: inch(t), width: inch(w), height: inch(h),
    background: fill, borderRadius: inch(r),
    border: line === false ? 'none' : `${pt(lineW)}px solid ${line}`,
  boxShadow: shadow ? '0 1px 3px rgba(23,19,33,0.035)' : undefined, zIndex: z,
  }} />
);

const Oval: React.FC<{
  l: number; t: number; d: number; fill: string; line?: string; lineW?: number;
  children?: React.ReactNode; shadow?: boolean; z?: number;
}> = ({ l, t, d, fill, line, lineW = 1, children, shadow, z }) => (
  <div style={{
    position: 'absolute', left: inch(l), top: inch(t), width: inch(d), height: inch(d),
    borderRadius: '50%', background: fill,
    border: line ? `${pt(lineW)}px solid ${line}` : 'none',
    boxShadow: shadow ? '2px 2px 9px rgba(0,0,0,0.10)' : undefined,
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: z,
  }}>{children}</div>
);

// Circular avatar: shows a profile photo cropped to a circle when a URL is
// present and loads, otherwise falls back to the initials monogram (also used
// when the image errors out, so a dead URL never shows a broken-image icon).
const Avatar: React.FC<{
  l: number; t: number; d: number; photo?: string; initials: string;
  fill: string; fontSize: number; textColor: string; z?: number;
}> = ({ l, t, d, photo, initials, fill, fontSize, textColor, z }) => {
  const [errored, setErrored] = React.useState(false);
  const showPhoto = !!photo && !errored;
  return (
    <div style={{
      position: 'absolute', left: inch(l), top: inch(t), width: inch(d), height: inch(d),
      borderRadius: '50%', background: fill, overflow: 'hidden', zIndex: z,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {showPhoto ? (
        <img
          src={photo} alt={initials} onError={() => setErrored(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <span style={{ fontFamily: FF, fontWeight: 700, fontSize: pt(fontSize), color: textColor }}>{initials}</span>
      )}
    </div>
  );
};

// Progress / funnel bar: a track with a filled portion.
const Bar: React.FC<{ l: number; t: number; w: number; h: number; pct: number; fill: string; track?: string }> = ({
  l, t, w, h, pct, fill, track = K.panel2,
}) => (
  <>
    <div style={{ position: 'absolute', left: inch(l), top: inch(t), width: inch(w), height: inch(h), background: track, borderRadius: inch(h / 2) }} />
    <div style={{ position: 'absolute', left: inch(l), top: inch(t), width: inch(w * Math.max(0, Math.min(1, pct))), height: inch(h), background: fill, borderRadius: inch(h / 2) }} />
  </>
);

const StatusDot: React.FC<{ status: Status; d: number }> = ({ status, d }) => {
  const px = inch(d);
  if (status === 'done') {
    return (
      <div style={{ width: px, height: px, borderRadius: '50%', background: K.done, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={px * 0.55} height={px * 0.55} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div style={{ width: px, height: px, borderRadius: '50%', background: K.active, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: px * 0.34, height: px * 0.34, borderRadius: '50%', background: '#fff' }} />
      </div>
    );
  }
  return <div style={{ width: px, height: px, borderRadius: '50%', background: '#fff', border: `${pt(1.5)}px solid ${K.faint}` }} />;
};

const StepIcon: React.FC<{ name: string; d: number; color: string }> = ({ name, d, color }) => {
  const s = inch(d);
  const p = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'ingest': return <svg {...p}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></svg>;
    case 'score': return <svg {...p}><path d="M21 12a9 9 0 1 1-9-9" /><path d="M12 12 17 8" /><circle cx="12" cy="12" r="1.4" fill={color} stroke="none" /></svg>;
    case 'monitor': return <svg {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'act': return <svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>;
    default: return null;
  }
};

const Eyebrow: React.FC<{ label: string; idx: string; dark?: boolean }> = ({ label, idx, dark }) => (
  <>
    <Txt l={ML} t={0.5} w={8} h={0.3} size={11} bold color={K.accent} spacing={1.5} valign="middle">
      {String(label).toUpperCase()}
    </Txt>
    <Txt l={W - MARGIN - 3} t={0.5} w={3} h={0.3} size={11} bold align="right" valign="middle" spacing={1} color={dark ? K.dfaint : K.faint}>
      {idx} / 11
    </Txt>
  </>
);

const Title: React.FC<{ text: any; path: string; editable?: boolean; onEdit?: OnEdit; w?: number }> = ({ text, path, editable, onEdit, w }) => (
  <Ed l={ML} t={1.05} w={w || 11.5} h={0.95} size={27} bold color={K.ink} lh={1.04} valign="top" value={text} path={path} editable={editable} onEdit={onEdit} />
);

const Footer: React.FC<{ brand: any; dark?: boolean }> = ({ brand, dark }) => {
  const col = dark ? K.dfaint : K.faint;
  // Every slide mounts this, so an absent `brand` block took the whole deck
  // down rather than dropping one line of chrome. hydrate() always supplies it
  // for the real render path; a slide rendered directly from partial data (a
  // preview, a test, a half-populated payload) did not.
  const b = brand || {};
  return (
    <>
      <Txt l={ML} t={7.06} w={6} h={0.3} size={8} spacing={1} valign="middle" color={col}>{b.lab || ''}</Txt>
      {!dark && (
        <Txt l={W - MARGIN - 6} t={7.06} w={6} h={0.3} size={8} spacing={1} align="right" valign="middle" color={col}>{b.footerRight || ''}</Txt>
      )}
    </>
  );
};

const Donut: React.FC<{ l: number; t: number; w: number; h: number; segments: Array<[string, number]>; colors: string[] }> = ({
  l, t, w, h, segments, colors,
}) => {
  const pw = inch(w), ph = inch(h);
  const size = Math.min(pw, ph);
  const r = size / 2;
  const stroke = r * (1 - 0.62);
  const rad = r - stroke / 2;
  const circ = 2 * Math.PI * rad;
  const total = segments.reduce((a, s) => a + Number(s[1]), 0) || 1;
  let acc = 0;
  return (
    <div style={{ position: 'absolute', left: inch(l), top: inch(t), width: pw, height: ph }}>
      <svg width={pw} height={ph} viewBox={`0 0 ${pw} ${ph}`}>
        <g transform={`translate(${pw / 2},${ph / 2}) rotate(-90)`}>
          {segments.map((seg, i) => {
            const frac = Number(seg[1]) / total;
            const dash = frac * circ;
            const off = acc * circ;
            acc += frac;
            return (
              <circle key={i} r={rad} cx={0} cy={0} fill="none" stroke={colors[i % colors.length]} strokeWidth={stroke}
                strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} />
            );
          })}
        </g>
      </svg>
    </div>
  );
};

/* ─────────────────────────── slides ─────────────────────────── */
type SlideProps = { d: Data; editable?: boolean; onEdit?: OnEdit };

/* ───────────── design-source geometry (AxalSlide.dc.html) ─────────────────
 * The canonical design for this deck lives in-repo at
 * `spin-out-lab-pipeline/project/AxalSlide.dc.html`, authored on a 1280 × 720
 * artboard. The shared frame is 1920 × 1080 — exactly 1.5× — so every design
 * pixel maps through `u()` with no eyeballing and no accumulated drift. Read a
 * value off the design, wrap it in u(), done.
 *
 * Slides rebuilt against the design lay themselves out in FLOW (flex, gaps,
 * radii, gradients) rather than the `inch()` / `pt()` absolute placement the
 * PPTX-mirroring slides use. Both live inside the same `<Slide16x9>`: a rebuilt
 * slide owns one `inset: 0` container and does its own padding; the rest still
 * position every element absolutely. The absolute path exists to keep the PPTX
 * export pixel-aligned, and it is why those slides could never carry the
 * design's cards, gradients and rounded panels.
 *
 * Export note: the PDF path rasterises `[data-slide-frame]` with html2canvas
 * (PitchDeckPrintPage.jsx), which does not implement `background-clip: text`.
 * The design's gradient-filled cover wordmark is therefore rendered in solid
 * white — a clipped gradient exports as a coloured bar behind the letters.
 */
const U = 1.5;                    // 1280 × 720 design px → 1920 × 1080 frame px
const u = (n: number) => n * U;

// Slate tints the design uses inline and THEME does not carry as tokens.
const D = {
  ink2: '#2D3748', hair: '#EDF2F7', arrow: '#CBD5E0',
  violetBg: '#F7F5FF', violetLine: '#E9E4FB', violetDeep: '#553C9A',
  redBg: '#FEE2E2', redInk: '#DC2626',
  greenBg: '#F0FBF4', greenLine: '#C6F6D5', greenInk: '#2F855A',
  onDark: '#E9E4FB', onDarkSoft: '#CBC4E8',
} as const;

const FUNNEL_BARS = ['#6B46C1', '#8B5CF6', '#A78BFA', '#C4B5FD'];

const initialsOf = (s: any, n = 2) =>
  String(s ?? '').trim().split(/\s+/)
    // "Excel + analysts" must monogram as EA, not E+ — a token that opens with
    // punctuation is a connector, not a word.
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .map((w) => w[0]).join('').slice(0, n).toUpperCase();

/* Header row for the rebuilt slides: eyebrow · provenance · slide index.
 * The design carries only eyebrow + provenance, but the eight slides still on
 * the absolute path show "NN / 11" via <Eyebrow>; dropping it from three of
 * eleven would read as a rendering bug while paging through the deck. */
const HeadRow: React.FC<{ eyebrow: any; idx: any; right?: React.ReactNode; mb?: number }> = ({
  eyebrow, idx, right, mb = 22,
}) => (
  <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: u(20), marginBottom: u(mb) }}>
    <div style={{
      fontSize: u(15), fontWeight: 800, color: K.accent,
      textTransform: 'uppercase', letterSpacing: '.12em',
    }}>{String(eyebrow ?? '')}</div>
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: u(18), minWidth: 0 }}>
      {right}
      <span style={{ flex: 'none', fontSize: u(12), fontWeight: 700, color: K.faint, letterSpacing: '.06em' }}>
        {String(idx ?? '')} / 11
      </span>
    </div>
  </div>
);

/* 1 — COVER (dark) */
// Rebuilt against the design's cover: radial violet bloom over a 120° dark
// gradient, brand row at the top, wordmark + thesis pushed to the optical
// centre by `margin-top:auto`, then the meta chips and the discovery strip.
//
// "Discovery to date" reads the discovery FUNNEL (`validation.stages`) — the
// same series the Problem slide charts. It previously read the last four points
// of `cover.signalY`, a cumulative interview count, and labelled them
// Customers / Advisors / Co-founders / Investors: four hardcoded labels over
// four numbers that were none of those things. The funnel carries its own
// labels, so the strip now says what it is showing.
const SlideCover: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const c = d.cover || {};
  const v = d.validation || {};
  const meta: Array<[string, string]> = Array.isArray(c.meta) ? c.meta : [];
  const discovery: Array<[string, number]> = (Array.isArray(v.stages) ? v.stages : []).slice(0, 4);
  return (
    <Slide16x9 bg={K.dbg} ink="#FFFFFF" font={FF}>
      <div style={{
        position: 'absolute', inset: 0, color: '#FFFFFF',
        display: 'flex', flexDirection: 'column',
        padding: `${u(72)}px ${u(80)}px`,
        background:
          `radial-gradient(${u(1100)}px ${u(460)}px at 16% -12%, rgba(139,92,246,.5), transparent 60%), `
          + `linear-gradient(120deg, ${K.dbg}, ${K.dpanel} 52%, ${K.dline})`,
      }}>
        {/* brand row */}
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: u(13) }}>
          <div style={{
            width: u(48), height: u(48), flex: 'none', borderRadius: u(13),
            background: 'rgba(255,255,255,.14)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: u(22),
          }}>{initialsOf(c.company)}</div>
          <span style={{ fontSize: u(19), fontWeight: 600, color: D.onDarkSoft }}>{String(c.company ?? '')}</span>
          <span style={{
            marginLeft: 'auto', flex: 'none', fontSize: u(14), fontWeight: 600, color: K.dfaint,
            border: '1px solid rgba(255,255,255,.22)', borderRadius: 999,
            padding: `${u(7)}px ${u(16)}px`, whiteSpace: 'nowrap',
          }}>{String(c.eyebrowRight ?? '')}</span>
        </div>

        {/* wordmark + thesis — `margin-top:auto` is what floats the block */}
        <div style={{ marginTop: 'auto' }}>
          <Editable
            as="div" value={String(c.company ?? '')} path="cover.company" editable={editable} onEdit={onEdit}
            style={{ fontSize: u(92), fontWeight: 900, letterSpacing: '-.035em', lineHeight: .98, color: '#FFFFFF' }} />
          <Editable
            as="div" value={String(c.thesis ?? '')} path="cover.thesis" editable={editable} onEdit={onEdit}
            style={{ fontSize: u(30), fontWeight: 500, lineHeight: 1.3, color: D.onDarkSoft, marginTop: u(20), maxWidth: u(900) }} />
        </div>

        {/* meta chips — sector / stage / founder / lab status */}
        {meta.length > 0 && (
          <div style={{ flex: 'none', display: 'flex', gap: u(14), marginTop: u(38) }}>
            {meta.map((m, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.13)',
                borderRadius: u(13), padding: `${u(15)}px ${u(18)}px`, minWidth: u(150),
              }}>
                <div style={{
                  fontSize: u(11), fontWeight: 700, color: K.dfaint,
                  textTransform: 'uppercase', letterSpacing: '.07em',
                }}>{String(m?.[0] ?? '')}</div>
                <div style={{ fontSize: u(19), fontWeight: 700, color: '#FFFFFF', marginTop: u(5) }}>
                  {String(m?.[1] ?? '')}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* discovery strip */}
        {discovery.length > 0 && (
          <div style={{
            flex: 'none', display: 'flex', alignItems: 'center', gap: u(22),
            marginTop: u(16), paddingTop: u(20), borderTop: '1px solid rgba(255,255,255,.12)',
          }}>
            <span style={{
              flex: 'none', fontSize: u(12), fontWeight: 700, color: K.dfaint,
              textTransform: 'uppercase', letterSpacing: '.08em',
            }}>Discovery to date</span>
            <div style={{ display: 'flex', gap: u(26), minWidth: 0 }}>
              {discovery.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: u(8) }}>
                  <span style={{ fontSize: u(26), fontWeight: 900, color: '#FFFFFF' }}>{String(s?.[1] ?? '')}</span>
                  <span style={{ fontSize: u(14), color: K.dmuted, whiteSpace: 'nowrap' }}>{String(s?.[0] ?? '')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Slide16x9>
  );
};

/* 2 — PROBLEM (+ validation evidence) */
// Rebuilt against the design's Problem slide: headline + numbered pain cards on
// the left, a "Who feels this" panel over a dark pull-quote card on the right,
// and the merged validation evidence strip along the bottom (stat block +
// funnel chips). The standalone Validation slide stays merged here and
// `validation.*` is still read in place — the field contract is unchanged, only
// its rendering is.
const SlideProblem: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const p = d.problem || {};
  const v = d.validation || {};
  const pains: Array<[string, number, string]> = Array.isArray(p.pains) ? p.pains : [];
  const stages: Array<[string, number]> = Array.isArray(v.stages) ? v.stages : [];
  const conversion: [string, string] = Array.isArray(v.conversion) ? v.conversion : ['', ''];
  // Discovery cards + the conversion rate, which carries the same
  // [value, label] shape and belongs in the same block.
  //
  // `validation.cards` and `validation.stages` overlap: the sample ships cards
  // for "42 Interviews completed" and "9 Design-partner LOIs" while the funnel
  // beside them already reads 42 → Interviewed and 9 → LOI. Printing a number
  // twice on one strip reads as two findings, and it is what pushed the strip
  // past the slide width. Cards whose value the funnel already shows are
  // dropped; with no funnel present every card survives.
  const funnelValues = new Set(stages.map((s) => String(s?.[1] ?? '')));
  const stats: Array<[string, string]> = [
    ...((Array.isArray(v.cards) ? v.cards : []) as Array<[string, string]>)
      .filter((cd) => !funnelValues.has(String(cd?.[0] ?? ''))),
    ...(conversion[0] ? [conversion] : []),
  ];
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        padding: `${u(56)}px ${u(80)}px ${u(52)}px`,
      }}>
        <HeadRow
          eyebrow={p.eyebrow} idx={p.idx}
          right={<span style={{ fontSize: u(13), fontWeight: 600, color: K.muted }}>{String(p.barsLabel ?? '')}</span>}
        />

        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: u(52) }}>
          {/* left — headline + ranked pains */}
          <div style={{ flex: '1.15', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Editable
              as="div" value={String(p.title ?? '')} path="problem.title" editable={editable} onEdit={onEdit}
              style={{
                fontSize: u(44), fontWeight: 800, letterSpacing: '-.02em',
                lineHeight: 1.12, color: K.ink, marginBottom: u(34),
              }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: u(18) }}>
              {pains.map((pn, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: u(16),
                  background: K.panel, border: `1px solid ${D.hair}`,
                  borderRadius: u(14), padding: `${u(16)}px ${u(20)}px`,
                }}>
                  <span style={{
                    width: u(30), height: u(30), flex: 'none', borderRadius: u(9),
                    background: D.redBg, color: D.redInk, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: u(15),
                  }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: u(21), lineHeight: 1.35, color: D.ink2, fontWeight: 500 }}>
                    {String(pn?.[0] ?? '')}
                  </span>
                  {/* One pill, both numbers. The design carries a single
                      "mentions" chip; the data carries a frequency AND a raw
                      count, and dropping either loses evidence off the slide. */}
                  <span style={{
                    flex: 'none', fontSize: u(13), fontWeight: 700, color: D.redInk, background: D.redBg,
                    borderRadius: 999, padding: `${u(5)}px ${u(12)}px`, whiteSpace: 'nowrap',
                  }}>
                    {[
                      pn?.[1] == null || String(pn[1]) === '' ? '' : `${pn[1]}%`,
                      pn?.[2] ? String(pn[2]) : '',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* right — who feels it, and one of them saying so */}
          <div style={{ flex: '.85', minWidth: 0, display: 'flex', flexDirection: 'column', gap: u(20) }}>
            <div style={{
              flex: 'none', background: D.violetBg, border: `1px solid ${D.violetLine}`,
              borderRadius: u(16), padding: u(24),
            }}>
              <div style={{
                fontSize: u(12), fontWeight: 800, color: K.accent,
                textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: u(9),
              }}>Who feels this</div>
              <Editable
                as="div" value={String(p.framing ?? '')} path="problem.framing" editable={editable} onEdit={onEdit}
                style={{ fontSize: u(20), lineHeight: 1.4, color: D.ink2, fontWeight: 500 }} />
            </div>

            <div style={{
              flex: 1, minHeight: 0, background: K.dbg, color: '#FFFFFF', borderRadius: u(16),
              padding: u(30), display: 'flex', flexDirection: 'column', justifyContent: 'center',
            }}>
              <div style={{ fontSize: u(66), lineHeight: 0.3, color: K.accentLt, fontWeight: 800, fontFamily: SERIF }}>
                {'“'}
              </div>
              <Editable
                as="div" value={String(p.quote ?? '')} path="problem.quote" editable={editable} onEdit={onEdit}
                style={{ fontSize: u(23), lineHeight: 1.45, fontStyle: 'italic', color: D.onDark, marginTop: u(12) }} />
              {/* The design puts a named interviewee behind a monogram here.
                  Discovery attribution is a ROLE, not a person — the field
                  reads "Head of Credit · mid-market direct lender" — so the
                  monogram carries a quote glyph rather than invented initials. */}
              <div style={{ marginTop: u(20), display: 'flex', alignItems: 'center', gap: u(11) }}>
                <div style={{
                  width: u(36), height: u(36), flex: 'none', borderRadius: '50%',
                  background: K.accent, color: '#FFFFFF', fontWeight: 700, fontSize: u(20), lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF,
                }}>{'”'}</div>
                <Editable
                  as="div" value={String(p.quoteAttr ?? '')} path="problem.quoteAttr" editable={editable} onEdit={onEdit}
                  style={{ fontSize: u(15), fontWeight: 700, color: '#FFFFFF' }} />
              </div>
            </div>
          </div>
        </div>

        {/* merged validation evidence — discovery stats + funnel */}
        {(stats.length > 0 || stages.length > 0) && (
          <div style={{
            flex: 'none', display: 'flex', alignItems: 'center', gap: u(26), overflow: 'hidden',
            marginTop: u(22), paddingTop: u(18), borderTop: `1px solid ${K.line}`,
          }}>
            <div style={{
              flex: 'none', maxWidth: u(120), fontSize: u(11.5), fontWeight: 800, color: K.accent,
              textTransform: 'uppercase', letterSpacing: '.09em', lineHeight: 1.35,
            }}>{String(v.funnelLabel ?? '')}</div>
            {/* The stat block is the ONLY flexible element in the strip: the
                funnel chips are sized by their own copy and the label is fixed,
                so a crowded strip squeezes here, where a stat label wraps to a
                second line and stays legible, instead of ellipsising a funnel
                stage down to "Sol…". */}
            <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', gap: u(24) }}>
              {stats.map((s, i) => (
                <div key={i} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: u(28), fontWeight: 900, letterSpacing: '-.02em', color: K.ink, lineHeight: 1 }}>
                    {String(s?.[0] ?? '')}
                  </div>
                  <div style={{ fontSize: u(12.5), color: K.muted, marginTop: u(3), fontWeight: 500, lineHeight: 1.25 }}>
                    {String(s?.[1] ?? '')}
                  </div>
                </div>
              ))}
            </div>
            {stages.length > 0 && (
              <div style={{
                flex: 'none', display: 'flex', alignItems: 'center',
                justifyContent: 'flex-end', gap: u(9),
              }}>
                {stages.map((st, i) => (
                  <React.Fragment key={i}>
                    <div style={{
                      flex: 'none', minWidth: u(74), textAlign: 'center',
                      background: K.panel, border: `1px solid ${D.hair}`,
                      borderRadius: u(11), padding: `${u(9)}px ${u(13)}px`,
                    }}>
                      <div style={{
                        fontSize: u(19), fontWeight: 900, lineHeight: 1,
                        color: FUNNEL_BARS[Math.min(i, FUNNEL_BARS.length - 1)],
                      }}>{String(st?.[1] ?? '')}</div>
                      <div style={{
                        fontSize: u(10.5), color: K.muted, marginTop: u(3), fontWeight: 600, lineHeight: 1.2,
                        whiteSpace: 'nowrap',
                      }}>{String(st?.[0] ?? '')}</div>
                    </div>
                    {i < stages.length - 1 && (
                      <div style={{ flex: 'none', color: D.arrow, fontSize: u(15) }}>{'→'}</div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        )}
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 5 — MARKET */
// Rebuilt against the design: a dominant gradient TAM card beside SAM and SOM,
// then the why-now panel and the assumptions note. The design's lower-left
// panel charts segment share; this data carries no segment split, so that slot
// holds `market.why` — the three why-now claims, which is what the deck
// actually has to argue with.
const SlideMarket: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const m = d.market || {};
  const rings: Array<[string, string, string]> = Array.isArray(m.rings) ? m.rings : [];
  const why: Array<[string, string]> = Array.isArray(m.why) ? m.why : [];
  const [tam, sam, som] = [rings[0], rings[1], rings[2]];
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        padding: `${u(68)}px ${u(80)}px ${u(60)}px`,
      }}>
        <HeadRow
          eyebrow={m.eyebrow} idx={m.idx} mb={30}
          right={(
            <Editable
              as="span" value={String(m.title ?? '')} path="market.title" editable={editable} onEdit={onEdit}
              style={{ fontSize: u(13), fontWeight: 600, color: K.muted }} />
          )}
        />

        {/* TAM dominant, SAM and SOM beside it */}
        <div style={{ flex: 'none', display: 'flex', gap: u(16), alignItems: 'stretch', marginBottom: u(20) }}>
          <div style={{
            flex: '1.5', minWidth: 0, borderRadius: u(18), padding: `${u(26)}px ${u(30)}px`, color: '#FFFFFF',
            background: `linear-gradient(135deg, ${K.accent}, ${D.violetDeep})`,
          }}>
            <div style={{ fontSize: u(13), fontWeight: 800, letterSpacing: '.06em', color: '#E9D5FF' }}>
              {String(tam?.[0] ?? '')} · TOTAL ADDRESSABLE
            </div>
            <div style={{ fontSize: u(66), fontWeight: 900, letterSpacing: '-.03em', marginTop: u(6), lineHeight: 1 }}>
              {String(tam?.[1] ?? '')}
            </div>
            <div style={{ fontSize: u(16), color: '#E9D5FF', marginTop: u(2) }}>{String(tam?.[2] ?? '')}</div>
          </div>
          {[sam, som].map((r, i) => (
            <div key={i} style={{
              flex: 1, minWidth: 0, borderRadius: u(18), padding: `${u(24)}px ${u(26)}px`,
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              background: i === 0 ? '#F5F3FF' : K.panel,
              border: `1px solid ${i === 0 ? D.violetLine : K.line}`,
            }}>
              <div style={{
                fontSize: u(12), fontWeight: 800, letterSpacing: '.05em',
                color: i === 0 ? K.accentLt : K.faint,
              }}>{String(r?.[0] ?? '')} · {i === 0 ? 'SERVICEABLE AVAILABLE' : 'OBTAINABLE'}</div>
              <div style={{
                fontSize: u(i === 0 ? 46 : 40), fontWeight: 900, letterSpacing: '-.02em', lineHeight: 1,
                marginTop: u(4), color: i === 0 ? D.violetDeep : K.body,
              }}>{String(r?.[1] ?? '')}</div>
              <div style={{ fontSize: u(14), color: K.muted, marginTop: u(2) }}>{String(r?.[2] ?? '')}</div>
            </div>
          ))}
        </div>

        {/* why now + assumptions */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: u(20) }}>
          <div style={{
            flex: '1.6', minWidth: 0, background: K.white, border: `1px solid ${K.line}`,
            borderRadius: u(16), padding: `${u(22)}px ${u(26)}px`, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              flex: 'none', fontSize: u(13), fontWeight: 800, color: K.muted,
              textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: u(16),
            }}>{String(m.whyNowLabel ?? '')}</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: u(14), justifyContent: 'center' }}>
              {why.map((w, i) => (
                <div key={i} style={{ display: 'flex', gap: u(14), alignItems: 'flex-start' }}>
                  <span style={{
                    flex: 'none', width: u(26), height: u(26), borderRadius: u(8),
                    background: K.accentSoft, color: K.accent, fontWeight: 800, fontSize: u(13),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: u(16), fontWeight: 700, color: K.ink }}>{String(w?.[0] ?? '')}</div>
                    <div style={{ fontSize: u(13.5), color: K.muted, lineHeight: 1.45, marginTop: u(2) }}>
                      {String(w?.[1] ?? '')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{
            flex: 1, minWidth: 0, background: K.panel, border: `1px solid ${K.line}`,
            borderRadius: u(16), padding: `${u(22)}px ${u(24)}px`, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              fontSize: u(13), fontWeight: 800, color: K.muted,
              textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: u(12),
            }}>How this is sized</div>
            <Editable
              as="div" value={String(m.assumptions ?? '')} path="market.assumptions" editable={editable} onEdit={onEdit}
              style={{ fontSize: u(13), color: K.muted, lineHeight: 1.5, flex: 1 }} />
          </div>
        </div>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 3 — SOLUTION */
// Rebuilt against the design: headline plus ticked capability list on the left,
// a panel on the right. The design's right panel is a Before/After pair; this
// data has no before/after, so it holds `solution.outcomes` — the measurable
// results, which is the same claim expressed as numbers.
const SlideSolution: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const s = d.solution || {};
  const steps: Array<[string, string, string]> = Array.isArray(s.steps) ? s.steps : [];
  const outcomes: Array<[string, string]> = Array.isArray(s.outcomes) ? s.outcomes : [];
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        padding: `${u(64)}px ${u(80)}px ${u(56)}px`,
      }}>
        <HeadRow eyebrow={s.eyebrow} idx={s.idx} mb={26} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: u(52) }}>
          <div style={{ flex: '1.1', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Editable
              as="div" value={String(s.title ?? '')} path="solution.title" editable={editable} onEdit={onEdit}
              style={{
                fontSize: u(44), fontWeight: 800, letterSpacing: '-.02em',
                lineHeight: 1.12, color: K.ink, marginBottom: u(32),
              }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: u(18), justifyContent: 'center' }}>
              {steps.map((st, i) => (
                <div key={i} style={{ display: 'flex', gap: u(15), alignItems: 'flex-start' }}>
                  <span style={{
                    width: u(30), height: u(30), flex: 'none', borderRadius: u(9),
                    background: D.greenBg, color: K.done, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: u(16),
                  }}>✓</span>
                  <span style={{ fontSize: u(21), lineHeight: 1.38, color: D.ink2, fontWeight: 500, minWidth: 0 }}>
                    <strong style={{ color: K.ink, fontWeight: 700 }}>{String(st?.[1] ?? '')}</strong>
                    {st?.[2] ? ` — ${st[2]}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            flex: '.85', minWidth: 0, alignSelf: 'center', background: K.panel,
            border: `1px solid ${K.line}`, borderRadius: u(18), overflow: 'hidden',
          }}>
            <div style={{
              padding: `${u(18)}px ${u(30)}px`, background: D.violetBg, borderBottom: `1px solid ${D.violetLine}`,
              fontSize: u(12), fontWeight: 800, color: K.accent,
              textTransform: 'uppercase', letterSpacing: '.08em',
            }}>{String(s.outcomeLabel ?? '')}</div>
            {outcomes.map((o, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'baseline', gap: u(16),
                padding: `${u(22)}px ${u(30)}px`,
                borderTop: i ? `1px solid ${D.hair}` : 'none',
              }}>
                <span style={{
                  flex: 'none', fontSize: u(34), fontWeight: 900, letterSpacing: '-.02em',
                  color: K.accent, lineHeight: 1,
                }}>{String(o?.[0] ?? '')}</span>
                <span style={{ fontSize: u(17), color: D.ink2, lineHeight: 1.3, minWidth: 0 }}>
                  {String(o?.[1] ?? '')}
                </span>
              </div>
            ))}
          </div>
        </div>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 8 — ROADMAP */
// Rebuilt against the design: three phase columns, each tinted by its own
// state, with per-task checkboxes — done tasks struck through, upcoming ones
// hollow. The design prints a "N% complete" figure in the header; it is derived
// here from the task flags on this slide rather than stored separately, so the
// headline number and the checkboxes underneath it cannot disagree.
const SlideRoadmap: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const r = d.roadmap || {};
  const phases: Array<[string, string, Array<[Status, string]>]> = Array.isArray(r.phases) ? r.phases : [];
  const tasks = phases.flatMap((p) => (Array.isArray(p?.[2]) ? p[2] : []));
  const done = tasks.filter((t) => t?.[0] === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  // Phase tone follows the phase's own tasks: everything checked reads as
  // complete, anything in flight reads as active, otherwise upcoming.
  const toneFor = (ts: Array<[Status, string]>) => {
    if (ts.length && ts.every((t) => t?.[0] === 'done')) {
      return { bg: D.greenBg, border: D.greenLine, chip: D.greenLine, ink: D.greenInk, status: 'Completed' };
    }
    if (ts.some((t) => t?.[0] === 'active' || t?.[0] === 'done')) {
      return { bg: D.violetBg, border: D.violetLine, chip: K.accentSoft, ink: K.accent, status: 'In progress' };
    }
    return { bg: K.panel, border: K.line, chip: D.hair, ink: K.faint, status: 'Upcoming' };
  };

  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        padding: `${u(60)}px ${u(80)}px ${u(56)}px`,
      }}>
        <HeadRow
          eyebrow={r.eyebrow} idx={r.idx} mb={8}
          right={(
            <span style={{ fontSize: u(14), fontWeight: 600, color: K.muted }}>
              {tasks.length ? `${pct}% complete` : ''}
            </span>
          )}
        />
        <Editable
          as="div" value={String(r.title ?? '')} path="roadmap.title" editable={editable} onEdit={onEdit}
          style={{ flex: 'none', fontSize: u(34), fontWeight: 800, letterSpacing: '-.02em', color: K.ink, marginBottom: u(26) }} />

        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: u(18) }}>
          {phases.map((p, i) => {
            const ts: Array<[Status, string]> = Array.isArray(p?.[2]) ? p[2] : [];
            const tone = toneFor(ts);
            return (
              <div key={i} style={{
                flex: 1, minWidth: 0, background: tone.bg, border: `1px solid ${tone.border}`,
                borderRadius: u(16), padding: u(22), display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: u(10), marginBottom: u(6) }}>
                  <span style={{
                    width: u(30), height: u(30), flex: 'none', borderRadius: u(9),
                    background: tone.chip, color: tone.ink, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: u(14),
                  }}>{i + 1}</span>
                  <span style={{
                    fontSize: u(12), fontWeight: 800, color: tone.ink,
                    textTransform: 'uppercase', letterSpacing: '.05em',
                  }}>{tone.status}</span>
                </div>
                <div style={{ fontSize: u(21), fontWeight: 800, color: K.ink, marginBottom: u(4) }}>
                  {String(p?.[0] ?? '')}
                </div>
                <div style={{ fontSize: u(13.5), color: K.muted, marginBottom: u(16) }}>{String(p?.[1] ?? '')}</div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: u(9), justifyContent: 'center' }}>
                  {ts.map((t, j) => {
                    const isDone = t?.[0] === 'done';
                    // The design's checkbox is binary, done or not. The data
                    // carries a third state — in flight — and collapsing it into
                    // "not started" loses the only signal on this slide that
                    // says which task is being worked on right now.
                    const isActive = t?.[0] === 'active';
                    return (
                      <div key={j} style={{ display: 'flex', gap: u(10), alignItems: 'flex-start' }}>
                        <span style={{
                          width: u(19), height: u(19), flex: 'none', marginTop: u(1), borderRadius: u(6),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: u(12), fontWeight: 800, lineHeight: 1,
                          ...(isDone
                            ? { background: K.done, color: '#FFFFFF' }
                            : isActive
                              ? { background: '#FFFAF0', border: `1.5px solid ${K.active}`, color: K.active }
                              : { background: K.white, border: `1.5px solid ${D.arrow}`, color: D.arrow }),
                        }}>{isDone ? '✓' : isActive ? '◆' : '–'}</span>
                        <span style={{
                          fontSize: u(15), lineHeight: 1.35, minWidth: 0,
                          color: isDone ? K.faint : isActive ? K.ink : D.ink2,
                          fontWeight: isActive ? 600 : undefined,
                          textDecoration: isDone ? 'line-through' : undefined,
                        }}>{String(t?.[1] ?? '')}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 9 — TEAM & NETWORK */
// Rebuilt against the design: founder cards over advisor chips on the left, a
// dark panel on the right. The design's dark panel charts a skills assessment;
// this data carries no skills scores, so it holds `team.nodes` — the operating
// network the slide's title is actually about.
const SlideTeamNetwork: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const t = d.team || {};
  const founders: Array<any> = Array.isArray(t.founders) && t.founders.length
    ? t.founders
    : (t.founder ? [t.founder] : []);
  const advisors: Array<[string, string, string, string?]> = Array.isArray(t.advisors) ? t.advisors : [];
  const nodes: Array<[number, number, string, string]> = Array.isArray(t.nodes) ? t.nodes : [];
  const AV = [[K.accentSoft, K.accent], ['#DBEAFE', '#1D4ED8']];
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        padding: `${u(68)}px ${u(80)}px ${u(60)}px`,
      }}>
        <HeadRow
          eyebrow={t.eyebrow} idx={t.idx} mb={28}
          right={(
            <Editable
              as="span" value={String(t.title ?? '')} path="team.title" editable={editable} onEdit={onEdit}
              style={{ fontSize: u(13), fontWeight: 600, color: K.muted }} />
          )}
        />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: u(24) }}>
          <div style={{ flex: '1.15', minWidth: 0, display: 'flex', flexDirection: 'column', gap: u(16) }}>
            <div style={{ flex: 'none', display: 'flex', gap: u(16) }}>
              {founders.map((f, i) => (
                <div key={i} style={{
                  flex: 1, minWidth: 0, background: K.panel, border: `1px solid ${K.line}`,
                  borderRadius: u(16), padding: u(22), display: 'flex', flexDirection: 'column',
                  alignItems: 'center', textAlign: 'center',
                }}>
                  <div style={{
                    width: u(72), height: u(72), borderRadius: '50%', overflow: 'hidden',
                    background: AV[i % 2][0], color: AV[i % 2][1], fontWeight: 800, fontSize: u(24),
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: u(13),
                  }}>
                    {f?.photo
                      ? <img src={f.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      : (f?.initials || initialsOf(f?.name))}
                  </div>
                  <div style={{ fontSize: u(21), fontWeight: 800, color: K.ink }}>{String(f?.name ?? '')}</div>
                  <div style={{ fontSize: u(15), color: K.accent, fontWeight: 600, marginTop: u(2) }}>
                    {String(f?.role ?? '')}
                  </div>
                  <div style={{ fontSize: u(14), color: K.muted, marginTop: u(9), lineHeight: 1.4 }}>
                    {String(f?.bio ?? '')}
                  </div>
                </div>
              ))}
            </div>
            <div style={{
              flex: 'none', fontSize: u(12), fontWeight: 800, color: K.muted,
              textTransform: 'uppercase', letterSpacing: '.08em',
            }}>{String(t.advisorsLabel ?? '')}</div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', gap: u(12), alignContent: 'flex-start' }}>
              {advisors.map((a, i) => (
                <div key={i} style={{
                  flex: '1 1 44%', minWidth: 0, background: K.white, border: `1px solid ${K.line}`,
                  borderRadius: u(12), padding: `${u(14)}px ${u(16)}px`,
                  display: 'flex', alignItems: 'center', gap: u(12),
                }}>
                  <div style={{
                    width: u(40), height: u(40), flex: 'none', borderRadius: '50%', overflow: 'hidden',
                    background: D.violetBg, color: K.accent, fontWeight: 700, fontSize: u(14),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {a?.[3]
                      ? <img src={a[3]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      : String(a?.[0] ?? '')}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: u(7) }}>
                      <span style={{ fontSize: u(16), fontWeight: 700, color: K.ink }}>{String(a?.[1] ?? '')}</span>
                    </div>
                    <div style={{ fontSize: u(13.5), color: K.muted, marginTop: u(2) }}>{String(a?.[2] ?? '')}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            flex: '.85', minWidth: 0, background: K.dbg, color: '#FFFFFF', borderRadius: u(18),
            padding: `${u(26)}px ${u(28)}px`, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              fontSize: u(13), fontWeight: 800, color: K.dmuted,
              textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: u(4),
              marginBottom: u(20),
            }}>Operating network</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: u(16), justifyContent: 'center' }}>
              {nodes.map((n, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u(13) }}>
                  <span style={{
                    width: u(10), height: u(10), flex: 'none', borderRadius: '50%',
                    background: i === 0 ? K.accentLt : K.accentMid,
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: u(15), fontWeight: 600, color: D.onDark }}>{String(n?.[2] ?? '')}</div>
                    <div style={{ fontSize: u(13), color: K.dfaint, marginTop: u(1) }}>{String(n?.[3] ?? '')}</div>
                  </div>
                </div>
              ))}
            </div>
            {t.centerName && (
              <div style={{
                borderTop: '1px solid rgba(255,255,255,.14)', paddingTop: u(14), marginTop: u(6),
                fontSize: u(13), color: K.dmuted,
              }}>
                Centred on <span style={{ color: '#FFFFFF', fontWeight: 600 }}>{String(t.centerName)}</span>
              </div>
            )}
          </div>
        </div>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 10 — ASK (+ cap table) */
// Rebuilt against the design: the raise as the hero with the supporting terms
// in dark chips, use-of-funds as a stacked bar over its breakdown on the left,
// and the merged cap table — donut, legend, entity checklist — on the right.
// `captable.*` is still read in place; the field contract is unchanged.
const SlideAsk: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const a = d.ask || {};
  const ct = d.captable || {};
  const kpis: Array<[string, string]> = Array.isArray(a.kpis) ? a.kpis : [];
  const funds: Array<[string, number]> = Array.isArray(a.funds) ? a.funds : [];
  const segments: Array<[string, number]> = Array.isArray(ct.segments) ? ct.segments : [];
  const items: Array<[string, Status]> = Array.isArray(ct.items) ? ct.items : [];
  const milestone: [string, string] = Array.isArray(a.milestone) ? a.milestone : ['', ''];
  const UF = [K.accent, K.accentLt, K.accentMid, D.violetLine];
  const SEG = [K.accent, K.accentLt, K.accentMid, D.violetLine];

  // conic-gradient stops, so the donut cannot drift from its legend.
  const total = segments.reduce((sum, s) => sum + (Number(s?.[1]) || 0), 0) || 1;
  let acc = 0;
  const stops = segments.map((s, i) => {
    const from = (acc / total) * 100;
    acc += Number(s?.[1]) || 0;
    return `${SEG[i % SEG.length]} ${from}% ${(acc / total) * 100}%`;
  });
  const doneCount = items.filter((it) => it?.[1] === 'done').length;

  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        padding: `${u(60)}px ${u(80)}px ${u(56)}px`,
      }}>
        <div style={{
          flex: 'none', display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-end', gap: u(24), marginBottom: u(28),
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: u(15), fontWeight: 800, color: K.accent,
              textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: u(10),
            }}>{String(a.eyebrow ?? '')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: u(16), flexWrap: 'wrap' }}>
              <span style={{
                fontSize: u(88), fontWeight: 900, letterSpacing: '-.03em', color: K.accent, lineHeight: .9,
              }}>{String(kpis[0]?.[0] ?? '')}</span>
              <span style={{ fontSize: u(24), color: K.muted, fontWeight: 600 }}>{String(kpis[0]?.[1] ?? '')}</span>
            </div>
          </div>
          <div style={{ flex: 'none', display: 'flex', gap: u(12), alignItems: 'flex-end' }}>
            {kpis.slice(1).map((k, i) => (
              <div key={i} style={{ background: K.dbg, color: '#FFFFFF', borderRadius: u(14), padding: `${u(16)}px ${u(22)}px` }}>
                <div style={{ fontSize: u(13), color: K.dfaint, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {String(k?.[1] ?? '')}
                </div>
                <div style={{ fontSize: u(28), fontWeight: 800, marginTop: u(3) }}>{String(k?.[0] ?? '')}</div>
              </div>
            ))}
            <span style={{ fontSize: u(12), fontWeight: 700, color: K.faint, letterSpacing: '.06em', paddingBottom: u(6) }}>
              {String(a.idx ?? '')} / 11
            </span>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: u(26) }}>
          {/* use of funds */}
          <div style={{ flex: '1.35', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{
              flex: 'none', fontSize: u(12.5), fontWeight: 800, color: K.muted,
              textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: u(11),
            }}>{String(a.useLabel ?? '')}</div>
            <div style={{ flex: 'none', display: 'flex', height: u(20), borderRadius: u(7), overflow: 'hidden', marginBottom: u(14) }}>
              {funds.map((f, i) => (
                <div key={i} style={{ width: `${Number(f?.[1]) || 0}%`, background: UF[i % UF.length] }} />
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: u(10) }}>
              {funds.map((f, i) => (
                <div key={i} style={{
                  flex: 1, minHeight: 0, background: K.panel, border: `1px solid ${K.line}`,
                  borderRadius: u(14), padding: `${u(14)}px ${u(18)}px`,
                  display: 'flex', alignItems: 'center', gap: u(16),
                }}>
                  <span style={{ flex: 'none', width: u(11), height: u(11), borderRadius: u(3), background: UF[i % UF.length] }} />
                  <span style={{
                    flex: 'none', minWidth: u(66), fontSize: u(28), fontWeight: 900, color: K.ink, lineHeight: 1,
                  }}>{Number(f?.[1]) || 0}%</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: u(16), fontWeight: 700, color: D.ink2 }}>
                    {String(f?.[0] ?? '')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* merged cap table */}
          <div style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
            paddingLeft: u(26), borderLeft: `1px solid ${K.line}`,
          }}>
            <div style={{
              flex: 'none', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: u(10), marginBottom: u(11),
            }}>
              <span style={{
                fontSize: u(12.5), fontWeight: 800, color: K.muted,
                textTransform: 'uppercase', letterSpacing: '.08em',
              }}>{String(ct.donutLabel ?? '')}</span>
              <span style={{ fontSize: u(11.5), color: K.faint, fontWeight: 600 }}>{String(ct.centerSmall ?? '')}</span>
            </div>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: u(18), marginBottom: u(14) }}>
              <div style={{
                flex: 'none', width: u(104), height: u(104), borderRadius: '50%',
                background: stops.length ? `conic-gradient(${stops.join(',')})` : K.panel2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: u(64), height: u(64), borderRadius: '50%', background: K.white,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: u(20), fontWeight: 900, color: K.ink, lineHeight: 1.15 }}>
                    {String(ct.centerBig ?? '')}
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: u(7) }}>
                {segments.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u(8), fontSize: u(13) }}>
                    <span style={{ flex: 'none', width: u(11), height: u(11), borderRadius: u(3), background: SEG[i % SEG.length] }} />
                    <span style={{ color: D.ink2, minWidth: 0 }}>
                      {String(s?.[0] ?? '')} · <strong style={{ color: K.accent }}>{Number(s?.[1]) || 0}%</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{
              flex: 1, minHeight: 0, background: K.panel, border: `1px solid ${K.line}`,
              borderRadius: u(13), padding: `${u(14)}px ${u(16)}px`, display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: u(9),
              }}>
                <span style={{
                  fontSize: u(10.5), fontWeight: 800, color: K.muted,
                  textTransform: 'uppercase', letterSpacing: '.08em',
                }}>{String(ct.checklistLabel ?? '')}</span>
                {items.length > 0 && (
                  <span style={{ fontSize: u(11), fontWeight: 700, color: K.done }}>
                    {doneCount} of {items.length} complete
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: u(6), justifyContent: 'center' }}>
                {items.map((it, i) => {
                  const isDone = it?.[1] === 'done';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u(9) }}>
                      <span style={{
                        width: u(15), height: u(15), flex: 'none', borderRadius: u(5),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: u(10), fontWeight: 800, lineHeight: 1,
                        background: isDone ? K.done : '#FFFAF0',
                        color: isDone ? '#FFFFFF' : K.active,
                        border: isDone ? 'none' : '1px solid #FEEBC8',
                      }}>{isDone ? '✓' : '·'}</span>
                      <span style={{ fontSize: u(12.5), color: isDone ? K.muted : D.ink2, minWidth: 0 }}>
                        {String(it?.[0] ?? '')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {milestone[1] && (
              <div style={{
                flex: 'none', background: D.violetBg, border: `1px solid ${D.violetLine}`,
                borderRadius: u(13), padding: `${u(14)}px ${u(16)}px`, marginTop: u(14),
              }}>
                <div style={{
                  fontSize: u(10.5), fontWeight: 800, color: K.accent,
                  textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: u(6),
                }}>{String(milestone[0] ?? '')}</div>
                <div style={{ fontSize: u(13), color: K.body, lineHeight: 1.5 }}>{String(milestone[1])}</div>
              </div>
            )}
          </div>
        </div>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 6 — COMPETITIVE */
// Rebuilt against the design: the landscape table on the left, the gradient
// wedge card and whitespace callout stacked on the right. The design's table
// carries a market-share column with a bar; this data has no share figure per
// competitor, so the table runs four columns rather than inventing a fifth.
const SlideCompetitive: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const cp = d.competitive || {};
  const rows: Array<[string, string, string, string]> = Array.isArray(cp.competitors) ? cp.competitors : [];
  const edges: string[] = Array.isArray(cp.edges) ? cp.edges : [];
  const CAT_TONE: Record<string, { bg: string; ink: string }> = {
    Direct: { bg: '#FFF5F5', ink: '#C53030' },
    Indirect: { bg: '#FFFAF0', ink: '#B45309' },
    Incumbent: { bg: '#FFFAF0', ink: '#B45309' },
    Adjacent: { bg: K.panel, ink: K.muted },
  };
  const AV = [[K.accentSoft, K.accent], ['#DBEAFE', '#1D4ED8'], ['#FEF3C7', '#B45309'], [D.redBg, '#C53030']];
  const GRID = '1.35fr .85fr .7fr 1.9fr';
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        padding: `${u(68)}px ${u(80)}px ${u(60)}px`,
      }}>
        <HeadRow
          eyebrow={cp.eyebrow} idx={cp.idx} mb={26}
          right={<span style={{ fontSize: u(13), fontWeight: 600, color: K.muted }}>{String(cp.tableLabel ?? '')}</span>}
        />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: u(20) }}>
          <div style={{
            flex: '1.9', minWidth: 0, background: K.white, border: `1px solid ${K.line}`,
            borderRadius: u(16), overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: GRID, background: K.panel,
              borderBottom: `1px solid ${K.line}`, flex: 'none',
            }}>
              {['Player', 'Category', 'Stage', 'Where they fall short'].map((h, i) => (
                <div key={i} style={{
                  padding: `${u(13)}px ${i === 0 ? u(20) : u(10)}px`, fontSize: u(11.5), fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: '.07em', color: K.faint,
                }}>{h}</div>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {rows.map((r, i) => {
                const tone = CAT_TONE[String(r?.[1] ?? '')] || CAT_TONE.Adjacent;
                const av = AV[i % AV.length];
                return (
                  <div key={i} style={{
                    flex: 1, display: 'grid', gridTemplateColumns: GRID, alignItems: 'center',
                    borderBottom: i < rows.length - 1 ? `1px solid ${K.panel2}` : 'none',
                    background: i % 2 ? K.panel : K.white,
                  }}>
                    <div style={{ padding: `${u(14)}px ${u(20)}px`, display: 'flex', alignItems: 'center', gap: u(11), minWidth: 0 }}>
                      <div style={{
                        width: u(32), height: u(32), flex: 'none', borderRadius: u(9),
                        background: av[0], color: av[1], display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: u(12.5), fontWeight: 800,
                      }}>{initialsOf(r?.[0])}</div>
                      <span style={{ fontSize: u(15), fontWeight: 700, color: K.ink, minWidth: 0 }}>
                        {String(r?.[0] ?? '')}
                      </span>
                    </div>
                    <div style={{ padding: `${u(14)}px ${u(10)}px` }}>
                      <span style={{
                        fontSize: u(12), fontWeight: 800, padding: `${u(4)}px ${u(10)}px`,
                        borderRadius: 999, background: tone.bg, color: tone.ink, whiteSpace: 'nowrap',
                      }}>{String(r?.[1] ?? '')}</span>
                    </div>
                    <div style={{ padding: `${u(14)}px ${u(10)}px`, fontSize: u(13), color: K.muted }}>
                      {String(r?.[2] ?? '')}
                    </div>
                    <div style={{ padding: `${u(14)}px ${u(20)}px ${u(14)}px ${u(10)}px`, fontSize: u(13), color: K.muted, lineHeight: 1.45 }}>
                      {String(r?.[3] ?? '')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: u(14) }}>
            <div style={{
              flex: 1, minHeight: 0, borderRadius: u(16), padding: `${u(22)}px ${u(24)}px`, color: '#FFFFFF',
              background: `linear-gradient(135deg, ${K.accent}, ${D.violetDeep})`,
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                fontSize: u(11.5), fontWeight: 800, letterSpacing: '.07em',
                textTransform: 'uppercase', color: '#E9D5FF', marginBottom: u(14),
              }}>{String(cp.edgeLabel ?? '')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: u(12), flex: 1, justifyContent: 'center' }}>
                {edges.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: u(10), alignItems: 'flex-start' }}>
                    <span style={{ flex: 'none', color: K.accentMid, fontSize: u(15), lineHeight: 1.4, fontWeight: 800 }}>✓</span>
                    <span style={{ fontSize: u(14), color: '#E9D5FF', lineHeight: 1.45, minWidth: 0 }}>{String(e)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{
              flex: 'none', background: K.panel, border: `1px solid ${K.line}`,
              borderRadius: u(16), padding: `${u(16)}px ${u(20)}px`,
            }}>
              <div style={{
                fontSize: u(11.5), fontWeight: 800, letterSpacing: '.06em',
                textTransform: 'uppercase', color: K.faint, marginBottom: u(6),
              }}>Whitespace</div>
              <Editable
                as="div" value={String(cp.whitespace ?? '')} path="competitive.whitespace" editable={editable} onEdit={onEdit}
                style={{ fontSize: u(13.5), color: K.body, lineHeight: 1.5 }} />
            </div>
          </div>
        </div>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 7 — TRACTION */
// Rebuilt against the design's Traction slide: a KPI card row, the monthly
// revenue column chart in a bordered card on the left, revenue-mix bars and the
// takeaway callout stacked on the right.
//
// The design draws four KPIs — MRR, paying customers, average contract, MoM
// growth. Only two of those exist in the data: `SpinoutDeckData['traction']`
// (cloudflare-worker/src/services/decks/spinoutDeckData.ts) carries mrr, growth,
// the trend series and the mix, and nothing else. Rather than print two
// invented numbers, the row renders the KPIs that have a source, plus the span
// of the trend series itself — derived from data already on the slide. Cards
// that have no value are dropped, so the row narrows instead of showing blanks.
const SlideTraction: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const tr = d.traction || {};
  const trendY: number[] = (Array.isArray(tr.trendY) ? tr.trendY : []).map((n: any) => Number(n) || 0);
  const trendX: string[] = Array.isArray(tr.trendX) ? tr.trendX : [];
  const trendLabels: string[] = Array.isArray(tr.trendLabels) ? tr.trendLabels : [];
  const mix: Array<[string, string, number]> = Array.isArray(tr.mix) ? tr.mix : [];

  // Design: h = 20 + (value / max) * 168, in design px.
  const tMax = Math.max(1, ...trendY);
  const barH = (n: number) => u(20) + (Math.max(0, n) / tMax) * u(168);
  // Last month is the accent, the one before it the light violet, the rest the
  // mid tint — so the eye lands on the current month without a legend.
  const barTone = (i: number, n: number) =>
    (i === n - 1 ? K.accent : i === n - 2 ? K.accentLt : K.accentMid);

  const KPI_TONES = [
    { bg: D.violetBg, border: D.violetLine, ink: D.violetDeep, label: K.accentLt },
    { bg: K.white, border: K.line, ink: K.ink, label: K.faint },
    { bg: D.greenBg, border: D.greenLine, ink: D.greenInk, label: K.done },
  ];
  const kpis: Array<{ label: string; value: string; note: string }> = [];
  if (tr.mrr) kpis.push({ label: String(tr.mrrLabel || 'MRR'), value: String(tr.mrr), note: 'Recurring, verified' });
  if (trendX.length) {
    kpis.push({
      label: 'Tracked',
      value: `${trendX.length} mo`,
      note: trendX.length > 1 ? `${trendX[0]} – ${trendX[trendX.length - 1]}` : String(trendX[0] ?? ''),
    });
  }
  if (tr.growth) kpis.push({ label: 'MoM growth', value: String(tr.growth), note: String(tr.growthNote || '') });

  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        padding: `${u(68)}px ${u(80)}px ${u(60)}px`,
      }}>
        {/* The design has no headline on this slide; `traction.title` is an
            editable field the deck editor exposes, and it reads as the summary
            line the design puts in the header's right slot. */}
        <HeadRow
          eyebrow={tr.eyebrow} idx={tr.idx} mb={26}
          right={(
            <Editable
              as="span" value={String(tr.title ?? '')} path="traction.title" editable={editable} onEdit={onEdit}
              style={{ fontSize: u(13), fontWeight: 600, color: K.muted }} />
          )}
        />

        {kpis.length > 0 && (
          <div style={{ flex: 'none', display: 'flex', gap: u(16), marginBottom: u(22) }}>
            {kpis.map((k, i) => {
              const tone = KPI_TONES[Math.min(i, KPI_TONES.length - 1)];
              return (
                <div key={i} style={{
                  flex: 1, minWidth: 0, background: tone.bg, border: `1px solid ${tone.border}`,
                  borderRadius: u(16), padding: `${u(20)}px ${u(24)}px`,
                }}>
                  <div style={{
                    fontSize: u(12), fontWeight: 800, letterSpacing: '.05em',
                    textTransform: 'uppercase', color: tone.label,
                  }}>{k.label}</div>
                  <div style={{
                    fontSize: u(40), fontWeight: 900, letterSpacing: '-.03em',
                    lineHeight: 1.05, marginTop: u(6), color: tone.ink,
                  }}>{k.value}</div>
                  <div style={{ fontSize: u(13), color: K.muted, marginTop: u(3) }}>{k.note}</div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: u(20) }}>
          {/* left — monthly revenue column chart */}
          <div style={{
            flex: '1.65', minWidth: 0, background: K.white, border: `1px solid ${K.line}`,
            borderRadius: u(16), padding: `${u(22)}px ${u(26)}px`, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              flex: 'none', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', gap: u(12), marginBottom: u(18),
            }}>
              <span style={{
                fontSize: u(13), fontWeight: 800, color: K.muted,
                textTransform: 'uppercase', letterSpacing: '.08em',
              }}>{String(tr.trendLabel ?? '')}</span>
              <span style={{ flex: 'none', fontSize: u(12), color: K.faint }}>Verified · logged in Revenue</span>
            </div>
            <div style={{
              flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-end',
              gap: u(16), paddingBottom: u(4),
            }}>
              {trendY.map((n, i) => (
                <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u(8) }}>
                  <div style={{ fontSize: u(14), fontWeight: 800, color: i === trendY.length - 1 ? D.violetDeep : K.muted }}>
                    {String(trendLabels[i] ?? '')}
                  </div>
                  <div style={{
                    width: '100%', height: barH(n),
                    borderRadius: `${u(10)}px ${u(10)}px ${u(4)}px ${u(4)}px`,
                    background: barTone(i, trendY.length),
                  }} />
                  <div style={{ fontSize: u(12.5), fontWeight: 600, color: K.muted }}>{String(trendX[i] ?? '')}</div>
                </div>
              ))}
            </div>
          </div>

          {/* right — revenue mix over the takeaway */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: u(14) }}>
            <div style={{
              flex: 1, minHeight: 0, background: K.panel, border: `1px solid ${K.line}`,
              borderRadius: u(16), padding: `${u(20)}px ${u(22)}px`, display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                flex: 'none', fontSize: u(13), fontWeight: 800, color: K.muted,
                textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: u(14),
              }}>{String(tr.mixLabel ?? '')}</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: u(12), justifyContent: 'center' }}>
                {mix.map((mx, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: u(10), marginBottom: u(5) }}>
                      <span style={{ fontSize: u(14), fontWeight: 600, color: D.ink2, minWidth: 0 }}>
                        {String(mx?.[0] ?? '')}
                      </span>
                      <span style={{ flex: 'none', fontSize: u(14), fontWeight: 800, color: K.ink }}>
                        {String(mx?.[1] ?? '')}
                      </span>
                    </div>
                    <div style={{ height: u(9), borderRadius: 999, background: K.panel2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.max(0, Math.min(100, Number(mx?.[2]) || 0))}%`,
                        borderRadius: 999,
                        background: FUNNEL_BARS[Math.min(i, 2)],
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{
              flex: 'none', background: D.violetBg, border: `1px solid ${D.violetLine}`,
              borderRadius: u(16), padding: `${u(16)}px ${u(20)}px`,
            }}>
              <div style={{
                fontSize: u(11.5), fontWeight: 800, letterSpacing: '.06em',
                textTransform: 'uppercase', color: K.accentLt, marginBottom: u(6),
              }}>Takeaway</div>
              <Editable
                as="div" value={String(tr.takeaway ?? '')} path="traction.takeaway" editable={editable} onEdit={onEdit}
                style={{ fontSize: u(13.5), color: K.body, lineHeight: 1.5 }} />
            </div>
          </div>
        </div>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 4 — PRODUCT DEMO */
// Rebuilt against the design: eyebrow + headline with the live-product pill on
// the right, a dark media frame carrying the screenshot (or the play-glyph
// placeholder when none is uploaded), and the walkthrough copy beneath it.
// The design's bottom strip is three numbered feature chips; this data has no
// feature list, so that row carries the walkthrough it does have.
const SlideProductDemo: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const pd = d.productDemo || {};
  const shot = typeof pd.screenshot === 'string' ? pd.screenshot.trim() : '';
  const live = typeof pd.liveUrl === 'string' ? pd.liveUrl.trim() : '';
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        padding: `${u(60)}px ${u(80)}px ${u(56)}px`,
      }}>
        <div style={{ flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: u(24), marginBottom: u(22) }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: u(15), fontWeight: 800, color: K.accent,
              textTransform: 'uppercase', letterSpacing: '.12em',
            }}>{String(pd.eyebrow ?? '')}</div>
            <Editable
              as="div" value={String(pd.title ?? '')} path="productDemo.title" editable={editable} onEdit={onEdit}
              style={{ fontSize: u(38), fontWeight: 800, letterSpacing: '-.02em', marginTop: u(8), color: K.ink }} />
          </div>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: u(14) }}>
            {live && (
              <span style={{
                fontSize: u(17), fontWeight: 700, color: K.accent, background: K.accentSoft,
                borderRadius: 999, padding: `${u(9)}px ${u(20)}px`, whiteSpace: 'nowrap',
              }}>{live} →</span>
            )}
            <span style={{ fontSize: u(12), fontWeight: 700, color: K.faint, letterSpacing: '.06em' }}>
              {String(pd.idx ?? '')} / 11
            </span>
          </div>
        </div>

        <div style={{
          flex: 1, minHeight: 0, background: K.dbg, borderRadius: u(18), position: 'relative',
          overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: u(20),
        }}>
          <div style={{ display: 'flex', gap: u(9), position: 'absolute', top: u(18), left: u(20), zIndex: 2 }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
              <span key={c} style={{ width: u(13), height: u(13), borderRadius: '50%', background: c }} />
            ))}
          </div>
          {shot ? (
            <img src={shot} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ textAlign: 'center', color: K.dfaint }}>
              <div style={{
                width: u(74), height: u(74), margin: '0 auto', border: `2px solid ${K.dfaint}`,
                borderRadius: u(16), display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: 0, height: 0, marginLeft: u(5),
                  borderLeft: `${u(22)}px solid ${K.dfaint}`,
                  borderTop: `${u(14)}px solid transparent`,
                  borderBottom: `${u(14)}px solid transparent`,
                }} />
              </div>
              <div style={{ fontSize: u(17), marginTop: u(14) }}>{String(pd.caption ?? '')}</div>
            </div>
          )}
        </div>

        <div style={{
          flex: 'none', background: K.panel, border: `1px solid ${K.line}`,
          borderRadius: u(13), padding: `${u(18)}px ${u(22)}px`,
        }}>
          <div style={{
            fontSize: u(11.5), fontWeight: 800, letterSpacing: '.06em',
            textTransform: 'uppercase', color: K.faint, marginBottom: u(6),
          }}>{String(pd.walkthroughLabel ?? '')}</div>
          <Editable
            as="div" value={String(pd.body ?? '')} path="productDemo.body" editable={editable} onEdit={onEdit}
            style={{ fontSize: u(16), fontWeight: 500, color: D.ink2, lineHeight: 1.45 }} />
        </div>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 11 — REVIEW THE DEAL / DEAL READINESS */
// Rebuilt against the design: the close on the left — headline, closing line,
// numbered next steps, contact — and the diligence package on the right with a
// status tag per document. The design puts a readiness ring beside the summary;
// the document statuses here are free text ("Open", "On request", "Not
// required"), so the package's completeness is stated as a count rather than
// inferred into a percentage that would only look precise.
const SlideDealReadiness: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const dl = d.deal || {};
  const ready: Array<[string, string]> = Array.isArray(dl.ready) ? dl.ready : [];
  const steps: Array<[string, string]> = Array.isArray(dl.steps) ? dl.steps : [];
  // "Not required" is a RESOLVED state — an NDA nobody needs is not an
  // outstanding item, and flagging it amber beside "On request" told investors
  // the package was less ready than it is.
  const PENDING = /request|pending|in progress|awaiting/i;
  const NA = /not required|n\/a|none/i;
  const state = (v: any) => (NA.test(String(v ?? '')) ? 'na' : PENDING.test(String(v ?? '')) ? 'pending' : 'ready');
  const inScope = ready.filter((r) => state(r?.[1]) !== 'na');
  const settled = inScope.filter((r) => state(r?.[1]) === 'ready').length;
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', gap: u(44),
        padding: `${u(68)}px ${u(80)}px ${u(60)}px`,
      }}>
        <div style={{ flex: '1.05', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: u(16), marginBottom: u(26) }}>
            <span style={{
              fontSize: u(15), fontWeight: 800, color: K.accent,
              textTransform: 'uppercase', letterSpacing: '.12em',
            }}>{String(dl.eyebrow ?? '')}</span>
            <span style={{ marginLeft: 'auto', fontSize: u(12), fontWeight: 700, color: K.faint, letterSpacing: '.06em' }}>
              {String(dl.idx ?? '')} / 11
            </span>
          </div>
          <Editable
            as="div" value={String(dl.title ?? '')} path="deal.title" editable={editable} onEdit={onEdit}
            style={{ fontSize: u(50), fontWeight: 900, letterSpacing: '-.02em', color: K.ink, lineHeight: 1.08 }} />
          <Editable
            as="div" value={String(dl.closingLine ?? '')} path="deal.closingLine" editable={editable} onEdit={onEdit}
            style={{ fontSize: u(22), color: K.muted, marginTop: u(8), lineHeight: 1.35 }} />

          <div style={{ marginTop: u(30), display: 'flex', flexDirection: 'column', gap: u(13) }}>
            <div style={{
              fontSize: u(12), fontWeight: 800, color: K.muted,
              textTransform: 'uppercase', letterSpacing: '.08em',
            }}>{String(dl.nextLabel ?? '')}</div>
            {steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: u(13), alignItems: 'center' }}>
                <span style={{
                  width: u(28), height: u(28), flex: 'none', borderRadius: u(9),
                  background: K.accentSoft, color: K.accent, fontWeight: 800, fontSize: u(14),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{String(s?.[0] ?? i + 1)}</span>
                <span style={{ fontSize: u(18), color: D.ink2, minWidth: 0 }}>{String(s?.[1] ?? '')}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: u(14), flexWrap: 'wrap' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: u(10), background: K.accent, color: '#FFFFFF',
              borderRadius: u(12), padding: `${u(16)}px ${u(26)}px`, fontSize: u(20), fontWeight: 700,
            }}>Request intro →</div>
            <Editable
              as="div" value={String(dl.contact ?? '')} path="deal.contact" editable={editable} onEdit={onEdit}
              style={{ fontSize: u(15), color: K.faint }} />
          </div>
        </div>

        <div style={{
          flex: '.9', minWidth: 0, background: K.panel, border: `1px solid ${K.line}`,
          borderRadius: u(18), padding: `${u(28)}px ${u(30)}px`, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            flex: 'none', fontSize: u(13), fontWeight: 800, color: K.muted,
            textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: u(18),
          }}>{String(dl.diligenceLabel ?? '')}</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: u(13) }}>
            {ready.map((r, i) => {
              const st = state(r?.[1]);
              const pending = st === 'pending';
              const na = st === 'na';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u(13) }}>
                  <span style={{
                    width: u(28), height: u(28), flex: 'none', borderRadius: u(8),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: u(14), fontWeight: 800, lineHeight: 1,
                    background: na ? K.panel2 : pending ? '#FFFAF0' : D.greenBg,
                    color: na ? K.faint : pending ? K.active : K.done,
                  }}>{na ? '–' : pending ? '!' : '✓'}</span>
                  <span style={{ flex: 1, fontSize: u(18), color: D.ink2, fontWeight: 500, minWidth: 0 }}>
                    {String(r?.[0] ?? '')}
                  </span>
                  <span style={{
                    flex: 'none', fontSize: u(13), fontWeight: 700,
                    color: na ? K.faint : pending ? K.active : K.done,
                  }}>{String(r?.[1] ?? '')}</span>
                </div>
              );
            })}
          </div>
          {ready.length > 0 && (
            <div style={{
              flex: 'none', borderTop: `1px solid ${K.line}`, paddingTop: u(16), marginTop: u(8),
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: u(14), color: K.muted }}>Ready to share now</span>
              <span style={{ fontSize: u(20), fontWeight: 900, color: K.ink }}>{settled} of {inScope.length}</span>
            </div>
          )}
        </div>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* ─────────────────────────── slide registry ─────────────────────────── */
type SlideEntry = { id: string; title: string; Component: React.FC<SlideProps> };
export const SLIDES: SlideEntry[] = [
  { id: 'cover', title: 'Cover', Component: SlideCover },
  { id: 'problem', title: 'Problem & validation', Component: SlideProblem },
  { id: 'solution', title: 'Solution', Component: SlideSolution },
  { id: 'product_demo', title: 'Product demo', Component: SlideProductDemo },
  { id: 'market', title: 'Market', Component: SlideMarket },
  { id: 'competitive', title: 'Competitive', Component: SlideCompetitive },
  { id: 'traction', title: 'Traction', Component: SlideTraction },
  { id: 'roadmap', title: 'Roadmap', Component: SlideRoadmap },
  { id: 'team_network', title: 'Team & network', Component: SlideTeamNetwork },
  { id: 'ask', title: 'Ask & cap table', Component: SlideAsk },
  { id: 'review_the_deal', title: 'Review the deal', Component: SlideDealReadiness },
];

/* ─────────────────────────── root deck ─────────────────────────── */
// Renders all 9 Slide16x9 frames stacked — matches the sibling *_app decks,
// so the picker thumbnail, modal preview, share view and PDF export all work
// off a single scroll surface.
export const Deck_axal_spinout_demoday: React.FC<DeckProps> = (props) => {
  const data = React.useMemo(() => hydrate(props.data), [props.data]);
  const editable = !!props.editable;
  const onEdit = props.onEdit;
  return (
    <>
      {SLIDES.map((s) => {
        const C = s.Component;
        return <C key={s.id} d={data} editable={editable} onEdit={onEdit} />;
      })}
    </>
  );
};

export default Deck_axal_spinout_demoday;
