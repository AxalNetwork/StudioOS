/**
 * #4017 (#3710 IV-D3, frames ivd3a and ivd3b; D1454 §1 Q2 A): the record's
 * Email Sheet as a form the member writes, with Ask on its Body.
 *
 *   To, From     as D1344's composer: the address is `recipientFor`'s, the
 *                mailbox `sendingAccount`'s.
 *   Subject      typed, or placed by Accept.
 *   Body         typed, or placed by Accept. While it is BLANK it carries Ask's
 *                field trigger (20px, the Eadwyn mark, `FillTrigger`); a Body
 *                that holds anything never does, and a reader never sees it.
 *                The trigger opens the draft in the Ask panel
 *                (`EmailDraftIntent`, D1443's form intent). Accept places the
 *                draft here with the "Not saved" pill (`FillMark placed`) until
 *                Send.
 *   Send         behind a confirmation, one nonce (`/send/confirm`), then the
 *                send, with the accepted draft's uid when there is one. Nothing
 *                is sent any other way.
 *
 * #4660 (part 3): once Accept has placed a draft, the member's To, Subject and
 * Body are saved to THAT draft (`PATCH /api/mail/drafts/:uid`, `useDraftEdits`)
 * with a visible save state; a failed save keeps the text and says so, and
 * closing never discards it in silence. The fund-GP question check reads the
 * accepted draft's own intent.
 *
 * The `/email` page keeps D1344's "Compose with Eadwyn" (`ComposeSheet`).
 *
 * D1357 (#3572, RI4e): "Write the intro" opens this composer with `introUid`,
 * a subject and a body to start from. The send carries `intro_uid`, so the
 * Worker records the introduction as made only once this mailbox has sent it
 * (D4329), and refuses it before anything leaves when the request is not the
 * sender's, or not accepted. `ask={false}` keeps Eadwyn's Body trigger off
 * until its intro drafts land (part 8b).
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../ui/Sheet';
import Lightbox from '../../ui/Lightbox';
import { FillMark, FillTrigger } from '../../ui/FillMark.jsx';
import { mailApi } from '../../lib/api/mail.js';
import SendUncertain from './SendUncertain.jsx';
import DraftSaveLine, { CloseNotice } from './DraftSaveLine.jsx';
import { useDraftEdits } from './useDraftEdits.js';
import { makeSendOperation, NOT_RECORDED_LINE, PENDING_LINE, readOutcome, sendFailure } from './sendOperation.js';
import EmailDraftIntent from './EmailDraftIntent.jsx';
import { bodyText, showBodyTrigger } from './emailModel.js';
import { BODY, BTN, ERROR, EYEBROW, INPUT, MUTED, PRIMARY } from './emailParts.jsx';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * #4611 finding 10 — "COULD NOT BE READ" AND "NONE CONNECTED" ARE DIFFERENT
 * ANSWERS, AND THIS COMPONENT USED TO GIVE ONE SENTENCE FOR BOTH.
 *
 * `account` arrives as a prop and this component branched on its truthiness
 * alone, so a null from a FAILED mailbox lookup and a null from a member with
 * no mailbox both rendered "Connect a mailbox to send" and "From no mailbox
 * yet" — telling someone whose mailbox is connected to go and connect it, and
 * hiding an outage behind a setup prompt.
 *
 * `mailboxes` makes the caller say which it is, and there is no default that
 * guesses: `'connected'` (the list had one), `'none'` (the read SUCCEEDED and
 * the list was empty) or `'unreadable'` (the read failed). Both callers already
 * hold that distinction — `RecordEmailSheet` has an `unreadable` state and
 * `IntroCompose` an `error` one — and neither passed it on, which is why it was
 * lost here rather than never known.
 *
 * `'none'` IS THE ONLY STATE THAT GETS SETUP GUIDANCE, and it gets a route to
 * follow rather than an instruction with nowhere to go: the finding's
 * "connection guidance follows a successful empty mailbox response". An
 * `'unreadable'` composer says the read failed and offers no setup step,
 * because there may be nothing to set up.
 */
