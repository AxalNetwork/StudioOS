import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { PersonasPanel } from '../consoles/PersonasConsole';
import {
  ACCOUNTS_PATH, CONTENT_PATH, LIST_FAILED, NOT_YET, PAGE_LINE, RAIL_NOTE, SEG_TITLE,
  confidenceBands, howSet, movedNotices, profileLabel, scopeLine, searchMembers, segmentCards, segmentsByProfile, tabOf, tiles, unclassified,
} from './segModel';

/**
 * D997 (#2378) — Persona segments at /admin/persona-segments, built to the
 * owner's canvas (SEG1–SEG14) under the shared admin page header (D936). It
 * replaces the Admin Console's "Personas" tab: `/admin?tab=personas` forwards
 * here with the moved notice, before the console mounts.
 *
 * THE INTEGRATION, NOT THE WHOLE CANVAS (D997 §3). Overview and Unclassified
 * draw what the persona list and the taxonomy carry, each truthfully and under
 * Guard L. Needs, offers, answers, archetypes, weekly tags, a segment's own
 * page, the Move dialog, Activity and Suggestions wait for D997's parts. Until
 * the Move dialog lands, today's re-tag table stays at the foot of Overview.
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
const PAGE = 25;

/** The persona list, once per visit and on Refresh. */
function usePersonaList() {
  const [read, setRead] = useState({ status: 'loading', users: null });
  const [asOf, setAsOf] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', users: null });
    api.listPersonasAdmin().then(
      (data) => { if (live) { setRead({ status: 'ready', users: Array.isArray(data?.users) ? data.users : [] }); setAsOf(Date.now()); } },
      (e) => { reportError('persona-segments:list', e); if (live) setRead({ status: 'error', users: null }); },
    );
    return () => { live = false; };
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { read, asOf, reload };
}

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

function Failed({ onRetry }) {
  return (
    <div role="alert" className={`${CARD} flex flex-col gap-2.5 px-[18px] py-4 text-[13px] text-axal-destructive dark:text-red-300`} data-testid="seg-list-failed">
      <span>{LIST_FAILED}</span>
      <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
    </div>
  );
}

function Tile({ id, label, children }) {
  return <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`seg-tile-${id}`}><span className={EYE}>{label}</span>{children}</div>;
}

function WaitTile({ id, label, reason }) {
  return <Tile id={id} label={label}><span className={TAG}>{NOT_YET}</span><span className={SUB}>{reason}</span></Tile>;
}

