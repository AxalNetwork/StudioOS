import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { Lightbox, actionDanger, actionGhost } from '../../../ui';
import useRecordCrumb from '../useRecordCrumb';
import {
  AGREEMENT_NOT_READY, ANSWERS_LOGGED, LINK_LAPSED, NOT_OFFERED, READING, agreementLine, agreementReady, answersOf, dayOr,
  dealTypeWord, envelopeHref, findInvitation, invitationRow, isRecordId, linkLine, signingLink,
} from './partnersDeskModel';
import {
  NO_MESSAGE, blockOf, chosenDeal, detailReply, detailState, historyLines, messageOf, offersSeen, refusalLines, sendLine, stepRows,
} from './invitationsModel';
import { itemsOf, useRead } from './usePartnerDesk';
import {
  AMBER, CopyButton, EYE, Fact, LINK, ReadState, SUB, StageCell,
} from './parts';

/**
 * D950 (#2726) — one invitation (PI3; PI11c on a phone), at
 * `/admin/partner-invitations/invitations/:id`, on part 4's read (D927 §3):
 * the row with its message and send columns, the seven step dates, the offers
 * the invitee saw, the chosen deal, the agreement's refusals and the history,
 * each block answering alone. On a desktop it is a `Lightbox` over the
 * Invitations tab; on a phone the same `Lightbox` draws a full page with
 * "‹ Invitations". Closing returns to the tab, and focus to the row.
 *
 * The read carries no token, so the link to copy comes from the list row: the
 * one the page has (R1, the tab's page, or a row read for its address), or
 * the row read for this invitation's address. R7 gives the envelope; R12,
 * their answers, is read only when the admin asks, because each read is
 * logged.
 */

const SECTION = 'flex flex-col gap-2 border-t border-axal-hairline pt-3 first:border-t-0 first:pt-0 dark:border-gray-700';

function Section({ title, children, testId }) {
  return (
    <section className={SECTION} data-testid={testId}>
      <h3 className={EYE}>{title}</h3>
      {children}
    </section>
  );
}

/** A block of the read that could not be read: the Worker's reason, never "none". */
function BlockFailed({ reason, what, testId }) {
  return <p role="alert" className="m-0 text-[13px] text-red-700 dark:text-red-300" data-testid={testId}>{reason || `${what} could not be read. That is not the same as none.`}</p>;
}

