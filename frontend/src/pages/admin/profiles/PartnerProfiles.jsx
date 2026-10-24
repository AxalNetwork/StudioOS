import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { ProfileReviewModal } from '../consoles/PartnerProfilesConsole';
import { GLANCE_UNREADABLE, laneOf, useHeldGlance } from '../heldFigures';
import {
  APPROVALS_PATH, DRAFTS_COUNTED, LIST_FAILED, MOVED_NOTICES, NOT_YET, PAGE_LINE, PP_TITLE, RAIL_NOTE, STATUSES,
  categoryBars, pageOf, queueRows, rowView, searchRows, statusCounts, statusWord, tabOf,
} from './ppModel';

/**
 * D989 (#2380) — Partner profiles at /admin/partner-profiles, built to the
 * owner's canvas (PRF1–PRF12) under the shared admin page header (D936). It
 * replaces the Admin Console's "Partner Profiles" tab: `/admin?tab=profiles`
 * forwards here with the moved notice, before the console mounts.
 *
 * THE INTEGRATION, NOT THE WHOLE CANVAS (D989 §3). To review and All profiles
 * draw what the list read and Approvals' lane carry, each truthfully. The
 * review is today's dialog (`ProfileReviewModal`) until part 6 redraws it as
 * PRF3's lightbox; a failed record read says so in the page, never in a
 * browser pop-up. Dates, sources, drafts, accounts and identity checks wait
 * for D989's Worker parts.
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
const PILL = 'inline-flex items-center rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100';
const STATUS_PILL = {
  pending: 'bg-axal-amber text-axal-amber-deep dark:bg-amber-900/40 dark:text-amber-200',
  verified: 'bg-emerald-50 text-axal-positive dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-axal-destructive-tint text-axal-destructive dark:bg-red-900/30 dark:text-red-300',
  other: 'border border-dashed border-axal-muted text-axal-muted dark:text-gray-400',
};

/** The list read, once per visit and on Refresh. It writes an audit row, so it is never polled. */
function useProfileList() {
  const [read, setRead] = useState({ status: 'loading', rows: null });
  const [asOf, setAsOf] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', rows: null });
    api.adminListProfiles().then(
      (data) => { if (live) { setRead({ status: 'ready', rows: Array.isArray(data) ? data : [] }); setAsOf(Date.now()); } },
      (e) => { reportError('partner-profiles:list', e); if (live) setRead({ status: 'error', rows: null }); },
    );
    return () => { live = false; };
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { read, asOf, reload };
}

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

function Tile({ id, label, children }) {
  return (
    <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`pp-tile-${id}`}>
      <span className={EYE}>{label}</span>
      {children}
    </div>
  );
}

function WaitTile({ id, label, reason }) {
  return <Tile id={id} label={label}><span className={TAG}>{NOT_YET}</span><span className={SUB}>{reason}</span></Tile>;
}

function Failed({ testId, text, onRetry }) {
  return (
    <div role="alert" className={`${CARD} flex flex-col gap-2.5 px-[18px] py-4 text-[13px] text-axal-destructive dark:text-red-300`} data-testid={testId}>
      <span>{text}</span>
      <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
    </div>
  );
}

