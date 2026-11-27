/** D789 (#2214): pure views of D787/D805's member cost read; no invented totals. */
import { toUtcInstant } from '../../lib/notices';
import { modelColour } from '../../lib/modelColours';
import { usd, microUsd } from './usageModel';

export const COST_RANGES = Object.freeze([
  { key: 'mtd', label: 'Month to date' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'prev_month', label: 'Previous month' },
]);
export const COST_GROUPS = Object.freeze([
  { key: 'model', label: 'Model' }, { key: 'page', label: 'Page' }, { key: 'option', label: 'Option' },
]);
export const USAGE_SUBTITLE = "How your AI spend is tracking against your limits, and what you're billed.";
export const COST_SUBTITLE = 'Cost of your AI usage over time. All dates are UTC.';
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const money = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function costReadable(read) {
  return !!read && count(read.totals?.runs) && Array.isArray(read.models)
    && Array.isArray(read.days) && Array.isArray(read.groups)
    && read.groups.every((g) => g && typeof g === 'object')
    && (read.totals.runs === 0 || read.models.length > 0)
    && read.models.every((m) => m && typeof m.model === 'string')
    && read.days.every((d) => d && typeof d.day === 'string' && Array.isArray(d.by_model)
      && d.by_model.every((m) => m && typeof m.model === 'string'));
}

/** Every segment is the read's own model and cost; empty days remain on the axis. */
export function dailySeries(read, model = '') {
  if (!costReadable(read)) return null;
  const names = new Map(read.models.map((m) => [m.model, m.name || m.model]));
  const days = read.days.map((d) => {
    const rows = d.by_model.filter((m) => !model || m.model === model);
    const segments = rows.map((m) => ({
      model: m.model, name: names.get(m.model) || m.model, colour: modelColour(m.model),
      cost: money(m.cost_usd) ? m.cost_usd : null,
      input: count(m.input_tokens) ? m.input_tokens : null,
      output: count(m.output_tokens) ? m.output_tokens : null,
    }));
    const sum = (key) => segments.some((s) => s[key] == null) ? null : segments.reduce((n, s) => n + s[key], 0);
    return { day: d.day, segments, cost: sum('cost'), input: sum('input'), output: sum('output') };
  });
  const legend = read.models.filter((m) => !model || m.model === model).map((m) => ({
    model: m.model, name: m.name || m.model, colour: modelColour(m.model),
  }));
  return { days, legend, max: Math.max(0, ...days.map((d) => d.cost ?? 0)) };
}

/** A complete current-month slice of the cost read, or null when it cannot prove an empty month. */
export function monthIsEmpty(read, now = new Date()) {
  if (!costReadable(read) || read.truncated) return null;
  const today = now.toISOString().slice(0, 10);
  const first = today.slice(0, 7) + '-01';
  if (!read.range || read.range.from > first || read.range.to < today) return null;
  const days = read.days.filter((d) => d.day >= first && d.day <= today);
  const needed = now.getUTCDate();
  if (new Set(days.map((d) => d.day)).size !== needed) return null;
  return days.every((d) => d.by_model.length === 0);
}

export function unitText(units) {
  if (!units || typeof units !== 'object' || Array.isArray(units)) return null;
  const labels = { audio_minutes: 'min', characters: 'characters', images: 'images', tiles: 'tiles', steps: 'steps' };
  const rows = Object.entries(units).filter(([, v]) => money(v) && v > 0);
  return rows.length ? rows.map(([k, v]) => `${v.toLocaleString('en-US')} ${labels[k] || k.replace(/_/g, ' ')}`).join(' · ') : 'Tokens only';
}

export function totalUnits(read) {
  if (!costReadable(read) || read.models.some((m) => !m.units || typeof m.units !== 'object')) return null;
  const units = {};
  for (const m of read.models) for (const [key, value] of Object.entries(m.units)) {
    if (!money(value)) return null;
    units[key] = (units[key] ?? 0) + value;
  }
  return unitText(units);
}

export function costTableRows(read, group = 'model', model = '') {
  if (!costReadable(read)) return null;
  if (group !== 'model' && read.totals.runs > 0 && read.groups.length === 0) return null;
  if (group !== 'model') return read.groups.map((r) => ({
    key: JSON.stringify([r.page, r.key]), label: r.label || r.key || 'Not recorded',
    page: group === 'option' ? r.page : null, colour: null,
    runs: r.runs, input: r.input_tokens, output: r.output_tokens,
    units: null, cost: null, charged: microUsd(r.charged_microusd),
    // D787's grouped rows expose charge and tokens, but no cost, units or
    // missing-charge count. Never infer those from the per-model split.
    partial: null,
  }));
  return read.models.filter((r) => !model || r.model === model).map((r) => ({
    key: r.model, label: r.name || r.model, colour: modelColour(r.model),
    runs: r.runs, input: r.input_tokens, output: r.output_tokens,
    units: unitText(r.units), cost: usd(r.cost_usd), charged: microUsd(r.charged_microusd),
    partial: r.not_recorded,
  }));
}

export function costTotals(read) {
  if (!costReadable(read)) return null;
  const t = read.totals;
  return [
    { label: 'Total charged', value: microUsd(t.charged_microusd) },
    { label: 'Token cost', value: usd(t.by_kind?.tokens?.cost_usd) },
    { label: 'Audio and speech cost', value: usd(t.by_kind?.audio_speech?.cost_usd) },
    { label: 'Image cost', value: usd(t.by_kind?.image?.cost_usd) },
  ];
}

/** Only HTTPS URLs, or the documented authenticated order PDF path. */
export function invoiceHref(value) {
  if (typeof value !== 'string') return null;
  if (/^\/api\/orders\/[A-Za-z0-9_-]+\/invoice$/.test(value)) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function invoiceTime(value) {
  const instant = toUtcInstant(value);
  const time = instant ? Date.parse(instant) : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}
export function recentInvoices(read) {
  if (!read || !Array.isArray(read.invoices)) return null;
  return [...read.invoices].sort((a, b) => invoiceTime(b.date) - invoiceTime(a.date))
    .slice(0, 3).map((r) => ({ ...r, href: invoiceHref(r.pdf_url) }));
}
