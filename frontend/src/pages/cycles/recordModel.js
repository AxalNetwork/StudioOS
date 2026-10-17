/**
 * D696: pure record rules. No reads, route registration or dialogs.
 * Record routes use the same id rule as the cycle shell.
 */
import { CYCLES, TONES, safeHref } from './cycleModel.js';
import { exportPersonaPdf } from '../../lib/personaPdf.js';
import { exportDecisionMemoPdf } from '../../lib/decisionMemoPdf.js';

import { RECORD_ID } from './cyclePaths.js';
import { editFieldsFor } from './forms.js';
export { RECORD_ID };
const slug = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const sectionId = (cycleName, moduleName, title) => 'rec-' + slug(cycleName + ' ' + moduleName + ' ' + title);

export function toneOf(tone) {
  const mapped = tone === 'vio' ? 'v1' : tone === 'amb' ? 'warn' : tone;
  return TONES.includes(mapped) ? mapped : null;
}

export function recordId(row) {
  const id = row && Object.hasOwn(row, 'recordId') ? row.recordId : row?.id;
  return id == null ? null : String(id);
}

export function rowLinks(records, row) {
  const id = recordId(row);
  return records?.linkable === true && id !== null && id !== 'new' && RECORD_ID.test(id);
}

export function recordHref(cycle, moduleSlug, id, search = '') {
  const value = id == null ? '' : String(id);
  if (!Object.hasOwn(CYCLES, cycle) || !RECORD_ID.test(moduleSlug ?? '') || !RECORD_ID.test(value) || value === 'new') return null;
  const query = typeof search === 'string' && search.startsWith('?') ? search.split('#')[0] : '';
  return '/' + cycle + '/' + encodeURIComponent(moduleSlug) + '/' + encodeURIComponent(value) + query;
}

/** Reject browser URL normalization to an off-site path as well as // URLs. */
export function recordLink(href) {
  return typeof href === 'string' && !/[\\\u0000-\u001f\u007f]/.test(href) ? safeHref(href) : null;
}

export const CLIENT_ACTIONS = new Map([
  ['export-persona', (record) => exportPersonaPdf(record)],
  // D693 decision 11: the decision memo, a one-page PDF drawn in the browser.
  ['export-memo', (record) => exportDecisionMemoPdf(record)],
]);

export function dispatchOf(action) {
  if (!action || typeof action.key !== 'string') return null;
  if (CLIENT_ACTIONS.has(action.key)) return 'client';
  if (action.kind === 'link') {
    if (recordLink(action.href)) return 'link';
    if (typeof action.href === 'string' && /^mailto:[^\s]+$/i.test(action.href)) return 'mailto';
    return null;
  }
  if (action.kind === 'form' || action.kind === 'write') return action.kind;
  return null;
}

export function rowView(row = {}) {
  return { a: row.a ?? '', b: row.b ?? '', c: row.c ?? '', tone: toneOf(row.tone), href: recordLink(row.href), action: row.action };
}

export function pillView(pill) {
  if (typeof pill === 'string') return { text: pill, tone: null };
  return { text: pill?.text ?? pill?.label ?? pill?.t ?? '', tone: toneOf(pill?.tone ?? pill?.s) };
}

/** Section actions are declarations too; row payloads may supply only body. */
export function declaredActions(record) {
  const map = new Map();
  for (const action of [...(record?.actions ?? []), ...[...(record?.main ?? []), ...(record?.side ?? [])].map((section) => section.action)]) {
    if (action && typeof action === 'object' && typeof action.key === 'string' && !map.has(action.key)) map.set(action.key, action);
  }
  return map;
}

export function rowAction(reference, declarations) {
  const key = typeof reference === 'string' ? reference : reference?.key;
  const action = declarations.get(key);
  if (!action || !dispatchOf(action)) return null;
  return reference && typeof reference === 'object' && Object.hasOwn(reference, 'body') ? { ...action, body: reference.body } : action;
}

/**
 * PR 2's write completion: all effects injected. Download writes never re-read.
 * An open without url belongs to the customer-research parts view (#1659).
 */
export async function finishRecordWrite(result, { open, onError, reread }) {
  if (result?.open && Object.hasOwn(result.open, 'url')) {
    const url = result.open.url;
    if (recordLink(url) && url.startsWith('/api/files/dl/')) {
      open(url, '_blank', 'noopener,noreferrer');
      return 'opened';
    }
    onError('That file could not be opened.');
    return 'refused';
  }
  if (result?.open) return 'parts';
  await reread();
  return 'saved';
}

/** Map the Worker's form fields to the existing Add/Edit renderer once. */
export function recordFormFor(action, record, edit) {
  if (action?.kind !== 'form') return null;
  const fields = (action.form?.fields ?? []).map(field => ({ ...field, name: field.key ?? field.name }));
  const current = Object.fromEntries(fields.filter(field => Object.hasOwn(field, 'value')).map(field => [field.name, field.value]));
  if (action.key === 'edit') {
    const row = { id: record.id, edit: { id: record.id, uid: record.uid ?? record.id } };
    const id = edit?.idOf(row);
    if (id == null) return null;
    // D695 (#1656): an Edit that reads its record (Validate's) takes the values
    // through its own `valuesOf`, as a row's `edit`, and draws only the fields
    // those values carry, so a save never blanks a value it did not show.
    if (edit.readsRecord) {
      const values = edit.valuesOf({ ...row, edit: { ...current, ...row.edit } });
      return { form: editFieldsFor(edit, values), current: values, id };
    }
    return { form: edit, current, id };
  }
  return action.form ? { form: { ...action.form, fields }, current, id: record.id } : null;
}

export function confirmView(action) {
  if (!action?.confirm) return null;
  return typeof action.confirm === 'string'
    ? { title: action.label, body: action.confirm, cta: action.label }
    : { title: action.confirm.title, body: action.confirm.body, cta: action.confirm.cta || action.label };
}

/** Retain the declared row body when adding form values, including real File bytes. */
export function recordActionBody(action, values = {}) {
  const body = { ...(action.body ?? {}), ...values };
  if (!action.multipart && !action.form?.fields?.some(field => field.input === 'file')) return body;
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (value == null) continue;
    form.append(key, value instanceof Blob ? value : Array.isArray(value) ? JSON.stringify(value) : String(value));
  }
  return form;
}

/** The record's own Edit action, from a record read, or null. */
export const recordEditAction = (record) => (record?.actions ?? []).find((action) => action?.key === 'edit' && action.kind === 'form') ?? null;

/** Hide forms with no saving path, including an Edit with no registered store id. */
export function availableRecord(record, edit) {
  const declarations = declaredActions(record);
  const canRun = action => dispatchOf(action) && (action.kind !== 'form' || recordFormFor(action, record, edit));
  const sections = list => (list ?? []).map(section => ({ ...section,
    action: canRun(rowAction(section.action, declarations)) ? section.action : undefined,
    rows: (section.rows ?? []).map(row => ({ ...row,
      action: canRun(rowAction(row.action, declarations)) ? row.action : undefined,
    })),
  }));
  return { ...record, actions: (record.actions ?? []).filter(canRun), main: sections(record.main), side: sections(record.side) };
}
