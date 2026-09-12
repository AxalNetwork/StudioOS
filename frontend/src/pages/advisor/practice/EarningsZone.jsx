import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, Pill, Unrecorded, ZoneBody, ZoneHeading, money } from '../expertise/kit';

/**
 * Practice · Earnings — the roll-up over what Sessions records.
 *
 * EVERY FIGURE IS A SUM OF ROWS AN ADVISOR ENTERED. Nothing here is a forecast,
 * a projection, a run-rate or an estimate. If a number appears on this page,
 * an advisor typed the amount it came from.
 *
 * `unpriced_count` IS REPORTED, NOT HIDDEN, and that is the important one. A
 * total that quietly ignored the sessions nobody has priced would be a smaller
 * number presented as a complete one — the most plausible way a money page
 * lies. The worker returns the count for exactly this reason and the page
 * leads with it whenever it is non-zero.
 *
 * AXAL SETTLES NOTHING, AND THAT IS NOW A THING TO CHECK RATHER THAN ASSERT.
 * The endpoint returns `settlement`, and this page renders what it says
 * instead of a sentence written once. While it reads `'none'` there is no
 * charge, no invoice, no payout and no obligation on Axal; when PR5b's flag
 * flips it will read `'test'` or `'live'` and this page will say that instead
 * — which is the whole reason the claim is computed and not typed.
 *
 * THE PAGE USED TO SAY AXAL "DOES NOT TAKE A CUT", AND THAT HAD TO GO.
 * Migration 241 records a take rate — 1500 bps, admin-configurable — and
 * stamps the cut on every line as it is priced. Nothing is charged yet, so the
 * honest statement is the compound one: a rate is recorded, and no money has
 * moved under it. Denying the rate would be the easier sentence and the false
 * one, and the mirror-image error — rendering a cut as though it had been
 * taken — is what the `settlement` check below exists to prevent. D75.
 *
 * (The older clause "migration 175 retired the payout ledger and this does not
 * reopen it" was true when it was written and is no longer the whole story:
 * 241 adds `advisor_payouts`. That is not 175's table returning — 175's paid
 * platform credit under a rewards scheme, this one records money settling from
 * a client's card to an advisor's connected account — and 241's header draws
 * the distinction at length.)
 */

const ROW = {
  billed: ['Billed', 'warn', 'Priced and owed to you. Nothing has been collected yet.'],
  collected: ['Collected', 'ok', 'You have been paid.'],
  written_off: ['Written off', 'danger', 'You decided not to pursue it.'],
  unpriced: ['Unpriced', 'neutral', 'Sessions with no amount recorded. Not counted in any total above.'],
};

/**
 * The take rate as a reader sees it, from the basis points the worker sends.
 *
 * DIVIDED HERE AND NOWHERE ELSE, and it is the one piece of money arithmetic
 * this page does — because it is a display conversion, not a calculation: 1500
 * bps IS 15%, exactly, at every value. Every cent figure on the page is
 * computed in the worker for the opposite reason.
 *
 * An absent rate renders as an absence rather than as 0% — "the platform
 * charges nothing" is a claim, and a missing response field is not evidence
 * for it (D56/D68).
 */