export default function RecordCompose({ pack, refs, project = null, to, account, mailboxes = account ? 'connected' : 'none', from = null, readOnly = false, onClose, onSent, api = mailApi, introUid = null, initialSubject = '', initialBody = '', ask = true, title = 'Email', saveDelayMs }) {
  const person = pack.person;
  const [address, setAddress] = useState(to ?? '');
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [asking, setAsking] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [unsure, setUnsure] = useState(null);
  const operation = useRef(null);
  if (!operation.current) operation.current = makeSendOperation();
  const edits = useDraftEdits({ api, to: address, delayMs: saveDelayMs });

  const accept = (draft) => {
    edits.adopt(draft);
    setSubject(draft.subject ?? '');
    setBody(draft.body ?? '');
    // The draft's own intent (what it was generated for), never the form's live one: the fund-GP check reads it.
    setPlaced({ uid: draft.uid, body: draft.body ?? '', intent: draft.intent ?? null, draft });
    setAsking(false);
  };
  // Once a draft is placed, every change to the form is also the member's saved text of that draft.
  const edit = (patch) => {
    const next = { to: address, subject, body, ...patch };
    if ('to' in patch) setAddress(patch.to);
    if ('subject' in patch) setSubject(patch.subject);
    if ('body' in patch) setBody(patch.body);
    if (placed) edits.queue(placed.uid, next);
  };
  const saveState = placed ? edits.stateOf(placed.draft) : null;
  const guardedClose = edits.guardClose(onClose);
  const send = async () => {
    setBusy(true); setError(null);
    try {
      const { nonce } = await api.confirmSend(account.uid);
      const key = operation.current.keyFor([account.uid, address.trim(), subject, body, placed?.uid ?? null, introUid ?? null]);
      const r = await api.send({ account_uid: account.uid, to: address.trim(), subject, body, ...(placed ? { draft_uid: placed.uid } : {}), ...(introUid ? { intro_uid: introUid } : {}), operation_key: key, nonce });
      setConfirm(false);
      const out = readOutcome(r);
      if (out.state === 'accepted') { operation.current.forget(); setPlaced(null); onSent?.(out.sent); }
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
      if (outcome === 'arrived') { setPlaced(null); onSent?.(null); } else setError('Marked as not sent. You can send it again.');
    } catch (e) { setError(e?.message || 'That could not be recorded. Try again.'); }
    finally { setBusy(false); }
  };

  // D1344's fund rule: an opening Eadwyn wrote for a question is not sent until the member adds the question.
  const questionOpening = person.kind === 'fund_gp' && placed?.intent === 'ask_question';
  const questionNeedsEdit = !!(questionOpening && bodyText(body) === bodyText(placed?.body));
  const sendable = !readOnly && !!(subject.trim() && body.trim() && account && EMAIL.test(address.trim()) && !questionNeedsEdit);
  const trigger = ask && showBodyTrigger({ body, readOnly, open: asking });

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={PRIMARY} disabled={!sendable || busy || !!unsure} onClick={() => setConfirm(true)} data-testid="record-compose-send">
        {account ? `Send from ${account.address}` : mailboxes === 'unreadable' ? 'Your mailboxes could not be read' : 'Connect a mailbox to send'}
      </button>
      <span className={`text-[12px] ${MUTED}`}>Nothing is sent until you press Send.</span>
    </div>
  );

  return <Sheet title={title} eyebrow="Email" sub={`Email to ${person.name}`} onClose={guardedClose} footer={readOnly ? null : footer} width={560} testId="record-compose">
    <div className="flex flex-col gap-4">
      {from && <p className="rounded-axal-md bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-violet-deep dark:bg-violet-950/40 dark:text-violet-300">Opened from {from}.</p>}
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>To</span>
        <input type="email" className={INPUT} value={address} onChange={(e) => edit({ to: e.target.value })} placeholder={`${person.name}’s address`} readOnly={readOnly}
          aria-describedby={to ? undefined : 'record-compose-no-address'} data-testid="record-compose-to" />
        {!to && <span id="record-compose-no-address" className={`text-[12px] ${MUTED}`}>No address is recorded for {person.name}. Type the one to send to.</span>}
      </label>
      <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="record-compose-from">From {account ? account.address : mailboxes === 'unreadable' ? 'a mailbox that could not be read' : 'no mailbox yet'}</p>
      {/* #4611 finding 10: guidance only after a read that SUCCEEDED and came
          back empty. A failed read says so and stops — it cannot know whether
          there is a mailbox to connect, and a setup prompt would assert there
          is not. */}
      {!account && mailboxes === 'none' ? (
        <p className="m-0 text-[12.5px]" data-testid="record-compose-connect">
          No mailbox is connected to this account, so nothing can be sent yet.{' '}
          <Link to="/email/settings" className="font-bold underline">Connect a mailbox</Link>, then open this again.
        </p>
      ) : null}
      {!account && mailboxes === 'unreadable' ? (
        <p className={`m-0 text-[12.5px] ${ERROR}`} role="alert" data-testid="record-compose-mailboxes-unreadable">
          Your mailboxes could not be read, so this cannot be sent. That is a failed read, not a missing mailbox — nothing about your setup has changed.
        </p>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>Subject</span>
        <input className={INPUT} value={subject} onChange={(e) => edit({ subject: e.target.value })} readOnly={readOnly} data-testid="record-compose-subject" />
      </label>
      <div className="flex flex-col gap-1">
        <span className="flex min-h-[32px] items-center justify-between gap-2">
          <label htmlFor="record-compose-body" className={EYEBROW}>Body{placed ? <FillMark mark={null} placed /> : null}</label>
          {/* The shared 20px trigger; its hit area is 44px below 1024px (touch). */}
          {trigger ? <span className="max-lg:[&>button]:h-11 max-lg:[&>button]:w-11" data-testid="record-compose-trigger"><FillTrigger label="the body" onOpen={() => setAsking(true)} /></span> : null}
        </span>
        <textarea id="record-compose-body" className={`${INPUT} min-h-[220px] py-2`} value={body} onChange={(e) => edit({ body: e.target.value })} readOnly={readOnly}
          aria-describedby={questionOpening ? 'record-compose-question' : undefined} data-testid="record-compose-body-field" />
        {placed && !readOnly && <DraftSaveLine state={saveState} onRetry={() => edits.retry(placed.uid)} testId="record-compose-save-state" />}
        {questionOpening && <p id="record-compose-question" className={`m-0 text-[12.5px] ${BODY}`} data-testid="record-compose-question">Eadwyn wrote an opening. Add your question to the body before sending.</p>}
      </div>
      <CloseNotice closing={edits.closing} onRetry={guardedClose} onCloseAnyway={edits.closeAnyway(onClose)} testId="record-compose-close-notice" />
      {unsure && <SendUncertain busy={busy} onArrived={() => resolve('arrived')} onNotArrived={() => resolve('not_arrived')} testId="record-compose-unsure" />}
      {error && <div className={ERROR} role="alert" data-testid="record-compose-error">{error}</div>}
    </div>

    {asking && <EmailDraftIntent person={person} refs={refs} project={project} api={api} onAccept={accept} onClose={() => setAsking(false)} />}

    {confirm && <Lightbox title={`Send this email to ${person.name}?`} label="Confirm send" onClose={() => setConfirm(false)} width={480} testId="record-compose-confirm"
      footer={<div className="flex justify-end gap-2">
        <button type="button" className={BTN} onClick={() => setConfirm(false)}>Cancel</button>
        <button type="button" className={PRIMARY} disabled={busy} onClick={send} data-testid="record-compose-confirm-send">Send now</button>
      </div>}>
      <p className={BODY}>It goes from {account?.address} to {address.trim()}, as it reads now: “{subject}”. Nothing else is sent.</p>
    </Lightbox>}
  </Sheet>;
}
