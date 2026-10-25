import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { partnerProfilesApi } from '../../../lib/api/partnerProfiles';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import { ChartTable, GroupedColumns, Legend, StackBars } from '../../../ui/Charts';
import AdminBoardFrame from '../AdminBoardFrame';
import { ProfileReviewModal } from '../consoles/PartnerProfilesConsole';
import {
  APPROVALS_PATH, CHANGED_WAITS, COUNTS_FAILED, IDENTITY_STATES, LIST_FAILED, LIST_FAILED_SUB, MOVED_NOTICES, NOT_GIVEN, NOT_RECORDED,
  PAGE_LINE, PAGE_SIZE, PP_TITLE, RAIL_NOTE, REVIEWED_WAITS, SORTS, SOURCES, STATUS_CHIPS, SUMMARY_CAP,
  categoryChart, failureRef, filtersSet, listParams, pageLabel, pagesOf, rowView, tabOf, tilesOf, weeklyAlt, weeklyChart,
} from './ppModel';

/**
 * D989 (#2380), D994 (#2805) — Partner profiles at /admin/partner-profiles,
 * built to the owner's canvas (PRF1–PRF12) under the shared admin page header
 * (D936). `/admin?tab=profiles` forwards here with the moved notice.
 *
 * TO REVIEW (PRF1): four tiles from the counts read, then the queue of
 * waiting profiles, oldest first: how long each has waited (amber from 72
 * hours), who it is, where it came from, the onboarding category, the
 * entity, the account and the identity check. Drafts are not in it.
 *
 * ALL PROFILES (PRF2): profiles captured per week, the onboarding
 * categories, the status chips (Drafts their own), and every profile with
 * search, filters, a sort and pages, all asked of D990's list read.
 *
 * WHAT IS NOT RECORDED SAYS SO (D994 §3): who reviewed a profile and when,
 * the changed-since-verified flag and each week's decisions wait for part 2.
 * The envelopes out for signature, and each row's, are D993's (part 4). The review is today's dialog
 * (`ProfileReviewModal`) until part 6; a failed record read says so in the
 * page, never in a browser pop-up.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} self-start border border-axal-violet bg-axal-violet text-white dark:border-violet-500 dark:bg-violet-600`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const SELECT = 'h-8 rounded-full border border-axal-hairline bg-white px-3 text-[12px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PILL = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold';
const OUTLINE = `${PILL} border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`;
const TRACK = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200`;
// The amber pills keep their fill in dark mode (PRF12).
const AMBER_FILL = 'border-[#fcd34d] bg-[#fcd34d] text-[#92400e]';
const STATUS_PILL = {
  pending: `${PILL} font-bold ${AMBER_FILL}`,
  draft: `${PILL} border-axal-hairline bg-transparent text-axal-muted dark:border-gray-700 dark:text-gray-400`,
  verified: `${PILL} font-bold border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300`,
  rejected: `${PILL} font-bold border-axal-destructive-edge bg-axal-destructive-tint text-axal-destructive dark:border-red-900 dark:bg-red-900/30 dark:text-red-300`,
  other: `${PILL} border-dashed border-axal-muted text-axal-muted dark:text-gray-400`,
};
const STATUS_GLYPH = { pending: '◷', draft: '✎', verified: '✓', rejected: '✕', other: '–' };
const ID_PILL = {
  quiet: `${PILL} border-axal-hairline bg-transparent text-axal-muted dark:border-gray-700 dark:text-gray-400`,
  amber: `${PILL} font-bold border-[#fcd34d] bg-[#fffbeb] text-[#92400e] dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200`,
  green: `${PILL} font-bold border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300`,
  red: `${PILL} font-bold border-axal-destructive-edge bg-axal-destructive-tint text-axal-destructive dark:border-red-900 dark:bg-red-900/30 dark:text-red-300`,
};

/** One read, again whenever `deps` change; its error is kept for the Details line. */
function useRead(fn, deps) {
  const [read, setRead] = useState({ status: 'loading', data: null, error: null });
  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data, error: null }));
    fn().then(
      (data) => { if (live) setRead({ status: 'ready', data, error: null }); },
      (e) => { reportError('partner-profiles:read', e); if (live) setRead({ status: 'error', data: null, error: e }); },
    );
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return read;
}

