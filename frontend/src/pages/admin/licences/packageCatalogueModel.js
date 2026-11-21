/**
 * D5896 (#5896) — the Axal VC package catalogue's rules (board L29), pure so the tests read them without a page.
 *
 * Input is the catalogue read with `?all=1` (every version of every package key, D5022). The table lists, per
 * key, the version in force (Active) and any Draft above it; a key with neither lists its newest version, so a
 * retired package does not vanish. A status is the store's own word, never inferred: the seed's draft v1 reads
 * Draft. Money is the version's own currency through `lib/money.js`; a figure that is null or cannot be
 * formatted reads "Not recorded", never 0.
 *
 * Standalone sum and Bundle saving are per licence (`services/packagePricing.ts`, priced at a licence's market);
 * the catalogue read does not return them, so their cells read Not recorded and say why (D5896 §3). Nothing
 * here sums program prices.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { formatMinor } from '../../../lib/money.js';
import { dateWord } from '../licenceRegistryModel.js';

export { NOT_RECORDED };

export const STATUS_WORDS = Object.freeze({ draft: 'Draft', active: 'Active', retired: 'Retired' });

/** The table's columns, in L29's order. The row actions (Edit draft, Publish, Preview pricing, Retire) are part 1 (b) and (c). */
export const CATALOGUE_COLUMNS = Object.freeze([
  'Axal VC package', 'Version', 'Status', 'Programs', 'Global base annual fee', 'Guidance range', 'Standalone sum', 'Bundle saving', 'Effective',
]);

export const PER_LICENCE_REASON = 'Priced per licence, at its market: the catalogue does not hold it.';

const RANK = { active: 0, draft: 1, retired: 2 };

export function statusWord(status) {
  return STATUS_WORDS[status] || NOT_RECORDED;
}

export function money(cents, currency) {
  if (cents === null || cents === undefined) return NOT_RECORDED;
  return formatMinor(cents, currency, { locale: 'en-GB', trimWhole: true }) ?? NOT_RECORDED;
}

/** "€8,000 – €12,000"; Not recorded unless both ends are recorded. */
export function guidanceRange(v) {
  if (v?.guidance_min_cents == null || v?.guidance_max_cents == null) return NOT_RECORDED;
  const lo = money(v.guidance_min_cents, v.currency), hi = money(v.guidance_max_cents, v.currency);
  return lo === NOT_RECORDED || hi === NOT_RECORDED ? NOT_RECORDED : `${lo} – ${hi}`;
}

/** A draft is not in force, whatever date it carries; an active or retired version reads its own dates. */
export function effectiveWord(v) {
  if (!v || v.status === 'draft') return 'Not in force';
  const from = dateWord(v.effective_from);
  if (!from) return NOT_RECORDED;
  return v.effective_to ? `${from} – ${dateWord(v.effective_to)}` : from;
}

/**
 * The catalogue's rows from every version. Per key: the active version and the drafts above it, or, with neither,
 * the newest version. Ordered Active, then Draft, then Retired, each by name then version.
 */
export function catalogueRows(versions) {
  const byKey = new Map();
  for (const v of versions || []) {
    if (!byKey.has(v.package_key)) byKey.set(v.package_key, []);
    byKey.get(v.package_key).push(v);
  }
  const rows = [];
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => b.version - a.version);
    const active = sorted.find((v) => v.status === 'active');
    const shown = sorted.filter((v) => v.status === 'active' || (v.status === 'draft' && (!active || v.version > active.version)));
    rows.push(...(shown.length ? shown : [sorted[0]]));
  }
  return rows.sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3)
    || String(a.name).localeCompare(String(b.name)) || a.version - b.version);
}

/**
 * One row's cells. `detail` is that version's read with its items: `{ state: 'ready', items }`,
 * `{ state: 'error' }` or `{ state: 'loading' }`. A failed detail makes only its Programs cell Unreadable.
 */
export function rowCells(v, detail) {
  const programs = detail?.state === 'ready' ? String(detail.items.length)
    : detail?.state === 'error' ? 'Unreadable' : '…';
  return {
    name: v.name,
    version: `v${v.version}`,
    status: statusWord(v.status),
    programs,
    base: money(v.base_annual_fee_cents, v.currency),
    guidance: guidanceRange(v),
    standalone: NOT_RECORDED,
    saving: NOT_RECORDED,
    effective: effectiveWord(v),
  };
}

/** The history card's lines, newest first, whatever order the read sent. */
export function historyRows(versions) {
  return [...(versions || [])].sort((a, b) => b.version - a.version).map((v) => ({
    key: `${v.package_key}:${v.version}`,
    version: `v${v.version}`,
    status: statusWord(v.status),
    effective: effectiveWord(v),
    created: dateWord(v.created_at) || NOT_RECORDED,
  }));
}

/** A version's programs as listed, by key in the version's own order. */
export function programList(items) {
  return [...(items || [])].sort((a, b) => a.position - b.position).map((i) => i.program_key).join(', ');
}
