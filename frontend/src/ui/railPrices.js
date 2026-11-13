/**
 * D769 (#2088; D720 §1, §8, §11) — the price beside every model on the rail.
 *
 * D698 drew no rate on the rail (its decision 10). D720 reverses that: every
 * "Suggested for this page" card and every All models row prints its price, in
 * the canvas's words and units (`priceText`, the canvas's `pr()`), and so does
 * the guard sentence.
 *
 * THE FIGURE IS THE WORKER'S, never typed or computed here:
 *   - a card's price comes with its model in `GET /api/ai/rail` (D764, PR 2
 *     of D769: `railModelPrice`);
 *   - an All models row's and the guard's from `GET /api/ai/rates`, the
 *     router's rate card (`railRates`).
 * Both carry D760's `cost` and `billed`, and both say which one a run is
 * settled at in `billing`: the billed price once the Worker reports
 * `billing: 'billed'`, else the cost, which is what a run is charged. The
 * owner set `AI_BILLING = "charged"` (#2123); the rail follows the Worker's
 * `billing`, so it prints billed the deploy `billingMode` reads that switch
 * (D762), and never a price the run is not settled at.
 * Nothing here multiplies by the margin. The canvas's `usd()` does, and
 * copying it would quote a price the member is not charged.
 *
 * NO PRICE, NO FIGURE. A model the Worker gives no price for prints "Not
 * available", as the canvas does. A read that failed prints "Unreadable",
 * never a zero, and one in flight prints an ellipsis.
 */
import { GUARD_MODEL } from './railModels';

/** The note under All models (D720 §1: voice is billed per minute too, MeloTTS). */
export const PRICE_NOTE = 'Prices per 1M tokens, in · out. Speech per audio minute, voice per 1k characters or per minute, images per tile or megapixel.';
export const NOT_AVAILABLE = 'Not available';
export const PRICE_UNREADABLE = 'Unreadable';
export const SAFETY_SENTENCE = 'Eadwyn drafts; you send.';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
function unitsOf(src) {
  const out = {};
  for (const [k, v] of Object.entries(src || {})) if (num(v) !== undefined) out[k] = v;
  return out;
}

/**
 * The Worker's prices per model id. `reading` is `{ loading, error, data }`
 * over `GET /api/ai/rates`.
 *   - A row's `billed` units are used only once the Worker reports
 *     `billing: 'billed'`; until then its `cost` units.
 *   - A rate card from before D760 carries neither, and its per-1M and
 *     per-minute fields are the cost.
 * Returns `{ state, byId, guardOn }`. `state` is `loading`, `unreadable` or
 * `ready`. `guardOn` is the Worker's `guard.every_run`, true where the read
 * does not say, because D763 part 2 checks every run on `main`.
 */
export function railRates(reading) {
  if (reading?.loading) return { state: 'loading', byId: new Map(), guardOn: true };
  const data = reading?.data;
  if (reading?.error || !Array.isArray(data?.models)) return { state: 'unreadable', byId: new Map(), guardOn: true };
  const billed = data.billing === 'billed';
  const byId = new Map();
  for (const row of data.models) {
    if (!row || typeof row.id !== 'string') continue;
    const units = billed && row.billed ? unitsOf(row.billed)
      : row.cost ? unitsOf(row.cost)
        : unitsOf({
          tokens_in: row.in_per_1m_usd,
          tokens_out: row.out_per_1m_usd,
          audio_minutes: row.per_audio_minute_usd,
          audio_minutes_websocket: row.per_audio_minute_websocket_usd,
        });
    if (Object.keys(units).length) byId.set(row.id, units);
  }
  return { state: 'ready', byId, guardOn: data.guard?.every_run !== false };
}

/**
 * A USD figure as the canvas prints one: four significant figures, at least
 * two decimals. The canvas's `usd()` also multiplies by 1.25; this does not,
 * because the figure it is given is already the price the member pays.
 */
export function usd(v) {
  const x = Number(Number(v).toPrecision(4));
  let s = String(x);
  if (s.includes('e')) s = x.toFixed(8).replace(/0+$/, '');
  const d = (s.split('.')[1] || '').length;
  return `$${d < 2 ? x.toFixed(2) : s}`;
}

