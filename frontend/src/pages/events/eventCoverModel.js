/**
 * D3724 (#3724 Part E, board NE2): the New event cover step's rules and words.
 * `EventCoverStep.jsx` draws them. Uploading and four variants wait for their
 * routes (D3724 §gaps); one drawn cover per press is #3935's and works today.
 */

export const COVER_MIN = Object.freeze({ width: 1200, height: 675 });
export const COVER_TYPES = Object.freeze(['image/jpeg', 'image/png']);
export const COVER_RULE = 'Eadwyn does not draw real people. Logos and speaker photos are uploads only.';
export const TOO_SMALL = `The image is too small. Use one at least ${COVER_MIN.width} × ${COVER_MIN.height} pixels.`;
export const WRONG_TYPE = 'Use a JPG or PNG image.';
export const SAVE_FIRST = 'Save the event first, then draw its cover.';

/** NE2's crops, in the board's order. */
export const COVER_RATIOS = Object.freeze([
  { key: 'card', label: 'Card 16:9', ratio: 16 / 9 },
  { key: 'social', label: 'Social 1.91:1', ratio: 1.91 },
  { key: 'square', label: 'Square', ratio: 1 },
]);

/** NE2's style chips and text overlays. */
export const COVER_STYLES = Object.freeze([
  { key: 'photo', label: 'Photo', words: 'a photograph' },
  { key: 'illustration', label: 'Illustration', words: 'a flat illustration' },
  { key: 'abstract', label: 'Abstract', words: 'an abstract composition' },
  { key: 'typographic', label: 'Typographic', words: 'a typographic poster with no lettering of its own' },
]);
export const COVER_OVERLAYS = Object.freeze([
  { key: 'none', label: 'No text' },
  { key: 'title_date', label: 'Title and date' },
]);

/** A chosen file, checked before anything is sent. `{ ok, error? }`. */
export function checkCoverFile({ type, width, height } = {}) {
  if (!COVER_TYPES.includes(type)) return { ok: false, error: WRONG_TYPE };
  if (!(Number(width) >= COVER_MIN.width && Number(height) >= COVER_MIN.height)) return { ok: false, error: TOO_SMALL };
  return { ok: true };
}

/**
 * The prompt Eadwyn starts from, written from the event's own fields (title,
 * summary, type, city). The member edits it before pricing. No person's name
 * goes in: the press refuses real people anyway.
 */
export function coverPrompt(form = {}, { style = 'photo', overlay = 'none' } = {}) {
  const s = COVER_STYLES.find((x) => x.key === style) || COVER_STYLES[0];
  const type = String(form.type || 'event').replace(/_/g, ' ');
  const bits = [`${s.words} for a ${type}`];
  const title = String(form.title || '').trim();
  if (title) bits.push(`about “${title.slice(0, 120)}”`);
  const summary = String(form.summary || '').trim();
  if (summary) bits.push(summary.slice(0, 200));
  const city = String(form.location_kind === 'virtual' ? '' : form.location_text || '').trim();
  if (city) bits.push(`set in ${city.slice(0, 80)}`);
  bits.push('no people, no faces, no logos');
  if (overlay === 'title_date') bits.push('leave calm space at the top left for a title and date');
  return bits.join(', ').slice(0, 600);
}
