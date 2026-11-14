// D1563 (#3810, deck v2 D2) — Start from › Import a document (pd1).
// Worker: routes/deck_imports.ts over services/deckExtract.ts (outline) and
// services/decks/pptxCards.ts (cards, through D11's shared .pptx parser).
//   POST /api/decks/imports?project_id=   { text, audience? } | multipart `file` (.docx, .pdf, .pptx) and `audience`
//        → { kind: 'outline', source, proposal, proposal_hash, outline: { rows, proposed_by }, counts }
//        → { kind: 'cards', source: 'pptx', proposal, proposal_hash, counts }
//        400 text_required · 413 too_large · 415 file_type · 422 unreadable | empty | not_a_pptx | no_slides
//        404 not_switched_on (a .pptx while HQ's deck:pptx_import is off)
import { request } from '../api.js';

export const deckImportsApi = {
  importDocument: (projectId, { file = null, text = null, audience = null } = {}) => {
    const path = `/decks/imports?project_id=${encodeURIComponent(projectId)}`;
    if (file) {
      const body = new FormData();
      body.append('file', file);
      if (audience) body.append('audience', audience);
      return request(path, { method: 'POST', body });
    }
    return request(path, { method: 'POST', body: JSON.stringify({ text: text ?? '', ...(audience ? { audience } : {}) }) });
  },
};
