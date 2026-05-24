/**
 * axal_spinout_demoday_app.tsx — Task #15
 *
 * Axal 30-day Spin-Out Lab — Demo Day deck.
 *
 * Self-contained React + TS + Tailwind + Framer Motion adapter that
 * renders 14 fixed slides in one of four visual variants:
 *
 *   editorial      — warm cream + serif, magazine-style
 *   product_first  — dark ink + bold sans, product mock-ups front-and-centre
 *   data_dense     — cool greys + mono tabular, compact KPI panels
 *   manifesto      — high-contrast ember on near-black, gigantic type
 *
 * Audience: Axal-network investors + partners reviewing Spin-Out Lab
 * graduates on demo day. The deck binds 1:1 to canonical Lab data
 * (projects, discovery_interviews, roadmap_okrs, score_snapshots,
 * captable_holders, financial_models, spinout_lab_milestones,
 * advisor_answers) — every number that appears on screen is sourced
 * from a real row, or honestly marked "—" via the <Nudge> placeholder.
 * No fabricated traction, no synthetic quotes.
 *
 * Variant choice is a user preference, persisted to localStorage at
 * `axal:deck:axal_spinout_demoday:variant`. The switcher is only
 * visible when `editable` is true (i.e. in the author surface, not on
 * shared/printed/exported renderings — those bake in whichever variant
 * was last selected on the author side).
 *
 * Data flow: the worker's /api/decks/apply-method handler short-circuits
 * for `method_id === 'axal_spinout_demoday'`, calls
 * `fillAxalSpinoutDemoDay()` in `services/decks/axalSpinoutDemoDay.ts`,
 * and writes the result as per-section JSON-encoded paragraph fields.
 * `buildTemplateData()` in PitchDeckPrintPage flattens those into the
 * `data` prop this component receives; we JSON-parse and merge onto
 * SAMPLE_DATA via the same defensive `mergeShape()` pattern used in
 * `investor_appendix_app.tsx` (with the object/non-object guard).
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { DeckProps } from '../DeckBase';

/* ─────────────────────────── tokens ─────────────────────────── */

const PALETTES = {
  editorial: {
    bg: '#F7F2E8', surface: '#FFFFFF', ink: '#1A1814', inkSoft: '#3A352C',
    muted: '#7A7268', accent: '#B8431E', accentSoft: '#F2D9CB', rule: '#E5DCC9',
    chip: '#EBE1CC', good: '#3F6650', warn: '#B68A2E',
  },
  product_first: {
    bg: '#0B0B10', surface: '#15151D', ink: '#F5F4F0', inkSoft: '#C9C6BE',
    muted: '#7E7A72', accent: '#FF7A45', accentSoft: '#3A1F14', rule: '#26262F',
    chip: '#1E1E27', good: '#7EC596', warn: '#F0C36A',
  },
  data_dense: {
    bg: '#F1F3F5', surface: '#FFFFFF', ink: '#0F172A', inkSoft: '#334155',
    muted: '#64748B', accent: '#0E5FBF', accentSoft: '#D8E6F6', rule: '#D8DEE5',
    chip: '#E2E8EE', good: '#107E5C', warn: '#A26200',
  },
  manifesto: {
    bg: '#0A0A0C', surface: '#141416', ink: '#FFF8EC', inkSoft: '#D9D1BF',
    muted: '#7A7368', accent: '#FF4D17', accentSoft: '#3A1808', rule: '#20201F',
    chip: '#1A1A1C', good: '#9DDDA8', warn: '#FFD06A',
  },
} as const;

export type VariantId = keyof typeof PALETTES;
const VARIANTS: VariantId[] = ['editorial', 'product_first', 'data_dense', 'manifesto'];
const VARIANT_LABEL: Record<VariantId, string> = {
  editorial: 'Editorial',
  product_first: 'Product-first',
  data_dense: 'Data-dense',
  manifesto: 'Manifesto',
};

const FONTS = {
  editorial: {
    display: '"Playfair Display","GT Sectra",Georgia,serif',
    sans: '"Inter","Helvetica Neue",system-ui,sans-serif',
    mono: '"JetBrains Mono",ui-monospace,Menlo,monospace',
    body: '"Source Serif Pro",Georgia,serif',
  },
  product_first: {
    display: '"Inter","Helvetica Neue",system-ui,sans-serif',
    sans: '"Inter","Helvetica Neue",system-ui,sans-serif',
    mono: '"JetBrains Mono",ui-monospace,Menlo,monospace',
    body: '"Inter","Helvetica Neue",system-ui,sans-serif',
  },
  data_dense: {
    display: '"Inter","Helvetica Neue",system-ui,sans-serif',
    sans: '"Inter","Helvetica Neue",system-ui,sans-serif',
    mono: '"JetBrains Mono",ui-monospace,Menlo,monospace',
    body: '"Inter","Helvetica Neue",system-ui,sans-serif',
  },
  manifesto: {
    display: '"Inter","Helvetica Neue",system-ui,sans-serif',
    sans: '"Inter","Helvetica Neue",system-ui,sans-serif',
    mono: '"JetBrains Mono",ui-monospace,Menlo,monospace',
    body: '"Inter","Helvetica Neue",system-ui,sans-serif',
  },
} as const;

const VARIANT_KEY = 'axal:deck:axal_spinout_demoday:variant';

/* ─────────────────────────── types ─────────────────────────── */

export type Metric = { label: string; value: string; sub?: string };
export type Founder = { name: string; role: string; bio?: string };
export type Milestone = { key: string; label: string; done: boolean; completed_at?: string };
export type WeekBlock = {
  week: number;
  title: string;
  caption: string;
  status: 'complete' | 'in_progress' | 'upcoming';
  milestones: Milestone[];
};
export type InterviewSummary = { name: string; role: string; takeaway: string };
export type Player = { name: string; x: number; y: number; is_us?: boolean };
export type FundUse = { label: string; pct: number };

export type SpinoutDemoDayData = {
  meta: {
    project_name: string; sector: string;
    founder_name: string; contact_email: string;
    presented_on: string;
    week: number; days_remaining: number; lab_active: boolean;
    is_sample: boolean;
  };
  cover: { eyebrow: string; headline: string; sub: string; location: string };
  thesis: { eyebrow: string; headline: string; body: string; pull_quote: string };
  problem: { eyebrow: string; headline: string; body: string; signals: string[] };
  insight: { eyebrow: string; headline: string; body: string; evidence: Metric[] };
  product: { eyebrow: string; headline: string; body: string; capabilities: string[] };
  market: {
    eyebrow: string; headline: string;
    tam: string; sam: string; som: string;
    why_now: string[];
  };
  traction: {
    eyebrow: string; headline: string;
    metrics: Metric[];
    interviews_count: number;
    interviews_recent: InterviewSummary[];
  };
  lab_progress: {
    eyebrow: string; headline: string;
    weeks: WeekBlock[];
  };
  business_model: {
    eyebrow: string; headline: string; body: string;
    unit_econ: Metric[];
  };
  gtm: {
    eyebrow: string; headline: string;
    channels: { name: string; line: string }[];
    plan_90d: string[];
  };
  competition: {
    eyebrow: string; headline: string;
    x_label: string; y_label: string;
    players: Player[];
    wedge: string;
  };
  team: {
    eyebrow: string; headline: string;
    founders: Founder[];
    advisors: Founder[];
    scoring: { total_score?: number; tier?: string; team_total?: number; market_total?: number };
  };
  ask: {
    eyebrow: string; headline: string;
    raise_amount: string; runway: string;
    use_of_funds: FundUse[];
    next_milestones: string[];
    contact: string;
  };
  closing: { eyebrow: string; headline: string; body: string; signoff: string; contact: string };
};

