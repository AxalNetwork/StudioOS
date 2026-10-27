import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { personaSegmentsApi } from '../../../lib/api/personaSegments';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import { Chart, ChartTable } from '../../../ui/Charts';
import AdminBoardFrame from '../AdminBoardFrame';
import { ActivityTab } from './SegmentPage';
import { AcceptedEdit, SuggestChangeDialog, SuggestionsList, UnclassifiedTab, useSegmentProfiles } from './SegmentWork';
import {
  ACCOUNTS_PATH, ADMIN_RAIL_NOTE, ALL_FAILED, ALL_FAILED_LINE, BLOCK_FAILED, CONTENT_PATH, NOT_PER_PROFILE, NOT_YET, OFFER_KINDS,
  PAGE_LINE, PROFILE_FILTERS, RAIL_NOTE, SCOPE_LINE, SEG_TITLE, STATUS_WORD,
  advisorsWithout, confidenceRead, failed, howSetRead, movedNotices, needsTable, overviewTiles, profileLine,
  segmentCardsRead, segmentsByProfileRead, subAccountChips, tabOf, weeklyRead,
} from './segModel';

/**
 * D997 (#2378) — Persona segments at /admin/persona-segments, built to the
 * owner's canvas (SEG1–SEG14) under the shared admin page header (D936). It
 * replaces the Admin Console's "Personas" tab: `/admin?tab=personas` forwards
 * here with the moved notice, before the console mounts.
 *
 * OVERVIEW (D1004, part 7) draws from the reads parts 2 and 3 added: D999's
 * segment counts over every account but admins (no Guard L), D1000's segment
 * profiles and its needs read. Each block answers alone: one that could not
 * be read says so with its own Try again, never as zeros. D1006 (part 9):
 * Unclassified reads D1002's members with no segment, with why and ask to
 * finish (`SegmentWork.jsx`); Activity is the page-wide read, with an
 * Admin's own suggestions; Suggestions is HQ's (Super Admin) to decide. Each card's name opens
 * that segment's own page (D1005, `SegmentPage.jsx`), where its members move
 * by SEG4's Move dialog; D1005 retired the re-tag table that stood at the
 * foot of Overview.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const TAG = 'self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const FILL = {
  violet: 'bg-axal-violet dark:bg-violet-400',
  sky: 'bg-sky-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  muted: 'bg-axal-muted',
};
const HOLLOW = 'border border-axal-muted bg-white dark:bg-gray-900';
const PILL = 'rounded-full border px-2 py-0.5 text-[11px] font-bold';
const STATUS_PILL = {
  active: `${PILL} border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`,
  draft: `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300`,
  retired: `${PILL} border-dashed border-axal-muted text-axal-muted dark:text-gray-400`,
};

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

function Tile({ id, label, children }) {
  return <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`seg-tile-${id}`}><span className={EYE}>{label}</span>{children}</div>;
}

/** One horizontal bar with its value label; `hollow` for a measured "No segment" or "Not answered". */
function Bar({ label, count, max, tone = 'violet', hollow = false }) {
  const w = max ? Math.max(2, (count / max) * 100) : 0;
  return (
    <li className="grid grid-cols-[170px_1fr_44px] items-center gap-2 text-[12px]">
      <span className="truncate text-axal-ink dark:text-gray-100">{label}</span>
      <span className="flex h-2.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
        {count > 0 && <span className={`rounded-full ${hollow ? HOLLOW : FILL[tone]}`} style={{ width: `${w}%` }} />}
      </span>
      <span className={`${MONO} text-right text-axal-ink dark:text-gray-100`}>{count.toLocaleString('en-US')}</span>
    </li>
  );
}

