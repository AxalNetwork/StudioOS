import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import Sheet from '../../../ui/Sheet';
import { Eyebrow, NotRecorded } from '../../../workspaces/canvasKit';
import { ballotOf, ownRecusal } from '../../icDecisionModel';

/**
 * Deals · Commit on a phone — board DE27 of the Deals v2 addendum (D6141), part 3 of #6151 (D6151-p3).
 *
 * Below 768px the Investment committee page draws the decision in front of the committee as one column, from
 * the same `GET /api/ic/commit-room` read as the desktop page (DE07), which stays from 768px up:
 *
 *   · the title and its stage (Voting, or Opened with no vote cast yet), and "Outcome not decided yet";
 *   · the memo, which the committee read does not carry, as a link to the decision record that does;
 *   · the tally, Yes · No · Abstain, with Recused beside it and never in it (D461);
 *   · who has voted against the decision's roster (D6143), or that no roster is set;
 *   · one card per vote, with its rationale, or Not recorded, or the conflict a recusal declared;
 *   · the conditions, an open one linking to Closing, where it blocks the wire;
 *   · the minutes, through the desktop page's own `MinutesCard`;
 *   · a Vote pinned to the foot of the screen, which opens a sheet: Yes, No, Abstain or Recuse, and the reason,
 *     which is required.
 *
 * THE VOTE IS `POST /api/ic/:uid/vote`, the route the decision record already uses. The sheet asks for the
 * reason before it sends, in the Worker's own words, and shows the Worker's refusal when it answers one (a roster
 * that does not name you, a decision already recorded, a recusal that stands). Vote is offered only to a role
 * that may vote, on a decision not decided, to someone the roster names (or on a decision with no roster), and
 * not to someone who has recused: a recusal is final.
 */

/** Who may vote here, and why not. Mirrors the Worker's checks on `POST /api/ic/:uid/vote`. */
export function phoneVoteState(user, decision) {
  if (!user || user.id == null) return { canVote: false, reason: 'Sign in to vote.' };
  if (!['admin', 'partner', 'investor'].includes(String(user.role || '').toLowerCase())) {
    return { canVote: false, reason: 'Investment committee is for investors, partners and admins.' };
  }
  if (!decision || decision.status === 'decided') {
    return { canVote: false, reason: 'Voting is closed because this decision has been recorded.' };
  }
  if (ownRecusal(user, decision.votes)) {
    return { canVote: false, reason: 'You recused yourself from this decision. A recusal is final.' };
  }
  const roster = decision.roster;
  if (roster?.available && !(roster.members || []).some((m) => Number(m.user_id) === Number(user.id))) {
    return { canVote: false, reason: 'This decision has a voting roster and you are not on it.' };
  }
  return { canVote: true, reason: null };
}

/** The line under the tally: who has voted, against the roster when one is set, and whether you have. */
export function votedLine(user, decision) {
  const ballot = ballotOf(decision);
  const roster = decision?.roster;
  const who = roster?.available && Number.isFinite(Number(roster.eligible))
    ? `${ballot.voted + ballot.recused} of ${roster.eligible} eligible have voted.`
    : 'No voting roster is set, so eligible voters are not recorded.';
  const mine = user?.id != null ? (decision?.votes || []).find((v) => Number(v.user_id) === Number(user.id)) : null;
  const you = !user || user.id == null ? ''
    : !mine ? ' You have not voted.'
    : mine.vote === 'recused' ? ' You recused.'
    : ` You voted ${VOTE_LABEL[mine.vote] || mine.vote}.`;
  return `${who}${you}`;
}

const VOTE_LABEL = { yes: 'Yes', no: 'No', abstain: 'Abstain', recused: 'Recused' };
const VOTE_SIGN = { yes: '✓', no: '✕', abstain: '○', recused: '⊘' };
const CARD = 'rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900';

/** A count the read carried, or Not recorded; never a 0 it did not say. */
function count(tally, key) {
  const v = tally?.[key];
  return v == null || !Number.isFinite(Number(v)) ? null : String(Number(v));
}

