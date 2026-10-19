// D767 (#2096) — "Fill from project" proposes a deck version; the founder keeps
// or discards it. Pure: the words of the panel and the slide-by-slide pairing
// of the current version with the proposal. Nothing here writes or stores.
//
// The Worker stores a fill in `pitch_deck_proposals` and never touches the
// deck versions (`routes/decks.ts`, `proposeFill`): Keep writes it as a new
// current version, Discard deletes the proposal only (D720 §9).

export const PROPOSAL_COPY = Object.freeze({
  title: 'Filled from project · not kept yet',
  lede: 'Your current version is unchanged. Keep this fill as a new version, or discard it.',
  keep: 'Keep as new version',
  discard: 'Discard',
  kept: 'Kept as a new version.',
  discarded: 'Discarded. Your current version is unchanged.',
  current: 'Current',
  proposed: 'Proposed',
  changed: 'Changed',
  same: 'Same',
  none: '—',
});

const slideTitle = (s) => (s && typeof s.title === 'string' && s.title.trim()) || '';

const excerptOf = (s) => {
  if (!s) return '';
  const body = typeof s.body === 'string' ? s.body : '';
  const bullets = Array.isArray(s.bullets) ? s.bullets.filter((b) => typeof b === 'string') : [];
  const text = (body || bullets.join(' · ')).replace(/\s+/g, ' ').trim();
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
};

// A slide's content for comparison: what the editor and the share view draw.
const contentOf = (s) => JSON.stringify(s ? {
  title: s.title ?? null, subtitle: s.subtitle ?? null, body: s.body ?? null,
  bullets: s.bullets ?? null, fields: s.fields ?? null, image_url: s.image_url ?? null,
} : null);

/**
 * One row per slide position, the current slide beside the proposed one.
 * `changed` is whether the proposal draws something different there.
 */
export function proposalRows(currentSlides, proposedSlides) {
  const cur = Array.isArray(currentSlides) ? currentSlides : [];
  const next = Array.isArray(proposedSlides) ? proposedSlides : [];
  const n = Math.max(cur.length, next.length);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({
      index: i,
      current: cur[i] ? { title: slideTitle(cur[i]), excerpt: excerptOf(cur[i]) } : null,
      proposed: next[i] ? { title: slideTitle(next[i]), excerpt: excerptOf(next[i]) } : null,
      changed: contentOf(cur[i]) !== contentOf(next[i]),
    });
  }
  return rows;
}

/** How many slide positions the proposal changes. */
export function changedCount(currentSlides, proposedSlides) {
  return proposalRows(currentSlides, proposedSlides).filter((r) => r.changed).length;
}