export default function InvitationRecord({ id, reads, now, onClose, actions }) {
  const [retry, setRetry] = useState(0);
  const detail = useRead('invitation', `invitation:${id}`, reads.tick + retry, isRecordId(id),
    () => api.adminPartners.getInvitation(id).then(detailReply));
  const data = detail.data;
  const found = findInvitation(id, reads.invitations, reads.extra);
  const listed = found.state === 'ready' ? found.inv : null;
  const email = data?.invitation?.recipient_email || null;
  // The link lives only on a list row: read this address's rows when the page has none for this id.
  const rowRead = useRead('invitation-row', `row:${id}:${email}`, reads.tick, Boolean(email) && !listed,
    () => api.adminPartners.listInvitations({ email }).then((r) => itemsOf(r, 'The invitations for this address').find((i) => String(i?.id) === String(id)) || null));
  const linkRow = listed || rowRead.data || null;
  const inv = data ? { ...(linkRow || {}), ...data.invitation, link: linkRow?.link ?? null } : null;
  const envelopeId = inv?.envelope_id ?? null;
  const envelope = useRead('envelope', `envelope:${envelopeId}`, reads.tick, envelopeId !== null, () => api.esignDetail(envelopeId));
  const [askAnswers, setAskAnswers] = useState(false);
  const [answersTry, setAnswersTry] = useState(0);
  // Its own tick: the answers are read once, on request, and again only when
  // the admin asks again; a reload of the desk never reads them.
  const profile = useRead('profile', `profile:${inv?.recipient_email}`, answersTry, askAnswers && Boolean(inv?.recipient_email), () => api.adminGetProfile(inv.recipient_email));
  useRecordCrumb(inv ? (String(inv.recipient_name || '').trim() || inv.recipient_email) : null, null, null);

  if (!inv) {
    const state = isRecordId(id) ? detailState(detail) : 'missing';
    const gone = state === 'missing' || Number(detail.error?.status) === 404;
    return (
      <Lightbox label="Invitation" title="Invitation" eyebrow="Invitations" onClose={onClose} width={560} pageBelow="lg" testId="partners-invitation">
        <div className="flex flex-col gap-2 px-5 py-4" data-testid="partners-invitation-absent">
          {state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
          {gone ? (
            <>
              <p className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">There is no such invitation.</p>
              <p className={`m-0 ${SUB}`} data-testid="partners-invitation-absent-reason">No invitation has this address. It may have been typed or copied wrongly.</p>
            </>
          ) : null}
          {!gone && (state === 'unreadable' || state === 'paused') ? <ReadState read={{ ...detail, data: null }} what="This invitation" claim="That is not a claim that it does not exist." onRetry={() => setRetry((n) => n + 1)} testId="partners-invitation-read" /> : null}
        </div>
      </Lightbox>
    );
  }

  const row = invitationRow(inv, { now, repair: false });
  const { stage } = row;
  const steps = stepRows(data.steps, stage);
  const link = linkLine(inv, stage);
  const signing = stage.step === 6 && envelopeId !== null ? signingLink(envelope, now) : null;
  const ready = agreementReady(reads.template);
  const chosen = chosenDeal(data.chosen_deal);
  const seen = offersSeen(data.offers_seen, inv);
  const refusals = refusalLines(data.agreement_refusals);
  const history = historyLines(data.history);
  const send = sendLine(inv);
  const message = messageOf(inv);
  const answers = answersOf(askAnswers ? profile : null, inv);
  const sentBy = row.invitedBy === 'Not recorded' ? `Sent on ${row.sent} · sender not recorded` : `Sent by ${row.invitedBy} on ${row.sent}`;
  const name = row.named ? row.name : inv.recipient_email;
  const linkMissing = !row.link && (listed || rowRead.status !== 'loading');

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid="partners-invitation-actions">
      {inv.status === 'signed' && row.dealId !== null ? <Link to={`/admin/partner-invitations/deals/${row.dealId}`} className={actionGhost}>Open deal</Link> : null}
      {!stage.closed ? (
        <>
          {stage.lapsed ? <span className={`text-[12px] font-semibold ${AMBER}`}>{LINK_LAPSED}</span> : null}
          {!stage.lapsed && row.link ? <CopyButton text={row.link} label="Copy link" testId="partners-invitation-copy" /> : null}
          {!stage.lapsed && !row.link ? <span className={`text-[12px] font-semibold ${AMBER}`} data-testid="partners-invitation-no-link">{linkMissing ? 'The link could not be read here. Resend gives the invitee a fresh one.' : READING}</span> : null}
          <button type="button" className={actionGhost} onClick={() => actions.resend(inv)} data-testid="partners-invitation-resend">Resend</button>
          <button type="button" className={actionDanger} onClick={() => actions.revoke(inv)} data-testid="partners-invitation-revoke">Revoke</button>
        </>
      ) : null}
    </div>
  );

  return (
    <Lightbox label={`Invitation for ${name}`} title={row.name} sub={`${row.email} · ${sentBy}`} eyebrow="Invitations" onClose={onClose}
      width={940} pageBelow="lg" testId="partners-invitation" footer={footer}>
      <div className="flex flex-col gap-4 px-5 py-4" data-testid="partners-invitation-body">
        {/* A refresh that failed keeps the record from the last read, under the line (D923 §2). */}
        <ReadState read={detail} what="this invitation" kept="The record below is from the last read." onRetry={() => setRetry((n) => n + 1)} testId="partners-invitation-read" />
        <div className="flex flex-wrap items-center gap-3"><StageCell stage={stage} testId="partners-invitation-stage" /></div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Section title="Progress" testId="partners-invitation-progress">
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                {steps.map((p) => (
                  <li key={p.key} className="flex items-baseline justify-between gap-3 text-[13px]" data-testid={`partners-progress-${p.key}`}>
                    <span className="text-axal-ink dark:text-gray-100">{p.label}</span>
                    <span className={`font-mono text-[12px] ${p.failed ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`}>{p.value}</span>
                  </li>
                ))}
              </ol>
              {blockOf(data.steps).state !== 'ready' ? <BlockFailed reason={blockOf(data.steps).reason} what="The step dates" testId="partners-invitation-steps-failed" /> : null}
              <p className={`m-0 text-[12.5px] font-semibold ${link.tone === 'amber' ? AMBER : 'text-axal-ink dark:text-gray-100'}`} data-testid="partners-invitation-link">{link.text}</p>
              {link.warn ? <p className={`m-0 text-[12px] font-semibold ${AMBER}`}>{link.warn}</p> : null}
              <p className={`m-0 text-[12.5px] ${send.key === 'not_sent' ? `font-semibold ${AMBER}` : 'text-axal-ink dark:text-gray-100'}`} data-testid="partners-invitation-send">{send.line}</p>
              {signing?.state === 'live' ? <p className={`m-0 ${SUB}`} data-testid="partners-invitation-signing">{`Signing link valid until ${signing.day}`}</p> : null}
              {signing?.state === 'expired' ? (
                <p className={`m-0 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold ${AMBER}`} data-testid="partners-invitation-signing">
                  {`Signing link expired ${signing.day}`}
                  <a href={envelopeHref(envelopeId)} className={LINK}>Open the envelope</a>
                </p>
              ) : null}
              {signing && (signing.state === 'unreadable' || signing.state === 'paused') ? <ReadState read={envelope} what="The envelope" claim="That is not a claim that nothing was sent." onRetry={reads.reload} /> : null}
            </Section>

            <Section title="What we offered" testId="partners-invitation-offered">
              {row.offered.unreadable ? <span className="text-[13px] text-red-700 dark:text-red-300">The types offered could not be read.</span> : (
                <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">
                  {row.offered.shown.map(dealTypeWord).join(' · ')}
                  {row.offered.others.length ? <span className={`block ${SUB}`}>{`${row.offered.others.map(dealTypeWord).join(', ')}: ${NOT_OFFERED}`}</span> : null}
                </p>
              )}
              {seen.state === 'unreadable' ? <BlockFailed reason={seen.reason} what="The offers the invitee saw" testId="partners-invitation-offers-failed" /> : null}
              {seen.state === 'not_shown' ? <p className={`m-0 ${SUB}`} data-testid="partners-invitation-offers-none">{seen.text}</p> : null}
              {seen.state === 'ready' ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="partners-invitation-offers">
                  {seen.offers.map((o) => (
                    <li key={o.type || o.label} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid={`partners-invitation-offer-${o.type}`}>
                      <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{o.label}</span>
                      {o.summary ? <span className={SUB}>{o.summary}</span> : null}
                      {o.terms.length ? (
                        <dl className="m-0 grid gap-1.5 sm:grid-cols-2">
                          {o.terms.map((t) => <Fact key={t.key} label={t.label}>{t.value}</Fact>)}
                        </dl>
                      ) : null}
                      {o.term ? <span className={SUB}>{`Term: ${o.term}`}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>

            <Section title="Their answers" testId="partners-invitation-answers">
              {!askAnswers ? (
                <>
                  <p className={`m-0 ${SUB}`}>{ANSWERS_LOGGED}</p>
                  <button type="button" className={`${actionGhost} self-start`} onClick={() => setAskAnswers(true)} data-testid="partners-invitation-answers-go">Show their answers</button>
                </>
              ) : null}
              {answers.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
              {answers.state === 'unreadable' ? <ReadState read={profile} what="Their answers" claim="That is not a claim that they gave none." onRetry={() => setAnswersTry((n) => n + 1)} /> : null}
              {answers.state === 'none' || answers.state === 'other' ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="partners-invitation-answers-none">{answers.text}</p> : null}
              {answers.state === 'ready' ? (
                <>
                  <dl className="m-0 grid gap-2 sm:grid-cols-2">
                    {answers.facts.map((f) => <Fact key={f.key} label={f.label}>{f.value}</Fact>)}
                  </dl>
                  <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                    {`Profile check: ${answers.check}`}
                    <Link to="/admin/partner-profiles" className={LINK}>Open in Partner profiles</Link>
                  </p>
                </>
              ) : null}
            </Section>
          </div>

          <div className="flex flex-col gap-4">
            <Section title="Chosen offer and agreement" testId="partners-invitation-agreement">
              {chosen.state === 'ready' ? (
                chosen.offer ? (
                  <div className="flex flex-col gap-0.5" data-testid="partners-invitation-chosen">
                    <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{chosen.offer.label}</span>
                    {chosen.offer.summary ? <span className={SUB}>{chosen.offer.summary}</span> : null}
                    <span className={SUB}>{`Deal #${chosen.deal.id} · ${steps.find((s) => s.key === 'offer_chosen')?.value}`}</span>
                  </div>
                ) : <span className={SUB}>{`Deal #${chosen.deal.id} · its offer was not recorded`}</span>
              ) : null}
              {chosen.state === 'none' ? <span className={SUB} data-testid="partners-invitation-chosen-none">No offer chosen yet.</span> : null}
              {chosen.state === 'unreadable' ? <BlockFailed reason={chosen.reason} what="The chosen deal" testId="partners-invitation-chosen-failed" /> : null}
              <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="partners-invitation-agreement-state">{`Agreement: ${agreementLine(inv, envelope).text}`}</p>
              {envelopeId !== null ? <a href={envelopeHref(envelopeId)} className={`${LINK} self-start`}>Open the envelope</a> : null}
              {refusals.state === 'unreadable' ? <BlockFailed reason={refusals.reason} what="The agreement's refusals" testId="partners-invitation-refusals-failed" /> : null}
              {refusals.state === 'ready' && refusals.lines.length ? (
                <ul className={`m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] font-semibold ${AMBER}`} data-testid="partners-invitation-refusals">
                  {refusals.lines.map((l) => <li key={l.key}>{l.text}</li>)}
                </ul>
              ) : null}
              {ready.state === 'not_ready' && envelopeId === null && (stage.step === 5 || chosen.state === 'ready') && !stage.closed ? (
                <div className="flex flex-col gap-1.5 rounded-[10px] border border-amber-300 bg-amber-50 p-3 text-[13px] font-semibold leading-normal text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="partners-invitation-not-ready">
                  <span>{AGREEMENT_NOT_READY}</span>
                  <Link to="/admin/contracts?tab=templates" className="self-start font-bold underline">Open in Contracts</Link>
                </div>
              ) : null}
            </Section>

            <Section title="Your message" testId="partners-invitation-message">
              <p className={`m-0 whitespace-pre-wrap text-[13px] leading-normal ${message ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`} data-testid="partners-invitation-message-text">{message || NO_MESSAGE}</p>
            </Section>

            <Section title="History" testId="partners-invitation-history">
              {history.state === 'unreadable' ? <BlockFailed reason={history.reason} what="The history" testId="partners-invitation-history-failed" /> : null}
              {history.state === 'ready' && history.lines.length ? (
                <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="partners-invitation-history-lines">
                  {history.lines.map((l) => <li key={l.key} className="text-[12.5px] text-axal-ink dark:text-gray-100">{l.text}</li>)}
                </ol>
              ) : null}
              {history.state === 'ready' && !history.lines.length ? (
                <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="partners-invitation-history-sent">
                  {row.invitedBy === 'Not recorded' ? `Sent · ${dayOr(inv.created_at)} · sender not recorded` : `Sent by ${row.invitedBy} · ${dayOr(inv.created_at)}`}
                  <span className={`block ${SUB}`}>No admin action on this invitation was recorded in the audit log.</span>
                </p>
              ) : null}
            </Section>
          </div>
        </div>
      </div>
    </Lightbox>
  );
}
