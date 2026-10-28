/**
 * D1344 — "Compose with Eadwyn" (EM3a before a draft, EM3b after), in the one
 * right Sheet (D1317). Eadwyn drafts; the member sends.
 *
 *   · What it is for (the person's relationship's intents), tone, length, and
 *     the live update blocks.
 *   · The estimate is read before every draft (`estimate: true` runs nothing)
 *     and shown on the Draft button's line; Draft is not pressable without it.
 *   · The draft: its subject and body (editable by hand), "Used: … Nothing
 *     else was read.", its versions (‹ ›), Regenerate (a new estimate first),
 *     and Shorter (a revision).
 *   · Send, behind a confirmation: one nonce (`/send/confirm`), then the send.
 *     No "Copy to Gmail drafts" (D1347 §3): every draft is kept in Axal VC.
 *     Schedule is not drawn: nothing on the Worker schedules a send yet.
 */
import { useEffect, useMemo, useState } from 'react';
import Sheet from '../../ui/Sheet';
import Lightbox from '../../ui/Lightbox';
import { mailApi } from '../../lib/api/mail.js';
import { ADD_TOKENS_PATH } from '../../lib/aiTokens';
import { canDraft, estimateLine, INTENTS, LENGTHS, TONES } from './emailModel.js';
import { BODY, BTN, Chips, ERROR, EYEBROW, INPUT, MUTED, PRIMARY } from './emailParts.jsx';

