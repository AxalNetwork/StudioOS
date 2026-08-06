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
import { SAMPLE_DATA as SPINOUT_SAMPLE_DATA } from '../spinout/deckData';

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

/* The renderer is intentionally self contained: the approved NovaCraft
 * reference uses a warm-violet system rather than the legacy BASEPOINT blue. */
const K = {
  ink: '#171321', body: '#4E4A59', muted: '#727080', faint: '#A8A5B1',
  line: '#E7E5EA', panel: '#F7F7F9', panel2: '#EEEFF3', white: '#FCFCFD',
  accent: '#6B46C1', accentSoft: '#F0ECFF', accentMid: '#B9A5F4',
  dbg: '#09080D', dpanel: '#17132D', dline: '#2D2747',
  dmuted: '#BDB4D8', dfaint: '#71698A', accentLt: '#8B5CF6',
  done: '#3BA477', active: '#D58A16', pending: '#AAB0BA',
} as const;

const FF = '"Inter", "Helvetica Neue", system-ui, sans-serif';
const SERIF = '"Inter", system-ui, sans-serif';
const MONO = '"Roboto Mono", ui-monospace, SFMono-Regular, monospace';

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
  return (
    <Slide16x9 bg={K.dbg} ink={K.white} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <div style={{position:'absolute',left:inch(-1),top:inch(-2.25),width:inch(8.3),height:inch(3.35),borderRadius:'50%',background:'#8B5CF6',transform:'rotate(-7deg)'}} />
        <Rect l={ML} t={0.76} w={0.5} h={0.5} r={0.12} fill={K.accentLt} line={false} shadow={false} />
        <Txt l={ML} t={0.76} w={0.5} h={0.5} size={14} bold align="center" valign="middle" color={K.white}>N</Txt>
        <Txt l={ML + 0.7} t={0.76} w={3} h={0.5} size={11} color={K.dmuted} valign="middle">{c.company}</Txt>
        <Rect l={10.55} t={0.8} w={1.8} h={0.32} r={0.16} fill={K.dbg} line={K.dline} shadow={false} />
        <Txt l={10.65} t={0.8} w={1.6} h={0.32} size={8.5} face={MONO} color={K.dmuted} align="center" valign="middle">{c.eyebrowRight}</Txt>
        <Ed l={ML} t={2.3} w={8.3} h={0.8} size={40} bold lh={1} color={K.white} value={c.company} path="cover.company" editable={editable} onEdit={onEdit} />
        <Ed l={ML} t={3.05} w={8.2} h={0.8} size={16} color="#D8D0F1" lh={1.16} value={c.thesis} path="cover.thesis" editable={editable} onEdit={onEdit} />
        {(Array.isArray(c.meta) ? c.meta : []).map((m: [string, string], i: number) => {
          const x = ML + i * 2.92;
          return <React.Fragment key={i}><Rect l={x} t={4.25} w={2.55} h={0.56} r={0.1} fill="#14121B" line="#272433" shadow={false} /><Txt l={x + .18} t={4.35} w={2.2} h={.15} size={7} bold spacing={.8} color={K.accentLt}>{m[0]}</Txt><Txt l={x + .18} t={4.55} w={2.2} h={.18} size={11} bold color={K.white}>{m[1]}</Txt></React.Fragment>;
        })}
        <div style={{position:'absolute',left:inch(ML),top:inch(5.15),width:inch(11.65),height:pt(1),background:'#272433'}} />
        <Txt l={ML} t={5.38} w={2} h={.2} size={7.5} bold spacing={1} color={K.accentLt}>DISCOVERY TO DATE</Txt>
        {sigY.slice(-4).map((n,i)=><React.Fragment key={i}><Txt l={2.35+i*1.15} t={5.29} w={.35} h={.3} size={15} bold color={K.white}>{String(n)}</Txt><Txt l={2.78+i*1.15} t={5.4} w={.75} h={.2} size={8} color={K.dmuted}>{['Customers','Advisors','Co-founders','Investors'][i]}</Txt></React.Fragment>)}
      </div>
    </Slide16x9>
  );
};

