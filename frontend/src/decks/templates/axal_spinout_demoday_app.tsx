/**
 * axal_spinout_demoday_app.tsx — Task #15
 *
 * Axal 30-day Spin-Out Lab — Demo Day deck (14 slides, 4 variants).
 *
 * Self-contained React + TS + Tailwind + Framer Motion adapter rendering
 * 14 fixed slides in the spec-required order:
 *
 *   Cover · Problem · Validation · Market · Solution · Roadmap ·
 *   Brand · Venture Readiness · Team · Mentors & Network · Cap Table ·
 *   Ask · Axal Signal · Contact
 *
 * Four visual variants — `editorial`, `product_first`, `data_dense`,
 * `manifesto` — switchable in the author surface; choice is persisted
 * to `localStorage[axal:deck:axal_spinout_demoday:variant]` and baked
 * into share / print / export renderings.
 *
 * Data flow: the worker's `/api/decks/apply-method` and `/:id/autofill`
 * routes short-circuit for `method_id === 'axal_spinout_demoday'`,
 * call `fillAxalSpinoutDemoDay()` in
 * `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts`, and
 * write the result as 14 slides where each slide carries one
 * JSON-encoded paragraph field keyed `axal_spinout_section_<name>`
 * (slide 0 also carries `meta`). `buildTemplateData()` in
 * `PitchDeckPrintPage.jsx` flattens these into the `data` prop this
 * component receives. `hydrate()` walks the keys, JSON-parses each,
 * and merges onto SAMPLE_DATA via `mergeShape()` — with the same
 * type-mismatch guard at the object branch as
 * `investor_appendix_app.tsx` lines 2877–2899 (a non-object/array
 * incoming value never replaces a typed object base).
 *
 * Honesty contract: when a Lab table is empty, the field is the
 * literal '—' placeholder; the slide renders a visible `<Nudge>` cue
 * pointing the founder back to the right Lab page rather than a
 * fabricated number / quote.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { DeckProps } from '../DeckBase';

/* ─────────────────────────── variant tokens ─────────────────────────── */

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
  editorial: 'Editorial', product_first: 'Product-first',
  data_dense: 'Data-dense', manifesto: 'Manifesto',
};

const FONTS: Record<VariantId, { display: string; body: string; mono: string }> = {
  editorial:     { display: '"Playfair Display","GT Sectra",Georgia,serif', body: '"Source Serif Pro",Georgia,serif',          mono: '"JetBrains Mono",ui-monospace,Menlo,monospace' },
  product_first: { display: '"Inter","Helvetica Neue",system-ui,sans-serif', body: '"Inter","Helvetica Neue",system-ui,sans-serif', mono: '"JetBrains Mono",ui-monospace,Menlo,monospace' },
  data_dense:    { display: '"Inter","Helvetica Neue",system-ui,sans-serif', body: '"Inter","Helvetica Neue",system-ui,sans-serif', mono: '"JetBrains Mono",ui-monospace,Menlo,monospace' },
  manifesto:     { display: '"Inter","Helvetica Neue",system-ui,sans-serif', body: '"Inter","Helvetica Neue",system-ui,sans-serif', mono: '"JetBrains Mono",ui-monospace,Menlo,monospace' },
};

const VARIANT_KEY = 'axal:deck:axal_spinout_demoday:variant';
const DASH = '—';

/* ─────────────────────────── data types ─────────────────────────── */

export type Metric = { label: string; value: string; sub?: string };
export type Founder = { name: string; role: string; bio?: string };
export type FundUse = { label: string; pct: number };
export type Holder = { name: string; role: string; ownership_pct: string; kind: string };
export type LabWeek = {
  week: number; title: string; caption: string;
  status: 'complete' | 'in_progress' | 'upcoming';
  milestones: { key: string; label: string; done: boolean }[];
};

export type SpinoutDemoDayData = {
  meta: {
    project_name: string; sector: string;
    founder_name: string; contact_email: string;
    presented_on: string;
    week: number; days_remaining: number; lab_active: boolean;
    is_sample: boolean;
  };
  cover: { eyebrow: string; headline: string; sub: string; location: string };
  problem: { eyebrow: string; headline: string; body: string; signals: string[] };
  validation: {
    eyebrow: string; headline: string; body: string;
    metrics: Metric[]; quotes: { name: string; role: string; takeaway: string }[];
  };
  market: { eyebrow: string; headline: string; tam: string; sam: string; som: string; why_now: string[] };
  solution: { eyebrow: string; headline: string; body: string; capabilities: string[] };
  roadmap: {
    eyebrow: string; headline: string; quarter: string;
    now: string[]; next: string[]; later: string[];
  };
  brand: {
    eyebrow: string; headline: string; tagline: string; vision: string;
    brand_kit_ready: boolean; pitch_deck_ready: boolean; incorporated: boolean;
  };
  venture_readiness: {
    eyebrow: string; headline: string;
    total_score: string; tier: string; is_sandbox: boolean;
    breakdown: { label: string; value: string }[]; ai_notes: string;
  };
  team: { eyebrow: string; headline: string; founders: Founder[]; team_intro: string };
  mentor_network: {
    eyebrow: string; headline: string; body: string;
    mentors: string[]; network_signals: string[];
  };
  cap_table: { eyebrow: string; headline: string; holders: Holder[]; note: string };
  ask: {
    eyebrow: string; headline: string;
    raise_amount: string; runway: string;
    use_of_funds: FundUse[]; next_milestones: string[];
  };
  axal_signal: { eyebrow: string; headline: string; body: string; lab_weeks: LabWeek[] };
  contact: {
    eyebrow: string; headline: string; body: string;
    contact_email: string; signoff: string;
  };
};

