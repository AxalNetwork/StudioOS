/**
 * D6913 (#6913, canvas RS-13) — Add to my Library from a data room, over D6869's routes (`lib/api/roomLibrary.js`).
 *
 * - `useRoomLibrary(projectUid)` reads whether the founder allows Library copies of the room, and which of its files
 *   are already in the caller's Library (live references only).
 * - `RoomFileLibrary` is the room file row's Library cell: In your Library with Open, or Add to my Library, which opens
 *   the confirm sheet. A room whose founder has not allowed copies offers nothing; the room says so once.
 * - `AddToLibrarySheet` says what is added, from which room, the access and its end, Read-only, and the cost line, then
 *   adds on Add to Library. Nothing is added without it.
 *
 * A file behind an NDA is never listed here (the room counts it and does not name it), so it has no Library cell.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../ui/Sheet.jsx';
import { roomLibraryApi } from '../../lib/api/roomLibrary';
import { LIBRARY_OFF, confirmLines, fileLibraryState, libraryError } from './roomLibraryModel';

const btn = 'rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11.5px] font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50';
const primary = 'min-h-[44px] rounded-lg bg-indigo-600 px-4 text-[13px] font-bold text-white hover:bg-indigo-700 disabled:opacity-60 sm:min-h-[36px]';
const secondary = 'min-h-[44px] rounded-lg border border-axal-hairline px-4 text-[13px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100 sm:min-h-[36px]';

export const libraryHref = (documentUid) => `/research/library#document-${encodeURIComponent(documentUid)}`;

/** The room's Library read: { state: loading | ready | unreadable, allowed, items }. */
export function useRoomLibrary(projectUid) {
  const [read, setRead] = useState({ state: 'loading' });
  const load = useCallback(async () => {
    if (!projectUid) return;
    try {
      const r = await roomLibraryApi.room(projectUid);
      setRead({ state: 'ready', allowed: r?.allowed === true, items: Array.isArray(r?.items) ? r.items : [] });
    } catch { setRead({ state: 'unreadable' }); }
  }, [projectUid]);
  useEffect(() => { load(); }, [load]);
  return { read, reload: load };
}

/** The one line a room shows when its founder has not allowed Library copies. */
export function RoomLibraryNote({ read }) {
  if (read?.state === 'unreadable') return <p className="mt-2 text-[11px] text-axal-muted" data-testid="room-library-unreadable">Whether these files can go in your Library could not be read.</p>;
  if (read?.state === 'ready' && !read.allowed) return <p className="mt-2 text-[11px] text-axal-muted" data-testid="room-library-off">{LIBRARY_OFF}</p>;
  return null;
}

/** RS-13: the row's Library cell. Pure in its props, so the test draws every state. */
export function RoomFileLibrary({ file, read, onAdd }) {
  const s = fileLibraryState(file.uid, read);
  if (s.state === 'added') {
    return (
      <span className="inline-flex items-center gap-2 text-[11px]" data-testid={`room-file-in-library-${file.uid}`}>
        <span className="font-semibold text-emerald-700 dark:text-emerald-300">In your Library</span>
        <Link to={libraryHref(s.documentUid)} className="font-semibold text-indigo-700 underline dark:text-indigo-300">Open</Link>
      </span>
    );
  }
  if (s.state === 'addable') {
    return <button type="button" className={btn} onClick={() => onAdd(file)} data-testid={`room-file-add-${file.uid}`}>Add to my Library</button>;
  }
  return null;
}

/** RS-13 confirm sheet. `onAdded(documentUid)` re-reads the room. */
export function AddToLibrarySheet({ file, room, onClose, onAdded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const add = async () => {
    setBusy(true); setError('');
    try {
      const r = await roomLibraryApi.add({ projectUid: room.project.uid, fileUid: file.uid });
      setDone(r?.document_uid || null); onAdded?.(r?.document_uid || null);
    } catch (e) {
      // A second add is not a failure: the file is there, and the refusal names its row.
      if (e?.code === 'already_added' && e?.data?.document_uid) { setDone(e.data.document_uid); onAdded?.(e.data.document_uid); }
      else setError(libraryError(e));
    } finally { setBusy(false); }
  };
  if (done !== null) {
    return (
      <Sheet label="Added to your Library" title="Added to your Library" eyebrow="Data room" onClose={onClose} testId="room-library-added"
        footer={<div className="flex justify-end"><button type="button" className={primary} onClick={onClose}>Done</button></div>}>
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="m-0" role="status">{`${file.name} is in your Library, read-only. It is being indexed now, at no charge.`}</p>
          {done ? <Link to={libraryHref(done)} className="font-semibold text-indigo-700 underline dark:text-indigo-300" data-testid="room-library-open">Open in your Library</Link> : null}
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet label="Add to my Library" title="Add to my Library" eyebrow="Data room" onClose={busy ? () => {} : onClose} width={520} testId="room-library-confirm"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={primary} onClick={add} disabled={busy} data-testid="room-library-confirm-add">{busy ? 'Adding…' : 'Add to Library'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="m-0">Ask can then answer from this file and cite it. The file stays the founder’s: you open it in the room, and you cannot edit it.</p>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5" data-testid="room-library-confirm-lines">
          {confirmLines({ file, room }).map(([k, v]) => (
            <React.Fragment key={k}><dt className="text-axal-muted">{k}</dt><dd className="m-0">{v}</dd></React.Fragment>
          ))}
        </dl>
        {error ? <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="room-library-error">{error}</p> : null}
      </div>
    </Sheet>
  );
}