/* 2 — PROBLEM (+ validation evidence) */
// The standalone Validation slide is merged here: the discovery funnel renders
// as a compact stat strip along the bottom, reading the unchanged
// `validation.*` section (stages + conversion) in place.
const SlideProblem: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const p = d.problem;
  const v = d.validation || {};
  const stages: Array<[string, number]> = Array.isArray(v.stages) ? v.stages : [];
  const conversion: [string, string] = Array.isArray(v.conversion) ? v.conversion : ['', ''];
  const bx = 5.35, bw = 7.25;
  const stW = stages.length ? Math.min(1.85, 9.25 / stages.length) : 1.85;
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

        {/* validation evidence strip — discovery funnel + conversion */}
        {stages.length > 0 && (
          <>
            <Txt l={ML} t={6.02} w={6} h={0.25} size={9.5} bold spacing={1} color={K.muted}>{v.funnelLabel}</Txt>
            {stages.map((st, i) => {
              const x = ML + i * stW;
              return (
                <React.Fragment key={i}>
                  <Txt l={x} t={6.3} w={stW - 0.2} h={0.32} size={16} bold color={i === stages.length - 1 ? K.accent : K.ink}>{String(st[1])}</Txt>
                  {/* single-line clamp: the footer starts at 7.06, so a wrapping
                      stage label would collide with it */}
                  <Txt l={x} t={6.62} w={stW - 0.2} h={0.26} size={8.5} lh={1.05} color={K.muted}>
                    <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st[0]}</span>
                  </Txt>
                  {i < stages.length - 1 && (
                    <Txt l={x + stW - 0.24} t={6.3} w={0.24} h={0.32} size={12} align="center" valign="middle" color={K.accentMid}>{'\u2192'}</Txt>
                  )}
                </React.Fragment>
              );
            })}
            <Txt l={10.1} t={6.3} w={2.53} h={0.56} size={11} valign="top" lh={1.15} color={K.muted}>
              <span style={{ fontWeight: 700, color: K.accent, fontSize: pt(16) }}>{conversion[0]}</span>
              <span>{'  ' + (conversion[1] || '')}</span>
            </Txt>
          </>
        )}
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 5 — MARKET */
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
  const rawFounders: Array<any> = Array.isArray(t.founders) && t.founders.length ? t.founders : [f];
  const founders = rawFounders.filter((x) => x && (x.name || x.initials || x.photo));
  const multi = founders.length > 1;
  const advisors: Array<[string, string, string, (string | null)?]> = Array.isArray(t.advisors) ? t.advisors : [];
  const nodes: Array<[number, number, string, string]> = Array.isArray(t.nodes) ? t.nodes : [];
  const cX = 9.35, cY = 4.15, nw = 2.2, nh = 0.92;

  // ── left-column vertical fit ────────────────────────────────────────────
  // The founder block + roster must stay between the title and the footer no
  // matter how many people are listed. With co-founders the founder block
  // becomes compact rows to reclaim space; the roster then scales its row
  // height (and only caps its visible count as a last resort) so the final
  // row never crosses the bottom margin.
  const TOP = 2.0, BOTTOM = 6.92;
  const leftEls: React.ReactNode[] = [];
  let founderBottom: number;

  if (!multi) {
    const fo = founders[0] || f;
    leftEls.push(<Rect key="fcard" l={lx} t={TOP} w={lw} h={2.0} r={0.1} />);
    leftEls.push(
      <Avatar key="favatar" l={lx + 0.3} t={TOP + 0.3} d={1.05}
        photo={fo.photo} initials={fo.initials} fill={K.accent} fontSize={24} textColor={K.white} />,
    );
    leftEls.push(<Ed key="fname" l={lx + 1.55} t={TOP + 0.32} w={lw - 1.8} h={0.4} size={19} bold color={K.ink} value={fo.name} path="team.founder.name" editable={editable} onEdit={onEdit} />);
    leftEls.push(<Ed key="frole" l={lx + 1.55} t={TOP + 0.72} w={lw - 1.8} h={0.3} size={12} bold color={K.accent} value={fo.role} path="team.founder.role" editable={editable} onEdit={onEdit} />);
    leftEls.push(<Ed key="fbio" l={lx + 0.3} t={TOP + 1.45} w={lw - 0.6} h={0.5} size={11.5} lh={1.1} valign="top" color={K.body} value={fo.bio} path="team.founder.bio" editable={editable} onEdit={onEdit} />);
    founderBottom = TOP + 2.0;
  } else {
    // Compact stacked founder cards: smaller avatar, name + role, no bio.
    const rowH = founders.length >= 3 ? 0.82 : 0.96;
    const cardH = rowH - 0.12;
    const avD = Math.max(0.4, cardH - 0.26);
    founders.forEach((fo, i) => {
      const y = TOP + i * rowH;
      const tx = lx + 0.16 + avD + 0.18;
      const tw = lw - (0.16 + avD + 0.18) - 0.2;
      leftEls.push(<Rect key={`fc${i}`} l={lx} t={y} w={lw} h={cardH} r={0.1} />);
      leftEls.push(
        <Avatar key={`fa${i}`} l={lx + 0.16} t={y + (cardH - avD) / 2} d={avD}
          photo={fo.photo} initials={fo.initials} fill={K.accent} fontSize={15} textColor={K.white} />,
      );
      leftEls.push(<Txt key={`fn${i}`} l={tx} t={y + 0.16} w={tw} h={0.34} size={15} bold color={K.ink}>{fo.name}</Txt>);
      leftEls.push(<Txt key={`fr${i}`} l={tx} t={y + 0.5} w={tw} h={0.3} size={11} bold color={K.accent}>{fo.role}</Txt>);
    });
    founderBottom = TOP + founders.length * rowH;
  }

  // ── roster (advisors / advisors / partners) ──────────────────────────────
  const labelY = founderBottom + 0.16;
  const rosterTop = labelY + 0.36;
  const avail = Math.max(0, BOTTOM - rosterTop);
  const MAX_ROW = 0.62, MIN_ROW = 0.46;
  let rowH = MAX_ROW;
  let visible = advisors;
  if (advisors.length > 0) {
    rowH = Math.min(MAX_ROW, avail / advisors.length);
    if (rowH < MIN_ROW) {
      const maxRows = Math.max(1, Math.floor(avail / MIN_ROW));
      visible = advisors.slice(0, maxRows);
      rowH = Math.min(MAX_ROW, avail / visible.length);
    }
  }
  const avD = Math.max(0.34, Math.min(0.5, rowH - 0.12));
  const nameSize = Math.max(10.5, Math.min(12.5, rowH * 20));
  const roleSize = Math.max(9.5, nameSize - 1.5);

  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={t.eyebrow} idx={t.idx} />
        <Title text={t.title} path="team.title" editable={editable} onEdit={onEdit} />

        {leftEls}

        <Txt l={lx} t={labelY} w={lw} h={0.3} size={10} bold spacing={1} color={K.muted}>{t.advisorsLabel}</Txt>
        {visible.map((a, i) => {
          const ay = rosterTop + i * rowH;
          const photo = a[3] || undefined;
          return (
            <React.Fragment key={i}>
              <Avatar l={lx} t={ay + (rowH - avD) / 2} d={avD}
                photo={photo || undefined} initials={a[0]} fill={K.panel2} fontSize={11} textColor={K.body} />
              <Txt l={lx + avD + 0.15} t={ay} w={lw - avD - 0.15} h={rowH} size={nameSize} valign="middle" color={K.ink}>
                <span style={{ fontWeight: 700 }}>{a[1] + '   '}</span>
                <span style={{ color: K.muted, fontWeight: 400, fontSize: pt(roleSize) }}>{a[2]}</span>
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

/* 10 — ASK (+ cap table) */
// The standalone Cap Table slide is merged here: the fully-diluted donut and
// an entity-setup status line render as a right column, reading the unchanged
// `captable.*` section (segments / items / labels) in place.
const SlideAsk: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const a = d.ask;
  const c = d.captable || {};
  const kw = 2.32, kh = 1.7, kgx = 0.26, kgy = 0.3, kx0 = ML, ky0 = 2.2;
  const kpis: Array<[string, string]> = Array.isArray(a.kpis) ? a.kpis : [];
  const ux = 5.85, uw = 3.6;
  const funds: Array<[string, number]> = Array.isArray(a.funds) ? a.funds : [];
  const milestone: [string, string] = Array.isArray(a.milestone) ? a.milestone : ['', ''];
  const rx = 9.75, rw = 2.88;
  // Legend capped at 3 rows (4.95..5.83): the entity-status panel starts at
  // 6.0, so real cap tables with 5–6 holders would otherwise collide with it.
  const allSegments: Array<[string, number]> = Array.isArray(c.segments) ? c.segments : [];
  const segments = allSegments.slice(0, 3);
  const items: Array<[string, string]> = Array.isArray(c.items) ? c.items : [];
  const doneN = items.filter((it) => it[1] === 'done').length;
  const donutColors = [K.accent, K.accentMid, K.panel2];
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
              <Txt l={x + 0.24} t={y + 0.3} w={kw - 0.44} h={0.75} size={26} bold valign="middle" color={K.accent}>{k[0]}</Txt>
              <Txt l={x + 0.24} t={y + 1.05} w={kw - 0.44} h={0.45} size={11} valign="top" lh={1.1} color={K.muted}>{k[1]}</Txt>
            </React.Fragment>
          );
        })}

        <Txt l={ux} t={2.0} w={uw} h={0.3} size={10} bold spacing={1} color={K.muted}>{a.useLabel}</Txt>
        {funds.map((fn, i) => {
          const fy = 2.55 + i * 0.82;
          return (
            <React.Fragment key={i}>
              <Txt l={ux} t={fy} w={uw - 0.8} h={0.3} size={12} bold valign="middle" color={K.ink}>{fn[0]}</Txt>
              <Txt l={ux + uw - 0.8} t={fy} w={0.8} h={0.3} size={12} bold align="right" valign="middle" color={i === 0 ? K.accent : K.body}>{fn[1]}%</Txt>
              <Bar l={ux} t={fy + 0.36} w={uw} h={0.17} pct={Number(fn[1]) / 100} fill={i === 0 ? K.accent : K.accentMid} />
            </React.Fragment>
          );
        })}
        <Rect l={ux} t={6.0} w={uw} h={0.85} fill={K.accentSoft} line={false} shadow={false} />
        <Txt l={ux + 0.22} t={6.0} w={uw - 0.44} h={0.85} size={11} lh={1.15} valign="middle" color={K.ink}>
          <span style={{ fontWeight: 700, color: K.accent }}>{milestone[0] + '  '}</span>
          <span>{milestone[1]}</span>
        </Txt>

        {/* cap table column */}
        <Txt l={rx} t={2.0} w={rw} h={0.3} size={10} bold spacing={1} color={K.muted}>{c.donutLabel}</Txt>
        <Donut l={rx + 0.29} t={2.45} w={2.3} h={2.3} segments={allSegments} colors={donutColors} />
        <Txt l={rx + 0.79} t={3.31} w={1.3} h={0.58} size={16} bold align="center" valign="middle" color={K.ink}>
          <span style={{ display: 'block' }}>{c.centerBig}</span>
          <span style={{ display: 'block', fontSize: pt(8.5), fontWeight: 400, color: K.muted }}>{c.centerSmall}</span>
        </Txt>
        {segments.map((seg, i) => {
          const cy2 = 4.95 + i * 0.3;
          const col = donutColors[i % donutColors.length];
          return (
            <React.Fragment key={i}>
              <Oval l={rx} t={cy2 + 0.02} d={0.16} fill={col} line={col === K.panel2 ? K.line : undefined} />
              <Txt l={rx + 0.26} t={cy2 - 0.05} w={rw - 0.26} h={0.28} size={10.5} valign="middle" color={K.muted}>
                <span style={{ color: K.ink, fontWeight: 700 }}>{seg[0] + '   '}</span>
                <span>{seg[1]}%</span>
              </Txt>
            </React.Fragment>
          );
        })}
        {items.length > 0 && (
          <>
            <Rect l={rx} t={6.0} w={rw} h={0.85} fill={K.panel} line={false} shadow={false} />
            <Txt l={rx + 0.2} t={6.0} w={rw - 0.4} h={0.85} size={10.5} lh={1.2} valign="middle" color={K.body}>
              <span style={{ fontWeight: 700, color: doneN === items.length ? K.done : K.active }}>{`${doneN} / ${items.length}  `}</span>
              <span>entity setup steps complete</span>
            </Txt>
          </>
        )}
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 6 — COMPETITIVE */
// New slide: the landscape table on the left (name / category / stage / gap),
// the numbered edges on the right, and the whitespace claim as a callout.
const SlideCompetitive: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const cp = d.competitive || {};
  const rows: Array<[string, string, string, string]> = Array.isArray(cp.competitors) ? cp.competitors : [];
  const edges: string[] = Array.isArray(cp.edges) ? cp.edges : [];
  const lx = ML, lw = 7.3;
  const rx = 8.35, rw = 4.28;
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={cp.eyebrow} idx={cp.idx} />
        <Title text={cp.title} path="competitive.title" editable={editable} onEdit={onEdit} />

        <Txt l={lx} t={2.0} w={lw} h={0.3} size={10} bold spacing={1} color={K.muted}>{cp.tableLabel}</Txt>
        {rows.map((r, i) => {
          const ry = 2.5 + i * 0.94;
          return (
            <React.Fragment key={i}>
              <Rect l={lx} t={ry} w={lw} h={0.8} r={0.08} />
              <Txt l={lx + 0.24} t={ry + 0.13} w={2.0} h={0.32} size={13.5} bold valign="middle" color={K.ink}>{r[0]}</Txt>
              <Txt l={lx + 0.24} t={ry + 0.46} w={2.0} h={0.24} size={9.5} bold spacing={0.5} valign="middle" color={K.accent}>{String(r[1] || '').toUpperCase()}</Txt>
              <Txt l={lx + 2.3} t={ry} w={1.0} h={0.8} size={10} valign="middle" color={K.muted}>{r[2]}</Txt>
              <Txt l={lx + 3.4} t={ry + 0.1} w={lw - 3.6} h={0.6} size={10.5} lh={1.15} valign="middle" color={K.body}>{r[3]}</Txt>
            </React.Fragment>
          );
        })}

        <Txt l={rx} t={2.0} w={rw} h={0.3} size={11} bold spacing={1} color={K.accent}>{cp.edgeLabel}</Txt>
        {edges.map((e, i) => {
          const ey = 2.5 + i * 0.98;
          return (
            <React.Fragment key={i}>
              <Txt l={rx} t={ey} w={0.55} h={0.5} size={18} bold valign="top" color={K.accentMid}>{String(i + 1).padStart(2, '0')}</Txt>
              <Txt l={rx + 0.6} t={ey} w={rw - 0.6} h={0.85} size={12.5} bold valign="top" lh={1.15} color={K.ink}>{e}</Txt>
            </React.Fragment>
          );
        })}
        <Rect l={rx} t={5.6} w={rw} h={1.2} fill={K.accentSoft} line={false} shadow={false} />
        <Ed l={rx + 0.24} t={5.75} w={rw - 0.48} h={0.9} size={11.5} italic lh={1.2} valign="top" color={K.ink}
          value={cp.whitespace} path="competitive.whitespace" editable={editable} onEdit={onEdit} />
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 7 — TRACTION */
// New slide: monthly revenue trend (area chart + MRR + growth) on the left,
// revenue mix bars and the takeaway callout on the right.
const SlideTraction: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const tr = d.traction || {};
  const trendY: number[] = Array.isArray(tr.trendY) ? tr.trendY : [];
  const trendX: string[] = Array.isArray(tr.trendX) ? tr.trendX : [];
  const trendLabels: string[] = Array.isArray(tr.trendLabels) ? tr.trendLabels : [];
  const lastLabel = trendLabels.length ? trendLabels[trendLabels.length - 1] : '';
  const mix: Array<[string, string, number]> = Array.isArray(tr.mix) ? tr.mix : [];
  const lx = ML, lw = 6.6;
  const rx = 7.9, rw = 4.73;
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={tr.eyebrow} idx={tr.idx} />
        <Title text={tr.title} path="traction.title" editable={editable} onEdit={onEdit} />

        <Txt l={lx} t={2.0} w={lw} h={0.3} size={10} bold spacing={1} color={K.muted}>{tr.trendLabel}</Txt>
        <Txt l={lx} t={2.35} w={3.4} h={0.75} size={40} bold valign="middle" color={K.accent}>{tr.mrr}</Txt>
        <Txt l={lx} t={3.12} w={3.4} h={0.3} size={11} bold spacing={1} color={K.muted}>{tr.mrrLabel}</Txt>
        <Txt l={lx + 3.6} t={2.45} w={3.0} h={0.45} size={20} bold valign="middle" color={K.done}>{tr.growth}</Txt>
        <Txt l={lx + 3.6} t={2.95} w={3.0} h={0.3} size={10} color={K.muted}>{tr.growthNote}</Txt>
        <AreaChart l={lx} t={3.75} w={lw} h={2.5} values={trendY} labels={trendX} color={K.accent} />
        <Txt l={lx + lw - 1.2} t={3.8} w={1.2} h={0.35} size={14} bold align="right" color={K.accent}>{lastLabel}</Txt>

        <Txt l={rx} t={2.0} w={rw} h={0.3} size={10} bold spacing={1} color={K.muted}>{tr.mixLabel}</Txt>
        {mix.map((mx, i) => {
          const my = 2.5 + i * 0.85;
          return (
            <React.Fragment key={i}>
              <Txt l={rx} t={my} w={rw - 1.7} h={0.3} size={12.5} bold valign="middle" color={K.ink}>{mx[0]}</Txt>
              <Txt l={rx + rw - 1.7} t={my} w={1.7} h={0.3} size={12} bold align="right" valign="middle" color={i === 0 ? K.accent : K.body}>
                {`${mx[1]}  ·  ${mx[2]}%`}
              </Txt>
              <Bar l={rx} t={my + 0.36} w={rw} h={0.17} pct={Number(mx[2]) / 100} fill={i === 0 ? K.accent : K.accentMid} />
            </React.Fragment>
          );
        })}
        <Rect l={rx} t={5.55} w={rw} h={1.25} fill={K.accentSoft} line={false} shadow={false} />
        <Ed l={rx + 0.24} t={5.72} w={rw - 0.48} h={0.95} size={11.5} italic lh={1.2} valign="top" color={K.ink}
          value={tr.takeaway} path="traction.takeaway" editable={editable} onEdit={onEdit} />
        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 6 — PRODUCT DEMO */