/* ─────────────────────────── sample data ─────────────────────────── */

export const SAMPLE_DATA: SpinoutDemoDayData = {
  meta: {
    project_name: 'Your Company', sector: 'Pre-incorporation',
    founder_name: DASH, contact_email: DASH,
    presented_on: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    week: 1, days_remaining: 28, lab_active: false, is_sample: true,
  },
  cover: {
    eyebrow: 'Axal · 30-Day Spin-Out Lab · Demo Day',
    headline: 'Your story, in 14 slides.',
    sub: 'A pre-incorporation thesis, sharpened across 30 days of Discovery, OKRs, Scoring and Cap-Table prep.',
    location: 'Axal Network · Demo Day',
  },
  problem: {
    eyebrow: '01 · Problem', headline: 'Why this is broken today.',
    body: DASH, signals: [],
  },
  validation: {
    eyebrow: '02 · Validation', headline: 'Discovery — what we heard.',
    body: DASH, metrics: [
      { label: 'Interviews', value: DASH, sub: 'logged in Lab' },
      { label: 'Distinct pains', value: DASH, sub: 'tagged' },
      { label: 'Hypotheses validated', value: DASH, sub: 'evidence-backed' },
    ], quotes: [],
  },
  market: {
    eyebrow: '03 · Market', headline: 'Sized for a real outcome.',
    tam: DASH, sam: DASH, som: DASH, why_now: [],
  },
  solution: {
    eyebrow: '04 · Solution', headline: 'A first cut of what we will ship.',
    body: DASH, capabilities: [],
  },
  roadmap: {
    eyebrow: '05 · Roadmap', headline: 'What we ship next.',
    quarter: DASH, now: [], next: [], later: [],
  },
  brand: {
    eyebrow: '06 · Brand', headline: 'How we show up.',
    tagline: DASH, vision: DASH,
    brand_kit_ready: false, pitch_deck_ready: false, incorporated: false,
  },
  venture_readiness: {
    eyebrow: '07 · Venture readiness', headline: 'Axal score — to be run in Week 2.',
    total_score: DASH, tier: DASH, is_sandbox: false,
    breakdown: [], ai_notes: DASH,
  },
  team: {
    eyebrow: '08 · Team', headline: 'Why we are the founders to build this.',
    founders: [], team_intro: '',
  },
  mentor_network: {
    eyebrow: '09 · Mentors & network', headline: 'Who is around the table.',
    body: '', mentors: [], network_signals: [],
  },
  cap_table: {
    eyebrow: '10 · Cap table',
    headline: 'Cap table — to be seeded in Week 3.',
    holders: [], note: 'Pre-incorporation — entity stands up in Week 4.',
  },
  ask: {
    eyebrow: '11 · Ask', headline: 'What we are raising — and what it buys.',
    raise_amount: DASH, runway: DASH, use_of_funds: [], next_milestones: [],
  },
  axal_signal: {
    eyebrow: '12 · Axal signal', headline: 'Built across 30 days of Lab work.',
    body: DASH, lab_weeks: [],
  },
  contact: {
    eyebrow: '13 · Contact', headline: "Let's talk.",
    body: DASH, contact_email: DASH, signoff: '— The founding team',
  },
};

/* ─────────────────────────── mergeShape ─────────────────────────── */

/**
 * Recursively merge `incoming` over `base`, preserving the shape of `base`.
 *
 * The critical guard at the object branch — copied verbatim from
 * `investor_appendix_app.tsx` lines 2877–2899 — is:
 *
 *     if (incoming == null) return base;
 *     if (typeof incoming !== 'object' || Array.isArray(incoming)) return base;
 *
 * This stops a primitive (a string, a number) or an array from
 * replacing a structured object when share-link payloads come in
 * malformed. Three share-link crashes this month traced back to that
 * exact missing guard. Do not remove.
 */
