/**
 * D6144 (#6144) — the Commit zone's own vote: the "Your vote" panel under the
 * decision card, and its two dialogs, Cast or change my vote and Recuse
 * yourself (Deals v2 addendum B, boards DE20 and DE21, D6142). Both write
 * through the existing `api.icVote` (`POST /api/ic/:uid/vote`); a recusal is
 * the same call with `recused` and the declaration as its rationale.
 *
 * The dialogs are the shared `Sheet`: focus moves in, Tab stays inside, and
 * focus returns to the button that opened it. A refused or failed write keeps
 * the dialog open, with the reader's edits, and says why in the Worker's own
 * words (`refusalWords`).
 */
import React, { useState } from 'react';
import Sheet from '../../../../ui/Sheet';
import { api } from '../../../../lib/api';
import { recusalBody, VOTE_WORDS as RECORD_WORDS } from '../../../icDecisionModel';
import { VOTE_CHOICES, voteBody, voteOffer, refusalWords } from './commitVoteModel';

const FIELD = 'mt-1 w-full rounded-[8px] border border-gray-300 bg-white p-2.5 text-[12.5px] leading-relaxed text-axal-ink focus-visible:outline focus-visible:outline-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PRIMARY = 'min-h-[44px] rounded-[7px] bg-axal-violet-deep px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-violet-600';
const SECONDARY = 'min-h-[44px] rounded-[7px] border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-bold text-gray-800 hover:border-gray-400 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const GLYPH = { yes: '▲', no: '▼', abstain: '○', recused: '⊘' };

function Refusal({ text, testid }) {
  if (!text) return null;
  return (
    <div role="alert" data-testid={testid} className="rounded-[8px] border border-red-200 bg-red-50 p-2.5 text-[12px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <strong>Not saved.</strong> {text} Your edits are kept.
    </div>
  );
}

