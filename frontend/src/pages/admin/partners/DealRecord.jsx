import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { Lightbox, actionDanger } from '../../../ui';
import useRecordCrumb from '../useRecordCrumb';
import {
  DEAL_STATES, FIRST_500, LIST_CLAIM, MISSING_DEAL, NOT_IN_READ, NOT_READ_YET, NOT_RECORDED, NO_DEAL, READING, day, dayOr, daysUsed,
  dealAgreementLine, dealPartner, dealTypeWord, ddFor, envelopeHref, findDeal, invitationForDeal, lastRedeemers, obligationsLine,
  proposalOf, termText, tiersText,
} from './partnersDeskModel';
import { itemsOf, useRead } from './usePartnerDesk';
import { AMBER, CopyButton, DealStatePill, EYE, Fact, LINK, MONO, ReadState, SUB, Unread } from './parts';

/**
 * D923 (#2370) — one deal (PI6), at `/admin/partner-invitations/deals/:id`:
 * a `Lightbox` over Deals on a desktop, a full page with "‹ Deals" on a
 * phone. Found in the six R2 lists; one outside them reads "Not in this
 * read" until part 5's single read, with its reason: a list stopped at its
 * cap, or no deal in the lists has the address. A list that could not be read
 * draws its own Try again here, because the tab's sits behind the dialog.
 *
 * The redemption count comes from the row, never from R4; R4 gives the last
 * ten redeemers, and a failed R4 reads Unreadable once (today's modal re-read
 * in a loop, then said "No redemptions yet"). R7 gives the agreement, R9 the
 * case and R10 the outstanding obligations.
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

export default function DealRecord({ id, reads, now, onClose, actions }) {
  const found = findDeal(id, reads.deals);
  const deal = found.state === 'ready' ? found.deal : null;
  const envelopeId = deal?.envelope_id ?? null;
  const signedAlready = Boolean(deal?.activated_at);
  const envelope = useRead('envelope', `envelope:${envelopeId}`, reads.tick, envelopeId !== null && !signedAlready, () => api.esignDetail(envelopeId));
  const redeemers = useRead('redeemers', `redeemers:${deal?.id}`, reads.tick, Boolean(deal?.referral_code),
    () => api.adminPartners.dealRedemptions(deal.id).then((r) => { itemsOf(r, 'The redemptions'); return r; }));
  const userId = deal?.user_id ?? null;
  const trust = useRead('trust', `trust:${userId}`, reads.tick, userId !== null, () => api.trustScoreBatch([Number(userId)]));
  const partner = deal ? dealPartner(deal, reads.invitations) : null;
  useRecordCrumb(partner ? partner.name : null, null, null);

  if (!deal) {
    return (
      <Lightbox label="Deal" title="Deal" eyebrow="Deals" onClose={onClose} width={560} pageBelow="lg" testId="partners-deal">
        <div className="flex flex-col gap-2 px-5 py-4" data-testid="partners-deal-absent">
          {found.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
          {/* A list whose refresh failed is drawn as failed: its old rows did not hold this deal. */}
          {found.state === 'unreadable' ? DEAL_STATES.filter((s) => reads.deals[s.key]?.status === 'error').map((s) => (
            <ReadState key={s.key} read={{ ...reads.deals[s.key], data: null }} what={`The deals in “${s.word}”`}
              claim="So this deal could not be looked up. That is not a claim that it does not exist." onRetry={reads.reload} testId={`partners-deal-read-${s.key}`} />
          )) : null}
          {found.state === 'missing' || found.state === 'none' ? (
            <>
              <p className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{NOT_IN_READ}</p>
              <p className={`m-0 ${SUB}`} data-testid="partners-deal-absent-reason">{found.state === 'missing' ? MISSING_DEAL : NO_DEAL}</p>
            </>
          ) : null}
        </div>
      </Lightbox>
    );
  }

  const proposal = proposalOf(deal);
  const used = daysUsed(deal, now);
  const last = deal.referral_code ? lastRedeemers(redeemers, deal) : null;
  const dd = ddFor(deal, reads.cases);
  const via = invitationForDeal(deal, reads.invitations);
  const agreement = dealAgreementLine(deal, envelope);
  const count = Number(deal.redemptions_count);

  const footer = deal.status === 'active' ? (
    <div className="flex justify-end"><button type="button" className={actionDanger} onClick={() => actions.terminate(deal)} data-testid="partners-deal-terminate">Terminate</button></div>
  ) : null;

  return (
    // "address not recorded" only when the invitations were read in full and hold none for this deal; otherwise the title already says the read's state.
    <Lightbox label={`Deal ${deal.id} with ${partner.name}`} title={partner.name}
      sub={`Deal #${deal.id}${partner.email ? ` · ${partner.email}` : partner.name === NOT_RECORDED ? ' · address not recorded' : ''}`} eyebrow="Deals"
      onClose={onClose} width={940} pageBelow="lg" testId="partners-deal" footer={footer}>
      <div className="flex flex-col gap-4 px-5 py-4" data-testid="partners-deal-body">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{dealTypeWord(deal.deal_type)}</span>
          <DealStatePill status={deal.status} testId="partners-deal-state" />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Section title="Terms" testId="partners-deal-terms">
              {proposal ? (
                <>
                  <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{proposal.label}</span>
                  {proposal.summary ? <span className={SUB}>{proposal.summary}</span> : null}
                  {proposal.terms.length ? (
                    <dl className="m-0 grid gap-2 sm:grid-cols-2">{proposal.terms.map((t) => <Fact key={t.key} label={t.label}>{t.value}</Fact>)}</dl>
                  ) : null}
                </>
              ) : <Unread reason="The deal row holds no stored offer.">Not recorded</Unread>}
              <dl className="m-0 grid gap-2 sm:grid-cols-2">
                <Fact label="Tiers granted">{tiersText(deal.granted_tier_founder, deal.granted_tier_investor)}</Fact>
                <Fact label="Term">{termText(deal)}</Fact>
              </dl>
              {used ? (
                <div className="flex flex-col gap-1" data-testid="partners-deal-used">
                  <span role="img" aria-label={`${used.used} of ${used.total} days used`} className="block h-1.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
                    <span className="block h-full bg-axal-violet dark:bg-violet-400" style={{ width: `${Math.round(used.fraction * 100)}%` }} />
                  </span>
                  <span className={SUB}>{`${used.used.toLocaleString('en-US')} days used · ${used.left.toLocaleString('en-US')} left`}</span>
                </div>
              ) : null}
            </Section>

            <Section title="Referral code" testId="partners-deal-code">
              {deal.referral_code ? (
                <>
                  <span className="flex flex-wrap items-center gap-2"><span className={MONO}>{deal.referral_code}</span><CopyButton text={deal.referral_code} label="Copy" noun="code" testId="partners-deal-copy" /></span>
                  <span className="text-[13px] text-axal-ink dark:text-gray-100" data-testid="partners-deal-count">
                    {`Redemptions: ${Number.isFinite(count) ? count.toLocaleString('en-US') : 'not recorded'}`}
                  </span>
                  {last.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
                  {last.state === 'unreadable' ? <ReadState read={redeemers} what="The redeemers" claim="That is not a claim that nobody redeemed the code." onRetry={reads.reload} testId="partners-deal-redeemers" /> : null}
                  {last.state === 'ready' && last.rows.length ? (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="partners-deal-redeemers-list">
                      {last.rows.map((r) => (
                        <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
                          <span className="flex flex-col"><span className="font-semibold text-axal-ink dark:text-gray-100">{r.name}</span><span className={SUB}>{r.line}</span></span>
                          <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{r.right}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {last.state === 'ready' && !last.rows.length ? <span className={SUB}>No member has registered with this code.</span> : null}
                  {last.state === 'ready' && last.firstOnly ? <span className={SUB}>{FIRST_500}</span> : null}
                  <Link to={`/admin/partner-invitations/referrals?deal=${deal.id}`} className={`${LINK} self-start`}>See all in Referrals</Link>
                </>
              ) : <span className={SUB}>Issued on signing</span>}
            </Section>

            <Section title="Invitation" testId="partners-deal-invitation">
              {via.state === 'ready' ? (
                <span className="flex flex-wrap items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                  {`Sent by ${String(via.inv.invited_by_name || '').trim() || 'a sender not recorded'} on ${dayOr(via.inv.created_at)}${day(via.inv.signed_at) ? ` · signed ${day(via.inv.signed_at)}` : ''}`}
                  <Link to={`/admin/partner-invitations/invitations/${via.inv.id}`} className={LINK}>Open invitation</Link>
                </span>
              ) : null}
              {via.state === 'missing' ? <span className={SUB}>{NOT_IN_READ}</span> : null}
              {via.state === 'none' ? <Unread>Not recorded</Unread> : null}
              {via.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
              {via.state === 'unreadable' ? <ReadState read={reads.invitations} what="The invitations" claim={LIST_CLAIM} onRetry={reads.reload} /> : null}
            </Section>
          </div>

          <div className="flex flex-col gap-4">
            <Section title="Agreement" testId="partners-deal-agreement">
              <span className={`text-[13px] font-semibold ${agreement.tone === 'amber' ? AMBER : agreement.failed ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-gray-100'}`} data-testid="partners-deal-agreement-state">{agreement.text}</span>
              {envelopeId !== null ? <a href={envelopeHref(envelopeId)} className={`${LINK} self-start`}>Open the envelope</a> : null}
            </Section>

            <Section title="Due diligence" testId="partners-deal-dd">
              <span className="flex flex-wrap items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                {`Case: ${dd.text}`}
                {dd.uid ? <Link to={`/admin/due-diligence/${dd.uid}`} className={LINK}>Open in Due diligence</Link> : null}
              </span>
              <span className="text-[12.5px]">KYB: <Unread reason="The KYB section is read only from the whole case, which part 5 reads.">{NOT_READ_YET}</Unread></span>
            </Section>

            <Section title="Obligations" testId="partners-deal-obligations">
              <span className="text-[13px] text-axal-ink dark:text-gray-100" data-testid="partners-deal-obligations-line">{obligationsLine(trust, userId).text}</span>
            </Section>

            <Section title="History" testId="partners-deal-history">
              {deal.activated_at ? <span className="text-[13px] text-axal-ink dark:text-gray-100">{`Activated on signing · ${dayOr(deal.activated_at)}`}</span> : null}
              {deal.terminated_at ? (
                <span className="text-[13px] text-axal-ink dark:text-gray-100">
                  {`Terminated · ${dayOr(deal.terminated_at)}${String(deal.termination_reason || '').trim() ? ` · ${String(deal.termination_reason).trim()}` : ''}`}
                </span>
              ) : null}
              {!deal.activated_at && !deal.terminated_at ? <span className={SUB}>{`First chosen ${dayOr(deal.created_at)}`}</span> : null}
              <span className="text-[12.5px]">By: <Unread reason="Who terminated is stored but not returned by the deal list yet.">{NOT_READ_YET}</Unread></span>
            </Section>
          </div>
        </div>
      </div>
    </Lightbox>
  );
}
