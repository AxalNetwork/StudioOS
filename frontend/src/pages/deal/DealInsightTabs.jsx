/**
 * D1154 (#3059, part 6 of #2421) — the reading tabs: Team (DL4), Market (DL5)
 * and Traction (DL6), on D1151's reads. D6168 (#6168): each tab draws its
 * scopes' scorecard rows (`ScopeRows`, one scorecard read per tab), and Market
 * and Traction point to the Evidence tab. The words and the rules come from
 * `dealInsightsModel.js`; this file only draws them.
 *
 * Each tab reads its section once, and its scorecard rows once. A viewer with no NDA on file sees the company's basics
 * and the way to the NDA; a read that fails says Unreadable with Try again;
 * one block that fails leaves the rest of the tab standing. Nothing here
 * changes anything, so nothing opens a dialog.
 */
import React, { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable, actionGhost, actionPrimary } from '../../ui';
import { dd } from '../../lib/api';
import { caseForDeal } from './dealWorkModel';
import { dealInsightsApi } from '../../lib/api/dealInsights';
import { reportError } from '../../lib/log';
import { tabHref } from '../dealPageModel';
import { CARD, EYE, SUB, H3, BTN_S } from './DealFrame';
import { ScopeRows } from '../../components/scoring/scorecard/Scorecard';
import {
  ADVISORS_LINE, COMPETITOR_SORTS, COVERAGE_NOTE, EVIDENCE_LINK, MASKED, NOT_IN_UPDATE, NOT_RECORDED, NOT_REPORTED, NO_UPDATE, SCORECARD_ROWS, TEAM_WORDS, TRACTION_CHARTS,
  askDraft, blockOf, chartSummary, competitorsView, coverageView, dateText, figureText, insightState, marketRow, monthRows, monthsLine, peopleLine, personView, safeUrl, sizingView, tractionCsv, tractionSources, tractionView,
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

/** D6168: the tab's scopes as the Scorecard tab draws them, each opening its drawer there. */
const Rows = ({ dealId, view }) => <ScopeRows dealId={dealId} keys={SCORECARD_ROWS[view]} ndaHref={tabHref(dealId, 'documents')} testId={`deal-${view}-scorecard`} />;

/** D6168: what the founder shared is on the Evidence tab, one link away; nothing is read or counted here. */
function EvidenceLink({ dealId, testId }) {
  return (
    <Card eye="Evidence" title={EVIDENCE_LINK.title} testId={testId}>
      <p className={`m-0 ${SUB}`}>{EVIDENCE_LINK.line}</p>
      <Link to={tabHref(dealId, 'evidence')} className={`${BTN_S} w-fit`} data-testid={`${testId}-link`}>{EVIDENCE_LINK.act}</Link>
    </Card>
  );
}

// ---------------------------------------------------------------- DL4 Team

function Person({ p }) {
  return (
    <Card testId={`deal-team-person-${p.key}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-full bg-axal-lavender font-mono text-[13px] font-bold text-axal-violet-deep dark:bg-violet-950 dark:text-violet-300">{p.initials}</span>
        <div className="min-w-0">
          <p className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{p.name}</p>
          <p className={`m-0 ${SUB}`}>{p.role}</p>
        </div>
      </div>
      {/* D6164 part 2 (DE23): the archetype, or that none is published. */}
      {p.archetype ? <Pill tone="src">◆ {p.archetype}</Pill> : <Pill tone="off" testId={`deal-team-person-${p.key}-archetype`}>{TEAM_WORDS.noArchetype}</Pill>}
      <div className="flex flex-col gap-1 border-t border-axal-hairline pt-2 dark:border-gray-700">
        <span className={EYE}>Prior roles</span>
        {p.roles.state === 'recorded' && <ul className="m-0 list-none p-0 text-[12.5px] leading-[1.55] text-axal-ink dark:text-gray-100">{p.roles.rows.map((r) => <li key={r}>{r}</li>)}</ul>}
        {p.roles.state === 'not_published' && <Pill tone="off">{TEAM_WORDS.noRoles}</Pill>}
        {p.roles.state === 'unreadable' && <p className="m-0 text-[12px] text-axal-destructive dark:text-red-300" role="alert">Their prior roles could not be read. That is not the same as none.</p>}
      </div>
      <dl className="m-0 grid grid-cols-[minmax(0,118px)_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-axal-hairline pt-2 text-[12.5px] dark:border-gray-700">
        <dt className="font-semibold text-axal-muted dark:text-gray-400">Full-time since</dt>
        <dd className="m-0 text-axal-ink dark:text-gray-100" data-testid={`deal-team-person-${p.key}-fulltime`}>{p.fullTime || <Missing reason={p.fullTimeReason} />}</dd>
        <dt className="font-semibold text-axal-muted dark:text-gray-400">Founder–market fit</dt>
        <dd className="m-0 text-axal-ink dark:text-gray-100" data-testid={`deal-team-person-${p.key}-fit`}>{p.fit || <Missing reason={p.fitReason} />}</dd>
      </dl>
    </Card>
  );
}

function Coverage({ block, retry }) {
  const v = coverageView(block);
  return (
    <Card title={TEAM_WORDS.coverageTitle} testId="deal-team-coverage" className="md:col-span-2">
      <p className={`m-0 ${SUB}`}>{TEAM_WORDS.coverageLine} {COVERAGE_NOTE}</p>
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
          {/* D6164 part 2 (DE23): the scope's row heads the tab, as the canvas's scope head does. */}
          <div className="min-w-0 md:col-span-3"><Rows dealId={deal.id} view="team" /></div>
          {blockOf(d.people).state === 'recorded' && (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 md:col-span-3" data-testid="deal-team-people-head">
              <h3 className={H3}>{TEAM_WORDS.people}</h3>
              <span className={SUB}>{peopleLine(Array.isArray(d.people.data) ? d.people.data.length : 0)}</span>
            </div>
          )}
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
            <Card title={TEAM_WORDS.values} testId="deal-team-values">
              {d.values_band?.value ? <Pill tone="done">{d.values_band.value}</Pill> : <Missing reason={d.values_band?.reason} />}
            </Card>
            <Card title={TEAM_WORDS.advisors} testId="deal-team-advisors">
              <p className={`m-0 ${SUB}`}>{TEAM_WORDS.advisorsLine}</p>
              <Missing reason={ADVISORS_LINE} />
            </Card>
          </div>
          <Link to={tabHref(deal.id, 'diligence')} className={`${BTN_S} min-h-11 w-fit md:col-span-3`} data-testid="deal-team-next">{TEAM_WORDS.next}</Link>
        </div>
      )}
    </InsightFrame>
  );
}

// ---------------------------------------------------------------- DL5 Market

const count = (rows) => (Array.isArray(rows) ? rows.length : null);
const Count = ({ n, testId }) => (n == null ? null : <span className="font-mono text-[12px] font-bold text-axal-muted dark:text-gray-400" data-testid={testId}>{n}</span>);
const TITLE_ROW = 'flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1';

/** D6164 part 2 (DE24, DE30c): the competitors, searched and sorted in the browser; a card each on a phone. */
function Competitors({ rows }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const id = useId();
  const v = competitorsView(rows, { query, sort });
  const field = 'min-h-11 rounded-axal-sm border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 md:min-h-8';
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="deal-market-competitors-tools">
        <label htmlFor={`${id}-q`} className="sr-only">Search competitors</label>
        <input id={`${id}-q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="⌕ Search competitors" className={`${field} min-w-0 flex-1 sm:max-w-[260px]`} data-testid="deal-market-competitors-search" />
        <label htmlFor={`${id}-s`} className={SUB}>Sort</label>
        <select id={`${id}-s`} value={sort} onChange={(e) => setSort(e.target.value)} className={field} data-testid="deal-market-competitors-sort">
          {COMPETITOR_SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      {v.line && <p className={`m-0 ${SUB}`} aria-live="polite" data-testid="deal-market-competitors-matches">{v.line}</p>}
      {v.none
        ? <p className={`m-0 ${SUB}`} data-testid="deal-market-competitors-none">{v.none}</p>
        : (
          <>
          {/* D4815 part 15 (#5908, DE15): a card per competitor on a phone, never a table scrolled sideways. */}
          <ul className="m-0 flex list-none flex-col gap-2 p-0 md:hidden" data-testid="deal-market-competitor-cards">{v.shown.map((r, i) => (
            <li key={`${r.name}-${i}`} className="rounded-axal-sm border border-axal-hairline px-3 py-2.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:text-gray-100">
              <p className="m-0 text-[13.5px] font-bold">{r.name || NOT_RECORDED}</p>
              <p className="m-0 mt-0.5">{r.why_it_matters || NOT_RECORDED}</p>
              <dl className="m-0 mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                <dt className="text-axal-muted dark:text-gray-400">Price</dt><dd className="m-0">{r.price_position || NOT_RECORDED}</dd>
                <dt className="text-axal-muted dark:text-gray-400">Depth</dt><dd className="m-0">{r.depth_position || NOT_RECORDED}</dd>
              </dl>
            </li>))}</ul>
          <div className="hidden md:block">
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead><tr className="text-axal-muted dark:text-gray-400">{['Name', 'Why it matters', 'Price', 'Depth'].map((c) => <th key={c} scope="col" aria-sort={c === 'Name' ? (sort === 'name' ? 'ascending' : 'descending') : undefined} className="border-b border-axal-hairline py-1.5 pr-3 font-bold dark:border-gray-700">{c}</th>)}</tr></thead>
              <tbody>{v.shown.map((r, i) => (
                <tr key={`${r.name}-${i}`} className="align-top text-axal-ink dark:text-gray-100" data-testid="deal-market-competitor-row">
                  <td className="border-b border-axal-hairline py-1.5 pr-3 font-bold dark:border-gray-700">{r.name || NOT_RECORDED}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">{r.why_it_matters || NOT_RECORDED}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">{r.price_position || NOT_RECORDED}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">{r.depth_position || NOT_RECORDED}</td>
                </tr>))}</tbody>
            </table>
          </div>
          </>
        )}
    </>
  );
}

/** D6164 part 2 (DE24): each company market as a row with its four readings; a card each on a phone. */
function CompanyMarkets({ rows }) {
  const views = rows.map(marketRow);
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 md:hidden" data-testid="deal-market-where-cards">{views.map((r, i) => (
        <li key={`${r.name}-${i}`} className="flex flex-col gap-0.5 border-t border-axal-hairline pt-2 dark:border-gray-700">
          <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.name} · {r.where}</span>
          {r.decided && <span className={SUB}>Decided {r.decided}</span>}
          {/* D6171 (#6171): demand, regulation, partners and cost, each with its source or Not recorded. */}
          <span className={SUB} data-testid="deal-market-readiness">Readiness: {r.readinessText}</span>
        </li>))}</ul>
      <div className="hidden md:block">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead><tr className="text-axal-muted dark:text-gray-400">{['Market', 'State', 'Decided', 'Demand', 'Regulation', 'Partners', 'Cost'].map((c) => <th key={c} scope="col" className="border-b border-axal-hairline py-1.5 pr-3 font-bold dark:border-gray-700">{c}</th>)}</tr></thead>
          <tbody>{views.map((r, i) => (
            <tr key={`${r.name}-${i}`} className="align-top text-axal-ink dark:text-gray-100" data-testid="deal-market-where-row">
              <td className="border-b border-axal-hairline py-1.5 pr-3 font-bold dark:border-gray-700">{r.name}</td>
              <td className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">{r.where}</td>
              <td className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">{r.decided || '—'}</td>
              {r.readiness.map((part) => (
                <td key={part.key} className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">
                  {part.score == null
                    ? <Pill tone="off">{NOT_RECORDED}</Pill>
                    : <span className="flex flex-col"><b className="font-mono">{part.score}/10</b>{part.source && <span className={SUB}>{part.source}</span>}</span>}
                </td>))}
            </tr>))}</tbody>
        </table>
      </div>
    </>
  );
}

