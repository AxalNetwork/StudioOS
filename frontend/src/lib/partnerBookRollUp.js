/**
 * #4609 — the firm relationship book grouped by organization, in a module with
 * no page in it.
 *
 * WHY IT MOVED. This was `OrganizationsZone.jsx`'s own export, and #4609 needed
 * the `/network` overview board to count organizations the SAME way the zone it
 * links to does — the finding being that the two read different tables and so
 * reported different numbers for one named section. Importing the function from
 * the page achieved that and dragged the page in with it: `boards/network.js`
 * is reachable from several route elements, and a page reaches `WorkerRail`, so
 * `rail_pages_d768.test.mjs` started reporting a rail on `/events/:slug` — a
 * route that draws no rail and has nothing to do with any of this. The census
 * reads imports rather than renders, which is exactly the right side to err on,
 * and it caught a real coupling.
 *
 * So the shared computation lives here, the page and the board both import it,
 * and neither imports the other. `lib/` is where a helper with no HTTP and no
 * JSX belongs.
 */

/** How a book contact's `relationship` column reads on screen. */
export const KIND_LABEL = Object.freeze({ client: 'Client', prospect: 'Prospect', referral_source: 'Referral source' });

/**
 * Group the book by the company text on each contact.
 *
 * THE GROUPING KEY IS TRIMMED AND CASE-FOLDED AND THE LABEL IS NOT. "Verwood"
 * and "verwood " are one company to a reader and would be two rows to a naive
 * group-by, which would then report "every row knows exactly one person" as a
 * finding about the firm's relationships when it was a finding about
 * whitespace. The label shown is the first spelling entered, because the page
 * has no basis for preferring another.
 *
 * A contact whose organization is blank is in no group: migration 224 stores
 * the company as free text with no organization record behind it, so an absent
 * value is an absent value and is not inferred from an email domain.
 */
export function rollUp(contacts) {
  const by = new Map();
  for (const c of contacts || []) {
    const name = (c.organization || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!by.has(key)) by.set(key, { key, name, people: 0, kinds: new Set() });
    const row = by.get(key);
    row.people += 1;
    if (c.relationship) row.kinds.add(KIND_LABEL[c.relationship] || c.relationship);
  }
  return [...by.values()]
    .map((row) => ({
      ...row,
      // NULL, ONE, OR MIXED — three outcomes and no tie-break. `Mixed` names
      // both values rather than choosing, which is the same refusal the
      // Headcount column makes by staying absent.
      kind: row.kinds.size === 1 ? [...row.kinds][0] : (row.kinds.size > 1 ? 'Mixed' : null),
      kindList: [...row.kinds].sort(),
    }))
    .sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
}