function StatusPill({ v }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_PILL[v.statusKey]}`}>{v.status}</span>;
}

function Person({ v }) {
  return (
    <>
      <span className="block font-bold text-axal-ink dark:text-gray-100">{v.name || v.email}</span>
      {v.name ? <span className={`block ${SUB}`}>{v.email}</span> : null}
    </>
  );
}

function Category({ v }) {
  if (!v.category) return <span className={SUB}>No category captured</span>;
  return (
    <span className="flex flex-wrap gap-1">
      <span className={PILL}>{v.category}</span>
      {v.track ? <span className={PILL}>{v.track}</span> : null}
      {v.incorporated ? <span className={PILL}>{v.incorporated}</span> : null}
    </span>
  );
}

function Queue({ read, glance, reload, onReview }) {
  const lane = laneOf(glance.hq, 'partner_profiles');
  const rows = useMemo(() => queueRows(read.rows), [read.rows]);
  return (
    <>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="pp-tiles">
        <Tile id="waiting" label="Waiting">
          {glance.status === 'loading' && <><span className="font-mono text-[15px] text-axal-muted">Reading…</span><Skeleton /></>}
          {glance.status === 'unreadable' && <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400" title={GLANCE_UNREADABLE}>Could not be read</span>}
          {glance.status === 'ready' && !lane && <span className={SUB}>Not recorded: the Approvals lane was not on the Studio glance.</span>}
          {glance.status === 'ready' && lane && lane.count === null && <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">Could not be read</span>}
          {glance.status === 'ready' && lane && lane.count !== null && (
            <>
              <span className={`${MONO} text-[26px] font-medium text-axal-ink dark:text-gray-100`}>{lane.count.toLocaleString('en-US')}</span>
              <span className={`${SUB} ${MONO}`}>{lane.count ? `oldest ${lane.age || 'undated'}` : 'Nothing waiting'}</span>
            </>
          )}
        </Tile>
        <WaitTile id="past72" label="Past 72 hours" reason="Each profile's age arrives with D989 part 1." />
        <WaitTile id="verified30" label="Verified in 30 days" reason="Nothing records when a profile was decided until D989 part 2." />
        <WaitTile id="out" label="Agreements out for signature" reason="The signing envelopes are joined to profiles in D989 part 3." />
      </div>

      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="pp-h-queue" data-testid="pp-queue">
        <h2 id="pp-h-queue" className={H2}>Waiting, oldest first</h2>
        {read.status === 'loading' && <><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></>}
        {read.status === 'error' && <Failed testId="pp-list-failed" text={LIST_FAILED} onRetry={reload} />}
        {read.status === 'ready' && rows.length === 0 && (
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pp-queue-empty">Nothing waiting. Every profile has a decision. New members&apos; profiles arrive here after their onboarding chat.</p>
        )}
        {read.status === 'ready' && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
              <thead>
                <tr className={EYE}>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Person</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Onboarding category</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Entity</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Agreement</th>
                  <th scope="col" className="py-1.5 font-bold"><span className="sr-only">Review</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = rowView(r);
                  return (
                    <tr key={r.email} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid="pp-queue-row">
                      <td className="py-2 pr-3"><Person v={v} /></td>
                      <td className="py-2 pr-3"><Category v={v} /></td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{v.entity}</td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{v.agreement}</td>
                      <td className="py-2 text-right"><button type="button" className={GHOST} onClick={() => onReview(r)}>Review</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <span className={SUB} data-testid="pp-drafts-note">{DRAFTS_COUNTED} How long each has waited, its source, the account and the identity check arrive with D989&apos;s parts.</span>
      </section>
    </>
  );
}

function Categories({ rows }) {
  const { bars, none, max } = useMemo(() => categoryBars(rows), [rows]);
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-2.5 px-[18px] py-4 lg:col-span-6`} data-testid="pp-categories">
      <h2 className={H2}>Onboarding categories</h2>
      <span className="sr-only">{bars.map((b) => `${b.category} ${b.count}`).join(', ')}{none ? `, no category captured ${none}` : ''}.</span>
      {bars.length === 0 && <span className={SUB}>No profile has a category yet.</span>}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-hidden="true">
        {bars.map((b) => (
          <li key={b.category} className="grid grid-cols-[150px_1fr_40px] items-center gap-2 text-[12px]">
            <span className="truncate text-axal-ink dark:text-gray-100">{b.category}</span>
            <span className="flex h-2.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
              {b.category === 'Founder' ? (
                <>
                  <span className="bg-axal-violet dark:bg-violet-400" style={{ width: `${(b.spinout / max) * 100}%` }} title={`Spin-Out ${b.spinout}`} />
                  <span className="bg-sky-500" style={{ width: `${(b.scale / max) * 100}%` }} title={`Strategic Scale ${b.scale}`} />
                  <span className="bg-axal-muted" style={{ width: `${(b.untracked / max) * 100}%` }} title={`Track not given ${b.untracked}`} />
                </>
              ) : <span className="bg-axal-violet dark:bg-violet-400" style={{ width: `${(b.count / max) * 100}%` }} />}
            </span>
            <span className={`${MONO} text-right text-axal-ink dark:text-gray-100`}>{b.count}</span>
          </li>
        ))}
      </ul>
      {bars.some((b) => b.category === 'Founder') && <span className={SUB}>Founder: Spin-Out (violet), Strategic Scale (sky), track not given (grey).</span>}
      {none > 0 && <span className={`${SUB} border-t border-dashed border-axal-hairline pt-1.5 dark:border-gray-700`} data-testid="pp-no-category">No category captured: {none}</span>}
    </section>
  );
}

