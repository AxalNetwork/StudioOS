/**
 * D1569 (#3816, deck v2 D8) — the AI voice-over, pure: its words, the label
 * every player shows, and what each step of the sheet says. `VoiceSheet.jsx`,
 * `PitchPresent.jsx` and the share viewer draw it.
 *
 * The audio is always labelled "AI voice" (owner rule). It is made from the
 * card's script (its speaker notes), quoted and held before the run, and saved
 * on the deck only when the founder accepts it.
 */
export const VOICE_LABEL = 'AI voice';
export const VOICE_TITLE = 'AI voice-over';
export const VOICE_LINE = 'Reads this card\'s script aloud in an AI voice. You hear it first; it is saved on the deck only when you accept it.';
export const NO_SCRIPT = 'This card has no script yet. Write its script (its speaker notes) first.';
export const SAVE_FIRST = 'Save your version first: an accepted voice-over is saved as a new version.';
export const MAKE = 'Make the voice-over';
export const ACCEPT = 'Accept';
export const DISCARD = 'Discard';
export const ACCEPTED = 'Accepted. The voice-over is on this card in a new version.';
export const DISCARDED = 'Discarded. Nothing was saved.';
export const NOT_SAVED = 'Not saved';
const VOICE_PATH = '/api/decks/voice/';

/** "$0.0004" for a hold in micro-dollars; null when the figure is not a number. */
export function holdText(micro) {
  const n = Number(micro);
  if (micro == null || micro === '' || !Number.isFinite(n) || n < 0) return null;
  const usd = n / 1e6;
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** The quote's line: the model and what is held, or the reason nothing can run. */
export function quoteLine(q) {
  if (!q) return null;
  if (q.ai !== true) return { ok: false, text: String(q.message || 'The voice is not available right now.') };
  if (q.balance && q.balance.ok === false) return { ok: false, text: String(q.balance.message || 'Your balance does not cover this voice-over.') };
  const hold = holdText(q.hold_microusd);
  return { ok: true, text: `${VOICE_LABEL} · ${q.model || 'the voice model'}${hold ? ` · holds ${hold} until it is made` : ''}` };
}

/** Whether a card has a script to speak. */
export const hasScript = (card) => typeof card?.notes === 'string' && card.notes.trim().length > 0;

/** The link that plays this card's accepted voice-over, from `GET /api/decks/:id/voice`, or null. */
export function voiceUrlFor(read, cardUid) {
  const hit = (read?.cards || []).find((x) => x?.card_uid === cardUid);
  return typeof hit?.url === 'string' && hit.url.startsWith(VOICE_PATH) ? hit.url : null;
}

/** A share reader's card voice: the signed link and its label, or null. */
export function sharedVoice(card) {
  const v = card?.voice;
  return v && typeof v.url === 'string' && v.url.startsWith(VOICE_PATH) ? { url: v.url, label: VOICE_LABEL } : null;
}
