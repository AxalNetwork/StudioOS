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
//
// D1534 (#3778 phase 2): the AI image tools, whose result is a child image too.
//   GET  /api/decks/images/tools                  → { tools: [{ tool, on, model, model_label, usd_per_image, message }] }
//   POST /api/decks/images/:uid/tools/:tool/quote → { ai: true, tool, label, model, model_label, hold_microusd, balance }
//                                                 | { ai: false, reason, message }
//   POST /api/decks/images/:uid/tools/:tool       → { image, parent_uid, tool, cost } (an `Idempotency-Key` keeps a retry from charging twice)
// `tool` is 'remove_background' or 'upscale'; off is 503 `image_tool_off`.
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
  tools: () => request('/decks/images/tools'),
  /** The tools, when at least one is on; else a 503 `image_tool_off` with the Worker's sentence ("Coming later"). */
  liveTools: async () => {
    const r = await request('/decks/images/tools');
    const tools = Array.isArray(r?.tools) ? r.tools : [];
    if (tools.some((t) => t?.on === true)) return { tools };
    const e = new Error(tools.find((t) => t?.message)?.message || 'Coming later.');
    e.status = 503; e.code = 'image_tool_off';
    throw e;
  },
  toolQuote: (uid, tool) => post(`/decks/images/${enc(uid)}/tools/${enc(tool)}/quote`),
  runTool: (uid, tool, key) => request(`/decks/images/${enc(uid)}/tools/${enc(tool)}`, {
    method: 'POST', body: '{}', headers: key ? { 'Idempotency-Key': String(key) } : undefined,
  }),
};
