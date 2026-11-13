/**
 * D515 — the licence-kind filter both HQ ledgers draw (HQ Home and Admin ·
 * Licences). One rule in one place, so the two screens cannot disagree about
 * what "Axal" or "White-label" shows, and so the rule runs under node --test
 * rather than being pinned as page text.
 *
 *   'all'          → every licence, in order
 *   'subsidiary'   → Axal's own licences
 *   'white_label'  → white-label licences
 *
 * An unknown filter value shows nothing rather than everything: a filter
 * that silently widened would read as "all of this kind".
 */
export const LICENCE_KINDS = Object.freeze(['all', 'subsidiary', 'white_label']);

export function filterByKind(items, kind) {
  const list = Array.isArray(items) ? items : [];
  if (kind === 'all') return list;
  if (!LICENCE_KINDS.includes(kind)) return [];
  return list.filter((l) => l?.kind === kind);
}
