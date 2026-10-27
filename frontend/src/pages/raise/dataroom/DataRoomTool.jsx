import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { AdminRoomSummary } from './DataRoomSummary.jsx';
import { DataRoomMovedNotice } from './DataRoomMoved.jsx';
import { Unreadable } from '../../../ui';
import { CycleHeader } from '../../cycles/CycleOverview';
import { CycleBar } from '../../cycles/PhoneModulePage';
import DataRoomFiles from './DataRoomFiles.jsx';
import DataRoomFile from './DataRoomFile.jsx';
import DataRoomHome from './DataRoomHome.jsx';
import DataRoomAccess from './DataRoomAccess.jsx';
import DataRoomRequests from './DataRoomRequests.jsx';
import DataRoomActivity from './DataRoomActivity.jsx';
import DataRoomChecklist from './DataRoomChecklist.jsx';
import DataRoomPreview from './DataRoomPreview.jsx';
import { noPermission } from './accessModel';
import { useAuth } from '../../../hooks/useAuthSync';
import {
  HOME_PATH, LINE, TABS, TITLE, projectUidOf, tabHref, tabSearch,
} from './dataRoomModel';

/**
 * D1101 (#2456) — the Data room tool's tab bar and its tab pages. CycleRoute
 * draws Home (the module page) with `DataRoomHomeNav` under its header, and
 * `DataRoomTabPage` for the tab words under the module. Every row comes from
 * a read on `main`; see `dataRoomModel.js`. D1108 (#2988): Activity, Checklist
 * and Preview draw D1105's and D1103's reads (`DataRoomActivity.jsx`,
 * `DataRoomChecklist.jsx`, `DataRoomPreview.jsx`).
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';

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

/** The venture in the query, as CycleRoute passes it (`?project_id=N`). */
const projectOf = (search) => { const m = /[?&]project_id=([1-9]\d*)/.exec(String(search || '')); return m ? m[1] : null; };

/** Home's tab bar and its own blocks (D1106, DR1). D1109: the old files tool is retired, so Home links to no other page. */
export function DataRoomHomeNav({ search = '' }) {
  const [reload, setReload] = useState(0);
  const read = useRoom(projectOf(search), reload);
  return (
    <div className="flex flex-col gap-3">
      <DataRoomTabBar active="home" search={search} />
      {projectOf(search) ? <DataRoomHome read={read} retry={() => setReload((n) => n + 1)} search={search} /> : null}
    </div>
  );
}

