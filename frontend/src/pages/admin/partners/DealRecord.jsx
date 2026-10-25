import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import useRecordCrumb from '../useRecordCrumb';
import {
  FIRST_500, NOT_RECORDED, READING, day, dayOr, daysUsed, dealTypeWord, envelopeHref, isRecordId, lastRedeemers, proposalOf, termText, tiersText,
} from './partnersDeskModel';
import {
  NO_SUCH_DEAL, RERUN_DONE, RERUN_LINES, RERUN_TITLE, activationPending, agreementFromRead, dealReadState, dueDiligence,
  historyRows, obligationRows, rerunRefusal,
} from './dealsReferralsModel';
import { itemsOf, useRead } from './usePartnerDesk';
import { useDealRead } from './useDealsReferrals';
import { AMBER, CopyButton, DealStatePill, Done, EYE, Fact, LINK, MONO, ReadState, Refusal, SUB, Unread } from './parts';

/**
 * D923 (#2370) — one deal (PI6), at `/admin/partner-invitations/deals/:id`:
 * a `Lightbox` over Deals on a desktop, a full page with "‹ Deals" on a
 * phone. D951 (#2727) reads it from D928's single read, so any deal opens,
 * whatever the lists hold: its terms, its invitation, its envelope, the due-
 * diligence case D928 matched with its KYB section ("Cleared" waits for
 * #2385, so a completed section reads "Completed"), each obligation's own
 * state, and the history with who terminated. A deal whose agreement is
 * signed but which was not activated says "Signed, deal not activated" and
 * offers D925's Re-run activation in a dialog that says what it does first.
 *
 * The redemption count is D928's uncapped `redemptions_total`; R4 gives the
 * last ten redeemers, and a failed R4 reads Unreadable once.
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

/** Re-run activation (D925), in a dialog that says what it does before the write; its result or refusal stays inside it. */
function RerunDialog({ deal, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [done, setDone] = useState(false);
  const doneButton = useRef(null);
  useEffect(() => { if (done) doneButton.current?.focus?.(); }, [done]);
  const run = async () => {
    setBusy(true); setRefusal(null);
    try { await api.adminPartners.activateDeal(deal.id); setDone(true); } catch (e) { setRefusal(rerunRefusal(e)); } finally { setBusy(false); }
  };
  const close = () => { if (busy) return; if (done) onDone(); onClose(); };
  return (
    <Lightbox label={RERUN_TITLE} title={RERUN_TITLE} onClose={close} testId="partners-rerun-dialog"
      footer={(
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {done ? <button ref={doneButton} type="button" className={actionPrimary} onClick={close} data-testid="partners-rerun-go-done">Done</button> : (
              <>
                <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
                <button type="button" className={actionPrimary} onClick={run} disabled={busy} data-testid="partners-rerun-go">{busy ? 'Running…' : 'Re-run activation'}</button>
              </>
            )}
          </div>
          <Refusal text={refusal} testId="partners-rerun-go-refusal" />
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-4">
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-normal text-axal-ink marker:text-axal-violet dark:text-gray-100" data-testid="partners-rerun-lines">
          {RERUN_LINES.map((l) => <li key={l}>{l}</li>)}
        </ul>
        {done ? <Done testId="partners-rerun-result"><span>{RERUN_DONE}</span></Done> : null}
      </div>
    </Lightbox>
  );
}

export default function DealRecord({ id, reads, now, onClose, actions }) {
  // An address that is no deal id opens no read: there is no such deal.
  const valid = isRecordId(id);
  const read = useDealRead(id, reads.tick, valid);
  const found = valid ? dealReadState(read) : { state: 'none' };
  const data = found.state === 'ready' ? found.data : null;
  const deal = data?.deal || null;
  const [rerun, setRerun] = useState(false);
  const redeemers = useRead('redeemers', `redeemers:${deal?.id}`, reads.tick, Boolean(deal?.referral_code),
    () => api.adminPartners.dealRedemptions(deal.id).then((r) => { itemsOf(r, 'The redemptions'); return r; }));
  const partnerName = deal ? (String(deal.partner_name || '').trim() || String(data.invitation?.recipient_name || '').trim()
    || String(deal.partner_email || '').trim() || String(data.invitation?.recipient_email || '').trim() || NOT_RECORDED) : null;
  const partnerEmail = deal ? (deal.partner_email || data.invitation?.recipient_email || null) : null;
  useRecordCrumb(partnerName, null, null);

  if (!deal) {
    return (
      <Lightbox label="Deal" title="Deal" eyebrow="Deals" onClose={onClose} width={560} pageBelow="lg" testId="partners-deal">
        <div className="flex flex-col gap-2 px-5 py-4" data-testid="partners-deal-absent">
          {found.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
          {found.state === 'unreadable' ? (
            <ReadState read={{ ...read, status: 'error', data: null }} what="This deal" claim="That is not a claim that it does not exist." onRetry={reads.reload} testId="partners-deal-read" />
          ) : null}
          {found.state === 'none' ? <p className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100" data-testid="partners-deal-absent-reason">{NO_SUCH_DEAL}</p> : null}
        </div>
      </Lightbox>
    );
  }

  const proposal = data.deal.proposal_unreadable ? null : proposalOf(deal);
  const used = daysUsed(deal, now);
  const last = deal.referral_code ? lastRedeemers(redeemers, deal) : null;
  const dd = dueDiligence(data.due_diligence);
  const obligations = obligationRows(data.obligations);
  const history = historyRows(data.history);
  const agreement = agreementFromRead(data);
  const pending = activationPending(data);
  const count = Number(deal.redemptions_total);
  const inv = data.invitation;

  const footer = deal.status === 'active' ? (
    <div className="flex justify-end"><button type="button" className={actionDanger} onClick={() => actions.terminate(deal)} data-testid="partners-deal-terminate">Terminate</button></div>
  ) : null;

  return (
    <>
      <Lightbox label={`Deal ${deal.id} with ${partnerName}`} title={partnerName}
        sub={`Deal #${deal.id}${partnerEmail ? ` · ${partnerEmail}` : ' · address not recorded'}`} eyebrow="Deals"
        onClose={onClose} width={940} pageBelow="lg" testId="partners-deal" footer={footer}>
        <div className="flex flex-col gap-4 px-5 py-4" data-testid="partners-deal-body">
          <ReadState read={read} what="This deal" onRetry={reads.reload} testId="partners-deal-read" kept="What is shown is from the last read." />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{dealTypeWord(deal.deal_type)}</span>
            <DealStatePill status={deal.status} testId="partners-deal-state" />
          </div>
          {pending ? (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="partners-deal-not-activated">
              <span>{deal.activation_failed_at ? `Signed, deal not activated. Activation failed ${dayOr(deal.activation_failed_at)}.` : 'Signed, deal not activated.'}</span>
              <button type="button" className="font-bold underline" onClick={() => setRerun(true)} data-testid="partners-deal-rerun">Re-run activation</button>
            </div>
          ) : null}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Section title="Terms" testId="partners-deal-terms">
                {data.deal.proposal_unreadable ? <Unread reason="The stored offer could not be read.">Could not be read</Unread> : null}
                {!data.deal.proposal_unreadable && proposal ? (
                  <>
                    <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{proposal.label}</span>
                    {proposal.summary ? <span className={SUB}>{proposal.summary}</span> : null}
                    {proposal.terms.length ? (
                      <dl className="m-0 grid gap-2 sm:grid-cols-2">{proposal.terms.map((t) => <Fact key={t.key} label={t.label}>{t.value}</Fact>)}</dl>
                    ) : null}
                  </>
                ) : null}
                {!data.deal.proposal_unreadable && !proposal ? <Unread reason="The deal row holds no stored offer.">Not recorded</Unread> : null}
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
                {inv ? (
                  <span className="flex flex-wrap items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                    {`Sent by ${String(inv.invited_by_name || '').trim() || 'a sender not recorded'} on ${dayOr(inv.created_at)}${day(inv.signed_at) ? ` · signed ${day(inv.signed_at)}` : ''}`}
                    <Link to={`/admin/partner-invitations/invitations/${inv.id}`} className={LINK}>Open invitation</Link>
                  </span>
                ) : null}
                {!inv && data.invitation_missing ? <Unread reason="The deal names an invitation that is no longer stored.">Not recorded</Unread> : null}
                {!inv && !data.invitation_missing ? <span className={SUB}>This deal came from no invitation.</span> : null}
              </Section>
            </div>

            <div className="flex flex-col gap-4">
              <Section title="Agreement" testId="partners-deal-agreement">
                <span className={`text-[13px] font-semibold ${agreement.tone === 'amber' ? AMBER : 'text-axal-ink dark:text-gray-100'}`} data-testid="partners-deal-agreement-state">{agreement.text}</span>
                {agreement.sub ? <span className={SUB}>{agreement.sub}</span> : null}
                {deal.envelope_id !== null && deal.envelope_id !== undefined ? <a href={envelopeHref(deal.envelope_id)} className={`${LINK} self-start`}>Open the envelope</a> : null}
              </Section>

              <Section title="Due diligence" testId="partners-deal-dd">
                {dd.state === 'one' ? (
                  <>
                    <span className="flex flex-wrap items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100" data-testid="partners-deal-dd-case">
                      {`Case: ${dd.case.text} · opened ${dd.case.opened}`}
                      {dd.case.uid ? <Link to={`/admin/due-diligence/${dd.case.uid}`} className={LINK}>Open in Due diligence</Link> : null}
                    </span>
                    <span className="text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="partners-deal-kyb">{`KYB section: ${dd.case.kyb}`}</span>
                  </>
                ) : null}
                {dd.state === 'ambiguous' ? (
                  <>
                    <span className={`text-[13px] font-semibold ${AMBER}`} data-testid="partners-deal-dd-case">{dd.text}</span>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {dd.cases.map((c) => (
                        <li key={c.uid || c.opened} className="flex flex-wrap items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-100">
                          {`${c.text} · opened ${c.opened} · KYB section: ${c.kyb}`}
                          {c.uid ? <Link to={`/admin/due-diligence/${c.uid}`} className={LINK}>Open</Link> : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {['none', 'not_activated', 'unknown'].includes(dd.state) ? <span className="text-[13px] text-axal-ink dark:text-gray-100" data-testid="partners-deal-dd-case">{dd.text}</span> : null}
              </Section>

              <Section title="Obligations" testId="partners-deal-obligations">
                {obligations.state === 'none' ? <span className={SUB} data-testid="partners-deal-obligations-line">{obligations.text}</span> : null}
                {obligations.state === 'ready' && !obligations.rows.length ? <span className={SUB} data-testid="partners-deal-obligations-line">No obligations recorded</span> : null}
                {obligations.state === 'ready' && obligations.rows.length ? (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="partners-deal-obligations-list">
                    {obligations.rows.map((o) => (
                      <li key={o.key} className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]" data-testid={`partners-deal-obligation-${o.key}`}>
                        <span className="font-semibold text-axal-ink dark:text-gray-100">{o.label}</span>
                        <span className="flex flex-col items-end">
                          <span className={o.tone === 'amber' ? `font-bold ${AMBER}` : 'text-axal-ink dark:text-gray-100'}>{o.state}</span>
                          {o.note ? <span className={SUB}>{o.note}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Section>

              <Section title="History" testId="partners-deal-history">
                <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="partners-deal-history-list">
                  {history.map((h) => <li key={h.key} className={`text-[13px] ${h.tone === 'amber' ? AMBER : 'text-axal-ink dark:text-gray-100'}`}>{h.text}</li>)}
                </ol>
              </Section>
            </div>
          </div>
        </div>
      </Lightbox>
      {rerun ? <RerunDialog deal={deal} onClose={() => setRerun(false)} onDone={reads.reload} /> : null}
    </>
  );
}
