/**
 * D3724 (#3724) — THE SEAM between My events and the recommendation routes.
 * #4738 connects it: D1487's four routes and D1488's two are live and wrapped
 * by `eventRecommendationsApi`, and each function below makes exactly that
 * call.
 *
 * Every function answers `{ available: true, value }` or `{ available: false,
 * reason, code, status, field, unreadable, stale }`. The reason is the Worker's
 * own sentence, or a plain one of ours; `e.message` is never shown (D278). An
 * empty list is a fact only the Worker states: a read that fails answers
 * `unreadable: true`, which the row draws as "could not be read", never as
 * "nothing to recommend".
 *
 *   recommended(limit)        GET  /api/events/recommended?limit=
 *   prefs()                   GET  /api/events/recommendation-prefs
 *   savePrefs(form)           PUT  /api/events/recommendation-prefs  (the form, as the Worker's prefs)
 *   feedback(id, { verdict, reason })
 *                             POST /api/events/:id/recommendation-feedback
 *   explainQuote(id)          POST /api/events/:id/recommendation/explain/quote
 *   explain(id, quoteUid)     POST /api/events/:id/recommendation/explain
 *                             (D4450: the quote's `quote_uid` is the Idempotency-Key)
 *
 * STILL UNAVAILABLE, one-line bodies until their routes land (D3724 §gaps):
 * Part E — `uploadCover` (R2 with the three crops, alt text, its source) and
 * `drawVariants` (four variants per draw). The single drawn cover is NOT behind
 * this seam: `POST /api/events/:id/cover/quote` and `…/cover/draw` landed with
 * #3935 and the editor calls them directly.
 *
 * NO CLIENT METHOD IS ADDED HERE OR IN `lib/api` FOR A ROUTE THAT DOES NOT
 * EXIST: the drift test (`scripts/check-api-drift.mjs`) resolves every one.
 */
import { readRefusal } from '../../lib/api.js';
import { eventRecommendationsApi as api } from '../../lib/api/eventRecommendations.js';
import { formToPrefs } from './recommendationsModel.js';

export const COVER_UPLOAD_OFF = 'Uploading a cover isn’t switched on yet. Paste an image link, or draw one with Eadwyn.';
export const VARIANTS_OFF = 'Four variants at once aren’t switched on yet. Each draw makes one image.';
export const PLAIN_REFUSAL = 'That did not go through. Try again.';
export const DEFAULT_LIMIT = 8;

/** What the Worker's `bad_field` / `too_long` answers mean, by field, in the member's words. */
export const FIELD_WORDS = Object.freeze({
  interests: 'Pick up to ten of the listed topics.',
  goals_90d: 'Goals can be at most 500 characters.',
  home_city: 'Home city can be at most 120 characters.',
  travel_km: 'Travel range is a distance in kilometres, from 0 to 20,000.',
  formats: 'Pick from Online, In person and Hybrid.',
  types: 'Pick from the listed event types.',
  enabled: 'Recommendations are either on or off.',
});

export const unavailable = (reason) => ({ available: false, reason });

/** An error from the client as an answer: the Worker's sentence or a plain one, never `e.message`. */
export function refusal(e) {
  const { message, code } = readRefusal(e?.data);
  const status = Number.isInteger(e?.status) ? e.status : null;
  const field = typeof e?.data?.field === 'string' ? e.data.field : null;
  const ours = (code === 'bad_field' || code === 'too_long') && FIELD_WORDS[field] ? FIELD_WORDS[field] : null;
  const theirs = message && message !== code ? message : null;
  return {
    available: false,
    reason: ours || theirs || PLAIN_REFUSAL,
    code: code || null,
    status,
    field,
    // A read that did not answer is not an empty one.
    unreadable: code === 'unreadable' || status === null || status >= 500,
    stale: code === 'quote_stale',
  };
}

const through = async (call) => {
  try { return { available: true, value: await call() }; } catch (e) { return refusal(e); }
};

/** Accepts the limit as a number or as `{ limit }`; the client sends a number. */
const limitOf = (arg) => {
  const n = Number(typeof arg === 'object' && arg !== null ? arg.limit : arg);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_LIMIT;
};

export const recommended = (arg) => through(() => api.recommended(limitOf(arg)));
export const prefs = () => through(() => api.prefs());
export const savePrefs = (form) => through(() => api.savePrefs(formToPrefs(form)));
export const feedback = (id, body = {}) => through(() => api.feedback(id, body.verdict ?? null, body.reason));
export const explainQuote = (id) => through(() => api.quote(id));
export const explain = (id, quoteUid) => (quoteUid
  ? through(() => api.explain(id, quoteUid))
  : Promise.resolve({ ...refusal({ data: { error: 'quote_stale' }, status: 409 }), reason: 'Get the price first.' }));
export const uploadCover = async () => unavailable(COVER_UPLOAD_OFF);
export const drawVariants = async () => unavailable(VARIANTS_OFF);