function Skeleton({ testId }) {
  return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid={testId} />;
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
    // A re-read after a change keeps the room drawn until the new one arrives (D1106), so a
    // dialog's result line is not lost and nothing flashes. Another venture's room is never kept.
    setState((s) => (s.status === 'ready' && s.projectId === projectId ? { ...s, refreshing: true } : { status: 'loading', room: null }));
    Promise.resolve().then(() => api.listProjects())
      .then((projects) => {
        const uid = projectUidOf(projects, projectId);
        if (!uid) { const e = new Error('This venture’s data room was not found.'); e.status = 404; throw e; }
        return api.dataRoom(uid).then((room) => ({ room, uid }));
      })
      .then(({ room, uid }) => { if (alive) setState({ status: 'ready', room, uid, projectId }); })
      .catch((error) => { if (alive) setState({ status: [403, 404].includes(error?.status) ? 'refused' : 'error', room: null, message: error?.message || '' }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  return state;
}

/** DR18: someone the room is not for, in words for who they are. */
function NoPermission({ testId }) {
  const { user } = useAuth() || {};
  const w = noPermission(user?.role);
  return (
    <section className={`${CARD} mx-auto flex w-full max-w-[560px] flex-col items-center gap-2 px-7 py-8 text-center`} data-testid={`${testId}-refused`}>
      <span aria-hidden="true" className={`text-[22px] ${MUTED}`}>⊘</span>
      <h2 className={`m-0 text-[16px] font-extrabold ${INK}`}>{w.title}</h2>
      <p className={`m-0 text-[13px] ${MUTED}`}>{w.line}</p>
      <Link to={w.to} className="mt-1 inline-flex min-h-[34px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[12.5px] font-bold text-white dark:bg-violet-600">{w.cta}</Link>
    </section>
  );
}

function RoomState({ read, onRetry, testId, children }) {
  if (read.status === 'loading') return <Skeleton testId={`${testId}-loading`} />;
  if (read.status === 'refused') return <NoPermission testId={testId} />;
  if (read.status === 'error') return <div data-testid={`${testId}-unreadable`}><Unreadable what="The data room" claim="This is not a claim that the room is empty." onRetry={onRetry} /></div>;
  return children;
}

function FilesTab({ read, retry, search, projectId }) {
  return (
    <RoomState read={read} onRetry={retry} testId="dataroom-files">
      <DataRoomFiles room={read.room} projectUid={read.uid} projectId={projectId} reload={retry} search={tabSearch(search)} />
    </RoomState>
  );
}

function AccessTab({ read, retry, phone }) {
  return (
    <RoomState read={read} onRetry={retry} testId="dataroom-access">
      <DataRoomAccess room={read.room} projectUid={read.uid} reload={retry} phone={phone} />
    </RoomState>
  );
}

function RequestsTab({ read, retry }) {
  return (
    <RoomState read={read} onRetry={retry} testId="dataroom-requests">
      <DataRoomRequests room={read.room} projectUid={read.uid} reload={retry} />
    </RoomState>
  );
}

function ActivityTab({ read, retry, phone }) {
  return (
    <RoomState read={read} onRetry={retry} testId="dataroom-activity">
      <DataRoomActivity projectUid={read.uid} phone={phone} />
    </RoomState>
  );
}

function ChecklistTab({ read, retry, search }) {
  return (
    <RoomState read={read} onRetry={retry} testId="dataroom-checklist">
      <DataRoomChecklist projectUid={read.uid} search={search} />
    </RoomState>
  );
}

function PreviewTab({ read, retry }) {
  return (
    <RoomState read={read} onRetry={retry} testId="dataroom-preview">
      <DataRoomPreview room={read.room} projectUid={read.uid} />
    </RoomState>
  );
}

export function DataRoomTabPage({ tab, projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false, fileId = null }) {
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((n) => n + 1), []);
  const read = useRoom(projectId, reload);
  const here = TABS.find((t) => t.id === tab) || TABS[0];
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <Skeleton testId="dataroom-loading" />;
  else if (read.status === 'ready' && read.room?.mode === 'summary') body = <AdminRoomSummary room={read.room} reload={retry} />;
  else if (tab === 'files') body = <FilesTab read={read} retry={retry} search={search} projectId={projectId} />;
  else if (tab === 'access') body = <AccessTab read={read} retry={retry} phone={phone} />;
  else if (tab === 'requests') body = <RequestsTab read={read} retry={retry} />;
  else if (tab === 'activity') body = <ActivityTab read={read} retry={retry} phone={phone} />;
  else if (tab === 'checklist') body = <ChecklistTab read={read} retry={retry} search={search} />;
  else body = <PreviewTab read={read} retry={retry} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`dataroom-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: TITLE, to: `${HOME_PATH}${tabSearch(search)}` }} title={here.label} eadwynLabel={`Raise · ${TITLE}`} />
        : <CycleHeader cycle="raise" cards={cards} active="data-room" action={action} title={TITLE} sub={LINE} search={tabSearch(search)} />}
      {/* D1109 (#2989, DR24): an old address lands here with `?moved=`, and says so once under the header. */}
      <DataRoomMovedNotice />
      <DataRoomTabBar active={tab} search={search} />
      {body}
      {/* D1106 (#2986): DR3, a file's Sheet (D1317) over Files at /raise/data-room/file/<id>. */}
      {tab === 'files' && fileId && read.status === 'ready' && read.room?.mode !== 'summary' ? (
        <DataRoomFile fileId={fileId} room={read.room} projectUid={read.uid} projectId={projectId} onChanged={retry}
          onClose={() => navigate(`${HOME_PATH}/files${tabSearch(search)}`)} />
      ) : null}
    </div>
  );
}
