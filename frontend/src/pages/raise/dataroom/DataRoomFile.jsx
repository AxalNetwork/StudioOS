import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { dataRoomApi } from '../../../lib/api/dataRoom.js';
import { cyclesApi } from '../../../lib/api/cycles.js';
import { Lightbox, actionGhost } from '../../../ui';
import DataRoomDialog, { roomRefusal } from './DataRoomDialog.jsx';
import {
  GATES, OWNER_ONLY, answersOf, endCopy, folderChoices, gateCopy, gateWord, linkRows, makeCurrentCopy, moveCopy, removeCopy, renameCopy,
  versionRows, whoCanOpen,
} from './filesModel.js';
import { day } from './dataRoomModel.js';

/**
 * D1106 (#2986) — DR3, one file's lightbox at `/raise/data-room/file/<id>`,
 * over Files. It is composed from three reads, each answering alone:
 *   - the room (`GET /api/data-room/:projectUid`): the file, its gate and who
 *     can open it now, by the investor reads' rule with each grant's folders;
 *   - its versions (D1103): Download any, and Make current (DR15), a swap;
 *   - its record (`/cycles/raise/modules/data-room/records/:id`): what it
 *     answers, and the links issued and refusals, never a view.
 * Download is the founder's own copy and is not an investor event. Every change
 * opens a dialog first; the owner alone changes a gate or removes.
 */

