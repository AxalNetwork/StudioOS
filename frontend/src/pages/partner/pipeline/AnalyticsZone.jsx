import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import useKeyedRead from '../../../hooks/useKeyedRead';
import { useActiveCompany } from '../../../contexts/ActiveCompanyContext';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, NotRecorded } from '../../../workspaces/canvasKit';
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
 * THE CHIP ROW NARROWS WHAT WAS DECIDED AND NOTHING ELSE. All four are decision windows. An undecided quote has no decision date
 * to place in any window, so the weighted forecast is over the whole open
 * pipeline regardless of the chip — said on the page, because a forecast that
 * silently changed meaning with a chip would be worse than one that ignored it.
 *
 * WHERE THE FIGURES COME FROM. All of them are `GET /api/quotes/analytics`,
 * computed in `services/bdAnalytics.ts`. The zone does no arithmetic of its
 * own: the Studio home card reads the same endpoint (as the retired
 * `/partner/operations/performance` did, D395), and three surfaces computing one win rate three ways is how they
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
  all: 'in the whole record',
};
const windowOf = (v) => (Object.prototype.hasOwnProperty.call(WINDOWS, v) ? v : 'quarter');

/** The strip tile, in the anatomy the artboards share. */
function AnalyticsTile({ label, value, note, calculation, nr = false }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {nr ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
      <details className="mt-2 text-xs text-axal-muted">
        <summary className="cursor-pointer font-semibold">How calculated<span className="sr-only"> · {label}</span></summary>
        <p className="mt-1">{calculation}</p>
      </details>
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
  const head = decided === 2 ? `2 decisions, ${s.accepted} won · too few to infer a reliable pattern` : `${decided} decided, ${s.accepted} won`;
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
  const [view, setView] = useState('quarter');
  const [metric, setMetric] = useState('win-rate');
  const { company } = useActiveCompany();
  // THE ANSWER BELONGS TO THE CHIP AND THE COMPANY IT WAS ASKED FOR (#4701).
  // The read used to set state whenever its request settled, so pressing
  // "Last quarter" then "Year to date" could leave the slower first answer on
  // screen under the second chip. Keyed reads drop an answer whose period or
  // company is no longer the one selected, and show loading — not the previous
  // chip's figures — while the new one is on its way.
  const read = useKeyedRead(`${view}|${company?.id ?? 'none'}`, () => api.quotesAnalytics(windowOf(view)));
  const state = {
    loading: read.status === 'loading',
    error: read.status === 'unreadable' ? 'The pipeline analytics could not be read.' : '',
    data: read.data || null,
  };
  const load = read.reload;
  // `view` IS A DEPENDENCY BECAUSE THE WINDOW IS THE WORKER'S. The chips do not
  // narrow rows on this page — there are no rows here, only aggregates — so a
  // chip press has to re-read.

  const d = state.data;
  const windowLabel = WINDOWS[windowOf(view)];
  const p = d?.pipeline || null;
  const f = d?.forecast || null;
  // How many open quotes the forecast is over (D4838): none is "nothing open to forecast", never $0.
  const forecastOpen = Array.isArray(f?.by_stage) ? f.by_stage.reduce((n, s) => n + (Number(s?.count) || 0), 0) : 0;
  const shapes = useMemo(() => (Array.isArray(d?.by_shape) ? d.by_shape : []), [d]);
  const quarters = useMemo(() => (Array.isArray(d?.by_quarter) ? d.by_quarter : []), [d]);
  const losses = useMemo(() => (Array.isArray(d?.loss_reasons) ? d.loss_reasons : []), [d]);
  const lostCount = d?.lost_count ?? 0;
  const hasQuotes = (d?.rows_read ?? p?.quote_count ?? 0) > 0 || forecastOpen > 0 || quarters.length > 0;

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
        isEmpty={!p || !hasQuotes}
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
              calculation="Wins divided by won and lost quotes. Pending and withdrawn quotes are excluded."
              value={p?.win_rate_pct != null ? `${p.win_rate_pct}%` : ''}
              nr={p?.win_rate_pct == null}
              note={p?.win_rate_pct != null
                ? `${p.accepted} of ${p.accepted + p.rejected} decided`
                : `nothing decided ${windowLabel}`}
            />
            <AnalyticsTile
              label="Median cycle"
              calculation="Middle elapsed time from the quote date to the decision date among decided quotes with both dates."
              value={p?.median_cycle_days != null ? `${p.median_cycle_days} d` : ''}
              nr={p?.median_cycle_days == null}
              note={p?.median_cycle_days != null
                ? `decided bids with both dates · exact sample count unavailable`
                : 'no decided bid carries both dates'}
            />
            {/* NOT NARROWED BY THE CHIP, and the note says so rather than
                letting a reader assume the window applies to it. */}
            {/* D4838: ZERO ONLY OVER A POPULATION. The Worker always sends a forecast object, so `!f` never fired and
                a firm with nothing open read "$0" over "$0 open". The population is the open quotes it counted. */}
            <AnalyticsTile
              label="Weighted forecast"
              calculation="Each open quote’s value multiplied by its stage weight, then summed across the open pipeline."
              value={forecastOpen ? moneyDollars(f.weighted_value) : ''}
              nr={!forecastOpen}
              note={forecastOpen
                ? `${forecastOpen} open quotes · ${moneyDollars(f.unweighted_value)} total · every window`
                : 'nothing open to forecast'}
            />
            {/* THE FOURTH TILE IS THE ARTBOARD'S ARGUMENT. It counts explained
                losses, and says how many losses were never explained rather
                than presenting the count as a share of all of them. */}
            <AnalyticsTile
              label="Losses on price"
              calculation="Lost quotes marked Price, shown out of all lost quotes. Losses without a reason are counted separately."
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
            <p className="text-[12px] leading-relaxed text-axal-muted">{p.win_rate_basis}</p>
          )}

          <Section title={metric === 'win-rate' ? 'Win rate over time' : 'Cycle time'}>
            <div role="group" aria-label="Chart metric" className="mb-3 flex flex-wrap gap-2">
              {[['win-rate', 'Win rate'], ['cycle-time', 'Cycle time']].map(([key, title]) => (
                <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}
                  className="min-h-11 rounded-lg border border-axal-hairline px-3 text-sm font-semibold aria-pressed:bg-amber-100 aria-pressed:text-amber-950 focus-visible:outline-2">
                  {title}
                </button>
              ))}
            </div>
            {metric === 'cycle-time' ? (
              <div className="grid gap-2">
                <p>{p.median_cycle_days == null ? 'No cycle time recorded' : `Median cycle: ${p.median_cycle_days} days`} · {windowLabel}.</p>
                <p className="text-sm text-axal-muted">Quarterly cycle times are unavailable. The median uses decided quotes with both dates.</p>
              </div>
            ) : quarters.length === 0 ? (
              <p className="text-sm text-axal-muted">No quote has been decided yet.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-axal-muted" data-testid="analytics-trend-summary">
                  Win rate across {quarters.length} recorded decision {quarters.length === 1 ? 'quarter' : 'quarters'}. Latest quarter: {quarters.at(-1).accepted} of {quarters.at(-1).decided} decided quotes won.
                </p>
                <div className="grid gap-2" aria-hidden="true">
                  {quarters.filter((q) => q.win_rate_pct != null).map((q) => (
                    <div key={q.quarter} className="grid grid-cols-[5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
                      <span>{q.quarter}</span>
                      <div className="h-2 rounded bg-axal-ground"><div className="h-full rounded bg-amber-600" style={{ width: `${q.win_rate_pct}%` }} /></div>
                      <span className="text-right">{q.win_rate_pct}%</span>
                    </div>
                  ))}
                </div>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-semibold">View win rate table</summary>
                  <table className="mt-2 w-full text-left">
                    <thead><tr><th scope="col">Quarter</th><th scope="col">Won / decided</th><th scope="col">Win rate</th></tr></thead>
                    <tbody>{quarters.map((q) => <tr key={q.quarter}><th scope="row">{q.quarter}</th><td>{q.accepted} / {q.decided}</td><td>{q.win_rate_pct == null ? 'Not recorded' : `${q.win_rate_pct}%`}</td></tr>)}</tbody>
                  </table>
                </details>
              </>
            )}
          </Section>

          <Section title="By shape">
            <p className="mb-3 text-sm text-axal-muted">Shape is the need category. Win rate uses decided quotes.</p>
            <div data-testid="by-shape" className="grid gap-2">
              <div className="hidden grid-cols-6 gap-2 px-3 text-xs font-semibold lg:grid" aria-hidden="true">
                {['Shape', 'Quotes', 'Won', 'Win rate', 'Median cycle', 'Won value'].map((label) => <span key={label}>{label}</span>)}
              </div>
              {shapes.map((s) => (
                <dl key={s.shape ?? '__unrecorded'} className="grid min-w-0 grid-cols-2 gap-2 rounded-lg border border-axal-hairline p-3 text-sm lg:grid-cols-6">
                  {[
                    ['Shape', shapeName(s.shape)], ['Quotes', s.quote_count], ['Won', s.accepted],
                    ['Win rate', s.win_rate_pct == null ? 'Not recorded' : `${s.win_rate_pct}%`],
                    ['Median cycle', s.median_cycle_days == null ? 'Not recorded' : `${s.median_cycle_days} d`],
                    ['Won value', s.accepted ? moneyDollars(s.won_value) : 'Not recorded'],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 [overflow-wrap:anywhere]">
                      <dt className="text-xs font-semibold text-axal-muted lg:sr-only">{label}</dt><dd>{value}</dd>
                    </div>
                  ))}
                  <div className="col-span-full text-xs text-axal-muted"><dt className="sr-only">Sample</dt><dd>{shapeRead(s)}</dd></div>
                </dl>
              ))}
              {!shapes.length && <p className="text-sm text-axal-muted">No quotes in this period.</p>}
            </div>
          </Section>

          <Section title="Why we lose">
            <p className="-mt-1 mb-3 text-[11px] font-semibold uppercase tracking-[.07em] text-axal-faint">
              Recorded loss reasons
            </p>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div>
                {lostCount === 0 ? (
                  <p className="text-[12.5px] text-axal-muted">
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
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-axal-ground">
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
                        <span className="text-[11.5px] font-semibold text-axal-muted">Not recorded</span>
                        <span className="text-[11.5px] font-bold tabular-nums text-axal-muted">
                          {d?.losses_unstated ?? 0}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-axal-ground">
                        <div
                          className="h-full rounded-full bg-gray-400 dark:bg-gray-600"
                          style={{ width: `${Math.round(((d?.losses_unstated ?? 0) / lossMax) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">
                  Reasons are picked from a fixed taxonomy on the proposal, not typed —
                  free text would make this chart unreadable within a quarter. Every
                  entry is drawn including the zeroes, because a chart missing its empty
                  rows implies the reasons it omits were never options.
                  {d?.loss_reasons_note ? ` ${d.loss_reasons_note}` : ''}
                </p>
              </div>

              <ZoneDraft
                surface="pipeline/analytics"
                railOption="draft:quarter-narrative"
                label="Proposal · the quarter, narrated"
                accept="Accept read"
                run="Narrate the quarter"
                foot="Every figure read from the decided bids."
                empty="A read of the quarter built from the decided bids and nothing else: what the rate rests on, which shapes carry it, and which losses the taxonomy actually covers — with the sample named beside every claim, because a pattern over three decisions is a pattern over three decisions however confidently it is written."
                nothingToDraft="No quote has been decided yet, so there is no quarter to narrate."
              />
            </div>
          </Section>

          <StatedLimit title="What these figures cover">
            <p>Periods follow decision dates. The forecast includes all open quotes, and the trend includes all recorded quarters.</p>
            <p className="mt-2">See <Link to="/pipeline/retainers" className="text-amber-700 underline">Retainers</Link> for recurring work and <Link to="/partner/insights" className="text-amber-700 underline">Demand Insights</Link> for board-wide demand.</p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