// Slot 6 in the canonical order. Mirrors `productDemo()` in buildDeck.js 1:1:
// a left media frame (screenshot when present, otherwise a play-glyph "add a
// demo" placeholder) with a caption, and a right column carrying the
// walkthrough copy plus the live-demo + demo-video links. All copy fields are
// inline-editable via the `productDemo.*` dotted-key contract.
const SlideProductDemo: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const pd = d.productDemo || {};
  const mediaX = ML, mediaY = 2.15, mediaW = 7.05, mediaH = 4.0;
  const shot = typeof pd.screenshot === 'string' ? pd.screenshot.trim() : '';
  const rx = 8.05, rw = W - MARGIN - rx;
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={pd.eyebrow} idx={pd.idx} />
        <Title text={pd.title} path="productDemo.title" editable={editable} onEdit={onEdit} />

        {/* media frame */}
        <Rect l={mediaX} t={mediaY} w={mediaW} h={mediaH} r={0.12} fill={K.panel} line={K.line} shadow={false} />
        {shot ? (
          <div style={{
            position: 'absolute', left: inch(mediaX + 0.12), top: inch(mediaY + 0.12),
            width: inch(mediaW - 0.24), height: inch(mediaH - 0.24), borderRadius: inch(0.08),
            overflow: 'hidden', background: K.panel2,
          }}>
            <img src={shot} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        ) : (
          <>
            <Oval l={mediaX + mediaW / 2 - 0.55} t={mediaY + mediaH / 2 - 0.9} d={1.1} fill={K.accentSoft} shadow={false}>
              <svg width={inch(0.4)} height={inch(0.4)} viewBox="0 0 24 24" fill={K.accent}><path d="M8 5v14l11-7z" /></svg>
            </Oval>
            <Txt l={mediaX} t={mediaY + mediaH / 2 + 0.35} w={mediaW} h={0.4} size={12} bold align="center" color={K.muted}>
              Add a demo video or screenshot on the project
            </Txt>
          </>
        )}
        <Ed l={mediaX} t={mediaY + mediaH + 0.16} w={mediaW} h={0.5} size={10.5} italic lh={1.1} valign="top"
          color={K.muted} value={pd.caption} path="productDemo.caption" editable={editable} onEdit={onEdit} placeholder="Caption" />

        {/* right column */}
        <Txt l={rx} t={2.15} w={rw} h={0.3} size={10} bold spacing={1} color={K.accent}>{pd.walkthroughLabel || 'WALKTHROUGH'}</Txt>
        <Ed l={rx} t={2.5} w={rw} h={2.0} size={13.5} lh={1.22} valign="top" color={K.body}
          value={pd.body} path="productDemo.body" editable={editable} onEdit={onEdit} placeholder="Describe the demo flow" />

        <Txt l={rx} t={4.75} w={rw} h={0.3} size={9.5} bold spacing={1} color={K.muted}>LIVE DEMO</Txt>
        <Rect l={rx} t={5.05} w={rw} h={0.58} r={0.08} fill={K.accentSoft} line={false} shadow={false} />
        <Ed l={rx + 0.22} t={5.05} w={rw - 0.44} h={0.58} size={12} bold valign="middle" color={K.accent}
          value={pd.liveUrl} path="productDemo.liveUrl" editable={editable} onEdit={onEdit} placeholder="Add a live demo URL" />

        <Txt l={rx} t={5.85} w={rw} h={0.3} size={9.5} bold spacing={1} color={K.muted}>DEMO VIDEO</Txt>
        <Rect l={rx} t={6.15} w={rw} h={0.58} r={0.08} fill={K.panel} line={K.line} shadow={false} />
        <Ed l={rx + 0.22} t={6.15} w={rw - 0.44} h={0.58} size={12} bold valign="middle" color={K.ink}
          value={pd.videoUrl} path="productDemo.videoUrl" editable={editable} onEdit={onEdit} placeholder="Add a demo video URL" />

        <Footer brand={d.brand} />
      </div>
    </Slide16x9>
  );
};

