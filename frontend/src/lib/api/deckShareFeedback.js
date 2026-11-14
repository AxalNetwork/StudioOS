// D6064 (#6064) — the founder's read of viewer reactions and feedback sent through share links (Share & analytics, ps7).
// Worker: routes/deck_share_feedback.ts, no new store (deck_share_feedback, migrations 071 and 714).
//   GET /api/decks/:id/share-feedback?version=N  → { deck_id, cap, truncated, discovery_mirror, items: [{ id, created_at,
//     deck_id, version, link: { id, investor: { label, fund } } | null, viewer: 'signed_in' | 'anonymous', reactions:
//     [{ card_uid, place, title, reaction }], note, problem_fit, willingness_to_pay }] }
//   The venture's owner and co-founders only; no viewer identity is ever returned; at most `cap` rows, `truncated` past it.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckShareFeedbackApi = {
  /** `version` is optional; an empty value reads every version of the venture. */
  read: (deckId, { version } = {}) => request(`/decks/${enc(deckId)}/share-feedback${version != null && version !== '' ? `?version=${enc(version)}` : ''}`),
};
