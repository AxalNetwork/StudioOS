/**
 * HQ · Revenue — canvas H5, "the money rails, and the token P&L".
 *
 * FIVE ZONES, AND ONLY TWO OF THEM HAVE A STORE. That is the fact this page
 * is built around, and checking it before drawing anything is what changed
 * the page: the artboard's five zones map onto two real reads, one half
 * read, and two figures the platform has never recorded.
 *
 *   By stream          licence fees are real; subscriptions cannot be
 *                      totalled; the token line is a cost with no price.
 *   Token P&L by sub.  U1 — nothing ties spend to a licence.
 *   Statements         no subsidiary statement store exists.
 *   Open disputes      real, and read from its OWN endpoint so that Stripe
 *                      being slow or down costs this zone and not the page.
 *   Promo budget       there is no budget in the product; what exists is a
 *                      list of codes, and that is what is shown.
 *
 * NO CROSS-CURRENCY TOTAL. Licence fees are denominated per licence and the
 * token cost is USD. The canvas's single "Q3 · €X platform revenue" headline
 * would be wrong by the exchange rate and stated to the cent, so the header
 * carries the quarter and the streams are shown apart. D56/D68: absent is
 * "Not recorded" with its reason, never a plausible zero and never a dash.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

const UNAVAILABLE = Symbol('unavailable');

/** A number, or null when there is not one. Never a default. */
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());

/** Minor units to a readable amount, in the currency the row is denominated in. */
function money(cents, currency) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0,
    }).format(Number(cents) / 100);
  } catch {
    // An unknown ISO code must not blank the figure — show the number and
    // name the currency beside it rather than dropping a real amount.
    return `${(Number(cents) / 100).toLocaleString()} ${currency || ''}`.trim();
  }
}
const usd = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))
  ? null
  : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(v)));