function AllProfiles({ read, reload, onReview }) {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const counts = useMemo(() => statusCounts(read.rows), [read.rows]);
  const shown = useMemo(() => {
    const byStatus = status === 'all' ? read.rows || [] : (read.rows || []).filter((r) => r.admin_status === status);
    return searchRows(byStatus, q);
  }, [read.rows, status, q]);
  const pg = pageOf(shown, page);

  if (read.status === 'loading') return <div className={`${CARD} px-[18px] py-4`}><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></div>;
  if (read.status === 'error') return <Failed testId="pp-list-failed" text={LIST_FAILED} onRetry={reload} />;
  if (counts.all === 0) {
    return <p className={`${CARD} m-0 px-[18px] py-4 text-[13px] text-axal-ink dark:text-gray-100`} data-testid="pp-none">No partner profiles yet. A profile appears when a new member finishes the onboarding chat, or an invited partner answers their profile.</p>;
  }
  return (
    <>
      <div className="grid grid-cols-12 gap-3.5">
        <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pp-wait-weekly">
          <h2 className={H2}>Profiles captured and decided, per week</h2>
          <span className={TAG}>{NOT_YET}</span>
          <span className={SUB}>The list carries no capture or decision date yet: D989 parts 1 and 2.</span>
        </section>
        <Categories rows={read.rows} />
      </div>

      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="pp-h-all" data-testid="pp-all">
        <h2 id="pp-h-all" className={H2}>Every profile</h2>
        <div className="flex flex-wrap gap-[7px]" role="radiogroup" aria-label="Status" data-testid="pp-status-chips">
          {[['all', 'All', counts.all], ...STATUSES.map((s) => [s, statusWord(s), counts[s]])].map(([key, label, n]) => (
            <button key={key} type="button" role="radio" aria-checked={status === key} onClick={() => { setStatus(key); setPage(1); }}
              className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold ${status === key ? 'border-axal-lavender-edge bg-axal-lavender text-axal-ink dark:border-violet-700 dark:bg-violet-900/40 dark:text-gray-100' : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`}>
              {label} <span className={MONO}>{n.toLocaleString('en-US')}</span>
            </button>
          ))}
        </div>
        {counts.other > 0 && <span className={SUB} data-testid="pp-other-status">{counts.other} with a status the page does not know, shown as Not recorded under All.</span>}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex-1">
            <span className="sr-only">Search name, email or entity</span>
            <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, email or entity"
              className="h-9 w-full max-w-[360px] rounded-[7px] border border-axal-hairline px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="pp-search" />
          </label>
          <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="pp-count">{pg.label}</span>
          <button type="button" className={GHOST} disabled={pg.page <= 1} onClick={() => setPage(pg.page - 1)}>Previous</button>
          <button type="button" className={GHOST} disabled={pg.page >= pg.pages} onClick={() => setPage(pg.page + 1)}>Next</button>
        </div>
        {q.trim().length === 1 && <span className={SUB}>Type at least two characters.</span>}
        <span className={SUB}>Newest first. Filters by source, category, track, entity, agreement, account, identity check and dates, and the other sorts, arrive with D989 part 1.</span>
        {pg.rows.length === 0 ? (
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pp-no-match">No profile matches. Clear the search or pick All.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-[12.5px]">
              <thead>
                <tr className={EYE}>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Person</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Status</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Onboarding category</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Entity</th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">Agreement</th>
                  <th scope="col" className="py-1.5 font-bold"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((r) => {
                  const v = rowView(r);
                  return (
                    <tr key={r.email} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid="pp-all-row">
                      <td className="py-2 pr-3"><Person v={v} /></td>
                      <td className="py-2 pr-3"><StatusPill v={v} /></td>
                      <td className="py-2 pr-3"><Category v={v} /></td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{v.entity}</td>
                      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{v.agreement}</td>
                      <td className="py-2 text-right"><button type="button" className={GHOST} onClick={() => onReview(r)}>Open</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function PartnerProfilesPage() {
  const loc = useLocation();
  const tab = tabOf(loc.pathname) || 'review';
  const { read, asOf, reload } = useProfileList();
  const glance = useHeldGlance();
  const notice = useMovedNotice(MOVED_NOTICES);
  const counts = useMemo(() => statusCounts(read.rows), [read.rows]);
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

  const countOf = (n) => {
    if (read.status === 'loading') return { kind: 'load' };
    if (read.status === 'error') return { kind: 'dash', tip: 'The profiles could not be read.' };
    return { kind: 'num', value: n.toLocaleString('en-US') };
  };
  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = (
    <>
      <HeaderTab to="/admin/partner-profiles" count={countOf(counts.pending)} data-testid="pp-tab-review">To review</HeaderTab>
      <HeaderTab to="/admin/partner-profiles/all" count={countOf(counts.all)} data-testid="pp-tab-all">All profiles</HeaderTab>
    </>
  );
  const actions = (
    <>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pp-asof">
        {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
      </span>
      <button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
    </>
  );

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
          <button type="button" className={DANGER} onClick={() => onReview(openFailed)}>Try again</button>
          <button type="button" className={GHOST} onClick={() => setOpenFailed(null)}>Dismiss</button>
        </div>
      )}
      {tab === 'review' && <Queue read={read} glance={glance} reload={reload} onReview={onReview} />}
      {tab === 'all' && <AllProfiles read={read} reload={reload} onReview={onReview} />}
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
