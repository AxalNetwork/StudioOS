/**
 * D5898 (#5898, part 1 (c) of #5026) — the Axal VC package comparison's rules (board L30), pure so the tests read
 * them without a page.
 *
 * Two reads feed it, and the browser computes no price:
 *   - composition: the catalogue (`?all=1`) and each compared version's items. L30: "No matrix read exists; the
 *     page composes it from each package's items." The columns are the active version of each package, or the one
 *     version a catalogue row's Preview pricing named;
 *   - pricing: `GET /api/admin/licences/:uid/package-pricing` (D5023) for the chosen licence. Its country-adjusted
 *     price, standalone sum, bundle saving and warnings are shown as the Worker returns them. A null value reads
 *     "Not recorded" beside the Worker's own sentence, never 0 and never a smaller sum.
 *
 * Money is each version's own currency through `lib/money.js`.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { formatMinor } from '../../../lib/money.js';
import { bpsPercent } from '../../../lib/bps.js';
import { dateWord } from '../licenceRegistryModel.js';

export { NOT_RECORDED };

/** The rows under the program grid, in L30's order. */
export const PRICE_ROWS = Object.freeze([
  ['base', 'Annual package price · base'],
  ['adjusted', 'Country-adjusted'],
  ['standalone', 'Standalone sum'],
  ['saving', 'Bundle saving'],
  ['warnings', 'Warnings'],
]);

export const COMPOSED_NOTE = 'No matrix read exists: the page composes it from each package version’s items.';

export function money(cents, currency) {
  if (cents === null || cents === undefined) return NOT_RECORDED;
  return formatMinor(cents, currency, { locale: 'en-GB', trimWhole: true }) ?? NOT_RECORDED;
}

/** 1 180 000 ppm → "1.180". Null or not a number reads Not recorded. */
export function indexWord(ppm) {
  const n = Number(ppm);
  if (ppm === null || ppm === undefined || !Number.isFinite(n)) return NOT_RECORDED;
  return (n / 1e6).toFixed(3);
}

/** Basis points as a percentage: `lib/bps.js`'s one definition (D149), so 1862 reads "18.62%" here as everywhere. */
export const percentWord = bpsPercent;

/**
 * The compared versions, as columns. With no `only`, the active version of every package key, cheapest base fee
 * first (L30's order), then by name. With `only` ({ package_key, version? }), that one version: the named version,
 * else the key's active version, else its newest.
 */
export function compareColumns(versions, only = null) {
  const list = versions || [];
  if (only?.package_key) {
    const mine = list.filter((v) => v.package_key === only.package_key).sort((a, b) => b.version - a.version);
    const pick = only.version != null
      ? mine.find((v) => Number(v.version) === Number(only.version))
      : mine.find((v) => v.status === 'active') || mine[0];
    return pick ? [pick] : [];
  }
  return list.filter((v) => v.status === 'active').sort((a, b) =>
    (a.base_annual_fee_cents ?? Infinity) - (b.base_annual_fee_cents ?? Infinity) || String(a.name).localeCompare(String(b.name)));
}

export const columnId = (v) => `${v.package_key}:${v.version}`;

/**
 * The program grid. `details` maps a column id to `{ state: 'ready', items }`, `{ state: 'error' }` or
 * `{ state: 'loading' }`. Rows are every program any compared version lists, in the first column's order, then
 * the next's. A cell is 'included', 'optional' (listed, not included by default), 'none', 'unreadable' (that
 * column's items failed) or 'loading'.
 */
export function programGrid(columns, details) {
  const order = [];
  const seen = new Set();
  for (const col of columns) {
    const d = details?.[columnId(col)];
    if (d?.state !== 'ready') continue;
    for (const item of [...d.items].sort((a, b) => a.position - b.position || String(a.program_key).localeCompare(String(b.program_key)))) {
      if (!seen.has(item.program_key)) { seen.add(item.program_key); order.push(item.program_key); }
    }
  }
  return order.map((program) => ({
    program,
    cells: columns.map((col) => {
      const d = details?.[columnId(col)];
      if (!d || d.state === 'loading') return 'loading';
      if (d.state === 'error') return 'unreadable';
      const item = d.items.find((i) => i.program_key === program);
      if (!item) return 'none';
      return item.included_by_default === false || item.included_by_default === 0 ? 'optional' : 'included';
    }),
  }));
}

