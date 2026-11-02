// D1544 (#3784, deck builder v2 B8) — an edit of a deck image is a child image
// the founder keeps or reverts. The studio prices an edit through
// `pages/raise/pitch/deckV2Adapter.js` (`imageVary`); the press runs the methods below.
// Worker: routes/deck_image_edits.ts, migration 735.
//   POST /api/decks/images/:uid/edit/quote  { op, instruction?, mask?, aspect? }
//        → { ai: true, op, model, model_label, redraw, hold_microusd, draw_microusd, checks_microusd, references, balance }
//        | { ai: false, reason, message }
//   POST /api/decks/images/:uid/edit        (the same body) → { image, parent_uid, op, redraw, cost }
//   POST /api/decks/images/:uid/revert      → { parent, discarded }
// `op` is 'vary' | 'edit' | 'erase' | 'expand'. An edit needs `instruction`, an erase a PNG
// `mask` (a data URI, white where to erase, at most 512 × 512), an expand an `aspect`.
// No request names a model: DK5's model is the AIRail's pick or its Default.
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

/** The fields an edit sends, and nothing else (never a model). */
export function editBody({ op, instruction, mask, aspect } = {}) {
  const out = { op };
  if (typeof instruction === 'string' && instruction.trim()) out.instruction = instruction.trim();
  if (typeof mask === 'string' && mask) out.mask = mask;
  if (typeof aspect === 'string' && aspect) out.aspect = aspect;
  return out;
}

export const deckImageEditsApi = {
  quote: (uid, ask) => post(`/decks/images/${enc(uid)}/edit/quote`, editBody(ask)),
  edit: (uid, ask) => post(`/decks/images/${enc(uid)}/edit`, editBody(ask)),
  revert: (uid) => post(`/decks/images/${enc(uid)}/revert`),
};
