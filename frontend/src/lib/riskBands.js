// Task #10 — Venture Risk band helpers (shared by the per-company panel and the
// portfolio risk matrix).
//
// A layer score is a 0..100 "de-risk confidence": HIGHER = more proof = LOWER
// risk. The band inverts that — a high score is a LOW risk band. Thresholds
// mirror the worker (services/ventureRisk.ts): >= 67 low, >= 34 medium, else
// high. Keep these in lockstep with the backend so the UI never re-bands a
// score differently from the API.

export const RISK_LOW_MIN = 67;
export const RISK_MED_MIN = 34;

export function bandFromScore(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s >= RISK_LOW_MIN) return 'low';
  if (s >= RISK_MED_MIN) return 'medium';
  return 'high';
}

export const RISK_BAND_LABEL = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

// Pill / chip classes (with dark variants) for band tags.
export const RISK_BAND_CHIP = {
  low: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800',
  medium: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800',
  high: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800',
};

// Heatmap cell classes for the portfolio matrix.
export const RISK_BAND_CELL = {
  low: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  medium: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  high: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200',
};

// Raw hex for SVG fills/strokes (radar geometry can't use Tailwind classes for
// dynamic per-band fills).
export const RISK_BAND_HEX = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#ef4444',
};

// Short axis label for the radar (drops the trailing " Risk").
export function shortLayerLabel(label) {
  return String(label || '').replace(/\s*risk$/i, '').trim();
}

// True when a layer carries real risk *data* — auto data, OR an explicit
// analyst score/band. A note- or status-only override does NOT count: it must
// not unmute a misleading 0/High display. Prefers the worker's `has_data`
// flag (services/ventureRisk.ts) and falls back to deriving the same predicate.
export function layerHasRiskData(layer) {
  if (!layer) return false;
  if (typeof layer.has_data === 'boolean') return layer.has_data;
  return !!(layer.auto_has_data || layer.analyst_score != null || layer.analyst_band != null);
}
