// D898 (#2676, part 4 of #2434) — what the Pitch deck editor reads besides the
// deck itself. Worker: routes/decks.ts over services/decks/slideModel.ts and
// services/decks/videoLink.ts.
//   GET /api/decks/model
//       → { grid: { cols, rows }, max_blocks, notes_max, layouts: [{ id, label, blocks }],
//           block_kinds, chart_types, chart_ranges, text_styles, image_tags,
//           video_ratios, audiences, themes }
//   GET /api/decks/video-link?url=
//       → { state: 'ok', provider, video_id, url, title, poster_url }
//         400 not YouTube or Vimeo · 404 not public · 503 could not be checked
//   GET /api/decks/brand-kit?project_id=
//       → { project_id, kit: null | { name, palette: { bg, ink, accent, secondary }, fonts,
//           voice: [tag], logo: { light, dark, inline }, updated_at } }   503 unreadable
// The deck is read and saved through api.js's deckGet and deckUpdate.
import { request } from '../api.js';

export const deckEditorApi = {
  model: () => request('/decks/model'),
  brandKit: (projectId) => request(`/decks/brand-kit?project_id=${encodeURIComponent(projectId)}`),
  videoLink: (url) => request(`/decks/video-link?url=${encodeURIComponent(url)}`),
};
