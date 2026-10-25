import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { cyclesWrite } from '../../../lib/api/cycles.js';
import { answerChips } from '../../cycles/forms.js';
import DataRoomDialog, { roomRefusal } from './DataRoomDialog.jsx';
import FolderLightbox, { NewFolderDialog } from './DataRoomFolders.jsx';
import {
  GATES, OWNER_ONLY, endCopy, fileHref, folderChoices, gateCopy, matchCopy, moveCopy, removeCopy, tableRows, treeRows,
} from './filesModel.js';

/**
 * D1106 (#2986) — Files (DR2): the folder tree beside the table, search, the
 * bulk bar (Move, Set gate, Set end date, Match to checklist, Remove, Clear),
 * New folder and each folder's lightbox. A row opens the file's lightbox at
 * `/raise/data-room/file/<id>`. Every change opens a dialog that names who
 * gains or loses the files; a co-founder moves, renames and matches, and the
 * owner alone changes a gate or removes.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const BTN = 'inline-flex min-h-[32px] items-center rounded-[8px] border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'min-h-[36px] rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PILL = 'inline-flex items-center rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400';

/** Each selected file, written one at a time; the first refusal stops the rest and names its file. */
async function eachFile(files, write) {
  for (const f of files) {
    try { await write(f); } catch (e) { const err = new Error(`${f.name}: ${roomRefusal(e)}`); err.status = e?.status; err.data = e?.data; throw err; }
  }
}

function Tree({ tree, folder, onFolder, onOpenFolder }) {
  const row = (key, label, count, depth = 0, extra = null) => (
    <li key={key} className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
      <button type="button" aria-current={folder === key ? 'true' : undefined} onClick={() => onFolder(key)} data-testid={`dataroom-tree-${key}`}
        className={`flex min-h-[32px] flex-1 items-center justify-between gap-2 rounded-[8px] px-2 text-left text-[12.5px] ${folder === key ? `bg-axal-lavender font-extrabold ${INK} dark:bg-violet-950/40` : `font-semibold ${MUTED} hover:bg-axal-ground dark:hover:bg-gray-800`}`}>
        <span className="truncate">{label}</span>
        <span className={`${MONO} text-[11px]`}>{count}</span>
      </button>
      {extra}
    </li>
  );
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="dataroom-tree">
      {row('all', 'All files', tree.all)}
      {tree.folders.map((f) => row(f.uid, `${f.nda ? '🔒 ' : ''}${f.name}`, f.files, f.depth + 1,
        <button type="button" className={`px-1.5 text-[12px] ${MUTED}`} aria-label={`Open the folder ${f.name}`} onClick={() => onOpenFolder(f.uid)} data-testid={`dataroom-folder-open-${f.uid}`}>⋯</button>))}
      {row('top', 'Top level', tree.top)}
    </ul>
  );
}

