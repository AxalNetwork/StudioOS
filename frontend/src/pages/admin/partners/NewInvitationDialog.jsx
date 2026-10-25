import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import {
  CAPITAL_NOTE, DEAL_TYPES, LINK_FOOT, MESSAGE_HINT, MESSAGE_MAX, NAME_MAX, NEW_SUB, NEW_TITLE, TERMS_NOT_READ, TYPE_CAP,
  TYPE_FULL, TYPE_NOTE, counter, createdLines, duplicateCheck, invitationHref, isCompleteEmail, memberCheck, refusalText,
  toggleType,
} from './partnersDeskModel';
import { itemsOf, useRead } from './usePartnerDesk';
import { AMBER, CopyButton, EYE, INPUT, Refusal, SUB } from './parts';

/**
 * D923 (#2370) — New invitation (PI4, and its result PI4d / PI4n), a
 * `Lightbox` that opens in place over any tab.
 *
 * Two checks run once the email is complete, one debounced request each per
 * change, and a reply for an address no longer in the field is dropped
 * (`useRead`'s `what`): an exact, open match in R1 warns (O-DUP), an exact
 * match in R11 names the member's role. A failed check says it could not
 * check, never nothing. Three types at most (O-CAP). The result stays in the
 * dialog until Done: "Invitation sent to …" only when the Worker reports the
 * email went, the link in a field with Copy, and Open invitation. No timer
 * closes it.
 */

export const CHECK_DELAY_MS = 400;

