/**
 * D1086 (#2951, #2405 part 2) — the words and small rules the Notion pages
 * share: the connector page's Sources list and Add a source dialog, and each
 * module's From Notion section (`pages/cycles/FromNotion.jsx`).
 *
 * `NOTION_MODULES` mirrors the Worker's `services/notion/modules.ts` (key,
 * section, label, the source kinds it takes); a test holds the two together.
 * What a database's properties may map to is read from the Worker
 * (`GET /sources/:uid/schema`), never copied here.
 *
 * Nothing here draws a zero for a missing value: a source never read says
 * "Not read yet", a missing date says "Not recorded".
 */

export const NOTION_MODULES = Object.freeze([
  { key: 'customer_research', section: 'validate', label: 'Customer research', kinds: ['page', 'page_tree', 'database'] },
  { key: 'market_intelligence', section: 'validate', label: 'Market intelligence', kinds: ['page_tree'] },
  { key: 'product_roadmap', section: 'build', label: 'Product roadmap', kinds: ['database'] },
  { key: 'prototype_mvp', section: 'build', label: 'Prototype / MVP', kinds: ['database'] },
  { key: 'solution_design', section: 'build', label: 'Solution design', kinds: ['page', 'page_tree'] },
  { key: 'capital_relationships', section: 'raise', label: 'Capital relationships', kinds: ['database'] },
  { key: 'data_room', section: 'raise', label: 'Data room', kinds: ['page', 'page_tree'] },
  { key: 'distribution', section: 'grow', label: 'Distribution', kinds: ['database'] },
  { key: 'product_improvement', section: 'grow', label: 'Product improvement', kinds: ['database'] },
]);

export const moduleOf = (key) => NOTION_MODULES.find((m) => m.key === key) || null;

const KIND_LABEL = { page: 'Page', page_tree: 'Page and its sub-pages', database: 'Database' };
export const kindLabel = (kind) => KIND_LABEL[kind] || 'Page';

/**
 * The kind a search result is added as, for this module: a database result is
 * a database; a page is a page tree when the module only takes trees, else a
 * page. Null when the module cannot take it.
 */
export function kindFor(module, result) {
  const m = moduleOf(module);
  if (!m || !result) return null;
  if (result.kind === 'data_source' || result.kind === 'database') return m.kinds.includes('database') ? 'database' : null;
  if (m.kinds.includes('page')) return 'page';
  if (m.kinds.includes('page_tree')) return 'page_tree';
  return null;
}

/** "2026-10-21", from an ISO time; null when there is none or it is not a date. */
export function day(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : null;
}

/** "Rows 4, 9 and 13". */
export function rowList(rows) {
  const n = (Array.isArray(rows) ? rows : []).filter((x) => Number.isFinite(Number(x))).map(String);
  if (!n.length) return '';
  if (n.length === 1) return `Row ${n[0]}`;
  return `Rows ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A field's label from the schema read's `fields`, or the key. */
const labelOf = (fields, key) => (Array.isArray(fields) ? fields.find((f) => f.key === key)?.label : null) || key;

/**
 * Why rows were skipped, in the canvas's words. `skipped` is the Worker's
 * `[{ reason, field, rows }]`: on a preview `rows` is the row numbers, on a
 * sync it is how many.
 */
export function skippedSentence(s, fields, title) {
  const field = labelOf(fields, s.field);
  const many = Array.isArray(s.rows) ? s.rows.length : Number(s.rows) || 0;
  const which = Array.isArray(s.rows) ? rowList(s.rows) : plural(many, 'row');
  const where = title ? ` in “${title}”` : '';
  if (s.reason === 'empty_required') return `${which}${where} ${many === 1 ? 'has' : 'have'} an empty ${field} cell, so ${many === 1 ? 'it was' : 'they were'} not read.`;
  if (s.reason === 'bad_value') return `${which}${where} ${many === 1 ? 'has a' : 'have a'} ${field} that could not be read, so ${many === 1 ? 'it was' : 'they were'} not read.`;
  if (s.reason === 'not_mapped') return `“${title || 'This database'}” has no mapping yet, so no row was read. Map its properties on the Notion page.`;
  return `${which}${where} could not be read.`;
}

/** The preview's error line for a field: "The Date property has 3 rows that are not dates. They will be skipped." */
export function previewWarning(s, fields, map) {
  const f = Array.isArray(fields) ? fields.find((x) => x.key === s.field) : null;
  const property = map?.fields?.[s.field]?.property || f?.label || s.field;
  const n = Array.isArray(s.rows) ? s.rows.length : 0;
  if (s.reason === 'bad_value') {
    const what = f?.type === 'date' ? 'dates' : f?.type === 'number' ? 'numbers' : 'readable';
    return `The ${property} property has ${plural(n, 'row')} that ${n === 1 ? 'is' : 'are'} not ${what === 'readable' ? 'readable' : what}. ${n === 1 ? 'It' : 'They'} will be skipped.`;
  }
  return `The ${property} property is empty in ${plural(n, 'row')}. ${n === 1 ? 'It' : 'They'} will be skipped.`;
}

/** A source's Last read cell: when, and how it went. */
export function lastRead(source) {
  const when = day(source?.last_synced_at);
  if (!when) return { text: 'Not read yet', tone: 'muted' };
  if (source.last_result === 'unreadable') return { text: `${when} · Could not be read`, tone: 'bad' };
  if (source.last_result === 'partial') return { text: `${when} · Partly read`, tone: 'warn' };
  return { text: when, tone: 'ok' };
}

/** The connector page's count line: "6 pages · 2 ventures". */
export function sourcesCount(items) {
  const list = Array.isArray(items) ? items : [];
  const ventures = new Set(list.map((s) => s.project_id)).size;
  return `${plural(list.length, 'page')} · ${plural(ventures, 'venture')}`;
}

/** What a sync did, as one sentence; counts only. */
export function syncSummary(result) {
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  if (!sources.length) return 'No Notion source is chosen for this section yet.';
  const sum = (k) => sources.reduce((n, s) => n + (Number(s.counts?.[k]) || 0), 0);
  const parts = [];
  const added = sum('written'); const updated = sum('updated'); const proposed = sum('proposed') + sum('reproposed');
  if (added) parts.push(`${plural(added, 'row')} added`);
  if (updated) parts.push(`${plural(updated, 'row')} updated`);
  if (proposed) parts.push(`${plural(proposed, 'item')} to review`);
  const head = parts.length ? `${parts.join(', ')}.` : 'Nothing new in Notion.';
  const bad = sources.filter((s) => s.result === 'unreadable').length;
  return bad ? `${head} ${plural(bad, 'source')} could not be read.` : head;
}

/** The value a fact's cell draws: an empty one is a dash with its reason, never a zero. */
export function cellText(v) {
  if (v == null || v === '') return null;
  return String(v);
}

/** A failed call's sentence: the Worker's `detail` when it sent one, else a plain one. */
export function errorSentence(e, fallback = 'Notion could not be read. Try again.') {
  const d = e?.data?.detail || (e?.status ? e.message : null);
  return typeof d === 'string' && d.length < 200 ? d : fallback;
}
