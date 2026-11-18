/**
 * D6909 part 4 (#6909, canvas PRM20 and PRM22): the words and rules of Eadwyn's drafts on a mark request, as plain
 * functions so every sentence is testable. `MarkDrafts.jsx` draws them.
 *
 * Eadwyn drafts; the member decides. The investor's reason only fills the reason field (Eadwyn never sends a
 * request). HQ's proposal only fills the mark's Prepare step with a basis, a source and an as-of day, never a value;
 * HQ still reviews, confirms and records. Every run is quoted first and runs only on Confirm.
 */
import { aiTokens } from '../raise/pitch/newDeckModel.js';
import { basisLabel } from './portfolioModel';

export const REASON_NOTE = 'Eadwyn never sends a request.';
export const REASON_OFF = 'Eadwyn cannot draft right now. Write the reason yourself; nothing else changes.';
export const BASIS_NOTE = 'Eadwyn proposes a basis and source only, never a value.';
export const BASIS_ACCEPT_NOTE = 'Accept fills Prepare; HQ still reviews, confirms and records.';
export const BASIS_OFF = 'Eadwyn cannot propose right now. Choose the basis and source yourself; nothing else changes.';
export const NO_DRAFT = 'Eadwyn returned nothing usable, so there is no draft. Nothing changed. You were charged only for what the run used.';

/** The quote's hold, in the AI-token words every Eadwyn run uses. */
export function holdLine(quote) {
  const hold = aiTokens(quote?.hold_microusd);
  return hold ? `Holds up to ${hold} · you pay what it uses` : null;
}

/** "Sources: a · b · c", or null when the draft read nothing. */
export function sourcesLine(sources) {
  const s = (Array.isArray(sources) ? sources : []).filter(Boolean);
  return s.length ? `Sources: ${s.join(' · ')}` : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
};

/** HQ's proposal as the three facts the canvas draws: Basis, Source, As of. No value row, ever. */
export function proposalFacts(draft) {
  if (!draft) return [];
  return [
    ['Basis', basisLabel(draft.basis) || draft.basis || 'Not recorded'],
    ['Source', draft.source || 'Not recorded'],
    ['As of', dayWords(draft.as_of_date) || 'Not recorded'],
  ];
}

/** What Accept puts in the mark's Prepare: the three fields, and nothing that names a value. */
export function prepareSeed(kept) {
  if (!kept) return null;
  const seed = {};
  if (kept.basis) seed.basis = kept.basis;
  if (kept.source) seed.source = kept.source;
  if (kept.as_of_date) seed.as_of_date = kept.as_of_date;
  return Object.keys(seed).length ? seed : null;
}

/** One sentence for each refusal the drafts route sends; anything else is the generic line. */
const REFUSALS = {
  quote_required: 'The cost changed since you saw it. Check the new hold and confirm again.',
  not_held: 'You can ask Eadwyn only about a company you hold.',
  investor_only: 'Only an investor drafts a request’s reason.',
  not_open_request: 'That request is already answered.',
  not_open: 'That draft was already decided. Ask again for a new one.',
  invalid_reason: 'The reason is required, at most 2,000 characters, with no email or link.',
  invalid_basis: 'A basis, a plain source and an as-of day are needed; no value is ever taken here.',
  assist_off: 'AI assistance is off on this page. Turn it on in the rail to ask Eadwyn.',
};
export function draftError(e, off) {
  const code = e?.data?.error || e?.data?.code || e?.code || null;
  if (code === 'model_unavailable' || e?.status === 503) return off;
  if (code && REFUSALS[code]) return REFUSALS[code];
  return 'Eadwyn could not be asked. Nothing changed. Try again.';
}