function mergeShape<T>(base: T, incoming: unknown): T {
  if (incoming == null) return base;
  if (Array.isArray(base)) {
    if (!Array.isArray(incoming)) return base;
    return incoming as unknown as T;
  }
  if (typeof base === 'object' && base !== null) {
    if (typeof incoming !== 'object' || Array.isArray(incoming)) return base;
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    const inc = incoming as Record<string, unknown>;
    for (const k of Object.keys(inc)) {
      out[k] = (k in out)
        ? mergeShape((base as Record<string, unknown>)[k], inc[k])
        : inc[k];
    }
    return out as T;
  }
  // primitives: incoming wins.
  return incoming as T;
}

/* ─────────────────────────── hydrate ─────────────────────────── */

/**
 * Walk every `axal_spinout_section_*` key in `data`, JSON-parse it, and
 * merge onto SAMPLE_DATA. The worker writes one such key per top-level
 * section; slide 0 additionally carries `meta`. Unknown / unparseable
 * keys are silently skipped so a bad payload degrades gracefully.
 */
function hydrate(raw: unknown): SpinoutDemoDayData {
  let out: SpinoutDemoDayData = SAMPLE_DATA;
  if (!raw || typeof raw !== 'object') return out;
  const dict = raw as Record<string, unknown>;
  for (const k of Object.keys(dict)) {
    if (!k.startsWith('axal_spinout_section_')) continue;
    const section = k.slice('axal_spinout_section_'.length);
    if (!(section in out)) continue;
    const v = dict[k];
    let parsed: unknown = v;
    if (typeof v === 'string') {
      try { parsed = JSON.parse(v); } catch { continue; }
    }
    const baseSlice = (out as Record<string, unknown>)[section];
    const merged = mergeShape(baseSlice, parsed);
    out = { ...out, [section]: merged } as SpinoutDemoDayData;
  }
  return out;
}

/* ─────────────────────────── variant context ─────────────────────────── */

type VariantCtx = {
  variant: VariantId;
  setVariant: (v: VariantId) => void;
  pal: typeof PALETTES[VariantId];
  fonts: typeof FONTS[VariantId];
  editable: boolean;
};
const VariantContext = React.createContext<VariantCtx | null>(null);
const useVariant = (): VariantCtx => {
  const c = React.useContext(VariantContext);
  if (!c) throw new Error('VariantContext missing');
  return c;
};

/* ─────────────────────────── shared atoms ─────────────────────────── */

const isUnfilled = (v: unknown): boolean =>
  v == null || v === '' || v === DASH ||
  (Array.isArray(v) && (v.length === 0 || v.every((x) => x === DASH || x === '' || x == null)));

const Nudge: React.FC<{ children: React.ReactNode; href?: string }> = ({ children, href }) => {
  const { pal } = useVariant();
  return (
    <div
      role="note"
      style={{
        background: pal.accentSoft, color: pal.accent,
        border: `1px dashed ${pal.accent}`, borderRadius: 8,
        padding: '12px 16px', fontSize: 13, lineHeight: 1.5,
        display: 'inline-flex', alignItems: 'center', gap: 8,
      }}
    >
      <span aria-hidden style={{ fontSize: 16 }}>↳</span>
      <span>{children}{href ? <> — <a href={href} style={{ color: pal.accent, textDecoration: 'underline' }}>open in Lab</a></> : null}</span>
    </div>
  );
};

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pal, fonts } = useVariant();
  return (
    <div style={{
      color: pal.accent, fontFamily: fonts.mono,
      fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
      marginBottom: 16,
    }}>{children}</div>
  );
};

const SlideHeading: React.FC<{ children: React.ReactNode; size?: 'xl' | '2xl' | '3xl' }>
= ({ children, size = '2xl' }) => {
  const { pal, fonts, variant } = useVariant();
  const sizes = { xl: 36, '2xl': 48, '3xl': 64 };
  return (
    <h2 style={{
      color: pal.ink, fontFamily: fonts.display,
      fontSize: variant === 'manifesto' ? sizes[size] * 1.25 : sizes[size],
      lineHeight: 1.05, letterSpacing: variant === 'editorial' ? '-0.01em' : '-0.02em',
      fontWeight: variant === 'editorial' ? 500 : 700,
      margin: 0,
    }}>{children}</h2>
  );
};

const Body: React.FC<{ children: React.ReactNode; max?: number }> = ({ children, max = 720 }) => {
  const { pal, fonts } = useVariant();
  return (
    <p style={{
      color: pal.inkSoft, fontFamily: fonts.body,
      fontSize: 17, lineHeight: 1.55, maxWidth: max, margin: 0,
    }}>{children}</p>
  );
};

const Chip: React.FC<{ children: React.ReactNode; tone?: 'default' | 'good' | 'warn' }> = ({ children, tone = 'default' }) => {
  const { pal, fonts } = useVariant();
  const bg = tone === 'good' ? pal.good : tone === 'warn' ? pal.warn : pal.chip;
  const fg = tone === 'default' ? pal.inkSoft : '#fff';
  return (
    <span style={{
      background: bg, color: fg, fontFamily: fonts.mono,
      fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '4px 10px', borderRadius: 999,
    }}>{children}</span>
  );
};

