/**
 * D4708 part 3 (#4708) — the HQ Security page's shared values and formatters, moved out of
 * `../SecurityPage.jsx` unchanged: the unreadable sentinel, the Events filter defaults, the
 * absent-is-not-zero formatters, the actor identity line and the support-session tile note.
 * `../SecurityPage.jsx` re-exports every name, so its importers are unchanged.
 */
export const UNAVAILABLE = Symbol('unavailable');

export const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);
// A number, formatted — or null when there is no number. Never a default.
export const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
export const titleCase = (s) => String(s || '').replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());

/** D4803 — the Events filter bar, untouched: exactly the read the ledger always made. */
export const EMPTY_CONTROLS = Object.freeze({ q: '', range: 'any', custom: {}, actor: '', outcome: '', source: '' });

/**
 * D4691 — every actor on this page arrives in one shape (`actor_identity`,
 * services/securityIdentity.ts) and is drawn with its kind, so a support
 * operator never reads as the account holder, a refused attempt never reads
 * as the account it named, and an act with no account reads as the platform
 * rather than as a blank.
 */
export const IDENTITY_KIND_LABEL = {
  user: 'account',
  support: 'support',
  system: 'system',
  network: 'network',
};
export function identityLine(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const kind = IDENTITY_KIND_LABEL[identity.kind] || 'unknown';
  const behalf = identity.kind === 'support' && identity.on_behalf_of ? ` for ${identity.on_behalf_of.label}` : '';
  return { kind, text: `${identity.label}${behalf}` };
}

/**
 * D4691 — the "Live support sessions" tile's note. `active` is the shared rule's
 * `live`, the same rows the Sessions zone offers to End; an open record past
 * its limit is counted apart, by name, never as live and never dropped.
 */
export function impersonationNote(imp) {
  const nc = Number.isFinite(Number(imp?.not_closed)) ? Number(imp.not_closed) : 0;
  return nc > 0
    ? `token could still be valid · ${nc.toLocaleString()} open record${nc === 1 ? '' : 's'} past the limit, not live`
    : 'token could still be valid';
}
