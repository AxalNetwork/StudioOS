import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { Lightbox, actionDanger, actionGhost } from '../../../ui';
import useRecordCrumb from '../useRecordCrumb';
import {
  AGREEMENT_NOT_READY, ANSWERS_LOGGED, LINK_LAPSED, LIST_CLAIM, MISSING_INVITATION, NOT_IN_READ, NOT_OFFERED, NOT_READ_YET,
  READING, TERMS_NOT_READ, agreementLine, agreementReady, answersOf, dayOr, dealForInvitation, dealTypeWord, envelopeHref,
  findInvitation, invitationRow, isRecordId, linkLine, progressRows, proposalOf, signingLink,
} from './partnersDeskModel';
import { useRead } from './usePartnerDesk';
import {
  AMBER, CopyButton, EYE, Fact, LINK, ReadState, SUB, StageCell, Unread,
} from './parts';

/**
 * D923 (#2370) — one invitation (PI3), at `/admin/partner-invitations/
 * invitations/:id`. On a desktop it is a `Lightbox` over the Invitations tab;
 * on a phone the same `Lightbox` draws a full page with "‹ Invitations"
 * (PI11c). Closing returns to the tab, and focus to the row that opened it.
 *
 * It is found in R1's loaded rows (or a row this page read for its address);
 * one outside them reads "Not in this read" until part 4's single read. R7
 * gives the envelope; R12, their answers, is read only when the admin asks,
 * because each read is logged.
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

export default function InvitationRecord({ id, reads, now, onClose, actions }) {
  const found = isRecordId(id) ? findInvitation(id, reads.invitations, reads.extra) : { state: 'missing' };
  const inv = found.state === 'ready' ? found.inv : null;
  const envelopeId = inv?.envelope_id ?? null;
  const envelope = useRead('envelope', `envelope:${envelopeId}`, reads.tick, envelopeId !== null, () => api.esignDetail(envelopeId));
  const [askAnswers, setAskAnswers] = useState(false);
  const [answersTry, setAnswersTry] = useState(0);
  // Its own tick: the answers are read once, on request, and again only when
  // the admin asks again; a reload of the desk never reads them.
  const profile = useRead('profile', `profile:${inv?.recipient_email}`, answersTry, askAnswers && Boolean(inv?.recipient_email), () => api.adminGetProfile(inv.recipient_email));
  useRecordCrumb(inv ? (String(inv.recipient_name || '').trim() || inv.recipient_email) : null, null, null);

  if (!inv) {
    return (
      <Lightbox label="Invitation" title="Invitation" eyebrow="Invitations" onClose={onClose} width={560} pageBelow="lg" testId="partners-invitation">
        <div className="flex flex-col gap-2 px-5 py-4" data-testid="partners-invitation-absent">
          {found.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
          {found.state === 'unreadable' ? <ReadState read={reads.invitations} what="The invitations" claim={LIST_CLAIM} onRetry={reads.reload} /> : null}
          {found.state === 'missing' ? (
            <>
              <p className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{NOT_IN_READ}</p>
              <p className={`m-0 ${SUB}`}>{MISSING_INVITATION}</p>
            </>
          ) : null}
        </div>
      </Lightbox>
    );
  }

  const row = invitationRow(inv, { proposed: reads.deals.proposed, now });
  const { stage } = row;
  const dealHit = dealForInvitation(inv, reads.deals);
  const progress = progressRows(inv, stage, dealHit, envelope);
  const link = linkLine(inv, stage);
  const signing = stage.step === 6 && envelopeId !== null ? signingLink(envelope, now) : null;
  const ready = agreementReady(reads.template);
  const proposal = dealHit.state === 'ready' ? proposalOf(dealHit.deal) : null;
  const answers = answersOf(askAnswers ? profile : null, inv);
  const sentBy = row.invitedBy === 'Not recorded' ? `Sent on ${row.sent} · sender not recorded` : `Sent by ${row.invitedBy} on ${row.sent}`;
  const name = row.named ? row.name : inv.recipient_email;

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid="partners-invitation-actions">
      {inv.status === 'signed' && row.dealId !== null ? <Link to={`/admin/partner-invitations/deals/${row.dealId}`} className={actionGhost}>Open deal</Link> : null}
      {!stage.closed ? (
        <>
          {stage.lapsed || !row.link
            ? <span className={`text-[12px] font-semibold ${AMBER}`}>{stage.lapsed ? LINK_LAPSED : 'Link not recorded'}</span>
            : <CopyButton text={row.link} label="Copy link" testId="partners-invitation-copy" />}
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
        <div className="flex flex-wrap items-center gap-3"><StageCell stage={stage} testId="partners-invitation-stage" /></div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Section title="Progress" testId="partners-invitation-progress">
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                {progress.map((p) => (
                  <li key={p.key} className="flex items-baseline justify-between gap-3 text-[13px]" data-testid={`partners-progress-${p.key}`}>
                    <span className="text-axal-ink dark:text-gray-100">{p.label}</span>
                    <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{p.unread ? <Unread reason="Each step is stored as an activity row, which no read here returns yet.">{p.value}</Unread> : p.value}</span>
                  </li>
                ))}
              </ol>
              <p className={`m-0 text-[12.5px] font-semibold ${link.tone === 'amber' ? AMBER : 'text-axal-ink dark:text-gray-100'}`} data-testid="partners-invitation-link">{link.text}</p>
              {link.warn ? <p className={`m-0 text-[12px] font-semibold ${AMBER}`}>{link.warn}</p> : null}
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
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {row.offered.shown.map((t) => (
                    <li key={t} className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                      <span className="font-semibold text-axal-ink dark:text-gray-100">{dealTypeWord(t)}</span>
                      <Unread reason="Offers are built from the invitee's answers when they open them; part 4 adds a preview.">{TERMS_NOT_READ}</Unread>
                    </li>
                  ))}
                  {row.offered.others.length ? <li className={SUB}>{`${row.offered.others.map(dealTypeWord).join(', ')}: ${NOT_OFFERED}`}</li> : null}
                </ul>
              )}
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
              {dealHit.state === 'ready' ? (
                proposal ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{proposal.label}</span>
                    {proposal.summary ? <span className={SUB}>{proposal.summary}</span> : null}
                  </div>
                ) : <Unread>Not recorded</Unread>
              ) : null}
              {dealHit.state === 'none' ? <span className={SUB}>No offer chosen yet.</span> : null}
              {dealHit.state === 'missing' ? <span className={SUB}>{NOT_IN_READ}</span> : null}
              {dealHit.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
              {dealHit.state === 'unreadable' ? <span className="text-[13px] text-red-700 dark:text-red-300">The deals could not be read.</span> : null}
              <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="partners-invitation-agreement-state">{`Agreement: ${agreementLine(inv, envelope).text}`}</p>
              {envelopeId !== null ? <a href={envelopeHref(envelopeId)} className={`${LINK} self-start`}>Open the envelope</a> : null}
              {ready.state === 'not_ready' && envelopeId === null && (stage.step === 5 || dealHit.state === 'ready') && !stage.closed ? (
                <div className="flex flex-col gap-1.5 rounded-[10px] border border-amber-300 bg-amber-50 p-3 text-[13px] font-semibold leading-normal text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="partners-invitation-not-ready">
                  <span>{AGREEMENT_NOT_READY}</span>
                  <Link to="/admin/contracts?tab=templates" className="self-start font-bold underline">Open in Contracts</Link>
                </div>
              ) : null}
            </Section>

            <Section title="Your message" testId="partners-invitation-message">
              <Unread reason="The message is stored with the invitation, but the list read does not return it yet.">{NOT_READ_YET}</Unread>
            </Section>

            <Section title="History" testId="partners-invitation-history">
              <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="partners-invitation-history-sent">
                {row.invitedBy === 'Not recorded' ? `Sent · ${dayOr(inv.created_at)} · sender not recorded` : `Sent by ${row.invitedBy} · ${dayOr(inv.created_at)}`}
              </p>
              <Unread reason="Resends, opens and each step are stored as audit and activity rows, which no read here returns per invitation yet.">{NOT_READ_YET}</Unread>
            </Section>
          </div>
        </div>
      </div>
    </Lightbox>
  );
}