export default function NewInvitationDialog({ reads, onClose }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [types, setTypes] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [created, setCreated] = useState(null);
  const [opening, setOpening] = useState(null);
  const [checkFor, setCheckFor] = useState('');
  // The result replaces the form, focused Send button and all, inside the same
  // Lightbox: focus moves to its Done, never to <body>.
  const doneButton = useRef(null);
  useEffect(() => { if (created) doneButton.current?.focus?.(); }, [created]);

  const typed = email.trim().toLowerCase();
  useEffect(() => {
    if (!isCompleteEmail(typed)) { setCheckFor(''); return undefined; }
    const timer = setTimeout(() => setCheckFor(typed), CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  const dupRead = useRead('check:invitations', `dup:${checkFor}`, 0, Boolean(checkFor),
    () => api.adminPartners.listInvitations({ email: checkFor }).then((r) => itemsOf(r, 'The invitations for this address')));
  const memberRead = useRead('check:members', `member:${checkFor}`, 0, Boolean(checkFor), () => api.adminListUsers({ q: checkFor }));
  const current = checkFor && checkFor === typed;
  const dup = current ? duplicateCheck(dupRead, checkFor) : null;
  const member = current ? memberCheck(memberRead, checkFor) : null;

  const ready = isCompleteEmail(typed) && types.length > 0 && !busy;
  const close = () => { if (busy) return; if (created) reads.reload(); onClose(); };

  const send = async () => {
    setBusy(true); setRefusal(null);
    try {
      const reply = await api.adminPartners.createInvitation({
        recipient_email: typed,
        recipient_name: name.trim() || undefined,
        allowed_deal_types: types,
        personal_message: message.trim() || undefined,
      });
      setCreated({ reply, email: typed });
    } catch (e) {
      setRefusal(refusalText(e, 'create'));
    } finally {
      setBusy(false);
    }
  };

  /** No single-invitation read exists: read R1 for the address, then open the row whose id the 201 named. */
  const openCreated = async () => {
    setOpening({ state: 'reading' });
    try {
      const rows = itemsOf(await api.adminPartners.listInvitations({ email: created.email }), 'The invitations for this address');
      const row = rows.find((r) => String(r?.id) === String(created.reply?.id));
      if (!row) { setOpening({ state: 'missing' }); return; }
      reads.adopt(row);
      reads.reload();
      onClose();
      navigate(invitationHref(row.id));
    } catch {
      setOpening({ state: 'failed' });
    }
  };

  if (created) {
    const lines = createdLines(created.reply, created.email);
    return (
      <Lightbox label={NEW_TITLE} title={NEW_TITLE} onClose={close} width={600} testId="partners-new"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={actionGhost} onClick={openCreated} disabled={opening?.state === 'reading'} data-testid="partners-new-open">Open invitation</button>
            <button ref={doneButton} type="button" className={actionPrimary} onClick={close} data-testid="partners-new-done">Done</button>
          </div>
        )}>
        <div className="flex flex-col gap-3 px-5 py-4" data-testid="partners-new-result">
          {lines.sent ? <p role="status" className="m-0 text-[13.5px] font-bold text-emerald-700 dark:text-emerald-400" data-testid="partners-new-sent">{lines.sent}</p> : null}
          {lines.notSent ? <p role="status" className={`m-0 text-[13px] font-semibold leading-normal ${AMBER}`} data-testid="partners-new-not-sent">{lines.notSent}</p> : null}
          <div className="flex flex-col gap-1.5">
            <span className={EYE}>Private link · valid 14 days</span>
            {created.reply?.link ? <CopyButton text={created.reply.link} label="Copy link" testId="partners-new-copy" showField /> : <span className="text-[13px] text-red-700 dark:text-red-300">The reply carried no link. Open the invitation to copy it.</span>}
          </div>
          {opening?.state === 'missing' ? <Refusal text="The new invitation was not in the list read for this address. Find it on Invitations." testId="partners-new-open-refusal" /> : null}
          {opening?.state === 'failed' ? <Refusal text="The invitations for this address could not be read. Try again." testId="partners-new-open-refusal" /> : null}
        </div>
      </Lightbox>
    );
  }

  return (
    <Lightbox label={NEW_TITLE} title={NEW_TITLE} sub={NEW_SUB} onClose={close} width={600} testId="partners-new"
      footer={(
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={actionPrimary} onClick={send} disabled={!ready} data-testid="partners-new-send">{busy ? 'Sending…' : 'Send invitation'}</button>
          </div>
          <Refusal text={refusal} />
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-4" data-testid="partners-new-form">
        <label className="flex flex-col gap-1.5">
          <span className={EYE}>Email · required</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={INPUT} data-testid="partners-new-email" />
        </label>
        {dup && dup.state !== 'clear' ? (
          <p className={`m-0 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold ${dup.state === 'failed' ? 'text-red-700 dark:text-red-300' : AMBER}`} data-testid="partners-new-dup">
            {dup.state === 'loading' ? 'Checking for an open invitation…' : dup.text}
            {dup.state === 'found' ? (
              <Link to={`/admin/partner-invitations/invitations/${dup.inv.id}`} onClick={() => { reads.adopt(dup.inv); onClose(); }} className="font-bold underline">Open it</Link>
            ) : null}
          </p>
        ) : null}
        {member && member.state !== 'clear' ? (
          <p className={`m-0 text-[12.5px] font-semibold ${member.state === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-gray-100'}`} data-testid="partners-new-member">
            {member.state === 'loading' ? 'Checking whether this address belongs to a member…' : member.text}
          </p>
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className={EYE}>Name</span>
          <input type="text" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))} className={INPUT} data-testid="partners-new-name" />
        </label>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`${EYE} mb-1.5`}>What to offer</legend>
          <p className={`m-0 ${SUB}`}>{TYPE_NOTE}</p>
          {DEAL_TYPES.map((t) => {
            const on = types.includes(t.key);
            const full = !on && types.length >= TYPE_CAP;
            return (
              <label key={t.key} className={`flex items-start gap-3 rounded-[10px] border px-3 py-2.5 ${on
                ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40'
                : 'border-axal-hairline dark:border-gray-700'} ${full ? 'opacity-60' : 'cursor-pointer'}`} data-testid={`partners-new-type-${t.key}`}>
                <input type="checkbox" checked={on} disabled={full} onChange={() => setTypes((p) => toggleType(p, t.key))} className="mt-1" data-testid={`partners-new-type-${t.key}-box`} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{t.word}</span>
                  <span className={SUB}>
                    {TERMS_NOT_READ}
                    {t.key === 'capital_partnership' ? `. ${CAPITAL_NOTE}` : ''}
                    {full ? ` ${TYPE_FULL}` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className={EYE}>Message to the invitee</span>
          <textarea value={message} maxLength={MESSAGE_MAX} rows={3} onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))} className={`${INPUT} py-2 leading-normal`} data-testid="partners-new-message" />
          <span className={SUB} data-testid="partners-new-message-count">{`${counter(message.length, MESSAGE_MAX)} · ${MESSAGE_HINT}`}</span>
        </label>
        <p className={`m-0 ${SUB}`}>{LINK_FOOT}</p>
      </div>
    </Lightbox>
  );
}