const MetricCard: React.FC<{ m: Metric }> = ({ m }) => {
  const { pal, fonts, variant } = useVariant();
  const valStyle: React.CSSProperties = {
    color: m.value === DASH ? pal.muted : pal.ink,
    fontFamily: variant === 'data_dense' ? fonts.mono : fonts.display,
    fontSize: variant === 'data_dense' ? 32 : 40, fontWeight: 700, lineHeight: 1,
  };
  return (
    <div style={{
      background: pal.surface, border: `1px solid ${pal.rule}`,
      borderRadius: 12, padding: '20px 22px', minWidth: 0,
    }}>
      <div style={{ color: pal.muted, fontFamily: fonts.mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{m.label}</div>
      <div style={valStyle}>{m.value}</div>
      {m.sub && <div style={{ color: pal.muted, fontFamily: fonts.body, fontSize: 12, marginTop: 4 }}>{m.sub}</div>}
    </div>
  );
};

/* ─────────────────────────── variant switcher ─────────────────────────── */

const VariantSwitcher: React.FC = () => {
  const { variant, setVariant, pal, fonts } = useVariant();
  return (
    <div style={{
      position: 'absolute', top: 16, right: 16, zIndex: 10,
      display: 'flex', alignItems: 'center', gap: 8,
      background: pal.surface, border: `1px solid ${pal.rule}`,
      borderRadius: 999, padding: '6px 8px',
      fontFamily: fonts.mono, fontSize: 11, letterSpacing: '0.08em',
    }}>
      <span style={{ color: pal.muted, padding: '0 6px' }}>VARIANT</span>
      {VARIANTS.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => setVariant(v)}
          style={{
            background: v === variant ? pal.accent : 'transparent',
            color: v === variant ? '#fff' : pal.ink,
            border: 'none', borderRadius: 999,
            padding: '5px 10px', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit',
          }}
          aria-pressed={v === variant}
        >{VARIANT_LABEL[v]}</button>
      ))}
    </div>
  );
};

/* ─────────────────────────── 14 slides ─────────────────────────── */

const SlideShell: React.FC<{ children: React.ReactNode; pad?: number }> = ({ children, pad = 72 }) => {
  const { pal } = useVariant();
  return (
    <div style={{
      width: '100%', height: '100%', background: pal.bg,
      padding: pad, boxSizing: 'border-box', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>{children}</div>
  );
};

const Slide_Cover: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const { pal, fonts, variant } = useVariant();
  const { cover, meta } = d;
  return (
    <SlideShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Eyebrow>{cover.eyebrow}</Eyebrow>
          {meta.is_sample && <Chip tone="warn">SAMPLE</Chip>}
        </div>
        <div style={{ color: pal.muted, fontFamily: fonts.mono, fontSize: 11, textAlign: 'right' }}>
          <div>{meta.project_name}</div>
          <div>{meta.sector}</div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 880 }}>
        <h1 style={{
          color: pal.ink, fontFamily: fonts.display,
          fontSize: variant === 'manifesto' ? 96 : 72, lineHeight: 1.02,
          letterSpacing: '-0.02em', fontWeight: variant === 'editorial' ? 500 : 700, margin: 0,
        }}>{cover.headline}</h1>
        <p style={{ color: pal.inkSoft, fontFamily: fonts.body, fontSize: 20, lineHeight: 1.5, maxWidth: 700, marginTop: 28 }}>
          {cover.sub}
        </p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', color: pal.muted, fontFamily: fonts.mono, fontSize: 12 }}>
        <span>{cover.location}</span>
        <span>{meta.founder_name} · {meta.contact_email}</span>
      </div>
    </SlideShell>
  );
};

const Slide_Problem: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const p = d.problem;
  return (
    <SlideShell>
      <Eyebrow>{p.eyebrow}</Eyebrow>
      <SlideHeading>{p.headline}</SlideHeading>
      <div style={{ marginTop: 32, maxWidth: 760 }}>
        {isUnfilled(p.body)
          ? <Nudge>Add a problem statement on your project to unlock this slide.</Nudge>
          : <Body>{p.body}</Body>}
      </div>
      <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {p.signals.length > 0
          ? p.signals.slice(0, 3).map((s, i) => (
            <div key={i} style={{ borderTop: `1px solid currentColor`, paddingTop: 12, opacity: 0.85 }}>
              <Body max={260}>{s}</Body>
            </div>
          ))
          : <div style={{ gridColumn: '1 / -1' }}><Nudge>Capture growth signals on your project to fill out the three columns.</Nudge></div>}
      </div>
    </SlideShell>
  );
};

