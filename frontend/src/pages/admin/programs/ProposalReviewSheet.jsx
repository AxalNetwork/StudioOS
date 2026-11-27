// D4873 (#4873, part 3) — PG04's review drawer: `/admin/programs/proposals/:uid`, a `Sheet` over the Proposals list.
// It shows the full submitted specification of one revision, read-only, with the proposal's history, and the
// decision, which names the revision it decides. Each decision goes Scope → Review → Result: a button picks it, a
// review says what it does to which revision, Confirm sends it with `expected_revision`, and the result stays in the
// drawer. A proposal sent again while the drawer was open is refused by the Worker (`revision_changed`) and read again.
//
// Before part 3, D4808's review was a page of its own with a Decide dialog; its words and test ids stay here.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../../ui/Sheet';
import { actionDanger, actionGhost, actionPrimary } from '../../../ui';
import { programProposalsApi } from '../../../lib/api/programProposals';
import { ProposalPill } from './ProposalTables';
import { BlockFailed, CARD, ChoiceGroup, Done, H2, INPUT, Pill, Refusal, SUB, Skeleton, Unread } from './parts';
import {
  ACTIONS, GRANT_LATER, HQ_HELD, NOTE_LABEL, SPEC_NOT_RECORDED, approveLabel, historyLine, noteNeeded, outcomeOf,
  proposalRefusal, revisionLabel, revisionsOf, reviewTitle, shownRevision, stampLabel,
} from './proposalsModel';
import { NOT_OPERATIONAL_WORD, NOT_SET, notOperationalLine, specRows } from './genericProgramModel';

const DT = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';

function useProposal(uid) {
  const [read, setRead] = useState({ state: 'loading', proposal: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ state: 'loading', proposal: r.proposal }));
    programProposalsApi.one(uid).then(
      (d) => { if (live) setRead({ state: 'ready', proposal: d?.proposal || null }); },
      (e) => { if (live) setRead({ state: Number(e?.status) === 404 ? 'unknown' : 'unreadable', proposal: null }); },
    );
    return () => { live = false; };
  }, [uid, tick]);
  return { ...read, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Every field of one revision, as the studio submitted it. The foot says what nothing enforces. */
export function ProposalSpec({ proposal, title = 'Submitted specification' }) {
  const rows = specRows(proposal);
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid="proposal-review-spec">
      <h3 className={H2}>{title}</h3>
      <dl className="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} className="flex min-w-0 flex-col gap-0.5" data-testid={`proposal-review-${r.key}`}>
            <dt className={DT}>{r.label}</dt>
            <dd className="m-0 text-[13.5px] text-axal-ink dark:text-gray-100">
              {r.value === null ? <span className="text-axal-muted dark:text-gray-400">{NOT_SET}</span> : <span className="whitespace-pre-line">{r.value}</span>}
              {!r.operational && r.value !== null ? <span className="ml-2"><Pill tone="muted">{NOT_OPERATIONAL_WORD}</Pill></span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className={`m-0 ${SUB}`} data-testid="proposal-review-foot">{notOperationalLine(null)}</p>
    </section>
  );
}

/**
 * The decision on the revision shown, for a proposal sent to HQ. Scope: Decline, Send back, or Approve (for this
 * studio only, or for the catalogue). Review: what it does, to which revision, with the note. Result: `onDecided`.
 */
export function DecisionPanel({ proposal, onDecided, onStale }) {
  const revision = proposal.revision;
  const fromStudio = Boolean(proposal.licence_uid);
  const [note, setNote] = useState('');
  const [scope, setScope] = useState(fromStudio ? 'approve_studio' : 'approve_catalogue');
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);

  const pick = (key) => {
    const outcome = key === 'approve' ? scope : key;
    if (noteNeeded(outcome) && !note.trim()) { setRefusal(proposalRefusal({ code: 'note_required' })); return; }
    setRefusal(null);
    setReview(outcome);
  };
  async function confirm() {
    setBusy(true); setRefusal(null);
    try {
      const res = await programProposalsApi.decide(proposal.uid, { outcome: review, note: note.trim() || null, expected_revision: revision });
      onDecided(res?.proposal || null);
    } catch (e) {
      setRefusal(proposalRefusal(e));
      if ((e?.code || e?.data?.code) === 'revision_changed') onStale();
    } finally {
      setBusy(false);
    }
  }

  if (review) {
    const o = outcomeOf(review);
    return (
      <section className={`${CARD} flex flex-col gap-2.5 px-[18px] py-4`} role="group" aria-labelledby="proposals-decide-review-h" data-testid="proposals-decide-review">
        <h3 id="proposals-decide-review-h" className={H2}>{reviewTitle(review === 'approve_studio' || review === 'approve_catalogue' ? 'approve' : review, revision)}</h3>
        <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="proposals-decide-review-what">{o?.label}</p>
        <p className={`m-0 ${SUB}`}>{o?.records}</p>
        {review.startsWith('approve') ? <p className={`m-0 ${SUB}`} data-testid="proposals-decide-grant">{GRANT_LATER}</p> : null}
        <p className={`m-0 ${SUB}`} data-testid="proposals-decide-review-note">{note.trim() ? `Your note: “${note.trim()}”` : 'No note.'}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={actionGhost} onClick={() => { setReview(null); setRefusal(null); }} data-testid="proposals-decide-back">Back</button>
          <button type="button" className={review === 'decline' ? actionDanger : actionPrimary} disabled={busy} onClick={confirm} data-testid="proposals-decide-confirm">
            {busy ? 'Saving…' : `Confirm: ${reviewTitle(review.startsWith('approve') ? 'approve' : review, revision).replace(/\?$/, '')}`}
          </button>
        </div>
        <Refusal text={refusal} testId="proposals-decide-refusal" />
      </section>
    );
  }

  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="proposals-decide-h" data-testid="proposals-decide">
      <h3 id="proposals-decide-h" className={H2}>{`Decide ${revisionLabel(revision).toLowerCase()}`}</h3>
      <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">
        {NOTE_LABEL}
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note…"
          className={`${INPUT} min-h-[60px] py-2 text-[13px] font-normal normal-case tracking-normal`} data-testid="proposals-decide-note" />
      </label>
      <ChoiceGroup label="Approve for" value={scope} onPick={setScope} groupTestId="proposals-decide-scope"
        options={[
          ...(fromStudio ? [{ value: 'approve_studio', label: 'This studio only' }] : []),
          { value: 'approve_catalogue', label: 'The catalogue' },
        ]} testId={(v) => `proposals-decide-${v}`} />
      <p className={`m-0 ${SUB}`}>Approving creates the program as Proposed. Nothing changes until you confirm.</p>
      <div className="flex flex-wrap justify-end gap-2">
        {ACTIONS.map((a) => (
          <button key={a.key} type="button" onClick={() => pick(a.key)}
            className={a.tone === 'danger' ? actionDanger : a.tone === 'primary' ? actionPrimary : actionGhost}
            data-testid={a.key === 'approve' ? 'proposal-review-decide' : `proposals-decide-${a.key}`}>
            {a.key === 'approve' ? approveLabel(revision) : a.label}
          </button>
        ))}
      </div>
      <Refusal text={refusal} testId="proposals-decide-refusal" />
    </section>
  );
}

