import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { adminLabApi } from '../../../lib/api/adminLab.js';
import { Chart, Legend } from '../../../ui/Charts.jsx';
import AdminCohortTiming from '../AdminCohortTiming';
import { Block, CalendarBlock, ViewSwitch } from './LabOverviewBlocks';
import { CARD, EYE, H2, INPUT, LINK, MONO, SUB, TD, TH, Pill, Select, useRead } from './labParts';
import { LIST_SORTS, buildApplicants, buildCohortList, buildCohortPage, buildTimeline, settingsOf } from './labOverviewModel';
import { DATES_FIXED } from './labModel';

/**
 * D947 (#2752) — the Cohorts tab. SL5 at `/cohorts`: the next twelve cohorts as
 * a calendar or a list, with Settings' minimum and places. SL6 at
 * `/cohorts/:ym`: one cohort's tiles, where its pool went, its capacity, its
 * weeks, its applicants, and the Lab's messages and history (not read here
 * yet). Grace and outcome overrides are still today's console
 * (`AdminCohortTiming`) until part 7 redraws them.
 *
 * Reads: the Lab overview (D944) and the cohort applications read (for
 * Settings); SL6 adds one page of the applications list for its cohort.
 */

const GHOST = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const WORD_TONE = { Running: 'violet', Finished: 'muted', 'Open for applications': 'green', 'In review': 'amber' };

function Settings({ apps }) {
  if (apps.status === 'loading') return <span className={SUB}>Reading Settings…</span>;
  const s = settingsOf(apps);
  return (
    <span className="self-start rounded-full border border-axal-hairline px-3 py-1 font-mono text-[12px] text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="lab-settings-chip">
      {s ? `Minimum ${s.min.toLocaleString('en-US')} · Places ${s.places.toLocaleString('en-US')}` : 'Minimum and places could not be read'}
    </span>
  );
}

/** SL5: the calendar, or the list. */
function CohortsHome({ overview, apps, reload, now }) {
  const [view, setView] = useState('calendar');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('starts');
  const tl = useMemo(() => buildTimeline(overview, now, 'twelve'), [overview, now]);
  const list = useMemo(() => buildCohortList(overview, { q, status, sort }, now), [overview, q, status, sort, now]);
  const toggle = <ViewSwitch table={view === 'list'} onChange={(t) => setView(t ? 'list' : 'calendar')} testId="lab-cohorts-view" />;
  return (
    <div className="flex flex-col gap-3.5" data-testid="lab-cohorts-home">
      <Settings apps={apps} />
      {view === 'calendar' ? (
        <CalendarBlock tl={tl} onRetry={reload} id="cohort-calendar" title="Next twelve cohorts" detail right={toggle}
          foot={`Applications open on the 1st of the month before and close 7 days before the start, at 23:59 ET. The cohort starts on the 1st at 00:00 ET. ${DATES_FIXED}`} />
      ) : (
        <Block id="cohort-list" title="Cohorts" block={list} onRetry={reload} wide right={<span className="flex items-center gap-2"><span className={SUB}>Calendar ⇄ List:</span>{toggle}</span>}
          foot="Every time is ET. Graduated counts founders whose incorporation is recorded.">
          {list.state === 'ready' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cohorts" aria-label="Search cohorts" className={INPUT} data-testid="lab-cohort-search" />
                <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'Status: all' }, ...list.statuses.map((s) => ({ value: s, label: s }))]} testId="lab-cohort-status" />
                <Select label="Sort" value={sort} onChange={setSort} options={Object.entries(LIST_SORTS).map(([value, label]) => ({ value, label: `Sort: ${label}` }))} testId="lab-cohort-sort" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] border-collapse">
                  <thead>
                    <tr>{['Cohort', 'Status', 'Opens', 'Closes', 'Starts', 'Week 4 deadline', 'Pool · applied · approved · waitlisted · waiting', 'Started', 'Graduated', ''].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {list.rows.map((r) => (
                      <tr key={r.key} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`lab-cohort-row-${r.key}`}>
                        <th scope="row" className={`${TD} font-bold`}>{r.label}</th>
                        <td className={TD}><Pill tone={WORD_TONE[r.word] || 'muted'}>{r.word}</Pill></td>
                        <td className={`${TD} ${MONO}`}>{r.opens}</td>
                        <td className={`${TD} ${MONO}`}>{r.closes}</td>
                        <td className={`${TD} ${MONO}`}>{r.starts}</td>
                        <td className={`${TD} ${MONO}`}>{r.week4}</td>
                        <td className={`${TD} ${MONO}`}>{r.pool}</td>
                        <td className={`${TD} ${MONO}`}>{r.started}</td>
                        <td className={`${TD} ${MONO}`}>{r.graduated}</td>
                        <td className={TD}><Link to={`/admin/programs/spinout-lab/cohorts/${r.key}`} className={LINK}>Open</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <span className={`${SUB} font-mono`}>{list.rows.length === list.total ? `${list.total} cohorts` : `${list.rows.length} of ${list.total} cohorts`}</span>
            </>
          )}
        </Block>
      )}
    </div>
  );
}

