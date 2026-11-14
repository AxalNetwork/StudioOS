// D6156 (#6156) — the closing checklist's history, the Audit tab of DE08b. Worker: routes/deals.ts.
//
// Every write to a checklist item appends one event (who, the state before and
// after, the note given with it, when), in the same batch as the write, and no
// event is ever changed. The read answers whoever may read the deal's
// checklist, and refuses anyone else.
import { request } from '../api.js';

export const dealClosingHistoryApi = {
  /** {events: [{uid, item_uid, item_label, actor_user_id, actor_name, from_state, to_state, note, at}]}, oldest first. */
  events: (dealId) => request(`/deals/${encodeURIComponent(dealId)}/closing-checklist/events`),
};