export default function DataRoomFiles({ room, projectUid, projectId, reload, search = '' }) {
  const [folder, setFolder] = useState('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);
  const [openFolder, setOpenFolder] = useState(null);
  const [newFolder, setNewFolder] = useState(false);
  const [done, setDone] = useState(null);
  const owner = room?.role !== 'cofounder';
  const tree = useMemo(() => treeRows(room), [room]);
  const rows = useMemo(() => tableRows(room, { folder, q }), [room, folder, q]);
  const files = (room?.files || []).filter((f) => picked.has(f.uid));
  const toggle = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.uid));
  const finish = (line) => { setDialog(null); setPicked(new Set()); setDone(line); reload(); };
  const patchAll = (patch) => eachFile(files, (f) => api.dataRoomUpdateFile(projectUid, f.uid, patch));

  const ask = (kind) => {
    setDone(null);
    if (kind === 'move') setDialog({ kind, target: '' });
    if (kind === 'gate') setDialog({ kind, tier: 'invited', nda: true });
    if (kind === 'end') setDialog({ kind, until: '' });
    if (kind === 'remove') setDialog({ kind });
    if (kind === 'match') {
      setDialog({ kind, options: null, answer: '' });
      cyclesWrite.formOptions('raise', projectId, 'data-room')
        .then((r) => setDialog((d) => (d?.kind === 'match' ? { ...d, options: answerChips(r).filter((o) => o.value) } : d)))
        .catch(() => setDialog((d) => (d?.kind === 'match' ? { ...d, options: 'unreadable' } : d)));
    }
  };

  let open = null;
  if (dialog?.kind === 'move') {
    const copy = moveCopy(room, files, dialog.target);
    open = (
      <DataRoomDialog copy={copy} onClose={() => setDialog(null)} refusalOf={(e) => e.message} testId="dataroom-move"
        onConfirm={async () => { await patchAll(copy.patch); finish(`Moved ${files.length} file${files.length === 1 ? '' : 's'}.`); }}>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted">To</span>
          <select className={INPUT} value={dialog.target} onChange={(e) => setDialog({ ...dialog, target: e.target.value })} data-testid="dataroom-move-target">
            {folderChoices(room).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </DataRoomDialog>
    );
  } else if (dialog?.kind === 'gate') {
    const copy = gateCopy(room, files, dialog);
    open = (
      <DataRoomDialog copy={copy} onClose={() => setDialog(null)} refusalOf={(e) => e.message} testId="dataroom-gate"
        onConfirm={async () => { await patchAll(copy.patch); finish(`Gate set on ${files.length} file${files.length === 1 ? '' : 's'}.`); }}>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0"><legend className="sr-only">Who it is for</legend>
          {GATES.map((g) => (
            <label key={g.key} className="flex items-start gap-2"><input type="radio" name="dataroom-gate" checked={dialog.tier === g.key} onChange={() => setDialog({ ...dialog, tier: g.key })} data-testid={`dataroom-gate-${g.key}`} />
              <span><strong className="font-bold">{g.label}</strong><span className={`block text-[12px] ${MUTED}`}>{g.note}</span></span></label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2"><input type="checkbox" checked={dialog.nda} onChange={(e) => setDialog({ ...dialog, nda: e.target.checked })} data-testid="dataroom-gate-nda" />Needs the NDA</label>
      </DataRoomDialog>
    );
  } else if (dialog?.kind === 'end') {
    const copy = endCopy(room, files, dialog.until || null);
    open = (
      <DataRoomDialog copy={copy} onClose={() => setDialog(null)} refusalOf={(e) => e.message} testId="dataroom-end"
        onConfirm={async () => { await patchAll(copy.patch); finish(dialog.until ? 'End date set.' : 'End date removed.'); }}>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted">Access ends on</span>
          <input type="date" className={INPUT} value={dialog.until} onChange={(e) => setDialog({ ...dialog, until: e.target.value })} data-testid="dataroom-end-date" /></label>
      </DataRoomDialog>
    );
  } else if (dialog?.kind === 'match') {
    const chosen = Array.isArray(dialog.options) ? dialog.options.find((o) => o.value === dialog.answer) : null;
    const copy = chosen ? matchCopy(files, chosen.label) : { title: `Mark ${files.length === 1 ? files[0].name : `${files.length} files`} as answering…`, body: 'Who can open it does not change.', action: 'Match' };
    const body = (v) => (v.startsWith('request-') ? { dd_request_id: Number(v.slice(8)) } : { checklist_item: v.slice(5) });
    open = (
      <DataRoomDialog copy={copy} disabled={!chosen} onClose={() => setDialog(null)} refusalOf={(e) => e.message} testId="dataroom-match"
        onConfirm={async () => { await patchAll(body(dialog.answer)); finish(`Marked as answering ${chosen.label}.`); }}>
        {dialog.options === null ? <span className={`text-[12px] ${MUTED}`}>Reading the checklist…</span> : null}
        {dialog.options === 'unreadable' ? <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="dataroom-match-unreadable">The checklist and the open requests could not be read. That is not a claim there are none.</p> : null}
        {Array.isArray(dialog.options) ? (
          <select className={INPUT} value={dialog.answer} onChange={(e) => setDialog({ ...dialog, answer: e.target.value })} data-testid="dataroom-match-choice">
            <option value="">Choose a request or a checklist item</option>
            {dialog.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : null}
      </DataRoomDialog>
    );
  } else if (dialog?.kind === 'remove') {
    const copy = removeCopy(files);
    open = (
      <DataRoomDialog copy={copy} danger onClose={() => setDialog(null)} refusalOf={(e) => e.message} testId="dataroom-remove"
        onConfirm={async () => { await eachFile(files, (f) => api.dataRoomDeleteFile(projectUid, f.uid)); finish(`Removed ${files.length} file${files.length === 1 ? '' : 's'}.`); }}>
        <p className={`m-0 rounded-[8px] border border-axal-hairline px-3 py-2 text-[12.5px] ${MUTED} dark:border-gray-700`} data-testid="dataroom-remove-trash">{copy.trash}</p>
      </DataRoomDialog>
    );
  }

  const none = (room?.files || []).length === 0;
  return (
    <section className={CARD} data-testid="dataroom-files">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Files</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={() => setNewFolder(true)} data-testid="dataroom-new-folder">New folder</button>
          <Link className={`${BTN} border-axal-violet bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-600 dark:hover:bg-violet-500`} to={`/raise/data-room/new${search}`} data-testid="dataroom-upload">Upload</Link>
        </div>
      </div>
      {done ? <p role="status" className={`m-0 border-b border-axal-hairline bg-axal-lavender px-4 py-2 text-[12.5px] font-semibold ${INK} dark:border-gray-800 dark:bg-violet-950/40`} data-testid="dataroom-files-done">{done}</p> : null}
      {none ? (
        <div className="flex flex-col items-start gap-2 px-4 py-6" data-testid="dataroom-files-none">
          <p className={`m-0 text-[13px] ${INK}`}>No files yet.</p>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>Upload your diligence files. Each one gets a gate before any investor can see it.</p>
        </div>
      ) : (
        <div className="grid gap-4 px-4 py-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Folders"><Tree tree={tree} folder={folder} onFolder={(k) => { setFolder(k); setPicked(new Set()); }} onOpenFolder={setOpenFolder} /></nav>
          <div className="flex min-w-0 flex-col gap-3">
            <input type="search" className={INPUT} placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search files" data-testid="dataroom-files-search" />
            {picked.size ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-axal-lavender px-3 py-2 dark:bg-violet-950/40" data-testid="dataroom-bulk">
                <span className={`text-[12.5px] font-bold ${INK}`}>{picked.size} selected</span>
                <button type="button" className={BTN} onClick={() => ask('move')} data-testid="dataroom-bulk-move">Move</button>
                <button type="button" className={BTN} onClick={() => ask('gate')} disabled={!owner} title={owner ? undefined : OWNER_ONLY} data-testid="dataroom-bulk-gate">Set gate</button>
                <button type="button" className={BTN} onClick={() => ask('end')} disabled={!owner} title={owner ? undefined : OWNER_ONLY} data-testid="dataroom-bulk-end">Set end date</button>
                <button type="button" className={BTN} onClick={() => ask('match')} data-testid="dataroom-bulk-match">Match to checklist</button>
                <button type="button" className={`${BTN} text-red-700 dark:text-red-300`} onClick={() => ask('remove')} disabled={!owner} title={owner ? undefined : OWNER_ONLY} data-testid="dataroom-bulk-remove">Remove</button>
                <button type="button" className={`${BTN} border-transparent bg-transparent`} onClick={() => setPicked(new Set())} data-testid="dataroom-bulk-clear">Clear</button>
                {!owner ? <span className={`basis-full text-[11.5px] ${MUTED}`} data-testid="dataroom-bulk-owner">{OWNER_ONLY}</span> : null}
              </div>
            ) : null}
            {rows.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-files-nomatch">No file here matches.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse" data-testid="dataroom-files-table">
                  <caption className="sr-only">Files. A file’s name opens it.</caption>
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-800">
                    <th className={TH} scope="col"><input type="checkbox" aria-label="Select every file shown" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.uid)))} data-testid="dataroom-pick-all" /></th>
                    {['File', 'Folder', 'Gate', 'Until', 'Links issued', 'Who can open it now'].map((c) => <th key={c} className={TH} scope="col">{c}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid="dataroom-file-row">
                        <td className={TD}><input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.has(r.uid)} onChange={() => toggle(r.uid)} data-testid={`dataroom-pick-${r.uid}`} /></td>
                        <th scope="row" className={`${TD} text-left font-bold`}><Link className="hover:text-axal-violet" to={fileHref(r.id, search)} data-testid={`dataroom-file-open-${r.uid}`}>{r.name}</Link></th>
                        <td className={TD}>{r.folder}</td>
                        <td className={TD}>{r.gate}{r.nda ? <span className={`ml-1.5 ${PILL}`}>NDA</span> : null}</td>
                        <td className={`${TD} ${MONO}`}>{r.until}</td>
                        <td className={`${TD} ${MONO}`}>{r.links}</td>
                        <td className={TD}>{r.opens}{r.why ? <span className={`block text-[11.5px] ${MUTED}`}>{r.why}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={`m-0 text-[11.5px] ${MUTED}`}>A link issued is not proof the file was read. Who can open it now counts each grant, its folders, the gate and the NDA today.</p>
          </div>
        </div>
      )}
      {open}
      {newFolder ? <NewFolderDialog room={room} projectUid={projectUid} onClose={() => setNewFolder(false)} onDone={(line) => { setNewFolder(false); setDone(line); reload(); }} /> : null}
      {openFolder ? <FolderLightbox room={room} uid={openFolder} projectUid={projectUid} owner={owner} onClose={() => setOpenFolder(null)} onDone={(line) => { setOpenFolder(null); setDone(line); reload(); }} /> : null}
    </section>
  );
}
