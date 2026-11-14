// D1540 (#3791, deck v2 B15) — a founder reports a bad deck result, and HQ's
// queue of the reports. Worker: routes/deck_reports.ts, migration 733's
// `deck_proposal_reports`.
//   POST /api/decks/proposals/:uid/report         { reason, note? }
//        → 201 { report }; 409 already_reported with { report }; 404 when the
//          result is not the caller's
//   GET  /api/admin/deck-reports?status=open|resolved|all   (HQ admin)
//        → { reports: [{ uid, reason, note, status, outcome, model, charged_microusd, proposal,
//            founder, deck, card, asked, before, after, … }], counts: { open, resolved_this_week } }
//        (#4188; the Worker also takes `model` and `reason` filters)
//   POST /api/admin/deck-reports/:uid/resolve     { outcome: addressed|no_fault, note }   (HQ admin)
//        → { report }; 400 note_required (under 10 characters); 409 already_resolved
// A report refunds nothing and changes no proposal.
//   POST /api/admin/deck-images/:uid/takedown   { reason }   (HQ admin, #4375; routes/admin_deck_images.ts)
//        → { image: { uid, project_id, taken_down_at, reason, r2_deleted } }; 400 reason_required; 409 already_taken_down
//        Every card that used the image then shows "Image removed by Axal HQ"; the founder is told.
import { request } from '../api.js';

const enc = encodeURIComponent;

/** The reasons, in the Worker's order and words (`REPORT_REASONS`). */
export const DECK_REPORT_REASONS = Object.freeze([
  { id: 'wrong_figure', label: 'States something my records do not' },
  { id: 'poor_writing', label: 'Badly written or unusable' },
  { id: 'wrong_place', label: 'Put in the wrong place' },
  { id: 'bad_image', label: 'The picture is wrong' },
  { id: 'unsafe', label: 'Offensive or unsafe' },
  { id: 'other', label: 'Something else' },
]);
export const DECK_REPORT_NOTE_MAX = 280;

export const deckReportsApi = {
  report: (proposalUid, { reason, note } = {}) => request(`/decks/proposals/${enc(proposalUid)}/report`, {
    method: 'POST', body: JSON.stringify(note ? { reason, note } : { reason }),
  }),
  queue: (status = 'open') => request(`/admin/deck-reports?status=${enc(status)}`),
  resolve: (reportUid, { outcome, note } = {}) => request(`/admin/deck-reports/${enc(reportUid)}/resolve`, {
    method: 'POST', body: JSON.stringify(note ? { outcome, note } : { outcome }),
  }),
  takedownImage: (imageUid, reason) => request(`/admin/deck-images/${enc(imageUid)}/takedown`, {
    method: 'POST', body: JSON.stringify({ reason }),
  }),
};