/* ─────────────────────────── sample data ─────────────────────────── */

export const SAMPLE_DATA: SpinoutDemoDayData = {
  meta: {
    project_name: 'Your Company',
    sector: 'Pre-incorporation',
    founder_name: '—',
    contact_email: '—',
    presented_on: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    week: 1, days_remaining: 28, lab_active: false, is_sample: true,
  },
  cover: {
    eyebrow: 'Axal · 30-Day Spin-Out Lab · Demo Day',
    headline: 'Your story, in 14 slides.',
    sub: 'A pre-incorporation thesis, sharpened across 30 days of Discovery, OKRs, Scoring and Cap-Table prep.',
    location: 'Axal Network · Demo Day',
  },
  thesis: {
    eyebrow: '01 · The bet',
    headline: 'What we believe — and why now is the moment.',
    body: 'The Spin-Out Lab is built for founders who have a credible insight but no entity yet. This deck is the artifact of that 30-day sprint.',
    pull_quote: '"We chose to spend 30 days proving the thesis before we spent a dollar incorporating it."',
  },
  problem: {
    eyebrow: '02 · The problem',
    headline: 'Why this is broken today.',
    body: '—',
    signals: ['—', '—', '—'],
  },
  insight: {
    eyebrow: '03 · The insight',
    headline: 'What we learned that the market missed.',
    body: '—',
    evidence: [
      { label: 'Discovery interviews', value: '—', sub: 'logged in Lab' },
      { label: 'Distinct pains', value: '—', sub: 'tagged across interviews' },
      { label: 'Validated hypotheses', value: '—', sub: 'evidence-backed' },
    ],
  },
  product: {
    eyebrow: '04 · The product',
    headline: 'A first cut of what we will ship.',
    body: '—',
    capabilities: ['—', '—', '—'],
  },
  market: {
    eyebrow: '05 · The market',
    headline: 'Sized for a real outcome.',
    tam: '—', sam: '—', som: '—',
    why_now: ['—', '—', '—'],
  },
  traction: {
    eyebrow: '06 · Early signal',
    headline: 'Who we talked to, what they said.',
    metrics: [
      { label: 'Interviews', value: '—' },
      { label: 'Letters of intent', value: '—' },
      { label: 'Score', value: '—', sub: 'Axal scoring' },
    ],
    interviews_count: 0,
    interviews_recent: [],
  },
  lab_progress: {
    eyebrow: '07 · 30-day sprint',
    headline: 'How we used the Lab.',
    weeks: [
      {
        week: 1, title: 'Discovery', caption: 'Talk to 8+ people. Tag pains. Form hypotheses.',
        status: 'upcoming', milestones: [
          { key: 'interview_5_logged', label: '5 interviews logged', done: false },
          { key: 'pains_clustered', label: 'Pains clustered', done: false },
          { key: 'hypothesis_drafted', label: 'Hypothesis drafted', done: false },
        ],
      },
      {
        week: 2, title: 'Shape', caption: 'OKRs. Roadmap. First scoring pass.',
        status: 'upcoming', milestones: [
          { key: 'okrs_drafted', label: 'OKRs drafted', done: false },
          { key: 'roadmap_outlined', label: 'Roadmap outlined', done: false },
          { key: 'score_baseline', label: 'Baseline score', done: false },
        ],
      },
      {
        week: 3, title: 'Validate', caption: 'Sharpen the model. Stress-test the cap table.',
        status: 'upcoming', milestones: [
          { key: 'financial_model_v1', label: 'Financial model v1', done: false },
          { key: 'captable_seed', label: 'Cap table seeded', done: false },
          { key: 'score_v2', label: 'Score v2', done: false },
        ],
      },
      {
        week: 4, title: 'Stand up', caption: 'Incorporate, brand, ship the deck.',
        status: 'upcoming', milestones: [
          { key: 'brand_kit', label: 'Brand kit', done: false },
          { key: 'pitch_deck_v1', label: 'Pitch deck v1', done: false },
          { key: 'incorporation_completed', label: 'Incorporated', done: false },
        ],
      },
    ],
  },
  business_model: {
    eyebrow: '08 · How we make money',
    headline: 'A model that scales with the value we create.',
    body: '—',
    unit_econ: [
      { label: 'ACV', value: '—' },
      { label: 'Gross margin', value: '—' },
      { label: 'Payback', value: '—' },
    ],
  },
  gtm: {
    eyebrow: '09 · Go-to-market',
    headline: 'First customers, then a wedge.',
    channels: [
      { name: '—', line: '—' },
      { name: '—', line: '—' },
      { name: '—', line: '—' },
    ],
    plan_90d: ['—', '—', '—'],
  },
  competition: {
    eyebrow: '10 · Landscape',
    headline: 'Where we sit, where we move.',
    x_label: 'Generalist → Specialist',
    y_label: 'Manual → AI-native',
    players: [
      { name: 'Incumbent A', x: 25, y: 30 },
      { name: 'Incumbent B', x: 70, y: 25 },
      { name: 'New entrant', x: 35, y: 70 },
      { name: 'Us', x: 78, y: 82, is_us: true },
    ],
    wedge: '—',
  },
  team: {
    eyebrow: '11 · Team',
    headline: 'Why we are the founders to build this.',
    founders: [], advisors: [],
    scoring: {},
  },
  ask: {
    eyebrow: '12 · Ask',
    headline: 'What we are raising and what it buys.',
    raise_amount: '—', runway: '—',
    use_of_funds: [
      { label: 'Engineering', pct: 50 },
      { label: 'Go-to-market', pct: 30 },
      { label: 'Operations', pct: 20 },
    ],
    next_milestones: ['—', '—', '—'],
    contact: '—',
  },
  closing: {
    eyebrow: '14 · Thank you',
    headline: 'Built in the Axal Spin-Out Lab.',
    body: '30 days. 14 slides. One thesis, sharpened by the network.',
    signoff: '— The founder',
    contact: '—',
  },
};

/* ─────────────────────────── mergeShape ─────────────────────────── */

// Defensive deep-merge mirroring the canonical pattern in
// `investor_appendix_app.tsx` (see lines 2877–2899). The type-mismatch
// guard at the object branch prevents a primitive in `incoming` (which
// can happen if the editor accidentally writes a flat string at a
// nested path) from clobbering an entire typed sub-tree.
function mergeShape<T>(base: T, incoming: any): T {
  if (incoming === undefined || incoming === null) return base;
  if (Array.isArray(base)) {
    return (Array.isArray(incoming) && incoming.length > 0 ? incoming : base) as unknown as T;
  }
  if (typeof base === 'object' && base !== null) {
    if (typeof incoming !== 'object' || Array.isArray(incoming)) return base;
    const out: any = { ...(base as any) };
    for (const k of Object.keys(incoming)) {
      const bv = (base as any)[k];
      const iv = (incoming as any)[k];
      if (iv === undefined || iv === null || iv === '') continue;
      if (bv !== undefined && bv !== null) out[k] = mergeShape(bv, iv);
      else out[k] = iv;
    }
    return out;
  }
  return (incoming as T) ?? base;
}

