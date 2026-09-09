import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';
// Through `pages/partner/kit.jsx` rather than reaching into the advisor tree
// and the operations kit separately — the same primitives, but `moneyUsd`
// arrives under the name `moneyDollars`, which is the whole point of that file:
// the figures below are `quotes.price`, REAL DOLLARS, and the cents-taking
// helper of the identical shape is one import line away.
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Section, moneyDollars,
} from '../kit';

/**
 * Pipeline · Analytics — the `p5` artboard, and the block it stopped refusing.
 *
 * WHAT THIS ROUTE USED TO RENDER. Until the Pipeline bucket was composed this
 * zone mounted `PartnerInsightsPage` — Demand Insights, which answers where
 * founder demand is concentrated across the WHOLE board. That is a real surface
 * and an honest one; it is a different question from the one the artboard puts
 * here, which is about the firm's own pipeline. Demand Insights keeps its own
 * mount at `/partner/insights`.
 *
 * THE LOSS TAXONOMY WAS THE MISSING THIRD. The artboard's own subtitle names
 * what it exists for: "the loss pattern broken out by shape, with the on-price
 * count stated per shape rather than asserted as a universal." That was refused
 * here for as long as it had to be — `quotes` carried a status and a decision
 * date and nothing about why, so every "lost on price" figure would have been
 * inferred. Migration 234 added `quotes.loss_reason`, the Proposals zone writes
 * it against a closed vocabulary, and the chart below counts it. The refusal
 * went with the gap; the paragraph that used to state it would now be false.
 *
 * A LOSS WITH NO REASON IS ITS OWN ROW, never an `Other`. Nobody is obliged to
 * record one, and a taxonomy that quietly absorbed the unexplained losses would
 * describe a pattern over exactly the decisions somebody bothered to explain.
 * That is why every read below states its denominator.
 *
 * THE CHIP ROW NARROWS WHAT WAS DECIDED AND NOTHING ELSE. Three of the four are
 * periods and the fourth is a grouping. An undecided quote has no decision date
 * to place in any window, so the weighted forecast is over the whole open
 * pipeline regardless of the chip — said on the page, because a forecast that
 * silently changed meaning with a chip would be worse than one that ignored it.
 *
 * WHERE THE FIGURES COME FROM. All of them are `GET /api/quotes/analytics`,
 * computed in `services/bdAnalytics.ts`. The zone does no arithmetic of its
 * own: `/partner/operations/performance` and the Studio home card read the same
 * endpoint, and three surfaces computing one win rate three ways is how they
 * come to disagree.
 */

/** The five reason labels, matching Proposals so one loss reads the same twice. */
const LOSS_LABEL = {
  price: 'Price',
  scope_mismatch: 'Scope mismatch',
  timing: 'Timing',
  other: 'Other',
};
/**
 * The windows this page can ask for, and what each one selects.
 *
 * NAMED HERE, NOT ONLY IN THE CHIP ROW, for two reasons. The worker coerces an
 * unrecognised key to `all` rather than refusing — two older consumers send no
 * period at all, and a 400 would take their dashboards down over a chip that
 * does not exist here — so a page that forwarded a stray key would show
 * all-time figures under a chip labelled "This quarter". And the labels are
 * what the strip's empty notes say, so "nothing lost" always names the window
 * it is true of.
 */
const WINDOWS = {
  quarter: 'this quarter',
  prev_quarter: 'last quarter',
  ytd: 'so far this year',
  shape: 'in the whole record',
};
const windowOf = (v) => (Object.prototype.hasOwnProperty.call(WINDOWS, v) ? v : 'quarter');

/** The artboard's three series colours, in its own order. */
const SERIES = ['#fcd34d', '#d97706', '#92400e'];

