import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { api } from '../../../lib/api';
import { ZoneBody, NothingYet, StatedLimit } from '../../advisor/expertise/kit';
import { Section, StatCard, moneyUsd } from '../operations/kit';

/**
 * Pipeline · Analytics — `/pipeline/analytics`.
 *
 * WHAT THIS ROUTE USED TO RENDER, AND WHY THAT WAS WRONG. Until now the zone
 * mounted `PartnerInsightsPage` — Demand Insights, which answers where founder
 * demand is concentrated across the WHOLE board and how it is trending. That
 * is a real surface and an honest one; it is simply a different question from
 * the one the canvas puts here, which is about the firm's own pipeline: "Win
 * rate, cycle time and forecast — and the loss pattern that explains all
 * three." The zone card underneath had to describe Demand Insights to stay
 * truthful, which is how a bucket overview ended up promising board-wide
 * demand on a zone the canvas names Analytics. Demand Insights keeps its own
 * mount at `/partner/insights`; this zone now answers its own question.
 *
 * WHERE THE FIGURES COME FROM. All of them are `GET /api/quotes/analytics`,
 * which has computed win rate, median cycle and the weighted forecast since
 * build queue #122 and had exactly two consumers, neither of them in the
 * Partner shell: `/partner/operations/performance` and the Studio home card.
 * The two breakdowns this zone adds — by shape and by quarter — are new
 * groupings of the same rows, not a new store.
 *
 * WHAT IT STILL CANNOT ANSWER, said on the page rather than left blank:
 * the loss-reason taxonomy the canvas leads with. `quotes` carries a status
 * and the date it was decided, and nothing else about the decision — no
 * reason, no competitor, no losing price. Every "lost on price" figure would
 * be inferred, and the canvas's own instruction is that the on-price count be
 * "stated per shape rather than asserted as a universal", which is precisely
 * the claim a store with no reason column cannot make.
 */
export default function PartnerPipelineAnalyticsZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.quotesAnalytics();
      setState({ loading: false, error: '', data: r || null });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The pipeline analytics did not load.', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const p = d?.pipeline || null;
  const f = d?.forecast || null;
  const shapes = d?.by_shape || [];
  const quarters = d?.by_quarter || [];

  return (
    <ZoneBody
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={!p || p.quote_count === 0}
      empty={(
        <NothingYet
          title="No quotes to analyse yet"
          body={
            'Win rate, cycle time and forecast are all computed from quotes this firm has sent. '
            + 'Send one from Leads and every figure on this zone starts answering.'
          }
          action={<Link to="/pipeline/leads" className="text-[12.5px] font-semibold text-amber-700 underline">Open leads</Link>}
        />
      )}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label="Win rate"
            value={p?.win_rate_pct != null ? `${p.win_rate_pct}%` : '—'}
            hint={p?.win_rate_pct != null ? `${p.accepted} of ${p.accepted + p.rejected} decided` : 'nothing decided yet'}
          />
          <StatCard
            label="Decision cycle"
            value={p?.median_cycle_days != null ? `${p.median_cycle_days}d` : '—'}
            hint="median, sent to decided"
          />
          <StatCard
            label="Weighted forecast"
            value={f ? moneyUsd(f.weighted_value) : '—'}
            hint={f ? `of ${moneyUsd(f.unweighted_value)} open` : undefined}
          />
          <StatCard label="Open proposals" value={p ? p.pending : '—'} hint={p ? moneyUsd(p.open_value) : undefined} />
          <StatCard label="Won value" value={p ? moneyUsd(p.won_value) : '—'} hint={p ? `${p.accepted} accepted` : undefined} />
          <StatCard
            label="Average deal"
            value={p?.average_deal_size != null ? moneyUsd(p.average_deal_size) : '—'}
            hint={p?.average_deal_size != null ? 'across won work' : 'no wins yet'}
          />
        </div>

        {p?.win_rate_basis && (
          <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Info size={13} className="mt-0.5 flex-shrink-0" />
            <span>{p.win_rate_basis}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section title="By shape">
            {shapes.length === 0 ? (
              <p className="text-[12.5px] text-axal-ink-2">No quotes to break out yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                      <th className="px-3 py-2 text-left font-semibold">Shape</th>
                      <th className="px-3 py-2 text-right font-semibold">Quotes</th>
                      <th className="px-3 py-2 text-right font-semibold">Win</th>
                      <th className="px-3 py-2 text-right font-semibold">Cycle</th>
                      <th className="px-3 py-2 text-right font-semibold">Won</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {shapes.map((s) => (
                      <tr key={s.shape == null ? '__unrecorded' : s.shape}>
                        <td className="px-3 py-2">
                          {s.shape == null
                            ? <span className="text-gray-500 dark:text-gray-400">Not recorded</span>
                            : <span className="capitalize">{String(s.shape).replace(/_/g, ' ')}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.quote_count}</td>
                        {/* A shape with nothing decided shows a dash, not 0%. Zero
                            per cent is a claim about losses; no decisions is not. */}
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.win_rate_pct != null ? `${s.win_rate_pct}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.median_cycle_days != null ? `${s.median_cycle_days}d` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{moneyUsd(s.won_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              Shape here is the need&rsquo;s own category — the only decomposition the
              record carries. Nothing stores an engagement shape, so a
              retainer and a one-off project under the same category are one row.
              Each shape&rsquo;s win rate uses the same denominator as the headline:
              decided quotes only.
            </p>
          </Section>

          <Section title="Quarter over quarter">
            {quarters.length === 0 ? (
              <p className="text-[12.5px] text-axal-ink-2">
                No quote has been decided yet, so there is no quarter to compare.
              </p>
            ) : (
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
                {quarters.map((q) => {
                  // A quarter exists only because a decision landed in it, so the
                  // rate is never null here. The BAR still has to resolve to a
                  // number; the FIGURE beside it does not, and shows a dash rather
                  // than 0% if one ever were — a real 0% is a quarter that lost
                  // everything, which is not the same statement.
                  const bar = q.win_rate_pct == null ? 0 : Math.max(0, Math.min(100, q.win_rate_pct));
                  return (
                    <div key={q.quarter} className="flex items-center gap-3 p-3">
                      <div className="w-20 shrink-0 text-sm text-gray-900 tabular-nums dark:text-gray-100">{q.quarter}</div>
                      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div className="h-full rounded-full bg-amber-500" style={{ width: `${bar}%` }} />
                      </div>
                      <div className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums">
                        {q.win_rate_pct != null ? `${q.win_rate_pct}%` : '—'}
                        <span className="ml-1 text-[11px] font-normal text-gray-400">of {q.decided}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              A quarter is the quarter the DECISION landed in, not the one the quote
              was sent in — a proposal sent in March and lost in July is a Q3 loss.
              Open quotes belong to no quarter yet; withdrawn ones are excluded for
              the same reason they are excluded from the headline rate.
            </p>
          </Section>
        </div>

        <Section title="Weighted forecast (open pipeline)">
          {f && f.by_stage?.length ? (
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
              {f.by_stage.map((s) => (
                <div key={s.stage} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="text-sm capitalize text-gray-900 dark:text-gray-100">{s.stage}</div>
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {s.count} &times; weighted at {Math.round(s.weight * 100)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">{moneyUsd(s.weighted)}</div>
                    <div className="text-[11px] tabular-nums text-gray-400">of {moneyUsd(s.value)}</div>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 bg-gray-50/60 p-3 dark:bg-gray-800/40">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Weighted total</span>
                <span className="text-sm font-bold tabular-nums">{moneyUsd(f.weighted_value)}</span>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-axal-ink-2">
              No open proposals to forecast. Everything sent has been decided or withdrawn.
            </p>
          )}
          {f?.note && <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">{f.note}</p>}
        </Section>

        <StatedLimit title="What this zone cannot tell you">
          <p>
            <strong>Loss reasons.</strong> {d?.loss_reasons_note
              || 'A quote records its status and the date it was decided, and nothing about why.'}{' '}
            The canvas asks for the taxonomy rather than a summary sentence, and for the
            on-price count stated per shape — both of which need a reason recorded at the
            moment a quote is rejected. Until one is, this zone shows what happened and
            not why, rather than inferring a cause from a bare status.
          </p>
          <p className="mt-2">
            <strong>Where demand is, rather than how you did.</strong> The board-wide view of
            founder demand lives on{' '}
            <Link to="/partner/insights" className="text-amber-700 underline">Demand Insights</Link>,
            which this zone used to render. It answers a different question and keeps its own page.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
  );
}