/** Parses the worker's per-section JSON-encoded paragraph fields. */
function hydrate(flat: Record<string, any>): SpinoutDemoDayData {
  let merged: SpinoutDemoDayData = structuredClone(SAMPLE_DATA);
  if (!flat || typeof flat !== 'object') return merged;
  for (const k of Object.keys(flat)) {
    if (!k.startsWith('axal_spinout_section_')) continue;
    const section = k.slice('axal_spinout_section_'.length) as keyof SpinoutDemoDayData;
    const raw = flat[k];
    let parsed: any = null;
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
    } else if (typeof raw === 'object' && raw !== null) {
      parsed = raw;
    }
    if (parsed && (merged as any)[section] !== undefined) {
      (merged as any)[section] = mergeShape((merged as any)[section], parsed);
    }
  }
  return merged;
}

/* ─────────────────────────── primitives ─────────────────────────── */

const Editable: React.FC<{
  value: string;
  editable?: boolean;
  onEdit?: (path: string, v: string) => void;
  path: string;
  multiline?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ value, editable, onEdit, path, multiline, className, style }) => (
  <span
    contentEditable={!!editable}
    suppressContentEditableWarning
    onBlur={(e) => onEdit?.(path, (multiline ? e.currentTarget.innerText : e.currentTarget.textContent) || '')}
    className={`outline-none ${editable ? 'focus:bg-yellow-100/30 rounded-sm' : ''} ${className ?? ''}`}
    style={style}
  >
    {value}
  </span>
);

const Nudge: React.FC<{ children: React.ReactNode; tone?: 'soft' | 'loud' }> = ({ children, tone = 'soft' }) => (
  <span
    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] tracking-[0.18em] uppercase font-medium"
    style={{
      background: tone === 'loud' ? 'rgba(184,67,30,0.12)' : 'rgba(0,0,0,0.04)',
      color: tone === 'loud' ? '#B8431E' : '#7A7268',
      fontFamily: FONTS.editorial.mono,
    }}
  >
    {children}
  </span>
);

const Eyebrow: React.FC<{ children: React.ReactNode; color: string; font: string }> = ({ children, color, font }) => (
  <div className="flex items-center gap-3 mb-4">
    <span className="h-px w-8" style={{ background: color }} />
    <span className="text-[10px] tracking-[0.32em] uppercase font-medium" style={{ color, fontFamily: font }}>
      {children}
    </span>
  </div>
);

type Tokens = typeof PALETTES['editorial'];
type FontSet = typeof FONTS['editorial'];

function tokensFor(v: VariantId): { c: Tokens; f: FontSet } {
  return { c: PALETTES[v] as Tokens, f: FONTS[v] as FontSet };
}

/** Heading sizing curve per variant — manifesto goes biggest. */
function displaySize(v: VariantId, base: number): number {
  if (v === 'manifesto') return Math.round(base * 1.4);
  if (v === 'data_dense') return Math.round(base * 0.78);
  if (v === 'product_first') return Math.round(base * 0.92);
  return base;
}

const Frame: React.FC<{
  v: VariantId;
  step: number;
  total: number;
  chapter: string;
  bg?: string;
  ink?: string;
  children: React.ReactNode;
}> = ({ v, step, total, chapter, bg, ink, children }) => {
  const { c, f } = tokensFor(v);
  const _bg = bg ?? c.bg;
  const _ink = ink ?? c.ink;
  const railColor = v === 'product_first' || v === 'manifesto' ? c.muted : c.muted;
  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: _bg, color: _ink, fontFamily: f.sans }}
    >
      <div
        className="absolute inset-x-0 top-0 h-10 flex items-center justify-between px-12 text-[10px] tracking-[0.32em] uppercase"
        style={{ color: railColor, fontFamily: f.mono }}
      >
        <span style={{ fontFamily: f.body, fontStyle: v === 'editorial' ? 'italic' : 'normal' }}>{chapter}</span>
        <span>
          {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>
      <div className="absolute inset-x-0 top-10 bottom-8 px-12 py-6">{children}</div>
      <div
        className="absolute inset-x-12 bottom-3 flex items-center justify-between text-[10px] tracking-[0.24em] uppercase"
        style={{ color: railColor, fontFamily: f.mono }}
      >
        <span>Axal · 30-Day Spin-Out Lab</span>
        <span>{VARIANT_LABEL[v]}</span>
      </div>
    </div>
  );
};

/* ─────────────────────────── shared atoms ─────────────────────────── */

const MetricCell: React.FC<{ m: Metric; v: VariantId; bordered?: boolean }> = ({ m, v, bordered }) => {
  const { c, f } = tokensFor(v);
  const isEmpty = !m.value || m.value === '—';
  return (
    <div
      className="flex flex-col gap-1 px-4 py-3"
      style={{
        background: bordered ? c.surface : 'transparent',
        borderRadius: 6,
        border: bordered ? `1px solid ${c.rule}` : 'none',
      }}
    >
      <div className="text-[10px] tracking-[0.22em] uppercase" style={{ color: c.muted, fontFamily: f.mono }}>
        {m.label}
      </div>
      <div
        className="font-semibold leading-none"
        style={{
          fontFamily: f.display,
          fontSize: v === 'data_dense' ? 28 : v === 'manifesto' ? 48 : 36,
          color: isEmpty ? c.muted : c.ink,
        }}
      >
        {m.value}
      </div>
      {m.sub && (
        <div className="text-[11px]" style={{ color: c.muted, fontFamily: f.sans }}>
          {m.sub}
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────── SVG artwork ─────────────────────────── */

const SunRise: React.FC<{ accent: string }> = ({ accent }) => (
  <svg viewBox="0 0 1200 720" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="ax-sky" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#1A1814" />
        <stop offset="0.7" stopColor="#3A2418" />
        <stop offset="1" stopColor={accent} />
      </linearGradient>
      <radialGradient id="ax-sun" cx="50%" cy="50%">
        <stop offset="0" stopColor="#FFE7BB" />
        <stop offset="1" stopColor={accent} stopOpacity="0" />
      </radialGradient>
    </defs>
    <rect width="1200" height="720" fill="url(#ax-sky)" />
    <circle cx="600" cy="500" r="280" fill="url(#ax-sun)" />
    <circle cx="600" cy="500" r="80" fill="#FFD68C" />
    <path d="M0,600 Q300,560 600,580 T1200,590 L1200,720 L0,720 Z" fill="#0A0908" fillOpacity="0.85" />
    <path d="M0,660 Q400,640 800,655 T1200,665 L1200,720 L0,720 Z" fill="#0A0908" />
  </svg>
);

const SparkArc: React.FC<{ pct: number; color: string; muted: string }> = ({ pct, color, muted }) => {
  const p = Math.max(0, Math.min(100, pct));
  const cx = 60, cy = 60, r = 50;
  const ang = (p / 100) * Math.PI * 2 - Math.PI / 2;
  const x = cx + r * Math.cos(ang);
  const y = cy + r * Math.sin(ang);
  const large = p > 50 ? 1 : 0;
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={muted} strokeOpacity={0.2} strokeWidth={8} />
      {p > 0 && (
        <path
          d={`M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x} ${y}`}
          fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
        />
      )}
    </svg>
  );
};

const ProductFrame: React.FC<{ v: VariantId; label: string }> = ({ v, label }) => {
  const { c, f } = tokensFor(v);
  return (
    <svg viewBox="0 0 540 360" className="w-full h-full">
      <rect x="0" y="0" width="540" height="360" rx="12" fill={c.surface} stroke={c.rule} />
      <rect x="0" y="0" width="540" height="28" rx="12" fill={c.chip} />
      <circle cx="14" cy="14" r="4" fill="#FF5F57" />
      <circle cx="28" cy="14" r="4" fill="#FEBC2E" />
      <circle cx="42" cy="14" r="4" fill="#28C840" />
      <rect x="24" y="56" width="120" height="280" rx="6" fill={c.bg} />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="36" y={76 + i * 36} width={90 - (i % 2) * 18} height="10" rx="3" fill={c.rule} />
      ))}
      <rect x="160" y="56" width="356" height="76" rx="6" fill={c.bg} />
      <rect x="172" y="74" width="180" height="14" rx="3" fill={c.ink} fillOpacity="0.7" />
      <rect x="172" y="96" width="320" height="10" rx="3" fill={c.muted} fillOpacity="0.5" />
      <rect x="172" y="112" width="240" height="10" rx="3" fill={c.muted} fillOpacity="0.4" />
      <rect x="160" y="148" width="170" height="120" rx="6" fill={c.bg} />
      <rect x="340" y="148" width="176" height="120" rx="6" fill={c.bg} />
      <rect x="160" y="276" width="356" height="60" rx="6" fill={c.bg} />
      <text x="172" y="178" fontFamily={f.mono} fontSize="9" fill={c.muted}>{label}</text>
      <path d="M180,250 L208,222 L240,238 L272,210 L308,228 L330,200" stroke={c.accent} strokeWidth="2" fill="none" />
    </svg>
  );
};

