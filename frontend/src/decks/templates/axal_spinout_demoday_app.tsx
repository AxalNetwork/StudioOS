/**
 * axal_spinout_demoday_app.tsx — Task #15
 *
 * Axal 30-day Spin-Out Lab — Demo Day deck (11 slides, 4 variants).
 *
 * Self-contained React + TS + Tailwind + Framer Motion adapter rendering
 * 11 fixed slides in the spec-required order:
 *
 *   Cover · Problem · Validation · Market · Solution · Roadmap ·
 *   Team & readiness · Mentors & Network · Cap Table · Ask ·
 *   Review the deal
 *
 * The Solution slide carries the product-demo media (loop/screenshot);
 * there is no standalone Product Demo slide.
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
 * write the result as 11 slides where each slide carries one
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
import { Slide16x9 } from '../DeckBase';
import { useReviewDealSlot } from './reviewDealSlot';
import { trimPitchCopyToMax, getPitchCopyLengthStatus, extractPitchHeadline, HEADLINE_MAX_WORDS } from '../../lib/pitchCopyLength';

/* ─────────────────────────── variant tokens ─────────────────────────── */

// Axal brand: violet (`#7c3aed` / `#8b5cf6` / `#a78bfa`). All four
// variants pivot around these accents so the Spin-Out deck visually
// belongs in the same family as the rest of the app.
const PALETTES = {
  editorial: {
    bg: '#FAF7FF', surface: '#FFFFFF', ink: '#1B1430', inkSoft: '#3B2D5C',
    muted: '#7A6E94', accent: '#7C3AED', accentSoft: '#EDE4FF', rule: '#E6DCFC',
    chip: '#F0E8FF', good: '#3F6650', warn: '#B68A2E',
  },
  product_first: {
    bg: '#0B0916', surface: '#15112A', ink: '#F5F2FF', inkSoft: '#CBC1E8',
    muted: '#7E76A0', accent: '#A78BFA', accentSoft: '#1F1542', rule: '#241A45',
    chip: '#1E1638', good: '#7EC596', warn: '#F0C36A',
  },
  data_dense: {
    bg: '#F4F2FA', surface: '#FFFFFF', ink: '#1B1233', inkSoft: '#3A2D5A',
    muted: '#6B5F88', accent: '#6D28D9', accentSoft: '#E0D5F5', rule: '#D8CFEC',
    chip: '#E5DCF5', good: '#107E5C', warn: '#A26200',
  },
  manifesto: {
    bg: '#0A0716', surface: '#14102A', ink: '#FFFAFF', inkSoft: '#D9D0F0',
    muted: '#7A709A', accent: '#C4B5FD', accentSoft: '#241152', rule: '#1F1840',
    chip: '#1A1432', good: '#9DDDA8', warn: '#FFD06A',
  },
} as const;

type Vibe = 'serif' | 'sans' | 'mono' | 'cinematic';
type PresetVariantId = keyof typeof PALETTES;
// Task #22 — `brand_kit` is a synthetic 5th look derived at runtime from
// the founder's saved Brand Builder kit; it is NOT a key of PALETTES/FONTS.
export type VariantId = PresetVariantId | 'brand_kit';
const VARIANTS: PresetVariantId[] = ['editorial', 'product_first', 'data_dense', 'manifesto'];
const VARIANT_LABEL: Record<VariantId, string> = {
  editorial: 'Editorial', product_first: 'Product-first',
  data_dense: 'Data-dense', manifesto: 'Manifesto', brand_kit: 'My brand kit',
};

type FontSet = { display: string; body: string; mono: string };
const MONO_STACK = '"JetBrains Mono",ui-monospace,Menlo,monospace';
const FONTS: Record<PresetVariantId, FontSet> = {
  editorial:     { display: '"Playfair Display","GT Sectra",Georgia,serif', body: '"Source Serif Pro",Georgia,serif',          mono: MONO_STACK },
  product_first: { display: '"Inter","Helvetica Neue",system-ui,sans-serif', body: '"Inter","Helvetica Neue",system-ui,sans-serif', mono: MONO_STACK },
  data_dense:    { display: '"Inter","Helvetica Neue",system-ui,sans-serif', body: '"Inter","Helvetica Neue",system-ui,sans-serif', mono: MONO_STACK },
  manifesto:     { display: '"Inter","Helvetica Neue",system-ui,sans-serif', body: '"Inter","Helvetica Neue",system-ui,sans-serif', mono: MONO_STACK },
};

/* ─────────────────────────── brand-kit theming (Task #22) ─────────────────────────── */
// Curated font pairings the founder can pick in Brand Builder. Restricted
// to fonts the app already loads so the deck never renders a missing face.
// `FONT_PAIRING_OPTIONS` is the single source of truth the Brand Builder
// <select> imports — keep ids stable (they persist to landing_pages).
type FontPairingId = 'editorial' | 'modern' | 'humanist' | 'classic';
const FONT_PAIRINGS: Record<FontPairingId, { label: string; display: string; body: string; mono: string; vibe: Vibe }> = {
  editorial: { label: 'Editorial · Serif',       display: '"Playfair Display",Georgia,serif', body: '"Source Serif Pro",Georgia,serif', mono: MONO_STACK, vibe: 'serif' },
  modern:    { label: 'Modern · Sans',           display: '"Inter",system-ui,sans-serif',     body: '"Inter",system-ui,sans-serif',     mono: MONO_STACK, vibe: 'sans'  },
  humanist:  { label: 'Humanist · Serif + Sans', display: '"Playfair Display",Georgia,serif', body: '"Inter",system-ui,sans-serif',       mono: MONO_STACK, vibe: 'serif' },
  classic:   { label: 'Classic · Serif + Sans',  display: '"Source Serif Pro",Georgia,serif', body: '"Inter",system-ui,sans-serif',       mono: MONO_STACK, vibe: 'sans'  },
};
export const FONT_PAIRING_OPTIONS: Array<{ value: FontPairingId; label: string }> =
  (Object.keys(FONT_PAIRINGS) as FontPairingId[]).map((k) => ({ value: k, label: FONT_PAIRINGS[k].label }));

type Palette = {
  bg: string; surface: string; ink: string; inkSoft: string;
  muted: string; accent: string; accentSoft: string; rule: string;
  chip: string; good: string; warn: string;
};

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = (h: string): string => {
  let s = h.trim().toLowerCase();
  if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return s;
};
const sanitizeHex = (v: unknown, fallback: string): string =>
  (typeof v === 'string' && HEX_RE.test(v.trim())) ? normHex(v) : fallback;
const hexToRgb = (h: string): [number, number, number] => {
  const s = normHex(h);
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
};
const toHex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const rgbToHex = (r: number, g: number, b: number) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hexToRgb(a); const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
};
const relLum = (h: string): number => {
  const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const [r, g, b] = hexToRgb(h);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: string, b: string): number => {
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

type BrandKitData = { present: boolean; bg: string; accent: string; ink: string; fonts: string };

// Build a full Palette + FontSet from the founder's saved brand kit (bg +
// accent + ink + font pairing). Returns null when no kit is saved so the
// deck falls back to the editorial preset. Every derived colour is
// contrast-checked: an ink or accent that fails against the chosen
// background is replaced with a safe value so text never disappears.
const EDITORIAL = PALETTES.editorial;
function buildBrandKitTheme(kit: BrandKitData | undefined | null):
  { pal: Palette; fonts: FontSet; isDark: boolean; vibe: Vibe } | null {
  if (!kit || !kit.present) return null;
  const bg = sanitizeHex(kit.bg, EDITORIAL.bg);
  const isDark = relLum(bg) < 0.4;
  const safeInk = isDark ? '#F7F4FF' : '#15102A';
  let ink = sanitizeHex(kit.ink, safeInk);
  if (contrast(ink, bg) < 4.5) ink = safeInk;
  let accent = sanitizeHex(kit.accent, EDITORIAL.accent);
  if (contrast(accent, bg) < 3) {
    accent = isDark ? mix(accent, '#ffffff', 0.45) : mix(accent, '#000000', 0.2);
    if (contrast(accent, bg) < 3) accent = isDark ? '#C4B5FD' : EDITORIAL.accent;
  }
  const pal: Palette = {
    bg,
    surface: mix(bg, isDark ? '#ffffff' : '#000000', 0.04),
    ink,
    inkSoft: mix(ink, bg, 0.26),
    muted: mix(ink, bg, 0.5),
    accent,
    accentSoft: mix(accent, bg, isDark ? 0.8 : 0.86),
    rule: mix(ink, bg, isDark ? 0.8 : 0.86),
    chip: mix(accent, bg, isDark ? 0.84 : 0.9),
    good: isDark ? '#7EC596' : '#3F6650',
    warn: isDark ? '#F0C36A' : '#B68A2E',
  };
  const pairKey: FontPairingId = (kit.fonts && kit.fonts in FONT_PAIRINGS ? kit.fonts : 'editorial') as FontPairingId;
  const pair = FONT_PAIRINGS[pairKey];
  return { pal, fonts: { display: pair.display, body: pair.body, mono: pair.mono }, isDark, vibe: pair.vibe };
}

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

// Task #14 — new structured payloads alongside the legacy text fields.
// Activity modules coloured distinctly on the Cover strip.
export type ActivityModule = 'milestone' | 'interview' | 'advisor';
// `count` is the per-day total (height scaling); `modules` carries the
// per-module breakdown. `kind` kept optional for back-compat with decks
// persisted before the per-module breakdown landed.
export type ActivityLogDay = { date: string; count: number; modules?: Record<string, number>; kind?: string };
export type PainTheme = { theme: string; mentions: number };
// Task #2 — structured revenue proof rendered by RevenueProofCard on the
// Validation slide. `status` is always set so the card always has a
// graceful state (incl. pre-revenue). Numeric fields are null when the
// founder hasn't logged them. Legacy {amount,label,signed} pill fields
// are kept optional for back-compat with older deck-version JSON.
export type RevenueProof = {
  status: 'paid' | 'pilot_paid' | 'pilot_signed' | 'pre_revenue';
  total_revenue: number | null;
  mrr: number | null;
  paying_customers: number | null;
  first_payment_date: string | null;
  amount?: string;
  label?: string;
  signed?: boolean;
} | null;
export type MentorProfile = {
  name: string;
  role: string;
  bio: string;
  skills: string[];
  // Task #1 — admin-managed roster fields (optional for back-compat
  // with any cached decks emitted before the network_profiles swap).
  photo_url?: string | null;
  linkedin_url?: string | null;
  kind?: string;
};
export type SkillAxis = { label: string; value: number };
export type NetworkCategory = { category: string; count: number };
export type DealAccess = {
  deal_room_url: string;
  nda_required: boolean;
  data_room_ready: boolean;
  cta_label: string;
};

export type SpinoutDemoDayData = {
  meta: {
    project_name: string; sector: string;
    founder_name: string; contact_email: string;
    presented_on: string;
    week: number; days_remaining: number; lab_active: boolean;
    is_sample: boolean;
  };
  cover: {
    eyebrow: string; headline: string; sub: string; location: string;
    activity_log: ActivityLogDay[];
  };
  problem: {
    eyebrow: string; headline: string; body: string; signals: string[];
    pain_themes: PainTheme[];
  };
  validation: {
    eyebrow: string; headline: string; body: string;
    metrics: Metric[]; quotes: { name: string; role: string; takeaway: string }[];
    question: string;
    ratings: number[];
    revenue_proof: RevenueProof;
  };
  market: { eyebrow: string; headline: string; tam: string; sam: string; som: string; why_now: string[] };
  solution: { eyebrow: string; headline: string; body: string; capabilities: string[] };
  roadmap: {
    eyebrow: string; headline: string; quarter: string;
    now: string[]; next: string[]; later: string[];
  };
  brand_kit: { present: boolean; bg: string; accent: string; ink: string; fonts: string };
  venture_readiness: {
    eyebrow: string; headline: string;
    total_score: string; tier: string; is_sandbox: boolean;
    breakdown: { label: string; value: string }[]; ai_notes: string;
  };
  team: { eyebrow: string; headline: string; founders: Founder[]; team_intro: string };
  mentor_network: {
    eyebrow: string; headline: string; body: string;
    mentors: string[]; network_signals: string[];
    profiles: MentorProfile[];
    skill_coverage: SkillAxis[];
    network: NetworkCategory[];
  };
  product_demo: {
    eyebrow: string; headline: string; body: string;
    loop_url: string; screenshot_url: string; caption: string;
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
    deal_access: DealAccess;
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
    eyebrow: 'Axal VC · 30-Day Spin-Out Lab · Demo Day',
    headline: 'Your story, in 11 slides.',
    sub: 'A pre-incorporation thesis, sharpened across 30 days of Discovery, OKRs, Scoring and Cap-Table prep.',
    location: 'Axal Network · Demo Day',
    activity_log: [],
  },
  problem: {
    eyebrow: '01 · Problem', headline: 'Why this is broken today.',
    body: DASH, signals: [], pain_themes: [],
  },
  validation: {
    eyebrow: '02 · Validation', headline: 'Discovery — what we heard.',
    body: DASH, metrics: [
      { label: 'Interviews', value: DASH, sub: 'logged in Lab' },
      { label: 'Distinct pains', value: DASH, sub: 'tagged' },
      { label: 'Hypotheses validated', value: DASH, sub: 'evidence-backed' },
    ], quotes: [],
    question: 'How well does our solution address the problem? (0–5)',
    ratings: [],
    revenue_proof: {
      status: 'pre_revenue',
      total_revenue: null,
      mrr: null,
      paying_customers: null,
      first_payment_date: null,
    },
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
  brand_kit: { present: false, bg: '', accent: '', ink: '', fonts: '' },
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
    eyebrow: '10 · Mentors & network', headline: 'Who is around the table.',
    body: '', mentors: [], network_signals: [],
    profiles: [], skill_coverage: [], network: [],
  },
  product_demo: {
    eyebrow: '06 · Product demo', headline: 'See it in motion.',
    body: DASH, loop_url: '', screenshot_url: '',
    caption: 'A 30-second loop of the MVP — drop a video URL on the project to surface here.',
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
    eyebrow: '13 · Review the deal', headline: 'Review the deal.',
    body: DASH, contact_email: DASH, signoff: '— The founding team',
    deal_access: {
      deal_room_url: '', nda_required: true, data_room_ready: false,
      cta_label: 'Review the deal',
    },
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
 * Read flat per-field keys from `data` and rebuild the nested
 * SpinoutDemoDayData shape. Field keys are emitted by the worker
 * (`buildAxalSpinoutDemoDaySlides()` in
 * `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts`) and
 * flow through `buildTemplateData()` in `PitchDeckPrintPage.jsx`,
 * which flattens slide fields into one top-level dict.
 *
 * Text and bullet fields are read directly as strings / string[].
 * Complex object arrays (validation quotes, team founders, cap-table
 * holders, axal-signal lab weeks) ride as a single JSON-encoded
 * paragraph field with a `_json` suffix — these are populated by
 * Lab data and aren't meant to be hand-edited in the deck builder.
 *
 * Backwards-compatible: also reads the legacy
 * `axal_spinout_section_<name>` JSON-paragraph keys so decks created
 * before this rewrite continue to render.
 */
const asStr = (v: unknown, fallback: string): string => {
  if (v == null) return fallback;
  const s = typeof v === 'string' ? v : String(v);
  const t = s.trim();
  return t ? t : fallback;
};
const asBool = (v: unknown): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
};
const asArr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    return s.split(/\n+/).map((x) => x.replace(/^[-•·\s]+/, '').trim()).filter(Boolean);
  }
  return [];
};
const asMetricGrid = (v: unknown): Array<{ label: string; value: string; sub?: string }> => {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      label: String(x.label ?? '').trim(),
      value: String(x.value ?? '').trim() || DASH,
      sub: x.sub != null ? String(x.sub).trim() : undefined,
    }))
    .filter((x) => x.label);
};
const parseJsonField = <T,>(v: unknown, fallback: T): T => {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v as T;
  if (typeof v !== 'string') return fallback;
  try {
    const j = JSON.parse(v);
    return j == null ? fallback : (j as T);
  } catch { return fallback; }
};

