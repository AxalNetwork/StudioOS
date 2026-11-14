/**
 * D1154 (#3059, part 6 of #2421) — the reading tabs: Team (DL4), Market (DL5)
 * and Traction (DL6), on D1151's reads, with the slots from sibling canvases
 * (DL24) where their reads have not landed. The words and the rules come from
 * `dealInsightsModel.js`; this file only draws them.
 *
 * Each tab reads once. A viewer with no NDA on file sees the company's basics
 * and the way to the NDA; a read that fails says Unreadable with Try again;
 * one block that fails leaves the rest of the tab standing. Nothing here
 * changes anything, so nothing opens a dialog.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { dealInsightsApi } from '../../lib/api/dealInsights';
import { reportError } from '../../lib/log';
import { tabHref } from '../dealPageModel';
import { CARD, EYE, SUB, H3, BTN_S } from './DealFrame';
import { Slot } from './DealOverview';
import {
  ADVISORS_LINE, COVERAGE_NOTE, MASKED, NOT_RECORDED, NOT_REPORTED, SLOTS, TRACTION_CHARTS,
  blockOf, chartSummary, coverageView, dateText, figureText, insightState, marketRow, personView, safeUrl, sizingView, slotOf, tractionView,
} from './dealInsightsModel';

const TONE = {
  done: 'border-axal-positive/40 bg-axal-positive/10 text-axal-positive dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  wait: 'border-axal-amber/40 bg-axal-amber/10 text-axal-amber-deep dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
  gap: 'border-dashed border-axal-violet text-axal-violet-deep dark:border-violet-400 dark:text-violet-300',
  off: 'border-dashed border-axal-muted text-axal-muted dark:border-gray-600 dark:text-gray-400',
  src: 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
};
const Pill = ({ tone = 'off', children, testId }) => (
  <span className={`inline-flex w-fit items-center rounded-axal-pill border px-2 py-0.5 text-[11.5px] font-bold ${TONE[tone]}`} data-testid={testId}>{children}</span>
);
const Missing = ({ reason, testId }) => (
  <span className="flex flex-col gap-1" data-testid={testId}>
    <Pill tone="off">{NOT_RECORDED}</Pill>
    {reason && reason !== NOT_RECORDED && <span className={SUB}>{reason}</span>}
  </span>
);
const Card = ({ title, eye, children, testId, className = '' }) => (
  <section className={`${CARD} flex min-w-0 flex-col gap-2.5 p-4 ${className}`} data-testid={testId}>
    {eye && <span className={EYE}>{eye}</span>}
    {title && <h3 className={H3}>{title}</h3>}
    {children}
  </section>
);
const Reading = () => <p className={`m-0 ${SUB}`} aria-live="polite">Reading…</p>;
const BIG = 'm-0 font-mono text-[22px] font-bold tracking-[-0.01em] text-axal-ink dark:text-gray-100';

/** One read with its own state: loading, ready or unreadable. */
function useInsight(load, dealId) {
  const [read, setRead] = useState({ status: 'loading' });
  const run = () => {
    setRead({ status: 'loading' });
    load(dealId).then((data) => setRead({ status: 'ready', data })).catch((e) => { reportError('DealInsights:read', e); setRead({ status: 'unreadable' }); });
  };
  useEffect(run, [dealId]); // eslint-disable-line react-hooks/exhaustive-deps
  return [read, run];
}

/** The tab's frame: loading, masked before the NDA, unreadable, or its body. */
function InsightFrame({ read, retry, dealId, what, testId, children }) {
  const s = insightState(read);
  if (s.state === 'loading') return <Card testId={`${testId}-loading`}><Reading /></Card>;
  if (s.state === 'unreadable') {
    return <section className={`${CARD} p-4`} data-testid={`${testId}-unreadable`}><Unreadable what={what} claim="That is not the same as none." onRetry={retry} /></section>;
  }
  if (s.state === 'masked') {
    const p = s.project;
    return (
      <section className={`${CARD} flex flex-col items-start gap-2.5 p-5`} data-testid={`${testId}-masked`}>
        <span aria-hidden="true" className="text-[18px] text-axal-amber-deep dark:text-amber-300">⊘</span>
        <h3 className={H3}>{MASKED.title}</h3>
        <p className={`m-0 max-w-[60ch] ${SUB}`}>{MASKED.line}</p>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          {[['Company', p.name], ['Sector', p.sector], ['Stage', p.stage], ['Headline', p.headline]].map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="font-semibold text-axal-muted dark:text-gray-400">{k}</dt>
              <dd className="m-0 text-axal-ink dark:text-gray-100">{v || NOT_RECORDED}</dd>
            </React.Fragment>
          ))}
        </dl>
        <Link to={tabHref(dealId, 'documents')} className={BTN_S} data-testid={`${testId}-nda`}>{MASKED.act}</Link>
      </section>
    );
  }
  return children(s.data);
}

