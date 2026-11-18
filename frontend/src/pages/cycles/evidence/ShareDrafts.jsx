/**
 * D6897 part 3 (#6897, canvas D6054 RA-27 A and RA-30) — Eadwyn's drafts inside Share outside Axal.
 *
 * - `PackProposal` (RA-27 A) sits in the pack composer when the reader has an NDA, where the founder ticks items. The
 *   founder says who the pack is for; Eadwyn proposes a selection with one reason per item and a line on what it
 *   left out. Accept ticks those rows in the composer and nothing else; Discard drops the draft. The founder still
 *   changes any row and makes the pack.
 * - `LineDraft` (RA-30) sits under the snapshot's covering line. Eadwyn drafts one sentence; Accept puts it in the
 *   field, Edit lets the founder change it first (the Worker checks the edit like any covering line), Discard drops it.
 *
 * Every run is quoted first: Ask Eadwyn reads the hold, and the run happens only on Confirm. When Eadwyn cannot be
 * asked, the panel says so and the sheet works as before. No browser pop-up; nothing here sends anything.
 */
import React, { useState } from 'react';
import { raiseEvidenceShareApi } from '../../../lib/api/raiseEvidenceShare';
import { BTN_P, BTN_S, MUTED } from './EvidenceParts';
import {
  AUDIENCE_MAX, LINE_NOTE, LINE_OFF, NO_DRAFT, PACK_ACCEPT_NOTE, PACK_NOTE, PACK_OFF,
  audienceProblem, draftError, holdLine, proposedRows, tickedLine,
} from './shareDraftsModel';

const FIELD = 'min-h-[44px] w-full rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:min-h-[36px]';
const BOX = 'flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/20';
const ERR = 'm-0 text-[12px] font-normal text-red-700 dark:text-red-300';
const HEAD = 'm-0 flex items-center gap-1.5 text-[12.5px] font-extrabold text-axal-ink dark:text-gray-100';

/** Quote → Confirm → run, shared by both drafts. `body` is what the Worker reads; `onDraft` gets the stored draft. */
function useAsk(projectId, off) {
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const ask = async (body) => {
    setBusy('quote'); setNotice('');
    try { setQuote((await raiseEvidenceShareApi.quoteDraft(projectId, body))?.quote || null); }
    catch (e) { setNotice(draftError(e, off)); }
    finally { setBusy(''); }
  };
  const run = async (body, onDraft) => {
    setBusy('run'); setNotice('');
    try {
      const out = await raiseEvidenceShareApi.runDraft(projectId, { ...body, confirm_quote: quote?.confirm_quote });
      setQuote(null);
      if (out?.draft) onDraft(out.draft); else setNotice(NO_DRAFT);
    } catch (e) {
      // A changed input needs a new quote: the Worker sends it with the refusal.
      if (e?.status === 402 && e?.data?.quote) setQuote(e.data.quote);
      setNotice(draftError(e, off));
    } finally { setBusy(''); }
  };
  return { quote, setQuote, busy, setBusy, notice, setNotice, ask, run };
}

function Hold({ quote, busy, onConfirm, onCancel, testId, confirmWord }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`${testId}-hold`}>
      <span className="text-[12px] text-axal-ink dark:text-gray-100">{holdLine(quote) || 'The cost could not be read. Cancel and try again.'}</span>
      <button type="button" className={BTN_P} disabled={busy === 'run' || !holdLine(quote)} onClick={onConfirm} data-testid={`${testId}-run`}>{busy === 'run' ? 'Asking…' : confirmWord}</button>
      <button type="button" className={BTN_S} disabled={busy === 'run'} onClick={onCancel} data-testid={`${testId}-cancel`}>Cancel</button>
    </div>
  );
}

