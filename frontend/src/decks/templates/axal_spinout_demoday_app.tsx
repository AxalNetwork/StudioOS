/**
 * axal_spinout_demoday_app.tsx — Axal VC 30-day Spin-Out Lab · Demo Day deck.
 *
 * In-app React renderer for the registry key `axal_spinout_demoday`. Renders
 * the 10-slide BASEPOINT editorial design (restrained white/ink + a single
 * blue accent, `#2C4BE0`) one-to-one with the PPTX export produced by
 * `../spinout/buildDeck.js`. Both sides share a single source of truth —
 * `../spinout/deckData.js` (THEME / fmt / SAMPLE_DATA / SAMPLE_NOTES) — so the
 * editor, picker thumbnail, preview modal, share view and PDF export all show
 * the same deck.
 *
 * Slide order (10): Cover · Problem · Validation · Market · Solution ·
 * Roadmap · Team & network · Cap table · Ask · Review the deal (deal
 * readiness). The standalone Axal Signal and Product Demo slides are dropped;
 * the two people slides are merged into Team & network.
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
import { useReviewDealSlot } from './reviewDealSlot';
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

const K = Object.fromEntries(
  Object.entries(THEME.color).map(([k, v]) => [k, `#${v}`]),
) as Record<keyof typeof THEME.color, string>;

const FF = 'Arial, "Helvetica Neue", Helvetica, system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

type OnEdit = (path: string, value: string) => void;
type Data = Record<string, any>;
type Status = 'done' | 'active' | 'pending';

/* ─────────────────────────── hydrate ─────────────────────────── */
const SECTIONS = new Set([
  'brand', 'cover', 'problem', 'validation', 'market', 'solution',
  'roadmap', 'team', 'captable', 'ask', 'deal',
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
    boxShadow: shadow ? '2px 2px 9px rgba(0,0,0,0.10)' : undefined, zIndex: z,
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
      {idx} / 10
    </Txt>
  </>
);

const Title: React.FC<{ text: any; path: string; editable?: boolean; onEdit?: OnEdit; w?: number }> = ({ text, path, editable, onEdit, w }) => (
  <Ed l={ML} t={1.05} w={w || 11.5} h={0.95} size={29} bold color={K.ink} lh={1.04} valign="top" value={text} path={path} editable={editable} onEdit={onEdit} />
);

const Footer: React.FC<{ brand: any; dark?: boolean }> = ({ brand, dark }) => {
  const col = dark ? K.dfaint : K.faint;
  return (
    <>
      <Txt l={ML} t={7.06} w={6} h={0.3} size={8} spacing={1} valign="middle" color={col}>{brand.lab}</Txt>
      {!dark && (
        <Txt l={W - MARGIN - 6} t={7.06} w={6} h={0.3} size={8} spacing={1} align="right" valign="middle" color={col}>{brand.footerRight}</Txt>
      )}
    </>
  );
};

const AreaChart: React.FC<{ l: number; t: number; w: number; h: number; values: number[]; labels: string[]; color: string }> = ({
  l, t, w, h, values, labels, color,
}) => {
  const safe = Array.isArray(values) && values.length ? values.map(Number) : [0];
  const max = Math.ceil(Math.max(...safe) * 1.14) || 1;
  const pw = inch(w), ph = inch(h);
  const n = safe.length;
  const px = (i: number) => (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const py = (val: number) => ph - (val / max) * ph;
  const line = safe.map((val, i) => `${px(i)},${py(val)}`).join(' ');
  const area = `0,${ph} ${line} ${pw},${ph}`;
  return (
    <div style={{ position: 'absolute', left: inch(l), top: inch(t), width: pw, height: ph }}>
      <svg width={pw} height={ph} viewBox={`0 0 ${pw} ${ph}`} style={{ display: 'block' }} preserveAspectRatio="none">
        <polygon points={area} fill={color} fillOpacity={0.28} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', left: 0, top: ph + inch(0.06), width: pw, display: 'flex', justifyContent: 'space-between' }}>
        {(Array.isArray(labels) ? labels : []).map((lab, i) => (
          <span key={i} style={{ fontFamily: FF, fontSize: pt(8), color: K.dfaint }}>{lab}</span>
        ))}
      </div>
    </div>
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

/* 1 — COVER (dark) */
const SlideCover: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const c = d.cover, brand = d.brand;
  const sigY: number[] = Array.isArray(c.signalY) ? c.signalY : [];
  const last = sigY.length ? sigY[sigY.length - 1] : '';
  return (
    <Slide16x9 bg={K.dbg} ink={K.white} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Txt l={ML} t={0.5} w={8} h={0.3} size={11} bold spacing={1.5} valign="middle" color={K.dmuted}>{brand.lab}</Txt>
        <Txt l={W - MARGIN - 5} t={0.5} w={5} h={0.3} size={11} bold spacing={1} align="right" valign="middle" color={K.accentLt}>{c.eyebrowRight}</Txt>

        <Ed l={ML} t={1.95} w={7.6} h={0.4} size={15} bold spacing={2} color={K.accentLt} value={c.company} path="cover.company" editable={editable} onEdit={onEdit} />
        <Ed l={ML} t={2.45} w={7.5} h={2.6} size={33} bold lh={1.06} color={K.white} valign="top" value={c.thesis} path="cover.thesis" editable={editable} onEdit={onEdit} />

        <Txt l={8.7} t={2.2} w={4.0} h={0.3} size={9.5} bold spacing={1} color={K.dmuted}>{c.signalLabel}</Txt>
        <AreaChart l={8.55} t={2.55} w={4.25} h={2.5} values={sigY} labels={c.signalX} color={K.accentLt} />
        <Txt l={11.85} t={2.62} w={0.95} h={0.35} size={16} bold align="right" color={K.accentLt}>{String(last)}</Txt>
        <Txt l={8.55} t={5.05} w={4.25} h={0.3} size={9} italic color={K.dfaint} face={SERIF}>{c.signalCaption}</Txt>

        {(Array.isArray(c.meta) ? c.meta : []).map((m: [string, string], i: number) => {
          const x = ML + i * 2.95;
          return (
            <React.Fragment key={i}>
              <Txt l={x} t={6.05} w={2.6} h={0.25} size={9} bold spacing={1} color={K.dfaint}>{m[0]}</Txt>
              <Txt l={x} t={6.32} w={2.6} h={0.4} size={15} bold color={K.white}>{m[1]}</Txt>
            </React.Fragment>
          );
        })}
      </div>
    </Slide16x9>
  );
};

/* 2 — PROBLEM */
const SlideProblem: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const p = d.problem;
  const bx = 5.35, bw = 7.25;
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={p.eyebrow} idx={p.idx} />
        <Title text={p.title} path="problem.title" editable={editable} onEdit={onEdit} />

        <Ed l={ML} t={2.15} w={4.0} h={1.0} size={13.5} color={K.body} lh={1.18} valign="top" value={p.framing} path="problem.framing" editable={editable} onEdit={onEdit} />
        <Rect l={ML} t={3.45} w={4.0} h={2.5} fill={K.panel} line={false} shadow={false} />
        <Txt l={ML + 0.15} t={3.35} w={1} h={0.9} size={54} bold color={K.accentMid} face={SERIF}>{'\u201C'}</Txt>
        <Ed l={ML + 0.35} t={4.05} w={3.35} h={1.3} size={14.5} italic color={K.ink} lh={1.14} valign="top" value={p.quote} path="problem.quote" editable={editable} onEdit={onEdit} />
        <Ed l={ML + 0.35} t={5.35} w={3.35} h={0.4} size={10} bold spacing={0.5} color={K.muted} value={p.quoteAttr} path="problem.quoteAttr" editable={editable} onEdit={onEdit} />

        <Txt l={bx} t={2.0} w={bw} h={0.3} size={10} bold spacing={1} color={K.muted}>{p.barsLabel}</Txt>
        {(Array.isArray(p.pains) ? p.pains : []).map((pn: [string, number, string], i: number) => {
          const py = 2.55 + i * 0.92;
          return (
            <React.Fragment key={i}>
              <Txt l={bx} t={py} w={bw - 1.6} h={0.32} size={14} bold valign="middle" color={K.ink}>{pn[0]}</Txt>
              <Txt l={bx + bw - 1.6} t={py} w={0.9} h={0.32} size={14} bold align="right" valign="middle" color={i === 0 ? K.accent : K.body}>{pn[1]}%</Txt>
              <Txt l={bx + bw - 0.65} t={py} w={0.65} h={0.32} size={9.5} align="right" valign="middle" color={K.faint}>{pn[2]}</Txt>
              <Bar l={bx} t={py + 0.4} w={bw} h={0.17} pct={Number(pn[1]) / 100} fill={i === 0 ? K.accent : K.accentMid} />
            </React.Fragment>
          );
        })}
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 3 — VALIDATION */
const SlideValidation: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const v = d.validation;
  const cw = 2.85, gap = 0.18, cy = 1.95, ch = 1.45;
  const stages: Array<[string, number]> = Array.isArray(v.stages) ? v.stages : [];
  const maxV = stages.length ? Math.max(...stages.map((s) => Number(s[1]))) : 1;
  const fx = 3.05, maxW = 7.7;
  const trans = [1, 0.6, 0.45, 0.28, 0.12];
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={v.eyebrow} idx={v.idx} />
        <Title text={v.title} path="validation.title" editable={editable} onEdit={onEdit} />

        {(Array.isArray(v.cards) ? v.cards : []).map((c: [string, string], i: number) => {
          const x = ML + i * (cw + gap);
          return (
            <React.Fragment key={i}>
              <Rect l={x} t={cy} w={cw} h={ch} r={0.1} />
              <Txt l={x + 0.25} t={cy + 0.18} w={cw - 0.5} h={0.7} size={40} bold valign="middle" color={K.accent}>{c[0]}</Txt>
              <Txt l={x + 0.25} t={cy + 0.92} w={cw - 0.5} h={0.4} size={11} color={K.muted}>{c[1]}</Txt>
            </React.Fragment>
          );
        })}

        <Txt l={ML} t={3.75} w={11} h={0.3} size={10} bold spacing={1} color={K.muted}>{v.funnelLabel}</Txt>
        {stages.map((st, i) => {
          const fy = 4.2 + i * 0.5;
          const w = Math.max(0.45, maxW * (Number(st[1]) / maxV));
          return (
            <React.Fragment key={i}>
              <Txt l={ML} t={fy} w={2.25} h={0.34} size={12} bold valign="middle" color={K.ink}>{st[0]}</Txt>
              <div style={{ position: 'absolute', left: inch(fx), top: inch(fy), width: inch(w), height: inch(0.34), background: K.accent, opacity: trans[Math.min(i, trans.length - 1)], borderRadius: inch(0.05) }} />
              <Txt l={fx + w + 0.12} t={fy} w={1.0} h={0.34} size={12} bold valign="middle" color={i === stages.length - 1 ? K.accent : K.body}>{String(st[1])}</Txt>
            </React.Fragment>
          );
        })}
        <Txt l={6.4} t={5.72} w={6.0} h={0.4} size={12} valign="middle" color={K.muted}>
          <span style={{ fontWeight: 700, color: K.accent, fontSize: pt(18) }}>{(v.conversion || [])[0]}</span>
          <span>{'  ' + ((v.conversion || [])[1] || '')}</span>
        </Txt>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 4 — MARKET */
const SlideMarket: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const m = d.market;
  const rings: Array<[string, string, string]> = Array.isArray(m.rings) ? m.rings : [];
  const cx = 3.35, cy = 4.0, dia = [3.5, 2.4, 1.25];
  const fills = [K.panel2, K.accentSoft, K.accent];
  const wx = 7.05, ww = 5.55;
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={m.eyebrow} idx={m.idx} />
        <Title text={m.title} path="market.title" editable={editable} onEdit={onEdit} />

        {dia.map((dd, i) => (
          <Oval key={i} l={cx - dd / 2} t={cy - dd / 2} d={dd} fill={fills[i]} line={K.white} lineW={1.5} />
        ))}
        {rings[2] && <Txt l={cx - 0.9} t={cy - 0.22} w={1.8} h={0.44} size={15} bold align="center" valign="middle" color={K.white}>{rings[2][1]}</Txt>}
        {rings[1] && <Txt l={cx - 0.7} t={cy - 1.05} w={1.4} h={0.34} size={13} bold align="center" color={K.ink}>{rings[1][1]}</Txt>}
        {rings[0] && <Txt l={cx - 0.6} t={cy - 1.62} w={1.2} h={0.3} size={12} bold align="center" color={K.body}>{rings[0][1]}</Txt>}

        {[2, 1, 0].map((idx, j) => {
          const r = rings[idx];
          if (!r) return null;
          const ly = 6.05 + j * 0.34;
          const col = fills[idx];
          return (
            <React.Fragment key={idx}>
              <Oval l={ML} t={ly + 0.02} d={0.16} fill={col} line={col === K.panel2 ? K.line : undefined} />
              <Txt l={ML + 0.28} t={ly - 0.06} w={5.6} h={0.3} size={11} valign="middle" color={K.muted}>
                <span style={{ fontWeight: 700, color: K.ink }}>{r[0] + '  '}</span>
                <span style={{ fontWeight: 700, color: K.accent }}>{r[1] + '  '}</span>
                <span>{r[2]}</span>
              </Txt>
            </React.Fragment>
          );
        })}

        <Txt l={wx} t={2.0} w={ww} h={0.3} size={11} bold spacing={1} color={K.accent}>{m.whyNowLabel}</Txt>
        {(Array.isArray(m.why) ? m.why : []).map((q: [string, string], i: number) => {
          const yy = 2.5 + i * 1.18;
          return (
            <React.Fragment key={i}>
              <Txt l={wx} t={yy} w={0.6} h={0.5} size={18} bold valign="top" color={K.accentMid}>{String(i + 1).padStart(2, '0')}</Txt>
              <Txt l={wx + 0.65} t={yy} w={ww - 0.65} h={0.35} size={14.5} bold valign="top" color={K.ink}>{q[0]}</Txt>
              <Txt l={wx + 0.65} t={yy + 0.36} w={ww - 0.65} h={0.7} size={11.5} valign="top" lh={1.14} color={K.body}>{q[1]}</Txt>
            </React.Fragment>
          );
        })}
        <Ed l={wx} t={6.05} w={ww} h={0.6} size={9.5} italic lh={1.1} valign="top" color={K.muted} value={m.assumptions} path="market.assumptions" editable={editable} onEdit={onEdit} />
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 5 — SOLUTION */
const SlideSolution: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const sol = d.solution;
  const steps: Array<[string, string, string]> = Array.isArray(sol.steps) ? sol.steps : [];
  const n = steps.length || 1, gap = 0.4, cw = (CW - (n - 1) * gap) / n, cy = 2.2, ch = 2.3;
  const outcomes: Array<[string, string]> = Array.isArray(sol.outcomes) ? sol.outcomes : [];
  const ow = 3.85, og = 0.19, oy = 5.2;
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={sol.eyebrow} idx={sol.idx} />
        <Title text={sol.title} path="solution.title" editable={editable} onEdit={onEdit} />

        {steps.map((st, i) => {
          const x = ML + i * (cw + gap);
          return (
            <React.Fragment key={i}>
              <Rect l={x} t={cy} w={cw} h={ch} r={0.1} />
              <Oval l={x + 0.28} t={cy + 0.3} d={0.72} fill={K.accentSoft}>
                <StepIcon name={st[0]} d={0.36} color={K.accent} />
              </Oval>
              <Txt l={x + cw - 0.85} t={cy + 0.3} w={0.6} h={0.4} size={13} bold align="right" color={K.faint}>{`0${i + 1}`}</Txt>
              <Txt l={x + 0.28} t={cy + 1.15} w={cw - 0.5} h={0.4} size={17} bold color={K.ink}>{st[1]}</Txt>
              <Txt l={x + 0.28} t={cy + 1.55} w={cw - 0.5} h={0.65} size={11} valign="top" lh={1.14} color={K.body}>{st[2]}</Txt>
              {i < n - 1 && (
                <Txt l={x + cw + 0.02} t={cy + 0.85} w={gap - 0.04} h={0.5} size={20} align="center" valign="middle" color={K.accentMid}>{'\u2192'}</Txt>
              )}
            </React.Fragment>
          );
        })}

        <Txt l={ML} t={4.85} w={4} h={0.3} size={10} bold spacing={1} color={K.accent}>{sol.outcomeLabel}</Txt>
        {outcomes.map((o, i) => {
          const x = ML + i * (ow + og);
          return (
            <React.Fragment key={i}>
              <Rect l={x} t={oy} w={ow} h={1.15} fill={K.panel} line={false} shadow={false} />
              <Txt l={x + 0.28} t={oy + 0.15} w={ow - 0.5} h={0.55} size={26} bold valign="middle" color={K.ink}>{o[0]}</Txt>
              <Txt l={x + 0.28} t={oy + 0.7} w={ow - 0.5} h={0.38} size={11} valign="top" color={K.body}>{o[1]}</Txt>
            </React.Fragment>
          );
        })}
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 6 — ROADMAP */
const SlideRoadmap: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const r = d.roadmap;
  const days: string[] = Array.isArray(r.days) ? r.days : [];
  const railY = 2.2, x0 = ML + 0.1, x1 = W - MARGIN - 0.1;
  const cur = Number(r.currentDay) || 0;
  const colW = 3.77, colGap = 0.31, colY = 2.85, colH = 3.55;
  const phases: Array<[string, string, Array<[Status, string]>]> = Array.isArray(r.phases) ? r.phases : [];
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={r.eyebrow} idx={r.idx} />
        <Title text={r.title} path="roadmap.title" editable={editable} onEdit={onEdit} />

        <div style={{ position: 'absolute', left: inch(x0), top: inch(railY), width: inch(x1 - x0), height: pt(1.5), background: K.line }} />
        {days.map((day, i) => {
          const x = x0 + (x1 - x0) * (days.length > 1 ? i / (days.length - 1) : 0);
          const now = i === cur;
          return (
            <React.Fragment key={i}>
              <Oval l={x - 0.07} t={railY - 0.07} d={0.14} fill={now ? K.accent : K.faint} />
              <Txt l={x - 1} t={railY + 0.12} w={2} h={0.25} size={9.5} bold align="center" color={now ? K.accent : K.muted}>{day + (now ? '  ·  today' : '')}</Txt>
            </React.Fragment>
          );
        })}

        {phases.map((p, i) => {
          const x = ML + i * (colW + colGap);
          return (
            <React.Fragment key={i}>
              <Rect l={x} t={colY} w={colW} h={colH} r={0.1} fill={i === 0 ? K.accentSoft : K.panel} line={false} shadow={false} />
              <Txt l={x + 0.3} t={colY + 0.28} w={colW - 0.6} h={0.4} size={16} bold spacing={0.5} color={i === 0 ? K.accent : K.ink}>{p[0]}</Txt>
              <Txt l={x + 0.3} t={colY + 0.68} w={colW - 0.6} h={0.3} size={11} bold color={K.muted}>{p[1]}</Txt>
              {(Array.isArray(p[2]) ? p[2] : []).map((mi, j) => {
                const iy = colY + 1.2 + j * 0.72;
                return (
                  <React.Fragment key={j}>
                    <div style={{ position: 'absolute', left: inch(x + 0.3), top: inch(iy + 0.02) }}><StatusDot status={mi[0]} d={0.22} /></div>
                    <Txt l={x + 0.64} t={iy - 0.04} w={colW - 0.94} h={0.55} size={11.5} valign="top" lh={1.08} color={K.ink}>{mi[1]}</Txt>
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}

        <Txt l={ML} t={6.55} w={11} h={0.3} size={10} valign="middle" color={K.muted}>
          <span style={{ color: K.done, fontSize: pt(11) }}>{'\u25CF '}</span><span>{'Done    '}</span>
          <span style={{ color: K.active, fontSize: pt(11) }}>{'\u25CF '}</span><span>{'In progress    '}</span>
          <span style={{ color: K.pending, fontSize: pt(11) }}>{'\u25CB '}</span><span>{'Planned'}</span>
        </Txt>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 7 — TEAM & NETWORK */
const SlideTeamNetwork: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const t = d.team;
  const f = t.founder || {};
  const lx = ML, lw = 4.7;
  const advisors: Array<[string, string, string]> = Array.isArray(t.advisors) ? t.advisors : [];
  const nodes: Array<[number, number, string, string]> = Array.isArray(t.nodes) ? t.nodes : [];
  const cX = 9.35, cY = 4.15, nw = 2.2, nh = 0.92;
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={t.eyebrow} idx={t.idx} />
        <Title text={t.title} path="team.title" editable={editable} onEdit={onEdit} />

        <Rect l={lx} t={2.0} w={lw} h={2.0} r={0.1} />
        <Oval l={lx + 0.3} t={2.3} d={1.05} fill={K.accent}>
          <span style={{ fontFamily: FF, fontWeight: 700, fontSize: pt(24), color: K.white }}>{f.initials}</span>
        </Oval>
        <Ed l={lx + 1.55} t={2.32} w={lw - 1.8} h={0.4} size={19} bold color={K.ink} value={f.name} path="team.founder.name" editable={editable} onEdit={onEdit} />
        <Ed l={lx + 1.55} t={2.72} w={lw - 1.8} h={0.3} size={12} bold color={K.accent} value={f.role} path="team.founder.role" editable={editable} onEdit={onEdit} />
        <Ed l={lx + 0.3} t={3.45} w={lw - 0.6} h={0.5} size={11.5} lh={1.1} valign="top" color={K.body} value={f.bio} path="team.founder.bio" editable={editable} onEdit={onEdit} />

        <Txt l={lx} t={4.25} w={lw} h={0.3} size={10} bold spacing={1} color={K.muted}>{t.advisorsLabel}</Txt>
        {advisors.map((a, i) => {
          const ay = 4.62 + i * 0.62;
          return (
            <React.Fragment key={i}>
              <Oval l={lx} t={ay} d={0.5} fill={K.panel2}>
                <span style={{ fontFamily: FF, fontWeight: 700, fontSize: pt(11), color: K.body }}>{a[0]}</span>
              </Oval>
              <Txt l={lx + 0.65} t={ay} w={lw - 0.65} h={0.5} size={12.5} valign="middle" color={K.ink}>
                <span style={{ fontWeight: 700 }}>{a[1] + '   '}</span>
                <span style={{ color: K.muted, fontWeight: 400, fontSize: pt(11) }}>{a[2]}</span>
              </Txt>
            </React.Fragment>
          );
        })}

        {/* network graph */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 1920 1080">
          {nodes.map((nd, i) => (
            <line key={i} x1={inch(cX)} y1={inch(cY)} x2={inch(nd[0])} y2={inch(nd[1])} stroke={K.accentMid} strokeWidth={pt(1.5)} />
          ))}
        </svg>
        {nodes.map((nd, i) => (
          <React.Fragment key={i}>
            <Rect l={nd[0] - nw / 2} t={nd[1] - nh / 2} w={nw} h={nh} r={0.1} />
            <Txt l={nd[0] - nw / 2 + 0.1} t={nd[1] - nh / 2 + 0.13} w={nw - 0.2} h={0.32} size={12.5} bold align="center" color={K.ink}>{nd[2]}</Txt>
            <Txt l={nd[0] - nw / 2 + 0.1} t={nd[1] - nh / 2 + 0.48} w={nw - 0.2} h={0.3} size={10} align="center" color={K.muted}>{nd[3]}</Txt>
          </React.Fragment>
        ))}
        <Oval l={cX - 1.0} t={cY - 0.55} d={1.1} fill={K.accent} shadow z={2} />
        <Txt l={cX - 1.0} t={cY - 0.55} w={2.0} h={1.1} size={16} bold align="center" valign="middle" color={K.white} z={3}>{t.centerName}</Txt>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 8 — CAP TABLE */
const SlideCapTable: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const c = d.captable;
  const lx = ML, lw = 6.5;
  const items: Array<[string, string]> = Array.isArray(c.items) ? c.items : [];
  const rx = 7.55, rw = 5.05;
  const segments: Array<[string, number]> = Array.isArray(c.segments) ? c.segments : [];
  const donutColors = [K.accent, K.accentMid, K.panel2];
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={c.eyebrow} idx={c.idx} />
        <Title text={c.title} path="captable.title" editable={editable} onEdit={onEdit} />

        <Txt l={lx} t={2.0} w={lw} h={0.3} size={10} bold spacing={1} color={K.muted}>{c.checklistLabel}</Txt>
        {items.map((it, i) => {
          const iy = 2.5 + i * 0.6;
          const done = it[1] === 'done';
          return (
            <React.Fragment key={i}>
              <Rect l={lx} t={iy} w={lw} h={0.5} r={0.06} fill={K.panel} line={false} shadow={false} />
              <div style={{ position: 'absolute', left: inch(lx + 0.18), top: inch(iy + 0.13) }}><StatusDot status={it[1] as Status} d={0.24} /></div>
              <Txt l={lx + 0.6} t={iy} w={lw - 2.1} h={0.5} size={13} bold valign="middle" color={K.ink}>{it[0]}</Txt>
              <Txt l={lx + lw - 1.5} t={iy} w={1.35} h={0.5} size={11} bold align="right" valign="middle" color={done ? K.done : K.active}>{done ? 'Done' : 'In progress'}</Txt>
            </React.Fragment>
          );
        })}

        <Txt l={rx} t={2.0} w={rw} h={0.3} size={10} bold spacing={1} color={K.muted}>{c.donutLabel}</Txt>
        <Donut l={rx + 0.55} t={2.5} w={3.9} h={3.0} segments={segments} colors={donutColors} />
        <Txt l={rx + 1.6} t={3.62} w={1.8} h={0.78} size={22} bold align="center" valign="middle" color={K.ink}>
          <span style={{ display: 'block' }}>{c.centerBig}</span>
          <span style={{ display: 'block', fontSize: pt(10), fontWeight: 400, color: K.muted }}>{c.centerSmall}</span>
        </Txt>
        {segments.map((seg, i) => {
          const cy2 = 5.75 + i * 0.3;
          const col = donutColors[i % donutColors.length];
          return (
            <React.Fragment key={i}>
              <Oval l={rx + 0.55} t={cy2 + 0.02} d={0.16} fill={col} line={col === K.panel2 ? K.line : undefined} />
              <Txt l={rx + 0.8} t={cy2 - 0.05} w={rw - 0.8} h={0.28} size={11} valign="middle" color={K.muted}>
                <span style={{ color: K.ink, fontWeight: 700 }}>{seg[0] + '   '}</span>
                <span>{seg[1]}%</span>
              </Txt>
            </React.Fragment>
          );
        })}
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 9 — ASK */
const SlideAsk: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const a = d.ask;
  const kw = 2.85, kh = 1.7, kgx = 0.3, kgy = 0.3, kx0 = ML, ky0 = 2.2;
  const kpis: Array<[string, string]> = Array.isArray(a.kpis) ? a.kpis : [];
  const ux = 6.95, uw = 5.65;
  const funds: Array<[string, number]> = Array.isArray(a.funds) ? a.funds : [];
  const milestone: [string, string] = Array.isArray(a.milestone) ? a.milestone : ['', ''];
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={a.eyebrow} idx={a.idx} />
        <Title text={a.title} path="ask.title" editable={editable} onEdit={onEdit} />

        {kpis.map((k, i) => {
          const x = kx0 + (i % 2) * (kw + kgx), y = ky0 + Math.floor(i / 2) * (kh + kgy);
          return (
            <React.Fragment key={i}>
              <Rect l={x} t={y} w={kw} h={kh} r={0.1} />
              <Txt l={x + 0.28} t={y + 0.3} w={kw - 0.5} h={0.75} size={33} bold valign="middle" color={K.accent}>{k[0]}</Txt>
              <Txt l={x + 0.28} t={y + 1.05} w={kw - 0.5} h={0.45} size={12} valign="top" color={K.muted}>{k[1]}</Txt>
            </React.Fragment>
          );
        })}

        <Txt l={ux} t={2.0} w={uw} h={0.3} size={10} bold spacing={1} color={K.muted}>{a.useLabel}</Txt>
        {funds.map((fn, i) => {
          const fy = 2.55 + i * 0.82;
          return (
            <React.Fragment key={i}>
              <Txt l={ux} t={fy} w={uw - 0.9} h={0.3} size={13} bold valign="middle" color={K.ink}>{fn[0]}</Txt>
              <Txt l={ux + uw - 0.9} t={fy} w={0.9} h={0.3} size={13} bold align="right" valign="middle" color={i === 0 ? K.accent : K.body}>{fn[1]}%</Txt>
              <Bar l={ux} t={fy + 0.36} w={uw} h={0.17} pct={Number(fn[1]) / 100} fill={i === 0 ? K.accent : K.accentMid} />
            </React.Fragment>
          );
        })}
        <Rect l={ux} t={6.0} w={uw} h={0.7} fill={K.accentSoft} line={false} shadow={false} />
        <Txt l={ux + 0.25} t={6.0} w={uw - 0.5} h={0.7} size={12} valign="middle" color={K.ink}>
          <span style={{ fontWeight: 700, color: K.accent }}>{milestone[0] + '  '}</span>
          <span>{milestone[1]}</span>
        </Txt>
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 10 — REVIEW THE DEAL / deal readiness (dark) */
const SlideReviewTheDeal: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const dl = d.deal;
  const lx = ML, lw = 6.0;
  const ready: Array<[string, string]> = Array.isArray(dl.ready) ? dl.ready : [];
  const rx = 7.35, rw = 5.25;
  const steps: Array<[string, string]> = Array.isArray(dl.steps) ? dl.steps : [];
  // Share-mode interactive "Join & open the deal" card, injected from the
  // viewer layer (PitchDeckPrintPage). Null in editor / thumbnail / export.
  const dealSlot = useReviewDealSlot();
  return (
    <Slide16x9 bg={K.dbg} ink={K.white} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={dl.eyebrow} idx={dl.idx} dark />
        <Ed l={ML} t={1.05} w={11.5} h={0.95} size={30} bold valign="top" color={K.white} value={dl.title} path="deal.title" editable={editable} onEdit={onEdit} />

        <Txt l={lx} t={2.15} w={lw} h={0.3} size={10} bold spacing={1} color={K.accentLt}>{dl.diligenceLabel}</Txt>
        {ready.map((r, i) => {
          const ry = 2.6 + i * 0.66;
          return (
            <React.Fragment key={i}>
              <div style={{ position: 'absolute', left: inch(lx), top: inch(ry), width: inch(lw), height: inch(0.55), background: K.dpanel, border: `${pt(1)}px solid ${K.dline}`, borderRadius: inch(0.06) }} />
              <Oval l={lx + 0.22} t={ry + 0.185} d={0.18} fill={K.accentLt} />
              <Txt l={lx + 0.6} t={ry} w={lw - 2.3} h={0.55} size={13} bold valign="middle" color={K.white}>{r[0]}</Txt>
              <Txt l={lx + lw - 1.85} t={ry} w={1.7} h={0.55} size={12} bold align="right" valign="middle" color={K.dmuted}>{r[1]}</Txt>
            </React.Fragment>
          );
        })}

        <Txt l={rx} t={2.15} w={rw} h={0.3} size={10} bold spacing={1} color={K.accentLt}>{dl.nextLabel}</Txt>
        {steps.map((st, i) => {
          const sy = 2.6 + i * 0.85;
          return (
            <React.Fragment key={i}>
              <Oval l={rx} t={sy} d={0.5} fill={K.accent}>
                <span style={{ fontFamily: FF, fontWeight: 700, fontSize: pt(16), color: K.white }}>{st[0]}</span>
              </Oval>
              <Txt l={rx + 0.7} t={sy} w={rw - 0.7} h={0.5} size={14} bold valign="middle" color={K.white}>{st[1]}</Txt>
            </React.Fragment>
          );
        })}
        <div style={{ position: 'absolute', left: inch(rx), top: inch(5.55), width: inch(rw), height: pt(1), background: K.dline }} />
        <Ed l={rx} t={5.7} w={rw} h={0.5} size={15} bold valign="top" color={K.white} value={dl.closingLine} path="deal.closingLine" editable={editable} onEdit={onEdit} />
        <Ed l={rx} t={6.2} w={rw} h={0.4} size={12} valign="top" color={K.accentLt} value={dl.contact} path="deal.contact" editable={editable} onEdit={onEdit} />

        {dealSlot && (
          <div style={{ position: 'absolute', left: inch(lx), top: inch(5.9), width: inch(lw), zIndex: 6 }}>{dealSlot}</div>
        )}
        <Txt l={ML} t={7.06} w={6} h={0.3} size={8} spacing={1} valign="middle" color={K.dfaint}>{d.brand.lab}</Txt>
      </div>
    </Slide16x9>
  );
};

/* ─────────────────────────── slide registry ─────────────────────────── */
type SlideEntry = { id: string; title: string; Component: React.FC<SlideProps> };
export const SLIDES: SlideEntry[] = [
  { id: 'cover', title: 'Cover', Component: SlideCover },
  { id: 'problem', title: 'Problem', Component: SlideProblem },
  { id: 'validation', title: 'Validation', Component: SlideValidation },
  { id: 'market', title: 'Market', Component: SlideMarket },
  { id: 'solution', title: 'Solution', Component: SlideSolution },
  { id: 'roadmap', title: 'Roadmap', Component: SlideRoadmap },
  { id: 'team_network', title: 'Team & network', Component: SlideTeamNetwork },
  { id: 'cap_table', title: 'Cap table', Component: SlideCapTable },
  { id: 'ask', title: 'Ask', Component: SlideAsk },
  { id: 'review_the_deal', title: 'Review the deal', Component: SlideReviewTheDeal },
];

/* ─────────────────────────── root deck ─────────────────────────── */
// Renders all 10 Slide16x9 frames stacked — matches the sibling *_app decks,
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