/* 11 — REVIEW THE DEAL / DEAL READINESS */
// Slot 11, the closing slide. Mirrors `deal()` in buildDeck.js 1:1: a dark
// frame with the diligence checklist on the left, numbered next-steps on the
// right, then the closing line + contact. Title / closing line / contact are
// inline-editable via the `deal.*` dotted-key contract.
const SlideDealReadiness: React.FC<SlideProps> = ({ d, editable, onEdit }) => {
  const dl = d.deal || {};
  const ready: Array<[string, string]> = Array.isArray(dl.ready) ? dl.ready : [];
  const steps: Array<[string, string]> = Array.isArray(dl.steps) ? dl.steps : [];
  const lx = ML, lw = 6.0;
  const rx = 7.35, rw = 5.25;
  return (
    <Slide16x9 bg={K.white} ink={K.ink} font={FF}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Eyebrow label={dl.eyebrow} idx={dl.idx} />
        <Ed l={ML} t={1.05} w={5.7} h={0.95} size={30} bold lh={1.04} valign="top" color={K.ink}
          value={dl.title} path="deal.title" editable={editable} onEdit={onEdit} />
        <Txt l={lx} t={2.15} w={lw} h={0.3} size={10} bold spacing={1} color={K.muted}>{dl.diligenceLabel}</Txt>
        {ready.map((r, i) => {
          const ry = 2.6 + i * 0.66;
          return (
            <React.Fragment key={i}>
              <Rect l={lx} t={ry} w={lw} h={0.55} r={0.06} fill={K.panel} line={K.line} shadow={false} />
              <Oval l={lx + 0.22} t={ry + 0.185} d={0.18} fill={K.accentSoft} shadow={false} />
              <Txt l={lx + 0.6} t={ry} w={lw - 2.3} h={0.55} size={13} bold valign="middle" color={K.ink}>{r[0]}</Txt>
              <Txt l={lx + lw - 1.85} t={ry} w={1.7} h={0.55} size={12} bold align="right" valign="middle" color={r[1] === 'Open' || r[1] === 'Included' ? K.done : K.active}>{r[1]}</Txt>
            </React.Fragment>
          );
        })}

        <Rect l={rx - .28} t={1.0} w={5.0} h={5.9} r={0.12} fill={K.panel} line={K.line} shadow={false} />
        <Txt l={rx} t={2.15} w={rw} h={0.3} size={10} bold spacing={1} color={K.muted}>{dl.nextLabel}</Txt>
        {steps.map((st, i) => {
          const sy = 2.6 + i * 0.85;
          return (
            <React.Fragment key={i}>
              <Oval l={rx} t={sy} d={0.5} fill={K.accentSoft} shadow={false} />
              <Txt l={rx} t={sy} w={0.5} h={0.5} size={16} bold align="center" valign="middle" color={K.accent}>{st[0]}</Txt>
              <Txt l={rx + 0.7} t={sy} w={rw - 0.7} h={0.5} size={14} bold valign="middle" color={K.ink}>{st[1]}</Txt>
            </React.Fragment>
          );
        })}
        <div style={{ position: 'absolute', left: inch(rx), top: inch(5.55), width: inch(rw), height: pt(1), background: K.line }} />
        <Ed l={rx} t={5.7} w={rw} h={0.5} size={15} bold lh={1.1} valign="top" color={K.ink}
          value={dl.closingLine} path="deal.closingLine" editable={editable} onEdit={onEdit} />
        <Ed l={rx} t={6.2} w={rw} h={0.4} size={12} valign="top" color={K.accent}
          value={dl.contact} path="deal.contact" editable={editable} onEdit={onEdit} />
        <Txt l={ML} t={7.06} w={6} h={0.3} size={8} spacing={1} valign="middle" color={K.faint}>{d.brand.lab}</Txt>
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
