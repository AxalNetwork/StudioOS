import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dataRoomApi } from '../../../lib/api/dataRoom';
import { Unreadable } from '../../../ui';
import { HOME_PATH, TABS, tabSearch } from './dataRoomModel.js';
import { ACTIVITY_WAIT, accessRows, fileHref, needsYou, recentFiles, requestsNeed, roomChips } from './filesModel.js';

/**
 * D1106 (#2986) — DR1, Home's own blocks, under the tool's tab row on the
 * module page (which draws checklist coverage and the Files records from the
 * module read, as before): the room's counts, Needs you, who has access and
 * what was added, from the founder's room read. The last ninety days have no
 * read yet (part 4); it says so where its block would be. A failed read says
 * Unreadable with Try again; the module page below still stands.
 *
 * D1284 (#3342): Needs you reads the open access requests from D1104's queue,
 * on their own read, so a failure there blanks only that line.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const H2 = `m-0 text-[14px] font-extrabold tracking-[-.01em] ${INK}`;
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const tabTo = (id, search) => `${HOME_PATH}${TABS.find((t) => t.id === id)?.path || ''}${tabSearch(search)}`;

function Block({ title, testId, children, aside = null }) {
  return (
    <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2"><h2 className={H2}>{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

/** Needs you's access requests (D1284): open ones, none, or Unreadable with Try again. */
function RequestsNeed({ projectUid, search }) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ status: 'loading', read: null });
  useEffect(() => {
    if (!projectUid) return undefined;
    let alive = true;
    setState({ status: 'loading', read: null });
    dataRoomApi.requests(projectUid)
      .then((r) => { if (alive) setState({ status: 'ready', read: r }); })
      .catch(() => { if (alive) setState({ status: 'error', read: null }); });
    return () => { alive = false; };
  }, [projectUid, reload]);
  if (state.status === 'loading') return <div className="h-5 w-48 animate-pulse rounded bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="dataroom-needs-requests-loading" />;
  const need = state.status === 'ready' ? requestsNeed(state.read) : { state: 'unreadable' };
  if (need.state === 'unreadable') {
    return <div data-testid="dataroom-needs-requests-unreadable"><Unreadable what="The access requests" claim="This is not a claim that nobody asked." onRetry={() => setReload((n) => n + 1)} /></div>;
  }
  if (need.state === 'none') return <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-needs-requests">{need.text}</p>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="dataroom-needs-requests">
      <span className="flex flex-col"><span className={`text-[13px] font-bold ${INK}`}>{need.text}</span><span className={`text-[12px] ${MUTED}`}>{need.sub}</span></span>
      <Link className={`text-[12px] ${LINK}`} to={tabTo('requests', search)} data-testid="dataroom-needs-requests-open">Open Requests</Link>
    </div>
  );
}

export default function DataRoomHome({ read, retry, search = '' }) {
  if (read.status === 'loading') return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="dataroom-home-loading" />;
  if (read.status === 'refused') return <p className={`m-0 text-[13px] ${INK}`} data-testid="dataroom-home-refused">{read.message || 'You do not have access to this venture’s data room.'}</p>;
  if (read.status === 'error') return <div data-testid="dataroom-home-unreadable"><Unreadable what="The data room" claim="This is not a claim that the room is empty." onRetry={retry} /></div>;
  if (read.room?.mode === 'summary') return null;
  const room = read.room;
  const needs = needsYou(room);
  const who = accessRows(room);
  const recent = recentFiles(room);
  return (
    <div className="flex flex-col gap-3" data-testid="dataroom-home">
      <div className="flex flex-wrap gap-2" data-testid="dataroom-home-chips">
        {roomChips(room).map((c) => <span key={c} className={`rounded-full border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold ${INK} dark:border-gray-700`}>{c}</span>)}
      </div>
      <Block title="Needs you" testId="dataroom-needs">
        {needs.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-needs-none">Nothing in the room’s files or access waits on you.</p> : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {needs.map((n) => (
              <li key={n.key} className="flex flex-wrap items-center justify-between gap-2" data-testid={`dataroom-need-${n.key}`}>
                <span className="flex flex-col"><span className={`text-[13px] font-bold ${n.bad ? 'text-red-700 dark:text-red-300' : INK}`}>{n.text}</span><span className={`text-[12px] ${MUTED}`}>{n.sub}</span></span>
                <Link className={`text-[12px] ${LINK}`} to={tabTo(n.to, search)}>Open {n.to === 'files' ? 'Files' : 'Access'}</Link>
              </li>
            ))}
          </ul>
        )}
        <RequestsNeed projectUid={read.uid} search={search} />
      </Block>
      <div className="grid gap-3 lg:grid-cols-2">
        <Block title="Who has access" testId="dataroom-who" aside={<Link className={`text-[12px] ${LINK}`} to={tabTo('access', search)}>Access</Link>}>
          {who.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-who-none">No investor has access in force now.</p> : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {who.map((w) => <li key={w.uid} className="flex flex-col"><span className={`text-[13px] font-bold ${INK}`}>{w.who}</span><span className={`text-[12px] ${MUTED}`}>{[w.nda, w.folders, w.until].join(' · ')}</span></li>)}
            </ul>
          )}
        </Block>
        <Block title="What was added" testId="dataroom-recent" aside={<Link className={`text-[12px] ${LINK}`} to={tabTo('files', search)}>Files</Link>}>
          {recent.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-recent-none">No files yet.</p> : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {recent.map((f) => <li key={f.uid} className="flex items-baseline justify-between gap-2"><Link className={`text-[13px] font-bold ${INK} hover:text-axal-violet`} to={fileHref(f.id, tabSearch(search))}>{f.name}</Link><span className={`font-mono text-[11.5px] ${MUTED}`}>{f.folder} · {f.when}</span></li>)}
            </ul>
          )}
        </Block>
      </div>
      <Block title="The last ninety days" testId="dataroom-90">
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-90-wait">{ACTIVITY_WAIT}</p>
      </Block>
    </div>
  );
}