/** A block of an open read: its body, Not recorded with the reason, or Unreadable. */
function Block({ block, what, retry, testId, children }) {
  const b = blockOf(block);
  if (b.state === 'unreadable') return <div data-testid={`${testId}-unreadable`}><Unreadable what={what} claim="That is not the same as none." onRetry={retry} /></div>;
  if (b.state === 'not_recorded') return <Missing reason={b.reason} testId={`${testId}-missing`} />;
  return children(b.data);
}

/** A sibling canvas's slot (DL24), with its own state. */
function SlotFrame({ slot, testId, retry }) {
  if (slot.state === 'unreadable') {
    return <section className={`${CARD} p-4`} data-testid={testId}><span className={EYE}>{slot.eye}</span><Unreadable what={slot.title} claim="That is not the same as none." onRetry={retry} /></section>;
  }
  return <Slot slot={slot} testId={testId} />;
}

// ---------------------------------------------------------------- DL4 Team

function Person({ p }) {
  return (
    <Card testId={`deal-team-person-${p.key}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-full bg-axal-lavender font-mono text-[13px] font-bold text-axal-violet-deep dark:bg-violet-950 dark:text-violet-300">{p.initials}</span>
        <div className="min-w-0">
          <p className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{p.name}</p>
          <p className={`m-0 ${SUB}`}>{p.role} · {p.fullTime ? `Full time since ${p.fullTime}` : `Full time: ${p.fullTimeReason}`}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1 border-t border-axal-hairline pt-2 dark:border-gray-700">
        <span className={EYE}>Archetype</span>
        {p.archetype ? <Pill tone="src">◆ {p.archetype}</Pill> : <Pill tone="off">Not published</Pill>}
      </div>
      <div className="flex flex-col gap-1 border-t border-axal-hairline pt-2 dark:border-gray-700">
        <span className={EYE}>Prior roles · as published</span>
        {p.roles.state === 'recorded' && <ul className="m-0 list-none p-0 text-[12.5px] leading-[1.55] text-axal-ink dark:text-gray-100">{p.roles.rows.map((r) => <li key={r}>{r}</li>)}</ul>}
        {p.roles.state === 'not_published' && <Pill tone="off">Not published</Pill>}
        {p.roles.state === 'unreadable' && <p className="m-0 text-[12px] text-axal-destructive dark:text-red-300" role="alert">Their prior roles could not be read. That is not the same as none.</p>}
      </div>
      <div className="flex flex-col gap-1 border-t border-axal-hairline pt-2 dark:border-gray-700">
        <span className={EYE}>Founder-market fit</span>
        {p.fit ? <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100">{p.fit}</p> : <Missing reason={p.fitReason} />}
      </div>
    </Card>
  );
}

function Coverage({ block, retry }) {
  const v = coverageView(block);
  return (
    <Card title="Team coverage" testId="deal-team-coverage" className="md:col-span-2">
      <p className={`m-0 ${SUB}`}>{COVERAGE_NOTE}</p>
      {v.state === 'unreadable' && <Unreadable what="The team’s coverage" claim="That is not the same as none." onRetry={retry} />}
      {v.state === 'not_recorded' && <Missing reason={v.reason} />}
      {v.state === 'recorded' && (<>
        <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="deal-team-gaps">{v.summary}</p>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {v.axes.map((a) => (
            <li key={a.slug} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 text-[12.5px]" data-testid={`deal-team-axis-${a.slug}`}>
              <span className="font-semibold text-axal-ink dark:text-gray-100">{a.label}</span>
              {a.band ? <Pill tone={a.tone}>{a.word}</Pill> : <span className="flex flex-wrap items-center gap-2"><Pill tone="off">{NOT_RECORDED}</Pill><span className={SUB}>{a.reason}</span></span>}
            </li>
          ))}
        </ul>
      </>)}
    </Card>
  );
}

export function DealTeam({ deal }) {
  const [read, retry] = useInsight(dealInsightsApi.team, deal.id);
  return (
    <InsightFrame read={read} retry={retry} dealId={deal.id} what="The team" testId="deal-team">
      {(d) => (
        <div className="grid gap-3.5 md:grid-cols-3" data-testid="deal-team">
          <Block block={d.people} what="The team’s profiles" retry={retry} testId="deal-team-people">
            {(people) => (people.length
              ? people.map((raw) => { const p = personView(raw); return <Person key={p.key} p={p} />; })
              : <Card testId="deal-team-none"><p className={`m-0 ${SUB}`}>No one on this team has published a profile investors can see.</p></Card>)}
          </Block>
          {d.people?.publication_state === 'unreadable' && (
            <p role="alert" className="m-0 text-[12px] text-axal-destructive md:col-span-3 dark:text-red-300" data-testid="deal-team-publication">Some members’ publication choices could not be read, so they are not shown. That is not the same as none.</p>
          )}
          <Coverage block={d.coverage} retry={retry} />
          <div className="flex flex-col gap-3.5">
            <Card title="Co-founders’ values" testId="deal-team-values">
              {d.values_band?.value ? <Pill tone="done">{d.values_band.value}</Pill> : <Missing reason={d.values_band?.reason} />}
            </Card>
            <SlotFrame slot={slotOf(SLOTS.teamRow)} testId="deal-slot-team-row" />
            <Card title="Advisors on this company" testId="deal-team-advisors"><Missing reason={ADVISORS_LINE} /></Card>
          </div>
        </div>
      )}
    </InsightFrame>
  );
}

// ---------------------------------------------------------------- DL5 Market

export function DealMarket({ deal }) {
  const [read, retry] = useInsight(dealInsightsApi.market, deal.id);
  return (
    <InsightFrame read={read} retry={retry} dealId={deal.id} what="The market" testId="deal-market">
      {(d) => {
        const sizing = sizingView(d.sizing);
        return (
          <div className="grid gap-3.5 md:grid-cols-3" data-testid="deal-market">
            {sizing.state === 'recorded'
              ? sizing.tiles.map((t) => (
                <Card key={t.key} eye={t.label} testId={`deal-market-${t.key}`}>
                  {t.value ? <p className={BIG}>{t.value}</p> : <Missing reason={t.reason} />}
                  {t.value && (t.source ? <Pill tone="src">{t.source}</Pill> : <span className={SUB}>{t.reason}</span>)}
                </Card>
              ))
              : <Card title="Market size" testId="deal-market-sizing" className="md:col-span-3"><Block block={d.sizing} what="TAM, SAM and SOM" retry={retry} testId="deal-market-sizing">{() => null}</Block></Card>}
            <Card title="Who pays" testId="deal-market-who" className="md:col-span-1">
              <p className={`m-0 ${SUB}`}>Customer segments from Validate.</p>
              <Block block={d.who_pays} what="Who pays" retry={retry} testId="deal-market-who">
                {(rows) => (rows.length
                  ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{rows.map((r, i) => (
                    <li key={`${r.name}-${i}`} className="flex flex-col gap-0.5 border-t border-axal-hairline pt-2 dark:border-gray-700">
                      <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.name || NOT_RECORDED}</span>
                      {r.description && <span className={SUB}>{r.description}</span>}
                      {r.source && <Pill tone="src">From {r.source}</Pill>}
                    </li>))}</ul>
                  : <p className={`m-0 ${SUB}`}>The founder has not recorded who pays.</p>)}
              </Block>
            </Card>
            <Card title="Where" testId="deal-market-where">
              <Block block={d.company_markets} what="The company’s markets" retry={retry} testId="deal-market-where">
                {(rows) => (rows.length
                  ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{rows.map((m, i) => { const r = marketRow(m); return (
                    <li key={`${r.name}-${i}`} className="flex flex-col gap-0.5 border-t border-axal-hairline pt-2 dark:border-gray-700">
                      <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.name} · {r.where}</span>
                      {r.decided && <span className={SUB}>Decided {r.decided}</span>}
                    </li>); })}</ul>
                  : <p className={`m-0 ${SUB}`}>The founder has not recorded where the company sells.</p>)}
              </Block>
              <p className={`m-0 ${SUB}`} data-testid="deal-market-geography">{blockOf(d.geography).reason || 'Customer geography is not recorded.'}</p>
            </Card>
            <Card title="Market sources" testId="deal-market-sources">
              <Block block={d.sources} what="The market sources" retry={retry} testId="deal-market-sources">
                {(rows) => (rows.length
                  ? <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px]">{rows.map((s, i) => { const href = safeUrl(s.url); return (
                    <li key={`${s.title}-${i}`}>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-axal-violet-deep underline dark:text-violet-300">{s.title || href}</a> : <span className="font-semibold text-axal-ink dark:text-gray-100">{s.title || NOT_RECORDED}</span>}{s.kind ? <span className={SUB}> · {s.kind}</span> : null}</li>); })}</ul>
                  : <p className={`m-0 ${SUB}`}>No market sources are recorded.</p>)}
              </Block>
              <p className={`m-0 ${SUB}`}>A source here backs the market overall, never one figure above.</p>
            </Card>
            <Card title="Competitors" testId="deal-market-competitors" className="md:col-span-3">
              <Block block={d.competitors} what="The competitors" retry={retry} testId="deal-market-competitors">
                {(rows) => (rows.length
                  ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] border-collapse text-left text-[12.5px]">
                        <thead><tr className="text-axal-muted dark:text-gray-400">{['Name', 'Why it matters', 'Price', 'Depth'].map((c) => <th key={c} scope="col" className="border-b border-axal-hairline py-1.5 pr-3 font-bold dark:border-gray-700">{c}</th>)}</tr></thead>
                        <tbody>{rows.map((r, i) => (
                          <tr key={`${r.name}-${i}`} className="align-top text-axal-ink dark:text-gray-100">
                            <td className="border-b border-axal-hairline py-1.5 pr-3 font-bold dark:border-gray-700">{r.name || NOT_RECORDED}</td>
                            <td className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">{r.why_it_matters || NOT_RECORDED}</td>
                            <td className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">{r.price_position || NOT_RECORDED}</td>
                            <td className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">{r.depth_position || NOT_RECORDED}</td>
                          </tr>))}</tbody>
                      </table>
                    </div>
                  )
                  : <p className={`m-0 ${SUB}`}>The founder tracks no competitors.</p>)}
              </Block>
            </Card>
            <SlotFrame slot={slotOf(SLOTS.evidence, d.evidence)} testId="deal-slot-market-evidence" retry={retry} />
            <div className="md:col-span-2"><SlotFrame slot={slotOf(SLOTS.marketRows)} testId="deal-slot-market-rows" /></div>
          </div>
        );
      }}
    </InsightFrame>
  );
}

// ---------------------------------------------------------------- DL6 Traction

const W = 600, H = 200, L = 56, T = 16, B = 26, R = 12;

/** One figure across the months. A gap month is drawn as a gap, never at 0. */
function Chart({ chart, points }) {
  const shown = points.filter((p) => p.value != null);
  const summary = chartSummary(chart.title, points);
  const top = Math.max(1, ...shown.map((p) => p.value));
  const min = Math.min(0, ...shown.map((p) => p.value));
  const max = top * 1.1;
  const n = points.length || 12, step = (W - L - R) / n;
  const X = (i) => +(L + (i + 0.5) * step).toFixed(1);
  const Y = (v) => +(T + (H - T - B) * (1 - (v - min) / (max - min))).toFixed(1);
  const unit = shown[0]?.unit;
  const segments = [];
  let cur = [];
  points.forEach((p, i) => { if (p.value == null) { if (cur.length) segments.push(cur); cur = []; } else cur.push([X(i), Y(p.value)]); });
  if (cur.length) segments.push(cur);
  // A single gap between two reported months is bridged by a dashed line labelled Not reported.
  const bridges = points.map((p, i) => (p.value == null && points[i - 1]?.value != null && points[i + 1]?.value != null ? i : -1)).filter((i) => i > 0);
  return (
    <Card title={chart.title} testId={`deal-traction-chart-${chart.key}`} className={chart.key === 'mrr' ? 'md:col-span-2' : ''}>
      <p className={`m-0 ${SUB}`}>{summary.text}</p>
      {shown.length ? (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary.text} className="h-auto w-full text-axal-muted dark:text-gray-400">
          {[min, (min + top) / 2, top].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="stroke-axal-hairline dark:stroke-gray-700" />
              <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize="11" className="fill-axal-muted dark:fill-gray-400">{figureText(Math.round(v), unit)}</text>
            </g>))}
          {chart.kind === 'bar'
            ? points.map((p, i) => (p.value == null
              ? <text key={p.month} x={X(i)} y={Y(min) - 4} textAnchor="middle" fontSize="10" className="fill-axal-muted dark:fill-gray-400" data-gap={p.month}><title>{`${dateText(p.month)} · ${NOT_REPORTED}`}</title>–</text>
              : <rect key={p.month} x={X(i) - step * 0.29} y={Y(Math.max(p.value, 0))} width={step * 0.58} height={Math.abs(Y(p.value) - Y(0))} rx="2" className="fill-axal-violet dark:fill-violet-400"><title>{`${dateText(p.month)} · ${figureText(p.value, p.unit)}`}</title></rect>))
            : (<>
              {bridges.map((i) => (
                <g key={`gap-${i}`} data-gap={points[i].month}>
                  <path d={`M${X(i - 1)} ${Y(points[i - 1].value)}L${X(i + 1)} ${Y(points[i + 1].value)}`} fill="none" strokeWidth="1.3" strokeDasharray="4 3" className="stroke-axal-muted dark:stroke-gray-500"><title>{`${dateText(points[i].month)} · ${NOT_REPORTED}`}</title></path>
                  <text x={X(i)} y={(Y(points[i - 1].value) + Y(points[i + 1].value)) / 2 - 10} textAnchor="middle" fontSize="10" className="fill-axal-muted dark:fill-gray-400">{NOT_REPORTED}</text>
                </g>))}
              {segments.map((seg, k) => <path key={k} d={seg.map(([x, y], j) => `${j ? 'L' : 'M'}${x} ${y}`).join('')} fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="stroke-axal-violet dark:stroke-violet-400" />)}
              {points.map((p, i) => (p.value == null ? null : <circle key={p.month} cx={X(i)} cy={Y(p.value)} r="3.2" className="fill-axal-violet dark:fill-violet-400"><title>{`${dateText(p.month)} · ${figureText(p.value, p.unit)}`}</title></circle>))}
            </>)}
          {points.map((p, i) => (i % 3 === 0 || i === n - 1 ? <text key={`x-${p.month}`} x={X(i)} y={H - 8} textAnchor="middle" fontSize="11" className="fill-axal-muted dark:fill-gray-400">{dateText(p.month)?.slice(0, 3)}</text> : null))}
        </svg>
      ) : <Missing reason="Nothing shared in the last twelve months." />}
      <details className="text-[12.5px]">
        <summary className="cursor-pointer font-semibold text-axal-violet-deep dark:text-violet-300">View as table</summary>
        <table className="mt-2 w-full border-collapse text-left">
          <thead><tr className="text-axal-muted dark:text-gray-400"><th scope="col" className="py-1 pr-3">Month</th><th scope="col" className="py-1 pr-3">{chart.title.replace(' by month', '')}</th><th scope="col" className="py-1">Source</th></tr></thead>
          <tbody>{points.map((p) => (
            <tr key={p.month} className="text-axal-ink dark:text-gray-100" data-testid={`deal-traction-row-${chart.key}-${p.month}`}>
              <td className="py-1 pr-3">{dateText(p.month)}</td>
              <td className="py-1 pr-3 font-mono">{p.value == null ? NOT_REPORTED : figureText(p.value, p.unit)}</td>
              <td className="py-1">{p.value == null ? '' : (p.source || NOT_RECORDED)}</td>
            </tr>))}</tbody>
        </table>
      </details>
    </Card>
  );
}

export function DealTraction({ deal }) {
  const [read, retry] = useInsight(dealInsightsApi.traction, deal.id);
  return (
    <InsightFrame read={read} retry={retry} dealId={deal.id} what="The traction figures" testId="deal-traction">
      {(d) => {
        const v = tractionView(d);
        return (
          <div className="grid gap-3.5 md:grid-cols-4" data-testid="deal-traction">
            {v.state === 'unreadable' && <section className={`${CARD} p-4 md:col-span-4`} data-testid="deal-traction-history-unreadable"><Unreadable what="The shared figures" claim="That is not the same as none." onRetry={retry} /></section>}
            {v.state === 'recorded' && (<>
              <p className={`m-0 md:col-span-4 ${SUB}`} data-testid="deal-traction-reported">
                {v.reported ? `The founder shared figures for ${v.reported} of the last twelve months. A month not reported is a gap, never a zero.` : 'The founder has shared no figures with you in the last twelve months.'}
              </p>
              {v.tiles.map((t) => (
                <Card key={t.key} eye={t.label} testId={`deal-traction-tile-${t.key}`}>
                  {t.value ? <p className={BIG}>{t.value}</p> : <Missing reason={t.reason} />}
                  {t.value && t.source && <Pill tone="src">{t.source}</Pill>}
                  {t.value && t.asOf && <span className={SUB}>{t.asOf}</span>}
                </Card>
              ))}
              {TRACTION_CHARTS.map((c) => <Chart key={c.key} chart={c} points={v.series[c.key]} />)}
            </>)}
            <SlotFrame slot={slotOf(SLOTS.evidence, d.evidence)} testId="deal-slot-traction-evidence" retry={retry} />
            <div className="md:col-span-3"><SlotFrame slot={slotOf(SLOTS.tractionRows)} testId="deal-slot-traction-rows" /></div>
          </div>
        );
      }}
    </InsightFrame>
  );
}