function Waiting({ id, title, reason, span = 'lg:col-span-6' }) {
  return (
    <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 ${span}`} data-testid={`seg-wait-${id}`}>
      <h2 className={H2}>{title}</h2>
      <span className={TAG}>{NOT_YET}</span>
      <span className={SUB}>{reason}</span>
    </section>
  );
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

function Overview({ read, reload }) {
  const users = read.users;
  const t = useMemo(() => tiles(users), [users]);
  const groups = useMemo(() => segmentsByProfile(users), [users]);
  const set = useMemo(() => howSet(users), [users]);
  const bands = useMemo(() => confidenceBands(users), [users]);
  const cards = useMemo(() => segmentCards(users), [users]);
  const scope = scopeLine(users);

  if (read.status === 'loading') return <div className={`${CARD} px-[18px] py-4`}><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></div>;
  if (read.status === 'error') return <Failed onRetry={reload} />;
  const groupMax = Math.max(1, ...groups.flatMap((g) => [g.none, ...g.bars.map((b) => b.count)]));
  const setMax = Math.max(1, ...set.rows.map((r) => r.count));
  const bandMax = Math.max(1, ...bands.counts.map((b) => b.count));

  return (
    <>
      {scope && <p className={`m-0 ${SUB}`} data-testid="seg-scope-capped">{scope}</p>}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="seg-tiles">
        <Tile id="tagged" label="In a segment">
          <span className={`${MONO} text-[26px] font-medium text-axal-ink dark:text-gray-100`}>{t.tagged.toLocaleString('en-US')}</span>
          <span className={`${SUB} ${MONO}`}>{t.members ? `of ${t.members.toLocaleString('en-US')} members · ${t.pct}%` : 'No members yet'}</span>
        </Tile>
        <Tile id="untagged" label="No segment">
          <span className={`${MONO} text-[26px] font-medium text-axal-ink dark:text-gray-100`}>{t.untagged.toLocaleString('en-US')}</span>
          <span className={SUB}>Admin accounts are left out of every count.</span>
        </Tile>
        <WaitTile id="differ" label="Segment and profile differ" reason="Each segment's profile is fixed in D997 part 1." />
        <WaitTile id="moved30" label="Moved by an admin, 30 days" reason="The moves log is read with D997 part 5." />
      </div>

      <div className="grid grid-cols-12 gap-3.5">
        <section className={`${CARD} col-span-12 flex flex-col gap-3 px-[18px] py-4 lg:col-span-8`} aria-labelledby="seg-h-by-profile" data-testid="seg-by-profile">
          <h2 id="seg-h-by-profile" className={H2}>Segments by profile</h2>
          <span className={SUB}>By each member&apos;s account profile. A hollow bar is members of that profile with no segment.</span>
          {groups.map((g) => (
            <div key={g.role || 'other'} className="flex flex-col gap-1.5" data-testid={`seg-group-${g.role || 'other'}`}>
              <span className={EYE}>{g.label} · {g.total.toLocaleString('en-US')}</span>
              {g.total === 0 ? <span className={SUB}>No {g.label.toLowerCase()} yet.</span> : (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {g.bars.map((b) => <Bar key={b.id} label={b.label} count={b.count} max={groupMax} tone={g.tone} />)}
                  <Bar label="No segment" count={g.none} max={groupMax} hollow />
                </ul>
              )}
              {g.role === 'advisor' && g.bars.length === 0 && g.total > 0 && <span className={SUB}>No segment for Advisors yet. {g.none} advisors have none.</span>}
            </div>
          ))}
        </section>
        <section className={`${CARD} col-span-12 flex flex-col gap-2.5 px-[18px] py-4 lg:col-span-4`} aria-labelledby="seg-h-set" data-testid="seg-how-set">
          <h2 id="seg-h-set" className={H2}>How segments were set</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{set.rows.map((r) => <Bar key={r.key} label={r.label} count={r.count} max={setMax} />)}</ul>
          {set.other > 0 && <span className={SUB} data-testid="seg-how-set-other">Not recorded for {set.other}: the source stored is not one of the three.</span>}
          <span className={SUB}>Suggested at sign-up: the sign-up chat suggested it and the member accepted.</span>
        </section>
        <section className={`${CARD} col-span-12 flex flex-col gap-2.5 px-[18px] py-4 lg:col-span-6`} aria-labelledby="seg-h-sure" data-testid="seg-confidence">
          <h2 id="seg-h-sure" className={H2}>How sure the sign-up suggestion was</h2>
          <span className={SUB}>Over the {bands.total.toLocaleString('en-US')} members whose segment was suggested at sign-up.</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{bands.counts.map((b) => <Bar key={b.label} label={b.label} count={b.count} max={bandMax} />)}</ul>
          {bands.unrecorded > 0 && <span className={SUB} data-testid="seg-confidence-unrecorded">No confidence recorded for {bands.unrecorded}.</span>}
        </section>
        <Waiting id="weekly" title="New segment tags per week" reason="The date a member was given a segment is read with D997 part 2." />
      </div>

      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="seg-h-cards" data-testid="seg-cards">
        <h2 id="seg-h-cards" className={H2}>Your segments</h2>
        <span className={SUB}>The twelve segments in the taxonomy. Each segment&apos;s profile, needs, offers and status arrive with D997 parts 1 and 3.</span>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <div key={c.id} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3.5 py-3 dark:border-gray-700" data-testid={`seg-card-${c.id}`}>
              <span className="text-[13.5px] font-extrabold text-axal-ink dark:text-gray-100">{c.label}</span>
              {c.who ? <span className={SUB}>{c.who}</span> : null}
              <span className={`${MONO} text-[18px] text-axal-ink dark:text-gray-100`}>{c.count.toLocaleString('en-US')}</span>
              <span className={SUB}>{c.questions} sign-up question{c.questions === 1 ? '' : 's'}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-12 gap-3.5">
        <Waiting id="needs" title="Needs and offers" span="lg:col-span-12" reason="No store holds what a segment needs or what answers it: D997 part 3." />
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="seg-h-move" data-testid="seg-move-table">
        <h2 id="seg-h-move" className={H2}>Move a member</h2>
        <span className={SUB}>Today&apos;s re-tag table, until D997 part 8 draws each segment&apos;s Members tab and the Move dialog.</span>
        <PersonasPanel />
      </section>
    </>
  );
}

function Unclassified({ read, reload }) {
  const [profile, setProfile] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const u = useMemo(() => unclassified(read.users), [read.users]);
  const shown = useMemo(() => searchMembers(profile === 'all' ? u.rows : u.rows.filter((r) => r.role === profile), q), [u.rows, profile, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const p = Math.min(page, pages);
  const slice = shown.slice((p - 1) * PAGE, p * PAGE);
  const label = shown.length ? `${(p - 1) * PAGE + 1}–${Math.min(shown.length, p * PAGE)} of ${shown.length.toLocaleString('en-US')}` : '0 of 0';

  if (read.status === 'loading') return <div className={`${CARD} px-[18px] py-4`}><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></div>;
  if (read.status === 'error') return <Failed onRetry={reload} />;
  const scope = scopeLine(read.users);
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="seg-h-unclassified" data-testid="seg-unclassified">
      <h2 id="seg-h-unclassified" className={H2}>Members with no segment</h2>
      <span className={SUB}>Ask them to finish their profile, or place them yourself. Asking, placing and why each has none arrive with D997 part 5.</span>
      {scope && <span className={SUB} data-testid="seg-scope-capped">{scope}</span>}
      <div className="flex flex-wrap gap-[7px]" role="radiogroup" aria-label="Profile" data-testid="seg-profile-chips">
        {[{ role: 'all', label: 'All', count: u.rows.length }, ...u.byProfile].map((c) => (
          <button key={c.role} type="button" role="radio" aria-checked={profile === c.role} onClick={() => { setProfile(c.role); setPage(1); }}
            className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold ${profile === c.role ? 'border-axal-lavender-edge bg-axal-lavender text-axal-ink dark:border-violet-700 dark:bg-violet-900/40 dark:text-gray-100' : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`}>
            {c.label} <span className={MONO}>{c.count.toLocaleString('en-US')}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex-1">
          <span className="sr-only">Search name or email</span>
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name or email"
            className="h-9 w-full max-w-[360px] rounded-[7px] border border-axal-hairline px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="seg-search" />
        </label>
        <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="seg-count">{label}</span>
        <button type="button" className={GHOST} disabled={p <= 1} onClick={() => setPage(p - 1)}>Previous</button>
        <button type="button" className={GHOST} disabled={p >= pages} onClick={() => setPage(p + 1)}>Next</button>
      </div>
      {slice.length === 0 ? (
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="seg-unclassified-none">{u.rows.length ? 'No member matches. Clear the search or pick All.' : 'Every member has a segment.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className={EYE}>
                <th scope="col" className="py-1.5 pr-3 font-bold">Member</th>
                <th scope="col" className="py-1.5 pr-3 font-bold">Profile</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.user_id} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid="seg-unclassified-row">
                  <td className="py-2 pr-3">
                    <span className="block font-bold text-axal-ink dark:text-gray-100">{r.name || r.email}</span>
                    {r.name ? <span className={`block ${SUB}`}>{r.email}</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{profileLabel(r.role)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {u.other > 0 && <span className={SUB}>{u.other} with no profile this page knows are under All.</span>}
      <span className={SUB}>Newest accounts first. Joined, last active and the sign-up chat&apos;s state arrive with D997 part 5.</span>
    </section>
  );
}

function PersonaSegmentsPage({ superAdmin }) {
  const loc = useLocation();
  const tab = tabOf(loc.pathname) || 'overview';
  const { read, asOf, reload } = usePersonaList();
  const notice = useMovedNotice(useMemo(() => movedNotices(superAdmin), [superAdmin]));
  const u = useMemo(() => unclassified(read.users), [read.users]);

  const count = read.status === 'loading' ? { kind: 'load' }
    : read.status === 'error' ? { kind: 'dash', tip: 'The persona list could not be read.' }
      : { kind: 'num', value: u.rows.length.toLocaleString('en-US') };
  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = (
    <>
      <HeaderTab to="/admin/persona-segments" data-testid="seg-tab-overview">Overview</HeaderTab>
      <HeaderTab to="/admin/persona-segments/unclassified" count={count} data-testid="seg-tab-unclassified">Unclassified</HeaderTab>
    </>
  );
  const actions = (
    <>
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
      {tab === 'overview' && <Overview read={read} reload={reload} />}
      {tab === 'unclassified' && <Unclassified read={read} reload={reload} />}
    </div>
  );
}

/**
 * The page inside the Super Admin's rail frame (board H22 keeps its key); a
 * plain Admin has no board here, so the page stands alone, as it did on the
 * console (D775).
 */
export default function PersonaSegments() {
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  return superAdmin ? (
    <AdminBoardFrame workspace="Personas" note={RAIL_NOTE} data-testid="hq-board-persona-segments">
      <PersonaSegmentsPage superAdmin />
    </AdminBoardFrame>
  ) : <PersonaSegmentsPage superAdmin={false} />;
}
