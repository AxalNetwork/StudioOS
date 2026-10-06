// D583 (#1210; S1's 1A, 2A, 3A) — the Brand page's voice tags, dark logo and
// Archived status. The Worker (routes/brand.ts `parseBrandExtras`) applies the
// same rules and is the authority; these exist so the page refuses what the
// Worker would before a save.

/** At most three free-text voice tags (1A). */
export const VOICE_MAX = 3;
/** Mirrors VOICE_TAG_MAX_CHARS in routes/brand.ts. */
export const VOICE_TAG_MAX_CHARS = 32;

/**
 * Add a tag: trimmed, inner spaces collapsed, duplicates (ignoring case)
 * dropped, refused past three or over the length. Returns the new list and,
 * when refused, why.
 */
export function addVoiceTag(tags, raw) {
  const list = Array.isArray(tags) ? tags : [];
  const tag = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!tag) return { tags: list, error: null };
  if (tag.length > VOICE_TAG_MAX_CHARS) return { tags: list, error: `A voice tag is at most ${VOICE_TAG_MAX_CHARS} characters.` };
  if (list.some((t) => t.toLowerCase() === tag.toLowerCase())) return { tags: list, error: null };
  if (list.length >= VOICE_MAX) return { tags: list, error: `At most ${VOICE_MAX} voice tags.` };
  return { tags: [...list, tag], error: null };
}

export function removeVoiceTag(tags, tag) {
  return (Array.isArray(tags) ? tags : []).filter((t) => t !== tag);
}

/** A page's status label: Archived beside Draft and Published (2A). */
export function pageStatus(page) {
  if (page?.archived_at) return 'Archived';
  return page?.published ? 'Published' : 'Draft';
}
