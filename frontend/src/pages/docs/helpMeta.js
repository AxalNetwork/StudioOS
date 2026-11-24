// D6996 (#6996) — each public Help Center guide's title, description and address, from the guide index.
//
// One rule for the two places that need it: `scripts/lib/helpGuides.mjs` (the prerender and the tag validator,
// so a crawler reads the guide's own head) and `DocsLayout.jsx` (the tab and the head on a client-side visit).
// A guide added to `PUBLIC_HELP_ANCHORS` gets its own entry with no edit here. Plain data and no imports, so
// plain Node loads it.

/** Added to a guide's own title, so the preview says where the guide lives. */
export const HELP_TITLE_SUFFIX = ' · Help Center';

/** A description stops at the last whole sentence that fits; most platforms cut near 200 characters. */
export const HELP_DESCRIPTION_MAX = 200;

/**
 * The guide's description: the opening sentences of its own overview, the first paragraph its page draws, as
 * many whole ones as fit in `HELP_DESCRIPTION_MAX`. Always at least the first sentence, so it never ends mid-way.
 */
export function guideDescription(overview) {
  const text = String(overview || '').replace(/\s+/g, ' ').trim();
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g) || (text ? [text] : []);
  let out = '';
  for (const s of sentences) {
    const next = out ? `${out} ${s.trim()}` : s.trim();
    if (out && next.length > HELP_DESCRIPTION_MAX) break;
    out = next;
  }
  return out;
}

/** One guide's address, title and description. */
export function helpGuideMeta(section, sub) {
  return {
    path: `/help/${section.id}/${sub.id}`,
    title: `${sub.title}${HELP_TITLE_SUFFIX}`,
    description: guideDescription(sub.overview),
  };
}

/** Every public guide, in the index's order, as `{ path, overrides: { title, description }, anchor }`. */
export function publicHelpRoutes(sections, publicAnchors) {
  const out = [];
  for (const section of sections || []) {
    for (const sub of section.subsections || []) {
      const anchor = `${section.id}/${sub.id}`;
      if (!publicAnchors.has(anchor)) continue;
      const { path, title, description } = helpGuideMeta(section, sub);
      out.push({ path, overrides: { title, description }, anchor });
    }
  }
  return out;
}