function Zone({ title, sub, children }) {
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{title}</h2>
        {sub && <span className="text-[11.5px] text-axal-ink-3">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

/** A figure the platform does not have, with the server's own reason. */
function Absent({ reason }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
      <Unrecorded /> — {reason}
    </p>
  );
}

function Stat({ label, value, note, tone = 'text-axal-ink' }) {
  return (
    <div className="rounded-xl border border-axal-line bg-axal-surface-2 p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{label}</div>
      <div className={`mt-1 text-lg font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? <Unrecorded />}</div>
      {note && <div className="mt-0.5 text-[10px] text-axal-ink-3">{note}</div>}
    </div>
  );
}

export default function RevenuePage() {
  const [data, setData] = useState(null);            // null = loading, UNAVAILABLE = failed
  // Disputes load separately on purpose: they are the one figure that comes
  // from Stripe, and folding them into the summary would mean an outage
  // there blanked four zones that read D1 perfectly well.
  const [disputes, setDisputes] = useState(null);

  const load = useCallback(() => {
    setData(null);
    api.hqRevenue().then(setData, (e) => { reportError('hq-revenue', e); setData(UNAVAILABLE); });
  }, []);
  const loadDisputes = useCallback(() => {
    setDisputes(null);
    api.adminBillingListDisputes(100).then(setDisputes, (e) => {
      reportError('hq-revenue-disputes', e);
      setDisputes(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); loadDisputes(); }, [load, loadDisputes]);

  const ready = data && data !== UNAVAILABLE;
  const fees = ready ? data.licence_fees : null;
  const token = ready ? data.token_cost : null;
  const promos = ready ? data.promos : null;
  const openDisputes = disputes && disputes !== UNAVAILABLE
    ? (disputes.disputes || []).filter((d) => d.status !== 'won' && d.status !== 'lost').length
    : null;

  const rail = (
    <WorkerRail
      surface="hq_revenue"
      title="Revenue"
      unavailable={[
        ['Subscription revenue', 'No local charge ledger; Stripe is read per customer.'],
        ['Token margin', 'The cost of a call is recorded, the price charged for it is not.'],
        ['Token P&L per subsidiary', 'No account names its licence yet (U1).'],
        ['Subsidiary statements', 'No statement store exists.'],
        ['Promotional budget', 'The product has codes and caps, not budgets.'],
      ]}
      data-testid="hq-revenue-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-revenue-page">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#14532d] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          {/* The canvas puts a single platform-revenue figure here. Two
              currencies and a USD cost cannot be added into one, so the
              quarter is stated and the money is left in its own rows. */}
          <span className="text-[11px] opacity-80 tabular-nums">
            {ready ? `${data.quarter.label} · streams shown separately, not summed` : '…'}
          </span>
        </div>

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            <Coins size={13} /> HQ · Revenue
          </div>
          {/* `text-axal-ink` is #18181b with no dark-mode value in the @theme
              block, so on the dark ground the heading is near-black on
              near-black. Every HQ page has this and it is not this page's to
              fix across the tier — but this page is not shipping with an
              unreadable title either. */}
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Revenue</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
            Three streams and the one line that is a margin rather than a fee. Licence fees and open disputes
            are read from their stores; subscriptions, the token margin, the per-subsidiary split and the
            statement ledger are not recorded anywhere, and each says so where its figure would be.
          </p>
        </header>

        {data === UNAVAILABLE && (
          <div className="mt-4">
            <Unreadable
              what="The revenue summary"
              claim="This is not a claim that nothing was earned."
              onRetry={load}
            />
          </div>
        )}

        <div className="mt-4 space-y-4">
          <Zone title="By stream" sub="gross, cost, and what is actually known">
            {fees?.available ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-axal-line text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-ink-3">
                      <th className="py-1.5 pr-3">Stream</th>
                      <th className="py-1.5 pr-3">This quarter</th>
                      <th className="py-1.5 pr-3">Cost</th>
                      <th className="py-1.5">Read</th>
                    </tr>
                  </thead>
                  <tbody data-testid="hq-revenue-streams">
                    {fees.by_currency.map((row) => (
                      <tr key={row.currency} className="border-b border-axal-line/60">
                        <td className="py-2 pr-3 font-medium">Licence fees · {row.currency}</td>
                        <td className="py-2 pr-3 tabular-nums">{money(row.quarter_cents, row.currency)}</td>
                        <td className="py-2 pr-3 text-axal-ink-3">No cost of goods</td>
                        <td className="py-2 text-[11.5px] text-axal-ink-2">
                          {row.licences} active licence{row.licences === 1 ? '' : 's'}. {fees.basis}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-axal-line/60">
                      <td className="py-2 pr-3 font-medium">Subscriptions</td>
                      <td className="py-2 pr-3"><Unrecorded /></td>
                      <td className="py-2 pr-3 text-axal-ink-3">Not applicable</td>
                      <td className="py-2 text-[11.5px] text-axal-ink-2">{ready ? data.subscriptions_reason : null}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium">Token margin</td>
                      <td className="py-2 pr-3"><Unrecorded /></td>
                      <td className="py-2 pr-3 tabular-nums">
                        {token?.available ? usd(token.cost_usd) : <Unrecorded />}
                      </td>
                      <td className="py-2 text-[11.5px] text-axal-ink-2">
                        {token?.available ? token.billed_reason : (token?.reason || null)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {fees.active_without_fee > 0 && (
                  <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-300" data-testid="hq-revenue-fee-gap">
                    {fees.active_without_fee === 1
                      ? '1 active licence records no annual fee, so it is'
                      : `${fees.active_without_fee} active licences record no annual fee, so they are`} not in
                    the figures above.
                  </p>
                )}
                {/* Never one number. Said on the page, not only in the code. */}
                <p className="mt-2 text-[11px] leading-relaxed text-axal-ink-3">
                  Rows are not added together: licence fees are denominated per licence and the token cost is
                  USD, so a single total would be wrong by the exchange rate and stated to the cent.
                </p>
              </div>
            ) : (
              <Absent reason={fees?.reason || 'The licence ledger could not be read.'} />
            )}
          </Zone>

          <div className="grid gap-4 md:grid-cols-2">
            <Zone title="Token P&L by subsidiary" sub="what it cost against what it billed">
              <Absent reason={ready ? data.derived_metrics_reason : 'The revenue summary could not be read.'} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat
                  label="Token cost, platform-wide"
                  value={token?.available ? usd(token.cost_usd) : null}
                  note={token?.available ? `${num(token.calls)} calls this quarter · USD` : (token?.reason || 'unreadable')}
                />
                <Stat label="Margin" value={null} note="no price is recorded to subtract the cost from" />
              </div>
            </Zone>

            <Zone title="Statements and Stripe" sub="what is owed, and what is stuck">
              <Absent reason={ready ? data.statements_reason : 'The revenue summary could not be read.'} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat
                  label="Open disputes"
                  value={openDisputes === null ? null : num(openDisputes)}
                  note={disputes === UNAVAILABLE ? 'Stripe could not be read' : 'from Stripe, not the local ledger'}
                  tone={openDisputes ? 'text-red-700 dark:text-red-300' : 'text-axal-ink'}
                />
                <Stat label="Owed by subsidiaries" value={null} note="no statement store" />
              </div>
              {disputes === UNAVAILABLE && (
                <div className="mt-2">
                  <Unreadable
                    what="Open disputes"
                    claim="This is not a claim that there are none."
                    onRetry={loadDisputes}
                  />
                </div>
              )}
            </Zone>
          </div>

          <Zone title="Promotions" sub="codes and redemptions — there is no budget">
            {promos?.available ? (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <Stat label="Active codes" value={num(promos.active_codes)} note="redeemable now" />
                  <Stat label="Redemptions" value={num(promos.redemptions)} note="across active codes" />
                  <Stat label="Budget left" value={null} note="no budget exists to spend down" />
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-axal-ink-2">{promos.budget_reason}</p>
              </>
            ) : (
              <Absent reason={promos?.reason || 'The promotion codes could not be read.'} />
            )}
          </Zone>
        </div>
      </div>

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
