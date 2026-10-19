/**
 * D776 PR 2 (#2093) — the words for HQ › AI allowances' three read-only
 * cards: how members are charged, the models offered, and one member's month.
 * Pure, so `frontend/test/hq_ai_allowances_d776.test.mjs` holds each rule.
 */
import { ALL_MODEL_IDS, NEW_MODELS } from '../../ui/railModels';
import { chargedPages, microUsd, whenLabel } from '../account/usageModel';

/** How a run is settled, in the canvas's words; null for a mode the Worker did not send. */
export function billingText(read) {
  if (!read || typeof read !== 'object') return null;
  if (read.billing === 'cost') return 'At Cloudflare’s cost';
  if (read.billing === 'billed') return Number.isFinite(read.markup) ? `Cloudflare’s cost × ${read.markup}` : 'Cloudflare’s cost, marked up';
  return null;
}

const UNIT_WORDS = {
  tokens_in: 'per 1M input tokens',
  tokens_cached: 'per 1M cached input tokens',
  tokens_out: 'per 1M output tokens',
  audio_minutes: 'per audio minute',
  audio_minutes_websocket: 'per streamed audio minute',
  characters: 'per 1k characters',
  images: 'per 1M images',
  tiles: 'per tile',
  steps: 'per step',
  input_tile_steps: 'per input tile-step',
  output_tile_steps: 'per output tile-step',
  input_tiles: 'per input tile',
  output_tiles: 'per output tile',
  first_megapixels: 'for the first megapixel',
  subsequent_megapixels: 'per further megapixel',
  input_image_megapixels: 'per input megapixel',
};

/** A unit price as US dollars, to six decimals at most, trailing zeros dropped. */
export function unitUsd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  // Rounded to six decimals, then printed as the number it is: $0.06375, $0.4. Never a rate's trim (lib/bps.js).
  return `$${Number(n.toFixed(6))}`;
}

/**
 * The New badge's model ids: the canvas's new models (`NEW_MODELS`) that the
 * rail's model list (`ALL_MODEL_IDS`) maps to a catalogue id. A new model the
 * list does not map yet gets no badge here rather than one matched by a guess.
 */
export const NEW_MODEL_IDS = new Set(Object.entries(ALL_MODEL_IDS).filter(([name, id]) => id && NEW_MODELS.has(name)).map(([, id]) => id));

/** Each offered model: its name, kind, price lines (cost and billed per unit), Paid only, New, and the pages naming it. */
export function modelsView(read, newIds = NEW_MODEL_IDS) {
  if (!read || !Array.isArray(read.models)) return null;
  return read.models.filter((m) => m && typeof m.id === 'string').map((m) => {
    const cost = m.cost && typeof m.cost === 'object' ? m.cost : {};
    const billed = m.billed && typeof m.billed === 'object' ? m.billed : {};
    const prices = Object.keys(cost).filter((u) => unitUsd(cost[u]) != null).map((u) => ({
      unit: UNIT_WORDS[u] || u, cost: unitUsd(cost[u]), billed: unitUsd(billed[u]),
    }));
    return {
      id: m.id, name: m.name || m.id, kind: m.kind || null, prices,
      paidOnly: m.paid_only === true, isNew: newIds.has(m.id),
      pages: Array.isArray(m.pages) ? m.pages.filter((p) => typeof p === 'string' && p) : [],
    };
  });
}

/** `YYYY-MM` for a date, in UTC, as the Worker's month is. */
export function monthOf(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * One member's month: the pages with their options (the member's own
 * "Where it went" fold, `chargedPages`), and each run with its cost, charge
 * and model, a guard check marked as one. Null for anything that is not the
 * Worker's shape.
 */
export function memberMonthView(read) {
  if (!read || !Array.isArray(read.by_option) || !Array.isArray(read.runs)) return null;
  const where = chargedPages({ rows: read.by_option, truncated: read.truncated });
  const runs = read.runs.filter((r) => r && Number.isSafeInteger(r.id)).map((r) => ({
    id: r.id,
    when: whenLabel(r.at) ?? r.at ?? null,
    model: typeof r.model === 'string' ? r.model.split('/').pop() : null,
    page: typeof r.page === 'string' && r.page ? r.page : null,
    option: typeof r.option === 'string' && r.option ? r.option : null,
    guard: Number.isSafeInteger(r.guard_for),
    cost: typeof r.cost_microusd === 'number' ? microUsd(r.cost_microusd) : null,
    charged: typeof r.charged_microusd === 'number' ? microUsd(r.charged_microusd) : null,
  }));
  const t = read.totals || {};
  return {
    month: read.month,
    pages: where?.pages ?? [],
    truncated: where?.truncated === true,
    runs,
    runsTruncated: read.runs_truncated === true,
    total: { runs: Number.isSafeInteger(t.runs) ? t.runs : 0, charged: typeof t.charged_microusd === 'number' ? microUsd(t.charged_microusd) : null },
  };
}