/** PG04's drawer for one proposal. `onClose` goes back to the list; `onDecided` lets the list read again. */
export default function ProposalReviewSheet({ uid, onClose, onDecided }) {
  const one = useProposal(uid);
  const [wanted, setWanted] = useState(null);
  const [decided, setDecided] = useState(null);
  const p = decided || one.proposal;
  const shown = p ? shownRevision(p, wanted) : null;
  const all = revisionsOf(p);
  const studio = p ? (p.studio || HQ_HELD) : null;

  return (
    <Sheet label="Proposal" eyebrow={studio ? `Proposal · ${studio}` : 'Proposal'} title={p?.name || (one.state === 'loading' ? 'Reading…' : 'Proposal')}
      onClose={onClose} width={640} phone="sheet" testId="proposal-review">
      <div className="flex flex-col gap-4">
        {one.state === 'loading' && !p ? <Skeleton lines={5} testId="proposal-review-loading" /> : null}
        {one.state === 'unknown' ? <p className={`m-0 ${SUB}`} data-testid="proposal-review-unknown">No proposal has that uid.</p> : null}
        {one.state === 'unreadable' ? <BlockFailed what="This proposal" onRetry={one.reload} testId="proposal-review-failed" /> : null}
        {p ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ProposalPill status={p.status} testId="proposal-review-status" />
              <span className={SUB} data-testid="proposal-review-sent">
                {shown
                  ? `${revisionLabel(shown.revision)} · submitted ${stampLabel(shown.sent_at) || 'at a time not recorded'}${studio ? ` by ${studio}` : ''} · read-only`
                  : p.sent_at ? `Sent ${stampLabel(p.sent_at)}${studio ? ` by ${studio}` : ''} · no revision recorded` : 'Not sent'}
              </span>
            </div>
            {decided ? (
              <Done testId="proposal-review-decided">
                {`Decision recorded on ${revisionLabel(decided.revision).toLowerCase()}: ${decided.status.replace('_', ' ')}.`}
                {decided.program_key ? <> <Link to={`/admin/programs/${decided.program_key}`} className="font-bold underline" data-testid="proposal-review-open-program">Open program</Link></> : null}
              </Done>
            ) : null}
            {all.length > 1 ? (
              <ChoiceGroup label="Revision shown" value={shown?.revision} onPick={setWanted} groupTestId="proposal-review-revisions"
                options={all.map((r) => ({ value: r.revision, label: revisionLabel(r.revision) }))} testId={(v) => `proposal-review-revision-${v}`} />
            ) : null}
            {shown && !shown.spec_recorded
              ? <Unread word="Not recorded" reason={SPEC_NOT_RECORDED} testId="proposal-review-unrecorded" />
              : <ProposalSpec proposal={shown?.spec || p} />}
            <section className="flex flex-col gap-1.5" aria-labelledby="proposal-review-history-h" data-testid="proposal-review-history">
              <h3 id="proposal-review-history-h" className={H2}>History</h3>
              {all.length ? (
                <ol className="m-0 flex list-none flex-col gap-1 p-0">
                  {all.map((r) => <li key={r.revision} className="text-[12.5px] text-axal-ink dark:text-gray-100" data-testid={`proposal-review-history-${r.revision}`}>{historyLine(r)}</li>)}
                </ol>
              ) : <p className={`m-0 ${SUB}`}>No revision is recorded for this proposal.</p>}
            </section>
            {p.status === 'sent' && !decided && shown?.revision === p.revision ? (
              <DecisionPanel key={p.revision} proposal={p} onStale={one.reload}
                onDecided={(next) => { if (next) setDecided(next); else one.reload(); if (onDecided) onDecided(); }} />
            ) : null}
            {p.status === 'sent' && !decided && shown && shown.revision !== p.revision ? (
              <p className={`m-0 ${SUB}`} data-testid="proposal-review-older">{`HQ decides the latest, ${revisionLabel(p.revision).toLowerCase()}. Show it to decide.`}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
