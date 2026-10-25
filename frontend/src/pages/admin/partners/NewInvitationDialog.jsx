import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import {
  CAPITAL_NOTE, DEAL_TYPES, LINK_FOOT, MESSAGE_HINT, MESSAGE_MAX, NAME_MAX, NEW_SUB, NEW_TITLE, READING, TYPE_CAP,
  TYPE_FULL, TYPE_NOTE, counter, createdLines, invitationHref, isCompleteEmail, refusalText, toggleType,
} from './partnersDeskModel';
import { PREVIEW_ASKS, PREVIEW_FAILED, PREVIEW_NOTE, lookupChecks, previewFor, previewReply } from './invitationsModel';
import { useRead } from './usePartnerDesk';
import { AMBER, CopyButton, EYE, INPUT, Refusal, SUB } from './parts';

/**
 * D923 (#2370) — New invitation (PI4, and its result PI4d / PI4n), a
 * `Lightbox` that opens in place over any tab.
 *
 * D950 (#2726): the five cards show part 4's offer preview (D927 §4), the
 * Worker's text over a neutral profile, with the parts the invitee's answers
 * fill said under it. The preview offers three types per ask, so it is read
 * in two asks once, as the dialog opens. A card whose preview could not be
 * read says so, and the invitation can still be sent.
 *
 * The two checks are one read of part 3's lookup (D926 §5), made once the
 * email is complete, one debounced request per change; a reply for an
 * address no longer in the field is dropped (`useRead`'s `what`). An open
 * invitation to the address warns (O-DUP), never refuses; a member is named
 * by role, and since part 2 (D925) signing adds the partner deal without
 * lowering a paid plan. A failed check says it could not check, never
 * nothing. Three types at most (O-CAP). The result stays in the dialog until
 * Done: "Invitation sent to …" only when the Worker reports the email went,
 * the link in a field with Copy, and Open invitation. No timer closes it.
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
  const lookup = useRead('check:lookup', `lookup:${checkFor}`, 0, Boolean(checkFor), () => api.adminPartners.lookupInvitation(checkFor));
  const current = checkFor && checkFor === typed;
  const checks = current ? lookupChecks(lookup) : null;
  const dup = checks?.dup || null;
  const member = checks?.member || null;
  const [previewTry, setPreviewTry] = useState(0);
  const preview = useRead('offers:preview', 'preview', previewTry, true,
    () => Promise.all(PREVIEW_ASKS.map((types) => api.adminPartners.previewOffers(types))).then(previewReply));

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

  /** D950: the record reads its own row (D927), so the id the 201 named is all it needs. */
  const openCreated = () => {
    const id = created.reply?.id;
    if (id === null || id === undefined) { setOpening({ state: 'missing' }); return; }
    reads.reload();
    onClose();
    navigate(invitationHref(id));
  };

  if (created) {
    const lines = createdLines(created.reply, created.email);
    return (
      <Lightbox label={NEW_TITLE} title={NEW_TITLE} onClose={close} width={600} testId="partners-new"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={actionGhost} onClick={openCreated} data-testid="partners-new-open">Open invitation</button>
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
          {opening?.state === 'missing' ? <Refusal text="The reply did not name the new invitation. Find it on Invitations." testId="partners-new-open-refusal" /> : null}
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
              <Link to={invitationHref(dup.id)} onClick={() => onClose()} className="font-bold underline" data-testid="partners-new-dup-open">Open it</Link>
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
          {preview.status === 'ready' ? <p className={`m-0 ${SUB}`}>{PREVIEW_NOTE}</p> : null}
          {preview.status === 'error' ? (
            <p className={`m-0 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold ${AMBER}`} data-testid="partners-new-preview-failed">
              {PREVIEW_FAILED}
              <button type="button" className="underline" onClick={() => setPreviewTry((n) => n + 1)}>Try again</button>
            </p>
          ) : null}
          {DEAL_TYPES.map((t) => {
            const on = types.includes(t.key);
            const full = !on && types.length >= TYPE_CAP;
            const p = previewFor(preview, t.key);
            return (
              <label key={t.key} className={`flex items-start gap-3 rounded-[10px] border px-3 py-2.5 ${on
                ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40'
                : 'border-axal-hairline dark:border-gray-700'} ${full ? 'opacity-60' : 'cursor-pointer'}`} data-testid={`partners-new-type-${t.key}`}>
                <input type="checkbox" checked={on} disabled={full} onChange={() => setTypes((p) => toggleType(p, t.key))} className="mt-1" data-testid={`partners-new-type-${t.key}-box`} />
                <span className="flex min-w-0 flex-col gap-0.5" data-testid={`partners-new-type-${t.key}-card`}>
                  <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{p.state === 'ready' ? p.card.label : t.word}</span>
                  {p.state === 'ready' && p.card.summary ? <span className="text-[12.5px] leading-snug text-axal-ink dark:text-gray-100">{p.card.summary}</span> : null}
                  {p.state === 'ready' && p.card.terms.length ? (
                    <span className={SUB} data-testid={`partners-new-type-${t.key}-terms`}>{p.card.terms.map((x) => `${x.label}: ${x.value}`).join(' · ')}</span>
                  ) : null}
                  {p.state === 'ready' && p.card.term ? <span className={SUB}>{`Term: ${p.card.term}`}</span> : null}
                  {p.state === 'ready' && p.card.dependent.length ? <span className={`text-[11.5px] font-semibold ${AMBER}`}>{p.card.dependent.join(' ')}</span> : null}
                  {p.state === 'loading' ? <span className={SUB}>{READING}</span> : null}
                  {p.state === 'unreadable' ? <span className={SUB}>The terms could not be read.</span> : null}
                  {p.state === 'none' ? <span className={SUB}>The preview returned no offer for this type.</span> : null}
                  {t.key === 'capital_partnership' || full ? (
                    <span className={SUB}>
                      {t.key === 'capital_partnership' ? CAPITAL_NOTE : ''}
                      {full ? `${t.key === 'capital_partnership' ? ' ' : ''}${TYPE_FULL}` : ''}
                    </span>
                  ) : null}
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