const MarketTriangle: React.FC<{ tam: string; sam: string; som: string; v: VariantId }> = ({ tam, sam, som, v }) => {
  const { c, f } = tokensFor(v);
  return (
    <svg viewBox="0 0 360 320" className="w-full h-full">
      <polygon points="180,20 340,300 20,300" fill={c.accentSoft} stroke={c.accent} strokeWidth="1.5" />
      <polygon points="180,90 270,255 90,255" fill={c.accent} fillOpacity="0.45" stroke={c.accent} strokeWidth="1.2" />
      <polygon points="180,170 230,240 130,240" fill={c.accent} stroke={c.accent} strokeWidth="1.2" />
      <text x="356" y="20" fontFamily={f.mono} fontSize="10" fill={c.muted} textAnchor="end">TAM · {tam}</text>
      <text x="356" y="100" fontFamily={f.mono} fontSize="10" fill={c.muted} textAnchor="end">SAM · {sam}</text>
      <text x="356" y="180" fontFamily={f.mono} fontSize="10" fill={c.muted} textAnchor="end">SOM · {som}</text>
    </svg>
  );
};

/* ─────────────────────────── slides ─────────────────────────── */

const TOTAL = 14;

const S01Cover: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  const dark = v === 'product_first' || v === 'manifesto';
  return (
    <Frame v={v} step={1} total={TOTAL} chapter="Cover" bg={dark ? c.bg : c.bg}>
      {(v === 'editorial' || v === 'manifesto') && (
        <div className="absolute inset-0 -z-0 opacity-90">
          <SunRise accent={c.accent} />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(10,9,8,0.0) 30%, rgba(10,9,8,0.85) 100%)' }}
          />
        </div>
      )}
      <div className="relative h-full flex flex-col justify-end pb-10" style={{ color: v === 'data_dense' ? c.ink : '#FFF8EC' }}>
        <Eyebrow color={v === 'data_dense' ? c.accent : '#F7E2B5'} font={f.mono}>
          <Editable value={d.cover.eyebrow} path="cover.eyebrow" editable={editable} onEdit={onEdit} />
        </Eyebrow>
        <h1
          className="leading-[0.96] tracking-[-0.02em]"
          style={{
            fontFamily: f.display, fontWeight: 600,
            fontSize: displaySize(v, 88), maxWidth: 980,
            color: v === 'data_dense' ? c.ink : '#FFF',
          }}
        >
          <Editable value={d.cover.headline} path="cover.headline" editable={editable} onEdit={onEdit} multiline />
        </h1>
        <div
          className="mt-6 max-w-[760px]"
          style={{ fontFamily: f.body, fontSize: 18, color: v === 'data_dense' ? c.inkSoft : '#D9D1BF' }}
        >
          <Editable value={d.cover.sub} path="cover.sub" editable={editable} onEdit={onEdit} multiline />
        </div>
        <div
          className="mt-10 flex items-center gap-6 text-[11px] tracking-[0.24em] uppercase"
          style={{ color: v === 'data_dense' ? c.muted : 'rgba(255,248,236,0.7)', fontFamily: f.mono }}
        >
          <span>{d.meta.project_name}</span>
          <span>·</span>
          <span>{d.cover.location}</span>
          <span>·</span>
          <span>{d.meta.presented_on}</span>
        </div>
        {d.meta.is_sample && (
          <div className="mt-4">
            <Nudge tone="loud">Sample data — apply this template to a project to populate</Nudge>
          </div>
        )}
      </div>
    </Frame>
  );
};

const S02Thesis: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  return (
    <Frame v={v} step={2} total={TOTAL} chapter="Thesis">
      <div className="h-full grid grid-cols-12 gap-10">
        <div className="col-span-7 flex flex-col justify-center">
          <Eyebrow color={c.accent} font={f.mono}>
            <Editable value={d.thesis.eyebrow} path="thesis.eyebrow" editable={editable} onEdit={onEdit} />
          </Eyebrow>
          <h2
            className="leading-[1.02] tracking-[-0.02em] mb-6"
            style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 56), color: c.ink }}
          >
            <Editable value={d.thesis.headline} path="thesis.headline" editable={editable} onEdit={onEdit} multiline />
          </h2>
          <p style={{ fontFamily: f.body, fontSize: 17, lineHeight: 1.55, color: c.inkSoft, maxWidth: 620 }}>
            <Editable value={d.thesis.body} path="thesis.body" editable={editable} onEdit={onEdit} multiline />
          </p>
        </div>
        <div className="col-span-5 flex flex-col justify-center">
          <div
            className="p-6 border-l-2"
            style={{ borderColor: c.accent, background: c.surface, borderRadius: 4 }}
          >
            <div
              className="text-[10px] tracking-[0.32em] uppercase mb-3"
              style={{ color: c.muted, fontFamily: f.mono }}
            >
              Founder voice
            </div>
            <blockquote
              style={{
                fontFamily: f.body,
                fontStyle: v === 'editorial' ? 'italic' : 'normal',
                fontSize: 20, lineHeight: 1.4, color: c.ink,
              }}
            >
              <Editable value={d.thesis.pull_quote} path="thesis.pull_quote" editable={editable} onEdit={onEdit} multiline />
            </blockquote>
            <div className="mt-4 text-[12px]" style={{ color: c.muted, fontFamily: f.sans }}>
              — {d.meta.founder_name || '—'}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
};

