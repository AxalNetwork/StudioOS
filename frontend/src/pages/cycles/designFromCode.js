/**
 * D782 (#2114) — the words for Solution design's "From GitHub" part, from the
 * module read's `parts.from_code`. Pure, so
 * `frontend/test/github_solution_design_d782.test.mjs` holds each rule.
 *
 * Everything here came from a repository, so it is untrusted: it is drawn as
 * text, and a link is drawn only when it is GitHub's own https page.
 */

/** "TypeScript 90% · CSS 10%"; a language GitHub reports with no bytes reads 0%. */
export function languagesText(stack) {
  const langs = Array.isArray(stack?.languages) ? stack.languages.filter((l) => l && typeof l.name === 'string' && l.name) : [];
  if (!langs.length) return 'No languages reported';
  return langs.map((l) => `${l.name} ${Number.isFinite(l.pct) ? `${Math.round(l.pct)}%` : '0%'}`).join(' · ');
}

/** A repository file's link, or null when it is not GitHub's own https page. */
export function githubHref(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'github.com' && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

/**
 * The part's lists, cleaned. `empty` is true when GitHub has brought nothing
 * to this venture: the page then draws no "From GitHub" part at all, since it
 * claims only what is built.
 */
export function fromCodeView(part) {
  if (!part || typeof part !== 'object') return { state: 'none', builtWith: [], proposals: [], notes: [], empty: true };
  if (part.state === 'unreadable') return { state: 'unreadable', reason: part.reason || 'What GitHub proposed could not be read.', builtWith: [], proposals: [], notes: [], empty: false };
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const builtWith = list(part.built_with).filter((s) => typeof s.repository === 'string');
  const proposals = list(part.proposals).filter((p) => Number.isSafeInteger(p.id) && typeof p.title === 'string');
  const notes = list(part.notes).filter((n) => typeof n.title === 'string');
  return { state: 'ok', builtWith, proposals, notes, empty: !builtWith.length && !proposals.length && !notes.length };
}
