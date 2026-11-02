import { chargeLine, costLine, proposalCard, refusalState, stateBlock } from '../../ui/askPanelModel.js';

/**
 * D1493 (#3906, SY8) — Ask proposes a channel's title and description, on the
 * event editor's Other channels list. The rules, pure, so the section draws
 * them and the tests read them without a DOM.
 *
 *   · Ask is offered on a listing the event has saved and kept on, and is not
 *     posted yet. A suggested row with no listing is not saved, so an Accept
 *     there would tick a channel nobody ticked; a posted one is not re-sent.
 *   · Eadwyn's answer is cards: Accept, Edit, Discard, and "Accept all (n)"
 *     from two cards up. Nothing is written until one is accepted.
 *   · Accept decides the proposal, then the page saves it with Part A's
 *     `PUT /api/events/:id/syndication`, keeping the listing on and the
 *     channel's other saved copy as it was.
 *   · No suggestion chips (#3706 AK19).
 */

export const ASK_SYNDICATION = 'Ask Eadwyn for this channel’s copy';
export const ASK_PROPOSE = 'Propose a title and description';
export const ASK_FOOT_SYNDICATION = 'Nothing is written until you accept. Accepting saves the copy to this channel; posting still waits for Approve and publish.';
export const NOT_READ = 'Other channels could not be read.';
export const SAVE_FAILED = 'Accepted, but the copy could not be saved to the channel. Try again.';

const FIELD_LABEL = { title: 'Title', description: 'Description' };

/** The rows Ask is offered on (see the header). */
export function askableRows(read) {
  if (!read || !read.eligible || !Array.isArray(read.rows)) return [];
  return read.rows.filter((r) => r && r.uid && r.on === true && r.status !== 'posted' && r.account_uid);
}

/** One card from a proposal row: its words from the Ask panel, plus the field and value it saves. */
export function syndicationCard(row) {
  const p = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const field = p.field === 'title' || p.field === 'description' ? p.field : null;
  const value = typeof p.value === 'string' ? p.value : '';
  return { ...proposalCard(row), eyebrow: FIELD_LABEL[field] || 'Proposal', field, value, account_uid: String(p.account_uid ?? ''), payload: p };
}

/**
 * The PUT body that saves accepted values to one listing: kept on, its other
 * saved copy kept, the accepted fields replaced. `values` is { title?, description? }.
 */
export function savedChannels(row, values) {
  const kept = row?.overrides && typeof row.overrides === 'object' ? row.overrides : {};
  const fresh = {};
  for (const k of ['title', 'description']) if (typeof values?.[k] === 'string' && values[k].trim()) fresh[k] = values[k];
  return [{ account_uid: row.account_uid, on: true, overrides: { ...kept, ...fresh } }];
}

/** The line under the button before a run: the hold, or why Eadwyn cannot run here. */
export function quoteLine(quote) {
  if (!quote) return costLine(null);
  if (quote.ai) return costLine(quote.hold_microusd);
  return typeof quote.message === 'string' && quote.message ? quote.message : 'Eadwyn cannot run here.';
}

/** A run's charge, as the Ask panel words it. */
export function runCharge(cost, quote) {
  return chargeLine(cost?.charged_microusd ?? null, quote?.ai ? quote.hold_microusd : null);
}

/** A refused run's headline and line, from the Ask panel's states; the Worker's own sentence when it sent one. */
export function runRefusal(err) {
  const block = stateBlock(refusalState(err));
  const said = typeof err?.data?.message === 'string' ? err.data.message : null;
  return { title: block?.title || 'Eadwyn could not answer.', line: said || block?.line || 'Nothing was written.' };
}