/** The strip tile, in the anatomy the artboards share. */
function AnalyticsTile({ label, value, note, nr = false }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {nr ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

const shapeName = (s) => (s == null ? 'Not recorded' : String(s).replace(/_/g, ' '));

/**
 * The artboard's `Read` column: what this shape's record actually supports.
 *
 * THE ARTBOARD ITSELF REFUSES A PATTERN UNDER TWO BIDS — "One bid, one won. Too
 * few to claim a pattern." — and this keeps that rule while adding the one it
 * asks for: the on-price count is stated over the losses somebody EXPLAINED,
 * never over every loss. A shape with three losses and one recorded reason has
 * a taxonomy covering one of them, and saying "one of the three losses on
 * price" would be the assertion-as-universal the subtitle warns against.
 */
function shapeRead(s) {
  const decided = s.accepted + s.rejected;
  if (decided === 0) return 'Nothing decided yet, so there is no rate to read.';
  if (decided === 1) {
    return s.accepted === 1
      ? 'One bid, one won. Too few to claim a pattern.'
      : 'One bid, one lost. Too few to claim a pattern.';
  }
  const head = `${decided} decided, ${s.accepted} won`;
  if (s.rejected === 0) return `${head} — nothing lost in this shape.`;
  if (s.losses_with_reason === 0) {
    return `${head} — no reason is recorded against ${s.rejected === 1 ? 'the loss' : `any of the ${s.rejected} losses`}.`;
  }
  const of = `of the ${s.losses_with_reason} explained loss${s.losses_with_reason === 1 ? '' : 'es'}`;
  return s.on_price_losses === 0
    ? `${head} — none ${of} was on price.`
    : `${head} — ${s.on_price_losses} ${of} on price.`;
}

export default function PartnerPipelineAnalyticsZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [view, setView] = useState('quarter');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.quotesAnalytics(windowOf(view));
      setState({ loading: false, error: '', data: r || null });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The pipeline analytics did not load.', data: null });
    }
  }, [view]);
  // `view` IS A DEPENDENCY BECAUSE THE WINDOW IS THE WORKER'S. The chips do not
  // narrow rows on this page — there are no rows here, only aggregates — so a
  // chip press has to re-read. An effect keyed on `[]` would leave every chip
  // showing the first window's figures, which is the bug this zone's sibling
  // `delivery/capacity` shipped with.
  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const windowLabel = WINDOWS[windowOf(view)];
  const p = d?.pipeline || null;
  const f = d?.forecast || null;
  const shapes = useMemo(() => (Array.isArray(d?.by_shape) ? d.by_shape : []), [d]);
  const quarters = useMemo(() => (Array.isArray(d?.by_quarter) ? d.by_quarter : []), [d]);
  const losses = useMemo(() => (Array.isArray(d?.loss_reasons) ? d.loss_reasons : []), [d]);
  const lostCount = d?.lost_count ?? 0;

  // THE CHART'S LEGEND IS THE SHAPES THAT ACTUALLY DECIDED SOMETHING, in the
  // by-shape table's own order — so a colour means the same row in both. The
  // artboard's three-series legend is its fixture's three shapes; this firm's
  // are whatever it has bid on.
  const series = useMemo(() => {
    const seen = [];
    for (const q of quarters) {
      for (const s of q.by_shape || []) {
        if (!seen.some((x) => x.shape === s.shape)) seen.push({ shape: s.shape });
      }
    }
    return seen.map((s, i) => ({ ...s, color: SERIES[i % SERIES.length] }));
  }, [quarters]);

  // The tallest reason sets the bar scale, so the chart is read against its own
  // largest category rather than against a hundred nothing reaches.
  const lossMax = useMemo(
    () => Math.max(1, ...losses.map((l) => l.count), d?.losses_unstated ?? 0),
    [losses, d],
  );

  // Hoisted so the gate branch and the live row draw the SAME row.
  const rowActions = partnerZoneActions('pipeline/analytics', { view: {
    header: ['Shape', 'Quotes', 'Won', 'Win rate %', 'Median cycle (days)', 'Won value',
      'Losses', 'Losses with a reason', 'On price'],
    rows: shapes,
    cells: (s) => [s.shape, s.quote_count, s.accepted, s.win_rate_pct, s.median_cycle_days,
      s.won_value, s.rejected, s.losses_with_reason, s.on_price_losses],
  } });

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('pipeline/analytics', { value: view, onChange: setView })}
        actions={rowActions}
      />
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
          <ZoneHeading
            title="Analytics"
            blurb={
              'Win rate, cycle time and forecast — and the loss pattern that explains '
              + 'all three. The on-price count is stated per shape rather than asserted '
              + 'as a universal, because that is the only form of it the record supports.'
            }
          />

          {/* ══ THE `p5` STRIP ═══════════════════════════════════════════════
              `Win rate · Median cycle · Weighted forecast · On-price losses`.
              The fourth was the artboard's whole argument for a loss taxonomy
              and is a read now rather than a gap. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {/* NULL IS NOT 0%. Nothing decided is not everything lost. */}
            <AnalyticsTile
              label="Win rate"
              value={p?.win_rate_pct != null ? `${p.win_rate_pct}%` : ''}
              nr={p?.win_rate_pct == null}
              note={p?.win_rate_pct != null
                ? `${p.accepted} of ${p.accepted + p.rejected} decided`
                : `nothing decided ${windowLabel}`}
            />
            <AnalyticsTile
              label="Median cycle"
              value={p?.median_cycle_days != null ? `${p.median_cycle_days} d` : ''}
              nr={p?.median_cycle_days == null}
              note={p?.median_cycle_days != null
                ? `sent to decided · ${p.accepted + p.rejected} decided bids`
                : 'no decided bid carries both dates'}
            />
            {/* NOT NARROWED BY THE CHIP, and the note says so rather than
                letting a reader assume the window applies to it. */}
            <AnalyticsTile
              label="Weighted forecast"
              value={f ? moneyDollars(f.weighted_value) : ''}
              nr={!f}
              note={f
                ? `${moneyDollars(f.unweighted_value)} open · every window`
                : 'nothing open to forecast'}
            />
            {/* THE FOURTH TILE IS THE ARTBOARD'S ARGUMENT. It counts explained
                losses, and says how many losses were never explained rather
                than presenting the count as a share of all of them. */}
            <AnalyticsTile
              label="On-price losses"
              value={lostCount ? `${d?.on_price_losses ?? 0} of ${lostCount}` : ''}
              nr={!lostCount}
              note={lostCount
                ? (d?.losses_unstated
                  ? `${d.losses_unstated} carry no recorded reason`
                  : 'every loss carries a recorded reason')
                : `nothing lost ${windowLabel}`}
            />
          </div>

          {p?.win_rate_basis && (
            <p className="text-[12px] leading-relaxed text-axal-ink-2">{p.win_rate_basis}</p>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.25fr_1fr]">
            {/* ══ BY SHAPE — the artboard's four columns ══════════════════ */}
            <Instrument
              testid="by-shape"
              title="By shape"
              meta="On-price losses stated per shape"
              cols="1.1fr .6fr .6fr 1.5fr"
              head={['Shape', 'Win', 'Cycle', 'Read']}
              rows={shapes.map((s) => ({
                key: s.shape == null ? '__unrecorded' : s.shape,
                cells: [
                  s.shape == null
                    ? { nr: true, sub: `${s.quote_count} quote${s.quote_count === 1 ? '' : 's'}` }
                    : { text: shapeName(s.shape), sub: `${s.quote_count} quote${s.quote_count === 1 ? '' : 's'}` },
                  // A SHAPE WITH NOTHING DECIDED SHOWS NO RATE. 0% is a claim
                  // about losses; no decisions is not.
                  s.win_rate_pct == null
                    ? { nr: true }
                    : {
                      text: `${s.win_rate_pct}%`,
                      barPct: Math.max(0, Math.min(100, s.win_rate_pct)),
                      barColor: s.win_rate_pct >= 50 ? '#047857' : '#b45309',
                    },
                  s.median_cycle_days == null ? { nr: true } : { text: `${s.median_cycle_days} d` },
                  { text: shapeRead(s) },
                ],
              }))}
              note={'Shape here is the need’s own category — the only decomposition the record carries. Nothing stores an engagement shape, so a retainer and a one-off project filed under the same category are one row, and the column header is not allowed to imply more. Each shape’s win rate uses the same denominator as the headline: decided quotes only. The read states its sample, because a rate over two decisions is a rate over two decisions however confidently it is printed — and the on-price count is over the losses that carry a recorded reason, never over every loss, which is what the artboard means by stating it per shape rather than asserting it as a universal.'}
            />

            {/* ══ QUARTER OVER QUARTER — win rate by shape ════════════════ */}
            <Section title="Quarter over quarter">
              <p className="-mt-1 mb-2 text-[11px] font-semibold uppercase tracking-[.07em] text-axal-ink-3">
                Win rate by shape
              </p>
              {quarters.length === 0 ? (
                <p className="text-[12.5px] text-axal-ink-2">
                  No quote has been decided yet, so there is no quarter to compare.
                </p>
              ) : (
                <>
                  <div className="flex h-[132px] items-end gap-3">
                    {quarters.map((q) => (
                      <div key={q.quarter} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                        <div className="flex h-full items-end gap-1">
                          {series.map((s) => {
                            const point = (q.by_shape || []).find((x) => x.shape === s.shape);
                            // A SHAPE THAT DECIDED NOTHING IN A QUARTER DRAWS NO
                            // BAR AT ALL. A zero-height column would read as
                            // having lost every bid rather than as having made
                            // none — the same distinction the strip makes.
                            if (!point || point.win_rate_pct == null) {
                              return <div key={String(s.shape)} className="min-w-0 flex-1" />;
                            }
                            return (
                              <div
                                key={String(s.shape)}
                                className="min-w-0 flex-1 rounded-t-[3px]"
                                style={{
                                  height: `${Math.max(2, Math.min(100, point.win_rate_pct))}%`,
                                  background: s.color,
                                }}
                                title={`${shapeName(s.shape)} · ${point.win_rate_pct}% of ${point.decided} decided`}
                              />
                            );
                          })}
                        </div>
                        <div className="mt-2 text-center text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                          {q.quarter}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div data-testid="chart-legend" className="mt-3 flex flex-wrap gap-3.5">
                    {series.map((s) => (
                      <div key={String(s.shape)} className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: s.color }} />
                        <span className="text-[11px] text-axal-ink-2">{shapeName(s.shape)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-axal-ink-3">
                A quarter is the quarter the DECISION landed in, not the one the quote
                was sent in — a proposal sent in March and lost in July is a Q3 loss.
                Open quotes belong to no quarter yet; withdrawn ones are excluded for
                the same reason they are excluded from the headline rate. This chart
                spans every quarter whatever the chip row says: a trend narrowed to one
                quarter is one bar.
              </p>
            </Section>
          </div>

          {/* ══ LOSS REASONS — the taxonomy, beside the narration ═════════ */}
          <Section title="Loss reasons">
            <p className="-mt-1 mb-3 text-[11px] font-semibold uppercase tracking-[.07em] text-axal-ink-3">
              The taxonomy, not a summary sentence
            </p>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div>
                {lostCount === 0 ? (
                  <p className="text-[12.5px] text-axal-ink-2">
                    Nothing was lost in this window, so there is no loss pattern to read.
                  </p>
                ) : (
                  <div className="grid gap-2.5">
                    {losses.map((l) => (
                      <div key={l.reason}>
                        <div className="flex justify-between gap-2.5">
                          <span className="text-[11.5px] font-semibold">{LOSS_LABEL[l.reason] || l.reason}</span>
                          <span className="text-[11.5px] font-bold tabular-nums">{l.count}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-axal-surface-2">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.round((l.count / lossMax) * 100)}%`,
                              background: l.reason === 'price' ? '#b91c1c' : '#d97706',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    {/* THE ROW THAT IS NOT A CATEGORY. A loss nobody explained
                        is not an `Other`, and folding it in would report a
                        pattern over exactly the decisions somebody wrote up. */}
                    <div className="mt-1 border-t border-axal-hairline pt-2.5">
                      <div className="flex justify-between gap-2.5">
                        <span className="text-[11.5px] font-semibold text-axal-ink-2">No reason recorded</span>
                        <span className="text-[11.5px] font-bold tabular-nums text-axal-ink-2">
                          {d?.losses_unstated ?? 0}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-axal-surface-2">
                        <div
                          className="h-full rounded-full bg-gray-400 dark:bg-gray-600"
                          style={{ width: `${Math.round(((d?.losses_unstated ?? 0) / lossMax) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-axal-ink-3">
                  Reasons are picked from a fixed taxonomy on the proposal, not typed —
                  free text would make this chart unreadable within a quarter. Every
                  entry is drawn including the zeroes, because a chart missing its empty
                  rows implies the reasons it omits were never options.
                  {d?.loss_reasons_note ? ` ${d.loss_reasons_note}` : ''}
                </p>
              </div>

              <ZoneDraft
                surface="pipeline/analytics"
                label="Proposal · the quarter, narrated"
                accept="Accept read"
                run="Narrate the quarter"
                foot="Every figure read from the decided bids."
                empty="A read of the quarter built from the decided bids and nothing else: what the rate rests on, which shapes carry it, and which losses the taxonomy actually covers — with the sample named beside every claim, because a pattern over three decisions is a pattern over three decisions however confidently it is written."
                nothingToDraft="No quote has been decided yet, so there is no quarter to narrate."
              />
            </div>
          </Section>

          <StatedLimit title="What these figures do and do not claim">
            <p>
              <strong>The chips narrow decisions, not the forecast.</strong> This
              quarter, last quarter and year to date all select on the date a
              quote was DECIDED. An open quote has no decision date, so it sits
              in every window — which is why the weighted forecast is over the
              whole open pipeline whatever the chip row says, and why the
              quarter-over-quarter chart spans every quarter.
            </p>
            <p className="mt-2">
              <strong>The taxonomy covers the losses somebody explained.</strong>{' '}
              Recording a reason is optional, so “no reason recorded” is counted
              as its own row rather than folded into Other. Where it is the
              largest row, the chart is describing a minority of the losses and
              the note beside it says so.
            </p>
            <p className="mt-2">
              <strong>Shape is the need&rsquo;s category.</strong> Nothing stores
              an engagement shape, so a retainer and a one-off project filed under
              one category are one row here. The recurring economics live on{' '}
              <Link to="/pipeline/retainers" className="text-amber-700 underline">Retainers</Link>,
              which reads a store that does distinguish them.
            </p>
            <p className="mt-2">
              <strong>Where demand is, rather than how you did.</strong> The
              board-wide view of founder demand lives on{' '}
              <Link to="/partner/insights" className="text-amber-700 underline">Demand Insights</Link>,
              which this zone used to render. It answers a different question and
              keeps its own page.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