// Slug helper for re-deriving stable React keys on the lab-week
// milestone list when we round-trip them through plain bullet strings.
const slug = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item';

function hydrate(raw: unknown): SpinoutDemoDayData {
  const base = SAMPLE_DATA;
  if (!raw || typeof raw !== 'object') return base;
  const d = raw as Record<string, unknown>;

  // Legacy support — if any axal_spinout_section_* key is present, fall
  // back to the original JSON-encoded merge path so decks created
  // before the flat-field rewrite still render correctly.
  const hasLegacy = Object.keys(d).some((k) => k.startsWith('axal_spinout_section_'));
  if (hasLegacy) {
    let out: SpinoutDemoDayData = base;
    for (const k of Object.keys(d)) {
      if (!k.startsWith('axal_spinout_section_')) continue;
      const section = k.slice('axal_spinout_section_'.length);
      if (!(section in out)) continue;
      const v = d[k];
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

  // Flat-field path — every value the editor surfaces is a real string,
  // bullets array, or metric_grid row. No JSON blobs in the editor.
  const asUseOfFunds = (v: unknown): FundUse[] => {
    const grid = asMetricGrid(v);
    return grid.map((c) => {
      const rawVal = String(c.value).replace('%', '').trim();
      const pct = Number(rawVal);
      return { label: c.label, pct: isFinite(pct) ? pct : 0 };
    }).filter((x) => x.label && x.pct > 0);
  };

  // {name, role, takeaway} × 3 — drop rows whose takeaway is empty.
  const readQuotes = (): SpinoutDemoDayData['validation']['quotes'] => {
    const rows = [1, 2, 3].map((i) => ({
      name: asStr(d[`validation_quote${i}_name`], ''),
      role: asStr(d[`validation_quote${i}_role`], ''),
      takeaway: asStr(d[`validation_quote${i}_takeaway`], ''),
    }));
    return rows.filter((r) => r.takeaway);
  };

  // {name, role, bio?} × 4 — drop rows whose name is empty.
  const readFounders = (): Founder[] => {
    const rows = [1, 2, 3, 4].map((i) => {
      const bio = asStr(d[`team_founder${i}_bio`], '');
      return {
        name: asStr(d[`team_founder${i}_name`], ''),
        role: asStr(d[`team_founder${i}_role`], ''),
        bio: bio ? bio : undefined,
      };
    });
    return rows.filter((r) => r.name);
  };

  // metric_grid → Holder[] (label=name, value=ownership_pct,
  // sub="security · kind"). Empty rows are silently dropped.
  const readHolders = (): Holder[] => {
    const grid = asMetricGrid(d.ct_holders);
    return grid.map((c) => {
      const parts = (c.sub ?? '').split('·').map((x) => x.trim()).filter(Boolean);
      const role = parts[0] || DASH;
      const kind = parts[1] || DASH;
      return {
        name: c.label, role, kind,
        ownership_pct: c.value || DASH,
      };
    }).filter((h) => h.name);
  };

  // Parse "[x] Label" / "[ ] Label" bullets back into milestone rows.
  const parseMilestones = (
    v: unknown,
  ): SpinoutDemoDayData['axal_signal']['lab_weeks'][number]['milestones'] => {
    return asArr(v).map((line) => {
      const m = /^\s*\[(\s|x|X)\]\s*(.+)$/.exec(line);
      if (m) {
        const done = m[1].toLowerCase() === 'x';
        const label = m[2].trim();
        return { key: slug(label), label, done };
      }
      return { key: slug(line), label: line.trim(), done: false };
    }).filter((x) => x.label);
  };

  const readLabWeeks = (): LabWeek[] => {
    const rows = [1, 2, 3, 4].map((i) => {
      const title = asStr(d[`as_week${i}_title`], '');
      const caption = asStr(d[`as_week${i}_caption`], '');
      const status = asStr(d[`as_week${i}_status`], 'upcoming') as LabWeek['status'];
      const milestones = parseMilestones(d[`as_week${i}_milestones`]);
      return {
        week: i, title, caption,
        status: (status === 'complete' || status === 'in_progress' || status === 'upcoming') ? status : 'upcoming',
        milestones,
      };
    });
    return rows.filter((r) => r.title || r.milestones.length > 0);
  };

  // Meta — every value is a flat paragraph string.
  const week = Number(asStr(d.meta_week, '0')) || base.meta.week;
  const daysRemaining = Number(asStr(d.meta_days_remaining, '')) || base.meta.days_remaining;

  return {
    meta: {
      project_name: asStr(d.meta_project_name, base.meta.project_name),
      sector: asStr(d.meta_sector, base.meta.sector),
      founder_name: asStr(d.meta_founder_name, base.meta.founder_name),
      contact_email: asStr(d.meta_contact_email, base.meta.contact_email),
      presented_on: asStr(d.meta_presented_on, base.meta.presented_on),
      week, days_remaining: daysRemaining,
      lab_active: asBool(d.meta_lab_active),
      is_sample: asBool(d.meta_is_sample),
    },
    cover: {
      eyebrow: asStr(d.cover_eyebrow, base.cover.eyebrow),
      headline: asStr(d.cover_headline, base.cover.headline),
      sub: asStr(d.cover_sub, base.cover.sub),
      location: asStr(d.cover_location, base.cover.location),
      activity_log: parseJsonField<ActivityLogDay[]>(d.cover_activity_log_json, []),
    },
    problem: {
      eyebrow: asStr(d.problem_eyebrow, base.problem.eyebrow),
      headline: asStr(d.problem_headline, base.problem.headline),
      body: asStr(d.problem_body, base.problem.body),
      signals: asArr(d.problem_signals),
      pain_themes: parseJsonField<PainTheme[]>(d.problem_pain_themes_json, []),
    },
    validation: {
      eyebrow: asStr(d.validation_eyebrow, base.validation.eyebrow),
      headline: asStr(d.validation_headline, base.validation.headline),
      body: asStr(d.validation_body, base.validation.body),
      metrics: (() => {
        const g = asMetricGrid(d.validation_metrics);
        return g.length > 0 ? g : base.validation.metrics;
      })(),
      quotes: readQuotes(),
      question: asStr(d.validation_question, base.validation.question),
      ratings: (() => {
        const raw = parseJsonField<unknown[]>(d.validation_ratings_json, []);
        return (Array.isArray(raw) ? raw : []).map((x) => Number(x))
          .filter((n) => isFinite(n) && n >= 0 && n <= 5);
      })(),
      revenue_proof: parseJsonField<RevenueProof>(d.validation_revenue_proof_json, null),
    },
    market: {
      eyebrow: asStr(d.market_eyebrow, base.market.eyebrow),
      headline: asStr(d.market_headline, base.market.headline),
      tam: asStr(d.market_tam, base.market.tam),
      sam: asStr(d.market_sam, base.market.sam),
      som: asStr(d.market_som, base.market.som),
      why_now: asArr(d.market_why_now),
    },
    solution: {
      eyebrow: asStr(d.solution_eyebrow, base.solution.eyebrow),
      headline: asStr(d.solution_headline, base.solution.headline),
      body: asStr(d.solution_body, base.solution.body),
      capabilities: asArr(d.solution_capabilities),
    },
    roadmap: {
      eyebrow: asStr(d.roadmap_eyebrow, base.roadmap.eyebrow),
      headline: asStr(d.roadmap_headline, base.roadmap.headline),
      quarter: asStr(d.roadmap_quarter, base.roadmap.quarter),
      now: asArr(d.roadmap_now),
      next: asArr(d.roadmap_next),
      later: asArr(d.roadmap_later),
    },
    brand_kit: {
      present: asBool(d.brandkit_present),
      bg: asStr(d.brandkit_bg, ''),
      accent: asStr(d.brandkit_accent, ''),
      ink: asStr(d.brandkit_ink, ''),
      fonts: asStr(d.brandkit_fonts, ''),
    },
    venture_readiness: {
      eyebrow: asStr(d.vr_eyebrow, base.venture_readiness.eyebrow),
      headline: asStr(d.vr_headline, base.venture_readiness.headline),
      total_score: asStr(d.vr_total_score, base.venture_readiness.total_score),
      tier: asStr(d.vr_tier, base.venture_readiness.tier),
      is_sandbox: asBool(d.vr_sandbox),
      breakdown: asMetricGrid(d.vr_breakdown).map((c) => ({ label: c.label, value: c.value })),
      ai_notes: asStr(d.vr_ai_notes, base.venture_readiness.ai_notes),
    },
    team: {
      eyebrow: asStr(d.team_eyebrow, base.team.eyebrow),
      headline: asStr(d.team_headline, base.team.headline),
      founders: readFounders(),
      team_intro: asStr(d.team_intro, base.team.team_intro),
    },
    mentor_network: {
      eyebrow: asStr(d.mn_eyebrow, base.mentor_network.eyebrow),
      headline: asStr(d.mn_headline, base.mentor_network.headline),
      body: asStr(d.mn_body, base.mentor_network.body),
      mentors: asArr(d.mn_mentors),
      network_signals: asArr(d.mn_network_signals),
      profiles: parseJsonField<MentorProfile[]>(d.mn_profiles_json, []),
      skill_coverage: parseJsonField<SkillAxis[]>(d.mn_skill_coverage_json, []),
      network: parseJsonField<NetworkCategory[]>(d.mn_network_json, []),
    },
    product_demo: {
      eyebrow: asStr(d.product_demo_eyebrow, base.product_demo.eyebrow),
      headline: asStr(d.product_demo_headline, base.product_demo.headline),
      body: asStr(d.product_demo_body, base.product_demo.body),
      loop_url: asStr(d.product_demo_loop_url, base.product_demo.loop_url),
      screenshot_url: asStr(d.product_demo_screenshot_url, base.product_demo.screenshot_url),
      caption: asStr(d.product_demo_caption, base.product_demo.caption),
    },
    cap_table: {
      eyebrow: asStr(d.ct_eyebrow, base.cap_table.eyebrow),
      headline: asStr(d.ct_headline, base.cap_table.headline),
      holders: readHolders(),
      note: asStr(d.ct_note, base.cap_table.note),
    },
    ask: {
      eyebrow: asStr(d.ask_eyebrow, base.ask.eyebrow),
      headline: asStr(d.ask_headline, base.ask.headline),
      raise_amount: asStr(d.ask_raise_amount, base.ask.raise_amount),
      runway: asStr(d.ask_runway, base.ask.runway),
      use_of_funds: asUseOfFunds(d.ask_use_of_funds),
      next_milestones: (() => {
        const a = asArr(d.ask_next_milestones);
        return a.length > 0 ? a : base.ask.next_milestones;
      })(),
    },
    axal_signal: {
      eyebrow: asStr(d.as_eyebrow, base.axal_signal.eyebrow),
      headline: asStr(d.as_headline, base.axal_signal.headline),
      body: asStr(d.as_body, base.axal_signal.body),
      lab_weeks: readLabWeeks(),
    },
    contact: {
      eyebrow: asStr(d.contact_eyebrow, base.contact.eyebrow),
      headline: asStr(d.contact_headline, base.contact.headline),
      body: asStr(d.contact_body, base.contact.body),
      contact_email: asStr(d.contact_email, base.contact.contact_email),
      signoff: asStr(d.contact_signoff, base.contact.signoff),
      deal_access: parseJsonField<DealAccess>(d.contact_deal_access_json, base.contact.deal_access),
    },
  };
}

/* ─────────────────────────── variant context ─────────────────────────── */

type VariantCtx = {
  variant: VariantId;
  setVariant: (v: VariantId) => void;
  pal: Palette;
  fonts: FontSet;
  isDark: boolean;
  vibe: Vibe;
  hasBrandKit: boolean;
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

const SlideHeading: React.FC<{ children: React.ReactNode; size?: 'xl' | '2xl' | '3xl' | 'hero' }>
= ({ children, size = '2xl' }) => {
  const { pal, fonts, variant } = useVariant();
  const sizes = { xl: 36, '2xl': 48, '3xl': 64, hero: 56 };
  return (
    <h2 style={{
      color: pal.ink, fontFamily: fonts.display,
      fontSize: variant === 'manifesto' ? sizes[size] * 1.25 : sizes[size],
      lineHeight: size === 'hero' ? 1.1 : 1.05,
      letterSpacing: variant === 'editorial' ? '-0.01em' : '-0.02em',
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
  const { variant, setVariant, pal, fonts, hasBrandKit } = useVariant();
  const opts: VariantId[] = hasBrandKit ? ['brand_kit', ...VARIANTS] : [...VARIANTS];
  return (
    <div style={{
      position: 'absolute', top: 16, right: 16, zIndex: 10,
      display: 'flex', alignItems: 'center', gap: 8,
      background: pal.surface, border: `1px solid ${pal.rule}`,
      borderRadius: 999, padding: '6px 8px',
      fontFamily: fonts.mono, fontSize: 11, letterSpacing: '0.08em',
    }}>
      <span style={{ color: pal.muted, padding: '0 6px' }}>VARIANT</span>
      {opts.map((v) => (
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

/* ─────────────────────────── visual primitives ─────────────────────────── */
/*
 * Ported from branch `claude/add-missing-sidebar-options-tmCKz` (Task #6).
 * Nine hand-built SVG illustrations + five skeleton-aware chart components.
 * Each chart renders a designed empty state in place of the previous
 * one-line `<Nudge>` bail-out, so the deck never collapses to whitespace
 * when a founder's project is thin. The slide layouts themselves stay as
 * Task #1 left them — the slide redesigns happen in the next task.
 *
 * Adapter shim `useV()` maps the current PALETTES/FONTS into the token
 * names the branch components read (`V.accent`, `V.line`, `V.card`,
 * etc.) so component bodies stay byte-close to the branch source.
 */

type V = {
  accent: string; accentSoft: string;
  line: string; card: string; cardSoft: string;
  ink: string; textSoft: string; textMuted: string;
  emerald: string; rose: string; gold: string;
  display: string; sans: string; mono: string;
  isDark: boolean;
  vibe: 'serif' | 'sans' | 'mono' | 'cinematic';
};

const useV = (): V => {
  const { pal, fonts, isDark, vibe } = useVariant();
  return {
    accent: pal.accent,
    accentSoft: pal.accentSoft,
    line: pal.rule,
    card: pal.surface,
    cardSoft: pal.chip,
    ink: pal.ink,
    textSoft: pal.inkSoft,
    textMuted: pal.muted,
    emerald: pal.good,
    rose: '#B0314A',
    gold: pal.warn,
    display: fonts.display,
    sans: fonts.body,
    mono: fonts.mono,
    isDark,
    vibe,
  };
};

// USD formatter for MarketCircles labels. Empty / non-positive → DASH.
const usdShort = (n: number | null | undefined): string => {
  if (n == null || !isFinite(Number(n)) || Number(n) <= 0) return DASH;
  const v = Number(n);
  if (v >= 1_000_000_000) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1_000_000) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
};

// Coerce a TAM/SAM/SOM string ("$8.4B", "1.2M", "—") to a numeric size.
// Returns 0 for unparseable / unfilled values so MarketCircles renders
// its dashed skeleton.
const parseSize = (raw: unknown): number => {
  if (raw == null) return 0;
  if (typeof raw === 'number') return isFinite(raw) ? raw : 0;
  const s = String(raw).trim();
  if (!s || s === DASH) return 0;
  const m = s.replace(/[\s,_]/g, '').toLowerCase().match(/^\$?(-?\d+(?:\.\d+)?)([kmb])?/);
  if (!m) return 0;
  const base = parseFloat(m[1]);
  if (!isFinite(base)) return 0;
  const mul = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
  return base * mul;
};

/* ───── charts (skeleton-aware) ───── */

/** TAM/SAM/SOM nested circles — dashed concentric rings when all three are 0. */
export const MarketCircles: React.FC<{
  tam: string | number | null | undefined;
  sam: string | number | null | undefined;
  som: string | number | null | undefined;
}> = ({ tam, sam, som }) => {
  const V = useV();
  const T = parseSize(tam);
  const S = parseSize(sam);
  const O = parseSize(som);
  const isEmpty = T === 0 && S === 0 && O === 0;
  const tamR = 140;
  const samR = T > 0 && S > 0 ? Math.max(40, Math.sqrt(S / T) * tamR) : 92;
  const somR = T > 0 && O > 0 ? Math.max(18, Math.sqrt(O / T) * tamR) : 40;
  const dashed = isEmpty ? '4 4' : undefined;
  return (
    <svg viewBox="-180 -180 360 360" style={{ width: '100%', maxWidth: 420, display: 'block' }}>
      <circle r={tamR} fill={V.accent} fillOpacity={isEmpty ? 0.04 : 0.06} stroke={V.accent} strokeOpacity={isEmpty ? 0.35 : 0.4} strokeDasharray={dashed} />
      <circle r={samR} fill={V.accent} fillOpacity={isEmpty ? 0.1 : 0.18} stroke={V.accent} strokeOpacity={isEmpty ? 0.45 : 0.6} strokeDasharray={dashed} />
      <circle r={somR} fill={isEmpty ? 'transparent' : V.accent} stroke={V.accent} strokeDasharray={dashed} strokeWidth={isEmpty ? 1.5 : 0} />
      <text y={-tamR - 10} textAnchor="middle" fontFamily={V.mono} fontSize="10" fill={V.textMuted} letterSpacing="0.18em">
        TAM · {usdShort(T || null)}
      </text>
      <text x={samR + 8} y="-4" fontFamily={V.mono} fontSize="10" fill={V.accent} letterSpacing="0.18em">
        SAM · {usdShort(S || null)}
      </text>
      <text x={somR + 6} y="4" fontFamily={V.mono} fontSize="10" fill={isEmpty ? V.accent : V.isDark ? V.ink : '#fff'} letterSpacing="0.18em">
        SOM · {usdShort(O || null)}
      </text>
    </svg>
  );
};

/** Six-sub-score dashed bars — skeleton when no items. */
export const ScoreBars: React.FC<{
  items?: { label: string; value: string | number }[] | null;
}> = ({ items }) => {
  const V = useV();
  const LABELS = ['Market', 'Team', 'Product', 'Capital', 'Fit', 'Distribution'];
  const numeric = (items || []).map((it) => {
    const n = typeof it.value === 'number' ? it.value : parseFloat(String(it.value).replace(/[^0-9.\-]/g, ''));
    return { label: it.label, value: isFinite(n) ? n : 0 };
  });
  const hasData = numeric.length > 0 && numeric.some((it) => it.value > 0);
  const rows = hasData
    ? numeric
    : LABELS.map((l) => ({ label: l, value: 0 }));
  const max = Math.max(...rows.map((i) => i.value), 20);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: V.display, fontSize: 32, fontWeight: 700, color: hasData ? V.ink : V.textMuted, lineHeight: 1 }}>
          {hasData ? `${Math.round(rows.reduce((s, r) => s + r.value, 0) / rows.length)}/100` : `${DASH}/100`}
        </span>
        {!hasData && (
          <span style={{ background: V.cardSoft, border: `1px dashed ${V.line}`, color: V.textMuted, fontFamily: V.mono, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999 }}>
            Not scored yet
          </span>
        )}
      </div>
      {rows.map((it, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: hasData ? V.ink : V.textMuted }}>{it.label}</span>
            <span style={{ color: V.textMuted, fontFamily: V.mono }}>{hasData ? it.value.toFixed(1) : DASH}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: V.cardSoft }}>
            {hasData ? (
              <div style={{ height: '100%', borderRadius: 3, width: `${(it.value / max) * 100}%`, background: V.accent }} />
            ) : (
              <div style={{
                height: '100%', borderRadius: 3,
                width: `${28 + i * 6}%`,
                background: `repeating-linear-gradient(135deg, ${V.line} 0, ${V.line} 3px, transparent 3px, transparent 6px)`,
                opacity: 0.6,
              }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/** Now / Next / Later kanban — 2 ghost cards per column when empty. */
export const OkrBoard: React.FC<{
  now?: string[]; next?: string[]; later?: string[];
}> = ({ now = [], next = [], later = [] }) => {
  const V = useV();
  const COLS: { key: 'now' | 'next' | 'later'; label: string; tone: string; items: string[] }[] = [
    { key: 'now',   label: 'Now',   tone: V.accent,    items: now },
    { key: 'next',  label: 'Next',  tone: V.gold,      items: next },
    { key: 'later', label: 'Later', tone: V.textMuted, items: later },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, height: '100%' }}>
      {COLS.map((c) => (
        <div key={c.key} style={{ background: V.cardSoft, border: `1px solid ${V.line}`, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: c.tone, display: 'inline-block' }} />
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: c.tone, fontFamily: V.mono }}>{c.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: V.textMuted, fontFamily: V.mono }}>{c.items.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            {c.items.length === 0 ? (
              <>
                {[0, 1].map((g) => (
                  <div key={g} style={{ borderRadius: 6, padding: 12, background: V.card, border: `1px dashed ${V.line}`, opacity: 0.7 }}>
                    <div style={{ height: 8, borderRadius: 4, background: V.line, width: `${65 + g * 12}%` }} />
                    <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: V.line, width: '40%', opacity: 0.7 }} />
                    <div style={{ marginTop: 4, height: 6, borderRadius: 3, background: V.line, width: '55%', opacity: 0.7 }} />
                  </div>
                ))}
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', marginTop: 4, color: V.textMuted, fontFamily: V.mono }}>
                  Add a {c.label.toLowerCase()} OKR
                </div>
              </>
            ) : c.items.slice(0, 4).map((o, i) => (
              <div key={i} style={{ borderRadius: 6, padding: 12, background: V.card, border: `1px solid ${V.line}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, color: V.ink }}>{o}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

/** Cap-table donut + ownership table — ghost 4-slice when total = 0. */
export const CapTablePie: React.FC<{ holders: Holder[] }> = ({ holders }) => {
  const V = useV();
  // Parse ownership_pct ("50%" → 50) and treat as the slice weight.
  const parsed = holders.map((h) => {
    const n = parseFloat(String(h.ownership_pct).replace('%', '').trim());
    return { ...h, pct: isFinite(n) ? n : 0 };
  });
  const total = parsed.reduce((s, h) => s + h.pct, 0);
  const cx = 110, cy = 110, r = 80, ir = 50;
  if (total === 0) {
    const fakeSlices = [
      { kind: 'Founder',            pct: 50 },
      { kind: 'Co-founder',         pct: 30 },
      { kind: 'Option pool',        pct: 12 },
      { kind: 'SAFE / partnership', pct: 8 },
    ];
    let acc2 = 0;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 16 }}>
        <div>
          <svg viewBox="0 0 220 220" style={{ width: '100%' }}>
            {fakeSlices.map((s, i) => {
              const start = (acc2 / 100) * Math.PI * 2 - Math.PI / 2;
              acc2 += s.pct;
              const end = (acc2 / 100) * Math.PI * 2 - Math.PI / 2;
              const large = s.pct > 50 ? 1 : 0;
              const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
              const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end);
              const xi1 = cx + ir * Math.cos(end), yi1 = cy + ir * Math.sin(end);
              const xi2 = cx + ir * Math.cos(start), yi2 = cy + ir * Math.sin(start);
              return (
                <path key={i}
                  d={`M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${xi1},${yi1} A${ir},${ir} 0 ${large},0 ${xi2},${yi2} Z`}
                  fill={V.line} fillOpacity={0.35 + i * 0.1} stroke={V.line} strokeDasharray="3 3" />
              );
            })}
            <text x={cx} y={cy + 4} textAnchor="middle" fontFamily={V.mono} fontSize="10" fill={V.textMuted} letterSpacing="0.18em">EMPTY</text>
          </svg>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${V.line}` }}>
                <th style={{ textAlign: 'left', padding: '6px 0', color: V.textMuted, fontFamily: V.mono, fontWeight: 500 }}>HOLDER</th>
                <th style={{ textAlign: 'left', padding: '6px 0', color: V.textMuted, fontFamily: V.mono, fontWeight: 500 }}>KIND</th>
                <th style={{ textAlign: 'right', padding: '6px 0', color: V.textMuted, fontFamily: V.mono, fontWeight: 500 }}>OWNERSHIP</th>
              </tr>
            </thead>
            <tbody>
              {fakeSlices.map((s, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${V.line}88`, opacity: 0.7 }}>
                  <td style={{ padding: '6px 0', color: V.textMuted }}>{DASH}</td>
                  <td style={{ padding: '6px 0', color: V.textMuted, fontFamily: V.mono, fontSize: 10 }}>{s.kind.toUpperCase()}</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', color: V.textMuted, fontFamily: V.mono }}>{DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>
            Seed your cap table in Week 4 · Incorporate
          </div>
        </div>
      </div>
    );
  }
  const palette = [V.accent, '#0E3B6B', V.gold, V.emerald, '#7C3AED', V.rose, V.textMuted];
  let acc = 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 16 }}>
      <div>
        <svg viewBox="0 0 220 220" style={{ width: '100%' }}>
          {parsed.map((s, i) => {
            const pct = (s.pct / total) * 100;
            const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
            acc += pct;
            const end = (acc / 100) * Math.PI * 2 - Math.PI / 2;
            const large = pct > 50 ? 1 : 0;
            const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
            const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end);
            const xi1 = cx + ir * Math.cos(end), yi1 = cy + ir * Math.sin(end);
            const xi2 = cx + ir * Math.cos(start), yi2 = cy + ir * Math.sin(start);
            return (
              <path key={i}
                d={`M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${xi1},${yi1} A${ir},${ir} 0 ${large},0 ${xi2},${yi2} Z`}
                fill={palette[i % palette.length]} />
            );
          })}
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${V.line}` }}>
              <th style={{ textAlign: 'left', padding: '6px 0', color: V.textMuted, fontFamily: V.mono, fontWeight: 500 }}>HOLDER</th>
              <th style={{ textAlign: 'left', padding: '6px 0', color: V.textMuted, fontFamily: V.mono, fontWeight: 500 }}>KIND</th>
              <th style={{ textAlign: 'right', padding: '6px 0', color: V.textMuted, fontFamily: V.mono, fontWeight: 500 }}>OWNERSHIP</th>
            </tr>
          </thead>
          <tbody>
            {parsed.slice(0, 8).map((h, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${V.line}88` }}>
                <td style={{ padding: '6px 0', color: V.ink }}>{h.name}</td>
                <td style={{ padding: '6px 0', color: V.textSoft, fontFamily: V.mono, fontSize: 10 }}>{(h.kind || '').toUpperCase()}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: V.ink, fontFamily: V.mono }}>{h.ownership_pct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Use-of-funds stacked bar — 3 ghost segments (55/30/15) when empty. */
export const UseOfFundsBar: React.FC<{
  buckets?: FundUse[]; fallback?: string;
}> = ({ buckets, fallback }) => {
  const V = useV();
  const palette = [V.accent, V.gold, V.emerald, '#0E3B6B', '#7C3AED'];
  if (!buckets || buckets.length === 0) {
    if (fallback && fallback.trim()) {
      return (
        <div style={{ fontSize: 13.5, lineHeight: 1.4, fontFamily: V.vibe === 'serif' ? V.display : V.sans, color: V.textSoft }}>
          {fallback}
        </div>
      );
    }
    const ghosts = [
      { label: 'Engineering & AI',        pct: 55 },
      { label: 'GTM & Customer Success',  pct: 30 },
      { label: 'Operations & legal',      pct: 15 },
    ];
    return (
      <div>
        <div style={{ height: 12, borderRadius: 6, overflow: 'hidden', display: 'flex', background: V.cardSoft, opacity: 0.55 }}>
          {ghosts.map((g, i) => (
            <div key={i} style={{
              height: '100%', width: `${g.pct}%`,
              background: `repeating-linear-gradient(135deg, ${palette[i]} 0, ${palette[i]} 4px, transparent 4px, transparent 8px)`,
              opacity: 0.45,
            }} />
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24, rowGap: 6, fontSize: 11.5 }}>
          {ghosts.map((g, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: palette[i], display: 'inline-block' }} />
              <span style={{ color: V.textMuted }}>{g.label}</span>
              <span style={{ marginLeft: 'auto', color: V.textMuted, fontFamily: V.mono }}>{DASH}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>
          Fill use_of_funds in the financial model
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ height: 12, borderRadius: 6, overflow: 'hidden', display: 'flex', background: V.cardSoft }}>
        {buckets.map((b, i) => (
          <div key={i} title={`${b.label} ${b.pct}%`} style={{ height: '100%', width: `${b.pct}%`, background: palette[i % palette.length] }} />
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24, rowGap: 6, fontSize: 11.5 }}>
        {buckets.map((b, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: palette[i % palette.length], display: 'inline-block' }} />
            <span style={{ color: V.ink }}>{b.label}</span>
            <span style={{ marginLeft: 'auto', color: V.textMuted, fontFamily: V.mono }}>{b.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ───── illustrations (decorative, theme-aware SVG) ───── */

/** Cover-slide hero — 4-week founder arc with milestone markers. */
export const JourneyArc: React.FC<{ height?: number }> = ({ height = 280 }) => {
  const V = useV();
  return (
    <svg viewBox="0 0 480 320" style={{ width: '100%', display: 'block', maxHeight: height }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="ja-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={V.accentSoft} stopOpacity={V.isDark ? 0.4 : 1} />
          <stop offset="1" stopColor={V.card} stopOpacity={V.isDark ? 0.1 : 1} />
        </linearGradient>
        <linearGradient id="ja-ground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={V.cardSoft} />
          <stop offset="1" stopColor={V.card} />
        </linearGradient>
        <radialGradient id="ja-sun" cx="50%" cy="50%">
          <stop offset="0" stopColor={V.gold} stopOpacity={0.9} />
          <stop offset="1" stopColor={V.accent} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="480" height="200" fill="url(#ja-sky)" />
      <circle cx="360" cy="120" r="80" fill="url(#ja-sun)" />
      <circle cx="360" cy="120" r="30" fill={V.gold} fillOpacity={0.9} />
      <path d="M0,200 Q120,170 240,185 T480,180 L480,260 L0,260 Z" fill={V.accent} fillOpacity={0.18} />
      <path d="M0,230 Q140,210 280,220 T480,225 L480,320 L0,320 Z" fill="url(#ja-ground)" />
      <path d="M30,260 Q120,140 240,180 Q360,210 450,90" stroke={V.accent} strokeWidth={2.5} fill="none" strokeDasharray="6 4" strokeLinecap="round" />
      {[
        { x: 30,  y: 260, label: 'W1', sub: 'Idea' },
        { x: 165, y: 200, label: 'W2', sub: 'Solution' },
        { x: 300, y: 200, label: 'W3', sub: 'Validate' },
        { x: 450, y: 90,  label: 'W4', sub: 'Inc.' },
      ].map((m, i) => (
        <g key={i}>
          <circle cx={m.x} cy={m.y} r="10" fill={V.card} stroke={V.accent} strokeWidth={2.5} />
          <circle cx={m.x} cy={m.y} r="4" fill={V.accent} />
          <text x={m.x} y={m.y - 18} textAnchor="middle" fontFamily={V.mono} fontSize="9" fontWeight={700} fill={V.accent} letterSpacing="0.12em">{m.label}</text>
          <text x={m.x} y={m.y + 24} textAnchor="middle" fontFamily={V.display} fontSize="11" fontWeight={600} fill={V.ink}>{m.sub}</text>
        </g>
      ))}
      <g transform="translate(140, 196)">
        <circle cx="0" cy="-8" r="3.5" fill={V.ink} />
        <path d="M-4,-2 L4,-2 L5,12 L2,12 L1,4 L-1,4 L-2,12 L-5,12 Z" fill={V.ink} />
      </g>
    </svg>
  );
};

/** Compact 4-week tick illustration for slide right rails. */
export const FourWeekTicks: React.FC<{ activeWeek?: number; height?: number }> = ({ activeWeek = 0, height = 200 }) => {
  const V = useV();
  const weeks = [1, 2, 3, 4];
  return (
    <svg viewBox="0 0 320 200" style={{ width: '100%', maxHeight: height }} preserveAspectRatio="xMidYMid meet">
      <line x1="30" y1="100" x2="290" y2="100" stroke={V.line} strokeWidth={1.5} />
      <path d="M30,100 L260,100" stroke={V.accent} strokeWidth={2.5} strokeLinecap="round"
            style={{ opacity: activeWeek === 0 ? 0.18 : 1, strokeDasharray: activeWeek === 0 ? '4 4' : 'none' }} />
      {weeks.map((w, i) => {
        const x = 30 + i * 86.7;
        const isActive = activeWeek >= w;
        return (
          <g key={w}>
            <circle cx={x} cy="100" r={isActive ? 14 : 10} fill={isActive ? V.accent : V.card} stroke={isActive ? V.accent : V.line} strokeWidth={2} />
            {isActive && <circle cx={x} cy="100" r="4" fill={V.card} />}
            <text x={x} y="60" textAnchor="middle" fontFamily={V.mono} fontSize="10" fontWeight={700} fill={isActive ? V.accent : V.textMuted} letterSpacing="0.18em">W{w}</text>
            <text x={x} y="140" textAnchor="middle" fontFamily={V.display} fontSize="11" fontWeight={600} fill={V.ink}>{['Idea', 'Solution', 'Validate', 'Inc.'][i]}</text>
          </g>
        );
      })}
    </svg>
  );
};

/** Voices motif — speech bubbles for the Validation slide. */
export const VoicesBubbles: React.FC = () => {
  const V = useV();
  return (
    <svg viewBox="0 0 320 200" style={{ width: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {[
        { x: 50,  y: 60,  r: 26, op: 0.9 },
        { x: 130, y: 100, r: 32, op: 1 },
        { x: 220, y: 50,  r: 22, op: 0.8 },
        { x: 270, y: 120, r: 28, op: 0.85 },
        { x: 160, y: 160, r: 18, op: 0.7 },
      ].map((b, i) => (
        <g key={i}>
          <circle cx={b.x} cy={b.y} r={b.r} fill={V.accent} fillOpacity={b.op * 0.16} stroke={V.accent} strokeOpacity={b.op * 0.5} strokeWidth={1.5} />
          <text x={b.x} y={b.y + 5} textAnchor="middle" fontFamily={V.display} fontSize={b.r * 0.65} fontWeight={600} fill={V.accent} fillOpacity={b.op}>"</text>
        </g>
      ))}
      <line x1="76" y1="60" x2="98" y2="100" stroke={V.accent} strokeOpacity={0.4} strokeDasharray="2 2" />
      <line x1="162" y1="100" x2="198" y2="50" stroke={V.accent} strokeOpacity={0.4} strokeDasharray="2 2" />
      <line x1="162" y1="100" x2="244" y2="120" stroke={V.accent} strokeOpacity={0.4} strokeDasharray="2 2" />
      <line x1="148" y1="116" x2="160" y2="142" stroke={V.accent} strokeOpacity={0.4} strokeDasharray="2 2" />
    </svg>
  );
};

/** Network constellation — Mentors slide. */
export const NetworkConstellation: React.FC = () => {
  const V = useV();
  const center = { x: 160, y: 110 };
  const nodes = [
    { x: 50,  y: 50,  label: 'Legal' },
    { x: 280, y: 60,  label: 'Design' },
    { x: 50,  y: 180, label: 'Recruiting' },
    { x: 270, y: 180, label: 'Tech DD' },
    { x: 160, y: 30,  label: 'Finance' },
    { x: 160, y: 200, label: 'Alumni' },
  ];
  return (
    <svg viewBox="0 0 320 240" style={{ width: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {nodes.map((n, i) => (
        <line key={i} x1={center.x} y1={center.y} x2={n.x} y2={n.y} stroke={V.accent} strokeOpacity={0.35} strokeWidth={1.2} />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r="14" fill={V.card} stroke={V.accent} strokeWidth={1.5} />
          <circle cx={n.x} cy={n.y} r="4" fill={V.accent} fillOpacity={0.7} />
          <text x={n.x} y={n.y + (n.y > center.y ? 28 : -22)} textAnchor="middle" fontFamily={V.mono} fontSize="9" fontWeight={600} fill={V.textSoft} letterSpacing="0.14em">{n.label.toUpperCase()}</text>
        </g>
      ))}
      <circle cx={center.x} cy={center.y} r="22" fill={V.accent} />
      <text x={center.x} y={center.y + 4} textAnchor="middle" fontFamily={V.display} fontWeight={700} fontSize="13" fill="#fff">AXAL</text>
    </svg>
  );
};

/** Legal scroll motif with 83(b) seal — Cap-table / Signal slides. */
export const LegalScroll: React.FC = () => {
  const V = useV();
  return (
    <svg viewBox="0 0 320 240" style={{ width: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <rect x="60" y="20" width="200" height="200" fill={V.card} stroke={V.line} strokeWidth={1.5} rx="4" />
      <rect x="68" y="28" width="184" height="184" fill="none" stroke={V.line} strokeWidth={0.5} strokeDasharray="2 2" />
      {Array.from({ length: 9 }).map((_, i) => (
        <rect key={i} x="80" y={48 + i * 18} width={i === 0 ? 140 : i === 2 ? 100 : i === 4 ? 160 : 130} height="3" rx="1.5" fill={V.line} />
      ))}
      <line x1="80" y1="190" x2="200" y2="190" stroke={V.ink} strokeWidth={1.5} />
      <text x="80" y="204" fontFamily={V.mono} fontSize="9" fill={V.textMuted}>Founder signature</text>
      <circle cx="232" cy="184" r="22" fill={V.accent} fillOpacity={0.12} stroke={V.accent} strokeWidth={1.5} />
      <text x="232" y="188" textAnchor="middle" fontFamily={V.display} fontWeight={700} fontSize="11" fill={V.accent}>83(b)</text>
    </svg>
  );
};

/** Rocket trajectory — Ask slide. */
export const RocketTrajectory: React.FC = () => {
  const V = useV();
  return (
    <svg viewBox="0 0 320 240" style={{ width: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="rt-trail" x1="0" x2="1">
          <stop offset="0" stopColor={V.accent} stopOpacity={0.05} />
          <stop offset="1" stopColor={V.accent} stopOpacity={0.6} />
        </linearGradient>
      </defs>
      <path d="M20,210 Q120,180 180,120 T300,30" stroke="url(#rt-trail)" strokeWidth={3} fill="none" strokeLinecap="round" />
      {[{ x: 80, y: 200 }, { x: 150, y: 150 }, { x: 220, y: 90 }].map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="5" fill={V.card} stroke={V.accent} strokeWidth={1.8} />
      ))}
      <g transform="translate(296, 32) rotate(-32)">
        <path d="M0,-14 L7,0 L0,16 L-7,0 Z" fill={V.accent} />
        <path d="M-7,0 L-14,8 L-7,8 Z" fill={V.gold} />
        <path d="M7,0 L14,8 L7,8 Z" fill={V.gold} />
        <circle cx="0" cy="-2" r="3" fill={V.card} />
      </g>
      <line x1="0" y1="220" x2="320" y2="220" stroke={V.line} />
      <text x="20" y="234" fontFamily={V.mono} fontSize="9" fill={V.textMuted} letterSpacing="0.14em">DAY 1</text>
      <text x="300" y="234" textAnchor="end" fontFamily={V.mono} fontSize="9" fill={V.textMuted} letterSpacing="0.14em">18 MO</text>
    </svg>
  );
};

/** Problem-space illustration — tangled lines resolving to one insight node. */
export const ProblemEcho: React.FC = () => {
  const V = useV();
  return (
    <svg viewBox="0 0 320 240" style={{ width: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: 14 }).map((_, i) => {
        const x1 = 20 + ((i * 37) % 110);
        const y1 = 30 + ((i * 53) % 160);
        const x2 = 30 + ((i * 73) % 130);
        const y2 = 40 + ((i * 41) % 160);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={V.rose} strokeOpacity={0.5} strokeWidth={1} />;
      })}
      {[60, 80, 100, 120, 140, 160, 180].map((y, i) => (
        <line key={i} x1="150" y1={y} x2="280" y2="120" stroke={V.accent} strokeOpacity={0.5} strokeWidth={1.2} />
      ))}
      <circle cx="280" cy="120" r="14" fill={V.accent} />
      <circle cx="280" cy="120" r="22" fill="none" stroke={V.accent} strokeOpacity={0.4} />
      <text x="280" y="124" textAnchor="middle" fontFamily={V.display} fontWeight={700} fontSize="11" fill="#fff">✦</text>
      <text x="60" y="220" fontFamily={V.mono} fontSize="9" fill={V.textMuted} letterSpacing="0.18em">PROBLEM</text>
      <text x="280" y="220" textAnchor="middle" fontFamily={V.mono} fontSize="9" fill={V.accent} letterSpacing="0.18em">INSIGHT</text>
    </svg>
  );
};

/* ─────────────────────────── 11 slides ─────────────────────────── */

// 1920×1080 sibling frame — same primitive as sequoia_classic /
// investor_appendix_app so the print/share/export pipelines (which
// scroll-snap on `[data-slide-frame]`) treat each Axal slide as a
// first-class page break.
const SlideShell: React.FC<{ children: React.ReactNode; pad?: number }> = ({ children, pad = 96 }) => {
  const { pal, fonts } = useVariant();
  return (
    <Slide16x9 bg={pal.bg} ink={pal.ink} font={fonts.body} className="">
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        padding: pad - 96 /* compensate for Slide16x9's own padding of 96 */,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>{children}</div>
    </Slide16x9>
  );
};

/* ───── slide-local helpers ─────
 * Inline-style equivalents of the branch's <Card> and <Pill> primitives.
 * Kept private to the slide layer so the PDF pipeline never has to chase
 * Tailwind classes through the export — every visual byte is here. */

const cardStyle = (V: V, soft?: boolean): React.CSSProperties => ({
  background: soft ? V.cardSoft : V.card,
  border: `1px solid ${V.line}`,
  borderRadius: 10,
  boxSizing: 'border-box',
});

const Pill: React.FC<{
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'gold' | 'emerald' | 'rose';
}> = ({ children, tone = 'neutral' }) => {
  const V = useV();
  const map: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: V.cardSoft, fg: V.textSoft },
    accent:  { bg: V.accentSoft, fg: V.accent },
    gold:    { bg: V.cardSoft, fg: V.gold },
    emerald: { bg: V.cardSoft, fg: V.emerald },
    rose:    { bg: V.cardSoft, fg: V.rose },
  };
  const { bg, fg } = map[tone];
  return (
    <span style={{
      background: bg, color: fg, border: `1px solid ${V.line}`,
      fontFamily: V.mono, fontSize: 10, letterSpacing: '0.14em',
      textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999,
      display: 'inline-block',
    }}>{children}</span>
  );
};

const Slide_Cover: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const { pal, fonts, variant } = useVariant();
  const V = useV();
  const { cover, meta } = d;
  // Architect note (Task #7 review): even the cinematic/manifesto variant
  // keeps the two-column right-rail structure so no slide collapses to
  // whitespace. The headline-weight contrast comes from font-size + weight,
  // not from dropping the JourneyArc anchor.
  return (
    <SlideShell>
      <div style={{ display: 'grid', gridTemplateColumns: '6fr 6fr', gap: 48, flex: 1, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Eyebrow>{cover.eyebrow}</Eyebrow>
          {meta.is_sample && <div style={{ marginBottom: 12 }}><Chip tone="warn">SAMPLE</Chip></div>}
          <h1 style={{
            color: pal.ink, fontFamily: fonts.display,
            fontSize: variant === 'manifesto' ? 96 : 72, lineHeight: 0.96,
            letterSpacing: '-0.022em', fontWeight: variant === 'editorial' ? 600 : 700, margin: 0,
          }}>{cover.headline}</h1>
          <p style={{ color: pal.inkSoft, fontFamily: fonts.body, fontSize: 18, lineHeight: 1.5, maxWidth: 680, marginTop: 20 }}>{cover.sub}</p>
          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, maxWidth: 640 }}>
            {[
              { label: 'Sector',  value: meta.sector },
              { label: 'Stage',   value: meta.lab_active ? `Lab · Week ${meta.week}` : 'Pre-incorporation' },
              { label: 'Founder', value: meta.founder_name },
            ].map((m, i) => (
              <div key={i} style={{ ...cardStyle(V, true), padding: 14 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', marginBottom: 6, color: V.textMuted, fontFamily: V.mono }}>{m.label}</div>
                <div style={{ fontSize: 14, lineHeight: 1.2, fontFamily: V.display, fontWeight: 600, color: V.ink }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
          <div style={{ ...cardStyle(V), padding: 16, overflow: 'hidden' }}>
            <JourneyArc height={240} />
          </div>
          <div style={{ ...cardStyle(V, true), padding: 14 }}>
            <ActivityLog30Day log={cover.activity_log} />
          </div>
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', marginBottom: 4, color: V.textMuted, fontFamily: V.mono }}>30 days · 4 milestones</div>
            <div style={{ fontSize: 13, lineHeight: 1.4, color: V.ink, fontFamily: V.sans }}>Idea & Customer → Solution & Roadmap → Validate & Team → Incorporate & Capital.</div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', color: pal.muted, fontFamily: fonts.mono, fontSize: 12 }}>
        <span>{cover.location}</span>
        <span>{meta.founder_name} · {meta.contact_email}</span>
      </div>
    </SlideShell>
  );
};

const Slide_Problem: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const p = d.problem;
  const signals = p.signals.filter((s) => !isUnfilled(s));
  // Task #14 — prefer clustered pain themes; fall back to raw signals so
  // the bars stay populated for older payloads that pre-date pain_themes.
  const themes = deckPainPoints(p.pain_themes, signals);
  const slots = [0, 1, 2].map((i) => signals[i] || null);
  const lenStatus = isUnfilled(p.body)
    ? { status: 'empty' as const }
    : getPitchCopyLengthStatus(p.body, 'problem');
  const showPlaceholder = lenStatus.status === 'empty' || lenStatus.status === 'too_short';
  const trimmedBody = showPlaceholder ? '' : trimPitchCopyToMax(p.body, 'problem');
  const { headline, remainder, headlineTooLong } = extractPitchHeadline(trimmedBody);
  return (
    <SlideShell>
      <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 32, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Eyebrow>{p.eyebrow}</Eyebrow>
          {showPlaceholder
            ? <h2 style={{ color: V.textMuted, fontStyle: 'italic', fontFamily: V.display, fontSize: 56, lineHeight: 1.1, fontWeight: 500, margin: 0 }}>The pain we built the Lab to investigate.</h2>
            : <SlideHeading size="hero">{headline}</SlideHeading>}
          {!showPlaceholder && remainder && (
            <p style={{
              marginTop: 16, marginBottom: 0,
              color: V.textSoft, fontFamily: V.vibe === 'serif' ? V.display : V.sans,
              fontSize: 16, lineHeight: 1.55, maxWidth: 640, fontWeight: 400,
            }}>{remainder}</p>
          )}
          {showPlaceholder && (
            <div style={{ marginTop: 16 }}>
              <Nudge>{lenStatus.status === 'empty'
                ? 'Add a problem statement on your project, or via the Personal Advisor (Week 1 question bank).'
                : 'Problem statement is too short for a pitch slide — aim for 35–60 words on the project.'}</Nudge>
            </div>
          )}
          {!showPlaceholder && headlineTooLong && (
            <div style={{ marginTop: 10 }}>
              <Nudge>Shorten your opening sentence to ≤{HEADLINE_MAX_WORDS} words — the first sentence is the slide headline.</Nudge>
            </div>
          )}
          {!showPlaceholder && lenStatus.status === 'too_long' && (
            <div style={{ marginTop: 10, fontSize: 11, color: V.textMuted, fontFamily: V.mono }}>
              Trimmed to 75 words for the slide — edit the Problem Statement in Projects to refine.
            </div>
          )}
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            {slots.map((s, i) => {
              const isReal = !!s;
              return (
                <div key={i} style={{ ...cardStyle(V, !isReal), padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: isReal ? V.rose : V.textMuted, fontFamily: V.mono }}>
                      Pain {String(i + 1).padStart(2, '0')}
                    </span>
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>from interviews</span>
                  </div>
                  {isReal ? (
                    <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, color: V.ink, fontFamily: V.display }}>{s}</div>
                  ) : (
                    <>
                      <div style={{ height: 8, borderRadius: 4, background: V.line, width: '92%' }} />
                      <div style={{ height: 8, borderRadius: 4, background: V.line, width: '64%', opacity: 0.7, marginTop: 6 }} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...cardStyle(V, true), padding: 16, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ProblemEcho />
          </div>
          {themes.length > 0 && (
            <div style={{ ...cardStyle(V, true), padding: 14 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 10 }}>Pain themes · clustered</div>
              <ThemeFrequencyBars themes={themes} />
            </div>
          )}
          <div style={{ ...cardStyle(V, true), padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 10 }}>Evidence backing this</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, textAlign: 'center' }}>
              {[
                { label: 'Themes', value: themes.length || DASH },
                { label: 'Pain mentions', value: themes.length > 0 ? `${themes.reduce((s, t) => s + t.mentions, 0)}` : DASH },
                { label: 'Interviews', value: d.validation.quotes.length || DASH },
              ].map((k, i) => (
                <div key={i}>
                  <div style={{ fontFamily: V.display, fontWeight: 700, fontSize: 22, color: k.value === DASH ? V.textMuted : V.ink }}>{k.value}</div>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>{k.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
};

const Slide_Validation: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const v = d.validation;
  const quotes = v.quotes.slice(0, 3);
  const total = v.quotes.length;
  const enough = total >= 5;
  return (
    <SlideShell>
      <Eyebrow>{v.eyebrow}</Eyebrow>
      <SlideHeading>{v.headline}</SlideHeading>
      {!enough && (
        <div style={{ marginTop: 14, maxWidth: 640 }}>
          <Nudge>{total}/5 interviews logged. Log {5 - total} more in Customer Discovery to graduate Week 1.</Nudge>
        </div>
      )}
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 28, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2].map((i) => {
            const q = quotes[i];
            if (!q) {
              return (
                <div key={i} style={{ ...cardStyle(V, true), border: `1px dashed ${V.line}`, padding: 16, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: V.textMuted, fontFamily: V.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                  Interview {i + 1} pending
                </div>
              );
            }
            const excerpt = (q.takeaway || '').slice(0, 220) + ((q.takeaway || '').length > 220 ? '…' : '');
            return (
              <div key={i} style={{ ...cardStyle(V), padding: 18, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 30, lineHeight: 1, marginBottom: 6, color: V.accent, fontFamily: V.display }}>"</div>
                <p style={{ fontSize: 14, lineHeight: 1.4, color: V.ink, fontFamily: V.vibe === 'serif' ? V.display : V.sans, flex: 1, margin: 0 }}>{excerpt}</p>
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${V.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: V.ink, fontFamily: V.display }}>{q.name || DASH}</div>
                    {q.role && <div style={{ fontSize: 10, color: V.textMuted, fontFamily: V.mono }}>{q.role}</div>}
                  </div>
                  <Pill tone="accent">Logged</Pill>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...cardStyle(V, true), padding: 14 }}>
            <RatingDistribution ratings={v.ratings} question={v.question} />
          </div>
          <div style={{ flex: 1, display: 'flex' }}>
            <RevenueProofCard proof={v.revenue_proof} />
          </div>
          <div style={{ ...cardStyle(V, true), padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 10 }}>Week-1 scoreboard</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, textAlign: 'center' }}>
              {[
                { label: 'Interviews', value: total || DASH },
                { label: 'Distinct pains', value: d.problem.signals.filter((s) => !isUnfilled(s)).length || DASH },
                { label: 'Quotes captured', value: total || DASH },
              ].map((k, i) => (
                <div key={i}>
                  <div style={{ fontFamily: V.display, fontWeight: 700, fontSize: 22, color: k.value === DASH ? V.textMuted : V.ink }}>{k.value}</div>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>{k.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
};

const Slide_Market: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const m = d.market;
  const allMissing = m.tam === DASH && m.sam === DASH && m.som === DASH;
  return (
    <SlideShell>
      <Eyebrow>{m.eyebrow}</Eyebrow>
      <SlideHeading>{m.headline}</SlideHeading>
      {allMissing && (
        <div style={{ marginTop: 14, maxWidth: 640 }}>
          <Nudge>Fill TAM / SAM / SOM in Projects → Market sizing, or via the Personal Advisor's Week 1 market questions.</Nudge>
        </div>
      )}
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 32, flex: 1, alignItems: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <MarketCircles tam={m.tam} sam={m.sam} som={m.som} />
        </div>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { l: 'TAM', v: m.tam, sub: 'Total addressable' },
              { l: 'SAM', v: m.sam, sub: 'Serviceable' },
              { l: 'SOM', v: m.som, sub: 'Obtainable' },
            ].map((k) => (
              <div key={k.l} style={{ ...cardStyle(V, true), padding: 14 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.textMuted, fontFamily: V.mono, marginBottom: 4 }}>{k.l}</div>
                <div style={{ fontFamily: V.display, fontWeight: 700, fontSize: 32, color: k.v === DASH ? V.textMuted : V.ink, lineHeight: 1 }}>{k.v}</div>
                <div style={{ fontSize: 11, color: V.textMuted, marginTop: 4 }}>{k.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.textMuted, fontFamily: V.mono, marginBottom: 8 }}>Why now</div>
            {m.why_now.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {m.why_now.slice(0, 4).map((w, i) => <li key={i} style={{ marginBottom: 4, color: V.ink, fontSize: 13.5, lineHeight: 1.45, fontFamily: V.vibe === 'serif' ? V.display : V.sans }}>{w}</li>)}
              </ul>
            ) : (
              <div style={{ fontSize: 12, color: V.textMuted, fontStyle: 'italic' }}>
                Fill <code style={{ fontFamily: V.mono }}>why_now</code> on your project to explain the timing.
              </div>
            )}
          </div>
        </div>
      </div>
    </SlideShell>
  );
};

const Slide_Solution: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const s = d.solution;
  const pd = d.product_demo;
  const video = classifyDemoVideo(pd.loop_url);
  const isEmbed = video.kind === 'youtube' || video.kind === 'vimeo';
  const hasFile = video.kind === 'file';
  const hasShot = !isUnfilled(pd.screenshot_url);
  const lenStatus = isUnfilled(s.body)
    ? { status: 'empty' as const }
    : getPitchCopyLengthStatus(s.body, 'solution');
  const showPlaceholder = lenStatus.status === 'empty' || lenStatus.status === 'too_short';
  const trimmedBody = showPlaceholder ? '' : trimPitchCopyToMax(s.body, 'solution');
  const { headline, remainder, headlineTooLong } = extractPitchHeadline(trimmedBody);
  return (
    <SlideShell>
      <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 32, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Eyebrow>{s.eyebrow}</Eyebrow>
          {showPlaceholder
            ? <h2 style={{ color: V.textMuted, fontStyle: 'italic', fontFamily: V.display, fontSize: 56, lineHeight: 1.1, fontWeight: 500, margin: 0 }}>A first cut of what we will ship.</h2>
            : <SlideHeading size="hero">{headline}</SlideHeading>}
          {!showPlaceholder && remainder && (
            <p style={{
              marginTop: 14, marginBottom: 0,
              color: V.textSoft, fontFamily: V.vibe === 'serif' ? V.display : V.sans,
              fontSize: 16, lineHeight: 1.55, maxWidth: 640, fontWeight: 400,
            }}>{remainder}</p>
          )}
          {showPlaceholder && (
            <div style={{ marginTop: 14 }}>
              <Nudge>{lenStatus.status === 'empty'
                ? 'Define the MVP scope in Roadmap (Week 2) and fill the solution field in Projects.'
                : 'Solution copy is too short for a pitch slide — aim for 35–50 words on the project.'}</Nudge>
            </div>
          )}
          {!showPlaceholder && headlineTooLong && (
            <div style={{ marginTop: 10 }}>
              <Nudge>Shorten your opening sentence to ≤{HEADLINE_MAX_WORDS} words — the first sentence is the slide headline.</Nudge>
            </div>
          )}
          {!showPlaceholder && lenStatus.status === 'too_long' && (
            <div style={{ marginTop: 10, fontSize: 11, color: V.textMuted, fontFamily: V.mono }}>
              Trimmed to 70 words for the slide — edit Solution in Projects to refine.
            </div>
          )}
          <div style={{ marginTop: 20, ...cardStyle(V, true), padding: 18, flex: 1 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 10 }}>Capabilities</div>
            {s.capabilities.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {s.capabilities.slice(0, 5).map((c, i) => (
                  <li key={i} style={{ marginBottom: 6, color: V.ink, fontSize: 14, lineHeight: 1.45, fontFamily: V.vibe === 'serif' ? V.display : V.sans }}>{c}</li>
                ))}
              </ul>
            ) : (
              <>
                <div style={{ height: 8, borderRadius: 4, background: V.line, width: '92%' }} />
                <div style={{ height: 8, borderRadius: 4, background: V.line, width: '78%', opacity: 0.7, marginTop: 6 }} />
                <div style={{ height: 8, borderRadius: 4, background: V.line, width: '54%', opacity: 0.5, marginTop: 6 }} />
                <div style={{ marginTop: 10, fontSize: 11, color: V.textMuted, fontFamily: V.mono }}>Add capability bullets to your solution field.</div>
              </>
            )}
          </div>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { label: 'Built in', value: 'Week 2' },
              { label: 'Form factor', value: 'MVP scope' },
              { label: 'Cost to ship', value: '< $50K target' },
            ].map((k, i) => (
              <div key={i}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.textMuted, fontFamily: V.mono, marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 13, fontFamily: V.display, fontWeight: 600, color: V.ink }}>{k.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ ...cardStyle(V), padding: 12, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
            {isEmbed ? (
              <div style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 8, overflow: 'hidden', background: '#000' }}>
                <iframe src={video.embedUrl} title="Product demo"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
              </div>
            ) : hasFile ? (
              <video src={video.embedUrl} autoPlay muted loop playsInline
                style={{ width: '100%', maxHeight: '100%', borderRadius: 8, background: '#000' }} />
            ) : hasShot ? (
              <img src={pd.screenshot_url} alt="Product demo" style={{ width: '100%', maxHeight: '100%', borderRadius: 8, objectFit: 'contain' }} />
            ) : (
              <div style={{ textAlign: 'center', color: V.textMuted, fontFamily: V.mono, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                <div style={{ fontSize: 56, marginBottom: 12, opacity: 0.4 }}>▷</div>
                Demo loop pending
              </div>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', textAlign: 'center', color: V.textMuted, fontFamily: V.mono }}>
            Product demo
          </div>
        </div>
      </div>
    </SlideShell>
  );
};

const Slide_Roadmap: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const r = d.roadmap;
  const counts = r.now.length + r.next.length + r.later.length;
  return (
    <SlideShell>
      <Eyebrow>{r.eyebrow}{r.quarter !== DASH ? ` · ${r.quarter}` : ''}</Eyebrow>
      <SlideHeading>{r.headline}</SlideHeading>
      {counts < 3 && (
        <div style={{ marginTop: 14, maxWidth: 640 }}>
          <Nudge>{counts}/3 OKRs logged. Add {Math.max(0, 3 - counts)} more in Roadmap (Week 2) — tag each Now / Next / Later.</Nudge>
        </div>
      )}
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '8fr 4fr', gap: 28, flex: 1, minHeight: 0 }}>
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <OkrBoard now={r.now} next={r.next} later={r.later} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...cardStyle(V), padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 12 }}>30-day cadence</div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <FourWeekTicks activeWeek={2} height={140} />
            </div>
          </div>
          <div style={{ ...cardStyle(V, true), padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 10 }}>OKR coverage</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, textAlign: 'center' }}>
              {[
                { label: 'Now', value: r.now.length || DASH },
                { label: 'Next', value: r.next.length || DASH },
                { label: 'Later', value: r.later.length || DASH },
              ].map((k, i) => (
                <div key={i}>
                  <div style={{ fontFamily: V.display, fontWeight: 700, fontSize: 22, color: k.value === DASH ? V.textMuted : V.ink }}>{k.value}</div>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>{k.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
};

const Slide_VentureReadiness: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const v = d.venture_readiness;
  const hasScore = v.total_score !== DASH && !isUnfilled(v.total_score);
  return (
    <SlideShell>
      <Eyebrow>{v.eyebrow}{v.is_sandbox ? ' · sandbox' : ''}</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 32, flex: 1, alignItems: 'stretch', marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.textMuted, fontFamily: V.mono, marginBottom: 6 }}>Composite score</div>
          <div style={{ fontFamily: V.display, fontWeight: 700, fontSize: 128, color: hasScore ? V.ink : V.textMuted, lineHeight: 1 }}>
            {hasScore ? v.total_score : DASH}
            <span style={{ fontSize: 32, color: V.textMuted }}> /100</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <Pill tone={hasScore ? 'gold' : 'neutral'}>{hasScore ? v.tier : 'Not scored yet'}</Pill>
          </div>
          <div style={{ marginTop: 20, ...cardStyle(V, true), padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 8 }}>What this tells us</div>
            {!isUnfilled(v.ai_notes) ? (
              <p style={{ fontSize: 13, lineHeight: 1.45, color: V.ink, fontFamily: V.vibe === 'serif' ? V.display : V.sans, margin: 0 }}>{v.ai_notes}</p>
            ) : (
              <>
                <div style={{ height: 8, borderRadius: 4, background: V.line, width: '90%' }} />
                <div style={{ height: 8, borderRadius: 4, background: V.line, width: '70%', opacity: 0.7, marginTop: 6 }} />
                <div style={{ height: 8, borderRadius: 4, background: V.line, width: '46%', opacity: 0.5, marginTop: 6 }} />
                <div style={{ marginTop: 10, fontSize: 11, color: V.textMuted, fontFamily: V.mono }}>Run the Diligence & Scoring Engine (Week 3) to generate this.</div>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.textMuted, fontFamily: V.mono, marginBottom: 12 }}>Six sub-scores</div>
          <ScoreBars items={v.breakdown} />
        </div>
      </div>
    </SlideShell>
  );
};

const Slide_Team: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const t = d.team;
  const slots = [0, 1, 2].map((i) => t.founders[i] || null);
  const filledCount = t.founders.length;
  const renderAvatar = (m: Founder | null, i: number) => {
    if (!m) {
      return (
        <div key={i} style={{ ...cardStyle(V, true), padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 8, background: V.line, opacity: 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill={V.textMuted} opacity={0.7}>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 22 Q12 14 20 22 Z" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ height: 10, borderRadius: 5, background: V.line, width: '70%' }} />
            <div style={{ height: 8, borderRadius: 4, background: V.line, width: '40%', opacity: 0.6, marginTop: 8 }} />
            <div style={{ marginTop: 8, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>
              {i === 0 ? 'Founder' : i === 1 ? 'Co-founder?' : 'Early team'}
            </div>
          </div>
        </div>
      );
    }
    const initials = (m.name || '').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
    return (
      <div key={i} style={{ ...cardStyle(V), padding: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 8, background: `linear-gradient(135deg, ${V.accent} 0%, ${V.gold} 100%)`, color: '#fff', fontFamily: V.display, fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {initials || '?'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: V.ink, fontFamily: V.display, lineHeight: 1.2 }}>{m.name}</div>
          <div style={{ fontSize: 10, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.accent, fontFamily: V.mono }}>{m.role}</div>
          {m.bio && <p style={{ fontSize: 12, lineHeight: 1.4, color: V.textSoft, fontFamily: V.sans, marginTop: 8, marginBottom: 0 }}>{m.bio}</p>}
        </div>
      </div>
    );
  };
  return (
    <SlideShell>
      <Eyebrow>{t.eyebrow}</Eyebrow>
      <SlideHeading>{t.headline}</SlideHeading>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {filledCount === 0 && <Pill tone="neutral">Team to be seeded in Week 3</Pill>}
        {filledCount === 1 && <Pill tone="gold">Going solo · or co-founder pending</Pill>}
        {filledCount > 0 && <Pill tone="emerald">{filledCount} on the cap table</Pill>}
      </div>
      <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 28, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {slots.map((m, i) => renderAvatar(m, i))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...cardStyle(V), padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 10 }}>Team intro</div>
            {isUnfilled(t.team_intro) ? (
              <>
                <div style={{ height: 8, borderRadius: 4, background: V.line, width: '88%' }} />
                <div style={{ height: 8, borderRadius: 4, background: V.line, width: '70%', opacity: 0.7, marginTop: 6 }} />
                <div style={{ height: 8, borderRadius: 4, background: V.line, width: '52%', opacity: 0.5, marginTop: 6 }} />
                <div style={{ marginTop: 10, fontSize: 11, color: V.textMuted, fontFamily: V.mono }}>Answer the Personal Advisor's team questions to surface this.</div>
              </>
            ) : (
              <p style={{ fontSize: 13.5, lineHeight: 1.5, color: V.ink, fontFamily: V.vibe === 'serif' ? V.display : V.sans, margin: 0 }}>{t.team_intro}</p>
            )}
          </div>
          <div style={{ ...cardStyle(V, true), padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 10 }}>Cap-table coverage</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, textAlign: 'center' }}>
              {[
                { label: 'Founders', value: filledCount || DASH },
                { label: 'Holders', value: d.cap_table.holders.length || DASH },
                { label: 'Mentors', value: d.mentor_network.mentors.filter((x) => !isUnfilled(x)).length || DASH },
              ].map((k, i) => (
                <div key={i}>
                  <div style={{ fontFamily: V.display, fontWeight: 700, fontSize: 22, color: k.value === DASH ? V.textMuted : V.ink }}>{k.value}</div>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>{k.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
};

const Slide_MentorNetwork: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const m = d.mentor_network;
  const mentors = m.mentors.filter((x) => !isUnfilled(x));
  const signals = m.network_signals.filter((x) => !isUnfilled(x));
  return (
    <SlideShell>
      <Eyebrow>{m.eyebrow}</Eyebrow>
      <SlideHeading>{m.headline}</SlideHeading>
      <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 28, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...cardStyle(V, true), padding: 18 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 10 }}>Mentor sessions</div>
            {mentors.length === 0 ? (
              <>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {[0, 1, 2].map((i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px dashed ${V.line}`, opacity: 0.55 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: V.textMuted }}>
                        <span>○</span> Session #{i + 1}
                      </span>
                      <span style={{ fontSize: 10, color: V.textMuted, fontFamily: V.mono }}>{DASH}</span>
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 10, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>Book your first mentor session in Office Hours</div>
              </>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {mentors.slice(0, 6).map((name, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${V.line}`, fontSize: 12.5, color: V.ink }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: V.emerald }}>✓</span>
                      {name}
                    </span>
                    <span style={{ color: V.textMuted, fontFamily: V.mono, fontSize: 10 }}>logged</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={{ ...cardStyle(V), padding: 18, flex: 1 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 12 }}>Operating partners on call</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {(signals.length > 0 ? signals.slice(0, 6) : ['Legal', 'Design', 'Recruiting', 'Technical DD', 'Finance', 'GTM']).map((cat, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: V.accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: V.ink, fontFamily: V.display, fontWeight: 600 }}>{cat}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>pre-vetted · network rates</div>
          </div>
          {!isUnfilled(m.body) && (
            <div style={{ ...cardStyle(V, true), padding: 14 }}>
              <p style={{ fontSize: 12.5, lineHeight: 1.4, color: V.ink, fontFamily: V.vibe === 'serif' ? V.display : V.sans, margin: 0 }}>{m.body}</p>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {m.skill_coverage && m.skill_coverage.length >= 3 ? (
            <div style={{ ...cardStyle(V), padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 4, alignSelf: 'flex-start' }}>Skill coverage</div>
              <SkillsSpider axes={m.skill_coverage} size={200} />
            </div>
          ) : (
            <div style={{ ...cardStyle(V), padding: 12, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <NetworkConstellation />
              </div>
              <div style={{ marginTop: 8, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', textAlign: 'center', color: V.textMuted, fontFamily: V.mono }}>
                Axal network · {mentors.length || '—'} mentors
              </div>
            </div>
          )}
          {m.profiles && m.profiles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {m.profiles.slice(0, 3).map((p, i) => <ProfileCard key={i} p={p} />)}
            </div>
          )}
        </div>
      </div>
    </SlideShell>
  );
};

const Slide_CapTable: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const c = d.cap_table;
  const incorporated = d.brand.incorporated;
  return (
    <SlideShell>
      <Eyebrow>{c.eyebrow}</Eyebrow>
      <SlideHeading>{c.headline}</SlideHeading>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Pill tone={incorporated ? 'emerald' : 'neutral'}>{incorporated ? '✓ Incorporated · Delaware C-Corp' : 'Incorporation pending'}</Pill>
        <Pill tone="neutral">4-yr vesting · 1-yr cliff</Pill>
        <Pill tone={incorporated ? 'emerald' : 'neutral'}>{incorporated ? '✓ 83(b) filed in window' : '83(b) not yet filed'}</Pill>
      </div>
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '8fr 4fr', gap: 24, flex: 1, minHeight: 0 }}>
        <div>
          <CapTablePie holders={c.holders} />
        </div>
        <div style={{ ...cardStyle(V), padding: 12, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LegalScroll />
          </div>
          <div style={{ marginTop: 8, paddingTop: 12, borderTop: `1px solid ${V.line}` }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 8 }}>Documents on file</div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {[
                { name: 'Articles of Incorporation', done: incorporated },
                { name: 'Founder stock + vesting',   done: incorporated },
                { name: '83(b) election',            done: incorporated },
                { name: 'Cofounder agreement',       done: incorporated },
              ].map((doc, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: doc.done ? V.ink : V.textMuted, padding: '3px 0' }}>
                  <span style={{ color: doc.done ? V.emerald : V.textMuted }}>{doc.done ? '✓' : '○'}</span>
                  {doc.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12, color: V.textMuted, fontSize: 11, fontFamily: V.mono }}>{c.note}</div>
    </SlideShell>
  );
};

const Slide_Ask: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const a = d.ask;
  const askMissing = a.raise_amount === DASH;
  const runwayMissing = a.runway === DASH;
  const milestones = a.next_milestones.filter((x) => !isUnfilled(x));
  return (
    <SlideShell>
      <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 32, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Eyebrow>{a.eyebrow}</Eyebrow>
          <SlideHeading size="3xl">What we are raising — and what it buys.</SlideHeading>
          <div style={{ fontSize: 12, marginTop: 8, color: V.textMuted, fontFamily: V.mono }}>Pre-incorporation — entity stands up in Week 4.</div>
          <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <div style={{ ...cardStyle(V, true), padding: 18 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.textMuted, fontFamily: V.mono, marginBottom: 6 }}>Raise</div>
              <div style={{ fontFamily: V.display, fontWeight: 700, fontSize: 52, lineHeight: 1, color: askMissing ? V.textMuted : V.ink }}>{a.raise_amount}</div>
              <div style={{ marginTop: 8, fontSize: 11, color: V.textSoft, fontFamily: V.mono }}>SAFE · post-money · TBD</div>
            </div>
            <div style={{ ...cardStyle(V, true), padding: 18 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.textMuted, fontFamily: V.mono, marginBottom: 6 }}>Runway</div>
              <div style={{ fontFamily: V.display, fontWeight: 700, fontSize: 52, lineHeight: 1, color: runwayMissing ? V.textMuted : V.ink }}>{a.runway}</div>
              <div style={{ marginTop: 8, fontSize: 11, color: V.textSoft, fontFamily: V.mono }}>Target close · Q3 2026</div>
            </div>
          </div>
          {askMissing && (
            <div style={{ marginTop: 14, maxWidth: 520 }}>
              <Nudge>Set <code style={{ fontFamily: V.mono }}>funding_needed</code> on your project to show a raise amount.</Nudge>
            </div>
          )}
          <div style={{ marginTop: 22, flex: 1 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.textMuted, fontFamily: V.mono, marginBottom: 8 }}>Use of funds</div>
            <UseOfFundsBar buckets={a.use_of_funds.length > 0 ? a.use_of_funds : undefined} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ ...cardStyle(V), padding: 12, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RocketTrajectory />
          </div>
          <div style={{ ...cardStyle(V), padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 600, color: V.accent, fontFamily: V.mono, marginBottom: 8 }}>Next milestones</div>
            {milestones.length === 0 ? (
              <>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {[0, 1, 2].map((i) => (
                    <li key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', color: V.textMuted, opacity: 0.7 }}>
                      <span style={{ color: V.line }}>·</span>
                      <span style={{ height: 8, borderRadius: 4, background: V.line, width: `${60 - i * 8}%`, display: 'inline-block' }} />
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 10, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', color: V.textMuted, fontFamily: V.mono }}>Add Now / Next / Later OKRs to surface milestones.</div>
              </>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 14 }}>
                {milestones.slice(0, 4).map((m, i) => (
                  <li key={i} style={{ fontSize: 12, lineHeight: 1.4, color: V.ink, marginBottom: 4 }}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
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

/* ─────────────────────────── Task #14 new primitives ─────────────────────── */

/** ActivityLog30Day — 30-cell strip for the Cover slide, each day's bar
 *  segmented + coloured by module (milestone / interview / advisor) with a
 *  small legend. Empty days render as the faint skeleton dot. */
const ActivityLog30Day: React.FC<{ log: ActivityLogDay[] }> = ({ log }) => {
  const V = useV();
  const MODULES: { key: ActivityModule; label: string; color: string }[] = [
    { key: 'milestone', label: 'Milestones', color: V.accent },
    { key: 'interview', label: 'Interviews', color: V.emerald },
    { key: 'advisor', label: 'Advisor', color: V.gold },
  ];
  const max = Math.max(1, ...log.map((d) => d.count));
  const days = log.length > 0 ? log : Array.from({ length: 30 }, (_, i) => ({
    date: `d-${i}`, count: 0, modules: {} as Record<string, number>,
  }));
  // Legend only lists modules that actually have events in the window.
  const present = MODULES.filter((m) => days.some((d) => (d.modules?.[m.key] || 0) > 0));
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.textMuted, fontFamily: V.mono, marginBottom: 6 }}>Last 30 days · Lab activity</div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 36 }}>
        {days.map((d, i) => {
          if (d.count === 0) {
            return <div key={i} title={`${d.date} · 0`} style={{ width: 8, height: 4, borderRadius: 2, background: V.line, opacity: 0.3 }} />;
          }
          const h = Math.max(6, (d.count / max) * 36);
          // Per-module segments when present; otherwise a single accent bar
          // (back-compat with decks persisted before the breakdown).
          const segs = d.modules && Object.keys(d.modules).length
            ? MODULES.filter((m) => (d.modules![m.key] || 0) > 0)
            : null;
          const tip = segs
            ? `${d.date} · ${segs.map((m) => `${m.label.toLowerCase()} ${d.modules![m.key]}`).join(', ')}`
            : `${d.date} · ${d.count}`;
          return (
            <div key={i} title={tip} style={{
              width: 8, height: h, borderRadius: 2, overflow: 'hidden', opacity: 0.9,
              display: 'flex', flexDirection: 'column-reverse',
            }}>
              {segs
                ? segs.map((m) => (
                    <div key={m.key} style={{ height: `${((d.modules![m.key] || 0) / d.count) * 100}%`, background: m.color }} />
                  ))
                : <div style={{ height: '100%', background: V.accent }} />}
            </div>
          );
        })}
      </div>
      {present.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {present.map((m) => (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: m.color, display: 'inline-block' }} />
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.14em', color: V.textMuted, fontFamily: V.mono }}>{m.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** ThemeFrequencyBars — horizontal frequency bars for clustered pain themes. */
const ThemeFrequencyBars: React.FC<{ themes: PainTheme[] }> = ({ themes }) => {
  const V = useV();
  if (!themes || themes.length === 0) return null;
  const max = Math.max(1, ...themes.map((t) => t.mentions));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {themes.slice(0, 5).map((t, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
            <span style={{ color: V.ink, fontFamily: V.sans, textTransform: 'capitalize' }}>{shortenPain(t.theme)}</span>
            <span style={{ color: V.textMuted, fontFamily: V.mono }}>{t.mentions}</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: V.cardSoft }}>
            <div style={{ height: '100%', borderRadius: 3, width: `${(t.mentions / max) * 100}%`, background: V.accent }} />
          </div>
        </div>
      ))}
    </div>
  );
};

/** RatingDistribution — 0–5 histogram for founder validation_rating values. */
const RatingDistribution: React.FC<{ ratings: number[]; question?: string }> = ({ ratings, question }) => {
  const V = useV();
  const bins = [0, 0, 0, 0, 0, 0];
  for (const r of ratings) {
    const idx = Math.min(5, Math.max(0, Math.round(r)));
    bins[idx]++;
  }
  const max = Math.max(1, ...bins);
  const avg = ratings.length > 0
    ? (ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(1)
    : DASH;
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.accent, fontFamily: V.mono, marginBottom: 6 }}>Validation rating · 0–5</div>
      {question && <div style={{ fontSize: 11, color: V.textSoft, marginBottom: 8, fontFamily: V.sans }}>{question}</div>}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 60 }}>
        {bins.map((n, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: '100%', borderRadius: 3,
              height: `${(n / max) * 50 + 4}px`,
              background: n > 0 ? V.accent : V.line,
              opacity: n > 0 ? 0.9 : 0.4,
            }} />
            <span style={{ fontSize: 10, color: V.textMuted, fontFamily: V.mono }}>{i}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: V.textMuted, fontFamily: V.mono }}>
        avg {avg} · n={ratings.length}
      </div>
    </div>
  );
};

/**
 * RevenueProofCard — Task #2. Replaces the decorative VoicesBubbles +
 * standalone RevenueBadge pill on the Validation slide with a single
 * premium card backed by structured project data (total revenue, MRR,
 * paying customers, first-payment date, paid-pilot status). Always
 * renders — pre-revenue state is intentional and on-brand.
 */
const fmtUSD = (n: number | null | undefined): string => {
  if (n == null || !isFinite(n) || n <= 0) return DASH;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};
const fmtFirstPayment = (iso: string | null | undefined): string => {
  if (!iso) return DASH;
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return DASH;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
const RevenueProofCard: React.FC<{ proof: RevenueProof }> = ({ proof }) => {
  const V = useV();
  const p = proof || {
    status: 'pre_revenue' as const,
    total_revenue: null, mrr: null, paying_customers: null, first_payment_date: null,
  };
  const status = p.status || 'pre_revenue';
  const isPaid = status === 'paid';
  const isPilotPaid = status === 'pilot_paid';
  const isPilotSigned = status === 'pilot_signed';
  const isPreRev = status === 'pre_revenue';

  // Hero metric: MRR > total_revenue > paying_customers > status copy.
  let heroValue: string;
  let heroLabel: string;
  if (p.mrr && p.mrr > 0) { heroValue = fmtUSD(p.mrr); heroLabel = 'MRR'; }
  else if (p.total_revenue && p.total_revenue > 0) { heroValue = fmtUSD(p.total_revenue); heroLabel = 'Revenue to date'; }
  else if (p.paying_customers && p.paying_customers > 0) { heroValue = String(p.paying_customers); heroLabel = p.paying_customers === 1 ? 'Paying customer' : 'Paying customers'; }
  else if (isPilotSigned) { heroValue = 'Pilot'; heroLabel = 'Contract signed'; }
  else { heroValue = 'Pre-revenue'; heroLabel = 'Path to first dollar'; }

  const statusLabel = isPaid ? 'Paid · live revenue'
    : isPilotPaid ? 'Pilot · paying'
    : isPilotSigned ? 'Pilot · signed'
    : 'Pre-revenue';

  // Tone: gold accent for any "money in" state, otherwise violet-only.
  const moneyIn = isPaid || isPilotPaid;
  const ringTone = moneyIn ? V.gold : V.accent;

  return (
    <div style={{
      ...cardStyle(V),
      position: 'relative', overflow: 'hidden',
      padding: 16, flex: 1, display: 'flex', flexDirection: 'column',
      background: `linear-gradient(135deg, ${V.card} 0%, ${V.cardSoft} 100%)`,
      borderColor: moneyIn ? V.gold : V.accent,
      borderWidth: 1, borderStyle: 'solid',
    }}>
      {/* Decorative concentric arcs — premium revenue motif. */}
      <svg
        viewBox="0 0 200 200"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', right: -40, top: -40, width: 180, height: 180, opacity: 0.18, pointerEvents: 'none' }}
        aria-hidden
      >
        <defs>
          <linearGradient id="rp-arc" x1="0" x2="1">
            <stop offset="0" stopColor={V.accent} stopOpacity={0.1} />
            <stop offset="1" stopColor={ringTone} stopOpacity={1} />
          </linearGradient>
        </defs>
        {[90, 70, 50, 32].map((r, i) => (
          <circle
            key={i}
            cx={100} cy={100} r={r}
            fill="none"
            stroke={i === 0 ? 'url(#rp-arc)' : ringTone}
            strokeOpacity={i === 0 ? 1 : 0.35 - i * 0.07}
            strokeWidth={i === 0 ? 1.8 : 1}
            strokeDasharray={isPreRev ? '3 4' : (i === 0 ? undefined : '2 3')}
          />
        ))}
        {moneyIn && (
          <g>
            <circle cx={138} cy={62} r={5} fill={V.gold} />
            <circle cx={138} cy={62} r={9} fill="none" stroke={V.gold} strokeOpacity={0.5} strokeWidth={1} />
          </g>
        )}
      </svg>

      {/* Status pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, position: 'relative' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', borderRadius: 999,
          background: moneyIn ? V.gold : (isPilotSigned ? V.accent : V.accentSoft),
          color: moneyIn || isPilotSigned ? '#fff' : V.accent,
          fontFamily: V.mono, fontSize: 9, fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          border: `1px solid ${moneyIn ? V.gold : V.accent}`,
        }}>
          <span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>
            {moneyIn ? '✓' : isPilotSigned ? '◆' : '○'}
          </span>
          <span>{statusLabel}</span>
        </span>
      </div>

      {/* Hero metric */}
      <div style={{ position: 'relative' }}>
        <div style={{
          fontFamily: V.display, fontWeight: 700,
          fontSize: heroValue.length > 6 ? 30 : 38, lineHeight: 1.05,
          color: isPreRev ? V.textSoft : V.ink,
          letterSpacing: '-0.01em',
        }}>{heroValue}</div>
        <div style={{
          marginTop: 4, fontFamily: V.mono, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '0.18em',
          color: V.textMuted,
        }}>{heroLabel}</div>
      </div>

      {/* Supporting stats — only render rows with content; pre-revenue
          shows a single forward-looking line so the card isn't empty. */}
      <div style={{
        marginTop: 12, paddingTop: 10, borderTop: `1px solid ${V.line}`,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        position: 'relative',
      }}>
        {(p.total_revenue && p.total_revenue > 0 && heroLabel !== 'Revenue to date') ? (
          <Stat V={V} label="Total to date" value={fmtUSD(p.total_revenue)} />
        ) : null}
        {(p.paying_customers && p.paying_customers > 0 && heroLabel !== 'Paying customer' && heroLabel !== 'Paying customers') ? (
          <Stat V={V} label="Paying" value={String(p.paying_customers)} />
        ) : null}
        {p.first_payment_date ? (
          <Stat V={V} label="First $" value={fmtFirstPayment(p.first_payment_date)} />
        ) : null}
        {isPreRev && !p.first_payment_date && !(p.paying_customers && p.paying_customers > 0) && (
          <div style={{
            gridColumn: '1 / -1',
            fontSize: 11, lineHeight: 1.45,
            color: V.textSoft, fontFamily: V.sans,
          }}>
            Pricing model in discovery. Founder is converting interview
            interest into pilots — log first paid signal to graduate.
          </div>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ V: V; label: string; value: string }> = ({ V, label, value }) => (
  <div>
    <div style={{
      fontFamily: V.mono, fontSize: 9,
      textTransform: 'uppercase', letterSpacing: '0.16em',
      color: V.textMuted, marginBottom: 2,
    }}>{label}</div>
    <div style={{
      fontFamily: V.display, fontWeight: 600, fontSize: 14,
      color: V.ink,
    }}>{value}</div>
  </div>
);

/** RevenueBadge — single tone pill for a confirmed revenue/LOI signal. */
const RevenueBadge: React.FC<{ proof: RevenueProof }> = ({ proof }) => {
  const V = useV();
  if (!proof) return null;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: V.accentSoft, color: V.accent,
      border: `1px solid ${V.accent}`, borderRadius: 999,
      padding: '6px 14px', fontFamily: V.mono, fontSize: 11,
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>
      <span aria-hidden>{proof.signed ? '✓' : '•'}</span>
      <span>{proof.amount} {proof.label}</span>
    </div>
  );
};

/** SkillsSpider — radar chart for mentor skill coverage axes. */
const SkillsSpider: React.FC<{ axes: SkillAxis[]; size?: number }> = ({ axes, size = 220 }) => {
  const V = useV();
  const N = axes.length;
  if (N < 3) return null;
  const r = size / 2 - 28;
  const cx = size / 2;
  const cy = size / 2;
  const pt = (i: number, val: number): [number, number] => {
    const angle = -Math.PI / 2 + (i / N) * Math.PI * 2;
    const rr = r * Math.max(0, Math.min(1, val));
    return [cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr];
  };
  const ring = (frac: number) => Array.from({ length: N }).map((_, i) => {
    const [x, y] = pt(i, frac);
    return `${x},${y}`;
  }).join(' ');
  const polyPts = axes.map((a, i) => pt(i, a.value).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: size, display: 'block' }}>
      {[0.33, 0.66, 1].map((f, i) => (
        <polygon key={i} points={ring(f)} fill="none" stroke={V.line} strokeOpacity={0.5} />
      ))}
      <polygon points={polyPts} fill={V.accent} fillOpacity={0.25} stroke={V.accent} strokeWidth={1.5} />
      {axes.map((a, i) => {
        const [lx, ly] = pt(i, 1.15);
        return (
          <text key={i} x={lx} y={ly} textAnchor="middle" fontFamily={V.mono}
            fontSize="9" fill={V.textMuted} letterSpacing="0.12em">
            {a.label}
          </text>
        );
      })}
    </svg>
  );
};

/** ProfileCard — compact mentor card with name/role/skills. */
const ProfileCard: React.FC<{ p: MentorProfile }> = ({ p }) => {
  const V = useV();
  const initials = (p.name || '').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div style={{ ...cardStyle(V), padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      {p.photo_url ? (
        <img
          src={p.photo_url}
          alt={p.name}
          style={{
            width: 36, height: 36, borderRadius: 8, objectFit: 'cover',
            flexShrink: 0, background: V.cardSoft,
          }}
        />
      ) : (
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: `linear-gradient(135deg, ${V.accent} 0%, ${V.gold} 100%)`,
          color: '#fff', fontFamily: V.display, fontWeight: 700, fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{initials || '?'}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: V.ink, fontFamily: V.display, lineHeight: 1.2 }}>{p.name}</div>
        {p.role && <div style={{ fontSize: 10, marginTop: 2, color: V.accent, fontFamily: V.mono, letterSpacing: '0.1em' }}>{p.role}</div>}
        {p.skills && p.skills.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {p.skills.slice(0, 4).map((s, i) => (
              <span key={i} style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 999,
                background: V.cardSoft, color: V.textSoft, fontFamily: V.mono,
              }}>{s}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Pre-cluster pain text helpers. */
const deckPainPoints = (themes: PainTheme[], signals: string[]): PainTheme[] => {
  if (themes && themes.length > 0) return themes;
  return signals.filter((s) => !isUnfilled(s)).slice(0, 5).map((s) => ({ theme: s, mentions: 1 }));
};
const shortenPain = (raw: string): string => {
  const s = (raw || '').trim();
  if (!s) return DASH;
  return s.length > 56 ? s.slice(0, 53) + '…' : s;
};

/* ─────────────────────────── Task #14 new slides ─────────────────────────── */

/**
 * Task #20 — classify a demo video URL so the Product Demo slide can pick
 * the right player. YouTube / Vimeo links need an <iframe> embed; direct
 * media files (.mp4/.webm/…) play via the autoplay/looping <video> tag.
 * Returns `none` for empty / placeholder values so the caller can fall
 * back to the screenshot, then the "Demo loop pending" placeholder.
 */
type DemoVideoKind = 'youtube' | 'vimeo' | 'file' | 'none';
const classifyDemoVideo = (raw: string): { kind: DemoVideoKind; embedUrl: string } => {
  const url = (raw || '').trim();
  if (isUnfilled(url)) return { kind: 'none', embedUrl: '' };
  // YouTube: watch?v=, youtu.be/, already-/embed/, /shorts/, /live/.
  const yt = url.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i,
  );
  if (yt && yt[1]) return { kind: 'youtube', embedUrl: `https://www.youtube.com/embed/${yt[1]}` };
  // Vimeo: vimeo.com/<id>, player.vimeo.com/video/<id>, channel/group forms.
  const vm = url.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)/i);
  if (vm && vm[1]) return { kind: 'vimeo', embedUrl: `https://player.vimeo.com/video/${vm[1]}` };
  // Anything else is treated as a direct media file (current behavior) so
  // existing .mp4/.webm links keep playing through the <video> element.
  return { kind: 'file', embedUrl: url };
};

/** Slide 9 (merged): Team + Venture Readiness. */
const Slide_TeamReadiness: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const V = useV();
  const t = d.team;
  const vr = d.venture_readiness;
  const slots = [0, 1, 2].map((i) => t.founders[i] || null);
  return (
    <SlideShell>
      <Eyebrow>{t.eyebrow} · {vr.eyebrow.split('·').pop()?.trim() || 'Readiness'}</Eyebrow>
      <SlideHeading>Team & venture readiness.</SlideHeading>
      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '6fr 6fr', gap: 24, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.accent, fontFamily: V.mono }}>Founders</div>
          {slots.map((m, i) => {
            if (!m) return (
              <div key={i} style={{ ...cardStyle(V, true), padding: 12, opacity: 0.6, fontSize: 11, color: V.textMuted, fontFamily: V.mono }}>
                Founder {i + 1} pending
              </div>
            );
            const initials = (m.name || '').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
            return (
              <div key={i} style={{ ...cardStyle(V), padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: `linear-gradient(135deg, ${V.accent}, ${V.gold})`,
                  color: '#fff', fontFamily: V.display, fontWeight: 700, fontSize: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>{initials || '?'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: V.ink, fontFamily: V.display }}>{m.name}</div>
                  <div style={{ fontSize: 10, marginTop: 2, color: V.accent, fontFamily: V.mono, letterSpacing: '0.1em' }}>{m.role}</div>
                </div>
              </div>
            );
          })}
          {!isUnfilled(t.team_intro) && (
            <div style={{ ...cardStyle(V, true), padding: 12, marginTop: 4 }}>
              <p style={{ fontSize: 12, lineHeight: 1.4, color: V.textSoft, fontFamily: V.sans, margin: 0 }}>{t.team_intro}</p>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: V.accent, fontFamily: V.mono }}>Readiness · {vr.tier || DASH}</div>
          <div style={{ ...cardStyle(V), padding: 16 }}>
            <ScoreBars items={vr.breakdown} />
          </div>
          {!isUnfilled(vr.ai_notes) && (
            <div style={{ ...cardStyle(V, true), padding: 12 }}>
              <p style={{ fontSize: 12, lineHeight: 1.4, color: V.textSoft, fontFamily: V.sans, margin: 0 }}>{vr.ai_notes}</p>
            </div>
          )}
        </div>
      </div>
    </SlideShell>
  );
};

const Slide_ReviewTheDeal: React.FC<{ d: SpinoutDemoDayData }> = ({ d }) => {
  const c = d.contact;
  const V = useV();
  const { pal, fonts } = useVariant();
  const da = c.deal_access;
  const hasRoom = !!da && !isUnfilled(da.deal_room_url);
  // Task #23 — share-mode interactive "Join & open the deal" card,
  // injected from the viewer layer. Null in editor/thumbnail/export.
  const dealSlot = useReviewDealSlot();
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
        {da && (
          <div style={{ marginTop: 28, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            {hasRoom ? (
              <a href={da.deal_room_url} target="_blank" rel="noreferrer noopener" style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                background: V.accent, color: '#fff', textDecoration: 'none',
                fontFamily: V.display, fontWeight: 700, fontSize: 15,
                padding: '14px 24px', borderRadius: 10,
              }}>
                {da.cta_label || 'Review the deal'} <span aria-hidden>→</span>
              </a>
            ) : (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                background: V.cardSoft, color: V.textMuted,
                fontFamily: V.mono, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase',
                padding: '12px 18px', borderRadius: 10, border: `1px dashed ${V.line}`,
              }}>{da.cta_label || 'Review the deal'} · pending</span>
            )}
            <span style={{
              fontSize: 10, padding: '6px 10px', borderRadius: 999,
              background: V.cardSoft, color: V.textSoft, fontFamily: V.mono, letterSpacing: '0.12em',
            }}>{da.nda_required ? 'NDA required' : 'No NDA'}</span>
            <span style={{
              fontSize: 10, padding: '6px 10px', borderRadius: 999,
              background: da.data_room_ready ? V.accentSoft : V.cardSoft,
              color: da.data_room_ready ? V.accent : V.textMuted,
              fontFamily: V.mono, letterSpacing: '0.12em',
            }}>{da.data_room_ready ? '✓ Data room ready' : '○ Data room pending'}</span>
          </div>
        )}
        {dealSlot && (
          <div style={{ marginTop: 28, width: '100%', maxWidth: 760 }}>{dealSlot}</div>
        )}
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
// 11 slides. Drops Axal Signal; product-demo media now lives on the
// Solution slide (no standalone Product Demo slide); merges Team +
// Venture Readiness into Team & readiness; renames Contact → Review the
// deal. Legacy Slide_Team / Slide_VentureReadiness / Slide_AxalSignal
// functions retained (unused) to keep any in-flight code references
// intact during rollout. Slide_Contact was deleted.
export const SLIDES: SlideEntry[] = [
  { id: 'cover',             title: 'Cover',             Component: Slide_Cover },
  { id: 'problem',           title: 'Problem',           Component: Slide_Problem },
  { id: 'validation',        title: 'Validation',        Component: Slide_Validation },
  { id: 'market',            title: 'Market',            Component: Slide_Market },
  { id: 'solution',          title: 'Solution',          Component: Slide_Solution },
  { id: 'roadmap',           title: 'Roadmap',           Component: Slide_Roadmap },
  { id: 'team_readiness',    title: 'Team & readiness',  Component: Slide_TeamReadiness },
  { id: 'mentor_network',    title: 'Mentors & network', Component: Slide_MentorNetwork },
  { id: 'cap_table',         title: 'Cap table',         Component: Slide_CapTable },
  { id: 'ask',               title: 'Ask',               Component: Slide_Ask },
  { id: 'review_the_deal',   title: 'Review the deal',   Component: Slide_ReviewTheDeal },
];
// Silence unused-warnings for retained legacy slide components.
void Slide_Team; void Slide_VentureReadiness; void Slide_AxalSignal;

/* ─────────────────────────── root deck ─────────────────────────── */

// Renders all 11 Slide16x9 frames stacked — matches sequoia_classic /
// investor_appendix_app, so the picker thumbnail, modal preview, share
// view and PDF export all work with a single scroll surface.
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

  const pal = PALETTES[variant];
  const fonts = FONTS[variant];
  const ctx: VariantCtx = { variant, setVariant, pal, fonts, editable };

  return (
    <VariantContext.Provider value={ctx}>
      {editable && (
        <div style={{ position: 'relative', height: 0 }}>
          <VariantSwitcher />
        </div>
      )}
      {SLIDES.map((s) => {
        const C = s.Component;
        return <C key={s.id} d={data} />;
      })}
    </VariantContext.Provider>
  );
};

/**
 * Default export — registered as `Deck_axal_spinout_demoday` in
 * `frontend/src/decks/templates/index.ts`.
 */
export const Deck_axal_spinout_demoday: React.FC<DeckProps> = (props) => <DeckRoot {...props} />;
export default Deck_axal_spinout_demoday;
