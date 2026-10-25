import React, { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { cyclesWrite } from '../../../lib/api/cycles.js';
import { answerChips } from '../../cycles/forms.js';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { GATES, MAX_UPLOAD_MB, QUEUE_WORDS, folderChoices, queueEntry, storageLine, uploadRefusal } from './filesModel.js';

/**
 * D1106 (#2986) — DR4, Upload: the sheet at `/raise/data-room/new`, in place of
 * the generic Add form. Pick or drop files; each waits in a queue with its own
 * state (Waiting, Sending, In the room, Refused) — the browser reports no
 * percentage, so none is drawn. What is set "for all files" is the folder,
 * the gate (who it is for and the NDA, on by default), an end date and what it
 * answers. A co-founder's upload takes its folder's gate (D1103), so a
 * co-founder sets no gate here. DR4s: a file over 20 MB is refused before it is
 * sent; storage left is not recorded, and the sheet says so.
 */

const INPUT = 'min-h-[36px] w-full rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-axal-muted dark:text-gray-400';
const TONE = { waiting: 'text-axal-muted dark:text-gray-400', sending: 'text-axal-violet dark:text-violet-300', done: 'text-emerald-700 dark:text-emerald-300', refused: 'text-red-700 dark:text-red-300' };

async function dataUri(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export default function DataRoomUpload({ projectId, onClose, onSaved }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const [queue, setQueue] = useState([]);
  const [files, setFiles] = useState([]);
  const [folder, setFolder] = useState('');
  const [tier, setTier] = useState('invited');
  const [nda, setNda] = useState(true);
  const [until, setUntil] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading' });
    cyclesWrite.formOptions('raise', projectId, 'data-room')
      .then(async (opts) => {
        const uid = String(opts?.project_uid || '');
        if (!uid) { const e = new Error('no room'); e.status = 404; throw e; }
        const room = await api.dataRoom(uid);
        if (alive) setRead({ status: 'ready', uid, room, answers: answerChips(opts).filter((o) => o.value) });
      })
      .catch((error) => { if (alive) setRead({ status: [403, 404].includes(error?.status) ? 'refused' : 'error' }); });
    return () => { alive = false; };
  }, [projectId, tick]);

  const owner = read.room?.role !== 'cofounder';
  const add = (list) => {
    const picked = Array.from(list || []);
    setFiles((f) => [...f, ...picked]);
    setQueue((q) => [...q, ...picked.map((file, i) => queueEntry(file, q.length + i))]);
  };
  const waiting = queue.filter((x) => x.state === 'waiting').length;
  const set = (i, patch) => setQueue((q) => q.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const send = async () => {
    setBusy(true);
    let sent = 0;
    for (let i = 0; i < queue.length; i += 1) {
      if (queue[i].state !== 'waiting') continue;
      set(i, { state: 'sending' });
      try {
        const body = {
          name: files[i].name, data: await dataUri(files[i]),
          ...(folder ? { folder_uid: folder } : {}),
          ...(owner ? { visibility: nda ? 'nda' : 'open', access_tier: tier, access_expires_at: until || null } : {}),
          ...(answer.startsWith('request-') ? { dd_request_id: Number(answer.slice(8)) } : answer.startsWith('item-') ? { checklist_item: answer.slice(5) } : {}),
        };
        await api.dataRoomUploadFile(read.uid, body);
        set(i, { state: 'done' });
        sent += 1;
      } catch (e) { set(i, { state: 'refused', why: uploadRefusal(e) }); }
    }
    setBusy(false);
    if (sent) onSaved();
  };

  const finished = queue.length > 0 && waiting === 0 && !busy;
  return (
    <Lightbox label="Upload" title="Upload" sub="Files land in the room with the gate you set here." onClose={() => { if (!busy) onClose(); }} width={640} testId="dataroom-upload-sheet"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>{finished ? 'Close' : 'Cancel'}</button>
          {!finished ? <button type="button" className={actionPrimary} onClick={send} disabled={busy || !waiting || read.status !== 'ready'} data-testid="dataroom-upload-go">{busy ? 'Adding…' : 'Add to the room'}</button> : null}
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100">
        {read.status === 'loading' ? <span className={`text-[12px] ${MUTED}`} data-testid="dataroom-upload-reading">Reading the room…</span> : null}
        {read.status === 'refused' ? <p className="m-0" data-testid="dataroom-upload-refused">You do not have access to this venture’s data room.</p> : null}
        {read.status === 'error' ? (
          <p role="alert" className="m-0 flex flex-wrap gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid="dataroom-upload-unreadable">
            Unreadable: the room could not be read, so nothing can be added yet. <button type="button" className="font-semibold underline" onClick={() => setTick((t) => t + 1)}>Try again</button>
          </p>
        ) : null}
        <label className="flex cursor-pointer flex-col items-start gap-1 rounded-[10px] border-[1.5px] border-dashed border-axal-lavender-edge bg-axal-lavender px-4 py-4 dark:border-violet-800 dark:bg-violet-950/40"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer?.files); }}>
          <span className="text-[14px] font-bold">⇪ Drop files here, or browse</span>
          <span className={`text-[12px] ${MUTED}`}>Up to {MAX_UPLOAD_MB} MB a file</span>
          <input type="file" multiple className="sr-only" onChange={(e) => add(e.target.files)} data-testid="dataroom-upload-pick" />
        </label>
        <p className={`m-0 text-[12px] ${MUTED}`} data-testid="dataroom-upload-storage">{read.status === 'ready' ? storageLine(read.room) : `Each file can be up to ${MAX_UPLOAD_MB} MB.`}</p>
        <p className={`m-0 text-[12px] ${MUTED}`}>Files from Google Drive or Notion are not added here yet; that comes with the file sources (part 4).</p>

        {queue.length ? (
          <section className="flex flex-col gap-1.5" data-testid="dataroom-upload-queue">
            <h3 className={LABEL}>Queue</h3>
            {queue.map((x) => (
              <div key={x.key} className="flex flex-wrap items-center justify-between gap-2" data-testid="dataroom-upload-entry">
                <span><strong className="font-bold">{x.name}</strong> <span className={`font-mono text-[11.5px] ${MUTED}`}>{x.size}</span></span>
                <span className={`text-[12px] font-bold ${TONE[x.state]}`} data-testid={`dataroom-upload-state-${x.state}`}>{x.state === 'refused' ? `✕ ${x.why}` : QUEUE_WORDS[x.state]}</span>
              </div>
            ))}
            <p className={`m-0 text-[11.5px] ${MUTED}`}>Each file shows a state. The browser reports no percentage.</p>
          </section>
        ) : null}

        {read.status === 'ready' ? (
          <section className="flex flex-col gap-2.5" data-testid="dataroom-upload-all">
            <h3 className={LABEL}>For all files</h3>
            <label className="flex flex-col gap-1"><span className={LABEL}>Folder</span>
              <select className={INPUT} value={folder} onChange={(e) => setFolder(e.target.value)} data-testid="dataroom-upload-folder">
                {folderChoices(read.room).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></label>
            {owner ? (
              <>
                <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0"><legend className={LABEL}>Gate</legend>
                  {GATES.map((g) => <label key={g.key} className="flex items-center gap-2"><input type="radio" name="dataroom-upload-tier" checked={tier === g.key} onChange={() => setTier(g.key)} data-testid={`dataroom-upload-tier-${g.key}`} />{g.label}</label>)}
                </fieldset>
                <label className="flex items-center gap-2"><input type="checkbox" checked={nda} onChange={(e) => setNda(e.target.checked)} data-testid="dataroom-upload-nda" />Needs the NDA <span className={`text-[12px] ${MUTED}`}>New files need an NDA unless you switch it off.</span></label>
                <label className="flex flex-col gap-1"><span className={LABEL}>Access ends on</span>
                  <input type="date" className={INPUT} value={until} onChange={(e) => setUntil(e.target.value)} data-testid="dataroom-upload-end" /></label>
              </>
            ) : <p className={`m-0 text-[12px] ${MUTED}`} data-testid="dataroom-upload-cofounder">Your files take their folder’s gate. Only the venture’s owner sets a gate.</p>}
            <label className="flex flex-col gap-1"><span className={LABEL}>Answers</span>
              <select className={INPUT} value={answer} onChange={(e) => setAnswer(e.target.value)} data-testid="dataroom-upload-answers">
                <option value="">Nothing yet</option>
                {read.answers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></label>
          </section>
        ) : null}
      </div>
    </Lightbox>
  );
}