/** D1004: the three reads Overview draws from, each answering alone, once per visit and on Refresh. */
function useOverviewReads(tick) {
  const [seg, setSeg] = useState({ status: 'loading', data: null });
  const [profiles, setProfiles] = useState({ status: 'loading', data: null });
  const [coverage, setCoverage] = useState({ status: 'loading', data: null });
  const [own, setOwn] = useState({ seg: 0, profiles: 0, coverage: 0 });
  const one = (fn, set, scope) => {
    let live = true;
    set({ status: 'loading', data: null });
    fn().then(
      (data) => { if (live) set({ status: 'ready', data }); },
      (e) => { reportError(`persona-segments:${scope}`, e); if (live) set({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  };
  useEffect(() => one(() => personaSegmentsApi.read(), setSeg, 'segments'), [tick, own.seg]);
  useEffect(() => one(() => personaSegmentsApi.segmentProfiles(), setProfiles, 'profiles'), [tick, own.profiles]);
  useEffect(() => one(() => personaSegmentsApi.segmentCoverage(), setCoverage, 'coverage'), [tick, own.coverage]);
  const retry = useCallback((k) => setOwn((o) => ({ ...o, [k]: o[k] + 1 })), []);
  return { seg, profiles, coverage, retry };
}

/** One block whose read failed: the sentence and its own Try again (SEG12). */
function BlockFailed({ title, onRetry, id, span = '' }) {
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 ${span}`} data-testid={`seg-failed-${id}`}>
      {title ? <h2 className={H2}>{title}</h2> : null}
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <span aria-hidden="true" className="font-extrabold">!</span>
        <span className="flex-1">{BLOCK_FAILED}</span>
        <button type="button" className={GHOST} onClick={onRetry}>Try again</button>
      </div>
    </section>
  );
}

function Loading({ id, span = '' }) {
  return <div className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 ${span}`} data-testid={`seg-loading-${id}`}><span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</span><Skeleton /><Skeleton /></div>;
}

function Figure({ v, onRetry }) {
  if (v.failed) {
    return (
      <>
        <span className={`${MONO} text-[26px] font-medium text-axal-muted dark:text-gray-400`}>—</span>
        <span className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">{BLOCK_FAILED} <button type="button" className="underline" onClick={onRetry}>Try again</button></span>
      </>
    );
  }
  if (v.notPerProfile) return <><span className={`${MONO} text-[26px] font-medium text-axal-muted dark:text-gray-400`}>—</span><span className={SUB}>{NOT_PER_PROFILE}</span></>;
  return (
    <>
      <span className={`${MONO} text-[26px] font-medium text-axal-ink dark:text-gray-100`}>{Number(v.value).toLocaleString('en-US')}</span>
      {v.sub ? <span className={`${SUB} ${MONO}`}>{v.sub}</span> : null}
      {v.delta ? <span className={`${MONO} text-[12px] font-bold text-emerald-700 dark:text-emerald-400`}>{v.delta}</span> : null}
    </>
  );
}

function Chip({ on, onClick, children, disabled, title, role = 'radio', 'data-testid': id }) {
  const aria = role === 'radio' ? { role: 'radio', 'aria-checked': on } : { 'aria-pressed': on };
  return (
    <button type="button" {...aria} disabled={disabled} title={title} onClick={onClick} data-testid={id}
      className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-70 ${on ? 'border-axal-lavender-edge bg-axal-lavender text-axal-ink dark:border-violet-700 dark:bg-violet-900/40 dark:text-gray-100' : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`}>
      {children}
    </button>
  );
}

/** The profile filter, the sub-account chips and, for HQ, the scope (SEG1, SEG7). */
function Filters({ superAdmin, profile, setProfile, lpOn, setLpOn, seg }) {
  const sub = seg.status === 'ready' ? subAccountChips(seg.data) : null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="seg-filters">
      <div className="flex flex-wrap items-center gap-[7px]">
        {superAdmin && (
          <>
            <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
              <span>Scope</span>
              <select className="h-8 rounded-full border border-axal-hairline bg-white px-2.5 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" value="hq" disabled data-testid="seg-scope-select">
                <option value="hq">HQ-held accounts</option>
              </select>
            </label>
            <span aria-hidden="true" className="mx-1 h-[26px] w-px bg-axal-hairline dark:bg-gray-700" />
          </>
        )}
        <div role="radiogroup" aria-label="Profile" className="flex flex-wrap gap-[7px]" data-testid="seg-profile-filter">
          {PROFILE_FILTERS.map((f) => <Chip key={f.role} on={profile === f.role} onClick={() => setProfile(f.role)} data-testid={`seg-filter-${f.role}`}>{f.label}</Chip>)}
        </div>
        <span aria-hidden="true" className="mx-1 h-[26px] w-px bg-axal-hairline dark:bg-gray-700" />
        <div className="flex flex-wrap gap-[7px]" data-testid="seg-sub-accounts">
          {!sub ? <span className={SUB}>{seg.status === 'loading' ? 'Reading…' : 'Sub-accounts could not be read.'}</span> : sub.failed
            ? <span className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">Sub-accounts could not be read.</span>
            : (
              <>
                <Chip role="toggle" on={lpOn} onClick={() => setLpOn(!lpOn)} title={sub.lp.definition} data-testid="seg-chip-lp">LPs <span className={MONO}>{sub.lp.total.toLocaleString('en-US')}</span></Chip>
                {sub.productTester.recorded === false
                  ? <Chip role="toggle" on={false} disabled title={sub.productTester.reason} data-testid="seg-chip-testers">Product testers · Not recorded</Chip>
                  : null}
              </>
            )}
        </div>
      </div>
      {superAdmin && <span className={SUB} data-testid="seg-scope-line">{SCOPE_LINE} The scope across studios arrives with D997 part 6.</span>}
      {sub && !sub.failed && sub.productTester.recorded === false && <span className={SUB}>Product testers: Not recorded. {sub.productTester.reason}</span>}
      {lpOn && sub && !sub.failed && <span className={SUB} data-testid="seg-lp-line">{sub.lp.definition} {sub.lp.noSegment.toLocaleString('en-US')} have no segment.</span>}
    </div>
  );
}

function WeeklyBlock({ seg, onRetry }) {
  const [table, setTable] = useState(false);
  const w = useMemo(() => (seg.status === 'ready' ? weeklyRead(seg.data) : null), [seg]);
  if (seg.status === 'loading') return <Loading id="weekly" span="lg:col-span-6" />;
  if (!w || w.failed) return <BlockFailed id="weekly" title="New segment tags per week" onRetry={onRetry} span="lg:col-span-6" />;
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-2.5 px-[18px] py-4 lg:col-span-6`} aria-labelledby="seg-h-weekly" data-testid="seg-weekly">
      <div className="flex items-start justify-between gap-2">
        <h2 id="seg-h-weekly" className={H2}>New segment tags per week</h2>
        <button type="button" className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" onClick={() => setTable(!table)}>{table ? 'View as chart' : 'View as table'}</button>
      </div>
      <span className={SUB} data-testid="seg-weekly-summary">{w.summary}</span>
      {table ? <ChartTable chart={w.chart} caption="New segment tags per week" />
        : <div role="img" aria-label={w.alt}><Chart chart={w.chart} /></div>}
      <span className={SUB}>Weeks start on Monday, UTC. The current week is hollow and still open; a gap is a week before any segment was dated.</span>
      {w.undated > 0 && <span className={SUB}>{w.undated.toLocaleString('en-US')} segments carry no date and are not in the chart.</span>}
    </section>
  );
}

function SegmentCard({ c, lpOn }) {
  const n = c.needs;
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline bg-white px-3.5 py-3 dark:border-gray-700 dark:bg-gray-900" data-testid={`seg-card-${c.key}`}>
      <Link to={`/admin/persona-segments/${c.key}`} className="text-[13.5px] font-extrabold text-axal-ink underline-offset-2 hover:underline dark:text-gray-100" data-testid={`seg-card-open-${c.key}`}>{c.name}</Link>
      {c.who ? <span className={SUB}>{c.who}</span> : null}
      <div className="flex items-baseline gap-2 border-t border-axal-hairline pt-2 dark:border-gray-700">
        {c.members === null
          ? <span className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">Members could not be read.</span>
          : <span className={`${MONO} text-[17px] font-bold text-axal-ink dark:text-gray-100`}>{c.members.toLocaleString('en-US')} members</span>}
        {c.new30 ? <span className={`${MONO} text-[12px] font-bold text-emerald-700 dark:text-emerald-400`}>+{c.new30.toLocaleString('en-US')} in 30 days</span> : null}
      </div>
      {lpOn && c.lp !== null && <span className={`${SUB} ${MONO}`} data-testid={`seg-card-lp-${c.key}`}>{c.lp.toLocaleString('en-US')} with an LP sub-account</span>}
      {n.failed ? <span className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">Needs could not be read.</span> : n.recorded ? (
        <>
          <span className="text-[12.5px] font-medium leading-[1.45] text-axal-ink dark:text-gray-100">Top need: {n.top}</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${MONO} text-[12px] font-semibold text-axal-ink dark:text-gray-100`}>{n.met === null || n.met === undefined ? `Needs met: unknown of ${n.total}` : `Needs met ${n.met} of ${n.total}`}</span>
            {n.gaps > 0 && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">{n.gaps} {n.gaps === 1 ? 'gap' : 'gaps'}</span>}
            <span className={STATUS_PILL[c.status] || STATUS_PILL.active}>{STATUS_WORD[c.status] || c.status}</span>
          </div>
        </>
      ) : (
        <>
          <span className="text-[12.5px] text-axal-muted dark:text-gray-400">Top need: Not recorded</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`}>Needs met: Not recorded</span>
            <span className={STATUS_PILL[c.status] || STATUS_PILL.active}>{STATUS_WORD[c.status] || c.status}</span>
          </div>
          <span className={SUB}>{n.reason}</span>
        </>
      )}
    </div>
  );
}

