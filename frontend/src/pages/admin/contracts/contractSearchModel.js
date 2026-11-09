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
  if (r?.type === 'template') return { kind: 'tab', tab: 'templates', filters: { open: r.template?.slug } };
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
