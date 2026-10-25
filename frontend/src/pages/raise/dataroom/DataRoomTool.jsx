import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { Unreadable } from '../../../ui';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import {
  HOME_PATH, LINE, TABS, TITLE, WAITS, WORKSPACE_LINE,
  activityRows, day, fileRows, grantRows, projectUidOf, tabHref, tabSearch, weekTiles, workspaceHref,
} from './dataRoomModel';

/**
 * D1101 (#2456) — the Data room tool's tab bar and its tab pages. CycleRoute
 * draws Home (the module page) with `DataRoomHomeNav` under its header, and
 * `DataRoomTabPage` for the tab words under the module. Every row comes from
 * a read on `main`; see `dataRoomModel.js`.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';

/** The tool's own tabs, a second level under the Raise modules: text with an underline. */
export function DataRoomTabBar({ active, search = '' }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="dataroom-tabs">
      <nav aria-label={TITLE} className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link key={t.id} to={tabHref(t, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`dataroom-tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Home's tab bar, and where today's files tool still is. */
export function DataRoomHomeNav({ search = '' }) {
  return (
    <div className="flex flex-col gap-2">
      <DataRoomTabBar active="home" search={search} />
      <p className={`m-0 text-[12px] ${MUTED}`} data-testid="dataroom-home-note">
        {WORKSPACE_LINE} <Link className={LINK} to={workspaceHref(search)}>Open the files tool</Link>
      </p>
    </div>
  );
}

function Skeleton({ testId }) {
  return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid={testId} />;
}

function Section({ title, children, testId, aside }) {
  return (
    <section className={CARD} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{title}</h2>
        {aside}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Table({ cols, children, testId }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-testid={testId}>
        <thead><tr className="border-b border-axal-hairline dark:border-gray-800">{cols.map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * The founder's room, read once for the tab: the venture's uid from the
 * projects list, then `GET /api/data-room/:projectUid`. Loading, ready,
 * refused (403 or 404) or error, never an empty room by default.
 */
function useRoom(projectId, reload) {
  const [state, setState] = useState({ status: 'loading', room: null });
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState({ status: 'loading', room: null });
    Promise.resolve().then(() => api.listProjects())
      .then((projects) => {
        const uid = projectUidOf(projects, projectId);
        if (!uid) { const e = new Error('This venture’s data room was not found.'); e.status = 404; throw e; }
        return api.dataRoom(uid);
      })
      .then((room) => { if (alive) setState({ status: 'ready', room }); })
      .catch((error) => { if (alive) setState({ status: [403, 404].includes(error?.status) ? 'refused' : 'error', room: null, message: error?.message || '' }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  return state;
}

function RoomState({ read, onRetry, testId, children }) {
  if (read.status === 'loading') return <Skeleton testId={`${testId}-loading`} />;
  if (read.status === 'refused') return <p className={`m-0 text-[13px] ${INK}`} data-testid={`${testId}-refused`}>{read.message || 'You do not have access to this venture’s data room.'}</p>;
  if (read.status === 'error') return <div data-testid={`${testId}-unreadable`}><Unreadable what="The data room" claim="This is not a claim that the room is empty." onRetry={onRetry} /></div>;
  return children;
}

function FilesTab({ read, retry, search }) {
  const rows = read.status === 'ready' ? fileRows(read.room) : [];
  return (
    <Section title="Files" testId="dataroom-files"
      aside={<Link className={`text-[12px] ${LINK}`} to={workspaceHref(search)}>Upload and manage files</Link>}>
      <RoomState read={read} onRetry={retry} testId="dataroom-files">
        {rows.length === 0
          ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-files-none">No files yet. Upload them in the files tool.</p>
          : (
            <Table cols={['File', 'Folder', 'Gate', 'Who it is for', 'Until', 'Links issued', 'Who can open it now']} testId="dataroom-files-table">
              {rows.map((r) => (
                <tr key={r.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid="dataroom-file-row">
                  <td className={TD}>{r.name}</td>
                  <td className={TD}>{r.folder}</td>
                  <td className={TD}>{r.gate}</td>
                  <td className={TD}>{r.tier}</td>
                  <td className={`${TD} ${MONO}`}>{r.until}</td>
                  <td className={`${TD} ${MONO}`}>{r.downloads}</td>
                  <td className={TD}>{r.opens}{r.why && <span className={`block text-[11.5px] ${MUTED}`}>{r.why}</span>}</td>
                </tr>
              ))}
            </Table>
          )}
      </RoomState>
    </Section>
  );
}

function AccessTab({ read, retry, search }) {
  const rows = read.status === 'ready' ? grantRows(read.room) : [];
  return (
    <Section title="Access by investor" testId="dataroom-access"
      aside={<Link className={`text-[12px] ${LINK}`} to={workspaceHref(search)}>Share or revoke in the files tool</Link>}>
      <RoomState read={read} onRetry={retry} testId="dataroom-access">
        {rows.length === 0
          ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-access-none">The room is not shared with anyone yet.</p>
          : (
            <Table cols={['Investor', 'Access', 'Since', 'Until', 'NDA', 'Committed', 'Granted by']} testId="dataroom-access-table">
              {rows.map((r) => (
                <tr key={r.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid="dataroom-grant-row">
                  <td className={TD}>{r.who}{r.email && r.email !== r.who && <span className={`block text-[11.5px] ${MUTED}`}>{r.email}</span>}</td>
                  <td className={TD}>{r.state}</td>
                  <td className={`${TD} ${MONO}`}>{r.since}</td>
                  <td className={`${TD} ${MONO}`}>{r.until}</td>
                  <td className={TD}>{r.nda}</td>
                  <td className={TD}>{r.committed}</td>
                  <td className={TD}>{r.by}</td>
                </tr>
              ))}
            </Table>
          )}
      </RoomState>
    </Section>
  );
}

function ActivityTab({ read, retry }) {
  const ready = read.status === 'ready';
  const tiles = ready ? weekTiles(read.room) : [];
  const rows = ready ? activityRows(read.room) : [];
  return (
    <div className="flex flex-col gap-4">
      <Section title="This week" testId="dataroom-week">
        <RoomState read={read} onRetry={retry} testId="dataroom-week">
          <div className="grid gap-3 sm:grid-cols-3">
            {tiles.map((t) => (
              <div key={t.k} className="flex flex-col gap-0.5" data-testid="dataroom-week-tile">
                <span className={EYEBROW}>{t.k}</span>
                <span className={`text-[20px] font-extrabold ${MONO} ${INK}`}>{t.v}</span>
                {t.sub && <span className={`text-[11.5px] ${MUTED}`}>{t.sub}</span>}
              </div>
            ))}
          </div>
        </RoomState>
      </Section>
      <Section title="The last fifty events" testId="dataroom-log">
        <RoomState read={read} onRetry={retry} testId="dataroom-log">
          {rows.length === 0
            ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-log-none">Nothing in the log yet.</p>
            : (
              <ul className="m-0 flex list-none flex-col p-0" data-testid="dataroom-log-list">
                {rows.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center gap-2 border-b border-axal-hairline py-2 text-[12.5px] last:border-0 dark:border-gray-800">
                    <span className={INK}><strong className="font-semibold">{r.who}</strong> {r.verb}{r.what ? ` ${r.what}` : ''}</span>
                    {r.tag && <span className={`rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold ${MUTED}`}>{r.tag}</span>}
                    <span className={`ml-auto text-[11.5px] ${MONO} ${MUTED}`}>{r.when ? day(r.when) : 'Not recorded'}</span>
                  </li>
                ))}
              </ul>
            )}
        </RoomState>
      </Section>
    </div>
  );
}

function Waits({ tab }) {
  const titles = { requests: 'Requests', checklist: 'Checklist', preview: 'Preview as an investor' };
  return (
    <Section title={titles[tab]} testId={`dataroom-${tab}`}>
      <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`dataroom-${tab}-wait`}>{WAITS[tab]}</p>
    </Section>
  );
}

export function DataRoomTabPage({ tab, projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false }) {
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((n) => n + 1), []);
  const reads = tab === 'files' || tab === 'access' || tab === 'activity';
  const read = useRoom(reads ? projectId : null, reload);
  const here = TABS.find((t) => t.id === tab) || TABS[0];
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <Skeleton testId="dataroom-loading" />;
  else if (tab === 'files') body = <FilesTab read={read} retry={retry} search={search} />;
  else if (tab === 'access') body = <AccessTab read={read} retry={retry} search={search} />;
  else if (tab === 'activity') body = <ActivityTab read={read} retry={retry} />;
  else body = <Waits tab={tab} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`dataroom-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: TITLE, to: `${HOME_PATH}${tabSearch(search)}` }} title={here.label} eadwynLabel={`Raise · ${TITLE}`} />
        : <CycleHeader cycle="raise" cards={cards} active="data-room" action={action} title={TITLE} sub={LINE} search={tabSearch(search)} />}
      <DataRoomTabBar active={tab} search={search} />
      {body}
    </div>
  );
}
