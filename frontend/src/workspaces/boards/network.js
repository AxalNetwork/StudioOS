import { count, summary, title, top } from './format.js';
import { NETWORK_ORG_COPY, ORG_BACKED } from '../noStoreCopy.js';
// #4609: the Organizations zone's own roll-up, from the module they share, so
// the overview's organisation count is the same computation as the page's —
// and a board does not import a page (see `lib/partnerBookRollUp.js`).
import { rollUp } from '../../lib/partnerBookRollUp.js';

/*
 * `/network` — Partner Operator Canvas P6 and Advisor Canvas V5. One board,
 * two licences, because the zones and the stores are the same three.
 *
 * A FACTORY OF ROLE, and the role decides exactly one thing: whether
 * Organizations has a store. `ORG_BACKED` is imported from `noStoreCopy.js`,
 * beside the copy it decides between.
 *
 * IT USED TO BE A SECOND COPY HERE, AND IT DRIFTED. This file declared
 * `{founder, investor}` while `NetworkWorkspace` declared
 * `{founder, investor, partner}`, and the sentence that stood here claimed the
 * two were "the same set the zone body and the rail already consult". They were
 * not, so the partner `/network` root printed "Organizations reads nothing on
 * this licence" over a zone that has grouped real rows since migration 224 —
 * telling a reader a working feature does not exist. Nothing compared the two
 * sets; `advisor_network_zones.test.mjs` now does, which is why this is one
 * import rather than a second literal and a promise about it.
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
 * shapes appear in this API and the advisor zone reads it as an array, so the
 * advisor arm of this board does too.
 *
 * #4609 — THE PARTNER OVERVIEW READS THE STORE ITS OWN ZONES READ, AND THE
 * TWO RELATIONSHIP CONCEPTS ARE NAMED APART.
 *
 * There are two stores, they are different objects, and `api.js` says so at
 * the method itself: `partnerBook()` is the FIRM RELATIONSHIP BOOK (migration
 * 224 — a person, their organization, who at the firm owns them, when they
 * were last interacted with), and `partnerRelationships()` is the
 * ACCOUNT-TO-ACCOUNT EDGE between two members of this platform. Two tables,
 * two envelope shapes, two populations.
 *
 * This board pointed BOTH its Relationship-book card and its Organizations
 * roll-up at `partnerRelationships()`, while the pages those cards link to —
 * `RelationshipsPage` and `partner/OrganizationsZone` — read `partnerBook()`.
 * So a partner whose firm book held forty contacts across nine organizations
 * could open `/network`, be told "No relationship names an organisation yet",
 * click into Organizations and find nine. The overview was not stale or
 * rounded; it was counting a different table.
 *
 * SO THE SOURCE IS PER ROLE NOW, AND IT IS NOT A STYLE CHOICE EITHER WAY:
 *   partner → `partnerBook()`, `{ items }`, because its two destination zones
 *             read that and an overview that disagrees with its destination is
 *             the whole finding.
 *   advisor → `partnerRelationships()`, a bare array, because
 *             `advisor/network/RelationshipsZone` reads that one. Changing the
 *             advisor arm too would have moved the same bug one licence over.
 *
 * WHAT DOES NOT CHANGE: the sections, their order, their spans, their columns
 * or the gap card. Each cell reads a different FIELD on the partner arm,
 * because a book row has `organization` and `relationship` where an edge has
 * `other.organization` and `relationship_type` — a field cannot be printed
 * from a table that has no such column. The #3701 / #4799 Network redesign owns
 * how this overview looks; this is which store it counts.
 *
 * COUNT-CONSISTENT BY CONSTRUCTION: the partner roll-up is `OrganizationsZone`'s
 * own `rollUp`, imported rather than re-derived, so the overview's organisation
 * count is computed by the same function as the zone's and cannot drift from it.
 */
export default function networkBoard(role, api) {
  const orgHasStore = ORG_BACKED.has(role);
  // The partner arm. `book` is the firm relationship book; `edges` is the
  // account-to-account graph. Only one of them is read per licence.
  const fromBook = role === 'partner';
  return {
    sources: {
      relationships: () => (fromBook ? api.partnerBook() : api.partnerRelationships()),
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
        columns: fromBook ? ['Contact', 'Organization', 'Firm owner', 'Last interaction'] : ['Person', 'Type', 'State', 'Next step'],
        empty: 'Nobody is recorded in this book yet.',
        summary: (d) => summary(count(bookRows(d, fromBook).length, fromBook ? 'contact' : 'relationship')),
        rows: (d) => top(bookRows(d, fromBook)).map((r) => (fromBook
          /* The firm book's own four facts, which is what `/network/relationships`
             shows: who, where they work, who at the firm owns them, and when
             they were last interacted with. An unowned contact reads
             "Unassigned" rather than blank — the zone's own first sort key is
             exactly that distinction, so hiding it on the overview would bury
             the one thing the zone opens on. */
          ? [r.name, r.organization, r.firm_owner?.name || 'Unassigned', r.last_interaction_at || 'No interaction recorded']
          : [r.other?.name, title(r.relationship_type), title(r.status), r.next_step])),
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
          summary: (d) => summary(count(orgCount(d, fromBook), 'organisation')),
          rows: (d) => top(orgList(d, fromBook)).map((o) => [o.name, o.people]),
          footnote: () => (fromBook
            ? 'Rolled up from the firm relationship book by the same function the Organizations '
              + 'zone uses, so this count and that page\'s cannot disagree. A contact whose '
              + 'organization is blank is in neither.'
            : 'Rolled up from the people in the book, so the count follows the relationships rather '
              + 'than being kept separately and drifting from them.'),
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

/**
 * The relationship rows out of whichever envelope the licence's store answers
 * in: `{ items }` for the firm book, a bare array for the account edge. An
 * unreadable read reaches `BucketBoard`'s own failure state, not this.
 */
function bookRows(d, fromBook) {
  if (fromBook) return Array.isArray(d?.items) ? d.items : [];
  return Array.isArray(d) ? d : [];
}

/** The organisations, by the reader's own store's roll-up. */
function orgList(d, fromBook) {
  return fromBook ? rollUp(bookRows(d, true)) : orgRows(d);
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
const orgCount = (d, fromBook) => {
  if (fromBook) return Array.isArray(d?.items) ? rollUp(d.items).length : null;
  return Array.isArray(d) ? orgRows(d).length : null;
};
