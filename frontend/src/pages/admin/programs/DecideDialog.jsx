// D964 (#2797, Programs part 11) — PG15a (dc:496): a Super Admin's decision on
// one proposal sent to HQ, on part 2's `POST …/proposals/:uid/decision`.
// The four choices, each with what part 2 records for it today; the note to
// the studio, required for Send back and Decline here as on the Worker; and on
// Confirm, a refusal sits under the buttons while the dialog stays open.
// PG15a's foot names a draft grant on Licences › Program grants. Grants are
// part 3's (#2789) and #2376's, so the foot says an approval sets none yet.
import React, { useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { programProposalsApi } from '../../../lib/api/programProposals';
import { INPUT, Refusal, SUB } from './parts';
import {
  GRANT_LATER, NOTE_LABEL, OUTCOMES, decideSub, decideTitle, noteNeeded, proposalRefusal,
} from './proposalsModel';

const BTN = 'inline-flex min-h-[36px] items-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PRIMARY = 'inline-flex min-h-[36px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white disabled:opacity-50 dark:bg-violet-600';

export default function DecideDialog({ proposal, onClose, onDecided }) {
  const [outcome, setOutcome] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const needsNote = noteNeeded(outcome);
  const missingNote = needsNote && !note.trim();

  async function confirm() {
    if (!outcome) { setRefusal('Choose what to do with this proposal.'); return; }
    if (missingNote) { setRefusal(proposalRefusal({ code: 'note_required' })); return; }
    setBusy(true); setRefusal(null);
    try {
      const res = await programProposalsApi.decide(proposal.uid, { outcome, note: note.trim() || null });
      onDecided(res?.proposal || null);
    } catch (e) {
      setRefusal(proposalRefusal(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Lightbox label={decideTitle(proposal.name)} title={decideTitle(proposal.name)} sub={decideSub(proposal)} onClose={onClose} width={560} testId="proposals-decide-dialog">
      <div className="flex flex-col gap-3">
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="proposals-decide-options">
          <legend className="sr-only">Decision</legend>
          {OUTCOMES.map((o) => (
            <label key={o.key} className="flex items-start gap-2.5 text-[13px] text-axal-ink dark:text-gray-100">
              <input type="radio" name="decision" value={o.key} checked={outcome === o.key} onChange={() => { setOutcome(o.key); setRefusal(null); }} className="mt-1" data-testid={`proposals-decide-${o.key}`} />
              <span className="flex flex-col gap-0.5">
                <span className="font-bold">{o.label}</span>
                <span className={SUB}>{o.records}</span>
              </span>
            </label>
          ))}
          <p className={`m-0 ${SUB}`} data-testid="proposals-decide-grant">{GRANT_LATER}</p>
        </fieldset>
        <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">
          {NOTE_LABEL}
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note…" aria-required={needsNote}
            className={`${INPUT} min-h-[60px] py-2 text-[13px] font-normal normal-case tracking-normal`} data-testid="proposals-decide-note" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose} data-testid="proposals-decide-back">Back</button>
          <button type="button" className={PRIMARY} disabled={busy} onClick={confirm} data-testid="proposals-decide-confirm">{busy ? 'Saving…' : 'Confirm'}</button>
        </div>
        <Refusal text={refusal} testId="proposals-decide-refusal" />
      </div>
    </Lightbox>
  );
}
