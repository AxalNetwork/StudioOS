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
 *
 * D6913 part 3 (RS-15): `CitationRoomFacts` is an Ask source's room facts in its source sheet: the room, when the file
 * was added, how long access lasts, and whether Ask reaches it, with Open in room. A source the room no longer reaches
 * says why and withholds its passage; the answer keeps its own text.
 *
 * D6913 part 4: `RoomLibraryProposal` is Eadwyn's proposal of the room's open files not yet in the caller's Library
 * (it adds nothing itself), and `RoomFileActions` is the row's ⋯ bottom sheet on a phone (RS-20 B).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../ui/Sheet.jsx';
import { PhoneSheet, SheetRow } from '../../ui/phone/PhoneSheet.jsx';
import { roomLibraryApi } from '../../lib/api/roomLibrary';
import {
  LIBRARY_OFF, PROPOSAL_EYEBROW, PROPOSAL_FOOT, addSelection, confirmLines, fileLibraryState, libraryError, proposalFiles, proposalLine,
  proposalOutcome, withheldPassage,
} from './roomLibraryModel';

const btn = 'rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11.5px] font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50';
const primary = 'min-h-[48px] rounded-lg bg-indigo-600 px-4 text-[13px] font-bold text-white hover:bg-indigo-700 disabled:opacity-60 sm:min-h-[36px]';
const secondary = 'min-h-[44px] rounded-lg border border-axal-hairline px-4 text-[13px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100 sm:min-h-[36px]';

export const libraryHref = (documentUid) => `/research/library#document-${encodeURIComponent(documentUid)}`;

/** The room's Library read: { state: loading | ready | unreadable, allowed, items }. */
export function useRoomLibrary(projectUid) {
  const [read, setRead] = useState({ state: 'loading' });
  const load = useCallback(async () => {
    if (!projectUid) return;
    try {
      const r = await roomLibraryApi.room(projectUid);
      setRead({ state: 'ready', allowed: r?.allowed === true, items: Array.isArray(r?.items) ? r.items : [], at: new Date().toISOString() });
    } catch { setRead({ state: 'unreadable' }); }
  }, [projectUid]);
  useEffect(() => { load(); }, [load]);
  return { read, reload: load };
}

/**
 * The one line a room shows when its founder has not allowed Library copies (RS-19 "Refused · founder has not allowed
 * Ask"), or when that could not be read (RS-19 "Unreadable", with Try again: never read as Off).
 */