function CardsBlock({ seg, profiles, coverage, profile, lpOn, superAdmin, onRetry }) {
  if (profiles.status === 'loading') return <Loading id="cards" />;
  if (profiles.status === 'error') return <BlockFailed id="cards" title="Your segments" onRetry={onRetry} />;
  const read = segmentCardsRead({
    seg: seg.status === 'ready' ? seg.data : null,
    profiles: profiles.data,
    coverage: coverage.status === 'ready' ? coverage.data : { failed: true },
  }, profile);
  const advisorsNone = seg.status === 'ready' ? advisorsWithout(seg.data) : null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="seg-h-cards" data-testid="seg-cards">
      <div>
        <h2 id="seg-h-cards" className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">Your segments</h2>
        <span className={SUB}>Grouped by each segment&apos;s profile, as HQ wrote it.</span>
      </div>
      {read.groups.map((g) => (
        <div key={g.role} className="flex flex-col gap-2" data-testid={`seg-card-group-${g.role}`}>
          <span className="flex items-center gap-2 text-[14px] font-extrabold text-axal-ink dark:text-gray-100"><span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${FILL[g.tone]}`} />{g.label}</span>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {g.role === 'advisor' && g.cards.length === 0 && (
              <div className="flex flex-col gap-1 rounded-[12px] border border-dashed border-axal-muted px-3.5 py-3" data-testid="seg-card-advisors-none">
                <span className={EYE}>Advisors</span>
                <span className="text-[13.5px] font-extrabold text-axal-ink dark:text-gray-100">No segment for Advisors yet.</span>
                <span className={SUB}>{superAdmin ? '' : 'HQ is defining them. '}{advisorsNone === null ? 'How many advisors have none could not be read.' : `${advisorsNone.toLocaleString('en-US')} advisors have none.`}</span>
              </div>
            )}
            {g.cards.map((c) => <SegmentCard key={c.key} c={c} lpOn={lpOn} />)}
            {g.role !== 'advisor' && g.cards.length === 0 && <span className={SUB}>No segment for {g.label.toLowerCase()}.</span>}
          </div>
        </div>
      ))}
    </section>
  );
}

function NeedsBlock({ coverage, profile, onRetry }) {
  const [q, setQ] = useState('');
  if (coverage.status === 'loading') return <Loading id="needs" />;
  if (coverage.status === 'error') return <BlockFailed id="needs" title="Needs and offers" onRetry={onRetry} />;
  const t = needsTable(coverage.data, { profile, q });
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="seg-h-needs" data-testid="seg-needs">
      <h2 id="seg-h-needs" className={H2}>Needs and offers</h2>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex-1">
          <span className="sr-only">Search a segment</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a segment"
            className="h-9 w-full max-w-[320px] rounded-[7px] border border-axal-hairline px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="seg-needs-search" />
        </label>
        <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="seg-needs-count">Gaps first · {t.rows.length} of {t.total}</span>
      </div>
      {t.rows.length === 0 ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">No segment matches. Clear the search or pick All.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className={EYE}>
                <th scope="col" className="py-1.5 pr-3 font-bold">Segment</th>
                {OFFER_KINDS.map((k) => <th key={k.key} scope="col" className="py-1.5 pr-3 font-bold">{k.label}</th>)}
                <th scope="col" className="py-1.5 pr-3 font-bold">Needs met</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.key} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid="seg-needs-row">
                  <td className="py-2 pr-3"><span className="block font-bold text-axal-ink dark:text-gray-100">{r.name}</span><span className={`block ${SUB}`}>{profileLine(r.profile, r.status)}</span></td>
                  {r.cells.map((c) => (
                    <td key={c.kind} className="py-2 pr-3">
                      {c.gap ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">{c.text}</span>
                        : c.unreadable ? <span className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">{c.text}</span>
                          : <span className={`${MONO} ${c.count ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{c.text}</span>}
                    </td>
                  ))}
                  <td className={`py-2 pr-3 ${MONO} ${r.needs.recorded ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{r.needs.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className={SUB}>A number counts offers of that kind. Gap: a need asks for that kind and nothing answers it. A dash: none is offered and no need asks for it. A segment whose needs HQ has not written reads Not recorded.</span>
    </section>
  );
}

function Overview({ superAdmin, tick }) {
  const { seg, profiles, coverage, retry } = useOverviewReads(tick);
  const [profile, setProfile] = useState('all');
  const [lpOn, setLpOn] = useState(false);
  const data = seg.status === 'ready' ? seg.data : null;
  const t = useMemo(() => overviewTiles(data, profile), [data, profile]);
  const by = useMemo(() => segmentsByProfileRead(data, profile), [data, profile]);
  const set = useMemo(() => howSetRead(data), [data]);
  const bands = useMemo(() => confidenceRead(data), [data]);

  // SEG12f: nothing could be read at all.
  if (seg.status === 'error' && profiles.status === 'error' && coverage.status === 'error') {
    return (
      <div role="alert" className={`${CARD} mx-auto mt-10 flex w-full max-w-[560px] flex-col items-center gap-2 px-7 py-8 text-center`} data-testid="seg-all-failed">
        <span aria-hidden="true" className="text-[22px] font-extrabold text-amber-700 dark:text-amber-300">!</span>
        <span className="text-[16px] font-extrabold text-axal-ink dark:text-gray-100">{ALL_FAILED}</span>
        <span className={SUB}>{ALL_FAILED_LINE}</span>
        <button type="button" className={GHOST} onClick={() => { retry('seg'); retry('profiles'); retry('coverage'); }}>Try again</button>
      </div>
    );
  }
  const loading = seg.status === 'loading';
  const tileOf = (v) => (loading ? <span className={SUB}>Reading…</span> : <Figure v={v} onRetry={() => retry('seg')} />);
  const empty = data && !failed(data.members) && data.members.in_segment === 0;
  const setMax = set.failed ? 1 : Math.max(1, ...set.rows.map((r) => r.count));
  const bandMax = bands.failed ? 1 : Math.max(1, ...bands.counts.map((b) => b.count));
  const groupMax = Math.max(1, ...by.groups.flatMap((g) => [g.none, ...g.bars.map((b) => b.count)]));

  return (
    <>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="seg-tiles">
        <Tile id="tagged" label="In a segment">{tileOf(t.tagged)}</Tile>
        <Tile id="untagged" label="No segment">
          {tileOf(t.untagged)}
          {!loading && !t.untagged.failed && <Link to="/admin/persona-segments/unclassified" className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300">Open Unclassified ›</Link>}
        </Tile>
        <Tile id="differ" label="Segment and profile differ">{tileOf(t.differ)}</Tile>
        <Tile id="moved30" label="Moved by an admin, 30 days">{tileOf(t.moved)}</Tile>
      </div>
      <span className={SUB}>Counted over every account but admins. Deactivated accounts are counted apart.</span>

      <Filters superAdmin={superAdmin} profile={profile} setProfile={setProfile} lpOn={lpOn} setLpOn={setLpOn} seg={seg} />

      {superAdmin && (
        <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} data-testid="seg-suggestions-inset">
          <span className={EYE}>Suggestions</span>
          <h2 className={H2}>Waiting for HQ</h2>
          <span className={TAG}>{NOT_YET}</span>
          <span className={SUB}>An Admin&apos;s suggestions, and accepting or declining them, arrive with D997 part 6 (#2818).</span>
        </section>
      )}

      {empty && profile === 'all' ? (
        <section className={`${CARD} flex flex-col items-center gap-2 px-7 py-8 text-center`} data-testid="seg-empty">
          <span aria-hidden="true" className="text-[20px] text-axal-muted">○</span>
          <span className="text-[15px] font-extrabold text-axal-ink dark:text-gray-100">No member has a segment yet.</span>
          <span className={SUB}>Members get one when they finish the sign-up chat, or when you place them.</span>
          <Link to="/admin/persona-segments/unclassified" className={GHOST}>Open Unclassified</Link>
        </section>
      ) : (
        <div className="grid grid-cols-12 gap-3.5">
          {loading ? <Loading id="by-profile" span="lg:col-span-8" /> : by.failed ? <BlockFailed id="by-profile" title="Segments by profile" onRetry={() => retry('seg')} span="lg:col-span-8" /> : (
            <section className={`${CARD} col-span-12 flex flex-col gap-3 px-[18px] py-4 lg:col-span-8`} aria-labelledby="seg-h-by-profile" data-testid="seg-by-profile">
              <h2 id="seg-h-by-profile" className={H2}>Segments by profile</h2>
              <span className={SUB}>By each member&apos;s account profile. A hollow bar is members of that profile with no segment.</span>
              {by.groups.map((g) => (
                <div key={g.role || 'other'} className="flex flex-col gap-1.5" data-testid={`seg-group-${g.role || 'other'}`}>
                  <span className={EYE}>{g.label} · {g.total.toLocaleString('en-US')}</span>
                  {g.total === 0 ? <span className={SUB}>No {g.label.toLowerCase()} yet.</span> : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {g.bars.map((b) => <Bar key={b.id} label={b.label} count={b.count} max={groupMax} tone={g.tone} />)}
                      <Bar label="No segment" count={g.none} max={groupMax} hollow />
                    </ul>
                  )}
                  {g.role === 'advisor' && g.bars.length === 0 && g.total > 0 && <span className={SUB}>No segment for Advisors yet. {g.none.toLocaleString('en-US')} advisors have none.</span>}
                </div>
              ))}
            </section>
          )}
          {loading ? <Loading id="how-set" span="lg:col-span-4" /> : set.failed ? <BlockFailed id="how-set" title="How segments were set" onRetry={() => retry('seg')} span="lg:col-span-4" /> : (
            <section className={`${CARD} col-span-12 flex flex-col gap-2.5 px-[18px] py-4 lg:col-span-4`} aria-labelledby="seg-h-set" data-testid="seg-how-set">
              <h2 id="seg-h-set" className={H2}>How segments were set</h2>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">{set.rows.map((r) => <Bar key={r.key} label={r.label} count={r.count} max={setMax} />)}</ul>
              {set.other > 0 && <span className={SUB} data-testid="seg-how-set-other">Not recorded for {set.other}: the source stored is not one of the three.</span>}
              {profile !== 'all' && <span className={SUB}>{NOT_PER_PROFILE}</span>}
              <span className={SUB}>Suggested at sign-up: the sign-up chat suggested it and the member accepted.</span>
            </section>
          )}
          {loading ? <Loading id="confidence" span="lg:col-span-6" /> : bands.failed ? <BlockFailed id="confidence" title="How sure the sign-up suggestion was" onRetry={() => retry('seg')} span="lg:col-span-6" /> : (
            <section className={`${CARD} col-span-12 flex flex-col gap-2.5 px-[18px] py-4 lg:col-span-6`} aria-labelledby="seg-h-sure" data-testid="seg-confidence">
              <h2 id="seg-h-sure" className={H2}>How sure the sign-up suggestion was</h2>
              <span className={SUB}>Over the {bands.total.toLocaleString('en-US')} members whose segment was suggested at sign-up.</span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">{bands.counts.map((b) => <Bar key={b.label} label={b.label} count={b.count} max={bandMax} />)}</ul>
              {bands.unrecorded > 0 && <span className={SUB} data-testid="seg-confidence-unrecorded">No confidence recorded for {bands.unrecorded}.</span>}
              {profile !== 'all' && <span className={SUB}>{NOT_PER_PROFILE}</span>}
            </section>
          )}
          <WeeklyBlock seg={seg} onRetry={() => retry('seg')} />
        </div>
      )}

      <CardsBlock seg={seg} profiles={profiles} coverage={coverage} profile={profile} lpOn={lpOn} superAdmin={superAdmin} onRetry={() => retry('profiles')} />
      <NeedsBlock coverage={coverage} profile={profile} onRetry={() => retry('coverage')} />

      <section className={`${CARD} flex flex-col gap-2 border-dashed p-4`} data-testid="seg-advisor-create"><h2 className={H2}>Advisor segments</h2><p className={SUB}>HQ defines the segments Advisors can join.</p>{superAdmin ? <Link to="/admin/persona-segments/new?profile=advisor" className={`${GHOST} min-h-[44px] self-start`}>New segment</Link> : <p className={SUB}>HQ writes the segment profiles.</p>}</section>

    </>
  );
}

export function PersonaSegmentsPage({ superAdmin }) {
  const loc = useLocation();
  const tab = tabOf(loc.pathname) || 'overview';
  const [tick, setTick] = useState(0);
  const [asOf, setAsOf] = useState(null);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [edit, setEdit] = useState(null);
  const [sent, setSent] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const segments = useSegmentProfiles();
  const [noSegment, setNoSegment] = useState({ status: 'loading', value: null });
  useEffect(() => {
    // The Unclassified tab's count is D999's exact one, over every account but admins.
    let live = true;
    setNoSegment({ status: 'loading', value: null });
    personaSegmentsApi.read().then(
      (d) => { if (live) { setAsOf(Date.now()); setNoSegment(failed(d?.members) ? { status: 'error', value: null } : { status: 'ready', value: d.members.no_segment }); } },
      () => { if (live) setNoSegment({ status: 'error', value: null }); },
    );
    return () => { live = false; };
  }, [tick]);
  const notice = useMovedNotice(useMemo(() => movedNotices(superAdmin), [superAdmin]));

  const count = noSegment.status === 'loading' ? { kind: 'load' }
    : noSegment.status === 'error' ? { kind: 'dash', tip: 'The segment counts could not be read.' }
      : { kind: 'num', value: Number(noSegment.value).toLocaleString('en-US') };
  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = (
    <>
      <HeaderTab to="/admin/persona-segments" data-testid="seg-tab-overview">Overview</HeaderTab>
      <HeaderTab to="/admin/persona-segments/unclassified" count={count} data-testid="seg-tab-unclassified">Unclassified</HeaderTab>
      <HeaderTab to="/admin/persona-segments/activity" data-testid="seg-tab-activity">Activity</HeaderTab>
      {superAdmin && <HeaderTab to="/admin/persona-segments/suggestions" data-testid="seg-tab-suggestions">Suggestions</HeaderTab>}
    </>
  );
  const actions = (
    <>
      {superAdmin
        ? <Link to="/admin/persona-segments/new" className={`${BTN} min-h-[44px] bg-axal-violet text-white`}>New segment</Link>
        : <button type="button" className={`${GHOST} min-h-[44px]`} onClick={() => setSuggesting(true)} data-testid="seg-suggest-open">Suggest a change</button>}
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="seg-asof">
        {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
      </span>
      <button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
    </>
  );
  const crumb = superAdmin
    ? { label: 'Content', to: CONTENT_PATH, current: SEG_TITLE }
    : { label: 'Accounts', to: ACCOUNTS_PATH, current: SEG_TITLE };

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="persona-segments">
      <AdminPageHeader
        crumb={crumb}
        title={SEG_TITLE}
        actions={actions}
        line={PAGE_LINE}
        scope={!superAdmin}
        notice={{ text: notice.text, onDismiss: notice.dismiss }}
        tabs={tabs}
        data-testid="seg-header"
      />
      {tab === 'overview' && <Overview superAdmin={superAdmin} tick={tick} />}
      {sent ? <p role="status" className="m-0 text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300" data-testid="seg-page-note">{sent}</p> : null}
      {tab === 'unclassified' && <UnclassifiedTab superAdmin={superAdmin} />}
      {tab === 'activity' && (
        <>
          <ActivityTab segKey={null} />
          {!superAdmin && <SuggestionsList superAdmin={false} segments={segments} testId="seg-activity-suggestions" />}
        </>
      )}
      {tab === 'suggestions' && superAdmin && <SuggestionsList superAdmin segments={segments} onAcceptEdit={setEdit} />}
      {tab === 'suggestions' && !superAdmin && (
        <section className={`${CARD} flex flex-col items-start gap-2 border-dashed p-5`} data-testid="seg-suggestions-refused">
          <h2 className={H2}>Only HQ decides on suggestions</h2>
          <p className={`m-0 ${SUB}`}>Your own suggestions, and HQ&apos;s answers, are on the Activity tab.</p>
          <Link to="/admin/persona-segments/activity" className={GHOST}>Open Activity</Link>
        </section>
      )}
      {edit ? <AcceptedEdit edit={edit} onClose={() => setEdit(null)} onSaved={() => setSent('Saved. The segment profile is changed for every studio.')} /> : null}
      {suggesting ? <SuggestChangeDialog segments={segments} onClose={() => setSuggesting(false)} onSent={setSent} /> : null}
    </div>
  );
}

/**
 * The page inside its rail frame: the Super Admin's board H22 keeps its key
 * ("Personas"); a plain Admin's is D1004's own key, "Admin · Accounts ·
 * Persona segments" (#1874), off the AIRail canvas, in `lib/railPages.js`.
 */
export default function PersonaSegments() {
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  return superAdmin ? (
    <AdminBoardFrame workspace="Personas" note={RAIL_NOTE} data-testid="hq-board-persona-segments">
      <PersonaSegmentsPage superAdmin />
    </AdminBoardFrame>
  ) : (
    <AdminBoardFrame workspace="Persona segments" note={ADMIN_RAIL_NOTE} data-testid="admin-board-persona-segments">
      <PersonaSegmentsPage superAdmin={false} />
    </AdminBoardFrame>
  );
}