/** One warning's sentence. The bundle-value one is said in money, not in the Worker's raw cents. */
export function warningSentence(w, currency) {
  if (w?.code === 'bundle_value_warning' && w.detail?.premium_cents != null) {
    const by = money(w.detail.premium_cents, currency);
    if (by !== NOT_RECORDED) return `This package costs more than its programs bought one by one, by ${by}, so it is shown with no discount.`;
  }
  return String(w?.sentence || '');
}

/**
 * One column's price cells. `rec` is that version's entry in the pricing read (matched by key and version), or
 * undefined when no licence is chosen or the read did not price it. `priced` is false while the chosen licence's
 * read is pending or failed. Each cell is `{ text, note? }`: `note` is the
 * Worker's sentence for why a value is missing.
 */
export function priceCells(version, rec, { licenceChosen, priced = licenceChosen }) {
  const base = { text: money(version.base_annual_fee_cents, version.currency) };
  if (!licenceChosen || !priced) {
    const choose = { text: NOT_RECORDED, note: licenceChosen ? 'This licence has no package price: see the line above the table.' : 'Choose a licence to price this package at its market.' };
    return { base, adjusted: choose, standalone: choose, saving: choose, warnings: { text: '—', list: [] } };
  }
  if (!rec) {
    const none = { text: NOT_RECORDED, note: 'The pricing read did not price this version.' };
    return { base, adjusted: none, standalone: none, saving: none, warnings: { text: '—', list: [] } };
  }
  if (rec.available === false) {
    const why = { text: NOT_RECORDED, note: rec.unavailable_reason || 'No price could be worked out.' };
    return { base, adjusted: why, standalone: why, saving: why, warnings: { text: '—', list: [] } };
  }
  const cur = rec.currency || version.currency;
  const list = (rec.warnings || []).map((w) => ({ code: w.code, sentence: warningSentence(w, cur) }));
  const sumWhy = list.find((w) => w.code === 'missing_program_price' || w.code === 'program_price_unavailable')?.sentence
    || (rec.programs?.length ? 'The Worker returned no standalone total.' : 'This version includes no program by default, so there is nothing to compare.');
  const standalone = rec.standalone_sum_cents == null ? { text: NOT_RECORDED, note: sumWhy } : { text: money(rec.standalone_sum_cents, cur) };
  let saving;
  if (rec.bundle_value_warning) {
    saving = { text: 'No saving', note: list.find((w) => w.code === 'bundle_value_warning')?.sentence };
  } else if (rec.bundle_saving_cents == null) {
    saving = { text: NOT_RECORDED, note: sumWhy };
  } else {
    const pct = percentWord(rec.bundle_discount_bps);
    saving = { text: [money(rec.bundle_saving_cents, cur), pct].filter(Boolean).join(' · ') };
  }
  return {
    base,
    adjusted: rec.recommended_annual_fee_cents == null ? { text: NOT_RECORDED, note: 'The Worker returned no country-adjusted price.' } : { text: money(rec.recommended_annual_fee_cents, cur) },
    standalone,
    saving,
    warnings: { text: list.length ? `${list.length} warning${list.length === 1 ? '' : 's'}` : 'None', list },
  };
}

/** The pricing read's entry for a compared version, by key and version. */
export function recFor(pricing, version) {
  return (pricing?.packages || []).find((p) => p.package_key === version.package_key && Number(p.package_version) === Number(version.version));
}

/**
 * Where the prices come from: the licence's country recommendation (its date, whether it is the latest), the
 * pricing model version and the country index.
 */
export function provenance(pricing) {
  if (!pricing) return null;
  const s = pricing.snapshot || {};
  return {
    snapshot: dateWord(s.created_at) || NOT_RECORDED,
    latest: s.latest === true ? 'Latest' : s.latest === false ? 'Not the latest' : NOT_RECORDED,
    model: pricing.model_version != null ? `v${pricing.model_version}` : s.pricing_model_version != null ? `v${s.pricing_model_version}` : NOT_RECORDED,
    index: indexWord(pricing.country_index_ppm),
    indexReason: pricing.country_index_ppm == null ? (pricing.index_reason || null) : null,
  };
}

/** A licence picker label: brand, then reference. */
export function licenceLabel(l) {
  const name = l?.brand_name || l?.licence_ref || l?.uid || NOT_RECORDED;
  return l?.brand_name && l?.licence_ref ? `${l.brand_name} · ${l.licence_ref}` : name;
}

/** Where a catalogue row's Preview pricing goes: the comparison, narrowed to that version. */
export function previewHref(v) {
  const q = new URLSearchParams({ package: v.package_key, version: String(v.version) });
  return `/admin/licences/packages/compare?${q}`;
}