/** RA-27 A: Eadwyn's proposed selection for one reader. `rows` are the composer's rows now; `onTick` replaces its ticks. */
export function PackProposal({ projectId, rows, onTick }) {
  const [audience, setAudience] = useState('');
  const [problem, setProblem] = useState('');
  const [draft, setDraft] = useState(null);
  const [done, setDone] = useState('');
  const a = useAsk(projectId, PACK_OFF);
  const body = { kind: 'pack', audience: audience.trim() };
  const askQuote = () => {
    const p = audienceProblem(audience); setProblem(p || ''); if (p) return;
    setDone(''); a.ask(body);
  };
  const decide = async (verb) => {
    a.setBusy(verb); a.setNotice('');
    try {
      if (verb === 'accept') {
        const r = await raiseEvidenceShareApi.acceptDraft(projectId, draft.uid);
        onTick(r.tick || []); setDone(tickedLine(r.tick, r.dropped));
      } else { await raiseEvidenceShareApi.discardDraft(projectId, draft.uid); setDone('Discarded. Nothing was ticked.'); }
      setDraft(null);
    } catch (e) { a.setNotice(draftError(e, PACK_OFF)); }
    finally { a.setBusy(''); }
  };
  const proposed = draft ? proposedRows(draft, rows) : [];
  return (
    <section className={BOX} aria-label="Eadwyn’s proposal" data-testid="share-proposal">
      <p className={HEAD}><span aria-hidden="true">E</span> Ask Eadwyn · a selection for one reader</p>
      <p className={`m-0 ${MUTED}`}>{PACK_NOTE}</p>
      {!draft ? (
        <>
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Who reads it and what they look for
            <input className={FIELD} value={audience} maxLength={AUDIENCE_MAX} onChange={(e) => setAudience(e.target.value)} placeholder="Seed fund partner: traction and use of funds" aria-invalid={!!problem} data-testid="share-proposal-audience" />
            {problem ? <span className={ERR} role="alert">{problem}</span> : null}
          </label>
          {a.quote
            ? <Hold quote={a.quote} busy={a.busy} onConfirm={() => a.run(body, (d) => { setDraft(d); setDone(''); })} onCancel={() => a.setQuote(null)} testId="share-proposal" confirmWord="Propose a selection" />
            : <div><button type="button" className={BTN_S} disabled={a.busy === 'quote'} onClick={askQuote} data-testid="share-proposal-ask">{a.busy === 'quote' ? 'Reading the cost…' : 'Ask Eadwyn'}</button></div>}
        </>
      ) : (
        <div className="flex flex-col gap-2" data-testid="share-proposal-draft">
          <p className="m-0 text-[12.5px]"><b>Proposal · one audience</b> · {draft.audience}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {proposed.map((r) => (
              <li key={r.uid} className="flex flex-col border-b border-violet-100 py-1 text-[12.5px] last:border-b-0 dark:border-violet-900" data-testid="share-proposal-row" data-available={r.available ? 'yes' : 'no'}>
                <span><b>{r.title}</b>{r.area ? ` · ${r.area}` : ''}{r.available ? '' : ' · not ticked'}</span>
                <span className={MUTED} data-testid="share-proposal-reason">{r.reason}</span>
              </li>
            ))}
          </ul>
          {draft.left_out ? <p className={`m-0 ${MUTED}`} data-testid="share-proposal-left-out">Left out: {draft.left_out}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_P} disabled={!!a.busy} onClick={() => decide('accept')} data-testid="share-proposal-accept">Accept selection</button>
            <button type="button" className={BTN_S} disabled={!!a.busy} onClick={() => decide('discard')} data-testid="share-proposal-discard">Discard</button>
          </div>
          <p className={`m-0 ${MUTED}`}>{PACK_ACCEPT_NOTE}</p>
        </div>
      )}
      {done ? <p className="m-0 text-[12px] font-semibold" role="status" data-testid="share-proposal-done">{done}</p> : null}
      {a.notice ? <p className="m-0 text-[12px] text-amber-800 dark:text-amber-300" role="status" data-testid="share-proposal-notice">{a.notice}</p> : null}
    </section>
  );
}

/** RA-30: Eadwyn's one-sentence covering line. `onUse` fills the snapshot's field with the kept line. */
export function LineDraft({ projectId, onUse }) {
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null);
  const [done, setDone] = useState('');
  const a = useAsk(projectId, LINE_OFF);
  const body = { kind: 'covering-line' };
  const keep = async (line) => {
    a.setBusy('accept'); a.setNotice('');
    try {
      const r = await raiseEvidenceShareApi.acceptDraft(projectId, draft.uid, line == null ? {} : { line });
      onUse(r.line); setDraft(null); setEditing(null);
      setDone(r.draft?.status === 'edited' ? 'Your edit is in the covering line, labelled as yours.' : 'The draft is in the covering line, labelled as yours.');
    } catch (e) { a.setNotice(draftError(e, LINE_OFF)); }
    finally { a.setBusy(''); }
  };
  const discard = async () => {
    a.setBusy('discard'); a.setNotice('');
    try { await raiseEvidenceShareApi.discardDraft(projectId, draft.uid); setDraft(null); setEditing(null); setDone('Discarded. The covering line is unchanged.'); }
    catch (e) { a.setNotice(draftError(e, LINE_OFF)); }
    finally { a.setBusy(''); }
  };
  return (
    <section className={BOX} aria-label="Eadwyn’s draft" data-testid="share-line-draft">
      <p className={HEAD}><span aria-hidden="true">E</span> Ask Eadwyn · a covering line</p>
      {!draft ? (a.quote
        ? <Hold quote={a.quote} busy={a.busy} onConfirm={() => a.run(body, (d) => { setDraft(d); setDone(''); })} onCancel={() => a.setQuote(null)} testId="share-line" confirmWord="Draft a line" />
        : <div><button type="button" className={BTN_S} disabled={a.busy === 'quote'} onClick={() => { setDone(''); a.ask(body); }} data-testid="share-line-ask">{a.busy === 'quote' ? 'Reading the cost…' : 'Use Eadwyn’s draft'}</button></div>
      ) : (
        <div className="flex flex-col gap-2" data-testid="share-line-proposed">
          {editing == null
            ? <p className="m-0 text-[13px]" data-testid="share-line-text">{`“${draft.line}”`}</p>
            : <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Your edit
                <input className={FIELD} value={editing} maxLength={220} onChange={(e) => setEditing(e.target.value)} data-testid="share-line-edit" />
              </label>}
          <div className="flex flex-wrap gap-2">
            {editing == null ? (
              <>
                <button type="button" className={BTN_P} disabled={!!a.busy} onClick={() => keep(null)} data-testid="share-line-accept">Accept</button>
                <button type="button" className={BTN_S} disabled={!!a.busy} onClick={() => setEditing(draft.line)} data-testid="share-line-edit-open">Edit</button>
              </>
            ) : <button type="button" className={BTN_P} disabled={!!a.busy} onClick={() => keep(editing)} data-testid="share-line-keep">Keep my edit</button>}
            <button type="button" className={BTN_S} disabled={!!a.busy} onClick={discard} data-testid="share-line-discard">Discard</button>
          </div>
        </div>
      )}
      <p className={`m-0 ${MUTED}`}>{LINE_NOTE}</p>
      {done ? <p className="m-0 text-[12px] font-semibold" role="status" data-testid="share-line-done">{done}</p> : null}
      {a.notice ? <p className="m-0 text-[12px] text-amber-800 dark:text-amber-300" role="status" data-testid="share-line-notice">{a.notice}</p> : null}
    </section>
  );
}
