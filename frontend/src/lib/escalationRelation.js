/**
 * D275 — what a content submission is TO the item it names, in the words both
 * tiers draw it with.
 *
 * The relation is recorded by the Worker (migration 296): `localises` or
 * `changes`, required whenever an item is picked, NULL on every row raised
 * before that. This file holds only how the SPA SAYS it — the drawer's two
 * choices and the lane row's lead word — so the branch's "Raised from here"
 * lane and HQ's Localisation zone cannot come to word one relation two ways.
 * The vocabulary itself is the Worker's (`services/escalationConcerns.ts`,
 * `CONCERN_RELATIONS`); a third value here would be refused there.
 */

/** The drawer's two choices, in the order it offers them. */
export const RELATION_CHOICES = [
  ['localises', 'localises it'],
  ['changes', 'asks for a change to it'],
];

/** The lane row's lead word for a recorded relation. */
const LEAD = { localises: 'Localises', changes: 'Changes' };

/**
 * How a row that names an item leads: "Localises" or "Changes" for a recorded
 * relation, and "About" — with `unrecorded: true`, so the row can say the
 * relation is not recorded — for a row raised before one was. Never a guess.
 */
export function relationLead(relation) {
  const lead = LEAD[relation];
  return lead ? { lead, unrecorded: false } : { lead: 'About', unrecorded: true };
}

/** Said beside a label whose relation was never recorded. */
export const RELATION_NOT_RECORDED = 'relation not recorded';
export const RELATION_NOT_RECORDED_REASON =
  'Raised before a submission recorded whether it localises the item it names or asks for a change to it.';
