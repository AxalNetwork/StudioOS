/**
 * D1344 — "Compose with Eadwyn" (EM3a before a draft, EM3b after), in the one
 * right Sheet (D1317). Eadwyn drafts; the member sends.
 *
 *   · What it is for (the person's relationship's intents), tone, length, and
 *     the live update blocks.
 *   · The estimate is read before every draft (`estimate: true` runs nothing)
 *     and shown on the Draft button's line; Draft is not pressable without it.
 *   · The draft: its subject and body (editable by hand), "Used: … Nothing
 *     else was read.", its versions (‹ ›), Regenerate (the same request's
 *     estimate), and Shorter (a revision, with its OWN estimate of the text in the
 *     editor: D4666).
 *   · Send, behind a confirmation: one nonce (`/send/confirm`), then the send.
 *     No "Copy to Gmail drafts" (D1347 §3): every draft is kept in Axal VC.
 *     Schedule is not drawn: nothing on the Worker schedules a send yet.
 *
 * #4660 (finding 5, part 3): the member's recipient, subject and body are saved
 * per version through `PATCH /api/mail/drafts/:uid` (`useDraftEdits`), with a
 * visible save state; a failed or pending save keeps the text and says so, and
 * closing never discards it in silence. A stored draft reopens from the
 * conversation (`resume`: its versions and the one to show) and sends without
 * another run. Shorter revises the text on screen. A generation keeps the
 * purpose it was submitted with, and the fund-GP question check reads the
 * selected version's own intent.
 */
import { useMemo, useRef, useState } from 'react';
import Sheet from '../../ui/Sheet';
import Lightbox from '../../ui/Lightbox';
import { mailApi } from '../../lib/api/mail.js';
import SendUncertain from './SendUncertain.jsx';
import DraftSaveLine, { CloseNotice } from './DraftSaveLine.jsx';
import { useDraftEdits } from './useDraftEdits.js';
import { makeSendOperation, NOT_RECORDED_LINE, PENDING_LINE, readOutcome, sendFailure } from './sendOperation.js';
import { ADD_TOKENS_PATH } from '../../lib/aiTokens';
import { BLOCKS, bodyText, cap, estimateLine, INTENTS, LENGTHS, reviseHoldLine, TONES } from './emailModel.js';
import { pressable, refreshedFrom } from './estimateGate.js';
import { useOperationEstimate } from './useOperationEstimate.js';
import { BODY, BTN, Chips, ERROR, EYEBROW, INPUT, MUTED, PRIMARY } from './emailParts.jsx';