const Slide_Validation: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const v = d.validation;
  return (
    <SlideShell>
      <Eyebrow>{v.eyebrow}</Eyebrow>
      <SlideHeading>{v.headline}</SlideHeading>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 28 }}>
        {v.metrics.map((m, i) => <MetricCard key={i} m={m} />)}
      </div>
      <div style={{ marginTop: 28, flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {v.quotes.length > 0 ? v.quotes.map((q, i) => (
          <blockquote key={i} style={{ margin: 0, paddingLeft: 16, borderLeft: '3px solid currentColor', maxWidth: 820 }}>
            <Body>"{q.takeaway}"</Body>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>— {q.name}{q.role ? `, ${q.role}` : ''}</div>
          </blockquote>
        )) : <Nudge>Log 5 customer-discovery interviews in Week 1 to unlock real founder quotes here.</Nudge>}
      </div>
    </SlideShell>
  );
};

const Slide_Market: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const m = d.market;
  const ms: Metric[] = [
    { label: 'TAM', value: m.tam, sub: 'Total addressable' },
    { label: 'SAM', value: m.sam, sub: 'Serviceable' },
    { label: 'SOM', value: m.som, sub: 'Obtainable' },
  ];
  const allMissing = m.tam === DASH && m.sam === DASH && m.som === DASH;
  return (
    <SlideShell>
      <Eyebrow>{m.eyebrow}</Eyebrow>
      <SlideHeading>{m.headline}</SlideHeading>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 32 }}>
        {ms.map((x, i) => <MetricCard key={i} m={x} />)}
      </div>
      {allMissing && <div style={{ marginTop: 20 }}><Nudge>Set TAM / SAM / SOM on your project to size the market.</Nudge></div>}
      <div style={{ marginTop: 28, flex: 1 }}>
        <Eyebrow>Why now</Eyebrow>
        {m.why_now.length > 0
          ? <ul style={{ margin: 0, paddingLeft: 18 }}>{m.why_now.map((w, i) => <li key={i} style={{ marginBottom: 6 }}><Body>{w}</Body></li>)}</ul>
          : <Nudge>Fill in `why_now` on your project to explain the timing.</Nudge>}
      </div>
    </SlideShell>
  );
};

const Slide_Solution: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const s = d.solution;
  return (
    <SlideShell>
      <Eyebrow>{s.eyebrow}</Eyebrow>
      <SlideHeading>{s.headline}</SlideHeading>
      <div style={{ marginTop: 32, maxWidth: 720 }}>
        {isUnfilled(s.body) ? <Nudge>Fill in your project's `solution` field to describe what you're building.</Nudge> : <Body>{s.body}</Body>}
      </div>
      <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {s.capabilities.length > 0
          ? s.capabilities.slice(0, 4).map((c, i) => (
            <div key={i} style={{ padding: '14px 16px', borderRadius: 10, border: '1px solid currentColor' }}>
              <Body max={300}>{c}</Body>
            </div>
          ))
          : <div style={{ gridColumn: '1 / -1' }}><Nudge>Add a `solution` description with bullet-style capabilities.</Nudge></div>}
      </div>
    </SlideShell>
  );
};

const Slide_Roadmap: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const r = d.roadmap;
  const cols = [
    { label: 'Now', items: r.now },
    { label: 'Next', items: r.next },
    { label: 'Later', items: r.later },
  ];
  const allEmpty = r.now.length + r.next.length + r.later.length === 0;
  return (
    <SlideShell>
      <Eyebrow>{r.eyebrow}{r.quarter !== DASH ? ` · ${r.quarter}` : ''}</Eyebrow>
      <SlideHeading>{r.headline}</SlideHeading>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 32, flex: 1 }}>
        {cols.map((c) => (
          <div key={c.label}>
            <Eyebrow>{c.label}</Eyebrow>
            {c.items.length > 0
              ? <ul style={{ margin: 0, paddingLeft: 16 }}>{c.items.map((o, i) => <li key={i} style={{ marginBottom: 8 }}><Body max={260}>{o}</Body></li>)}</ul>
              : <div style={{ opacity: 0.5, fontSize: 12 }}>{DASH}</div>}
          </div>
        ))}
      </div>
      {allEmpty && <div style={{ marginTop: 16 }}><Nudge>Add 3 OKRs in Week 2 to populate Now / Next / Later.</Nudge></div>}
    </SlideShell>
  );
};

