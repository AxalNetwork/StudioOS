/**
 * D782 (#2112) — the words for Prototype / MVP's "From GitHub" part, from the
 * module read's `parts.github`: each fed must-have's state with its pull
 * request link, and each release's checks. Pure, so
 * `frontend/test/github_mvp_d782.test.mjs` holds each rule.
 *
 * A link out goes only to a pull request or a release page on github.com.
 * Anything else the read carries is drawn as text.
 */

const PULL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d{1,9}$/;
const RELEASE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/[^\s"'<>]+$/;

/** A pull request's page on GitHub, or null. */
export const pullHref = (url) => (typeof url === 'string' && PULL.test(url) ? url : null);
/** A release's page on GitHub, or null. */
export const releaseHref = (url) => (typeof url === 'string' && RELEASE.test(url) ? url : null);

/** "#42" from a pull request's URL, or null. */
export function pullNumber(url) {
  const m = pullHref(url)?.match(/\/pull\/(\d+)$/);
  return m ? `#${m[1]}` : null;
}

const TONE = { planned: 'grey', in_progress: 'v1', in_review: 'warn', built: 'ok', dropped: 'muted' };

/** One fed must-have: its state's words and tone, its pull request link, and what Dropped means. */
export function mustHaveView(m) {
  const state = typeof m?.state === 'string' && Object.hasOwn(TONE, m.state) ? m.state : null;
  return {
    title: typeof m?.title === 'string' && m.title ? m.title : 'Untitled',
    label: state ? m.label || state : 'Not recorded',
    tone: state ? TONE[state] : 'grey',
    href: pullHref(m?.url),
    number: pullNumber(m?.url),
    note: state === 'dropped' && m?.must_have !== true ? 'Off the must-haves. Mark it a must-have to undo.' : null,
  };
}

const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const titles = (list) => (Array.isArray(list) ? list.filter((i) => i && typeof i.title === 'string').map((i) => i.title) : []);

/** One release's checks: its title, date and link, then in and not in. */
export function releaseCheckView(release) {
  const tag = typeof release?.tag === 'string' && release.tag ? release.tag : 'Untagged';
  const name = typeof release?.name === 'string' && release.name && release.name !== tag ? release.name : null;
  const inRelease = titles(release?.in);
  const notIn = titles(release?.not_in);
  return {
    title: name ? `${tag} · ${name}` : tag,
    date: day(release?.published_at) ?? 'Not published',
    href: releaseHref(release?.url),
    in: inRelease,
    notIn,
    inText: inRelease.length ? inRelease.join(' · ') : 'No must-have newly in this release',
    notInText: notIn.length ? notIn.join(' · ') : 'Nothing was left open',
  };
}

/** "3 releases", or "Showing 12 of 30 releases" when the list is cut. */
export function releaseChecksCount(github) {
  const shown = Array.isArray(github?.releases) ? github.releases.length : 0;
  const total = Number.isSafeInteger(github?.releases_total) ? github.releases_total : shown;
  if (total > shown) return `Showing ${shown} of ${total} releases`;
  return total === 1 ? '1 release' : `${total} releases`;
}