export function DealMarket({ deal }) {
  const [read, retry] = useInsight(dealInsightsApi.market, deal.id);
  return (
    <InsightFrame read={read} retry={retry} dealId={deal.id} what="The market" testId="deal-market">
      {(d) => {
        const sizing = sizingView(d.sizing);
        return (
          <div className="grid gap-3.5 md:grid-cols-3" data-testid="deal-market">
            {/* D6164 part 2 (DE24): the four scopes' rows head the tab. */}
            <div className="min-w-0 md:col-span-3"><Rows dealId={deal.id} view="market" /></div>
            {sizing.state === 'recorded'
              ? sizing.tiles.map((t) => (
                <Card key={t.key} eye={t.label} testId={`deal-market-${t.key}`}>
                  {t.value ? <p className={BIG}>{t.value}</p> : <Missing reason={t.reason} />}
                  {t.value && (t.source ? <Pill tone="src">{t.source}</Pill> : <span className={SUB}>{t.reason}</span>)}
                  {t.value && t.asOf && <span className={SUB}>{t.asOf}</span>}
                </Card>
              ))
              : <Card title="Market size" testId="deal-market-sizing" className="md:col-span-3"><Block block={d.sizing} what="TAM, SAM and SOM" retry={retry} testId="deal-market-sizing">{() => null}</Block></Card>}
            <Card testId="deal-market-who" className="md:col-span-1">
              <div className={TITLE_ROW}><h3 className={H3}>Who pays</h3>{count(blockOf(d.who_pays).data) != null && <span className={SUB} data-testid="deal-market-who-count">{`${count(d.who_pays.data)} ${count(d.who_pays.data) === 1 ? 'segment' : 'segments'}`}</span>}</div>
              <p className={`m-0 ${SUB}`}>Customer segments from Validate.</p>
              <Block block={d.who_pays} what="Who pays" retry={retry} testId="deal-market-who">
                {(rows) => (rows.length
                  ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{rows.map((r, i) => (
                    <li key={`${r.name}-${i}`} className="flex flex-col gap-0.5 border-t border-axal-hairline pt-2 dark:border-gray-700">
                      <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.name || NOT_RECORDED}</span>
                      {r.description && <span className={SUB}>{r.description}</span>}
                      {r.source ? <Pill tone="src">Source · {r.source}</Pill> : <Pill tone="off">{NOT_RECORDED}</Pill>}
                    </li>))}</ul>
                  : <p className={`m-0 ${SUB}`}>The founder has not recorded who pays.</p>)}
              </Block>
            </Card>
            <Card title="Company markets and readiness" testId="deal-market-where" className="md:col-span-3">
              <Block block={d.company_markets} what="The company’s markets" retry={retry} testId="deal-market-where">
                {(rows) => (rows.length
                  ? <CompanyMarkets rows={rows} />
                  : <p className={`m-0 ${SUB}`}>The founder has not recorded where the company sells.</p>)}
              </Block>
            </Card>
            <Card title="Customer geography and geographic risk" testId="deal-market-geo">
              <Missing reason={blockOf(d.geography).reason || 'Customer geography is not recorded.'} testId="deal-market-geography" />
            </Card>
            <Card testId="deal-market-sources">
              <div className={TITLE_ROW}><h3 className={H3}>Market sources</h3><Count n={count(blockOf(d.sources).data)} testId="deal-market-sources-count" /></div>
              <Block block={d.sources} what="The market sources" retry={retry} testId="deal-market-sources">
                {(rows) => (rows.length
                  ? <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px]">{rows.map((s, i) => { const href = safeUrl(s.url); return (
                    <li key={`${s.title}-${i}`}>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-axal-violet-deep underline dark:text-violet-300">{s.title || href}</a> : <span className="font-semibold text-axal-ink dark:text-gray-100">{s.title || NOT_RECORDED}</span>}{s.kind ? <span className={SUB}> · {s.kind}</span> : null}</li>); })}</ul>
                  : <p className={`m-0 ${SUB}`}>No market sources are recorded.</p>)}
              </Block>
              <p className={`m-0 ${SUB}`}>A source here backs the market overall, never one figure above.</p>
            </Card>
            <Card testId="deal-market-competitors" className="md:col-span-3">
              <div className={TITLE_ROW}><h3 className={H3}>Competitors</h3><Count n={count(blockOf(d.competitors).data)} testId="deal-market-competitors-count" /></div>
              <Block block={d.competitors} what="The competitors" retry={retry} testId="deal-market-competitors">
                {(rows) => (rows.length
                  ? <Competitors rows={rows} />
                  : <p className={`m-0 ${SUB}`}>The founder tracks no competitors.</p>)}
              </Block>
            </Card>
            <EvidenceLink dealId={deal.id} testId="deal-market-evidence" />
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
      <p className={`${SUB} break-words`} data-testid={`deal-traction-source-${chart.key}`}>{tractionSources(points).join('; ') || NOT_RECORDED}</p>
      <details className="text-[12.5px]">
        <summary className="cursor-pointer font-semibold text-axal-violet-deep dark:text-violet-300">View as table</summary>
        <table className="mt-2 w-full table-fixed border-collapse text-left">
          <thead><tr className="text-axal-muted dark:text-gray-400"><th scope="col" className="py-1 pr-3">Month</th><th scope="col" className="py-1 pr-3">{chart.title.replace(' by month', '')}</th><th scope="col" className="py-1">Source</th></tr></thead>
          <tbody>{points.map((p) => (
            <tr key={p.month} className="text-axal-ink dark:text-gray-100" data-testid={`deal-traction-row-${chart.key}-${p.month}`}>
              <td className="py-1 pr-3">{dateText(p.month)}</td>
              <td className="py-1 pr-3 font-mono">{p.value == null ? NOT_REPORTED : figureText(p.value, p.unit)}</td>
              <td className="break-words py-1 [overflow-wrap:anywhere]">{p.value == null ? '' : (p.source || NOT_RECORDED)}</td>
            </tr>))}</tbody>
        </table>
      </details>
    </Card>
  );
}

/**
 * D6187: Ask the founder for the months not reported, as a diligence request
 * on the deal's case. Only the case's owner or lead may send one (the Worker
 * says so too); with no case, the investor is pointed at Diligence to open one.
 */
export function AskFounder({ deal, userId, draft }) {
  const [list, setList] = useState({ status: 'loading' });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(draft);
  const [state, setState] = useState({ busy: false, err: '', sent: false });
  useEffect(() => {
    let live = true;
    dd.listCases({ subject_type: 'project', subject_id: deal.project_id })
      .then((data) => { if (live) setList({ status: 'ready', data }); })
      .catch((e) => { reportError('DealTraction:cases', e); if (live) setList({ status: 'unreadable' }); });
    return () => { live = false; };
  }, [deal.project_id]);
  const found = caseForDeal(list, deal.project_id);
  if (found.state === 'loading' || found.state === 'unreadable') return null;
  const diligence = tabHref(deal.id, 'diligence');
  if (found.state === 'none') {
    return (
      <p className={`m-0 md:col-span-4 ${SUB}`} data-testid="deal-traction-ask-nocase">
        Some months were not reported. To ask the founder for them, <Link to={diligence} className="font-semibold text-axal-violet-deep dark:text-violet-300">open a diligence case</Link> first.
      </p>
    );
  }
  const owns = [found.row.owner_user_id, found.row.lead_user_id].some((u) => u != null && Number(u) === Number(userId));
  if (!owns) return <p className={`m-0 md:col-span-4 ${SUB}`} data-testid="deal-traction-ask-notowner">Some months were not reported. Only the diligence case's owner can ask the founder for them.</p>;
  const send = async () => {
    if (!f.title.trim()) { setState({ busy: false, err: 'Give the request a title.', sent: false }); return; }
    setState({ busy: true, err: '', sent: false });
    try { await dd.createRequest(found.row.uid, { title: f.title.trim(), details: f.details.trim() || null }); setState({ busy: false, err: '', sent: true }); }
    catch (e) { setState({ busy: false, err: e?.message || 'The request was not sent. Try again.', sent: false }); }
  };
  return (
    <div className="md:col-span-4">
      <button type="button" className={BTN_S} onClick={() => { setF(draft); setState({ busy: false, err: '', sent: false }); setOpen(true); }} data-testid="deal-traction-ask">Ask the founder for an update</button>
      {open && (
        <Lightbox label="Ask the founder for an update" title="Ask the founder for an update" sub="A diligence request on this deal's case. The founder answers it from their requests." onClose={() => setOpen(false)} testId="deal-traction-ask-dialog"
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              {state.sent
                ? <button type="button" className={actionPrimary} onClick={() => setOpen(false)}>Done</button>
                : (<>
                  <button type="button" className={actionGhost} onClick={() => setOpen(false)}>Back</button>
                  <button type="button" className={actionPrimary} disabled={state.busy} onClick={send} data-testid="deal-traction-ask-send">{state.busy ? 'Sending…' : 'Send request'}</button>
                </>)}
            </div>
          )}>
          <div className="flex flex-col gap-3 px-5 py-4">
            {state.sent
              ? <p className="m-0 text-[13px]" data-testid="deal-traction-ask-sent">Sent. The request is on the <Link to={diligence} className="font-semibold text-axal-violet-deep dark:text-violet-300">Diligence</Link> tab, where you can remind or withdraw it.</p>
              : (<>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Title
                  <input value={f.title} maxLength={200} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" /></label>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">What you are asking for
                  <textarea rows={5} value={f.details} maxLength={4000} onChange={(e) => setF((x) => ({ ...x, details: e.target.value }))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" /></label>
                {state.err && <p className="m-0 text-sm text-red-700 dark:text-red-300" role="alert">{state.err}</p>}
              </>)}
          </div>
        </Lightbox>
      )}
    </div>
  );
}