const Slide_Brand: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const b = d.brand;
  return (
    <SlideShell>
      <Eyebrow>{b.eyebrow}</Eyebrow>
      <SlideHeading>{b.headline}</SlideHeading>
      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 24, rowGap: 12 }}>
        <div style={{ opacity: 0.6, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Tagline</div>
        <div><Body>{b.tagline}</Body></div>
        <div style={{ opacity: 0.6, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Vision</div>
        <div><Body>{b.vision}</Body></div>
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip tone={b.brand_kit_ready ? 'good' : 'default'}>{b.brand_kit_ready ? '✓ Brand kit ready' : 'Brand kit pending'}</Chip>
        <Chip tone={b.pitch_deck_ready ? 'good' : 'default'}>{b.pitch_deck_ready ? '✓ Pitch deck v1' : 'Deck v1 pending'}</Chip>
        <Chip tone={b.incorporated ? 'good' : 'default'}>{b.incorporated ? '✓ Incorporated' : 'Pre-incorporation'}</Chip>
      </div>
      {(isUnfilled(b.tagline) && isUnfilled(b.vision)) &&
        <div style={{ marginTop: 16 }}><Nudge>Complete the Week 4 Brand kit milestone to fill tagline + vision.</Nudge></div>}
    </SlideShell>
  );
};

const Slide_VentureReadiness: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const v = d.venture_readiness;
  return (
    <SlideShell>
      <Eyebrow>{v.eyebrow}{v.is_sandbox ? ' · sandbox' : ''}</Eyebrow>
      <SlideHeading>{v.headline}</SlideHeading>
      {v.breakdown.length === 0
        ? <div style={{ marginTop: 32 }}><Nudge>Run your venture-readiness score in Week 2 to unlock this slide.</Nudge></div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 32 }}>
            {v.breakdown.map((b, i) => <MetricCard key={i} m={{ label: b.label, value: b.value }} />)}
          </div>
        )}
      <div style={{ marginTop: 'auto', maxWidth: 760 }}>
        {!isUnfilled(v.ai_notes) && <Body>{v.ai_notes}</Body>}
      </div>
    </SlideShell>
  );
};

const Slide_Team: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const t = d.team;
  return (
    <SlideShell>
      <Eyebrow>{t.eyebrow}</Eyebrow>
      <SlideHeading>{t.headline}</SlideHeading>
      {t.founders.length === 0
        ? <div style={{ marginTop: 32 }}><Nudge>Seed your cap table in Week 3 to list the founding team here.</Nudge></div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(t.founders.length, 4)}, 1fr)`, gap: 16, marginTop: 32 }}>
            {t.founders.map((f, i) => (
              <div key={i} style={{ padding: '20px 18px', borderRadius: 12, border: '1px solid currentColor' }}>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{f.name}</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>{f.role}</div>
                {f.bio && <Body max={220}>{f.bio}</Body>}
              </div>
            ))}
          </div>
        )}
      <div style={{ marginTop: 28, maxWidth: 760 }}>
        {!isUnfilled(t.team_intro) && <Body>{t.team_intro}</Body>}
      </div>
    </SlideShell>
  );
};

const Slide_MentorNetwork: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const m = d.mentor_network;
  return (
    <SlideShell>
      <Eyebrow>{m.eyebrow}</Eyebrow>
      <SlideHeading>{m.headline}</SlideHeading>
      <div style={{ marginTop: 28, maxWidth: 760 }}>
        {isUnfilled(m.body)
          ? <Nudge>Answer the "mentors and network" advisor questions to populate this slide.</Nudge>
          : <Body>{m.body}</Body>}
      </div>
      {m.mentors.length > 0 && (
        <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {m.mentors.map((x, i) => <Chip key={i}>{x}</Chip>)}
        </div>
      )}
      <div style={{ marginTop: 'auto' }}>
        {m.network_signals.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {m.network_signals.map((s, i) => <li key={i} style={{ marginBottom: 6 }}><Body>{s}</Body></li>)}
          </ul>
        )}
      </div>
    </SlideShell>
  );
};

const Slide_CapTable: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const c = d.cap_table;
  const { pal, fonts } = useVariant();
  return (
    <SlideShell>
      <Eyebrow>{c.eyebrow}</Eyebrow>
      <SlideHeading>{c.headline}</SlideHeading>
      {c.holders.length === 0
        ? <div style={{ marginTop: 32 }}><Nudge>Seed your cap table in Week 3 to show ownership here.</Nudge></div>
        : (
          <table style={{ marginTop: 32, width: '100%', borderCollapse: 'collapse', fontFamily: fonts.mono, fontSize: 13 }}>
            <thead>
              <tr style={{ color: pal.muted, textAlign: 'left', borderBottom: `1px solid ${pal.rule}` }}>
                <th style={{ padding: '10px 0', fontWeight: 500 }}>Holder</th>
                <th style={{ padding: '10px 0', fontWeight: 500 }}>Kind</th>
                <th style={{ padding: '10px 0', fontWeight: 500 }}>Security</th>
                <th style={{ padding: '10px 0', fontWeight: 500, textAlign: 'right' }}>Ownership</th>
              </tr>
            </thead>
            <tbody>
              {c.holders.map((h, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${pal.rule}`, color: pal.ink }}>
                  <td style={{ padding: '12px 0' }}>{h.name}</td>
                  <td style={{ padding: '12px 0', color: pal.muted }}>{h.kind}</td>
                  <td style={{ padding: '12px 0', color: pal.muted }}>{h.role}</td>
                  <td style={{ padding: '12px 0', textAlign: 'right' }}>{h.ownership_pct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <div style={{ marginTop: 'auto', color: pal.muted, fontSize: 12 }}>{c.note}</div>
    </SlideShell>
  );
};