const BLOCKS = [
  { value: 'kpis', label: 'KPIs' }, { value: 'raise_status', label: 'Raise status' }, { value: 'project_progress', label: 'Project progress' },
  { value: 'interview_insights', label: 'Interview insights' }, { value: 'one_liner', label: 'Company one-liner' },
];
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const bodyText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export default function ComposeSheet({ pack, refs, project = null, to, account, from = null, onClose, onSent, onAddAddress, api = mailApi }) {
  const person = pack.person;
  const intents = INTENTS[person.relationship] ?? [];
  const [intent, setIntent] = useState(intents[0]?.key ?? null);
  const [tone, setTone] = useState('warm');
  const [length, setLength] = useState('short');
  const [blocks, setBlocks] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [versions, setVersions] = useState([]);
  const [at, setAt] = useState(0);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [address, setAddress] = useState(to ?? '');

  const ask = useMemo(() => ({ person: person.ref, intent, tone, length, refs, blocks, ...(project ? { project } : {}) }),
    [person.ref, intent, tone, length, refs, blocks, project]);
  const draft = versions[at] ?? null;

  // The estimate, read again whenever the request changes; nothing runs and nothing is charged.
  useEffect(() => {
    let live = true;
    setEstimate(null);
    if (!intent) return undefined;
    api.estimate(ask).then((r) => { if (live) setEstimate(r?.estimate ?? null); }).catch((e) => { if (live) setError(e?.message || 'The estimate could not be read. Try again.'); });
    return () => { live = false; };
  }, [ask, api, intent]);

  useEffect(() => { setEdit(draft ? { subject: draft.subject, body: draft.body } : null); }, [draft]);

  const run = async (go) => {
    setBusy(true); setError(null);
    try { const r = await go(); if (r?.draft) { setVersions((v) => [...v, r.draft]); setAt(versions.length); } }
    catch (e) { setError(e?.status === 402 ? { line: e.message || 'Not enough AI tokens for this draft.', topUp: true } : (e?.message || 'Eadwyn could not draft this email. Try again.')); }
    finally { setBusy(false); }
  };
  const press = () => run(() => api.draft(ask));
  const shorter = () => draft && run(() => api.revise(draft.uid, { instruction: 'shorter', ...(project ? { project } : {}) }));

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const { nonce } = await api.confirmSend(account.uid);
      const r = await api.send({ account_uid: account.uid, to: address.trim(), subject: edit.subject, body: edit.body, draft_uid: draft.uid, nonce });
      setConfirm(false);
      onSent?.(r?.sent ?? null);
    } catch (e) { setConfirm(false); setError(e?.message || 'The mail server refused it. Nothing was sent.'); }
    finally { setBusy(false); }
  };

  const line = estimateLine(estimate);
  const questionOpening = person.kind === 'fund_gp' && intent === 'ask_question';
  const questionNeedsEdit = !!(questionOpening && draft && bodyText(edit?.body) === bodyText(draft.body));
  const sendable = !!(draft && edit?.subject?.trim() && edit?.body?.trim() && account && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()) && !questionNeedsEdit);
  const footer = draft
    ? <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} disabled={!sendable || busy} onClick={() => setConfirm(true)} data-testid="compose-send">
          {account ? `Send from ${account.address}` : 'Connect a mailbox to send'}
        </button>
        <span className={`text-[12px] ${MUTED}`}>Every draft is kept in Axal VC.</span>
      </div>
    : <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-[12px] ${MUTED}`}>Eadwyn drafts. You send.</span>
        <button type="button" className={PRIMARY} disabled={!canDraft({ estimate, intent, busy })} onClick={press} data-testid="compose-draft">Draft with Eadwyn</button>
      </div>;

  return <Sheet title="Compose with Eadwyn" eyebrow="Email" sub={`Email to ${person.name}`} onClose={onClose} footer={footer} width={560} testId="compose-sheet">
    <div className="flex flex-col gap-4">
      {from && <p className={`rounded-axal-md bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-violet-deep dark:bg-violet-950/40 dark:text-violet-300`}>Opened from {from}. Person and context are filled in.</p>}
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>To</span>
        <input type="email" className={INPUT} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`${person.name}’s address`}
          aria-describedby={to ? undefined : 'compose-no-address'} data-testid="compose-to" />
        {!to && <span id="compose-no-address" className={`text-[12px] ${MUTED}`}>No address is recorded for {person.name}. Type the one to send to{onAddAddress ? ', or add it to their record' : ''}.</span>}
      </label>
      <p className={`text-[12.5px] ${MUTED}`} data-testid="compose-from">From {account ? account.address : 'no mailbox yet'}</p>
      {questionOpening && <p className={`text-[12.5px] ${BODY}`} id="compose-fund-question" data-testid="compose-fund-question">Eadwyn writes an opening. Add your question to the draft body before sending.</p>}

      {!draft && <>
        <section className="flex flex-col gap-1.5"><span className={EYEBROW}>What is it for</span>
          <Chips label="What is it for" testId="compose-intents" value={intent} onChange={setIntent} options={intents.map((i) => ({ value: i.key, label: i.label }))} /></section>
        <div className="flex flex-wrap gap-4">
          <section className="flex flex-col gap-1.5"><span className={EYEBROW}>Tone</span>
            <Chips label="Tone" value={tone} onChange={setTone} options={TONES.map((t) => ({ value: t, label: cap(t) }))} /></section>
          <section className="flex flex-col gap-1.5"><span className={EYEBROW}>Length</span>
            <Chips label="Length" value={length} onChange={setLength} options={LENGTHS.map((l) => ({ value: l, label: cap(l) }))} /></section>
        </div>
        <section className="flex flex-col gap-1.5"><span className={EYEBROW}>Insert a live update</span>
          <div className="flex flex-wrap gap-1.5" data-testid="compose-blocks">{BLOCKS.map((b) => {
            const on = blocks.includes(b.value);
            return <button key={b.value} type="button" aria-pressed={on} className={BTN}
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
        <input className={INPUT} aria-label="Subject" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
        <textarea className={`${INPUT} min-h-[220px] py-2`} aria-label="Body" aria-describedby={questionOpening ? 'compose-fund-question' : undefined} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
        <p className={`text-[12px] ${MUTED}`} data-testid="compose-used">Used: {(draft.sources ?? []).map((s) => s.label).join(', ') || 'nothing'}. Nothing else was read.</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={BTN} disabled={!canDraft({ estimate, intent, busy })} onClick={press}>Regenerate{line ? '' : ' (reading the estimate…)'}</button>
          <button type="button" className={BTN} disabled={busy} onClick={shorter}>Shorter</button>
        </div>
        {line && <p className={`text-[12px] ${MUTED}`}>{line}</p>}
      </section>}

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
      <p className={BODY}>It goes from {account?.address} to {address.trim()}, as it reads now: “{edit?.subject}”. Nothing else is sent.</p>
    </Lightbox>}
  </Sheet>;
}
