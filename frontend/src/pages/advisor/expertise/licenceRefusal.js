/**
 * #5363 — the Advisor licence refusal, read the same way on every advisor zone.
 *
 * Every advisor `/me/*` route answers 403 `advisor_licence_required` for an
 * account without the Advisor licence (a revoked additional licence, a
 * demotion). That is not a failed read: reading again cannot change it, so a
 * zone says what it needs and offers no Try again (`ZoneBody` in `kit.jsx`).
 * Plain JS so `pages.js` and the models can use it without the JSX kit.
 */
export const ADVISOR_LICENCE_REQUIRED = 'advisor_licence_required';

export const LICENCE_SENTENCES = Object.freeze({
  expertise: 'Expertise needs the Advisor licence on this account.',
  practice: 'Practice needs the Advisor licence on this account.',
});

const SENTENCES = new Set(Object.values(LICENCE_SENTENCES));

/** True when `error` is one of the licence sentences: `ZoneBody` drops its retry. */
export const isLicenceSentence = (error) => SENTENCES.has(error);

/**
 * The sentence a zone shows for a failed read: the surface's licence sentence
 * for the coded refusal, otherwise `fallback`. Never the thrown error's text
 * for the licence case.
 */
export const zoneError = (err, fallback, surface = 'expertise') =>
  (err?.code === ADVISOR_LICENCE_REQUIRED ? LICENCE_SENTENCES[surface] : fallback);