/**
 * D6164 part 2 (DE25, DE30d): MRR, paying accounts and growth a month, newest
 * first, with the source. A month not reported says so and draws no figure; a
 * reported month without a figure says it was not in that update.
 */
function MonthTable({ view }) {
  const rows = monthRows(view);
  const cellOf = (v) => v ?? <span className={SUB}>{NOT_IN_UPDATE}</span>;
  const gap = <span className="inline-flex w-fit items-center rounded-axal-pill border border-dashed border-axal-muted px-2 py-0.5 text-[11.5px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">{NOT_REPORTED}</span>;
  return (
    <Card testId="deal-traction-months" className="md:col-span-4">
      <div className={TITLE_ROW}><h3 className={H3}>MRR, last 12 months</h3><span className={SUB}>From the monthly updates the founder shared with you.</span></div>
      <p className={`m-0 ${SUB}`} data-testid="deal-traction-months-line">{monthsLine(view)}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 md:hidden" data-testid="deal-traction-month-cards">{rows.map((r) => (
        <li key={r.month} className="flex min-h-11 flex-col gap-0.5 border-t border-axal-hairline pt-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:text-gray-100">
          <span className="font-bold">{r.label}</span>
          {r.reported
            ? (<>
              <span className="font-mono">{r.mrr ?? NOT_IN_UPDATE}</span>
              {r.source && <Pill tone="src">{r.source}</Pill>}
            </>)
            : <span className="flex flex-wrap items-center gap-2">{gap}<span className={SUB}>{NO_UPDATE}</span></span>}
        </li>))}</ul>
      <div className="hidden md:block">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead><tr className="text-axal-muted dark:text-gray-400">{['Month', 'MRR', 'Paying accounts', 'Growth', 'Source'].map((c) => <th key={c} scope="col" className="border-b border-axal-hairline py-1.5 pr-3 font-bold dark:border-gray-700">{c}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.month} className="align-top text-axal-ink dark:text-gray-100" data-testid={`deal-traction-month-${r.month}`}>
              <td className="border-b border-axal-hairline py-1.5 pr-3 font-bold dark:border-gray-700">{r.label}</td>
              {r.reported
                ? (<>
                  <td className="border-b border-axal-hairline py-1.5 pr-3 font-mono dark:border-gray-700">{cellOf(r.mrr)}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-3 font-mono dark:border-gray-700">{cellOf(r.customers)}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-3 font-mono dark:border-gray-700">{cellOf(r.growth)}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700">{r.source ? <Pill tone="src">{r.source}</Pill> : <span className={SUB}>{NOT_RECORDED}</span>}</td>
                </>)
                : <td colSpan={4} className="border-b border-axal-hairline py-1.5 pr-3 dark:border-gray-700"><span className="flex flex-wrap items-center gap-2">{gap}<span className={SUB}>{NO_UPDATE}</span></span></td>}
            </tr>))}</tbody>
        </table>
      </div>
    </Card>
  );
}

