import React, { useCallback, useEffect, useState } from 'react';
import { dataRoomApi } from '../../../lib/api/dataRoom.js';
import DataRoomDialog, { roomRefusal } from './DataRoomDialog.jsx';
import {
  DRIVE_TRASH, TRASH_EMPTY, TRASH_NOTE, TRASH_UNREADABLE, deleteNowCopy, restoreFailed, restoredLine, trashFoot, trashRows,
} from './filesModel.js';

/**
 * D6073 (#6073) — DR28, Trash in the Files tab: each removed file with its
 * folder, when and by whom it was removed, the days left of thirty, Restore,
 * and Delete now for the owner (Scope, then Review, then the result line). The
 * owner and co-founders see it (`restore`); the Worker answers Delete now only
 * for the owner (`can_delete_now`). A read that failed is said, never drawn as
 * an empty Trash. At phone width each file is a card with a 44px Restore.
 */

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-[8px] border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const DANGER = `${BTN} text-red-700 dark:text-red-300`;
const SMALL = `block text-[11.5px] ${MUTED}`;

export default function DataRoomTrash({ projectUid, onChanged }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(null);
  const [line, setLine] = useState(null);
  const [failed, setFailed] = useState(null);
  const [ask, setAsk] = useState(null);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    dataRoomApi.trash(projectUid).then(
      (data) => { if (alive) setRead({ status: 'ready', data }); },
      () => { if (alive) setRead({ status: 'error', data: null }); },
    );
    return () => { alive = false; };
  }, [projectUid, tick]);

  const rows = read.status === 'ready' ? trashRows(read.data) : [];
  const canDeleteNow = read.data?.can_delete_now === true;

  const restore = async (row) => {
    setBusy(row.uid); setLine(null); setFailed(null);
    try {
      const out = await dataRoomApi.restore(projectUid, row.uid);
      setLine(restoredLine(row.name, out));
      reload(); onChanged?.();
    } catch {
      setFailed({ uid: row.uid, text: restoreFailed(row) });
    } finally { setBusy(null); }
  };

  let dialog = null;
  if (ask) {
    const copy = deleteNowCopy(ask.row);
    dialog = ask.step === 'scope' ? (
      <DataRoomDialog key="scope" copy={copy.scope} onClose={() => setAsk(null)} testId="dataroom-trash-delete-scope"
        onConfirm={async () => setAsk({ ...ask, step: 'review' })} />
    ) : (
      <DataRoomDialog key="review" copy={copy.review} danger onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-trash-delete-review"
        onConfirm={async () => {
          const out = await dataRoomApi.deleteNow(projectUid, ask.row.uid);
          setAsk(null); setFailed(null); setLine(copy.done(out?.trash_count)); reload(); onChanged?.();
        }} />
    );
  }

  const actions = (r, phone = false) => (
    <span className={`flex ${phone ? 'flex-wrap' : 'flex-col'} gap-1.5`}>
      <button type="button" className={`${BTN} ${phone ? 'min-h-[44px] flex-1' : ''}`} disabled={busy === r.uid} onClick={() => restore(r)}
        data-testid={`dataroom-trash-restore-${r.uid}${phone ? '-phone' : ''}`}>{busy === r.uid ? 'Restoring…' : 'Restore'}</button>
      {canDeleteNow ? (
        <button type="button" className={`${DANGER} ${phone ? 'min-h-[44px] flex-1' : ''}`} onClick={() => setAsk({ row: r, step: 'scope' })}
          data-testid={`dataroom-trash-delete-${r.uid}${phone ? '-phone' : ''}`}>Delete now</button>
      ) : null}
    </span>
  );

  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="dataroom-trash" aria-labelledby="dataroom-trash-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="dataroom-trash-title" className={`m-0 text-[14px] font-extrabold ${INK}`}>Trash</h3>
          <p className={`m-0 mt-0.5 text-[12.5px] ${MUTED}`}>{TRASH_NOTE}</p>
        </div>
        {read.status === 'ready' && rows.length ? <span className={`text-[12px] ${MUTED}`} data-testid="dataroom-trash-count">{`${rows.length} file${rows.length === 1 ? '' : 's'}`}</span> : null}
      </div>
      {line ? <p role="status" className={`m-0 rounded-[8px] bg-axal-lavender px-3 py-2 text-[12.5px] font-semibold ${INK} dark:bg-violet-950/40`} data-testid="dataroom-trash-done">{line}</p> : null}
      {failed ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="dataroom-trash-failed">{failed.text}</p> : null}

      {read.status === 'loading' ? (
        <div aria-busy="true" aria-label="Loading Trash" className="flex flex-col gap-2" data-testid="dataroom-trash-loading">
          <span className="h-3 w-[85%] animate-pulse rounded bg-axal-ground dark:bg-gray-800" />
          <span className="h-3 w-[70%] animate-pulse rounded bg-axal-ground dark:bg-gray-800" />
        </div>
      ) : null}
      {read.status === 'error' ? (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid="dataroom-trash-unreadable">
          {`Unreadable: ${TRASH_UNREADABLE}`}
          <button type="button" className="font-semibold underline" onClick={reload}>Try again</button>
        </p>
      ) : null}
      {read.status === 'ready' && !rows.length ? (
        <div className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-4 py-4 dark:border-gray-800" data-testid="dataroom-trash-empty">
          <p className={`m-0 text-[13px] font-bold ${INK}`}>{TRASH_EMPTY.title}</p>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>{TRASH_EMPTY.sub}</p>
        </div>
      ) : null}

      {rows.length ? (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[620px] border-collapse" data-testid="dataroom-trash-table">
              <caption className="sr-only">Files in Trash, with the days left before each is deleted.</caption>
              <thead><tr className="border-b border-axal-hairline dark:border-gray-800">
                {['File', 'Folder', 'Removed', 'Left of 30'].map((c) => <th key={c} className={TH} scope="col">{c}</th>)}
                <th className={TH} scope="col"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid="dataroom-trash-row">
                    <th scope="row" className={`${TD} text-left font-bold`}>{r.name}{r.drive ? <span className={SMALL}>From Google Drive</span> : null}</th>
                    <td className={TD}>{r.folder}{r.returns ? <span className={SMALL} data-testid={`dataroom-trash-returns-${r.uid}`}>{r.returns}</span> : null}</td>
                    <td className={TD}><span className={MONO}>{r.removed}</span><span className={SMALL}>{`by ${r.by}`}</span></td>
                    <td className={`${TD} ${MONO}`} data-testid={`dataroom-trash-left-${r.uid}`}>{r.left}</td>
                    <td className={TD}>{actions(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 sm:hidden" data-testid="dataroom-trash-cards">
            {rows.map((r) => (
              <li key={r.uid} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-800">
                <strong className={`text-[13px] font-bold ${INK} break-words`}>{r.name}</strong>
                <span className={SMALL}>{`${r.folder}${r.returns ? ` · ${r.returns}` : ''} · removed ${r.removed} by ${r.by}`}</span>
                <span className={`${SMALL} ${MONO}`}>{r.left}</span>
                {actions(r, true)}
              </li>
            ))}
          </ul>
          {rows.some((r) => r.drive) ? <p className={`m-0 rounded-[8px] border border-axal-hairline px-3 py-2 text-[12px] ${MUTED} dark:border-gray-700`} data-testid="dataroom-trash-drive">{DRIVE_TRASH}</p> : null}
          <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="dataroom-trash-foot">{trashFoot(canDeleteNow)}</p>
        </>
      ) : null}
      {dialog}
    </section>
  );
}