const Slide_Ask: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const a = d.ask;
  const { pal, fonts } = useVariant();
  const askMissing = a.raise_amount === DASH;
  return (
    <SlideShell>
      <Eyebrow>{a.eyebrow}</Eyebrow>
      <SlideHeading>{a.headline}</SlideHeading>
      <div style={{ display: 'flex', gap: 32, marginTop: 32, alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: pal.muted, fontFamily: fonts.mono, fontSize: 11, letterSpacing: '0.12em' }}>RAISE</div>
          <div style={{ fontFamily: fonts.display, fontSize: 56, fontWeight: 700, color: askMissing ? pal.muted : pal.ink, lineHeight: 1 }}>{a.raise_amount}</div>
        </div>
        <div>
          <div style={{ color: pal.muted, fontFamily: fonts.mono, fontSize: 11, letterSpacing: '0.12em' }}>RUNWAY</div>
          <div style={{ fontFamily: fonts.display, fontSize: 56, fontWeight: 700, color: a.runway === DASH ? pal.muted : pal.ink, lineHeight: 1 }}>{a.runway}</div>
        </div>
      </div>
      {askMissing && <div style={{ marginTop: 20 }}><Nudge>Set `funding_needed` on your project to show a raise amount.</Nudge></div>}
      <div style={{ marginTop: 28, flex: 1 }}>
        <Eyebrow>Use of funds</Eyebrow>
        {a.use_of_funds.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {a.use_of_funds.map((u, i) => (
              <div key={i} style={{ padding: '12px 14px', border: `1px solid ${pal.rule}`, borderRadius: 8 }}>
                <div style={{ fontFamily: fonts.mono, fontSize: 11, color: pal.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{u.label}</div>
                <div style={{ fontFamily: fonts.display, fontSize: 28, fontWeight: 700 }}>{u.pct}%</div>
              </div>
            ))}
          </div>
        ) : <Nudge>Set `use_of_funds` on your project (e.g. "Engineering 50, GTM 30, Ops 20") to break down the spend.</Nudge>}
      </div>
      <div style={{ marginTop: 20 }}>
        <Eyebrow>Next milestones</Eyebrow>
        {a.next_milestones.some((x) => x !== DASH)
          ? <ul style={{ margin: 0, paddingLeft: 18 }}>{a.next_milestones.map((m, i) => <li key={i}><Body max={520}>{m}</Body></li>)}</ul>
          : <div style={{ opacity: 0.6, fontSize: 12 }}>Add Now / Next / Later OKRs to surface milestones here.</div>}
      </div>
    </SlideShell>
  );
};

