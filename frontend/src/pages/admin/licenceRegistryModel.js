/**
 * D5060 (#5060, part 3) — the Licences registry by family (Licences and Contracts v2 addendum, board L36) and the
 * type-aware user licence detail (boards L37 and L37B), as pure functions over the Worker's registry reads
 * (`/api/admin/licence-registry`, D5060 §1–§2). The page and its tests read these.
 *
 * Every cell is one state:
 *   - `value`: what the read recorded;
 *   - `none`: the read succeeded and there is nothing (an agreement never sent, no attention item);
 *   - `not_recorded`: the store is not on this database, with the Worker's reason;
 *   - `unreadable`: the read failed; never shown as none or zero;
 *   - `not_applicable`: a field the licence family does not have (a user licence's scope / territory). Its cell
 *     is left empty and screen readers hear "Not applicable", never "Not recorded" (board L36's note);
 *   - `not_on_ledger`: the ledger read does not expand it (a user licence's programs); the licence opens it.
 */

/** The family chips (board L36), in its order. `key` is the Worker's `family` filter. */
export const FAMILIES = Object.freeze([
  { key: 'all', label: 'All' },
  { key: 'operator', label: 'Operator / territory' },
  { key: 'founder', label: 'Founder' },
  { key: 'investor', label: 'Investor' },
  { key: 'operating_partner', label: 'Operating Partner' },
  { key: 'advisor', label: 'Advisor' },
]);

/**
 * With no `?family=`, the page opens on Operator / territory: the ledger with Needs HQ, counts, requests and
 * coverage, which the registry read does not carry. The canvas opens on All; D5060-p3 says why this departs.
 */
export const DEFAULT_FAMILY = 'operator';

export function familyFromParam(v) {
  return FAMILIES.some((f) => f.key === v) ? v : DEFAULT_FAMILY;
}

/** The URL value for a family: the default is left out, so the bare address stays the operator ledger. */
export function familyToParam(key) {
  return key === DEFAULT_FAMILY ? null : key;
}

/** A family chip's count from the read's `counts`; null (said as nothing) when the read has none. */
export function familyCount(counts, key) {
  const n = counts ? Number(counts[key]) : NaN;
  return Number.isFinite(n) ? n : null;
}

export const USER_LICENCE_BASE = '/admin/licences/registry/user';
export const userLicencePath = (uid) => `${USER_LICENCE_BASE}/${encodeURIComponent(uid)}`;

/** Where a registry row opens: a user licence's type-aware detail, or the territory licence's own page. */
export function rowHref(row) {
  return row.licence_family === 'user' ? userLicencePath(row.uid) : `/admin/licences/${encodeURIComponent(row.uid)}`;
}

/** A Worker section that is not there: its state and the sentence it gave. Null when the section is recorded. */
export function missing(sec) {
  if (!sec || sec.available !== false) return null;
  return {
    state: sec.state === 'unreadable' ? 'unreadable' : 'not_recorded',
    label: sec.state === 'unreadable' ? 'Unreadable' : 'Not recorded',
    reason: sec.reason || null,
  };
}