export function PhoneTally({ tally }) {
  const cell = (key, label, extra = '') => (
    <div className={`min-w-0 rounded-[8px] border border-axal-hairline p-2 text-center dark:border-gray-800 ${extra}`} data-testid={`commit-phone-tally-${key}`}>
      {count(tally, key) == null
        ? <NotRecorded />
        : <b className="block font-mono text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{count(tally, key)}</b>}
      <small className="block text-[10.5px] leading-snug text-gray-600 dark:text-gray-400">{label}</small>
    </div>
  );
  return (
    <div role="group" aria-label="Tally" className="grid grid-cols-4 gap-2" data-testid="commit-phone-tally">
      {cell('yes', 'Yes')}
      {cell('no', 'No')}
      {cell('abstain', 'Abstain')}
      {cell('recused', 'Recused · not in the tally', 'border-dashed bg-gray-50 dark:bg-gray-800/40')}
    </div>
  );
}

/** One vote as a card: who, the vote in words and shape, and its reason. */
export function PhoneVoteCard({ vote }) {
  const recused = vote.vote === 'recused';
  return (
    <article className={`${CARD} ${recused ? 'border-dashed bg-gray-50 dark:bg-gray-800/40' : ''}`} data-testid={`commit-phone-vote-${vote.vote}`}>
      <div className="flex items-center justify-between gap-2">
        {vote.user_name ? <b className="truncate text-[13px] text-axal-ink dark:text-gray-100">{vote.user_name}</b> : <NotRecorded />}
        <span className={`shrink-0 text-[12px] font-bold ${recused ? 'italic text-gray-600 dark:text-gray-300' : 'text-axal-ink dark:text-gray-100'}`}>
          <span aria-hidden="true">{VOTE_SIGN[vote.vote] || ''}</span> {VOTE_LABEL[vote.vote] || vote.vote}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
        {recused
          ? (vote.rationale ? `Declared: ${vote.rationale}` : <NotRecorded>Declaration not recorded</NotRecorded>)
          : vote.rationale
          ? vote.rationale
          : <><NotRecorded>Rationale not recorded</NotRecorded> · cast before a rationale was required</>}
      </p>
    </article>
  );
}

const CONDITION_CHIP = 'inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-2.5 text-[11px] font-bold';

/** The decision's conditions as a list. An open one links to Closing, where it blocks the wire. */
export function PhoneConditions({ conditions, closingTo, control, error }) {
  return (
    <section data-testid="commit-phone-conditions">
      <Eyebrow>Conditions</Eyebrow>
      {error ? <p className="mt-1 text-[11px] text-red-700 dark:text-red-400" role="alert">{error}</p> : null}
      {conditions.length === 0
        ? <p className="mt-1.5 text-[12.5px] text-gray-600 dark:text-gray-400">No condition is recorded on this decision. Nothing here blocks Closing.</p>
        : (
          <ul className="mt-1.5 divide-y divide-axal-hairline dark:divide-gray-800">
            {conditions.map((cond) => (
              <li key={cond.uid} className="py-2" data-testid={`commit-phone-condition-${cond.status}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-[12.5px] text-gray-800 dark:text-gray-200">{cond.body}</span>
                  {cond.status === 'open'
                    ? (closingTo
                      ? <Link to={closingTo} className={`${CONDITION_CHIP} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300`} data-testid="commit-phone-condition-closing">! Open · blocks Closing ›</Link>
                      : <span className={`${CONDITION_CHIP} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300`}>! Open · blocks Closing</span>)
                    : cond.status === 'met'
                    ? <span className={`${CONDITION_CHIP} border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`}>✓ Met{cond.resolved_at ? ` · ${short(cond.resolved_at)}` : ''}</span>
                    : <span className={`${CONDITION_CHIP} border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300`}>— Waived{cond.resolved_at ? ` · ${short(cond.resolved_at)}` : ''}</span>}
                </div>
                {control ? control(cond) : null}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function short(value) {
  const ms = Date.parse(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? SHORT.format(new Date(ms)) : String(value);
}

const CHOICES = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['abstain', 'Abstain'],
  ['recused', 'Recuse · declare a conflict'],
];

/** The Vote sheet (DE27 C): a vote and its reason, both required, sent to `POST /api/ic/:uid/vote`. */
export function VoteSheet({ decision, onClose, onVoted }) {
  const [vote, setVote] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recusing = vote === 'recused';
  async function submit() {
    if (!vote) { setError('Choose Yes, No, Abstain or Recuse.'); return; }
    if (!rationale.trim()) {
      setError(recusing
        ? 'A recusal records the conflict it declares. Write the declaration as the rationale.'
        : 'Every vote records its reason. Write the rationale before voting.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.icVote(decision.uid, { vote, rationale: rationale.trim() });
      onVoted();
    } catch (cause) {
      setError(cause?.message || 'The vote could not be recorded.');
      setBusy(false);
    }
  }
  return (
    <Sheet title={`Your vote · ${decision.title || decision.uid}`} eyebrow="Vote" onClose={() => !busy && onClose()} testId="commit-vote-sheet">
      <div className="space-y-3 p-4">
        <div role="radiogroup" aria-label="Vote" className="space-y-2">
          {CHOICES.map(([value, label]) => (
            <label
              key={value}
              className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[8px] border px-3 text-[13px] ${vote === value ? 'border-axal-violet bg-violet-50 font-bold dark:border-violet-400 dark:bg-violet-950/40' : 'border-axal-hairline dark:border-gray-700'} text-axal-ink dark:text-gray-100`}
            >
              <input type="radio" name="commit-phone-vote" value={value} checked={vote === value} onChange={() => { setVote(value); setError(''); }} data-testid={`commit-vote-choice-${value}`} />
              {label}
            </label>
          ))}
        </div>
        <label className="block text-[12px] font-semibold text-axal-ink dark:text-gray-100">
          {recusing ? 'Declare the conflict' : 'Rationale'} <span className="font-normal text-gray-600 dark:text-gray-400">· required</span>
          <textarea
            rows={3}
            value={rationale}
            onChange={(e) => { setRationale(e.target.value); setError(''); }}
            maxLength={2000}
            data-testid="commit-vote-rationale"
            className="mt-1 w-full rounded-[8px] border border-gray-200 bg-white p-2.5 text-[13px] leading-relaxed text-axal-ink focus-visible:outline focus-visible:outline-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
        </label>
        <p className="text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">
          Every vote records its reason. A recusal records the conflict it declares and cannot be changed to a vote later.
        </p>
        {error ? <p className="text-[12px] text-red-700 dark:text-red-400" role="alert" data-testid="commit-vote-error">{error}</p> : null}
        <button type="button" onClick={submit} disabled={busy} data-testid="commit-vote-submit"
          className="min-h-[44px] w-full rounded-[8px] bg-axal-violet-deep px-4 text-[13px] font-bold text-white disabled:opacity-60 dark:bg-violet-500">
          {busy ? 'Recording…' : 'Record vote'}
        </button>
        <button type="button" onClick={onClose} disabled={busy}
          className="min-h-[44px] w-full rounded-[8px] px-4 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/**
 * DE27 A and B: the decision on a phone. `minutes` is the desktop page's `MinutesCard`, passed in so both widths
 * draw the same one; `control` is its Mark met / Waive; `closingTo` is null for a role Closing refuses.
 */
export function CommitPhone({ decision, user, conditions, control, conditionError, closingTo, minutes, onVoted }) {
  const [voting, setVoting] = useState(false);
  const state = phoneVoteState(user, decision);
  const votes = decision.votes ?? [];
  return (
    <div className="space-y-4 md:hidden" data-testid="commit-phone">
      <div>
        <Eyebrow>{decision.status === 'draft' ? 'Decision · Opened' : 'Decision · Voting'}</Eyebrow>
        <h2 className="mt-1 text-[19px] font-extrabold leading-tight tracking-tight text-axal-ink dark:text-gray-100">{decision.title || decision.uid}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-bold text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
            {decision.status === 'draft' ? 'Opened · no vote cast yet' : '◐ Voting'}
          </span>
          <span className="text-gray-600 dark:text-gray-400">Outcome not decided yet</span>
        </div>
      </div>
      <Link
        to={`/deals/commit/${encodeURIComponent(decision.uid)}`}
        className={`${CARD} flex min-h-[48px] items-center justify-between gap-2`}
        data-testid="commit-phone-memo"
      >
        <span className="min-w-0">
          <b className="block text-[13px] text-axal-ink dark:text-gray-100">Memo</b>
          <span className="block text-[11.5px] text-gray-600 dark:text-gray-400">On the decision record, with its terms</span>
        </span>
        <span aria-hidden="true" className="text-gray-500">›</span>
      </Link>
      <PhoneTally tally={decision.tally} />
      <p className="text-[12px] text-gray-600 dark:text-gray-400" data-testid="commit-phone-voted">{votedLine(user, decision)}</p>
      {votes.length
        ? <div className="space-y-2">{votes.map((v) => <PhoneVoteCard key={`${v.user_id}-${v.created_at}`} vote={v} />)}</div>
        : <p className="text-[12.5px] text-gray-600 dark:text-gray-400">Nobody has voted on this decision yet.</p>}
      <PhoneConditions conditions={conditions} closingTo={closingTo} control={control} error={conditionError} />
      {minutes}
      {/* Pinned to the screen's foot, not the section's, so it stays in reach under the rest of the page; the spacer
          keeps the last line of the page clear of it. */}
      <div aria-hidden="true" className="h-16" />
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-axal-hairline bg-white/95 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] dark:border-gray-800 dark:bg-gray-950/95 md:hidden" data-testid="commit-phone-sticky">
        {state.canVote
          ? <button type="button" onClick={() => setVoting(true)} data-testid="commit-phone-vote" className="min-h-[44px] w-full rounded-[8px] bg-axal-violet-deep px-4 text-[13px] font-bold text-white dark:bg-violet-500">Vote</button>
          : <p className="text-center text-[12px] text-gray-600 dark:text-gray-400" data-testid="commit-phone-no-vote">{state.reason}</p>}
      </div>
      {voting ? <VoteSheet decision={decision} onClose={() => setVoting(false)} onVoted={() => { setVoting(false); onVoted(); }} /> : null}
    </div>
  );
}

/** DE27 E: a refused committee read is a fact about this account, not a failure, so it offers no Try again. */
export function CommitRefused() {
  return (
    <section className={`${CARD} p-4`} role="alert" data-testid="commit-refused">
      <div className="flex gap-2">
        <span aria-hidden="true" className="text-gray-500">⊘</span>
        <div>
          <b className="block text-[13.5px] text-axal-ink dark:text-gray-100">Investment committee is for investors, partners and admins.</b>
          <span className="mt-0.5 block text-[12.5px] text-gray-600 dark:text-gray-400">An admin can grant the licence.</span>
        </div>
      </div>
    </section>
  );
}
