/**
 * D782 (#2113) — the words for Operating systems' Code system and its sync
 * lines, from the module read's `parts.tools.code` and `parts.tools.syncs`.
 * Pure, so `frontend/test/github_code_system_d782.test.mjs` holds each rule.
 *
 * The Worker decides what a viewer may see: `repositories` is null for anyone
 * outside the company, and these words then give the count, never a name.
 */

/** "acme/app, acme/site", or "2 repositories" when the names are not the viewer's to see. */
export function repositoriesText(system) {
  const total = Number.isSafeInteger(system?.repositories_total) ? system.repositories_total : 0;
  if (Array.isArray(system?.repositories)) return system.repositories.length ? system.repositories.join(', ') : 'No repository chosen yet';
  return total === 1 ? '1 repository' : `${total} repositories`;
}

/** Each fed module with its count, for a link each; an empty list reads as nothing yet. */
export function feedsOf(system) {
  return (Array.isArray(system?.feeds) ? system.feeds : [])
    .filter((f) => f && typeof f.label === 'string' && Number.isSafeInteger(f.count) && f.count > 0)
    .map((f) => ({ label: f.label, href: typeof f.href === 'string' && f.href.startsWith('/') ? f.href : null, text: `${f.label} · ${f.count}` }));
}

/** D8774: the venture-scope state the Worker resolves for each connection (`services/connectorBinding.ts`), in words. */
export const BINDING_WORD = Object.freeze({
  no_company: 'Not in a company', company_off: 'Not on for this company', no_repo: 'No repository chosen', other_venture: 'Feeds another venture',
  failing: 'Failing', not_read: 'Not read yet', stale: 'Stale', no_items: 'No items', healthy: 'Healthy',
});

/**
 * D8774 (BLS04, BLS05, BLS09): what a Code system says about THIS venture.
 * `feedsHeading` is "Feeds" only while every scope holds (`effective`);
 * otherwise what is listed arrived earlier and is said so. The last successful
 * read names its date and source; Stale gives its age. Null for a read from
 * before D8774, which carries no binding.
 */
export function bindingView(system) {
  const b = system?.binding;
  if (!b || typeof b !== 'object' || !Object.hasOwn(BINDING_WORD, b.state)) return null;
  const read = b.last_good_read && typeof b.last_good_read.at === 'string' ? b.last_good_read : null;
  const repos = read && Array.isArray(read.repositories) && read.repositories.length ? ` · ${read.repositories.join(', ')}` : '';
  const after = Array.isArray(b.feeds_after_sync) ? b.feeds_after_sync.filter((x) => typeof x === 'string') : [];
  return {
    state: b.state,
    word: BINDING_WORD[b.state],
    effective: b.effective === true,
    feedsHeading: b.effective === true ? 'Feeds' : 'Arrived earlier',
    lastRead: read ? `Last successful read of this venture: ${read.at} · ${read.source || 'Not recorded'}${read.partial ? ' (partly synced)' : ''}${repos}` : 'Last successful read of this venture: none recorded',
    stale: b.stale && Number.isSafeInteger(b.stale.hours) ? `Stale · ${b.stale.hours} h since the last good read` : b.stale ? 'Stale · no good read recorded' : null,
    after: !b.effective && after.length ? `After a sync it will feed: ${after.join(', ')}` : null,
    reason: typeof b.reason === 'string' && b.reason ? b.reason : null,
  };
}

/** D8774: the viewer's own GitHub at account scope when none is on for the company, or the venture has none. */
export function accountOnlyText(code) {
  const a = code?.account;
  if (!a || typeof a !== 'object') return null;
  const state = a.state === 'failing' ? 'connected, its last sync failed' : a.state === 'disconnected' ? 'connected but needs reconnecting' : 'connected';
  return `${a.provider || 'GitHub'} is ${state} on your account. It feeds nothing in this venture until it is turned on for the venture’s company and has repositories chosen.`;
}

const SYNC_STATE = { done: 'Synced', partial: 'Partly synced', failed: 'Failed' };

/** One sync line: when, its state, what arrived (or the failure's words) and the repositories it read. */
export function syncLineView(line) {
  const state = SYNC_STATE[line?.state] ?? 'Not recorded';
  const repos = Array.isArray(line?.repositories) && line.repositories.length
    ? `${line.repositories.join(', ')}${Number.isSafeInteger(line.repositories_more) && line.repositories_more > 0 ? ` and ${line.repositories_more} more` : ''}`
    : null;
  return {
    at: typeof line?.at === 'string' ? line.at : null,
    state,
    failed: line?.state === 'failed',
    text: line?.state === 'failed' ? (line?.error || 'The sync did not complete.') : (line?.text || 'Not recorded'),
    repositories: repos,
  };
}
