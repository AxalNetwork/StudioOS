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