/** DE20: cast a vote, or change it. Changing replaces the earlier vote and its reason. */
export function VoteDialog({ decision, mine, onClose, onSaved }) {
  const [vote, setVote] = useState(mine && VOTE_CHOICES.includes(mine.vote) ? mine.vote : '');
  const [reason, setReason] = useState(mine?.rationale || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const body = voteBody(vote, reason);
  const submit = async (e) => {
    e?.preventDefault?.();
    if (!body || busy) return;
    setBusy(true); setError('');
    try {
      await api.icVote(decision.uid, body);
      onSaved?.();
    } catch (cause) {
      setError(refusalWords(cause, 'The vote could not be recorded.'));
      setBusy(false);
    }
  };
  return (
    <Sheet title={mine ? 'Change your vote' : 'Cast your vote'} eyebrow={decision.title || decision.uid} onClose={() => !busy && onClose()} width={480} testId="dialog-vote">
      <form onSubmit={submit} className="space-y-4 p-4" data-testid="form-vote">
        <p className="text-[12px] text-gray-600 dark:text-gray-400">
          {mine ? 'Changing your vote replaces the earlier one.' : 'Every vote records its reason.'} Abstain is a vote cast and stays in the count.
        </p>
        <fieldset>
          <legend className="text-[12px] font-bold text-gray-900 dark:text-gray-100">Vote <span className="font-normal text-gray-500">· required</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {VOTE_CHOICES.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vote === v}
                data-testid={`vote-choice-${v}`}
                onClick={() => setVote(v)}
                className={`${SECONDARY} ${vote === v ? 'border-axal-violet-deep bg-violet-50 text-violet-900 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200' : ''}`}
              >
                <span aria-hidden="true">{GLYPH[v]}</span> {RECORD_WORDS[v]}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block text-[12px] font-bold text-gray-900 dark:text-gray-100">
          Reason <span className="font-normal text-gray-500">· required</span>
          <textarea rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" data-testid="input-vote-reason" className={FIELD} />
        </label>
        <Refusal text={error} testid="status-vote-error" />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={PRIMARY} disabled={!body || busy} data-testid="button-record-vote">{busy ? 'Recording…' : 'Record vote'}</button>
          <button type="button" className={SECONDARY} disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}

/** DE21: recuse yourself. The declaration is required, and the recusal is final. */
export function RecuseDialog({ decision, mine, onClose, onSaved }) {
  const [declaration, setDeclaration] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const body = understood ? recusalBody(declaration) : null;
  const submit = async (e) => {
    e?.preventDefault?.();
    if (!body || busy) return;
    setBusy(true); setError('');
    try {
      await api.icVote(decision.uid, body);
      onSaved?.();
    } catch (cause) {
      setError(refusalWords(cause, 'The recusal could not be recorded.'));
      setBusy(false);
    }
  };
  return (
    <Sheet title="Recuse yourself" eyebrow={decision.title || decision.uid} onClose={() => !busy && onClose()} width={480} testId="dialog-recuse">
      <form onSubmit={submit} className="space-y-4 p-4" data-testid="form-recuse">
        <p className="rounded-[8px] border border-dashed border-gray-400 p-2.5 text-[12px] text-gray-700 dark:border-gray-500 dark:text-gray-300">
          <span aria-hidden="true">⊘</span> Abstain is a vote cast and stays in the count. Recusing declares a conflict and takes you out of the count.
        </p>
        {mine && mine.vote !== 'recused' ? (
          <p className="text-[12px] text-amber-800 dark:text-amber-300" data-testid="recuse-replaces">
            You voted {RECORD_WORDS[mine.vote] || mine.vote}. Recusing replaces that vote.
          </p>
        ) : null}
        <label className="block text-[12px] font-bold text-gray-900 dark:text-gray-100">
          Declaration of the conflict <span className="font-normal text-gray-500">· required</span>
          <textarea rows={3} maxLength={2000} value={declaration} onChange={(e) => setDeclaration(e.target.value)} aria-label="Declaration of the conflict" data-testid="input-recusal-declaration" className={FIELD} />
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-[12px] text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-testid="input-recusal-final" />
          I understand a recusal is final.
        </label>
        <Refusal text={error} testid="status-recuse-error" />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={PRIMARY} disabled={!body || busy} data-testid="button-recuse">{busy ? 'Recording…' : 'Recuse'}</button>
          <button type="button" className={SECONDARY} disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * The "Your vote" panel under the card: what the reader has recorded, and the
 * actions they may take. Unreadable, decided, off the roster and recused offer
 * no control; each says why.
 */
export function YourVote({ decision, user, onSaved, renderMark }) {
  const [open, setOpen] = useState(null);
  const offer = voteOffer(decision, user);
  const saved = () => { setOpen(null); onSaved?.(); };
  return (
    <section className="rounded-[10px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="commit-your-vote" data-state={offer.state}>
      <h2 className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Your vote</h2>
      {offer.mine ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-gray-800 dark:text-gray-200" data-testid="commit-my-vote">
          {renderMark ? renderMark(offer.mine.vote) : (RECORD_WORDS[offer.mine.vote] || offer.mine.vote)}
          {offer.mine.rationale ? <span className="text-gray-600 dark:text-gray-400">“{offer.mine.rationale}”</span> : null}
        </p>
      ) : null}
      <p className={`mt-1.5 text-[12px] ${offer.state === 'unreadable' ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-gray-600 dark:text-gray-400'}`} data-testid="commit-vote-reason" role={offer.state === 'unreadable' ? 'status' : undefined}>
        {offer.state === 'not_voted' ? 'You have not voted on this decision. ' : ''}{offer.reason}
      </p>
      {offer.may.vote || offer.may.recuse ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {offer.may.vote ? (
            <button type="button" className={PRIMARY} data-testid="button-open-vote" onClick={() => setOpen('vote')}>
              {offer.mine ? 'Change my vote' : 'Cast my vote'}
            </button>
          ) : null}
          {offer.may.recuse ? (
            <button type="button" className={SECONDARY} data-testid="button-open-recuse" onClick={() => setOpen('recuse')}>Recuse myself</button>
          ) : null}
        </div>
      ) : null}
      {open === 'vote' && offer.may.vote ? <VoteDialog decision={decision} mine={offer.mine} onClose={() => setOpen(null)} onSaved={saved} /> : null}
      {open === 'recuse' && offer.may.recuse ? <RecuseDialog decision={decision} mine={offer.mine} onClose={() => setOpen(null)} onSaved={saved} /> : null}
    </section>
  );
}
