// D1558 (#3805, deck v2 C10) — the narrative coach and the "deck ready to send" item.
// Worker: routes/cycle_raise.ts over services/narrative/coach.ts. Every call names the venture (`?project=`).
//   deckReady(pid)              GET  /cycles/raise/deck-ready → { state: ready | not_ready | no_deck, deck_id, version, label,
//                                    rows: [{ key, kind, label, card_uid, card_index, card_title, area, href }] }   free
//   coach(pid, version, headers) POST /cycles/raise/narrative/:version/coach → { version, deck_id, deck_version,
//                                    findings: [{ key, section, section_label, kind, message, proposal, card_uid, card_index, area, href }],
//                                    dropped, ready }   one metered run under `review:narrative-coach`; writes nothing
// Each row's and finding's `href` opens the editor at its card and Grid area (`?card=&area=`).
import { request } from '../api.js';

const enc = encodeURIComponent;

export const narrativeCoachApi = {
  deckReady: (projectId) => request(`/cycles/raise/deck-ready?project=${enc(projectId)}`),
  coach: (projectId, version, headers) => request(`/cycles/raise/narrative/${enc(version)}/coach?project=${enc(projectId)}`, {
    method: 'POST', body: JSON.stringify({}), ...(headers ? { headers } : {}),
  }),
};