/**
 * The canvas's `pr()` over a model's units: `long` on a card, short in All
 * models. Image short prices add " + steps" where a step is charged too,
 * which the canvas's short label leaves out (D720 §1).
 */
export function priceText(units, long) {
  const u = units || {};
  const has = (k) => u[k] !== undefined;
  if (has('tokens_in') && u.tokens_out > 0) {
    if (!long) return `${usd(u.tokens_in)} · ${usd(u.tokens_out)}`;
    return `${usd(u.tokens_in)} in · ${has('tokens_cached') ? `${usd(u.tokens_cached)} cached · ` : ''}${usd(u.tokens_out)} out per 1M tokens`;
  }
  if (has('tokens_in')) return long ? `${usd(u.tokens_in)} per 1M tokens` : usd(u.tokens_in);
  if (has('audio_minutes') && has('audio_minutes_websocket')) {
    return long ? `${usd(u.audio_minutes)} / min · ${usd(u.audio_minutes_websocket)} / min live` : `${usd(u.audio_minutes)} / min`;
  }
  if (has('audio_minutes')) return `${usd(u.audio_minutes)} / min`;
  if (has('audio_minutes_websocket')) return `${usd(u.audio_minutes_websocket)} / min live`;
  if (has('characters')) return long ? `${usd(u.characters)} per 1k characters` : `${usd(u.characters)} / 1k chars`;
  if (has('first_megapixels')) {
    return long
      ? `${usd(u.first_megapixels)} first megapixel · ${usd(u.subsequent_megapixels ?? 0)} each more`
      : `${usd(u.first_megapixels)} / MP`;
  }
  if (has('input_tile_steps')) {
    return long
      ? `${usd(u.input_tile_steps)} per input tile · ${usd(u.output_tile_steps ?? 0)} per output tile, per step`
      : `${usd(u.output_tile_steps ?? u.input_tile_steps)} / tile + steps`;
  }
  if (has('input_tiles')) {
    return long
      ? `${usd(u.input_tiles)} per input tile · ${usd(u.output_tiles ?? 0)} per output tile`
      : `${usd(u.output_tiles ?? u.input_tiles)} / tile`;
  }
  if (has('tiles')) {
    return long
      ? `${usd(u.tiles)} per tile${has('steps') ? ` · ${usd(u.steps)} per step` : ''}`
      : `${usd(u.tiles)} / tile${has('steps') ? ' + steps' : ''}`;
  }
  if (has('images')) return `${usd(u.images)} per 1M images`;
  return NOT_AVAILABLE;
}

/** A model's price as the rail prints it: an ellipsis while loading, Unreadable, Not available, or the figure. */
export function modelPrice(rates, id, long) {
  if (!rates || rates.state === 'loading') return '…';
  if (rates.state === 'unreadable') return PRICE_UNREADABLE;
  const units = rates.byId.get(id);
  return units ? priceText(units, long) : NOT_AVAILABLE;
}

/** A model's price from `GET /api/ai/rail`: its billed units once `billing` is 'billed', else its cost. */
export function railModelPrice(model, billing, long) {
  const p = model?.price;
  const units = unitsOf(billing === 'billed' ? p?.billed : p?.cost);
  return Object.keys(units).length ? priceText(units, long) : NOT_AVAILABLE;
}

/** All models' groups with each row's short price, from the rate card. */
export function priceGroups(groups, rates) {
  return groups.map((g) => ({ ...g, chips: g.chips.map((c) => ({ ...c, price: modelPrice(rates, c.id, false) })) }));
}

/**
 * The guard sentence (D720 §8): "Llama Guard 3 8B checks every run ($… in ·
 * $… out per 1M tokens). Eadwyn drafts; you send." Its prices are the
 * models', from the same read. Where the read has no token price for the
 * guard, the sentence names none rather than a guessed one.
 */
export function guardSentence(rates) {
  const u = rates?.state === 'ready' ? rates.byId.get(GUARD_MODEL) : null;
  const price = u && u.tokens_in !== undefined && u.tokens_out !== undefined
    ? ` (${usd(u.tokens_in)} in · ${usd(u.tokens_out)} out per 1M tokens)` : '';
  return `Llama Guard 3 8B checks every run${price}. ${SAFETY_SENTENCE}`;
}