export default function ComposeSheet({ pack, refs, project = null, to, account, from = null, onClose, onSent, onAddAddress, api = mailApi, resume = null, saveDelayMs }) {
  const person = pack.person;
  const intents = INTENTS[person.relationship] ?? [];
  const seed = resume?.versions?.[resume.at] ?? null;
  const [intent, setIntent] = useState(seed?.intent ?? intents[0]?.key ?? null);
  const [tone, setTone] = useState(seed?.tone ?? 'warm');
  const [length, setLength] = useState(seed?.length ?? 'short');
  const [blocks, setBlocks] = useState([]);
  const [versions, setVersions] = useState(resume?.versions ?? []);
  const [at, setAt] = useState(resume?.at ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [unsure, setUnsure] = useState(null);
  const operation = useRef(null);
  if (!operation.current) operation.current = makeSendOperation();
  const [address, setAddress] = useState(to ?? '');
  const edits = useDraftEdits({ api, to: address, delayMs: saveDelayMs });

  const ask = useMemo(() => ({ person: person.ref, intent, tone, length, refs, blocks, ...(project ? { project } : {}) }),
    [person.ref, intent, tone, length, refs, blocks, project]);
  const draft = versions[at] ?? null;
  // The text on screen for this version: what the member saved or typed, else what Eadwyn wrote.
  const edit = draft ? edits.textFor(draft) : null;
  const saveState = draft ? edits.stateOf(draft) : null;

  // D4666: the estimate is of the operation on screen. The draft and a regenerate share one (the same request);
  // Shorter has its own, of the text in the editor, so the price shown is the price of what will run.
  const gate = useOperationEstimate(() => api.estimate(ask), { kind: 'draft', ask }, { enabled: !!intent });
  const estimate = gate.estimate;
  const base = edit ? { subject: edit.subject, body: edit.body } : null;
  const shortGate = useOperationEstimate(
    () => api.revise(draft.uid, { instruction: 'shorter', base, ...(project ? { project } : {}), estimate: true }),
    { kind: 'revise', uid: draft?.uid ?? null, instruction: 'shorter', base, project },
    { enabled: !!(draft && edit?.subject?.trim() && edit?.body?.trim()), debounceMs: 400 },
  );

  // `submitted` is the purpose and settings this run was pressed with. A version keeps them whatever the form says
  // by the time the answer arrives (the Worker's own `intent` wins; this is the fallback).
  const run = async (go, which, submitted = null) => {
    setBusy(true); setError(null);
    try {
      const r = await go();
      if (r?.draft) {
        const made = submitted ? { ...r.draft, intent: r.draft.intent ?? submitted.intent, tone: r.draft.tone ?? submitted.tone, length: r.draft.length ?? submitted.length } : r.draft;
        edits.adopt(made);
        setVersions((v) => [...v, made]); setAt(versions.length);
      }
    }
    catch (e) {
      const fresh = refreshedFrom(e);
      if (fresh) { which?.accept(fresh); setError(e.message || 'This changed since you saw the estimate. Review the new one, then press again.'); setBusy(false); return; }
      setError(e?.status === 402 ? { line: e.message || 'Not enough AI tokens for this draft.', topUp: true } : (e?.message || 'Eadwyn could not draft this email. Try again.'));
    }
    finally { setBusy(false); }
  };
  const press = () => gate.estimate && run(() => api.draft({ ...ask, quote: gate.estimate.quote }), gate, { intent, tone, length });
  const shorter = () => draft && shortGate.estimate && run(() => api.revise(draft.uid, { instruction: 'shorter', base, ...(project ? { project } : {}), quote: shortGate.estimate.quote }), shortGate, { intent: draft.intent, tone: draft.tone, length: draft.length });

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const { nonce } = await api.confirmSend(account.uid);
      const key = operation.current.keyFor([person.ref, account.uid, edit.to.trim(), edit.subject, edit.body, draft.uid]);
      const r = await api.send({ person: person.ref, account_uid: account.uid, to: edit.to.trim(), subject: edit.subject, body: edit.body, draft_uid: draft.uid, operation_key: key, nonce });
      setConfirm(false);
      const out = readOutcome(r);
      if (out.state === 'accepted') { operation.current.forget(); onSent?.(out.sent); }
      else if (out.state === 'uncertain') setUnsure(out.operation.uid);
      else setError(out.state === 'pending' ? PENDING_LINE : NOT_RECORDED_LINE);
    } catch (e) {
      setConfirm(false);
      const f = sendFailure(e);
      if (f.ended) operation.current.forget();
      setError(f.line);
    }
    finally { setBusy(false); }
  };
  const resolve = async (outcome) => {
    setBusy(true); setError(null);
    try {
      await api.resolveSend(unsure, outcome);
      operation.current.forget();
      setUnsure(null);
      if (outcome === 'arrived') onSent?.(null); else setError('Marked as not sent. You can send it again.');
    } catch (e) { setError(e?.message || 'That could not be recorded. Try again.'); }
    finally { setBusy(false); }
  };

  const guardedClose = edits.guardClose(onClose);
  const line = estimateLine(estimate);
  // D1344's fund rule, from the purpose of the version on screen (its own intent), not the form's live one.
  const questionOpening = person.kind === 'fund_gp' && (draft ? draft.intent : intent) === 'ask_question';
  const questionNeedsEdit = !!(questionOpening && draft && bodyText(edit?.body) === bodyText(draft.body));
  const sendable = !!(draft && edit?.subject?.trim() && edit?.body?.trim() && account && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((edit?.to ?? '').trim()) && !questionNeedsEdit);
  const footer = draft
    ? <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} disabled={!sendable || busy || !!unsure} onClick={() => setConfirm(true)} data-testid="compose-send">
          {account ? `Send from ${account.address}` : 'Connect a mailbox to send'}
        </button>
        <span className={`text-[12px] ${MUTED}`}>Every draft is kept in Axal VC.</span>
        <CloseNotice closing={edits.closing} onRetry={guardedClose} onCloseAnyway={edits.closeAnyway(onClose)} />
      </div>
    : <div className="flex flex-wrap items-center justify-between gap-2">
        {gate.status === 'failed'
          ? <span className={`text-[12px] ${MUTED}`} data-testid="compose-estimate-failed">{gate.error} <button type="button" className="underline" onClick={gate.retry}>Try again</button></span>
          : <span className={`text-[12px] ${MUTED}`}>Eadwyn drafts. You send.</span>}
        <button type="button" className={PRIMARY} disabled={!pressable(gate, busy) || !intent} onClick={press} data-testid="compose-draft">Draft with Eadwyn</button>
      </div>;

  return <Sheet title="Draft an email" eyebrow="Email" sub={`Email to ${person.name}`} onClose={guardedClose} footer={footer} width={560} testId="compose-sheet">
    <div className="flex flex-col gap-4">
      {from && <p className={`rounded-axal-md bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-violet-deep dark:bg-violet-950/40 dark:text-violet-300`}>Opened from {from}. Person and context are filled in.</p>}
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>To</span>
        <input type="email" className={INPUT} value={draft ? edit.to : address} onChange={(e) => { setAddress(e.target.value); if (draft) edits.change(draft, { to: e.target.value }); }} placeholder={`${person.name}’s address`}
          aria-describedby={to || (draft && edit.to) ? undefined : 'compose-no-address'} data-testid="compose-to" />
        {!to && <span id="compose-no-address" className={`text-[12px] ${MUTED}`}>No address is recorded for {person.name}. Type the one to send to{onAddAddress ? ', or add it to their record' : ''}.</span>}
      </label>
      <p className={`text-[12.5px] ${MUTED}`} data-testid="compose-from">From {account ? account.address : 'no mailbox yet'}</p>
      {questionOpening && <p className={`text-[12.5px] ${BODY}`} id="compose-fund-question" data-testid="compose-fund-question">Eadwyn writes an opening. Add your question to the draft body before sending.</p>}

      {!draft && <>
        <section className="flex flex-col gap-1.5"><span className={EYEBROW}>What is it for</span>
          <Chips label="What is it for" testId="compose-intents" value={intent} onChange={setIntent} disabled={busy} options={intents.map((i) => ({ value: i.key, label: i.label }))} /></section>
        <div className="flex flex-wrap gap-4">
          <section className="flex flex-col gap-1.5"><span className={EYEBROW}>Tone</span>
            <Chips label="Tone" value={tone} onChange={setTone} disabled={busy} options={TONES.map((t) => ({ value: t, label: cap(t) }))} /></section>
          <section className="flex flex-col gap-1.5"><span className={EYEBROW}>Length</span>
            <Chips label="Length" value={length} onChange={setLength} disabled={busy} options={LENGTHS.map((l) => ({ value: l, label: cap(l) }))} /></section>
        </div>
        <section className="flex flex-col gap-1.5"><span className={EYEBROW}>Insert a live update</span>
          <div className="flex flex-wrap gap-1.5" data-testid="compose-blocks">{BLOCKS.map((b) => {
            const on = blocks.includes(b.value);
            return <button key={b.value} type="button" aria-pressed={on} className={BTN} disabled={busy}
              onClick={() => setBlocks((x) => (on ? x.filter((v) => v !== b.value) : [...x, b.value]))}>{on ? '✓' : '+'} {b.label}</button>;
          })}</div>
          <p className={`text-[12px] ${MUTED}`}>Each one goes in as a small card with its “as of” date and a link back to the record.</p></section>
        <p className={`text-[12.5px] ${BODY}`} data-testid="compose-estimate">{line ?? 'Reading the estimate…'}</p>
      </>}

      {draft && edit && <section className="flex flex-col gap-2" data-testid="compose-draft-view">
        <div className="flex items-center justify-between gap-2">
          <span className={EYEBROW}>Draft · version {at + 1} of {versions.length}</span>
          <span className="flex gap-1">
            <button type="button" className={BTN} aria-label="Previous version" disabled={at === 0} onClick={() => setAt(at - 1)}>‹</button>
            <button type="button" className={BTN} aria-label="Next version" disabled={at >= versions.length - 1} onClick={() => setAt(at + 1)}>›</button>
          </span>
        </div>
        <input className={INPUT} aria-label="Subject" value={edit.subject} onChange={(e) => edits.change(draft, { subject: e.target.value })} />
        <textarea className={`${INPUT} min-h-[220px] py-2`} aria-label="Body" aria-describedby={questionOpening ? 'compose-fund-question' : undefined} value={edit.body} onChange={(e) => edits.change(draft, { body: e.target.value })} />
        <DraftSaveLine state={saveState} onRetry={() => edits.retry(draft.uid)} testId="compose-save-state" />
        <p className={`text-[12px] ${MUTED}`} data-testid="compose-used">Used: {(draft.sources ?? []).map((s) => s.label).join(', ') || 'nothing'}. Nothing else was read.</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={BTN} disabled={!pressable(gate, busy) || !intent} onClick={press}>Regenerate{line ? '' : gate.status === 'failed' ? ' (estimate unavailable)' : ' (reading the estimate…)'}</button>
          <button type="button" className={BTN} disabled={!pressable(shortGate, busy)} onClick={shorter} data-testid="compose-shorter">Shorter{shortGate.status === 'ready' ? '' : shortGate.status === 'failed' ? ' (estimate unavailable)' : ' (reading the estimate…)'}</button>
        </div>
        {line && <p className={`text-[12px] ${MUTED}`}>{line}</p>}
        {shortGate.status === 'ready' && <p className={`text-[12px] ${MUTED}`} data-testid="compose-shorter-hold">{reviseHoldLine('Shorter', shortGate.estimate)}</p>}
        {(gate.status === 'failed' || shortGate.status === 'failed') && <p className={`text-[12px] ${MUTED}`} data-testid="compose-estimate-failed-draft">
          {(gate.status === 'failed' ? gate : shortGate).error} <button type="button" className="underline" onClick={() => { gate.retry(); shortGate.retry(); }}>Try again</button></p>}
      </section>}

      {unsure && <SendUncertain busy={busy} onArrived={() => resolve('arrived')} onNotArrived={() => resolve('not_arrived')} testId="compose-unsure" />}
      {error && <div className={ERROR} role="alert" data-testid="compose-error">
        {typeof error === 'string' ? error : error.line}
        {typeof error === 'object' && error.topUp && <a href={ADD_TOKENS_PATH} className="ml-2 font-semibold underline">Top up</a>}
      </div>}
    </div>

    {confirm && <Lightbox title={`Send this email to ${person.name}?`} label="Confirm send" onClose={() => setConfirm(false)} width={480} testId="compose-confirm"
      footer={<div className="flex justify-end gap-2">
        <button type="button" className={BTN} onClick={() => setConfirm(false)}>Cancel</button>
        <button type="button" className={PRIMARY} disabled={busy} onClick={send} data-testid="compose-confirm-send">Send now</button>
      </div>}>
      <p className={BODY}>It goes from {account?.address} to {(edit?.to ?? '').trim()}, as it reads now: “{edit?.subject}”. Nothing else is sent.</p>
    </Lightbox>}
  </Sheet>;
}
