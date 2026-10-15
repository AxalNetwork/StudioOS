/**
 * D696 PR 1: pure record rules. No reads, route registration or dialogs.
 * PR 2 replaces the local id pattern with cyclePaths.RECORD_ID.
 */
import { CYCLES, TONES, safeHref } from './cycleModel.js';
import { exportPersonaPdf } from '../../lib/personaPdf.js';

export const RECORD_ID = /^[a-z0-9][a-z0-9_-]*$/;
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
