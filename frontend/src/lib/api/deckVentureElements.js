// D1543 (#3781, deck v2 B5) — the venture-record elements and the logos store.
// Worker: routes/deck_venture_elements.ts, mounted at /api/decks.
//   GET    /api/decks/:id/venture-elements[?include=cap_table]
//     → { deck_id, elements: { team_grid, team_bios, use_of_funds, round_terms, cap_table, logo_wall, interview_quote } },
//       each { available: true, blocks, bindings, model: null, label } or { available: false, code, line }
//   GET    /api/decks/:id/venture-elements/:element[?include=cap_table&detail=holders&final=1&logos=k1,k2&segment=n]
//     → one element; a gate that does not pass is a refusal whose `error` is its code (no_consent, no_permission,
//       totals_only, not_included, subject_to_counsel, quotes_not_switched_on, pick_required, not_recorded) and whose
//       message is the canvas's line.
//   GET    /api/decks/:id/logos → { deck_id, logos: [{ logo_key, customer_name, image_uid, image_url, permitted, permission_reference, permitted_at }] }
//   POST   /api/decks/:id/logos { customer_name, image_uid, permitted?, permission_reference? } → { logo }
//   PATCH  /api/decks/:id/logos/:key { permitted, permission_reference? } → { logo }
//   DELETE /api/decks/:id/logos/:key → { deleted: true }
// Every value is the venture's record; no model runs. Read through `deckV2Adapter.ventureElements`.
import { request } from '../api.js';

const base = (deckId) => `/decks/${encodeURIComponent(deckId)}`;

/** The query an element read takes; only what was asked for is sent. */
function query({ includeCapTable, holders, final, logos, segment } = {}) {
  const q = new URLSearchParams();
  if (includeCapTable) q.set('include', 'cap_table');
  if (holders) q.set('detail', 'holders');
  if (final) q.set('final', '1');
  if (Array.isArray(logos) && logos.length) q.set('logos', logos.join(','));
  if (Number.isInteger(segment) && segment > 0) q.set('segment', String(segment));
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

export const deckVentureElementsApi = {
  list: (deckId, opts) => request(`${base(deckId)}/venture-elements${query(opts)}`),
  element: (deckId, element, opts) => request(`${base(deckId)}/venture-elements/${encodeURIComponent(element)}${query(opts)}`),
  logos: (deckId) => request(`${base(deckId)}/logos`),
  addLogo: (deckId, body) => request(`${base(deckId)}/logos`, { method: 'POST', body: JSON.stringify(body) }),
  setLogoPermission: (deckId, key, body) => request(`${base(deckId)}/logos/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeLogo: (deckId, key) => request(`${base(deckId)}/logos/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};
