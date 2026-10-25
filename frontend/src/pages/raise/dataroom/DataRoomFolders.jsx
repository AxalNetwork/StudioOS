import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { Lightbox, actionDanger, actionGhost } from '../../../ui';
import DataRoomDialog, { roomRefusal } from './DataRoomDialog.jsx';
import { deleteFolderCopy, folderChoices, folderNdaCopy, folderPath, renameCopy } from './filesModel.js';

/**
 * D1106 (#2986) — DR5: a folder's lightbox (what is inside, its NDA switch,
 * Rename and Delete folder) and New folder, which names the folder in a field,
 * never a browser pop-up. Each change opens a dialog that says what it does.
 */

const INPUT = 'min-h-[36px] w-full rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LABEL = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';

export function NewFolderDialog({ room, projectUid, onClose, onDone }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const where = parent ? (room?.folders || []).find((f) => f.uid === parent)?.name : null;
  const copy = { title: 'New folder', body: `It is created ${where ? `inside ${where}` : 'at the top level'}, with no NDA asked until you switch it on. No investor sees an empty folder.`, action: 'Create folder' };
  return (
    <DataRoomDialog copy={copy} disabled={!name.trim()} onClose={onClose} refusalOf={roomRefusal} testId="dataroom-newfolder"
      onConfirm={async () => { await api.dataRoomCreateFolder(projectUid, { name: name.trim(), ...(parent ? { parent_uid: parent } : {}) }); onDone(`Created ${name.trim()}.`); }}>
      <label className="flex flex-col gap-1"><span className={LABEL}>Name</span>
        <input className={INPUT} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="dataroom-newfolder-name" /></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Inside</span>
        <select className={INPUT} value={parent} onChange={(e) => setParent(e.target.value)} data-testid="dataroom-newfolder-parent">
          {folderChoices(room).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select></label>
    </DataRoomDialog>
  );
}

export default function FolderLightbox({ room, uid, projectUid, owner, onClose, onDone }) {
  const folder = (room?.folders || []).find((f) => f.uid === uid);
  const [ask, setAsk] = useState(null);
  if (!folder) return null;
  const inside = (room?.files || []).filter((f) => folderPath(room, f.folder_id).includes(folder.uid));
  const kids = (room?.folders || []).filter((f) => Number(f.parent_id) === Number(folder.id));
  const nda = folder.visibility === 'nda';

  let dialog = null;
  if (ask?.kind === 'nda') {
    const copy = folderNdaCopy(room, folder, !nda, ask.inside);
    dialog = (
      <DataRoomDialog copy={copy} onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-folder-nda"
        onConfirm={async () => { await api.dataRoomUpdateFolder(projectUid, folder.uid, copy.patch); onDone(nda ? `${folder.name} no longer asks for an NDA.` : `${folder.name} asks for an NDA.`); }}>
        <label className="flex items-center gap-2"><input type="checkbox" checked={ask.inside} onChange={(e) => setAsk({ ...ask, inside: e.target.checked })} data-testid="dataroom-folder-nda-inside" />Also set every folder and file inside (recommended)</label>
      </DataRoomDialog>
    );
  } else if (ask?.kind === 'rename') {
    const copy = renameCopy('folder', folder.name);
    dialog = (
      <DataRoomDialog copy={copy} disabled={!ask.name.trim() || ask.name.trim() === folder.name} onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-folder-rename"
        onConfirm={async () => { await api.dataRoomUpdateFolder(projectUid, folder.uid, { name: ask.name.trim() }); onDone(`Renamed to ${ask.name.trim()}.`); }}>
        <label className="flex flex-col gap-1"><span className={LABEL}>Name</span>
          <input className={INPUT} value={ask.name} maxLength={200} onChange={(e) => setAsk({ ...ask, name: e.target.value })} data-testid="dataroom-folder-rename-name" /></label>
      </DataRoomDialog>
    );
  } else if (ask?.kind === 'delete') {
    const copy = deleteFolderCopy(room, folder);
    dialog = copy.blocked ? (
      <Lightbox label={`Delete ${folder.name}`} title={`Delete ${folder.name}`} onClose={() => setAsk(null)} testId="dataroom-folder-delete-blocked"
        footer={<div className="flex justify-end"><button type="button" className={actionGhost} onClick={() => setAsk(null)}>Close</button></div>}>
        <p className="m-0 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100" data-testid="dataroom-folder-delete-blocked-body">{copy.blocked}</p>
      </Lightbox>
    ) : (
      <DataRoomDialog copy={copy} danger onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-folder-delete"
        onConfirm={async () => { await api.dataRoomDeleteFolder(projectUid, folder.uid); onDone(`Deleted ${folder.name}; its files are at the top level.`); }} />
    );
  }

  return (
    <Lightbox label={folder.name} eyebrow="Folder" title={folder.name} onClose={onClose} testId="dataroom-folder"
      footer={(
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={actionDanger} onClick={() => setAsk({ kind: 'delete' })} data-testid="dataroom-folder-delete-open">Delete folder</button>
          <button type="button" className={actionGhost} onClick={() => setAsk({ kind: 'rename', name: folder.name })} data-testid="dataroom-folder-rename-open">Rename</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100">
        <p className="m-0 font-mono font-bold" data-testid="dataroom-folder-count">{inside.length} file{inside.length === 1 ? '' : 's'} inside{kids.length ? ` · ${kids.length} folder${kids.length === 1 ? '' : 's'}` : ''}</p>
        <div className="flex items-start justify-between gap-3">
          <span className="flex flex-col"><strong className="font-bold">Needs the NDA</strong>
            <span className={`text-[12px] ${MUTED}`}>{nda ? 'Investors need an active NDA for what this folder sets.' : 'Switch it on to ask for an NDA on this folder.'}</span></span>
          <button type="button" role="switch" aria-checked={nda} aria-label="Needs the NDA" disabled={!owner} title={owner ? undefined : 'Only the venture’s owner changes a gate.'}
            onClick={() => setAsk({ kind: 'nda', inside: true })} data-testid="dataroom-folder-nda-switch"
            className={`relative h-6 w-11 flex-none rounded-full border disabled:cursor-not-allowed disabled:opacity-50 ${nda ? 'border-axal-violet bg-axal-violet' : 'border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800'}`}>
            <span aria-hidden="true" className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow ${nda ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
        <p className={`m-0 text-[12px] ${MUTED}`}>Each file’s own gate is what the download checks.</p>
      </div>
      {dialog}
    </Lightbox>
  );
}