/** D6177: the browser downloads the already-read monthly figures, without another API request. */
function downloadTraction(view, dealId) {
  const url = URL.createObjectURL(new Blob([tractionCsv(view)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  const id = Number.isSafeInteger(Number(dealId)) && Number(dealId) > 0 ? String(Number(dealId)) : 'deal';
  try {
    link.href = url; link.download = `deal-${id}-traction.csv`;
    document.body.appendChild(link); link.click();
  } finally { link.remove(); URL.revokeObjectURL(url); }
}

export function DealTraction({ deal, userId }) {
  const [read, retry] = useInsight(dealInsightsApi.traction, deal.id);
  return (
    <InsightFrame read={read} retry={retry} dealId={deal.id} what="The traction figures" testId="deal-traction">
      {(d) => {
        const v = tractionView(d);
        if (v.state === 'recorded' && v.reported === 0) return (
          <section className={`${CARD} flex min-w-0 flex-col items-center gap-2.5 px-7 py-[34px] text-center`} data-testid="deal-traction-empty">
            <span aria-hidden="true" className="text-[26px] leading-none text-axal-muted dark:text-gray-400">○</span>
            <h3 className="m-0 text-base font-extrabold leading-[1.35] text-axal-ink dark:text-gray-100">No traction reported yet.</h3>
            <p className={`m-0 text-center ${SUB}`}>Figures appear once the founder reports them or connects a source.</p>
          </section>
        );
        return (
          <div className="grid gap-3.5 md:grid-cols-4" data-testid="deal-traction">
            {/* D6164 part 2 (DE25): Traction and Financial's rows head the tab. */}
            <div className="min-w-0 md:col-span-4"><Rows dealId={deal.id} view="traction" /></div>
            {v.state === 'unreadable' && <section className={`${CARD} p-4 md:col-span-4`} data-testid="deal-traction-history-unreadable"><Unreadable what="The shared figures" claim="That is not the same as none." onRetry={retry} /></section>}
            {v.state === 'recorded' && (<>
              <p className={`m-0 md:col-span-4 ${SUB}`} data-testid="deal-traction-reported">
                {v.reported ? `The founder shared figures for ${v.reported} of the last twelve months. A month not reported is a gap, never a zero.` : 'The founder has shared no figures with you in the last twelve months.'}
              </p>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 md:col-span-4">
                <p className={`m-0 ${SUB}`} data-testid="deal-traction-last-shared">Last shared: {dateText(v.lastShared) || NOT_RECORDED}</p>
                <button type="button" className={`${BTN_S} min-h-11`} onClick={() => downloadTraction(v, deal.id)} data-testid="deal-traction-csv">Download CSV</button>
              </div>
              {askDraft(v) && <AskFounder deal={deal} userId={userId} draft={askDraft(v)} />}
              {v.tiles.map((t) => (
                <Card key={t.key} eye={t.label} testId={`deal-traction-tile-${t.key}`}>
                  {t.value ? <p className={BIG}>{t.value}</p> : <Missing reason={t.reason} />}
                  {t.value && t.source && <Pill tone="src">{t.source}</Pill>}
                  {t.value && t.asOf && <span className={SUB}>{t.asOf}</span>}
                </Card>
              ))}
              <MonthTable view={v} />
              {TRACTION_CHARTS.map((c) => <Chart key={c.key} chart={c} points={v.series[c.key]} />)}
            </>)}
            <EvidenceLink dealId={deal.id} testId="deal-traction-evidence" />
          </div>
        );
      }}
    </InsightFrame>
  );
}