export function RoomLibraryNote({ read, onRetry }) {
  if (read?.state === 'unreadable') {
    return (
      <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-gray-700 dark:text-gray-300" data-testid="room-library-unreadable">
        <span><span aria-hidden="true">⊠ </span>Unreadable. Whether these files can go in your Library could not be read.</span>
        {onRetry ? <button type="button" className={`${btn} min-h-[44px] sm:min-h-0`} onClick={onRetry} data-testid="room-library-retry">Try again</button> : null}
      </p>
    );
  }
  if (read?.state === 'ready' && !read.allowed) {
    return (
      <div className="mt-2 text-[11.5px] text-gray-700 dark:text-gray-300" data-testid="room-library-off">
        <p className="m-0 font-bold text-axal-ink dark:text-gray-100"><span aria-hidden="true">⦸ </span>Not allowed in your own Ask</p>
        <p className="m-0 mt-0.5">{`${LIBRARY_OFF} You can still read and download them here.`}</p>
        <p className="m-0 mt-0.5 text-axal-muted">Add to my Library is not offered on this room.</p>
      </div>
    );
  }
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

/**
 * D6913 part 4 (RS-20 B): on a phone the row's actions are one ⋯ button that opens a bottom sheet: Open file page,
 * the Library action (Add to my Library, or Open in your Library once it is there), Download (on the file's page, which
 * issues the one-time link), and Cancel. 44px targets. `phone` is passed in so the test draws both widths.
 */
export function RoomFileActions({ file, read, onAdd, fileHref, phone, initialOpen = false }) {
  const opener = useRef(null);
  const [open, setOpen] = useState(initialOpen);
  const close = useCallback(() => setOpen(false), []);
  if (!phone) return <RoomFileLibrary file={file} read={read} onAdd={onAdd} />;
  const s = fileLibraryState(file.uid, read);
  return (
    <span className="inline-flex items-center gap-2">
      {s.state === 'added' ? <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid={`room-file-in-library-${file.uid}`}><span aria-hidden="true">✓ </span>In your Library</span> : null}
      <button type="button" ref={opener} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`More actions for ${file.name}`} data-testid={`room-file-more-${file.uid}`}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-axal-hairline text-[16px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100">⋯</button>
      {open ? (
        <PhoneSheet title={file.name} onClose={close} opener={opener}>
          <div data-testid={`room-file-sheet-${file.uid}`}>
            <SheetRow title="Open file page" to={fileHref(file.uid)} onClose={close} />
            {s.state === 'addable' ? <SheetRow title="Add to my Library" description="Read-only, tied to your access. Nothing is added until you confirm." onClick={() => { close(); onAdd(file); }} /> : null}
            {s.state === 'added' ? <SheetRow title="Open in your Library" description={s.added ? `Added ${s.added}` : null} to={libraryHref(s.documentUid)} onClose={close} /> : null}
            <SheetRow title="Download" description="On the file’s page, as a one-time link" to={fileHref(file.uid)} onClose={close} />
            <button type="button" onClick={close} className="mt-3 min-h-[48px] w-full rounded-lg text-[14px] font-bold text-indigo-700 dark:text-indigo-300">Cancel</button>
          </div>
        </PhoneSheet>
      ) : null}
    </span>
  );
}

/**
 * D6913 part 4 (RS-14 rail, RS-19 Saving and Save failed): Eadwyn proposes this room's open files that are not in the
 * caller's Library, and adds nothing itself. Add sends the selection through `POST /api/room-library/items`, one file
 * at a time; Edit selection lets the investor untick files; Discard hides the proposal for this visit. A failed add
 * keeps the files that were not added selected, with Try again.
 */
export function RoomLibraryProposal({ room, read, onAdded, add = roomLibraryApi.add, initial = null }) {
  const files = proposalFiles(room?.files, read);
  const [picked, setPicked] = useState(() => initial?.picked || null);
  const [editing, setEditing] = useState(Boolean(initial?.editing));
  const [busy, setBusy] = useState(Boolean(initial?.busy));
  const [outcome, setOutcome] = useState(initial?.outcome || null);
  const [discarded, setDiscarded] = useState(false);
  if (discarded) return null;
  if (!files.length && !(outcome && outcome.added)) return null;
  const chosen = picked ? files.filter((f) => picked.includes(f.uid)) : files;
  const names = (uids) => files.filter((f) => uids.includes(f.uid)).map((f) => f.name).join(', ');
  const run = async () => {
    if (!chosen.length) return;
    setBusy(true); setOutcome(null);
    const o = proposalOutcome(await addSelection({ files: chosen, projectUid: room.project.uid, add }));
    setOutcome(o);
    setPicked(o.kept.length ? o.kept : null);
    setEditing(false);
    setBusy(false);
    if (o.added) onAdded?.();
  };
  const toggle = (uid) => setPicked((cur) => {
    const base = cur || files.map((f) => f.uid);
    return base.includes(uid) ? base.filter((u) => u !== uid) : [...base, uid];
  });
  const small = 'min-h-[44px] rounded-lg px-3 text-[12px] font-bold sm:min-h-[32px]';
  return (
    <section aria-label="Eadwyn" data-testid="room-library-proposal"
      className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/30">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-md bg-violet-600 text-[12px] font-extrabold text-white">E</span>
        <b className="text-[13px] text-axal-ink dark:text-gray-100">Eadwyn</b>
        <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-violet-700 dark:text-violet-300">{PROPOSAL_EYEBROW}</span>
      </div>
      {files.length ? <p className="m-0 mt-2 text-[12.5px] leading-relaxed text-gray-800 dark:text-gray-200" data-testid="room-library-proposal-line">{proposalLine(chosen.length ? chosen : files)}</p> : null}
      {editing && files.length ? (
        <fieldset className="mt-2 flex flex-col gap-1" data-testid="room-library-proposal-select">
          <legend className="sr-only">Files to add</legend>
          {files.map((f) => (
            <label key={f.uid} className="flex min-h-[44px] items-center gap-2 text-[12.5px] text-gray-800 dark:text-gray-200 sm:min-h-0">
              <input type="checkbox" checked={chosen.some((c) => c.uid === f.uid)} onChange={() => toggle(f.uid)} disabled={busy} />
              {f.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      {busy ? (
        <p role="status" className="m-0 mt-2 text-[12px] text-gray-700 dark:text-gray-300" data-testid="room-library-proposal-saving">
          <span aria-hidden="true">◷ </span>{`Adding… ${chosen.map((f) => f.name).join(', ')}`}
        </p>
      ) : null}
      {outcome && outcome.tone === 'error' ? (
        <div role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-[12px] dark:border-red-900 dark:bg-red-950/30" data-testid="room-library-proposal-failed">
          <p className="m-0 font-bold text-red-800 dark:text-red-300"><span aria-hidden="true">✕ </span>{outcome.title}</p>
          <p className="m-0 mt-0.5 text-gray-700 dark:text-gray-300">{`${outcome.text} ${names(outcome.kept)}`.trim()}</p>
        </div>
      ) : null}
      {outcome && outcome.tone === 'ok' ? (
        <p role="status" className="m-0 mt-2 text-[12px] text-emerald-800 dark:text-emerald-300" data-testid="room-library-proposal-done">
          <span aria-hidden="true">✓ </span>{`${outcome.title}. ${outcome.text}`}
        </p>
      ) : null}
      {files.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={`${small} bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400`}
            onClick={run} disabled={busy || !chosen.length} data-testid="room-library-proposal-add">
            {outcome && outcome.tone === 'error' ? 'Try again' : 'Add'}
          </button>
          <button type="button" className={`${small} border border-axal-hairline text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800`}
            onClick={() => setEditing((v) => !v)} disabled={busy} aria-expanded={editing} data-testid="room-library-proposal-edit">Edit selection</button>
          <button type="button" className={`${small} border border-axal-hairline text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800`}
            onClick={() => setDiscarded(true)} disabled={busy} data-testid="room-library-proposal-discard">Discard</button>
        </div>
      ) : null}
      <p className="m-0 mt-2.5 text-[11px] text-gray-600 dark:text-gray-400">{PROPOSAL_FOOT}</p>
      {read?.at ? <p className="m-0 mt-1 text-[11px] text-gray-600 dark:text-gray-400" data-testid="room-library-proposal-read">{`Read from: this room · ${room?.project?.name || 'Not recorded'} · ${readTime(read.at)}`}</p> : null}
    </section>
  );
}

/**
 * D6913 part 4 (RS-20 D, RS-21): a Library room row as a phone card's room facts. A live row carries the room chip
 * and Read-only, with Open in room and Remove from Library; a lapsed one reads No longer available with its reason in
 * its own words, and offers only Remove from Library. 44px targets. Null for a row that did not come from a room.
 */
export function RoomCardFacts({ room, uid, busy, onRemove }) {
  if (!room) return null;
  const action = 'flex min-h-[44px] flex-1 items-center justify-center rounded-[10px] border border-axal-hairline px-3 text-[13px] font-bold text-axal-ink disabled:opacity-60 dark:border-gray-700 dark:text-gray-100';
  return (
    <div className="mt-1.5 flex flex-col gap-1.5" data-testid={`library-card-room-${uid}`}>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-md border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-semibold text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300"><span aria-hidden="true">▣ </span>{room.chip}</span>
        {room.lost ? null : <span className="rounded-md border border-axal-hairline px-1.5 py-0.5 font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-300">Read-only</span>}
      </div>
      {room.lost ? (
        <p className="m-0 text-[11.5px] text-gray-700 dark:text-gray-300" data-testid={`library-card-gone-${uid}`}>
          <b className="text-axal-ink dark:text-gray-100"><span aria-hidden="true">⊖ </span>No longer available.</b>{` ${room.reasonWords}`}
        </p>
      ) : (
        <p className="m-0 text-[11px] text-gray-600 dark:text-gray-400">{room.added ? `Added ${room.added}` : 'Added: Not recorded'}</p>
      )}
      <div className="mt-1 flex gap-2">
        {room.lost ? null : <Link to="/research/diligence" className={action} data-testid={`library-card-open-room-${uid}`}>Open in room</Link>}
        <button type="button" className={action} disabled={busy} onClick={() => onRemove(uid)} data-testid={`library-card-room-remove-${uid}`}>Remove from Library</button>
      </div>
    </div>
  );
}

/**
 * D6913 part 4 (RS-18): the Library filtered to From data rooms with nothing from a room in it (`roomsEmpty`). With no
 * room open to the investor the one action only clears the filter: nothing implies they can open a room or ask for one.
 */
export function RoomsEmpty({ empty, onClear, roomsLink = true }) {
  if (!empty) return null;
  const cls = 'mt-3 inline-flex min-h-[44px] items-center rounded-lg px-4 text-[13px] font-bold sm:min-h-[36px]';
  return (
    <section className="rounded-2xl border border-axal-hairline bg-white p-6 dark:border-gray-800 dark:bg-gray-900" data-testid={`library-rooms-empty-${empty.kind}`}>
      <h2 className="m-0 text-[17px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{empty.title}</h2>
      <p className="m-0 mt-1.5 max-w-2xl text-[13px] text-gray-700 dark:text-gray-300">{empty.body}</p>
      {empty.kind === 'no-rooms' ? (
        <button type="button" onClick={onClear} className={`${cls} border border-axal-hairline text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800`}>{empty.action}</button>
      ) : !roomsLink ? null : (
        <Link to="/research/diligence" className={`${cls} bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400`}>{empty.action}</Link>
      )}
    </section>
  );
}

const readTime = (iso) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? 'Not recorded' : t.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

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

/** RS-15: an Ask source's room facts (`room` from `citationRoom`), drawn in the source sheet. */
export function CitationRoomFacts({ room, answeredAt }) {
  if (!room) return null;
  const dt = 'text-gray-600 dark:text-gray-400';
  const dd = 'text-gray-800 dark:text-gray-200';
  return (
    <div data-testid="ask-source-sheet-room">
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className={dt}>Source</dt>
        <dd className="font-semibold text-axal-ink dark:text-gray-100"><span aria-hidden="true">▣ </span>{room.chip}</dd>
        {room.added ? <><dt className={dt}>Added</dt><dd className={dd}>{room.added}</dd></> : null}
        {room.lost ? (
          <><dt className={dt}>Access</dt><dd className={dd} data-testid="ask-source-sheet-room-gone"><span aria-hidden="true">⊘ </span>No longer available. {room.reasonWords}</dd></>
        ) : room.access ? (
          <><dt className={dt}>Access</dt><dd className={dd} data-testid="ask-source-sheet-room-access">{room.access}</dd></>
        ) : null}
        <dt className={dt}>In Ask</dt>
        <dd className={dd}>{room.inAsk}</dd>
      </dl>
      {room.lost ? (
        <p className="mt-3 text-[12px] text-gray-700 dark:text-gray-300" data-testid="ask-source-sheet-withheld">{withheldPassage(answeredAt)}</p>
      ) : null}
    </div>
  );
}

/** RS-15: Open in room, below the passage. D6913: it goes to the investor's rooms (the row holds the venture, not the grant). */
export function OpenInRoom({ room }) {
  if (!room || room.lost || !room.projectUid) return null;
  return (
    <Link to="/research/diligence" data-testid="ask-source-sheet-open-room"
      className="mt-4 flex min-h-[44px] items-center justify-center rounded-[10px] border border-axal-hairline text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100">
      Open in room <span aria-hidden="true">&nbsp;→</span>
    </Link>
  );
}