const S03Problem: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  return (
    <Frame v={v} step={3} total={TOTAL} chapter="Problem">
      <div className="h-full flex flex-col justify-center max-w-[1040px]">
        <Eyebrow color={c.accent} font={f.mono}>
          <Editable value={d.problem.eyebrow} path="problem.eyebrow" editable={editable} onEdit={onEdit} />
        </Eyebrow>
        <h2
          className="leading-[1.02] tracking-[-0.02em] mb-6"
          style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 64), color: c.ink }}
        >
          <Editable value={d.problem.headline} path="problem.headline" editable={editable} onEdit={onEdit} multiline />
        </h2>
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-7">
            <p style={{ fontFamily: f.body, fontSize: 17, lineHeight: 1.55, color: c.inkSoft }}>
              {d.problem.body === '—' ? (
                <Nudge>Add the problem statement on your project page</Nudge>
              ) : (
                <Editable value={d.problem.body} path="problem.body" editable={editable} onEdit={onEdit} multiline />
              )}
            </p>
          </div>
          <div className="col-span-5">
            <div className="text-[10px] tracking-[0.32em] uppercase mb-3" style={{ color: c.muted, fontFamily: f.mono }}>
              Signals from discovery
            </div>
            <ul className="space-y-3">
              {d.problem.signals.map((s, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="mt-2 inline-block"
                    style={{ width: 14, height: 1, background: c.accent, flexShrink: 0 }}
                  />
                  <span style={{ fontFamily: f.sans, fontSize: 15, color: c.ink }}>
                    {s === '—' ? <Nudge>Log discovery interviews to populate</Nudge> : (
                      <Editable value={s} path={`problem.signals.${i}`} editable={editable} onEdit={onEdit} multiline />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Frame>
  );
};

const S04Insight: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  return (
    <Frame v={v} step={4} total={TOTAL} chapter="Insight">
      <div className="h-full flex flex-col justify-center">
        <Eyebrow color={c.accent} font={f.mono}>
          <Editable value={d.insight.eyebrow} path="insight.eyebrow" editable={editable} onEdit={onEdit} />
        </Eyebrow>
        <h2
          className="leading-[1.02] tracking-[-0.02em] mb-8 max-w-[1100px]"
          style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 60), color: c.ink }}
        >
          <Editable value={d.insight.headline} path="insight.headline" editable={editable} onEdit={onEdit} multiline />
        </h2>
        <div className="grid grid-cols-12 gap-8 items-start">
          <div className="col-span-7">
            <p style={{ fontFamily: f.body, fontSize: 18, lineHeight: 1.5, color: c.inkSoft, maxWidth: 640 }}>
              {d.insight.body === '—' ? (
                <Nudge>Capture the insight in your project description</Nudge>
              ) : (
                <Editable value={d.insight.body} path="insight.body" editable={editable} onEdit={onEdit} multiline />
              )}
            </p>
          </div>
          <div className="col-span-5 grid grid-cols-1 gap-3">
            {d.insight.evidence.map((m, i) => (
              <MetricCell key={i} m={m} v={v} bordered />
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
};

const S05Product: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  const productHeavy = v === 'product_first';
  return (
    <Frame v={v} step={5} total={TOTAL} chapter="Product">
      <div className={`h-full grid grid-cols-12 gap-10 ${productHeavy ? 'items-stretch' : 'items-center'}`}>
        <div className={productHeavy ? 'col-span-5' : 'col-span-6'}>
          <Eyebrow color={c.accent} font={f.mono}>
            <Editable value={d.product.eyebrow} path="product.eyebrow" editable={editable} onEdit={onEdit} />
          </Eyebrow>
          <h2
            className="leading-[1.02] tracking-[-0.02em] mb-6"
            style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 56), color: c.ink }}
          >
            <Editable value={d.product.headline} path="product.headline" editable={editable} onEdit={onEdit} multiline />
          </h2>
          <p style={{ fontFamily: f.body, fontSize: 16, lineHeight: 1.55, color: c.inkSoft, marginBottom: 24 }}>
            {d.product.body === '—' ? (
              <Nudge>Add your solution description on the project page</Nudge>
            ) : (
              <Editable value={d.product.body} path="product.body" editable={editable} onEdit={onEdit} multiline />
            )}
          </p>
          <ul className="space-y-2">
            {d.product.capabilities.map((cap, i) => (
              <li key={i} className="flex items-center gap-3">
                <span
                  className="inline-block w-6 text-center text-[11px] font-semibold"
                  style={{ color: c.accent, fontFamily: f.mono }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ fontFamily: f.sans, fontSize: 15, color: c.ink }}>
                  {cap === '—' ? <Nudge>Add product capabilities</Nudge> : (
                    <Editable value={cap} path={`product.capabilities.${i}`} editable={editable} onEdit={onEdit} multiline />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={productHeavy ? 'col-span-7' : 'col-span-6'}>
          <div className="w-full" style={{ aspectRatio: '3/2' }}>
            <ProductFrame v={v} label={`${d.meta.project_name} · Today`} />
          </div>
          {productHeavy && (
            <div className="mt-3 text-[10px] tracking-[0.24em] uppercase" style={{ color: c.muted, fontFamily: f.mono }}>
              Illustrative interface — not a screenshot
            </div>
          )}
        </div>
      </div>
    </Frame>
  );
};

const S06Market: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  return (
    <Frame v={v} step={6} total={TOTAL} chapter="Market">
      <div className="h-full grid grid-cols-12 gap-10 items-center">
        <div className="col-span-6">
          <Eyebrow color={c.accent} font={f.mono}>
            <Editable value={d.market.eyebrow} path="market.eyebrow" editable={editable} onEdit={onEdit} />
          </Eyebrow>
          <h2
            className="leading-[1.02] tracking-[-0.02em] mb-6"
            style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 56), color: c.ink }}
          >
            <Editable value={d.market.headline} path="market.headline" editable={editable} onEdit={onEdit} multiline />
          </h2>
          <div className="text-[10px] tracking-[0.32em] uppercase mb-3" style={{ color: c.muted, fontFamily: f.mono }}>
            Why now
          </div>
          <ul className="space-y-2">
            {d.market.why_now.map((s, i) => (
              <li key={i} style={{ fontFamily: f.body, fontSize: 16, color: c.inkSoft, lineHeight: 1.5 }}>
                {s === '—' ? <Nudge>Fill in why_now on the project page</Nudge> : (
                  <>
                    <span style={{ color: c.accent, fontFamily: f.mono, fontSize: 11, marginRight: 8 }}>
                      0{i + 1}
                    </span>
                    <Editable value={s} path={`market.why_now.${i}`} editable={editable} onEdit={onEdit} multiline />
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="col-span-6 flex justify-center">
          <div style={{ width: 380, height: 340 }}>
            <MarketTriangle tam={d.market.tam} sam={d.market.sam} som={d.market.som} v={v} />
          </div>
        </div>
      </div>
    </Frame>
  );
};

const S07Traction: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  const hasInterviews = d.traction.interviews_recent.length > 0;
  return (
    <Frame v={v} step={7} total={TOTAL} chapter="Early signal">
      <div className="h-full flex flex-col">
        <Eyebrow color={c.accent} font={f.mono}>
          <Editable value={d.traction.eyebrow} path="traction.eyebrow" editable={editable} onEdit={onEdit} />
        </Eyebrow>
        <h2
          className="leading-[1.02] tracking-[-0.02em] mb-8"
          style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 52), color: c.ink }}
        >
          <Editable value={d.traction.headline} path="traction.headline" editable={editable} onEdit={onEdit} multiline />
        </h2>
        <div className="grid grid-cols-3 gap-4 mb-8">
          {d.traction.metrics.map((m, i) => (
            <MetricCell key={i} m={m} v={v} bordered />
          ))}
        </div>
        <div className="text-[10px] tracking-[0.32em] uppercase mb-3" style={{ color: c.muted, fontFamily: f.mono }}>
          From discovery — {d.traction.interviews_count} interviews logged
        </div>
        {hasInterviews ? (
          <div className="grid grid-cols-3 gap-4">
            {d.traction.interviews_recent.slice(0, 3).map((it, i) => (
              <div
                key={i}
                className="p-4 border-t-2"
                style={{ borderColor: c.accent, background: c.surface, borderRadius: 4 }}
              >
                <blockquote
                  style={{
                    fontFamily: f.body,
                    fontStyle: v === 'editorial' ? 'italic' : 'normal',
                    fontSize: 14, lineHeight: 1.4, color: c.ink, minHeight: 80,
                  }}
                >
                  "{it.takeaway}"
                </blockquote>
                <div className="mt-3 text-[11px]" style={{ color: c.muted, fontFamily: f.mono }}>
                  — {it.name}{it.role ? `, ${it.role}` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="p-6 text-center"
            style={{ background: c.surface, border: `1px dashed ${c.rule}`, borderRadius: 6 }}
          >
            <Nudge>Log discovery interviews in the Spin-Out Lab to populate quotes</Nudge>
          </div>
        )}
      </div>
    </Frame>
  );
};

const S08LabProgress: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  const pctFor = (w: WeekBlock) => {
    const total = w.milestones.length || 1;
    const done = w.milestones.filter((m) => m.done).length;
    return Math.round((done / total) * 100);
  };
  return (
    <Frame v={v} step={8} total={TOTAL} chapter="30-day sprint">
      <div className="h-full flex flex-col">
        <div className="flex items-end justify-between mb-6">
          <div>
            <Eyebrow color={c.accent} font={f.mono}>
              <Editable value={d.lab_progress.eyebrow} path="lab_progress.eyebrow" editable={editable} onEdit={onEdit} />
            </Eyebrow>
            <h2
              className="leading-[1.02] tracking-[-0.02em]"
              style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 48), color: c.ink }}
            >
              <Editable value={d.lab_progress.headline} path="lab_progress.headline" editable={editable} onEdit={onEdit} multiline />
            </h2>
          </div>
          <div className="text-right">
            <div className="text-[10px] tracking-[0.32em] uppercase" style={{ color: c.muted, fontFamily: f.mono }}>
              Lab status
            </div>
            <div className="font-semibold" style={{ fontSize: 18, color: c.ink, fontFamily: f.sans }}>
              {d.meta.lab_active ? `Week ${d.meta.week} · ${d.meta.days_remaining} days left` : 'Completed'}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 flex-1">
          {d.lab_progress.weeks.map((w) => {
            const pct = pctFor(w);
            const isCurrent = w.status === 'in_progress';
            return (
              <div
                key={w.week}
                className="flex flex-col p-4"
                style={{
                  background: c.surface,
                  border: `1px solid ${isCurrent ? c.accent : c.rule}`,
                  borderRadius: 6,
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] tracking-[0.32em] uppercase" style={{ color: c.muted, fontFamily: f.mono }}>
                    Week {w.week}
                  </div>
                  <div style={{ width: 28, height: 28 }}>
                    <SparkArc pct={pct} color={pct === 100 ? c.good : c.accent} muted={c.muted} />
                  </div>
                </div>
                <div className="font-semibold mb-1" style={{ fontFamily: f.display, fontSize: 22, color: c.ink }}>
                  {w.title}
                </div>
                <div className="text-[12px] mb-3" style={{ color: c.muted, fontFamily: f.sans, lineHeight: 1.4 }}>
                  {w.caption}
                </div>
                <ul className="space-y-1.5 mt-auto">
                  {w.milestones.map((m) => (
                    <li key={m.key} className="flex items-start gap-2 text-[12px]" style={{ fontFamily: f.sans }}>
                      <span
                        className="inline-block flex-shrink-0 mt-1"
                        style={{
                          width: 10, height: 10, borderRadius: 2,
                          background: m.done ? c.good : 'transparent',
                          border: `1.5px solid ${m.done ? c.good : c.rule}`,
                        }}
                      />
                      <span style={{ color: m.done ? c.ink : c.muted, textDecoration: m.done ? 'none' : 'none' }}>
                        {m.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </Frame>
  );
};

const S09BusinessModel: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  return (
    <Frame v={v} step={9} total={TOTAL} chapter="Business model">
      <div className="h-full grid grid-cols-12 gap-10 items-center">
        <div className="col-span-6">
          <Eyebrow color={c.accent} font={f.mono}>
            <Editable value={d.business_model.eyebrow} path="business_model.eyebrow" editable={editable} onEdit={onEdit} />
          </Eyebrow>
          <h2
            className="leading-[1.02] tracking-[-0.02em] mb-6"
            style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 52), color: c.ink }}
          >
            <Editable value={d.business_model.headline} path="business_model.headline" editable={editable} onEdit={onEdit} multiline />
          </h2>
          <p style={{ fontFamily: f.body, fontSize: 17, lineHeight: 1.55, color: c.inkSoft, maxWidth: 540 }}>
            {d.business_model.body === '—' ? (
              <Nudge>Describe your revenue model</Nudge>
            ) : (
              <Editable value={d.business_model.body} path="business_model.body" editable={editable} onEdit={onEdit} multiline />
            )}
          </p>
        </div>
        <div className="col-span-6 grid grid-cols-1 gap-3">
          <div className="text-[10px] tracking-[0.32em] uppercase mb-1" style={{ color: c.muted, fontFamily: f.mono }}>
            Unit economics
          </div>
          {d.business_model.unit_econ.map((m, i) => (
            <MetricCell key={i} m={m} v={v} bordered />
          ))}
        </div>
      </div>
    </Frame>
  );
};

const S10GTM: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  return (
    <Frame v={v} step={10} total={TOTAL} chapter="Go-to-market">
      <div className="h-full flex flex-col">
        <Eyebrow color={c.accent} font={f.mono}>
          <Editable value={d.gtm.eyebrow} path="gtm.eyebrow" editable={editable} onEdit={onEdit} />
        </Eyebrow>
        <h2
          className="leading-[1.02] tracking-[-0.02em] mb-8"
          style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 52), color: c.ink }}
        >
          <Editable value={d.gtm.headline} path="gtm.headline" editable={editable} onEdit={onEdit} multiline />
        </h2>
        <div className="grid grid-cols-12 gap-10 flex-1">
          <div className="col-span-7">
            <div className="text-[10px] tracking-[0.32em] uppercase mb-4" style={{ color: c.muted, fontFamily: f.mono }}>
              Channels
            </div>
            <div className="space-y-4">
              {d.gtm.channels.map((ch, i) => (
                <div key={i} className="flex items-start gap-4 pb-4" style={{ borderBottom: `1px solid ${c.rule}` }}>
                  <div
                    className="flex-shrink-0 w-9 h-9 flex items-center justify-center text-[12px] font-semibold"
                    style={{ background: c.accentSoft, color: c.accent, borderRadius: 4, fontFamily: f.mono }}
                  >
                    0{i + 1}
                  </div>
                  <div>
                    <div className="font-semibold mb-1" style={{ fontFamily: f.sans, fontSize: 16, color: c.ink }}>
                      {ch.name === '—' ? <Nudge>Add a channel</Nudge> : ch.name}
                    </div>
                    <div style={{ fontFamily: f.body, fontSize: 14, color: c.inkSoft, lineHeight: 1.5 }}>
                      {ch.line === '—' ? '' : ch.line}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="col-span-5">
            <div className="text-[10px] tracking-[0.32em] uppercase mb-4" style={{ color: c.muted, fontFamily: f.mono }}>
              Next 90 days
            </div>
            <ol className="space-y-3">
              {d.gtm.plan_90d.map((s, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="flex-shrink-0 w-7 text-right font-semibold text-[14px]"
                    style={{ color: c.accent, fontFamily: f.mono }}
                  >
                    Day {30 * (i + 1)}
                  </span>
                  <span style={{ fontFamily: f.sans, fontSize: 14, color: c.ink, lineHeight: 1.45 }}>
                    {s === '—' ? <Nudge>Add a milestone</Nudge> : s}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </Frame>
  );
};

const S11Competition: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  const W = 460, H = 340;
  return (
    <Frame v={v} step={11} total={TOTAL} chapter="Landscape">
      <div className="h-full grid grid-cols-12 gap-10 items-center">
        <div className="col-span-5">
          <Eyebrow color={c.accent} font={f.mono}>
            <Editable value={d.competition.eyebrow} path="competition.eyebrow" editable={editable} onEdit={onEdit} />
          </Eyebrow>
          <h2
            className="leading-[1.02] tracking-[-0.02em] mb-6"
            style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 52), color: c.ink }}
          >
            <Editable value={d.competition.headline} path="competition.headline" editable={editable} onEdit={onEdit} multiline />
          </h2>
          <div className="text-[10px] tracking-[0.32em] uppercase mb-2" style={{ color: c.muted, fontFamily: f.mono }}>
            Our wedge
          </div>
          <p style={{ fontFamily: f.body, fontSize: 16, lineHeight: 1.5, color: c.inkSoft }}>
            {d.competition.wedge === '—' ? (
              <Nudge>Name your wedge — the one thing only you can do</Nudge>
            ) : (
              <Editable value={d.competition.wedge} path="competition.wedge" editable={editable} onEdit={onEdit} multiline />
            )}
          </p>
        </div>
        <div className="col-span-7">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            <rect x="40" y="20" width={W - 60} height={H - 60} fill={c.surface} stroke={c.rule} />
            <line x1="40" y1={H / 2} x2={W - 20} y2={H / 2} stroke={c.rule} strokeDasharray="2 4" />
            <line x1={W / 2} y1="20" x2={W / 2} y2={H - 40} stroke={c.rule} strokeDasharray="2 4" />
            <text x={W - 20} y={H / 2 - 4} fontFamily={f.mono} fontSize="9" fill={c.muted} textAnchor="end">
              {d.competition.x_label}
            </text>
            <text x={W / 2 + 6} y="26" fontFamily={f.mono} fontSize="9" fill={c.muted}>
              {d.competition.y_label}
            </text>
            {d.competition.players.map((p, i) => {
              const cx = 40 + ((W - 60) * p.x) / 100;
              const cy = 20 + ((H - 60) * (100 - p.y)) / 100;
              return (
                <g key={i}>
                  <circle
                    cx={cx} cy={cy} r={p.is_us ? 14 : 9}
                    fill={p.is_us ? c.accent : c.chip}
                    stroke={p.is_us ? c.accent : c.muted} strokeWidth={p.is_us ? 0 : 1}
                  />
                  <text
                    x={cx + (p.is_us ? 22 : 16)} y={cy + 4}
                    fontFamily={f.sans} fontSize={p.is_us ? 13 : 11}
                    fontWeight={p.is_us ? 700 : 500}
                    fill={p.is_us ? c.accent : c.ink}
                  >
                    {p.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </Frame>
  );
};

const S12Team: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  const sc = d.team.scoring || {};
  return (
    <Frame v={v} step={12} total={TOTAL} chapter="Team">
      <div className="h-full flex flex-col">
        <Eyebrow color={c.accent} font={f.mono}>
          <Editable value={d.team.eyebrow} path="team.eyebrow" editable={editable} onEdit={onEdit} />
        </Eyebrow>
        <h2
          className="leading-[1.02] tracking-[-0.02em] mb-8"
          style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 52), color: c.ink }}
        >
          <Editable value={d.team.headline} path="team.headline" editable={editable} onEdit={onEdit} multiline />
        </h2>
        <div className="grid grid-cols-12 gap-10 flex-1">
          <div className="col-span-8">
            <div className="text-[10px] tracking-[0.32em] uppercase mb-3" style={{ color: c.muted, fontFamily: f.mono }}>
              Founders
            </div>
            {d.team.founders.length === 0 ? (
              <div
                className="p-5"
                style={{ background: c.surface, border: `1px dashed ${c.rule}`, borderRadius: 6 }}
              >
                <Nudge>Seed your cap table to populate founders</Nudge>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {d.team.founders.slice(0, 4).map((fdr, i) => (
                  <div key={i} className="p-4" style={{ background: c.surface, border: `1px solid ${c.rule}`, borderRadius: 6 }}>
                    <div
                      className="w-12 h-12 mb-3 flex items-center justify-center font-semibold"
                      style={{
                        background: c.accent, color: '#FFF8EC', borderRadius: 999,
                        fontFamily: f.display, fontSize: 18,
                      }}
                    >
                      {(fdr.name || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="font-semibold" style={{ fontFamily: f.sans, fontSize: 16, color: c.ink }}>
                      {fdr.name}
                    </div>
                    <div className="text-[12px] mb-2" style={{ color: c.muted, fontFamily: f.mono }}>
                      {fdr.role}
                    </div>
                    {fdr.bio && (
                      <div style={{ fontFamily: f.body, fontSize: 13, color: c.inkSoft, lineHeight: 1.5 }}>
                        {fdr.bio}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="col-span-4 flex flex-col gap-3">
            <div className="text-[10px] tracking-[0.32em] uppercase" style={{ color: c.muted, fontFamily: f.mono }}>
              Axal scoring
            </div>
            <MetricCell
              m={{ label: 'Total score', value: sc.total_score != null ? `${Math.round(sc.total_score)}/100` : '—', sub: sc.tier ?? '' }}
              v={v} bordered
            />
            <MetricCell
              m={{ label: 'Team', value: sc.team_total != null ? `${Math.round(sc.team_total)}` : '—' }}
              v={v} bordered
            />
            <MetricCell
              m={{ label: 'Market', value: sc.market_total != null ? `${Math.round(sc.market_total)}` : '—' }}
              v={v} bordered
            />
          </div>
        </div>
      </div>
    </Frame>
  );
};

const S13Ask: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  const totalPct = d.ask.use_of_funds.reduce((a, b) => a + (b.pct || 0), 0) || 1;
  return (
    <Frame v={v} step={13} total={TOTAL} chapter="Ask">
      <div className="h-full grid grid-cols-12 gap-10">
        <div className="col-span-7 flex flex-col justify-center">
          <Eyebrow color={c.accent} font={f.mono}>
            <Editable value={d.ask.eyebrow} path="ask.eyebrow" editable={editable} onEdit={onEdit} />
          </Eyebrow>
          <h2
            className="leading-[1.02] tracking-[-0.02em] mb-6"
            style={{ fontFamily: f.display, fontWeight: 600, fontSize: displaySize(v, 56), color: c.ink }}
          >
            <Editable value={d.ask.headline} path="ask.headline" editable={editable} onEdit={onEdit} multiline />
          </h2>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <MetricCell m={{ label: 'Raising', value: d.ask.raise_amount, sub: 'pre-seed' }} v={v} bordered />
            <MetricCell m={{ label: 'Runway', value: d.ask.runway, sub: 'months' }} v={v} bordered />
          </div>
          <div className="text-[10px] tracking-[0.32em] uppercase mb-3" style={{ color: c.muted, fontFamily: f.mono }}>
            Use of funds
          </div>
          <div className="space-y-2 mb-2">
            {d.ask.use_of_funds.map((u, i) => {
              const w = Math.round(((u.pct || 0) / totalPct) * 100);
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1 text-[12px]" style={{ fontFamily: f.sans, color: c.ink }}>
                    <span>{u.label}</span>
                    <span style={{ fontFamily: f.mono, color: c.muted }}>{u.pct}%</span>
                  </div>
                  <div className="h-2 w-full rounded" style={{ background: c.chip }}>
                    <div className="h-full rounded" style={{ width: `${w}%`, background: c.accent }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="col-span-5 flex flex-col justify-center">
          <div
            className="p-6"
            style={{ background: c.surface, border: `1px solid ${c.rule}`, borderRadius: 6 }}
          >
            <div className="text-[10px] tracking-[0.32em] uppercase mb-3" style={{ color: c.muted, fontFamily: f.mono }}>
              What it buys — next 18 months
            </div>
            <ul className="space-y-3">
              {d.ask.next_milestones.map((m, i) => (
                <li key={i} className="flex items-start gap-3" style={{ fontFamily: f.body, fontSize: 15, color: c.ink, lineHeight: 1.45 }}>
                  <span style={{ color: c.accent }}>→</span>
                  <span>
                    {m === '—' ? <Nudge>Add a milestone</Nudge> : (
                      <Editable value={m} path={`ask.next_milestones.${i}`} editable={editable} onEdit={onEdit} multiline />
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-6 pt-4 border-t" style={{ borderColor: c.rule }}>
              <div className="text-[10px] tracking-[0.32em] uppercase mb-1" style={{ color: c.muted, fontFamily: f.mono }}>
                Contact
              </div>
              <div className="font-semibold" style={{ fontFamily: f.sans, fontSize: 16, color: c.ink }}>
                {d.ask.contact}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
};

const S14Closing: React.FC<{ d: SpinoutDemoDayData; v: VariantId; editable?: boolean; onEdit?: any }> = ({
  d, v, editable, onEdit,
}) => {
  const { c, f } = tokensFor(v);
  const dark = v === 'manifesto' || v === 'product_first';
  return (
    <Frame v={v} step={14} total={TOTAL} chapter="Thank you" bg={dark ? c.bg : c.bg}>
      {(v === 'editorial' || v === 'manifesto') && (
        <div className="absolute inset-0 -z-0 opacity-80">
          <SunRise accent={c.accent} />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(0deg, rgba(10,9,8,0.7) 0%, rgba(10,9,8,0.3) 100%)' }}
          />
        </div>
      )}
      <div className="relative h-full flex flex-col justify-center max-w-[1000px]" style={{ color: dark || v === 'editorial' ? '#FFF8EC' : c.ink }}>
        <Eyebrow color={v === 'data_dense' ? c.accent : '#F7E2B5'} font={f.mono}>
          <Editable value={d.closing.eyebrow} path="closing.eyebrow" editable={editable} onEdit={onEdit} />
        </Eyebrow>
        <h2
          className="leading-[0.98] tracking-[-0.02em] mb-6"
          style={{
            fontFamily: f.display, fontWeight: 600,
            fontSize: displaySize(v, 80),
            color: v === 'data_dense' ? c.ink : '#FFF',
          }}
        >
          <Editable value={d.closing.headline} path="closing.headline" editable={editable} onEdit={onEdit} multiline />
        </h2>
        <p
          style={{
            fontFamily: f.body, fontSize: 19, lineHeight: 1.5,
            color: v === 'data_dense' ? c.inkSoft : '#D9D1BF',
            maxWidth: 720,
          }}
        >
          <Editable value={d.closing.body} path="closing.body" editable={editable} onEdit={onEdit} multiline />
        </p>
        <div className="mt-12 flex items-center gap-6 text-[11px] tracking-[0.24em] uppercase"
          style={{ color: v === 'data_dense' ? c.muted : 'rgba(255,248,236,0.7)', fontFamily: f.mono }}
        >
          <span>{d.closing.signoff}</span>
          <span>·</span>
          <span>{d.closing.contact}</span>
        </div>
      </div>
    </Frame>
  );
};

/* ─────────────────────────── deck shell ─────────────────────────── */

const SLIDES = [
  S01Cover, S02Thesis, S03Problem, S04Insight, S05Product, S06Market,
  S07Traction, S08LabProgress, S09BusinessModel, S10GTM, S11Competition,
  S12Team, S13Ask, S14Closing,
];

function readStoredVariant(): VariantId {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(VARIANT_KEY) : null;
    if (raw && (VARIANTS as string[]).includes(raw)) return raw as VariantId;
  } catch {}
  return 'editorial';
}

const VariantSwitcher: React.FC<{ v: VariantId; setV: (id: VariantId) => void }> = ({ v, setV }) => (
  <div
    className="absolute top-2 right-2 z-50 flex gap-1 p-1 rounded-md"
    style={{
      background: 'rgba(255,255,255,0.9)',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
    }}
  >
    {VARIANTS.map((id) => (
      <button
        key={id}
        type="button"
        onClick={() => setV(id)}
        className="px-2 py-1 text-[10px] tracking-[0.18em] uppercase font-medium rounded-sm transition-colors"
        style={{
          background: v === id ? '#1A1814' : 'transparent',
          color: v === id ? '#FFF8EC' : '#3A352C',
          fontFamily: FONTS.editorial.mono,
        }}
      >
        {VARIANT_LABEL[id]}
      </button>
    ))}
  </div>
);

export const Deck_axal_spinout_demoday: React.FC<DeckProps> = ({ data, editable, onEdit, currentSlide }) => {
  const hydrated = useMemo(() => hydrate(data || {}), [data]);
  const [variant, setVariant] = useState<VariantId>(() => readStoredVariant());
  useEffect(() => {
    try { window.localStorage?.setItem(VARIANT_KEY, variant); } catch {}
  }, [variant]);

  return (
    <div className="relative w-full">
      {editable && <VariantSwitcher v={variant} setV={setVariant} />}
      <div className="flex flex-col">
        {SLIDES.map((Slide, i) => (
          <div
            key={i}
            data-slide-frame=""
            style={{
              width: 1920, height: 1080, pageBreakAfter: 'always',
              display: currentSlide != null && currentSlide !== i ? 'none' : 'block',
            }}
          >
            <Slide d={hydrated} v={variant} editable={editable} onEdit={onEdit} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default Deck_axal_spinout_demoday;
