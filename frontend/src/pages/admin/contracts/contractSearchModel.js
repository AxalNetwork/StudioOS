/**
 * D4811 (#4811) part 4 — the cross-object search's pure rules (board CT-13):
 * how one result reads (object tag, lifecycle badge, overlays, version line)
 * and where it opens. The Worker ranks and filters
 * (`cloudflare-worker/src/services/contractSearch.ts`); nothing here fetches.
 */
import { agreementLifecycle, governanceLifecycle, templateLifecycle, templateOverlays } from '../../../lib/contractLifecycle';

export const SEARCH_DEBOUNCE_MS = 250;
export const OBJECT_TAGS = Object.freeze({ template: 'Template', agreement: 'Agreement', governance: 'Governance' });
const STORE_NAMES = Object.freeze({ template: 'Templates', agreement: 'Agreements', governance: 'Governance records' });

/** The result's lifecycle badge, in its own object's vocabulary; null when the stored state is unknown. */
export function resultBadge(r) {
  if (r?.type === 'template') {
    return templateLifecycle({ is_active: r.template?.is_active, published_version: r.template?.published_version, safety: r.template?.safety },
      { version: r.historical ? r.version : undefined });
  }
  if (r?.type === 'agreement') return agreementLifecycle({ status: r.status });
  if (r?.type === 'governance') return governanceLifecycle(r.status);
  return null;
}

/** Restricted and Incomplete, for a template result; none otherwise. */
export function resultOverlays(r) {
  if (r?.type !== 'template') return [];
  const o = templateOverlays({ safety: r.template?.safety });
  return [o.restricted && 'restricted', o.incomplete && 'incomplete'].filter(Boolean);
}

/** "v3", "v1 · Historical", or null for an object with no versions here. */
export function versionLine(r) {
  if (r?.version == null) return r?.type === 'governance' ? 'No file yet' : null;
  return r.historical ? `v${r.version} · Historical` : `v${r.version}`;
}

/** Where a result opens: a Contracts tab with its record, an agreement's panel, or a governance entity. */
export function resultTarget(r) {
  // D4811 part 10: a template opens its workspace; the editor is one press away there ("Edit in editor").
  if (r?.type === 'template') return r.template?.slug ? { kind: 'path', to: `/admin/contracts/templates/doc/${encodeURIComponent(r.template.slug)}` } : { kind: 'tab', tab: 'templates' };
  if (r?.type === 'agreement') {
    if (['licence_agreement', 'licence_contract'].includes(r.agreement?.source) || !r.agreement?.uid) return { kind: 'tab', tab: 'agreements', filters: { q: r.title } };
    return { kind: 'agreement', uid: r.agreement.uid, title: r.title };
  }
  if (r?.type === 'governance') return { kind: 'path', to: `/admin/contracts/governance?entity=${encodeURIComponent(r.governance?.entity_key || '')}` };
  return null;
}

/** The live line under the box: the count, what was searched, and what the answer leaves out. */
export function summaryLine(data) {
  if (!data) return '';
  const shown = data.items?.length ?? 0;
  const parts = [`${data.total} ${data.total === 1 ? 'result' : 'results'}${data.total > shown ? `, first ${shown} shown` : ''}`,
    data.historical ? 'historical versions included' : 'current versions only'];
  if (data.hidden_historical > 0) parts.push(`${data.hidden_historical} historical ${data.hidden_historical === 1 ? 'version' : 'versions'} hidden`);
  if (data.governance_scope === 'branch') parts.push('governance is kept at HQ');
  for (const store of data.unreadable || []) parts.push(`${STORE_NAMES[store] || store} could not be read`);
  return parts.join(' · ');
}

/*
 * D4811 part 10 — the filter row (board CT-13, CT-92 "Search"): object type,
 * lifecycle state, entity or company, and when it was last updated. They
 * narrow the results the Worker returned (at most 50, ranked); the summary
 * says so. Jurisdiction and review state are not stored (questions A and C),
 * so they are not offered as filters.
 */
export const UPDATED_WINDOWS = Object.freeze([['any', 'Any time', null], ['30', 'Last 30 days', 30], ['90', 'Last 90 days', 90], ['365', 'Last 12 months', 365]]);
export const EMPTY_FILTERS = Object.freeze({ type: 'all', state: 'all', context: 'all', updated: 'any' });
const NO_CONTEXT = '__none__';

/** The choices each filter offers, from the results themselves: only what is present, in a stable order. */
export function filterOptions(items = []) {
  const types = ['template', 'agreement', 'governance'].filter((t) => items.some((r) => r.type === t));
  const states = [...new Set(items.map((r) => resultBadge(r)?.label || 'State not recorded'))].sort();
  const contexts = [...new Set(items.map((r) => r.context || NO_CONTEXT))].sort((a, b) => (a === NO_CONTEXT) - (b === NO_CONTEXT) || a.localeCompare(b));
  return {
    types: types.map((t) => [t, OBJECT_TAGS[t]]),
    states: states.map((s) => [s, s]),
    contexts: contexts.map((c) => [c, c === NO_CONTEXT ? 'No entity or company recorded' : c]),
  };
}

/** The results that pass the filters. An unknown update date never passes a time window: unknown is not recent. */
export function applyFilters(items = [], f = EMPTY_FILTERS, now = Date.now()) {
  const days = UPDATED_WINDOWS.find(([k]) => k === f.updated)?.[2] ?? null;
  return items.filter((r) => {
    if (f.type !== 'all' && r.type !== f.type) return false;
    if (f.state !== 'all' && (resultBadge(r)?.label || 'State not recorded') !== f.state) return false;
    if (f.context !== 'all' && (r.context || NO_CONTEXT) !== f.context) return false;
    if (days != null) {
      const t = Date.parse(String(r.updated_at || '').replace(' ', 'T'));
      if (!Number.isFinite(t) || now - t > days * 86400000) return false;
    }
    return true;
  });
}

/** How many filters are set, for the "Clear filters" control and the summary. */
export const activeFilterCount = (f = EMPTY_FILTERS) => Object.keys(EMPTY_FILTERS).filter((k) => f[k] !== EMPTY_FILTERS[k]).length;
