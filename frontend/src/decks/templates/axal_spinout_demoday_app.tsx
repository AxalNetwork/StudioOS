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
import { Slide16x9 } from '../DeckBase';

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
    },
    problem: {
      eyebrow: asStr(d.problem_eyebrow, base.problem.eyebrow),
      headline: asStr(d.problem_headline, base.problem.headline),
      body: asStr(d.problem_body, base.problem.body),
      signals: asArr(d.problem_signals),
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
    brand: {
      eyebrow: asStr(d.brand_eyebrow, base.brand.eyebrow),
      headline: asStr(d.brand_headline, base.brand.headline),
      tagline: asStr(d.brand_tagline, base.brand.tagline),
      vision: asStr(d.brand_vision, base.brand.vision),
      brand_kit_ready: asBool(d.brand_kit_ready),
      pitch_deck_ready: asBool(d.brand_pitch_deck_ready),
      incorporated: asBool(d.brand_incorporated),
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
    },
  };
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
  const { pal, fonts, variant } = useVariant();
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
    isDark: variant === 'product_first' || variant === 'manifesto',
    vibe: variant === 'editorial' ? 'serif'
        : variant === 'data_dense' ? 'mono'
        : variant === 'manifesto' ? 'cinematic'
        : 'sans',
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

/** MVP blueprint motif — layered construction lines (Solution slide). */
export const MvpBlueprint: React.FC = () => {
  const V = useV();
  return (
    <svg viewBox="0 0 360 280" style={{ width: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="360" height="280" fill={V.cardSoft} rx="8" />
      {Array.from({ length: 12 }).map((_, i) => (
        <line key={`v${i}`} x1={i * 30} y1="0" x2={i * 30} y2="280" stroke={V.line} strokeWidth={0.5} strokeOpacity={0.5} />
      ))}
      {Array.from({ length: 10 }).map((_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 28} x2="360" y2={i * 28} stroke={V.line} strokeWidth={0.5} strokeOpacity={0.5} />
      ))}
      <rect x="60" y="60" width="240" height="60" fill={V.card} stroke={V.accent} strokeWidth={2} rx="6" />
      <text x="180" y="96" textAnchor="middle" fontFamily={V.mono} fontSize="11" fontWeight={700} fill={V.accent} letterSpacing="0.18em">EXPERIENCE</text>
      <rect x="80" y="135" width="200" height="40" fill={V.card} stroke={V.accent} strokeOpacity={0.7} strokeWidth={1.5} rx="6" />
      <text x="180" y="160" textAnchor="middle" fontFamily={V.mono} fontSize="10" fontWeight={600} fill={V.textSoft} letterSpacing="0.18em">WORKFLOW</text>
      <rect x="100" y="188" width="160" height="40" fill={V.card} stroke={V.gold} strokeOpacity={0.7} strokeWidth={1.5} rx="6" />
      <text x="180" y="213" textAnchor="middle" fontFamily={V.mono} fontSize="10" fontWeight={600} fill={V.gold} letterSpacing="0.18em">DATA · AI</text>
      <line x1="180" y1="120" x2="180" y2="135" stroke={V.accent} strokeWidth={1.5} strokeDasharray="2 2" />
      <line x1="180" y1="175" x2="180" y2="188" stroke={V.accent} strokeWidth={1.5} strokeDasharray="2 2" />
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

/** Brand palette specimen — three swatches + type sample. */
export const BrandPaletteIllustration: React.FC = () => {
  const V = useV();
  return (
    <svg viewBox="0 0 320 240" style={{ width: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="320" height="240" fill={V.cardSoft} rx="6" />
      <rect x="24" y="36" width="200" height="168" fill={V.card} stroke={V.line} rx="6" />
      <text x="40" y="84" fontFamily={V.display} fontWeight={700} fontSize="36" fill={V.ink}>Aa</text>
      <text x="40" y="120" fontFamily={V.display} fontWeight={600} fontSize="13" fill={V.ink}>Display · serif</text>
      <text x="40" y="138" fontFamily={V.sans} fontSize="11" fill={V.textSoft}>Body · sans-serif</text>
      <text x="40" y="158" fontFamily={V.mono} fontSize="10" fill={V.textMuted}>MONO · CODE / LABELS</text>
      <line x1="40" y1="178" x2="200" y2="178" stroke={V.line} />
      <text x="40" y="194" fontFamily={V.mono} fontSize="9" fill={V.textMuted} letterSpacing="0.18em">VOICE · CALM · CLEAR</text>
      {[V.accent, V.gold, V.ink].map((c, i) => (
        <g key={i}>
          <rect x="244" y={36 + i * 56} width="52" height="48" fill={c} rx="4" />
          <text x="270" y={66 + i * 56} textAnchor="middle" fontFamily={V.mono} fontSize="8" fontWeight={700} fill="#fff" letterSpacing="0.14em">{['ACCENT', 'GOLD', 'INK'][i]}</text>
        </g>
      ))}
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

/* ─────────────────────────── 14 slides ─────────────────────────── */

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
      {allMissing && (
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <MarketCircles tam={m.tam} sam={m.sam} som={m.som} />
        </div>
      )}
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
      {allEmpty && (
        <div style={{ marginTop: 16 }}>
          <OkrBoard now={r.now} next={r.next} later={r.later} />
        </div>
      )}
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
        ? <div style={{ marginTop: 32, maxWidth: 520 }}><ScoreBars items={[]} /></div>
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
        ? <div style={{ marginTop: 32 }}><CapTablePie holders={[]} /></div>
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
        ) : <UseOfFundsBar buckets={undefined} />}
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

// Renders all 14 Slide16x9 frames stacked — matches sequoia_classic /
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
