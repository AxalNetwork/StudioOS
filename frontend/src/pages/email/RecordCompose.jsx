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
 * The `/email` page keeps D1344's "Compose with Eadwyn" (`ComposeSheet`).
 */
import { useState } from 'react';
import Sheet from '../../ui/Sheet';
import Lightbox from '../../ui/Lightbox';
import { FillMark, FillTrigger } from '../../ui/FillMark.jsx';
import { mailApi } from '../../lib/api/mail.js';
import EmailDraftIntent from './EmailDraftIntent.jsx';
import { bodyText, showBodyTrigger } from './emailModel.js';
import { BODY, BTN, ERROR, EYEBROW, INPUT, MUTED, PRIMARY } from './emailParts.jsx';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RecordCompose({ pack, refs, project = null, to, account, from = null, readOnly = false, onClose, onSent, api = mailApi }) {
  const person = pack.person;
  const [address, setAddress] = useState(to ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [asking, setAsking] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);

  const accept = (draft) => {
    setSubject(draft.subject ?? '');
    setBody(draft.body ?? '');
    setPlaced({ uid: draft.uid, body: draft.body ?? '', intent: draft.intent ?? null });
    setAsking(false);
  };
  const send = async () => {
    setBusy(true); setError(null);
    try {
      const { nonce } = await api.confirmSend(account.uid);
      const r = await api.send({ account_uid: account.uid, to: address.trim(), subject, body, ...(placed ? { draft_uid: placed.uid } : {}), nonce });
      setConfirm(false);
      setPlaced(null);
      onSent?.(r?.sent ?? null);
    } catch (e) { setConfirm(false); setError(e?.message || 'The mail server refused it. Nothing was sent.'); }
    finally { setBusy(false); }
  };

  // D1344's fund rule: an opening Eadwyn wrote for a question is not sent until the member adds the question.
  const questionOpening = person.kind === 'fund_gp' && placed?.intent === 'ask_question';
  const questionNeedsEdit = !!(questionOpening && bodyText(body) === bodyText(placed?.body));
  const sendable = !readOnly && !!(subject.trim() && body.trim() && account && EMAIL.test(address.trim()) && !questionNeedsEdit);
  const trigger = showBodyTrigger({ body, readOnly, open: asking });

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={PRIMARY} disabled={!sendable || busy} onClick={() => setConfirm(true)} data-testid="record-compose-send">
        {account ? `Send from ${account.address}` : 'Connect a mailbox to send'}
      </button>
      <span className={`text-[12px] ${MUTED}`}>Nothing is sent until you press Send.</span>
    </div>
  );

  return <Sheet title="Email" eyebrow="Email" sub={`Email to ${person.name}`} onClose={onClose} footer={readOnly ? null : footer} width={560} testId="record-compose">
    <div className="flex flex-col gap-4">
      {from && <p className="rounded-axal-md bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-violet-deep dark:bg-violet-950/40 dark:text-violet-300">Opened from {from}.</p>}
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>To</span>
        <input type="email" className={INPUT} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`${person.name}’s address`} readOnly={readOnly}
          aria-describedby={to ? undefined : 'record-compose-no-address'} data-testid="record-compose-to" />
        {!to && <span id="record-compose-no-address" className={`text-[12px] ${MUTED}`}>No address is recorded for {person.name}. Type the one to send to.</span>}
      </label>
      <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="record-compose-from">From {account ? account.address : 'no mailbox yet'}</p>
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>Subject</span>
        <input className={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)} readOnly={readOnly} data-testid="record-compose-subject" />
      </label>
      <div className="flex flex-col gap-1">
        <span className="flex min-h-[32px] items-center justify-between gap-2">
          <label htmlFor="record-compose-body" className={EYEBROW}>Body{placed ? <FillMark mark={null} placed /> : null}</label>
          {/* The shared 20px trigger; its hit area is 44px below 1024px (touch). */}
          {trigger ? <span className="max-lg:[&>button]:h-11 max-lg:[&>button]:w-11" data-testid="record-compose-trigger"><FillTrigger label="the body" onOpen={() => setAsking(true)} /></span> : null}
        </span>
        <textarea id="record-compose-body" className={`${INPUT} min-h-[220px] py-2`} value={body} onChange={(e) => setBody(e.target.value)} readOnly={readOnly}
          aria-describedby={questionOpening ? 'record-compose-question' : undefined} data-testid="record-compose-body-field" />
        {questionOpening && <p id="record-compose-question" className={`m-0 text-[12.5px] ${BODY}`} data-testid="record-compose-question">Eadwyn wrote an opening. Add your question to the body before sending.</p>}
      </div>
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
