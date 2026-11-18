/**
 * D6897 part 3 (#6897, canvas D6054 RA-27 A and RA-30): the words and rules of Eadwyn's drafts for Share outside Axal,
 * as plain functions so every sentence is testable. `ShareDrafts.jsx` draws them.
 *
 * Eadwyn proposes; the founder decides. A pack draft only ticks rows in the composer (the founder still makes the
 * pack); a covering-line draft only fills the snapshot's field, labelled as the founder's. Nothing is sent, shared or
 * changed by a draft. Every run is quoted first and runs only when the founder confirms the hold.
 */
import { aiTokens } from '../../raise/pitch/newDeckModel.js';
import { itemTitle } from './evidenceView';

export const PACK_NOTE = 'Proposes a selection for one reader. It never adds a Private item and never changes sharing.';
export const PACK_ACCEPT_NOTE = 'Proposals never change a record until you accept them. Accepting only ticks rows; you still create the pack.';
export const PACK_OFF = 'Eadwyn is unavailable right now. The pack works without a proposal. Choose items yourself; nothing is lost.';
export const LINE_NOTE = 'Eadwyn drafts. You accept, edit or discard; nothing is added by itself.';
export const LINE_OFF = 'Eadwyn is unavailable right now. Write the line yourself, or leave it out; the snapshot works without it.';
export const NO_DRAFT = 'Eadwyn returned nothing usable, so there is no draft. Nothing was added. You were charged only for what the run used.';
export const AUDIENCE_MAX = 120;

/** The quote's hold, in the AI-token words every Eadwyn run uses. */
export function holdLine(quote) {
  const hold = aiTokens(quote?.hold_microusd);
  return hold ? `Holds up to ${hold} · you pay what it uses` : null;
}

/** Who the pack is for: required, one short line. Null when it can be asked, else the sentence. */
export function audienceProblem(audience) {
  const a = String(audience ?? '').trim();
  if (!a) return 'Say who the pack is for, for example “Seed fund partner: traction and use of funds”.';
  if (a.length > AUDIENCE_MAX) return `Keep it to ${AUDIENCE_MAX} characters.`;
  if (/[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/|www\./i.test(a)) return 'Leave out emails and links; Eadwyn needs only who reads it and what they look for.';
  return null;
}

/**
 * The pack draft's rows against the composer's rows now: each proposed item with its reason, and whether the
 * composer can still tick it. An item no longer in the preview (made Private, or gone) says so and is never ticked.
 */
export function proposedRows(draft, previewRows) {
  const byUid = new Map((Array.isArray(previewRows) ? previewRows : []).map((r) => [r.uid, r]));
  return (Array.isArray(draft?.items) ? draft.items : []).map((i) => {
    const row = byUid.get(i.uid);
    return {
      uid: i.uid,
      title: row ? itemTitle(row) : 'An item no longer shared',
      area: row?.area || null,
      reason: i.reason,
      available: !!row,
    };
  });
}

/** What Accept did, in words: how many rows it ticked and how many it could not. */
export function tickedLine(tick, dropped) {
  const n = Array.isArray(tick) ? tick.length : 0;
  const ticked = `Ticked ${n} ${n === 1 ? 'row' : 'rows'}. You can still change any row.`;
  return dropped ? `${ticked} ${dropped} ${dropped === 1 ? 'item is' : 'items are'} no longer shared, so not ticked.` : ticked;
}

/** One sentence for each refusal the drafts route sends; anything else is the generic line. */
const REFUSALS = {
  quote_required: 'The cost changed since you saw it. Check the new hold and confirm again.',
  invalid_audience: 'Say who the pack is for, in one short line with no email or link.',
  empty: 'Nothing is shared beyond Private yet, so there is nothing to propose. Share an item first.',
  evidence_unreadable: 'The evidence could not be read, so Eadwyn was not asked. Nothing was charged.',
  model_unavailable: null,
  not_open: 'That draft was already decided. Ask again for a new one.',
  draft_stale: 'None of these items can be shared now, so nothing was ticked. Discard it and ask again.',
  invalid_line: 'A covering line is one sentence of at most 200 characters, with no email or link.',
  assist_off: 'AI assistance is off on this page. Turn it on in the rail to ask Eadwyn.',
};
export function draftError(e, off) {
  const code = e?.data?.error || e?.code || null;
  if (code === 'model_unavailable' || e?.status === 503) return off;
  if (code && REFUSALS[code]) return REFUSALS[code];
  return 'Eadwyn could not be asked. Nothing changed. Try again.';
}
