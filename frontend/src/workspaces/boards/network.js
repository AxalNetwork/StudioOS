import { count, summary, title, top } from './format.js';
import { NETWORK_ORG_COPY } from '../noStoreCopy.js';

/*
 * `/network` — Partner Operator Canvas P6 and Advisor Canvas V5. One board,
 * two licences, because the zones and the stores are the same three.
 *
 * A FACTORY OF ROLE, and the role decides exactly one thing: whether
 * Organizations has a store. `ORG_BACKED` in `NetworkWorkspace` is
 * `{founder, investor}` — an advisor is 403'd from `/api/contacts` and an
 * operator's NetworkPage has no organizations tab — so for these two licences
 * the section reads the shared no-store copy instead of a table. That is the
 * same set the zone body and the rail already consult, so the three cannot
 * disagree.
 *
 * THE STALENESS GRADE IS THE CANVAS LINE THIS BOARD WILL NOT PRINT. P6 and V5
 * both subtitle the book with a count of relationships that have gone quiet,
 * and V5 adds a count of referrals in flight. A relationship row carries a
 * status and a next step; grading one by staleness needs a last-touch timestamp
 * AND a threshold to measure it against, and nothing sets the threshold.
 * Adopting the canvas's would invent the number and then present it back as a
 * finding — the same defect `partner_bucket_overview.test.mjs:208-212` records
 * for the capacity cap. The board counts what the book holds and says what it
 * cannot say.
 *
 * `partnerRelationships()` answers with a BARE ARRAY, not `{ items }`. Both
 * shapes appear in this API and the zone reads it as an array, so the board
 * does too.
 */
export default function networkBoard(role, api) {
  const ORG_BACKED = new Set(['founder', 'investor']);
  const orgHasStore = ORG_BACKED.has(role);
  return {
    sources: {
      relationships: () => api.partnerRelationships(),
      introductions: () => api.networkIntroductionsList(),
    },
    sections: [
      {
        slug: 'relationships',
        anchor: 'nw-book',
        title: 'Relationship book',
        span: 'full',
        source: 'relationships',
        cols: '1.4fr 1.2fr 1fr 1.6fr',
        columns: ['Person', 'Type', 'State', 'Next step'],
        empty: 'Nobody is recorded in this book yet.',
        summary: (d) => summary(count(Array.isArray(d) ? d.length : null, 'relationship')),
        rows: (d) => top(Array.isArray(d) ? d : []).map((r) => [
          r.other?.name, title(r.relationship_type), title(r.status), r.next_step,
        ]),
        footnote: () =>
          'A row records a status and a next step. The canvas also grades each relationship by '
          + 'how long since the last contact, which needs a last-touch date and a threshold to '
          + 'measure it against; nothing here sets either, so no relationship is graded that way.',
      },
      {
        slug: 'introductions',
        anchor: 'nw-intros',
        title: 'Introductions desk',
        span: 'half',
        source: 'introductions',
        cols: '1.5fr 1.2fr 1fr',
        columns: ['Counterpart', 'Role', 'State'],
        empty: 'No introduction has been proposed to you.',
        summary: (d) => summary(
          count((d?.propositions || []).filter((p) => p.status === 'pending').length, 'awaiting you', 'awaiting you'),
        ),
        rows: (d) => top(d?.propositions).map((p) => [
          p.target?.name, p.target?.role, title(p.status),
        ]),
        footnote: () =>
          'Double opt-in: an introduction cannot advance past a consent nobody has recorded. '
          + 'Nothing here writes a message or opens an introduction on your behalf.',
      },
      orgHasStore
        ? {
          slug: 'organizations',
          anchor: 'nw-orgs',
          title: 'Organizations',
          span: 'half',
          source: 'relationships',
          cols: '1.8fr 1fr',
          columns: ['Organisation', 'People'],
          empty: 'No relationship names an organisation yet.',
          summary: (d) => summary(count(orgCount(d), 'organisation')),
          rows: (d) => top(orgRows(d)).map((o) => [o.name, o.people]),
          footnote: () =>
            'Rolled up from the people in the book, so the count follows the relationships rather '
            + 'than being kept separately and drifting from them.',
        }
        : {
          slug: 'organizations',
          anchor: 'nw-orgs',
          title: 'Organizations',
          span: 'half',
          gap: NETWORK_ORG_COPY,
        },
    ],
  };
}

/** The roll-up, computed from the book so it cannot drift from it. */
function orgRows(rows) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = r.referred_org || r.other?.organization;
    if (!name) continue;
    by.set(name, (by.get(name) || 0) + 1);
  }
  return [...by.entries()]
    .map(([name, people]) => ({ name, people }))
    .sort((a, b) => b.people - a.people);
}
const orgCount = (rows) => (Array.isArray(rows) ? orgRows(rows).length : null);
