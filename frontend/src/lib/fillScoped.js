/**
 * D1329 (#3490, part 6 of #2431) — Fill with Eadwyn on every other profile's
 * forms: the records that are not a venture's (`services/fills/scopes.ts`).
 * No React and no fetch; `ui/useScopedFill.jsx` draws it.
 *
 *   AF15  a reader reads the marks with no trigger and no Undo; a support
 *         session reads "Ask is off in a support session."
 *   AF17  Commit's IC memo: "Not filled here: Commitment amount".
 *   AF18  a service; its price is never filled.
 *   AF19  a status report's Done and Next, from the engagement record.
 *   AF20  an event's content; an approval has no trigger.
 *   AF21  a publication's summary; who wrote it is never filled.
 *   AF22  the Explorer: "Ask opens once you hold a venture or a profile."
 */

/** The pages and forms FILL_FIELDS lists for the other profiles (D1329), by board. */
export const SCOPED_FORMS = Object.freeze({
  icMemo: Object.freeze({ page: 'Investor · Deals · Commit', form: 'ic-memo', table: 'ic_decisions' }),
  service: Object.freeze({ page: 'Advisor · Expertise · Services', form: 'service', table: 'advisor_services' }),
  statusReport: Object.freeze({ page: 'Operating Partner · Delivery · Reporting', form: 'status-report', table: 'engagement_status_reports' }),
  event: Object.freeze({ page: 'Admin · Approvals · Events', form: 'event', table: 'events' }),
  agendaItem: Object.freeze({ page: 'Admin · Approvals · Events', form: 'agenda-item', table: 'event_agenda_items' }),
  publication: Object.freeze({ page: 'Super Admin · Content · Publications', form: 'publication', table: 'admin_publications' }),
  // D1595 (#3868), mounted by D1424 (#3700): Log support, New service, New perk. One composition field each.
  support: Object.freeze({ page: 'Investor · Portfolio · Value-add', form: 'support', table: 'portfolio_support_entries' }),
  offering: Object.freeze({ page: 'Operating Partner · Offers · Catalog', form: 'offering', table: 'service_offerings' }),
  perk: Object.freeze({ page: 'Operating Partner · Offers · Perk deals', form: 'perk', table: 'perks' }),
  // #4046 (#3740 2b): the deal page's New note, a firm's private note; its words only.
  dealNote: Object.freeze({ page: 'Investor · Deals · Deal room', form: 'deal-note', table: 'deal_notes' }),
  // #4046 (B2): a member's answers to a product-testing programme's questions, in their own words.
  testingAnswers: Object.freeze({ page: 'Member · Studio · Product testing', form: 'testing-answers', table: 'testing_applications' }),
  // #4046 (B4): Admin · Programs' Propose a program, a studio's proposal: its name, purpose and eligibility.
  programProposal: Object.freeze({ page: 'Admin · Programs', form: 'program-proposal', table: 'program_proposals' }),
  // #4046 (B4): New invitation on Admin · Community · Partner invitations: the admin's message to the invitee.
  partnerInvitation: Object.freeze({ page: 'Admin · Community · Partner invitations', form: 'partner-invitation', table: 'partner_invitations' }),
  // #4046 (B4): the review drawer's new comment to an article's author, on Super Admin · Content · Content queue.
  reviewComment: Object.freeze({ page: 'Super Admin · Content · Content queue', form: 'review-comment', table: 'article_review_comments' }),
  // #4046 (B4): HQ's New segment on Super Admin · Content · Personas: its name and who they are.
  segment: Object.freeze({ page: 'Super Admin · Content · Personas', form: 'segment-profile', table: 'segment_profiles' }),
});

export const SUPPORT_OFF = 'Ask is off in a support session.';
export const EXPLORER_OFF = 'Ask opens once you hold a venture or a profile.';

/**
 * Why a form shows no trigger, in words, or null when it needs no line: a
 * support session says so (AF15); an Explorer is told what opens Fill
 * (AF22). A reader's marks need no line: they are the record's.
 */
export function fillOffLine({ support = false, explorer = false } = {}) {
  if (explorer) return EXPLORER_OFF;
  if (support) return SUPPORT_OFF;
  return null;
}

/** What each form's sheet never fills, said on the form (AF17, AF18, AF20, AF21). */
export const NOT_FILLED_HERE = Object.freeze({
  'ic-memo': Object.freeze(['Commitment amount · Eadwyn never fills a money amount you commit.']),
  service: Object.freeze(['Price · Eadwyn never fills what you charge.']),
  event: Object.freeze(['Times, capacity and price · they are yours to set.']),
  publication: Object.freeze(['Author · Eadwyn never fills who wrote a publication.']),
  // D1595 §2: each form's other columns are the member's own call, a measure, terms or money.
  support: Object.freeze(['Outcome and hours · a result and a measure are yours to record.']),
  offering: Object.freeze(['Price · Eadwyn never fills what you charge.']),
  perk: Object.freeze(['Value, credits, cap and conditions · they are yours to set.']),
  'deal-note': Object.freeze(['Tag · it is yours to choose.']),
  'testing-answers': Object.freeze(['Availability and email consent · they are yours to give.']),
  'program-proposal': Object.freeze(['Who it is for, group, join method, cycle, seats, rewards, contract templates, what HQ receives and tools · they are yours to set.']),
  'partner-invitation': Object.freeze(['Email, name, what to offer and terms · they are yours to set.']),
  'review-comment': Object.freeze(['Where it points and whether to approve · those are yours to decide.']),
  'segment-profile': Object.freeze(['Key, profile and status · they are HQ’s call.']),
});

/** The values a scoped form's Save should still treat as Eadwyn's: placed and not typed over. */
export function placedNames(placed, values) {
  return Object.keys(placed || {}).filter((n) => String(values?.[n] ?? '') === placed[n]?.value);
}
