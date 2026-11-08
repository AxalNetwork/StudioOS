/**
 * #4853 — one Pitch Studio, one route family.
 *
 * The redesigned Pitch Studio lives at `/raise/pitch` (D4254): Overview at the
 * root, then `/decks`, `/script`, `/share`, `/edit`, `/new`. The Raise module
 * cycle (`/raise/pitch-deck`) was the studio's first home, and its addresses
 * leaked into founder-facing entries: the Raise overview's "Pitch" tab, and the
 * "Share the deck with an investor" and "New link" actions, which opened the
 * module's own Add form at `/raise/pitch-deck/new`, a second, older sharing flow.
 *
 * Every founder-facing entry now names the canonical address. The two legacy
 * addresses stay as redirects, because a bookmark or a link already sent can
 * still carry them (REDIRECT_ROUTES keeps and counts both):
 *
 *   /raise/pitch-deck       →  /raise/pitch
 *   /raise/pitch-deck/new   →  /raise/pitch/share
 *
 * THE VENTURE SURVIVES. The Studio reads `?project_id=` only. The module cycle's
 * links named `?project=`, so a redirect that kept the query as written dropped
 * the founder's chosen venture. `ventureSearch` carries it across, as
 * `project_id`, with every other parameter kept.
 *
 * What stays on the module cycle on purpose: `/raise/pitch-deck/<id>`, one
 * investor link's own record page (views, slides, revoke). The Studio's Share
 * tab has no per-link page yet, so that one address keeps its purpose.
 *
 * Pure: no React, no network. `cycleModel.safeHref` and the two App redirects
 * read it, and the Worker (`services/raiseCycle.ts`) writes the same addresses.
 */
export const PITCH_PATH = '/raise/pitch';
export const PITCH_SHARE_PATH = '/raise/pitch/share';

/** The legacy addresses and where each one lands. */
export const LEGACY_PITCH_PATHS = Object.freeze({
  '/raise/pitch-deck': PITCH_PATH,
  '/raise/pitch-deck/new': PITCH_SHARE_PATH,
});

/** A query string with `project` carried as `project_id` (kept if both are named), every other key untouched. */
export function ventureSearch(search) {
  const raw = typeof search === 'string' ? search.replace(/^\?/, '') : '';
  if (!raw) return '';
  const q = new URLSearchParams(raw);
  if (q.has('project')) {
    if (!q.has('project_id')) q.set('project_id', q.get('project'));
    q.delete('project');
  }
  const out = q.toString();
  return out ? `?${out}` : '';
}

/**
 * The canonical address for an in-app href that names a legacy Pitch address,
 * its query and hash kept (the venture as `project_id`). Anything else, a
 * record page included, comes back as it was given.
 */
export function canonicalPitchHref(href) {
  if (typeof href !== 'string') return href;
  const m = /^(\/raise\/pitch-deck(?:\/new)?)(\?[^#]*)?(#.*)?$/.exec(href);
  if (!m) return href;
  return `${LEGACY_PITCH_PATHS[m[1]]}${ventureSearch(m[2] || '')}${m[3] || ''}`;
}