function Value({ t }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1.5 px-4 py-3.5`} data-testid={`lab-cohort-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      <span className={`font-mono text-[24px] font-medium tracking-[-.02em] ${t.kind === 'value' ? 'text-axal-ink dark:text-gray-100' : 'text-[15px] font-bold text-axal-muted dark:text-gray-400'}`}>{t.text}</span>
      {t.sub ? <span className={SUB}>{t.sub}</span> : null}
      {t.reason ? <span className={SUB}>{t.reason}</span> : null}
    </div>
  );
}

function NotRead({ id, title, text }) {
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid={`lab-cohort-${id}`}>
      <h2 className={H2}>{title}</h2>
      <span className="self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400">Not read here yet</span>
      <span className={SUB}>{text}</span>
    </section>
  );
}

/** SL6's applicants: one page of the D944 list read for this cohort, searched and paged on the Worker. */
function Applicants({ ym }) {
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  const read = useRead(`applicants:${ym}:${offset}:${q}`, tick, () => adminLabApi.applications({ cohort: ym, q: q || undefined, limit: 25, offset }));
  const block = buildApplicants(read);
  return (
    <Block id="cohort-applicants" title="Applicants" block={block} onRetry={() => setTick((t) => t + 1)} wide>
      {block.state === 'ready' && (
        <>
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search company or founder" aria-label="Search company or founder" className={`${INPUT} self-start`} data-testid="lab-applicants-search" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead><tr>{['Company', 'Founder', 'Status', 'Applied'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {block.rows.map((r) => (
                  <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-700">
                    <td className={`${TD} font-bold`}>{r.company}</td>
                    <td className={TD}>{r.founder}</td>
                    <td className={TD}>{r.status}</td>
                    <td className={`${TD} ${MONO}`}>{r.applied}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="lab-applicants-pager">
            <span className={`${SUB} font-mono`}>{block.total ? `${block.offset + 1}–${Math.min(block.offset + block.rows.length, block.total)} of ${block.total.toLocaleString('en-US')}` : 'None on this page'}</span>
            <span className="flex gap-2">
              <button type="button" className={GHOST} disabled={block.offset <= 0} onClick={() => setOffset(Math.max(0, block.offset - block.limit))}>Previous</button>
              <button type="button" className={GHOST} disabled={block.offset + block.limit >= block.total} onClick={() => setOffset(block.offset + block.limit)}>Next</button>
            </span>
          </div>
        </>
      )}
    </Block>
  );
}