const SEC = 'flex flex-col gap-2 border-t border-axal-hairline pt-3.5 first:border-t-0 first:pt-0 dark:border-gray-700';
const EYE = 'm-0 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const BTN = 'inline-flex min-h-[32px] items-center rounded-[8px] border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'min-h-[36px] w-full rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const PILL = { g: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300', n: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300', v: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300' };
const Pill = ({ tone = 'n', children, testId }) => <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[tone]}`} data-testid={testId}>{children}</span>;

function useRead(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.resolve().then(load).then(
      (data) => { if (alive) setState({ status: 'ready', data }); },
      (error) => { if (alive) setState({ status: 'error', data: null, error }); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [state, useCallback(() => setTick((t) => t + 1), [])];
}

function Failed({ what, onRetry, testId }) {
  return (
    <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid={testId}>
      {`Unreadable: ${what} could not be read. That is not the same as none.`}
      <button type="button" className="font-semibold underline" onClick={onRetry}>Try again</button>
    </p>
  );
}

export default function DataRoomFile({ fileId, room, projectUid, projectId, onClose, onChanged }) {
  const file = (room?.files || []).find((f) => String(f.id) === String(fileId));
  const owner = room?.role !== 'cofounder';
  const [versions, retryVersions] = useRead(() => (file ? dataRoomApi.versions(projectUid, file.uid) : null), [projectUid, file?.uid]);
  const [record, retryRecord] = useRead(() => cyclesApi.record('raise', projectId, 'data-room', fileId), [projectId, fileId]);
  const [ask, setAsk] = useState(null);
  const [done, setDone] = useState(null);
  const [link, setLink] = useState(null);
  const changed = (line) => { setAsk(null); setDone(line); retryVersions(); retryRecord(); onChanged(); };

  if (!file) {
    return (
      <Lightbox label="File" title="This file is not in the room" onClose={onClose} testId="dataroom-file-gone"
        footer={<div className="flex justify-end"><button type="button" className={actionGhost} onClick={onClose}>Close</button></div>}>
        <p className={`m-0 px-5 py-4 text-[13px] ${INK}`}>It may have been removed, or the address names another venture’s file.</p>
      </Lightbox>
    );
  }
  const folder = (room?.folders || []).find((f) => Number(f.id) === Number(file.folder_id));
  const vrows = versions.status === 'ready' ? versionRows(versions.data) : [];
  const current = vrows.find((v) => v.current);
  const who = whoCanOpen(room, file);
  const patch = (body) => api.dataRoomUpdateFile(projectUid, file.uid, body);
  const download = async (version) => {
    setLink(null);
    try {
      const r = version == null ? await dataRoomApi.download(projectUid, file.uid) : await dataRoomApi.downloadVersion(projectUid, file.uid, version);
      setLink({ url: r.url, label: version == null ? 'the current version' : `version ${version}` });
    } catch (e) { setLink({ error: roomRefusal(e) }); }
  };

  let dialog = null;
  if (ask?.kind === 'gate') {
    const copy = gateCopy(room, [file], ask);
    dialog = <DataRoomDialog copy={copy} onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-file-gate" onConfirm={async () => { await patch(copy.patch); changed('Gate changed.'); }} />;
  } else if (ask?.kind === 'end') {
    const copy = endCopy(room, [file], ask.until || null);
    dialog = <DataRoomDialog copy={copy} onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-file-end" onConfirm={async () => { await patch(copy.patch); changed(ask.until ? 'End date set.' : 'End date removed.'); }} />;
  } else if (ask?.kind === 'move') {
    const copy = moveCopy(room, [file], ask.target);
    dialog = (
      <DataRoomDialog copy={copy} onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-file-move" onConfirm={async () => { await patch(copy.patch); changed('Moved.'); }}>
        <label className="flex flex-col gap-1"><span className={LABEL}>To</span>
          <select className={INPUT} value={ask.target} onChange={(e) => setAsk({ ...ask, target: e.target.value })} data-testid="dataroom-file-move-target">
            {folderChoices(room).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></label>
      </DataRoomDialog>
    );
  } else if (ask?.kind === 'rename') {
    const copy = renameCopy('file', file.name);
    dialog = (
      <DataRoomDialog copy={copy} disabled={!ask.name.trim() || ask.name.trim() === file.name} onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-file-rename"
        onConfirm={async () => { await patch({ name: ask.name.trim() }); changed(`Renamed to ${ask.name.trim()}.`); }}>
        <label className="flex flex-col gap-1"><span className={LABEL}>Name</span>
          <input className={INPUT} value={ask.name} maxLength={200} onChange={(e) => setAsk({ ...ask, name: e.target.value })} data-testid="dataroom-file-rename-name" /></label>
      </DataRoomDialog>
    );
  } else if (ask?.kind === 'replace') {
    const copy = { title: `Replace ${file.name}?`, body: 'The new file becomes the current version. The current one is kept as an earlier version, and the gate does not change.', action: 'Replace' };
    dialog = (
      <DataRoomDialog copy={copy} disabled={!ask.picked} onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-file-replace"
        onConfirm={async () => { const fd = new FormData(); fd.append('file', ask.picked); await cyclesApi.recordAction('raise', projectId, 'data-room', fileId, 'replace', fd); changed('Replaced; the previous version is kept.'); }}>
        <input type="file" onChange={(e) => setAsk({ ...ask, picked: e.target.files?.[0] || null })} aria-label="Choose the new file" data-testid="dataroom-file-replace-pick" />
      </DataRoomDialog>
    );
  } else if (ask?.kind === 'current') {
    const copy = makeCurrentCopy(file, ask.version);
    dialog = <DataRoomDialog copy={copy} onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-file-current" onConfirm={async () => { await dataRoomApi.makeCurrent(projectUid, file.uid, ask.version); changed(`Version ${ask.version} is current.`); }} />;
  } else if (ask?.kind === 'remove') {
    const copy = removeCopy([file], versions.status === 'ready' ? Math.max(0, vrows.length - 1) : null);
    dialog = (
      <DataRoomDialog copy={copy} danger onClose={() => setAsk(null)} refusalOf={roomRefusal} testId="dataroom-file-remove"
        onConfirm={async () => { await api.dataRoomDeleteFile(projectUid, file.uid); setAsk(null); onChanged(); onClose(); }}>
        <p className={`m-0 rounded-[8px] border border-axal-hairline px-3 py-2 text-[12.5px] ${MUTED} dark:border-gray-700`}>{copy.trash}</p>
      </DataRoomDialog>
    );
  }

  const answers = record.status === 'ready' ? answersOf(record.data) : null;
  const links = record.status === 'ready' ? linkRows(record.data) : [];
  return (
    <Lightbox label={file.name} eyebrow={`File · ${folder?.name || 'Top level'}`} title={file.name} onClose={onClose} width={720} testId="dataroom-file"
      footer={<div className="flex justify-end"><button type="button" className={actionGhost} onClick={onClose}>Close</button></div>}>
      <div className="flex flex-col gap-3.5 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100">
        <div className="flex flex-wrap gap-1.5" data-testid="dataroom-file-tags">
          {current ? <Pill tone="v">{`v${current.version} · Current`}</Pill> : null}
          <Pill>{gateWord(file)}</Pill>
          {file.visibility === 'nda' ? <Pill>NDA</Pill> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={() => download(null)} data-testid="dataroom-file-download">Download</button>
          <button type="button" className={BTN} onClick={() => setAsk({ kind: 'replace', picked: null })} data-testid="dataroom-file-replace-open">Replace</button>
          <button type="button" className={BTN} onClick={() => setAsk({ kind: 'move', target: folder?.uid || '' })} data-testid="dataroom-file-move-open">Move</button>
          <button type="button" className={BTN} onClick={() => setAsk({ kind: 'rename', name: file.name })} data-testid="dataroom-file-rename-open">Rename</button>
          <button type="button" className={`${BTN} text-red-700 dark:text-red-300`} disabled={!owner} title={owner ? undefined : OWNER_ONLY} onClick={() => setAsk({ kind: 'remove' })} data-testid="dataroom-file-remove-open">Remove</button>
        </div>
        <p className={`m-0 text-[12px] ${MUTED}`}>Download makes your own copy. It is not an investor event.</p>
        {link?.url ? <p className="m-0 text-[12.5px]" data-testid="dataroom-file-link">Your link to {link.label} is ready. <a className="font-semibold text-axal-violet underline" href={link.url}>Open it</a>; it works once, for two minutes.</p> : null}
        {link?.error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{link.error}</p> : null}
        {done ? <p role="status" className="m-0 rounded-[8px] bg-axal-lavender px-3 py-2 text-[12.5px] font-semibold dark:bg-violet-950/40" data-testid="dataroom-file-done">{done}</p> : null}

        <section className={SEC} data-testid="dataroom-file-who">
          <h3 className={EYE}>Who can open it now</h3>
          {who.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`}>The room is not shared with anyone in force now.</p> : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {who.map((w) => <li key={w.uid} className="flex flex-wrap items-center justify-between gap-2"><strong className="text-[13px] font-bold">{w.who}</strong><Pill tone={w.open ? 'g' : 'n'}>{w.open ? '✓' : '⊘'} {w.why}</Pill></li>)}
            </ul>
          )}
        </section>

        <section className={SEC} data-testid="dataroom-file-gate">
          <h3 className={EYE}>Gate</h3>
          {!owner ? <p className={`m-0 text-[12px] ${MUTED}`}>{OWNER_ONLY}</p> : null}
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" disabled={!owner}><legend className="sr-only">Who it is for</legend>
            {GATES.map((g) => (
              <label key={g.key} className="flex items-start gap-2">
                <input type="radio" name="dataroom-file-tier" checked={(file.access_tier || 'invited') === g.key} onChange={() => setAsk({ kind: 'gate', tier: g.key })} data-testid={`dataroom-file-tier-${g.key}`} />
                <span><strong className="font-bold">{g.label}</strong><span className={`block text-[12px] ${MUTED}`}>{g.note}</span></span>
              </label>
            ))}
            <label className="flex items-center gap-2"><input type="checkbox" checked={file.visibility === 'nda'} onChange={(e) => setAsk({ kind: 'gate', nda: e.target.checked })} data-testid="dataroom-file-nda" />Needs the NDA</label>
            <label className="flex flex-col gap-1"><span className={LABEL}>Access ends on</span>
              <input type="date" className={INPUT} value={file.access_expires_at ? String(file.access_expires_at).slice(0, 10) : ''} onChange={(e) => setAsk({ kind: 'end', until: e.target.value })} data-testid="dataroom-file-end" />
              <span className={`text-[12px] ${MUTED}`}>{file.access_expires_at ? `Ends ${day(file.access_expires_at)}.` : 'No end date.'}</span></label>
          </fieldset>
          <p className={`m-0 text-[11.5px] ${MUTED}`}>Each change opens a dialog that names who gains or loses this file.</p>
        </section>

        <section className={SEC} data-testid="dataroom-file-answers">
          <h3 className={EYE}>Answers</h3>
          {record.status === 'loading' ? <span className={`text-[12px] ${MUTED}`}>Reading…</span> : null}
          {record.status === 'error' ? <Failed what="What this file answers" onRetry={retryRecord} testId="dataroom-file-answers-unreadable" /> : null}
          {record.status === 'ready' ? <p className="m-0 text-[13px]">{answers ? `✓ ${answers}` : <span className={MUTED}>Not matched to a diligence request or a checklist item.</span>}</p> : null}
        </section>

        <section className={SEC} data-testid="dataroom-file-versions">
          <h3 className={EYE}>Versions</h3>
          {versions.status === 'loading' ? <span className={`text-[12px] ${MUTED}`}>Reading…</span> : null}
          {versions.status === 'error' ? <Failed what="The versions" onRetry={retryVersions} testId="dataroom-file-versions-unreadable" /> : null}
          {vrows.map((v) => (
            <div key={v.version} className="flex flex-wrap items-center justify-between gap-2" data-testid={`dataroom-file-version-${v.version}`}>
              <span><span className={`${MONO} font-bold`}>v{v.version}</span> {v.when} · {v.who} <span className={`${MONO} text-[11.5px] ${MUTED}`}>{v.size}</span></span>
              <span className="flex items-center gap-1.5">
                {v.current ? <Pill tone="v">✓ Current</Pill> : null}
                <button type="button" className={BTN} onClick={() => download(v.current ? null : v.version)} data-testid={`dataroom-file-version-download-${v.version}`}>Download</button>
                {!v.current ? <button type="button" className={BTN} onClick={() => setAsk({ kind: 'current', version: v.version })} data-testid={`dataroom-file-version-current-${v.version}`}>Make current</button> : null}
              </span>
            </div>
          ))}
        </section>

        <section className={SEC} data-testid="dataroom-file-links">
          <h3 className={EYE}>Links issued and refusals</h3>
          {record.status === 'error' ? <Failed what="The links issued" onRetry={retryRecord} testId="dataroom-file-links-unreadable" /> : null}
          {record.status === 'ready' && !links.length ? <p className={`m-0 text-[12.5px] ${MUTED}`}>No link issued and no refusal yet.</p> : null}
          {links.map((l, i) => <div key={i} className="flex items-center justify-between gap-2"><span><strong className="font-bold">{l.who}</strong> <span className={MUTED}>{l.what}</span></span><span className={`${MONO} text-[12px]`}>{l.when}</span></div>)}
          <p className={`m-0 text-[11.5px] ${MUTED}`}>A link issued is not proof the file was read. Each link works once, for one person.</p>
        </section>
      </div>
      {dialog}
    </Lightbox>
  );
}
