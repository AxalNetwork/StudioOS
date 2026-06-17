// Task #2 — Shared metadata + helpers for the gamified-assessment player UI.
// Pure module (no JSX). Provides the human labels/poles for value spectrums and
// the 8 canonical skill axes, the founder-track archetype copy, a lucide icon
// resolver for badges/archetypes, and the client-side XP/level curve (mirrors
// cloudflare-worker/src/services/assessmentScoring.ts::levelForXp so the hub can
// render a level bar without a dedicated endpoint).
import {
  Compass, Rocket, Ruler, Zap, Flag, Award, Medal, Sparkles, Trophy, Star,
} from 'lucide-react';

// Value spectrums are bipolar (−2..+2). `low` = negative pole, `high` = positive
// pole. Mirrors the founder spectrums measured by migration 108's seed.
export const VALUE_SPECTRUMS = {
  founder_mission_vs_profit: { label: 'Mission vs Profit', low: 'Profit-first', high: 'Mission-first' },
  founder_speed_vs_quality: { label: 'Speed vs Quality', low: 'Quality-first', high: 'Speed-first' },
  founder_risk_appetite: { label: 'Risk Appetite', low: 'Risk-averse', high: 'Risk-seeking' },
  founder_growth_vs_sustain: { label: 'Growth vs Sustainability', low: 'Sustainable', high: 'Hyper-growth' },
  founder_autonomy_vs_structure: { label: 'Autonomy vs Structure', low: 'Process & structure', high: 'Autonomy & flex' },
};

// 8 canonical skill axes (0..5). Labels + order mirror the worker's RADAR_AXES.
export const SKILL_AXES = {
  product: 'Product',
  engineering: 'Engineering',
  design: 'Design',
  gtm_sales: 'GTM / Sales',
  marketing_brand: 'Marketing / Brand',
  finance_ops: 'Finance / Ops',
  legal_compliance: 'Legal / Compliance',
  capital_network: 'Capital / Network',
};
// Short labels keep the radar legible on mobile + inside the export card.
export const SKILL_AXES_SHORT = {
  product: 'Product',
  engineering: 'Eng',
  design: 'Design',
  gtm_sales: 'GTM',
  marketing_brand: 'Brand',
  finance_ops: 'Finance',
  legal_compliance: 'Legal',
  capital_network: 'Capital',
};
export const SKILL_AXIS_ORDER = Object.keys(SKILL_AXES);

// Founder-track archetype copy (mirrors migration 108 seed) keyed by slug.
export const ARCHETYPES = {
  fo_missionary: {
    label: 'The Missionary', tagline: 'Mission first, built to last.',
    description: 'Anchored to the why. Bias to durable, sustainable building and craft over raw speed.',
    icon: 'compass', accent: '#0ea5e9',
  },
  fo_rocketeer: {
    label: 'The Rocketeer', tagline: 'Fast, bold, built to break out.',
    description: 'High speed, high risk, hyper-growth. Comfortable raising big and moving first.',
    icon: 'rocket', accent: '#f97316',
  },
  fo_architect: {
    label: 'The Architect', tagline: 'Craft, structure, and durable systems.',
    description: 'Quality-first and risk-aware, with a preference for process, structure, and deep technical foundations.',
    icon: 'ruler', accent: '#8b5cf6',
  },
  fo_maverick: {
    label: 'The Maverick', tagline: 'Independent, instinctive, unafraid.',
    description: 'High autonomy and risk appetite with a fast, instinct-led style. Thrives without a playbook.',
    icon: 'zap', accent: '#eab308',
  },
};

const ICONS = {
  compass: Compass, rocket: Rocket, ruler: Ruler, zap: Zap, flag: Flag,
  award: Award, medal: Medal, trophy: Trophy, star: Star, sparkles: Sparkles,
};
export function iconFor(name) {
  return ICONS[String(name || '').toLowerCase()] || Sparkles;
}

export function humanize(slug) {
  return String(slug || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function valueLabel(slug) { return VALUE_SPECTRUMS[slug]?.label || humanize(slug); }
export function skillLabel(slug) { return SKILL_AXES[slug] || humanize(slug); }
export function archetypeMeta(slug) { return ARCHETYPES[slug] || null; }

// ── XP / level curve (mirrors assessmentScoring.ts::levelForXp) ──────────────
export function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100)) + 1;
}
// XP threshold to REACH a given level L: 100 * (L-1)^2.
export function xpForLevel(level) {
  const l = Math.max(1, Number(level) || 1);
  return 100 * (l - 1) * (l - 1);
}
// Progress within the current level.
export function levelProgress(xp) {
  const x = Math.max(0, Number(xp) || 0);
  const level = levelForXp(x);
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = Math.max(1, next - cur);
  const into = x - cur;
  return {
    level, xp: x,
    intoLevel: into, levelSpan: span,
    toNext: Math.max(0, next - x),
    pct: Math.max(0, Math.min(100, Math.round((into / span) * 100))),
  };
}

// Build radar rows for the 8 skill axes from a skillVector object {slug:level}.
export function skillRadarData(skillVector = {}, { short = false } = {}) {
  return SKILL_AXIS_ORDER.map((slug) => ({
    slug,
    axis: short ? SKILL_AXES_SHORT[slug] : SKILL_AXES[slug],
    value: Math.max(0, Math.min(5, Number(skillVector?.[slug]) || 0)),
  }));
}

// Top-N entries of a vector as [{slug,label,value}].
export function topValues(valueVector = {}, n = 3) {
  return Object.entries(valueVector || {})
    .map(([slug, v]) => ({ slug, label: valueLabel(slug), value: Number(v) || 0 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, n);
}
export function topSkills(skillVector = {}, n = 3) {
  return Object.entries(skillVector || {})
    .map(([slug, v]) => ({ slug, label: skillLabel(slug), value: Number(v) || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// A spectrum's signed value → the leaning pole label (for the trading card).
export function spectrumLean(slug, value) {
  const meta = VALUE_SPECTRUMS[slug] || {};
  const v = Number(value) || 0;
  if (v > 0.2) return meta.high || 'High';
  if (v < -0.2) return meta.low || 'Low';
  return 'Balanced';
}
