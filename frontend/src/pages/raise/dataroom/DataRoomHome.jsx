import React from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../../ui';
import { HOME_PATH, TABS, tabSearch } from './dataRoomModel.js';
import { ACTIVITY_WAIT, REQUESTS_WAIT, accessRows, fileHref, needsYou, recentFiles, roomChips } from './filesModel.js';

/**
 * D1106 (#2986) — DR1, Home's own blocks, under the tool's tab row on the
 * module page (which draws checklist coverage and the Files records from the
 * module read, as before): the room's counts, Needs you, who has access and
 * what was added, from the founder's room read. Access requests and the last
 * ninety days have no read yet (parts 3 and 4); each says so where its block
 * would be. A failed read says Unreadable with Try again; the module page
 * below still stands.
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
        {needs.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-needs-none">Nothing in the room waits on you.</p> : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {needs.map((n) => (
              <li key={n.key} className="flex flex-wrap items-center justify-between gap-2" data-testid={`dataroom-need-${n.key}`}>
                <span className="flex flex-col"><span className={`text-[13px] font-bold ${n.bad ? 'text-red-700 dark:text-red-300' : INK}`}>{n.text}</span><span className={`text-[12px] ${MUTED}`}>{n.sub}</span></span>
                <Link className={`text-[12px] ${LINK}`} to={tabTo(n.to, search)}>Open {n.to === 'files' ? 'Files' : 'Access'}</Link>
              </li>
            ))}
          </ul>
        )}
        <p className={`m-0 text-[12px] ${MUTED}`} data-testid="dataroom-needs-requests">{REQUESTS_WAIT}</p>
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
