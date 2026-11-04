/**
 * D3724 (#3724) — THE SEAM between My events and the recommendation and cover
 * routes that are not on main yet.
 *
 * Every function answers `{ available: true, value }` or `{ available: false,
 * reason }`. Nothing here may claim "no recommendations" on its own: an empty
 * list is a fact only the Worker states.
 *
 * STILL UNAVAILABLE, one-line bodies until their routes land (D3724 §gaps).
 * Each builder adds the method to `frontend/src/lib/api/eventRecommendations.js`
 * in the same PR as the route, and replaces only the matching body:
 *
 *   D1487 (Part A)  recommended · prefs · savePrefs · feedback
 *                   GET /api/events/recommended, GET|PUT /api/events/recommendation-prefs,
 *                   POST /api/events/:id/recommendation-feedback
 *   D1488 (Part C)  explainQuote · explain
 *                   POST /api/events/:id/recommendation/explain/quote, …/explain
 *   Part E          uploadCover (R2 with the three crops, alt text, its source)
 *                   drawVariants (four variants per draw)
 *
 * The single drawn cover is NOT behind this seam: `POST /api/events/:id/cover/quote`
 * and `…/cover/draw` landed with #3935 and the editor calls them directly.
 *
 * NO CLIENT METHOD IS ADDED HERE OR IN `lib/api` FOR A ROUTE THAT DOES NOT
 * EXIST: the drift test (`scripts/check-api-drift.mjs`) resolves every one.
 */

export const RECS_OFF_REASON = 'Recommendations aren’t switched on yet.';
export const COVER_UPLOAD_OFF = 'Uploading a cover isn’t switched on yet. Paste an image link, or draw one with Eadwyn.';
export const VARIANTS_OFF = 'Four variants at once aren’t switched on yet. Each draw makes one image.';

export const unavailable = (reason) => ({ available: false, reason });

export const recommended = async () => unavailable(RECS_OFF_REASON);
export const prefs = async () => unavailable(RECS_OFF_REASON);
export const savePrefs = async () => unavailable(RECS_OFF_REASON);
export const feedback = async () => unavailable(RECS_OFF_REASON);
export const explainQuote = async () => unavailable(RECS_OFF_REASON);
export const explain = async () => unavailable(RECS_OFF_REASON);
export const uploadCover = async () => unavailable(COVER_UPLOAD_OFF);
export const drawVariants = async () => unavailable(VARIANTS_OFF);