/** A licence status in words: `renewal_pending` is "Renewal pending". */
export function statusWord(status) {
  const s = String(status || '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Not recorded';
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** `2027-02-14` as "14 Feb 2027". A value that is not a date is shown as written. */
export function dateWord(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(iso) : DATE.format(d);
}

export function holderCell(row) {
  const h = row.holder || {};
  if (h.name) return { state: 'value', label: h.name, sub: h.type === 'entity' ? 'Entity' : (h.email || null) };
  return { state: 'not_recorded', label: 'Not recorded', reason: h.reason || null };
}

/** Scope / territory: an operator licence's countries; never a user licence's (it has no `territory` key at all). */
export function scopeCell(row) {
  if (row.licence_family === 'user') return { state: 'not_applicable', label: '', aria: 'Not applicable' };
  const gone = missing(row.territory);
  if (gone) return gone;
  const t = row.territory || {};
  if (t.countries_state === 'unreadable') return { state: 'unreadable', label: 'Unreadable', reason: 'The territory countries could not be read.' };
  const countries = Array.isArray(t.countries) ? t.countries : [];
  if (countries.length) return { state: 'value', label: countries.join(', ') };
  return { state: 'none', label: 'No countries' };
}

/** Package / plan: the package agreements on this licence that are not voided or superseded. */
export function packageCell(row) {
  const gone = missing(row.packages);
  if (gone) return gone;
  const items = row.packages?.items || [];
  return items.length ? { state: 'value', label: items.join(', ') } : { state: 'none', label: 'None' };
}

export function renewalCell(row) {
  const r = row.renewal || {};
  if (!r.on) return { state: 'not_recorded', label: 'Not recorded', reason: r.reason || null };
  return { state: 'value', label: r.basis === 'ends_on' ? `Ends ${dateWord(r.on)}` : dateWord(r.on) };
}

/** The primary agreement's legal state. "None on file" is a read that succeeded and found none. */
export function agreementCell(a) {
  const gone = missing(a);
  if (gone) return gone;
  if (!a) return { state: 'not_recorded', label: 'Not recorded', reason: null };
  if (a.state === 'none') return { state: 'none', label: a.state_label || 'None on file', reason: a.reason || null };
  return { state: 'value', label: a.state_label || statusWord(a.state), tone: a.state };
}

/**
 * Programs. An operator licence's program grants, counted by state; a user licence's entitlements are read on its
 * detail (D5059), so its ledger cell is not on the ledger and opens the licence.
 */
export function programsCell(row) {
  if (row.licence_family === 'user') return { state: 'not_on_ledger', label: 'Open the licence to see them' };
  const gone = missing(row.programs);
  if (gone) return gone;
  const items = row.programs?.items || [];
  if (!items.length) return { state: 'none', label: 'None granted' };
  const granted = items.filter((p) => p.state === 'granted').length;
  return { state: 'value', label: granted === items.length ? `${granted} granted` : `${granted} of ${items.length} granted` };
}

export function attentionCell(row) {
  const items = row.attention || [];
  if (!items.length) return { state: 'none', label: 'None' };
  return { state: 'value', label: items.length === 1 ? items[0].label : `${items.length} items`, items };
}

/** The chosen holder filter's chip: `holder` is `user:<id>` or `entity:<id>`. */
export function holderParam(row) {
  const h = row.holder || {};
  return h.type && h.id ? `${h.type}:${h.id}` : null;
}

/** The user licence detail's sections (boards L37, L37B). Billing is left out, not drawn empty, with no terms. */
export function userSections(detail) {
  const billing = detail?.billing && detail.billing.available !== false;
  return [
    { key: 'overview', label: 'Overview' },
    { key: 'programs', label: 'Programs' },
    { key: 'agreement', label: 'Agreement' },
    ...(billing ? [{ key: 'billing', label: 'Billing' }] : []),
    { key: 'history', label: 'History' },
  ];
}

export function sectionFromParam(detail, v) {
  const keys = userSections(detail).map((s) => s.key);
  return keys.includes(v) ? v : 'overview';
}

/** "user licence · held by a person" / "… held by an entity" (board L37's subtitle). */
export function heldBy(overview) {
  return overview?.holder?.type === 'entity' ? 'held by an entity' : 'held by a person';
}

/** One history event in words: the action, the move between statuses and its reason. */
export function historyLine(e) {
  const action = statusWord(e.action);
  const move = e.from_status ? `${statusWord(e.from_status)} → ${statusWord(e.to_status)}` : statusWord(e.to_status);
  return { when: dateWord(e.created_at), action, move, reason: e.reason || null, revision: e.revision };
}

/** The agreement versions, current first, then newest. */
export function agreementVersions(versions) {
  const items = versions?.items || [];
  return [...items].sort((a, b) => (b.is_current ? 1 : 0) - (a.is_current ? 1 : 0)
    || String(b.signed_at || b.sent_at || '').localeCompare(String(a.signed_at || a.sent_at || '')));
}

/** A related package or program agreement's name: its program or package key, and its kind. */
export function relatedName(a) {
  const kind = String(a.agreement_kind || '').replace(/_/g, ' ');
  const what = a.program_key || a.package_key || 'Agreement';
  return `${what} · ${kind}`.trim();
}

/** Contracts opens the same canonical agreement the licence names (D5060 §4), in its agreement workspace. */
export function contractsHref(agreementUid) {
  return `/admin/contracts/agreements/doc/${encodeURIComponent(agreementUid)}`;
}
