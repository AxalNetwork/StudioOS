import React from 'react';
import { Card, Unrecorded } from '../../ui';
import HeldZone from './HeldZone';
import { useHeldGlance, Figure } from './heldFigures';

/**
 * Admin · Insights on HQ-held accounts (D286, read since D555).
 *
 * THE SENTENCE IS GONE, THE FIGURES REPLACE IT (D555, #1155). This row used to
 * say no console fits HQ-held accounts and draw nothing. The owner asked for
 * the figures on the page, so it now reads HQ's headline figures from the same
 * Studio glance as the overview: sign-ups per week over eight weeks, AI spend
 * this month, open support tickets. Each figure answers alone.
 *
 * WHAT STAYS UNRECORDED, WITH ITS REASON. Active accounts: no store on this
 * database records a sign-in per account. The territory benchmark: HQ pushes
 * the median across branches and keeps no copy (D148). It still does not
 * borrow the `hqOnly` analytics page or the branch page.
 */
export default function HeldInsights() {
  const glance = useHeldGlance();
  const v = glance.hq?.insights;
  const ready = v?.kind === 'ready';
  const unread = (block) => (block?.kind === 'unreadable' ? null : undefined);
  const signups = ready && v.signups.kind === 'ready' ? v.signups : null;
  return (
    <HeldZone
      workspace="Insights"
      stance="HQ's headline figures, from the Studio glance"
      coverage={ready ? ['Sign-ups, AI spend and open tickets, read on the Studio glance'] : ['HQ’s headline figures']}
      coverageNote="Each figure is read alone; one that cannot be read says so and the others still answer."
      unavailable={[
        ['Territory benchmark', 'Computed by HQ across branches (D148); HQ pushes the median and keeps no copy.'],
        ['Active accounts', 'No store on this database records a sign-in per account.'],
      ]}
    >
      <h1 className="text-[18px] font-extrabold tracking-tight text-axal-ink">Insights</h1>
      <p className="mt-1 text-[12.5px] text-axal-muted">HQ-held accounts · axal.vc</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="held-insights-figures">
        <Card className="p-4" data-testid="held-insights-signups">
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Sign-ups</h2>
          <Figure state={glance} value={signups ? signups.thisWeek : unread(ready ? v.signups : null)} unit="this week, to date"
            reason={ready ? v.signups.reason : undefined} testId="held-insights-signups-week" />
          {signups ? (
            <ol className="mt-2 grid grid-cols-8 gap-1 text-center text-[10.5px] text-axal-muted" data-testid="held-insights-signups-weeks">
              {signups.weeks.map((w) => (
                <li key={w.week_start} title={`Week of ${w.week_start}${w.to_date ? ' (to date)' : ''}`}>
                  <span className="block text-[12px] font-bold tabular-nums text-axal-ink">{w.count}</span>
                  {w.week_start.slice(5)}
                </li>
              ))}
            </ol>
          ) : null}
        </Card>
        <Card className="p-4" data-testid="held-insights-spend">
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">AI spend this month</h2>
          <Figure state={glance} value={ready && v.spend.kind === 'ready' ? Math.round(v.spend.usd * 100) / 100 : unread(ready ? v.spend : null)}
            unit={ready && v.spend.kind === 'ready' ? `USD over ${v.spend.calls.toLocaleString('en-US')} calls` : ''}
            reason={ready ? v.spend.reason : undefined} testId="held-insights-spend-usd" />
        </Card>
        <Card className="p-4" data-testid="held-insights-tickets">
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Open support tickets</h2>
          <Figure state={glance} value={ready && v.tickets.kind === 'ready' ? v.tickets.open : unread(ready ? v.tickets : null)} unit="open"
            reason={ready ? v.tickets.reason : undefined} testId="held-insights-tickets-open" />
        </Card>
        <Card className="p-4" data-testid="held-insights-active">
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Active accounts</h2>
          <p className="mt-2 text-[12.5px]"><Unrecorded reason={ready ? v.active.reason : 'No store on this database records a sign-in per account.'} /></p>
        </Card>
      </div>
    </HeldZone>
  );
}
