// D717 (#1782) decisions 3 and 4 — the Templates tab's catalog rules, pure.
//
// Each row is one item of `GET /api/admin/contracts/templates/store?recorded=true`.
// This returns states, counts and flags; the words a card prints are the
// screen's (PR 2), because the final export wins on copy.
//
// States: `stub` (is_stub, or an empty body) · `has_body` (a body and no
// publication) · `published` (a recorded publication). `changesNotPublished`
// is shown beside `published` when the row has moved on since.

/** The layers in the tab's order (AdminTemplates.jsx's CATEGORY_ORDER). */
export const LAYER_ORDER = Object.freeze(['gp', 'fund', 'portfolio', 'compliance']);

/** The state filter's values, in the order the filter offers them. */
export const STATE_FILTERS = Object.freeze(['all', 'has_body', 'stub', 'unpublished', 'published']);

/**
 * The kind filter (#1854): `'all'`, then the Worker's TEMPLATE_KINDS
 * (`services/templateFormat.ts`) in its order. A test reads that list back.
 */
export const KIND_FILTERS = Object.freeze(['all', 'agreement', 'corporate', 'resolution', 'unilateral', 'policy', 'notice', 'booklet']);

export function isStub(row) {
  return !!row?.is_stub || !String(row?.body_md ?? '').trim();
}

export function templateState(row) {
  const stub = isStub(row);
  const publishedVersion = Number.isInteger(row?.published_version) ? row.published_version : null;
  // "Published v[N]" replaces "Has a body", never "Stub": a published template
  // whose body is gone is a stub that keeps its publication (Withdraw).
  const state = stub ? 'stub' : publishedVersion != null ? 'published' : 'has_body';
  return {
    state,
    stub,
    publishedVersion,
    changesNotPublished: publishedVersion != null && !!row?.has_unpublished_changes,
    // Decision 4: a stub card offers Add body; every other card offers Open.
    action: stub ? 'add_body' : 'open',
  };
}

/** Whether a row passes one state filter (decision 3). */
export function matchesStateFilter(row, filter) {
  switch (filter) {
    case 'all': return true;
    case 'has_body': return !isStub(row);
    case 'stub': return isStub(row);
    case 'unpublished': return !!row?.has_unpublished_changes;
    case 'published': return Number.isInteger(row?.published_version);
    default: throw new RangeError(`Unknown state filter: ${filter}`);
  }
}

function matchesQuery(row, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  return [row?.title, row?.slug].some((v) => String(v || '').toLowerCase().includes(needle));
}

/** The rows that pass search, the layer filter (`'all'` or a layer key), the state filter and the kind filter. */
export function filterCatalog(rows, { q = '', layer = 'all', state = 'all', kind = 'all' } = {}) {
  return (rows || []).filter((row) =>
    matchesQuery(row, q) && (layer === 'all' || row?.layer === layer) && matchesStateFilter(row, state)
    && (kind === 'all' || row?.kind === kind));
}

/** How many of the three filters are not on `'all'` ("Filters · n"). */
export function activeFilterCount({ layer = 'all', state = 'all', kind = 'all' } = {}) {
  return [layer, state, kind].filter((v) => v !== 'all').length;
}

/**
 * The rows grouped into layer sections, in the tab's order, each with its
 * count. A layer outside LAYER_ORDER follows, in the order first seen; a
 * section with no rows is left out.
 */
export function layerSections(rows) {
  const byLayer = new Map();
  for (const row of rows || []) {
    const key = row?.layer ?? row?.category ?? 'other';
    if (!byLayer.has(key)) byLayer.set(key, { layer: key, label: row?.layer_label || key, rows: [] });
    byLayer.get(key).rows.push(row);
  }
  const known = LAYER_ORDER.filter((k) => byLayer.has(k));
  const rest = [...byLayer.keys()].filter((k) => !LAYER_ORDER.includes(k));
  return [...known, ...rest].map((k) => ({ ...byLayer.get(k), count: byLayer.get(k).rows.length }));
}

/** How many rows each state filter would show, for the filter's counts. */
export function stateCounts(rows) {
  return Object.fromEntries(STATE_FILTERS.map((f) => [f, (rows || []).filter((r) => matchesStateFilter(r, f)).length]));
}
