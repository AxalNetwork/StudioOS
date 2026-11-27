/**
 * D782 (#2111) — the words for Product roadmap's "From GitHub" part, from the
 * module read's `parts.github`: the milestone groups and their targets, the
 * Releases strip, and the Shipped mark on an item. Pure, so
 * `frontend/test/github_roadmap_d782.test.mjs` holds each rule.
 *
 * A link out goes only to a release's page on github.com. Anything else the
 * read carries is drawn as text.
 */

/** A release's page on GitHub, or null. */
export function releaseHref(url) {
  return typeof url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/[^\s"'<>]+$/.test(url) ? url : null;
}

const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** "Target 2026-11-30", or no target when the milestone has no due date. */
export function groupTarget(group) {
  const due = day(group?.due);
  return due ? `Target ${due}` : 'No target: the milestone has no due date';
}

/** "3 items · 1 shipped". */
export function groupCount(group) {
  const items = Array.isArray(group?.items) ? group.items.length : 0;
  const shipped = Number.isSafeInteger(group?.shipped) ? group.shipped : 0;
  return `${items === 1 ? '1 item' : `${items} items`}${shipped ? ` · ${shipped} shipped` : ''}`;
}

/** An item's Shipped mark, linking to its release, or null when no release shipped it. */
export function shippedMark(item) {
  const s = item?.shipped;
  if (!s || typeof s.tag !== 'string' || !s.tag) return null;
  return { text: `Shipped in ${s.tag}`, href: releaseHref(s.url) };
}

/** One release in the strip: its title, date, link and what it shipped. */
export function releaseView(release) {
  const tag = typeof release?.tag === 'string' && release.tag ? release.tag : 'Untagged';
  const name = typeof release?.name === 'string' && release.name && release.name !== tag ? release.name : null;
  const shipped = Number.isSafeInteger(release?.shipped) ? release.shipped : 0;
  const items = Array.isArray(release?.items) ? release.items.filter((i) => i && typeof i.title === 'string') : [];
  return {
    title: name ? `${tag} · ${name}` : tag,
    date: day(release?.published_at) ?? 'Not published',
    href: releaseHref(release?.url),
    prerelease: release?.prerelease === true,
    shipped: shipped === 0 ? 'No roadmap item shipped' : shipped === 1 ? '1 item shipped' : `${shipped} items shipped`,
    items: items.map((i) => i.title),
    more: Math.max(0, shipped - items.length),
    repository: typeof release?.repository === 'string' ? release.repository : null,
  };
}

/** "12 releases", or "Showing 12 of 30 releases" when the strip is cut. */
export function releasesCount(github) {
  const shown = Array.isArray(github?.releases) ? github.releases.length : 0;
  const total = Number.isSafeInteger(github?.releases_total) ? github.releases_total : shown;
  if (total > shown) return `Showing ${shown} of ${total} releases`;
  return total === 1 ? '1 release' : `${total} releases`;
}
