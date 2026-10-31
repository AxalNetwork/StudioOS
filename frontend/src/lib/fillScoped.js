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
});

/** The values a scoped form's Save should still treat as Eadwyn's: placed and not typed over. */
export function placedNames(placed, values) {
  return Object.keys(placed || {}).filter((n) => String(values?.[n] ?? '') === placed[n]?.value);
}