/** SL6: one cohort. */
function CohortPage({ ym, overview, apps, reload, now }) {
  const page = useMemo(() => buildCohortPage(overview, apps, ym, now), [overview, apps, ym, now]);
  const [poolTable, setPoolTable] = useState(false);
  const back = <Link to="/admin/programs/spinout-lab/cohorts" className={LINK} data-testid="lab-cohort-back">‹ Cohorts</Link>;
  if (page.state === 'loading' || page.state === 'unreadable') {
    return <div className="flex flex-col gap-3.5">{back}<div className="grid grid-cols-12"><Block id="cohort-page" title="Cohort" block={page} onRetry={reload} wide /></div></div>;
  }
  if (page.state === 'missing') {
    return <div className="flex flex-col gap-3.5" data-testid="lab-cohort-missing">{back}<span className={SUB}>{page.text}</span></div>;
  }
  return (
    <div className="flex flex-col gap-3.5" data-testid="lab-cohort-page">
      {back}
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100" data-testid="lab-cohort-title">{page.title}</h2>
          <Pill tone={WORD_TONE[page.word] || 'muted'}>{page.word}</Pill>
        </span>
        {page.line ? <span className={`${SUB} font-mono`} data-testid="lab-cohort-line">{page.line}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="lab-cohort-tiles">
        {page.tiles.map((t) => <Value key={t.key} t={t} />)}
      </div>
      <div className="grid grid-cols-12 gap-3.5">
        <Block id="cohort-pool" title={page.pool.state === 'ready' ? `Pool · ${page.pool.applied.toLocaleString('en-US')}` : 'Pool'} block={page.pool} onRetry={reload}
          right={<ViewSwitch table={poolTable} onChange={setPoolTable} testId="lab-cohort-pool-view" />}>
          {page.pool.state === 'ready' && (
            <>
              <Legend items={page.pool.chart.parts.map((p) => ({ label: p.label, tone: p.tone }))} />
              {poolTable
                ? <table className="w-full border-collapse text-[12.5px]"><tbody>{page.pool.chart.rows[0].parts.map((p) => <tr key={p.key} className="border-t border-axal-hairline dark:border-gray-700"><th scope="row" className={TD}>{p.label}</th><td className={`${TD} ${MONO} text-right`}>{p.value.toLocaleString('en-US')}</td></tr>)}</tbody></table>
                : <div role="img" aria-label={page.pool.alt}><Chart chart={page.pool.chart} /></div>}
            </>
          )}
        </Block>
        <Block id="cohort-capacity" title="Capacity" block={page.capacity} onRetry={reload}>
          {page.capacity.state === 'ready' && (
            <>
              <span className={`${MONO} text-[13px] font-bold`}>{page.capacity.text}</span>
              <span className="flex flex-wrap items-center gap-2">
                <span className={`${MONO}`}>{page.capacity.approved}</span>
                {page.capacity.met === null ? null : <Pill tone={page.capacity.met ? 'green' : 'amber'} glyph={page.capacity.met ? '✓' : '!'}>{page.capacity.met ? `Minimum ${page.capacity.min} met` : `Minimum ${page.capacity.min} not met`}</Pill>}
              </span>
              <span className={SUB}>{page.capacity.check}</span>
            </>
          )}
        </Block>
        <Block id="cohort-weeks" title="Weeks" block={page.weeks} onRetry={reload} wide>
          {page.weeks.state === 'ready' && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead><tr>{['Week', 'Opens', 'Deadline', 'Passed', 'Failed', 'In grace', 'Waiting'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {page.weeks.rows.map((w) => (
                    <tr key={w.n} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`lab-cohort-week-${w.n}`}>
                      <th scope="row" className={`${TD} ${w.now ? 'font-extrabold text-axal-violet dark:text-violet-300' : 'font-bold'}`}>{w.label}</th>
                      <td className={`${TD} ${MONO}`}>{w.opens}</td>
                      <td className={`${TD} ${MONO}`}>{w.deadline}</td>
                      <td className={`${TD} ${MONO}`}>{w.passed}</td>
                      <td className={`${TD} ${MONO}`}>{w.failed}</td>
                      <td className={`${TD} ${MONO}`}>{w.grace}</td>
                      <td className={`${TD} ${MONO}`}>{w.waiting}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Block>
        <NotRead id="messages" title="Messages sent" text={page.messages.text} />
        <NotRead id="history" title="History" text={page.history.text} />
        <Applicants ym={ym} />
      </div>
      <section className="flex flex-col gap-2" data-testid="lab-cohort-grace">
        <h2 className={H2}>Grace and outcome overrides</h2>
        <span className={SUB}>Today’s tools, until the Lab’s part 7 redraws them for one cohort. They act on every cohort.</span>
        <AdminCohortTiming />
      </section>
    </div>
  );
}

/** The Cohorts tab: SL5, or SL6 when the address names a cohort. */
export default function LabCohorts({ ym }) {
  const [tick, setTick] = useState(0);
  const [now] = useState(() => Date.now());
  const overview = useRead('cohorts-overview', tick, () => adminLabApi.overview());
  const apps = useRead('cohorts-settings', tick, () => api.adminCohortApplications());
  const reload = () => setTick((t) => t + 1);
  return ym
    ? <CohortPage ym={ym} overview={overview} apps={apps} reload={reload} now={now} />
    : <CohortsHome overview={overview} apps={apps} reload={reload} now={now} />;
}