function takeRatePct(rate) {
  const bps = rate?.bps;
  if (bps == null || !Number.isFinite(Number(bps))) return 'a rate that could not be read';
  const pct = Number(bps) / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

function Figure({ label, cents, hint, strong = false }) {
  return (
    <Card variant={strong ? 'accent' : 'plain'} padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{label}</div>
      <div className={`mt-1 tabular-nums font-extrabold ${strong ? 'text-[22px]' : 'text-[18px]'}`}>
        {/* A roll-up over zero rows is a real zero — the advisor has recorded
            nothing collected. That is different from Sessions, where a NULL
            price means "not answered"; here the sum is a fact. */}
        {money(cents) ?? <Unrecorded />}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-axal-ink-3">{hint}</p>}
    </Card>
  );
}

export default function EarningsZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const data = await api.getMyAdvisorEarnings();
      setState({ loading: false, error: '', data });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your earnings could not be read.', data: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const nothingRecorded = d
    && !d.billed_cents && !d.collected_cents && !d.written_off_cents && !d.unpriced_count;

  const empty = (
    <NothingYet
      title="Nothing recorded yet"
      body="Once you price a session under Sessions, it appears here. This page only ever sums amounts you entered yourself."
      action={<Link to="/practice/sessions" className="text-[12px] text-emerald-700 underline">Price your sessions →</Link>}
    />
  );

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="What the practice has earned"
        blurb="Summed from the sessions you priced, with the platform rate recorded against each one. Axal issues no invoice for them, and whether anything has been charged is stated below rather than assumed here."
        action={d?.unpriced_count > 0 ? <Pill tone="warn">{d.unpriced_count} unpriced</Pill> : null}
      />

      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        isEmpty={Boolean(nothingRecorded)} empty={empty}>
        {d && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Figure strong label="Collected" cents={d.collected_cents}
                hint="Money you have actually been paid." />
              <Figure label="Outstanding" cents={d.outstanding_cents}
                hint="Priced and billed, not yet collected." />
              <Figure label="Written off" cents={d.written_off_cents}
                hint="Priced, then decided against pursuing." />
            </div>

            {d.unpriced_count > 0 && (
              <Card variant="dashed" padding="md" className="mt-3">
                <h3 className="text-sm font-extrabold tracking-tight">
                  {d.unpriced_count} session{d.unpriced_count === 1 ? '' : 's'} carr
                  {d.unpriced_count === 1 ? 'ies' : 'y'} no amount
                </h3>
                <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-ink-2">
                  They are counted in none of the totals above, and this line exists so that
                  absence is visible rather than silently shrinking the numbers.{' '}
                  <Link to="/practice/sessions" className="text-emerald-700 underline">Price them →</Link>
                </p>
              </Card>
            )}

            <Card padding="none" className="mt-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                    <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">State</th>
                    <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Sessions</th>
                    <th className="px-4 py-2 text-right text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.by_state || []).map((row) => {
                    const [label, tone, hint] = ROW[row.state] || [row.state, 'neutral', ''];
                    return (
                      <tr key={row.state} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                        <td className="px-4 py-2.5">
                          <Pill tone={tone}>{label}</Pill>
                          <div className="mt-1 text-[11px] text-axal-ink-3">{hint}</div>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{row.bookings}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                          {/* An unpriced row's total is meaningless by
                              definition — the sessions in it have no amount. */}
                          {row.state === 'unpriced' ? <Unrecorded>—</Unrecorded> : money(row.total_cents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            {/* RENDERED FROM THE RESPONSE, NOT WRITTEN ONCE. The clause this
                replaces denied the platform cut outright, which migration 241
                made false: a take rate is recorded and stamped on every line
                as it is priced. What is still true is that no money has moved
                under it, and `settlement` is what says so — so the page states
                the rate AND the absence of any charge, and stops claiming
                either one on its own.

                The denial is not quoted here on purpose: the guard in
                `advisor_bucket_overview.test.mjs` bans that exact phrase, and
                `codeOnly` spares an INDENTED block comment by design — a `/*`
                inside a className must not be allowed to open one. A comment
                explaining a ban must therefore not reproduce the banned
                string. D75. */}
            <p className="mt-3 text-[11px] leading-relaxed text-axal-ink-3">
              Amounts are in {d.currency || 'USD'} and are your own record. Axal does not invoice
              your clients and holds no money on your behalf.{' '}
              {d.settlement === 'none' ? (
                <>
                  A platform rate of {takeRatePct(d.take_rate)} is recorded against each priced
                  session, and <strong>nothing has been charged under it</strong> — no payment is
                  taken through Axal today, so the figures above are what you recorded, not what
                  was collected.
                </>
              ) : (
                <>
                  Payments are running in <strong>{d.settlement}</strong> mode and a platform rate
                  of {takeRatePct(d.take_rate)} applies to each priced session.
                </>
              )}
            </p>
          </>
        )}
      </ZoneBody>
    </div>
  );
}