/**
 * The whole list, newest first, for the status chips, the All profiles tab
 * count and the categories chart: the first page's totals cover every
 * profile. Only the chart needs every row (`full`, on All profiles), so only
 * then does it page through the rest, up to SUMMARY_CAP rows.
 */
async function readSummary(full) {
  const first = await partnerProfilesApi.list({ sort: 'newest', page_size: 100 });
  const rows = [...(first.rows || [])];
  const total = first.totals?.total ?? rows.length;
  for (let page = 2; full && rows.length < Math.min(total, SUMMARY_CAP); page += 1) {
    const next = await partnerProfilesApi.list({ sort: 'newest', page_size: 100, page });
    if (!next.rows?.length) break;
    rows.push(...next.rows);
  }
  return { totals: first.totals, options: first.options, rows: rows.slice(0, SUMMARY_CAP), capped: total > SUMMARY_CAP };
}

function Bar({ w = '70%' }) {
  return <span className="block h-2.5 rounded-full bg-axal-hairline dark:bg-gray-700" style={{ width: w }} />;
}

function Failed({ testId, err, onRetry }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="alert" className={`${CARD} flex flex-col gap-2.5 px-[18px] py-4`} data-testid={testId}>
      <h2 className={H2}>{LIST_FAILED}</h2>
      <p className={`m-0 ${SUB}`}>{LIST_FAILED_SUB}</p>
      <button type="button" className={PRIMARY} onClick={onRetry}>Try again</button>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="self-start text-[12.5px] font-bold text-axal-violet dark:text-violet-300">Details {open ? '▴' : '▾'}</button>
      {open ? <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid={`${testId}-ref`}>{failureRef(err)}</span> : null}
    </div>
  );
}

function Tile({ id, label, view }) {
  let body;
  if (!view) body = <><span className="block h-6 w-[60%] rounded-[6px] bg-axal-hairline dark:bg-gray-700" /><span className={SUB}>Reading…</span></>;
  else if (view.kind === 'failed') body = <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400" title={view.reason || 'The counts could not be read.'}>{COUNTS_FAILED}</span>;
  else if (view.kind === 'not_recorded') body = <><span className="text-[13px] font-bold text-axal-muted dark:text-gray-400">{NOT_RECORDED}</span><span className={SUB}>{view.reason}</span></>;
  else {
    body = (
      <>
        <span className={`${MONO} text-[24px] font-bold tracking-[-.02em] ${view.amber ? 'text-[#92400e] dark:text-amber-300' : 'text-axal-ink dark:text-gray-100'}`}>{Number(view.value).toLocaleString('en-US')}</span>
        {view.sub ? <span className={SUB}>{view.sub}</span> : null}
      </>
    );
  }
  return (
    <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`pp-tile-${id}`}>
      <span className={EYE}>{label}</span>
      {body}
    </div>
  );
}

function Tiles({ tiles }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="pp-tiles">
      <Tile id="waiting" label="Waiting" view={tiles?.waiting} />
      <Tile id="past72" label="Past 72 hours" view={tiles?.past72} />
      <Tile id="verified30" label="Verified in 30 days" view={tiles?.verified30} />
      <Tile id="out" label="Agreements out for signature" view={tiles?.out} />
    </div>
  );
}

function StatusPill({ v }) {
  return <span className={STATUS_PILL[v.statusKey]}>{STATUS_GLYPH[v.statusKey]} {v.status}</span>;
}

function Person({ v }) {
  return (
    <>
      <span className="block font-bold text-axal-ink dark:text-gray-100">{v.name || v.email}</span>
      {v.name ? <span className={`block ${SUB}`}>{v.email}</span> : null}
    </>
  );
}

