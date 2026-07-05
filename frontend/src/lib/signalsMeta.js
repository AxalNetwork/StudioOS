/**
 * Signals — shared UI metadata (labels, icons, tones).
 *
 * Keeps the vocabulary presentation in ONE place so SignalCard, the filter bar
 * and the evidence panel all render the same labels/colours. The canonical
 * vocabularies live on the worker (services/signals/types.ts) and arrive via
 * /api/signals/filters + /meta; this module only maps them to presentation.
 */
import {
  Sparkles, Globe2, Users, ShieldAlert, Workflow, TrendingUp,
  Layers, Boxes, Merge, FileText, Newspaper, LineChart, Landmark,
  Building2, Briefcase, HelpCircle,
} from 'lucide-react';

export const SIGNAL_TYPE_META = {
  emerging_niche_demand: { label: 'Emerging niche demand', icon: Sparkles },
  geographic_expansion: { label: 'Geographic expansion', icon: Globe2 },
  underserved_segment: { label: 'Underserved segment', icon: Users },
  regulatory_pressure: { label: 'Regulatory pressure', icon: ShieldAlert },
  workflow_digitization: { label: 'Workflow digitization', icon: Workflow },
  midcap_momentum: { label: 'Mid-cap momentum', icon: TrendingUp },
  vertical_software: { label: 'Vertical software', icon: Layers },
  category_creation: { label: 'Category creation', icon: Boxes },
  consolidation_signal: { label: 'Consolidation signal', icon: Merge },
};

export function signalTypeMeta(type) {
  return SIGNAL_TYPE_META[type] || { label: prettify(type), icon: HelpCircle };
}

export const EVIDENCE_KIND_META = {
  fundamentals: { label: 'Fundamentals', icon: Building2, tone: 'violet' },
  market_data: { label: 'Market trend', icon: LineChart, tone: 'sky' },
  news: { label: 'News', icon: Newspaper, tone: 'amber' },
  filing: { label: 'Filing', icon: FileText, tone: 'emerald' },
  registry: { label: 'Registry', icon: Landmark, tone: 'indigo' },
  earnings: { label: 'Earnings', icon: TrendingUp, tone: 'emerald' },
  hiring: { label: 'Hiring', icon: Briefcase, tone: 'rose' },
};

export function evidenceKindMeta(kind) {
  return EVIDENCE_KIND_META[kind] || { label: prettify(kind), icon: HelpCircle, tone: 'gray' };
}

export const MARKET_CAP_BAND_LABEL = {
  nano: 'Nano (<$50M)',
  micro: 'Micro ($50M–$300M)',
  small: 'Small ($300M–$2B)',
  mid: 'Mid ($2B–$10B)',
  large: 'Large ($10B–$200B)',
  mega: 'Mega (>$200B)',
};

export const CUSTOMER_TYPE_LABEL = {
  smb: 'SMB',
  mid_market: 'Mid-market',
  enterprise: 'Enterprise',
  consumer: 'Consumer',
  developer: 'Developers',
  public_sector: 'Public sector',
  healthcare_provider: 'Healthcare providers',
  financial_institution: 'Financial institutions',
};

export const MATURITY_STAGE_LABEL = {
  emerging: 'Emerging',
  scaling: 'Scaling',
  established: 'Established',
  incumbent: 'Incumbent',
};

/** Human label for a filter facet value, falling back to a prettified string. */
export function facetLabel(facet, value) {
  if (facet === 'market_cap_band') return MARKET_CAP_BAND_LABEL[value] || prettify(value);
  if (facet === 'customer_type') return CUSTOMER_TYPE_LABEL[value] || prettify(value);
  if (facet === 'maturity_stage') return MATURITY_STAGE_LABEL[value] || prettify(value);
  if (facet === 'type') return (SIGNAL_TYPE_META[value] || {}).label || prettify(value);
  return value;
}

/** Tailwind classes (light + dark) for a 0–100 confidence score. */
export function confidenceTone(score) {
  if (score >= 75) {
    return { label: 'High', chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', bar: 'bg-emerald-500' };
  }
  if (score >= 55) {
    return { label: 'Moderate', chip: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', bar: 'bg-amber-500' };
  }
  return { label: 'Early', chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', bar: 'bg-slate-400' };
}

/** Tailwind chip classes for an evidence tone. */
export function toneChip(tone) {
  const map = {
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    sky: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  };
  return map[tone] || map.gray;
}

export function prettify(s) {
  return String(s || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Relative "x days ago" from an ISO timestamp. */
export function timeAgo(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!isFinite(t)) return '—';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