const Slide_AxalSignal: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const a = d.axal_signal;
  const { pal, fonts } = useVariant();
  return (
    <SlideShell>
      <Eyebrow>{a.eyebrow}</Eyebrow>
      <SlideHeading>{a.headline}</SlideHeading>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 28 }}>
        {a.lab_weeks.length === 0 ? (
          <div style={{ gridColumn: '1 / -1' }}><Nudge>Once you start the Lab and complete milestones, the four-week sprint shows here.</Nudge></div>
        ) : a.lab_weeks.map((w) => {
          const toneBg = w.status === 'complete' ? pal.accentSoft : w.status === 'in_progress' ? pal.chip : pal.surface;
          const accent = w.status === 'complete' ? pal.accent : w.status === 'in_progress' ? pal.warn : pal.muted;
          return (
            <div key={w.week} style={{ background: toneBg, border: `1px solid ${pal.rule}`, borderRadius: 10, padding: '14px 14px' }}>
              <div style={{ color: accent, fontFamily: fonts.mono, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Week {w.week} · {w.status.replace('_', ' ')}</div>
              <div style={{ fontFamily: fonts.display, fontSize: 18, fontWeight: 700, margin: '6px 0' }}>{w.title}</div>
              <div style={{ fontSize: 12, color: pal.muted, marginBottom: 10 }}>{w.caption}</div>
              <ul style={{ margin: 0, paddingLeft: 14, fontSize: 12 }}>
                {w.milestones.map((m) => (
                  <li key={m.key} style={{ opacity: m.done ? 1 : 0.5 }}>{m.done ? '✓ ' : '○ '}{m.label}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 'auto', maxWidth: 760 }}>
        {!isUnfilled(a.body) && <Body>{a.body}</Body>}
      </div>
    </SlideShell>
  );
};

const Slide_Contact: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const c = d.contact;
  const { pal, fonts } = useVariant();
  return (
    <SlideShell>
      <Eyebrow>{c.eyebrow}</Eyebrow>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <h2 style={{
          color: pal.ink, fontFamily: fonts.display,
          fontSize: 72, lineHeight: 1.02, letterSpacing: '-0.02em',
          fontWeight: 700, margin: 0,
        }}>{c.headline}</h2>
        <div style={{ marginTop: 24, maxWidth: 760 }}>
          {!isUnfilled(c.body) && <Body>{c.body}</Body>}
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${pal.rule}`, paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontFamily: fonts.mono, fontSize: 14, color: c.contact_email === DASH ? pal.muted : pal.ink }}>{c.contact_email}</div>
        <div style={{ fontFamily: fonts.body, fontSize: 14, color: pal.muted }}>{c.signoff}</div>
      </div>
    </SlideShell>
  );
};

/* ─────────────────────────── slide registry ─────────────────────────── */

type SlideEntry = { id: string; title: string; Component: React.FC<{ d: SpinoutDemoDayData }> };
const SLIDES: SlideEntry[] = [
  { id: 'cover',             title: 'Cover',             Component: Slide_Cover },
  { id: 'problem',           title: 'Problem',           Component: Slide_Problem },
  { id: 'validation',        title: 'Validation',        Component: Slide_Validation },
  { id: 'market',            title: 'Market',            Component: Slide_Market },
  { id: 'solution',          title: 'Solution',          Component: Slide_Solution },
  { id: 'roadmap',           title: 'Roadmap',           Component: Slide_Roadmap },
  { id: 'brand',             title: 'Brand',             Component: Slide_Brand },
  { id: 'venture_readiness', title: 'Venture readiness', Component: Slide_VentureReadiness },
  { id: 'team',              title: 'Team',              Component: Slide_Team },
  { id: 'mentor_network',    title: 'Mentors & network', Component: Slide_MentorNetwork },
  { id: 'cap_table',         title: 'Cap table',         Component: Slide_CapTable },
  { id: 'ask',               title: 'Ask',               Component: Slide_Ask },
  { id: 'axal_signal',       title: 'Axal signal',       Component: Slide_AxalSignal },
  { id: 'contact',           title: 'Contact',           Component: Slide_Contact },
];

/* ─────────────────────────── root deck ─────────────────────────── */

const SlideStage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    position: 'relative', width: '100%', aspectRatio: '16 / 9',
    background: '#000', borderRadius: 12, overflow: 'hidden',
  }}>{children}</div>
);

const DeckRoot: React.FC<DeckProps> = (props) => {
  const data = useMemo(() => hydrate(props.data), [props.data]);
  const editable = !!(props as unknown as { editable?: boolean }).editable;

  const [variant, setVariantState] = useState<VariantId>('editorial');
  useEffect(() => {
    try {
      const stored = typeof window !== 'undefined' ? window.localStorage?.getItem(VARIANT_KEY) : null;
      if (stored && (VARIANTS as readonly string[]).includes(stored)) {
        setVariantState(stored as VariantId);
      }
    } catch { /* SSR / quota / private-mode — silent */ }
  }, []);
  const setVariant = (v: VariantId) => {
    setVariantState(v);
    try { window.localStorage?.setItem(VARIANT_KEY, v); } catch { /* swallow */ }
  };

  const [index, setIndex] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); setIndex((i) => Math.min(SLIDES.length - 1, i + 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
      else if (e.key === 'Home') { e.preventDefault(); setIndex(0); }
      else if (e.key === 'End') { e.preventDefault(); setIndex(SLIDES.length - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pal = PALETTES[variant];
  const fonts = FONTS[variant];
  const ctx: VariantCtx = { variant, setVariant, pal, fonts, editable };

  const Active = SLIDES[index].Component;

  return (
    <VariantContext.Provider value={ctx}>
      <div style={{ width: '100%', maxWidth: 1280, margin: '0 auto', padding: 16, color: pal.ink }}>
        <SlideStage>
          {editable && <VariantSwitcher />}
          <Active d={data} />
        </SlideStage>
        <div style={{
          marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: fonts.mono, fontSize: 12, color: pal.muted,
        }}>
          <div>{index + 1} / {SLIDES.length} · {SLIDES[index].title}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setIndex(i)}
                style={{
                  width: 8, height: 8, borderRadius: 999, border: 'none',
                  background: i === index ? pal.accent : pal.rule, cursor: 'pointer',
                }}
              />
            ))}
          </div>
          <div>← / → / Home / End</div>
        </div>
      </div>
    </VariantContext.Provider>
  );
};

/**
 * Default export — registered as `Deck_axal_spinout_demoday` in
 * `frontend/src/decks/templates/index.ts`.
 */
export const Deck_axal_spinout_demoday: React.FC<DeckProps> = (props) => <DeckRoot {...props} />;
export default Deck_axal_spinout_demoday;
