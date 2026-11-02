/**
 * D1501 (#3751): `If-Match` as a revision, for a deck (its version) or a card's
 * working copy (its `rev`). A whole number, quotes and a weak `W/` allowed;
 * null when the header is absent or not one. No imports, so both the save route
 * and the draft routes can read it without a cycle.
 */
export function revOf(header: string | null | undefined): number | null {
  if (header == null) return null;
  const m = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(header);
  return m ? Number(m[1]) : null;
}
