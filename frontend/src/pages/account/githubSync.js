/**
 * D686 §5.4 (#1597) — the rules of GitHub's sync view (`Cycle Action.dc.html`,
 * `connect` › `sync`): what a refusal says, how far the sync has read, and the
 * banner a finished sync earns. No React and no fetch.
 *
 * The routes are D655's (`routes/integrations.ts`): `GET` and `PUT
 * /:uid/repositories`, `POST /:uid/sync`, `GET /:uid/sync-status`.
 *
 * D655 follow-up (#1884): the install link and its words, from the GET's
 * `needs_install` and `install_url`. The page keeps a link only in the exact
 * shape the Worker builds; anything else draws none.
 */

/**
 * Each refusal in words. Where the Worker sends a sentence it is printed as
 * sent; these are for the refusals it sends as a code alone.
 */
const SENTENCES = {
  company_not_enabled: 'This connection is not enabled for this project’s company. Turn the company on in the connection’s detail, then choose again.',
  repositories_not_supported: 'Only GitHub chooses repositories.',
  repositories_unreadable: 'GitHub did not list the repositories. Check the connection and try again.',
  project_not_enabled: 'This connection is not enabled for that project’s company, so nothing was saved.',
  grant_unreadable: 'GitHub did not say what it grants. Nothing was saved.',
  repositories_required: 'Choose at least one repository.',
  too_many_repositories: 'That is more repositories than one connection reads. Choose fewer.',
  repository_not_accessible: 'StudioOS cannot reach one of those repositories any more. Choose again.',
  sync_failed: 'The sync did not complete. Check the connection and try again.',
  not_found: 'This connection is not yours, or no longer exists.',
};

/** A refusal's sentence: the Worker's own when it wrote one, else this table's, else the code. */
export function syncRefusal(e) {
  const code = e?.code || '';
  const msg = typeof e?.message === 'string' ? e.message.trim() : '';
  const own = msg && msg !== code && !/^[a-z0-9_]+$/.test(msg) ? msg : '';
  if (own) return own;
  if (code && Object.hasOwn(SENTENCES, code)) return SENTENCES[code];
  return msg || 'GitHub did not answer. Try again.';
}

/** A repository's line: "Private · updated 3 Oct", the date as GitHub gave it (UTC). */
export function repoLine(r) {
  const vis = r?.private ? 'Private' : 'Public';
  const t = Date.parse(r?.updated_at || '');
  if (!Number.isFinite(t)) return `${vis} · last update not recorded`;
  const d = new Date(t);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${vis} · updated ${d.getUTCDate()} ${mon}`;
}

/** The progress to draw: a percentage only when the Worker reports one. */
export function syncProgress(status) {
  const pct = status?.pct;
  return {
    state: status?.state || 'idle',
    pct: typeof pct === 'number' && Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : null,
    reading: typeof status?.reading === 'string' && status.reading ? status.reading : null,
  };
}

/** Whether polling stops: the sync finished or failed. */
export const syncFinished = (status) => status?.state === 'done' || status?.state === 'failed';

const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);

/**
 * The success banner, only from a sync's result (D686 §5.4): GitHub's counts
 * in words, then what was read with no store to land in; another provider's
 * `summary` as given. No result, no banner.
 */
export function successBanner(providerKey, result) {
  if (!result) return null;
  if (providerKey === 'github') {
    const c = result.counts || {};
    const issues = n(c.issues), pulls = n(c.pull_requests), releases = n(c.releases);
    if (issues == null || pulls == null) return typeof result.summary === 'string' && result.summary ? result.summary : null;
    const lines = [`Synced ${issues} ${issues === 1 ? 'issue' : 'issues'} and ${pulls} ${pulls === 1 ? 'pull request' : 'pull requests'}. Product roadmap and Prototype / MVP now show them.`];
    if (releases) lines.push(`${releases} ${releases === 1 ? 'release was' : 'releases were'} read; Product roadmap has no store for them yet.`);
    return lines.join(' ');
  }
  return typeof result.summary === 'string' && result.summary ? result.summary : null;
}

// ───────────────────────────────────────────── the install link (#1884)

/** The App's install page, exactly as the Worker builds it from GITHUB_APP_SLUG (D651's crafted-link rule). */
export const GITHUB_INSTALL_URL = /^https:\/\/github\.com\/apps\/[a-z0-9][a-z0-9-]{0,99}\/installations\/new$/;

/** The install URL when it is that exact shape, else null: no other link is ever drawn. */
export function installHref(v) {
  return typeof v === 'string' && GITHUB_INSTALL_URL.test(v) ? v : null;
}

/**
 * One link to the App's install page, for both states: "Install …" when the
 * Worker found no installation, "Add or remove …" otherwise (GitHub's page
 * offers Configure for an account it is already installed on). Null with no URL.
 */
export function githubLink(read) {
  const href = installHref(read?.installUrl);
  if (!href) return null;
  return { href, label: read?.needsInstall === true ? 'Install the StudioOS app on GitHub' : 'Add or remove repositories on GitHub' };
}

export const EMPTY_REPOS = 'GitHub lists none this installation can read. Add repositories to the StudioOS app in GitHub, then come back.';

/**
 * The "No repository" row's words. Not installed: say so, with the link or
 * without one. Installed with nothing listed, or an older Worker that sends
 * neither field: today's sentence.
 */
export function emptyRepoSentence(read) {
  if (read?.needsInstall !== true) return EMPTY_REPOS;
  return installHref(read?.installUrl)
    ? 'The StudioOS app isn’t installed on your GitHub account or organization yet. Install it on GitHub and choose its repositories there, then press Refresh.'
    : 'The StudioOS app isn’t installed on your GitHub account or organization yet, and its install link isn’t set up on Axal yet.';
}
