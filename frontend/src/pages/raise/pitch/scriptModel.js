/**
 * D4268 (#4268, D4254 P2a) — the words and numbers of Script & rehearsal ›
 * Script (canvas ps4, ps9b, ps4-d). Pure: no network, no React.
 *
 * A card's budget is Rehearse's split of the pitch length (`cardBudgetsMs`,
 * D1580), so Script, Rehearse and Present agree on every card. A card's
 * spoken time is its words at the pace the Worker used: the founder's latest
 * rehearsal, or 150 words a minute (`routes/deck_script.ts`).
 */
import { aiTokens } from './newDeckModel.js';
import { cardBudgetsMs, clock } from './rehearseModel.js';

export const LENGTHS = Object.freeze([
  { seconds: 120, label: '2 min' },
  { seconds: 180, label: '3 min' },
  { seconds: 300, label: '5 min' },
]);
export const AUDIENCES = Object.freeze([
  { id: 'investor_meeting', label: 'Investor meeting' },
  { id: 'demo_day', label: 'Demo day' },
  { id: 'partner', label: 'Partner' },
]);
export const TONES = Object.freeze([
  { id: 'clear', label: 'Clear' },
  { id: 'warm', label: 'Warm' },
  { id: 'bold', label: 'Bold' },
]);
export const DEFAULT_LENGTH = 180;
export const DEFAULT_WPM = 150;
export const NOTES_MAX = 4000;

export const RULE = 'The script uses only the figures on each card.';
export const EMPTY = 'No script yet. Write it here, or generate it.';
export const FAILED = 'Couldn’t generate this card’s script.';
export const STALE = 'This card’s notes changed after the script was generated.';
export const NO_DECK = 'There is no deck yet. Build one, and its script is written here, card by card.';
export const NO_UID = 'Save this deck in the editor once, then its script can be saved here.';
export const DOWNLOAD_NOTE = 'Download is a .txt file.';
export const CONFLICT = 'This deck was saved somewhere else. Reload to see the current version; your script is kept until you leave.';

/** Why one card failed, in a sentence, beside "Couldn’t generate this card’s script." */
export const FAIL_REASON = Object.freeze({
  figure_added: 'Its draft named a figure that is not on the card, so it was left out. It cost nothing.',
  link_added: 'Its draft added a link the card does not have, so it was left out. It cost nothing.',
  guarantee_language: 'Its draft promised a return, so it was left out. It cost nothing.',
  empty: 'The draft came back empty. It cost nothing.',
  model_failed: 'The model did not answer for this card. It cost nothing.',
  no_words: 'This card has no words to script yet.',
});
export const failReason = (reason) => FAIL_REASON[reason] || 'It cost nothing.';

/** The words in a text, as the Worker counts them. */
export const wordsOf = (text) => (typeof text === 'string' ? text.trim().split(/\s+/).filter(Boolean).length : 0);

/** The seconds a text takes at `wpm`. */
export const spokenS = (words, wpm) => (words > 0 ? Math.round((words * 60) / (Number(wpm) > 0 ? Number(wpm) : DEFAULT_WPM)) : 0);

/** Each card's budget in whole seconds: Rehearse's split. */
export const budgetsS = (lengthS, cardCount) => cardBudgetsMs(lengthS, cardCount).map((ms) => ms / 1000);

/** "0:34 of 0:25". */
export const timeLine = (spentS, budgetS) => `${clock(spentS * 1000)} of ${clock(budgetS * 1000)}`;

/** "38 words · 0:15 of 0:15". */
export const sectionLine = (words, spentS, budgetS) => `${words} word${words === 1 ? '' : 's'} · ${timeLine(spentS, budgetS)}`;

/** "9 s over this card’s budget", or null when it fits. */
export const overLine = (spentS, budgetS) => (spentS > budgetS ? `${spentS - budgetS} s over this card’s budget` : null);

/** "Estimated 3:20 · target 3:00 · 9 of 12 cards". */
export const headerLine = ({ spentS, lengthS, scripted, cards }) => `Estimated ${clock(spentS * 1000)} · target ${clock(lengthS * 1000)} · ${scripted} of ${cards} card${cards === 1 ? '' : 's'}`;

/** "1 card not saved", or null when every card is saved. */
export const unsavedLine = (n) => (n > 0 ? `${n} card${n === 1 ? '' : 's'} not saved` : null);

/** "Holds up to $0.0100 · you pay what it uses", or null before the quote is read. */
export function holdLine(quote) {
  const hold = quote?.ai ? aiTokens(quote.hold_microusd) : null;
  return hold ? `Holds up to ${hold} · you pay what it uses` : null;
}

/** "Generated · [model]". */
export const generatedLine = (model) => (model ? `Generated · ${model}` : 'Generated');

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayOf = (at) => {
  const d = at ? new Date(`${String(at).replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(String(at)) ? '' : 'Z'}`) : null;
  return d && !Number.isNaN(d.getTime()) ? DAY.format(d) : null;
};

/** Where the pace came from, in a line. */
export function paceLine(pace) {
  if (!pace?.wpm) return null;
  if (pace.source === 'rehearsal') {
    const day = dayOf(pace.rehearsal_at);
    return `Paced at ${pace.wpm} words a minute, from your rehearsal${day ? ` on ${day}` : ''}.`;
  }
  return `Paced at ${pace.wpm} words a minute. Rehearse once and the script is paced to you.`;
}

/** What Match my last rehearsal sets: the last rehearsal's pitch length, or null when there is none to match. */
export const rehearsalLength = (pace) => (pace?.source === 'rehearsal' && LENGTHS.some((l) => l.seconds === pace.pitch_seconds) ? pace.pitch_seconds : null);

/**
 * A card's words and figures, as the run reads them, so a script generated
 * from one version can tell when the card changed under it.
 */
export function fingerprint(slide) {
  const blocks = Array.isArray(slide?.blocks) ? slide.blocks : [];
  const words = blocks.map((b) => (b?.kind === 'metric' ? `${b.label ?? ''}:${b.value ?? ''}` : b?.kind === 'text' ? String(b.text ?? '') : '')).filter(Boolean);
  const s = [String(slide?.title ?? ''), ...words].join('\u0001');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Whether a card's saved script is out of date: it was generated from words
 * the card no longer has. `from` is the fingerprint recorded when it was saved.
 */
export const isStale = (slide, from) => Boolean(from) && Boolean(String(slide?.notes ?? '').trim()) && fingerprint(slide) !== from;

/** The whole script as text, card by card, for Copy and Download. */
export function scriptText(title, rows) {
  const head = `${String(title || 'Pitch deck').trim()} · Script`;
  const body = rows.map((r, i) => `${i + 1}. ${String(r.title || 'Untitled card').trim()}\n\n${String(r.text || '').trim() || '(No script yet.)'}`);
  return `${head}\n\n${body.join('\n\n')}\n`;
}

/** The .txt file's name. */
export const fileName = (title) => `${(String(title || 'pitch-deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pitch-deck').slice(0, 60)}-script.txt`;

/** The card's label in the phone picker: "2 · Problem". */
export const cardLabel = (slide, i) => `${i + 1} · ${String(slide?.title || '').trim() || 'Untitled card'}`;
