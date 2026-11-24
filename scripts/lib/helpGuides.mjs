/**
 * D6996 (#6996) — the public Help Center guides, read in Node.
 *
 * The guide index (`frontend/src/pages/docs/sections/index.js`) and its section modules load in plain Node
 * (explicit `.js` specifiers), so this hands them to the same `publicHelpRoutes` the Help Center page uses.
 * Readers: `scripts/prerender-og.mjs` and `scripts/validate-og-tags.mjs`, so each public guide has its own
 * link preview and a new public guide edits no route list.
 */
import { SECTIONS, PUBLIC_HELP_ANCHORS } from '../../frontend/src/pages/docs/sections/index.js';
import { publicHelpRoutes } from '../../frontend/src/pages/docs/helpMeta.js';

/** Each public guide's own page: its address, with its own title and description. */
export function helpOgRoutes(sections = SECTIONS, anchors = PUBLIC_HELP_ANCHORS) {
  return publicHelpRoutes(sections, anchors);
}
