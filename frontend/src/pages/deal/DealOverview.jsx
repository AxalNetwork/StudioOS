/**
 * D1152 (#3057) — the investor's Overview (DL1) on today's reads: the
 * scorecard strip's slot (DL24a), what is new since you last looked (part 2),
 * the terms at a glance and the round (the deal read), your next step (part
 * 2's one next action) and the deck's slot. A card whose read fails says so
 * and leaves the others standing.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { dealMoney } from '../../components/deals/dealMoney';
import { reportError } from '../../lib/log';
import { CARD, EYE, SUB, H3 } from './DealFrame';
import { DECK_SLOT, SCORE_SLOT, termsAtGlance, whatsNewOf } from './dealFrameModel';
import { whatsNewOnce } from './dealVisit';

const SLOT = 'flex flex-col gap-2 rounded-axal-lg border border-dashed border-axal-muted bg-axal-ground px-4 py-4 dark:border-gray-600 dark:bg-gray-800/60';

/** A sibling canvas's board, drawn as a labelled grey frame (DL24). */
export function Slot({ slot, testId }) {
  return (
    <section className={SLOT} data-testid={testId}>
      <span className={EYE}>{slot.eye}</span>
      <h3 className={H3}>{slot.title}</h3>
      <p className={`m-0 ${SUB}`}>{slot.line}</p>
    </section>
  );
}

function Row({ label, value, missing }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-axal-hairline py-2 dark:border-gray-700">
      <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{label}</span>
      <span className={`font-mono text-[12.5px] font-bold ${missing ? 'text-axal-muted dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`}>{value}</span>
    </div>
  );
}

function WhatsNew({ dealId }) {
  const [read, setRead] = useState({ status: 'loading' });
  const load = () => {
    setRead({ status: 'loading' });
    whatsNewOnce(dealId).then((data) => setRead({ status: 'ready', data }))
      .catch((e) => { reportError('DealOverview:whatsNew', e); setRead({ status: 'unreadable' }); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  const w = whatsNewOf(read);
  return (
    <section className={`${CARD} flex flex-col gap-2 px-4 py-4`} data-testid="deal-whats-new">
      <div className="flex items-center justify-between gap-3">
        <h3 className={H3}>What’s new since you last looked</h3>
        {w.since && <span className={SUB}>Since {w.since}</span>}
      </div>
      {w.state === 'loading' && <p className={`m-0 ${SUB}`}>Reading…</p>}
      {w.state === 'unreadable' && <Unreadable what="What changed" claim="That is not a claim that nothing changed." onRetry={load} />}
      {w.state === 'first' && <p className={`m-0 ${SUB}`}>{w.line}</p>}
      {w.state === 'ready' && (w.rows.length
        ? w.rows.map((r, i) => <Row key={i} label={r.text} value={r.at} />)
        : <p className={`m-0 ${SUB}`}>Nothing has changed since you last looked.</p>)}
      {w.state === 'ready' && w.unavailable.map((u) => <p key={u} className={`m-0 ${SUB}`}>Not read here: {u}</p>)}
    </section>
  );
}

export default function DealOverview({ deal, track, investor }) {
  const cur = deal.currency || 'USD';
  const committed = dealMoney(deal.capital_committed, cur);
  const target = dealMoney(deal.target_raise ?? deal.amount, cur);
  return (
    <div className="grid gap-3.5 lg:grid-cols-3" data-testid="deal-overview">
      <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-2">
        {deal.description && <p className={`m-0 ${SUB}`}>{deal.description}</p>}
        <Slot slot={SCORE_SLOT} testId="deal-score-slot" />
        {investor && <WhatsNew dealId={deal.id} />}
        <section className={`${CARD} flex flex-col gap-1 px-4 py-4`} data-testid="deal-details">
          <h3 className={H3}>About this deal</h3>
          <Row label="SPV jurisdiction" value={deal.spv_jurisdiction || 'Not recorded'} missing={!deal.spv_jurisdiction} />
          <Row label="Lead partner" value={deal.lead_partner_name || 'Not recorded'} missing={!deal.lead_partner_name} />
          <Row label="Days in stage" value={deal.days_in_stage == null ? 'Not recorded' : `${deal.days_in_stage} days`} missing={deal.days_in_stage == null} />
          <Row label="Website" missing={!deal.website}
            value={deal.website ? <a href={deal.website} target="_blank" rel="noreferrer" className="text-axal-violet-deep hover:underline dark:text-violet-300">{deal.website}</a> : 'Not recorded'} />
        </section>
      </div>
      <div className="flex min-w-0 flex-col gap-3.5">
        <section className={`${CARD} flex flex-col gap-1 px-4 py-4`} data-testid="deal-terms">
          <h3 className={H3}>Terms at a glance</h3>
          {termsAtGlance(deal).map((t) => <Row key={t.label} {...t} />)}
          {investor && <Link to={`/deals/${deal.id}/terms`} className="mt-1 text-[12.5px] font-bold text-axal-violet-deep dark:text-violet-300">Full terms</Link>}
        </section>
        <section className={`${CARD} flex flex-col gap-2 px-4 py-4`} data-testid="deal-round">
          <h3 className={H3}>The round</h3>
          <p className="m-0 font-mono text-[13px] font-bold text-axal-ink dark:text-gray-100">
            {committed && target ? `Committed ${committed} of ${target}` : 'Committed and round size: Not recorded'}
          </p>
          <p className={`m-0 ${SUB}`}>Other investors’ names and amounts are not shown.</p>
        </section>
        {investor && track?.state === 'ready' && track.next && (
          <section className="flex flex-col gap-2 rounded-axal-lg border border-axal-lavender-edge bg-axal-lavender px-4 py-4 dark:border-violet-800 dark:bg-violet-950/40" data-testid="deal-next-step">
            <span className={EYE}>Your next step</span>
            <h3 className={H3}>{track.next.label}</h3>
            {track.why && <p className={`m-0 ${SUB}`}>{track.why}</p>}
          </section>
        )}
        <Slot slot={DECK_SLOT} testId="deal-deck-slot" />
      </div>
    </div>
  );
}