function Sources({ v }) {
  return <span className="flex flex-wrap gap-1">{v.sources.map((s) => <span key={s} className={OUTLINE}>{s}</span>)}</span>;
}

function Category({ v }) {
  if (!v.category) return <span className={SUB}>No category captured</span>;
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap gap-1">
        <span className={OUTLINE}>{v.category}</span>
        {v.track ? <span className={TRACK}>{v.track}</span> : null}
      </span>
      {v.incorporated ? <span className={SUB}>{v.incorporated}</span> : null}
    </span>
  );
}

function Entity({ v }) {
  if (!v.entity) return <span className={SUB}>{NOT_GIVEN}</span>;
  return <><span className="block font-semibold text-axal-ink dark:text-gray-100">{v.entity}</span>{v.entityType ? <span className={`block ${SUB}`}>{v.entityType}</span> : null}</>;
}

function Agreement({ v }) {
  if (v.agreement === 'Not sent') return <span className={SUB}>Not sent</span>;
  return (
    <>
      <span className="block font-semibold text-axal-ink dark:text-gray-100">{v.agreement}</span>
      {v.envelope ? <span className={`block ${v.envelopeAmber ? 'font-bold text-[#92400e] dark:text-amber-300' : SUB}`}>{v.envelope}</span> : null}
    </>
  );
}

function Account({ v }) {
  if (!v.account.has) return <span className={SUB}>{v.account.text}</span>;
  return <><span className={OUTLINE}>{v.account.text}</span>{v.account.sub ? <span className={`block ${SUB}`}>{v.account.sub}</span> : null}</>;
}

function Identity({ v }) {
  if (!v.identity.has) return <span className="text-axal-muted dark:text-gray-400" title={v.identity.tip}>—</span>;
  return <span className={ID_PILL[v.identity.tone]} title="Its case is in KYC & KYB.">{v.identity.text}</span>;
}

function Age({ v }) {
  return <span title={v.age.tip} className={`${PILL} ${MONO} text-[11.5px] font-bold ${v.age.over ? AMBER_FILL : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>{v.age.text}</span>;
}

function Pick({ label, value, options, onChange, testId, disabled = false, title }) {
  return (
    <label className="flex">
      <span className="sr-only">{label}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} className={SELECT} data-testid={testId} disabled={disabled} title={title}>
        <option value="">{`${label} ▾`}</option>
        {options.map((o) => <option key={o.key} value={o.key}>{`${label}: ${o.label}`}</option>)}
      </select>
    </label>
  );
}

const asOptions = (list) => (list || []).map((v) => ({ key: v, label: v }));
const withNone = (list) => [...asOptions(list), { key: 'not_recorded', label: NOT_RECORDED }];

function Skeleton() {
  return (
    <div className="flex flex-col gap-3 py-2" data-testid="pp-skeleton">
      <span className="font-mono text-[13px] text-axal-muted">Reading…</span>
      {['92%', '74%', '86%', '60%', '70%', '82%', '66%', '78%'].map((w, i) => <Bar key={i} w={w} />)}
    </div>
  );
}

function Pager({ list, page, setPage, testId }) {
  const total = list.data?.totals?.total ?? 0;
  const pages = pagesOf(PAGE_SIZE, total);
  return (
    <span className="flex items-center gap-2">
      <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid={testId}>{list.status === 'ready' ? pageLabel(page, PAGE_SIZE, total) : ''}</span>
      <button type="button" className={GHOST} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
      <button type="button" className={GHOST} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
    </span>
  );
}

function Search({ value, onChange }) {
  return (
    <label className="min-w-[220px] flex-1">
      <span className="sr-only">Search name, email or entity</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search name, email or entity"
        className="h-9 w-full max-w-[360px] rounded-[7px] border border-axal-hairline px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="pp-search" />
    </label>
  );
}

function Queue({ list, options, f, set, drafts, onReview, reload }) {
  const rows = list.data?.rows || [];
  const filtered = filtersSet('review', f) > 0 || String(f.q || '').trim().length >= 2;
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="pp-h-queue" data-testid="pp-queue">
      <h2 id="pp-h-queue" className={H2}>Waiting, oldest first</h2>
      <div className="flex flex-wrap items-center gap-2" data-testid="pp-queue-tools">
        <Search value={f.q} onChange={(q) => set({ q })} />
        <Pick label="Source" value={f.source} options={SOURCES} onChange={(source) => set({ source })} testId="pp-filter-source" />
        <Pick label="Onboarding category" value={f.category} options={withNone(options?.category)} onChange={(category) => set({ category })} testId="pp-filter-category" />
        <Pick label="Founder track" value={f.founder_track} options={withNone(options?.founder_track)} onChange={(founder_track) => set({ founder_track })} testId="pp-filter-track" />
        <Pick label="Sort" value={f.sort === 'waiting' ? '' : f.sort} options={SORTS.review.slice(1)} onChange={(sort) => set({ sort: sort || 'waiting' })} testId="pp-sort" />
        <Pager list={list} page={f.page} setPage={(page) => set({ page }, true)} testId="pp-queue-count" />
      </div>
      {String(f.q || '').trim().length === 1 && <span className={SUB}>Type at least two characters.</span>}
      {list.status === 'loading' && <Skeleton />}
      {list.status === 'error' && <Failed testId="pp-list-failed" err={list.error} onRetry={reload} />}
      {list.status === 'ready' && rows.length === 0 && (filtered
        ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pp-no-match">No waiting profile matches. Clear the search or the filters.</p>
        : (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center" data-testid="pp-queue-empty">
            <span aria-hidden="true" className="text-[22px] text-axal-positive">✓</span>
            <p className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Nothing waiting. Every profile has a decision.</p>
            <p className={`m-0 ${SUB}`}>New members&apos; profiles arrive here after their onboarding chat.</p>
            <Link to="/admin/partner-profiles/all" className={GHOST}>See all profiles</Link>
          </div>
        ))}
      {list.status === 'ready' && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className={EYE}>
                {['Waiting', 'Person', 'Source', 'Onboarding category', 'Entity', 'Account', 'Identity check'].map((t) => <th key={t} scope="col" className="py-1.5 pr-3 font-bold">{t}</th>)}
                <th scope="col" className="py-1.5 font-bold"><span className="sr-only">Review</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = rowView(r);
                return (
                  <tr key={v.ref || v.email} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid="pp-queue-row">
                    <td className="py-2 pr-3"><Age v={v} /></td>
                    <td className="py-2 pr-3"><Person v={v} /></td>
                    <td className="py-2 pr-3"><Sources v={v} /></td>
                    <td className="py-2 pr-3"><Category v={v} /></td>
                    <td className="py-2 pr-3"><Entity v={v} /></td>
                    <td className="py-2 pr-3"><Account v={v} /></td>
                    <td className="py-2 pr-3"><Identity v={v} /></td>
                    <td className="py-2 text-right"><button type="button" className={GHOST} onClick={() => onReview(r)}>Review</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <span className={SUB} data-testid="pp-drafts-note">
        {drafts == null
          ? 'Drafts are not in the queue: a profile Eadwyn opened with only a name has nothing to review yet.'
          : `Drafts are not in the queue: ${drafts.toLocaleString('en-US')} ${drafts === 1 ? 'profile has' : 'profiles have'} nothing to review yet.`}
        {' '}<Link to="/admin/partner-profiles/all?status=draft" className="font-bold text-axal-violet dark:text-violet-300">See them in All profiles</Link>. Opening this list is recorded.
      </span>
    </section>
  );
}

function ChartCard({ title, testId, table, alt, legend, note, foot, children, caption }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`${CARD} col-span-12 flex min-w-0 flex-col gap-2.5 px-[18px] py-4 lg:col-span-6`} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>{title}</h2>
        {table ? (
          <button type="button" aria-pressed={asTable} onClick={() => setAsTable((t) => !t)} className="text-[12px] font-bold text-axal-violet dark:text-violet-300" data-testid={`${testId}-toggle`}>
            {asTable ? 'View as chart' : 'View as table'}
          </button>
        ) : null}
      </div>
      {note ? <p className={`m-0 ${SUB}`}>{note}</p> : null}
      {legend}
      {table && asTable ? <ChartTable chart={table} caption={caption || title} /> : <div role="img" aria-label={alt} className="min-w-0">{children}</div>}
      {foot ? <p className={`m-0 ${SUB}`}>{foot}</p> : null}
    </section>
  );
}

function Weekly({ counts }) {
  if (counts.status === 'loading') return <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pp-weekly"><h2 className={H2}>Profiles captured and decided, per week</h2><Skeleton /></section>;
  const chart = counts.status === 'ready' ? weeklyChart(counts.data?.weekly) : null;
  if (!chart) {
    return (
      <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pp-weekly">
        <h2 className={H2}>Profiles captured and decided, per week</h2>
        <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">{COUNTS_FAILED}</span>
        <span className={SUB}>{counts.data?.weekly?.reason || 'The weekly counts could not be read. Nothing here is a zero.'}</span>
      </section>
    );
  }
  return (
    <ChartCard
      title="Profiles captured and decided, per week"
      testId="pp-weekly"
      table={chart}
      alt={weeklyAlt(chart)}
      note={`Profiles per week, by the Monday each week starts.${chart.decided ? '' : ` Verified and Rejected are not recorded: ${chart.reason || REVIEWED_WAITS}`}`}
      legend={<Legend items={[{ label: 'Captured', tone: 'violet' }, { label: 'Verified', tone: 'sky' }, { label: 'Rejected', tone: 'amber' }, ...(chart.decided ? [] : [{ label: 'Not recorded', tone: 'dash' }])]} />}
      foot={`This week is not finished, so its columns are hatched: ${chart.thisWeek.toLocaleString('en-US')} captured so far.`}
    >
      <GroupedColumns rows={chart.rows} series={chart.series} height={230} />
    </ChartCard>
  );
}

function Categories({ summary, onPick }) {
  if (summary.status === 'loading') return <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pp-categories"><h2 className={H2}>Onboarding categories</h2><Skeleton /></section>;
  if (summary.status === 'error') {
    return (
      <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pp-categories">
        <h2 className={H2}>Onboarding categories</h2>
        <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">{COUNTS_FAILED}</span>
      </section>
    );
  }
  const chart = categoryChart(summary.data.rows);
  return (
    <ChartCard
      title="Onboarding categories"
      testId="pp-categories"
      table={chart.rows.length ? chart : null}
      alt={chart.alt}
      legend={<Legend items={[{ label: 'Profiles', tone: 'violet' }, { label: 'Founder: Spin-Out', tone: 'violet' }, { label: 'Strategic Scale', tone: 'sky' }, { label: 'Track not given', tone: 'muted' }]} />}
      foot={summary.data.capped ? `The newest ${SUMMARY_CAP.toLocaleString('en-US')} profiles are counted. Clicking a bar filters the list below.` : 'Clicking a bar filters the list below.'}
    >
      {chart.rows.length === 0 ? <span className={SUB}>No profile has a category yet.</span> : <StackBars rows={chart.rows} onSelect={onPick} testIdPrefix={chart.testIdPrefix} />}
      {chart.none > 0 && <span className={`mt-1.5 block border-t border-dashed border-axal-hairline pt-1.5 dark:border-gray-700 ${SUB}`} data-testid="pp-no-category">No category captured: {chart.none.toLocaleString('en-US')}</span>}
    </ChartCard>
  );
}

function AllProfiles({ list, summary, counts, f, set, reset, onReview, reload }) {
  const totals = summary.data?.totals;
  const options = summary.data?.options || list.data?.options;
  const rows = list.data?.rows || [];
  const filtered = filtersSet('all', f) > 0 || String(f.q || '').trim().length >= 2 || (f.status && f.status !== 'all');
  const onPick = (row, part) => {
    if (row.category === 'Founder' && part.key !== 'profiles') {
      const track = { spinout: 'Spin-Out (New)', scale: 'Strategic Scale (Existing)', untracked: 'not_recorded' }[part.key];
      set({ category: 'Founder', founder_track: track });
    } else set({ category: row.category, founder_track: null });
  };
  return (
    <>
      <div className="grid grid-cols-12 gap-3.5">
        <Weekly counts={counts} />
        <Categories summary={summary} onPick={onPick} />
      </div>

      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="pp-h-all" data-testid="pp-all">
        <h2 id="pp-h-all" className={H2}>Every profile</h2>
        <div className="flex flex-wrap gap-[7px]" role="radiogroup" aria-label="Status" data-testid="pp-status-chips">
          {STATUS_CHIPS.map((c) => {
            const on = (f.status || 'all') === c.key;
            const n = totals ? totals[c.total] : null;
            return (
              <button key={c.key} type="button" role="radio" aria-checked={on} onClick={() => set({ status: c.key })}
                className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12px] ${on ? 'border-axal-lavender-edge bg-axal-lavender font-bold text-axal-violet-deep dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200' : 'border-axal-hairline font-semibold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800'}`}
                data-testid={`pp-chip-${c.key}`}>
                {c.label} · <span className={MONO}>{n == null ? '—' : n.toLocaleString('en-US')}</span>
              </button>
            );
          })}
        </div>
        {totals?.not_recorded > 0 && <span className={SUB} data-testid="pp-other-status">{totals.not_recorded.toLocaleString('en-US')} with a status the page does not know, shown as Not recorded under All.</span>}
        {f.status === 'draft' && <span className={SUB} data-testid="pp-drafts-chip-note">A Draft has nothing to review yet: Eadwyn opened it with only a name. It is not in the queue.</span>}
        <div className="flex flex-wrap items-center gap-2" data-testid="pp-all-tools">
          <Search value={f.q} onChange={(q) => set({ q })} />
          <Pick label="Source" value={f.source} options={SOURCES} onChange={(source) => set({ source })} testId="pp-filter-source" />
          <Pick label="Onboarding category" value={f.category} options={withNone(options?.category)} onChange={(category) => set({ category })} testId="pp-filter-category" />
          <Pick label="Founder track" value={f.founder_track} options={withNone(options?.founder_track)} onChange={(founder_track) => set({ founder_track })} testId="pp-filter-track" />
          <Pick label="Entity type" value={f.entity_type} options={withNone(options?.entity_type)} onChange={(entity_type) => set({ entity_type })} testId="pp-filter-entity" />
          <Pick label="Agreement" value={f.agreement} options={withNone(options?.agreement)} onChange={(agreement) => set({ agreement })} testId="pp-filter-agreement" />
          <Pick label="Has an account" value={f.has_account} options={[{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }]} onChange={(has_account) => set({ has_account })} testId="pp-filter-account" />
          <Pick label="Identity check" value={f.identity} options={IDENTITY_STATES} onChange={(identity) => set({ identity })} testId="pp-filter-identity" />
          <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
            Captured from
            <input type="date" value={f.captured_from || ''} onChange={(e) => set({ captured_from: e.target.value || null })} className={SELECT} data-testid="pp-filter-from" />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
            to
            <input type="date" value={f.captured_to || ''} onChange={(e) => set({ captured_to: e.target.value || null })} className={SELECT} data-testid="pp-filter-to" />
          </label>
          <Pick label="Reviewed by" value={null} options={[]} onChange={() => {}} testId="pp-filter-reviewed" disabled title={REVIEWED_WAITS} />
          <Pick label="Sort" value={f.sort === 'newest' ? '' : f.sort} options={SORTS.all.slice(1)} onChange={(sort) => set({ sort: sort || 'newest' })} testId="pp-sort" />
          {filtered ? <button type="button" className={GHOST} onClick={reset} data-testid="pp-clear">Clear filters</button> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={SUB}>{REVIEWED_WAITS} Until then the Reviewed column and the Reviewed by filter say Not recorded.</span>
          <Pager list={list} page={f.page} setPage={(page) => set({ page }, true)} testId="pp-count" />
        </div>
        {String(f.q || '').trim().length === 1 && <span className={SUB}>Type at least two characters.</span>}
        {list.status === 'loading' && <Skeleton />}
        {list.status === 'error' && <Failed testId="pp-list-failed" err={list.error} onRetry={reload} />}
        {list.status === 'ready' && rows.length === 0 && (
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pp-no-match">{filtered ? 'No profile matches. Clear the search or the filters.' : 'No partner profiles yet.'}</p>
        )}
        {list.status === 'ready' && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-left text-[12.5px]">
              <thead>
                <tr className={EYE}>
                  {['Person', 'Status', 'Source', 'Onboarding category', 'Entity', 'Agreement', 'Reviewed', 'Captured'].map((t) => <th key={t} scope="col" className="py-1.5 pr-3 font-bold">{t}</th>)}
                  <th scope="col" className="py-1.5 font-bold"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = rowView(r);
                  return (
                    <tr key={v.ref || v.email} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid="pp-all-row">
                      <td className="py-2 pr-3"><Person v={v} /></td>
                      <td className="py-2 pr-3"><StatusPill v={v} /></td>
                      <td className="py-2 pr-3"><Sources v={v} /></td>
                      <td className="py-2 pr-3"><Category v={v} /></td>
                      <td className="py-2 pr-3"><Entity v={v} /></td>
                      <td className="py-2 pr-3"><Agreement v={v} /></td>
                      <td className="py-2 pr-3 text-axal-muted dark:text-gray-400" title={REVIEWED_WAITS}>{v.statusKey === 'verified' || v.statusKey === 'rejected' ? NOT_RECORDED : '—'}</td>
                      <td className={`py-2 pr-3 ${MONO} whitespace-nowrap text-[11.5px] font-semibold text-axal-ink dark:text-gray-100`}>{v.captured}</td>
                      <td className="py-2 text-right"><button type="button" className={GHOST} onClick={() => onReview(r)}>Open</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <span className={SUB}>{CHANGED_WAITS} Opening this list is recorded.</span>
      </section>
    </>
  );
}

const BLANK = { q: '', sort: null, page: 1, status: 'all', source: null, category: null, founder_track: null, entity_type: null, agreement: null, has_account: null, identity: null, captured_from: null, captured_to: null };

function PartnerProfilesPage() {
  const loc = useLocation();
  const tab = tabOf(loc.pathname) || 'review';
  const notice = useMovedNotice(MOVED_NOTICES);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // Each tab keeps its own choices; All profiles opens on `?status=` (the queue's Drafts link).
  const [choices, setChoices] = useState(() => ({
    review: { ...BLANK },
    all: { ...BLANK, status: new URLSearchParams(loc.search).get('status') || 'all' },
  }));
  const f = choices[tab];
  // A change of filter, search or sort starts again at page 1; turning a page keeps the rest.
  const set = useCallback((patch, keepPage = false) => {
    setChoices((c) => ({ ...c, [tab]: { ...c[tab], ...patch, ...(keepPage ? {} : { page: 1 }) } }));
  }, [tab]);
  const reset = useCallback(() => setChoices((c) => ({ ...c, [tab]: { ...BLANK } })), [tab]);

  const params = useMemo(() => listParams(tab, f), [tab, f]);
  const key = JSON.stringify(params);
  const counts = useRead(() => partnerProfilesApi.counts(), [tick]);
  const summary = useRead(() => readSummary(tab === 'all'), [tick, tab === 'all']);
  const list = useRead(() => partnerProfilesApi.list(params), [key, tick]);
  const tiles = tilesOf(counts);
  const [asOf, setAsOf] = useState(null);
  useEffect(() => { if (counts.status === 'ready') setAsOf(Date.now()); }, [counts.status]);

  const [open, setOpen] = useState(null);
  const [openFailed, setOpenFailed] = useState(null);
  // The record read is the logged one (D612). A failure is said in the page.
  const onReview = useCallback(async (row) => {
    setOpenFailed(null);
    try {
      setOpen(await api.adminGetProfile(row.email));
    } catch (e) {
      reportError('partner-profiles:record', e);
      setOpenFailed(row);
    }
  }, []);

  const reviewCount = !tiles ? { kind: 'load' }
    : tiles.waiting.kind === 'num' ? { kind: 'num', value: tiles.waiting.value.toLocaleString('en-US') }
      : { kind: 'dash', tip: 'The waiting count could not be read.' };
  const allCount = summary.status === 'loading' ? { kind: 'load' }
    : summary.status === 'error' ? { kind: 'dash', tip: 'The profiles could not be read.' }
      : { kind: 'num', value: (summary.data.totals?.total ?? 0).toLocaleString('en-US') };
  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = (
    <>
      <HeaderTab to="/admin/partner-profiles" count={reviewCount} data-testid="pp-tab-review">To review</HeaderTab>
      <HeaderTab to="/admin/partner-profiles/all" count={allCount} data-testid="pp-tab-all">All profiles</HeaderTab>
    </>
  );
  const actions = (
    <>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pp-asof">
        {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
      </span>
      <button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400"><RefreshCw size={16} aria-hidden="true" /></button>
    </>
  );
  // PRF7b: a studio with no partner profile at all says so once, in place of the queue.
  const none = summary.status === 'ready' && (summary.data.totals?.total ?? 0) === 0;

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="partner-profiles">
      <AdminPageHeader
        crumb={{ label: 'Approvals', to: APPROVALS_PATH, current: PP_TITLE }}
        title={PP_TITLE}
        actions={actions}
        line={PAGE_LINE}
        scope
        notice={{ text: notice.text, onDismiss: notice.dismiss }}
        tabs={tabs}
        data-testid="pp-header"
      />
      <span className={SUB}>Reading this list, a profile and its tax ID are each recorded under your name.</span>
      {openFailed && (
        <div role="alert" className={`${CARD} flex flex-wrap items-center gap-2.5 px-[18px] py-3 text-[13px] text-axal-destructive dark:text-red-300`} data-testid="pp-record-failed">
          <span>This profile could not be read.</span>
          <button type="button" className={GHOST} onClick={() => onReview(openFailed)}>Try again</button>
          <button type="button" className={GHOST} onClick={() => setOpenFailed(null)}>Dismiss</button>
        </div>
      )}
      {tab === 'review' && <Tiles tiles={tiles} />}
      {tab === 'review' && none && (
        <div className={`${CARD} flex flex-col items-center gap-2 px-7 py-9 text-center`} data-testid="pp-none">
          <span aria-hidden="true" className="text-[22px] text-axal-muted">○</span>
          <p className="m-0 text-[16px] font-extrabold text-axal-ink dark:text-gray-100">No partner profiles yet.</p>
          <p className={`m-0 ${SUB}`}>A profile appears when a new member finishes the onboarding chat, or an invited partner answers their profile.</p>
        </div>
      )}
      {tab === 'review' && !none && <Queue list={list} options={summary.data?.options || list.data?.options} f={f} set={set} drafts={tiles?.drafts ?? null} onReview={onReview} reload={reload} />}
      {tab === 'all' && <AllProfiles list={list} summary={summary} counts={counts} f={f} set={set} reset={reset} onReview={onReview} reload={reload} />}
      {open && <ProfileReviewModal profile={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

/** The page inside its rail frame (D774), the frame the page's outermost element. The board is S7. */
export default function PartnerProfiles() {
  return (
    <AdminBoardFrame workspace="Entity profiles" note={RAIL_NOTE} data-testid="admin-board-partner-profiles">
      <PartnerProfilesPage />
    </AdminBoardFrame>
  );
}
