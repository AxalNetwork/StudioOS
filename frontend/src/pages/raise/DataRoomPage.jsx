import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  FolderPlus, Upload, Trash2, ShieldCheck, ShieldAlert, Users,
  FileText, Folder, FolderOpen, Loader2, ChevronRight, ChevronDown,
} from 'lucide-react';
import { Card, Pill, Unreadable, Unrecorded, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import AdvisorGrantSection from './AdvisorGrantSection';
import {
  ACCESS_TIERS, AUDIT_FILTERS, accessNow, auditLine, auditMatches, downloadsLabel,
  filesUnder, folderTree, noAccessReason, queueRefusal, roomStats,
} from './dataRoomRead';

/**
 * Data room — /raise/data-room. One route, two audiences.
 *
 * A founder sees their own project's room, rebuilt on the "Data Room" canvas's
 * founder view (D374): a stat strip, an upload queue, the folder tree with each
 * item's gate and download count, a settings panel for what is selected, who
 * the room is shared with, and the activity log with its filters. An
 * investor's side moved to Research · Diligence (D311):
 * `/research/diligence/:grantUid` is the room read by the grant they hold, and
 * App.jsx redirects an investor here to that list.
 *
 * Backed by routes/data_room.ts on migration 184.
 *
 * Two things the UI must be honest about, because the backend is:
 *
 *   - A download is NOT watermarked. There is no PDF pipeline; what actually
 *     protects a file is that the link is per-investor, single-use and
 *     expires in two minutes, and that opening it is logged. That is what the
 *     copy says.
 *   - Sharing does NOT send an invitation. The worker resolves the address to
 *     an existing account and 404s otherwise.
 *
 * And what the canvas draws that the room does not store, each said on the
 * page where it is drawn: two of its three access tiers (`dataRoomRead.js`
 * says why), per-file views (only downloads are logged), NDA terms (the NDA is
 * the e-sign rail's), a preview, and byte-level upload progress.
 */

const MAX_MB = 20;

const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';
const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm '
  + 'hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50';
const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 dark:hover:bg-violet-500 '
  + 'px-3 py-2 text-sm font-medium text-white disabled:opacity-50';

function Empty({ title, body }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</p>
      {body && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{body}</p>}
    </div>
  );
}

function VisibilityChip({ visibility }) {
  const nda = visibility === 'nda';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
      nda
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
    }`}>
      {nda ? <ShieldAlert size={10} /> : <ShieldCheck size={10} />}
      {nda ? 'NDA required' : 'Open to invited'}
    </span>
  );
}

function fmtBytes(n) {
  if (n == null) return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatTile({ k, v, sub }) {
  return (
    <Card>
      <div className={eyebrow}>{k}</div>
      {v === null
        ? <div className="mt-2"><Unrecorded reason={sub} /></div>
        : <div className="mt-1.5 font-mono text-[20px] font-bold tracking-tight text-axal-ink dark:text-gray-100">{v}</div>}
      <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Could not read that file'));
    fr.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ *
 * Upload queue                                                        *
 * ------------------------------------------------------------------ */

/**
 * Several files, sent one at a time. Each row says where it is — waiting,
 * sending, in the room, or refused and why. The bar shows that a file is being
 * sent, not how far: one request carries the whole file and the browser
 * reports no progress for it, so a percentage here would be invented.
 */
function UploadQueue({ projectUid, folders, onDone }) {
  const [queue, setQueue] = useState([]);
  const [folderUid, setFolderUid] = useState('');
  const [nda, setNda] = useState(false);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef(null);

  const set = (i, patch) => setQueue((q) => q.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  async function send(picked) {
    const list = Array.from(picked || []);
    if (!list.length) return;
    const start = queue.length;
    const rows = list.map((file) => {
      const refused = queueRefusal(file, MAX_MB);
      return { name: file.name, size: file.size, state: refused ? 'refused' : 'waiting', note: refused, file };
    });
    setQueue((q) => [...q, ...rows]);
    setRunning(true);
    for (let k = 0; k < rows.length; k++) {
      if (rows[k].state === 'refused') continue;
      const i = start + k;
      set(i, { state: 'sending' });
      try {
        const data = await readAsDataUrl(rows[k].file);
        await api.dataRoomUploadFile(projectUid, {
          name: rows[k].name, data, visibility: nda ? 'nda' : 'open', ...(folderUid ? { folder_uid: folderUid } : {}),
        });
        set(i, { state: 'done', file: null });
      } catch (e) {
        set(i, { state: 'failed', note: e?.message || 'The upload did not go through', file: null });
      }
    }
    setRunning(false);
    onDone();
  }

  const label = { waiting: 'Waiting', sending: 'Sending', done: 'In the room', failed: 'Failed', refused: 'Not sent' };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={eyebrow}>Upload files</div>
        {queue.length > 0 && !running && (
          <button type="button" className="text-xs text-gray-500 underline" onClick={() => setQueue([])}>Clear the list</button>
        )}
      </div>
      <div
        role="button" tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!running) send(e.dataTransfer?.files); }}
        className={`mt-2 rounded-xl border-2 border-dashed p-5 text-center cursor-pointer ${
          over ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/30' : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
      >
        <Upload size={18} className="mx-auto text-gray-400" />
        <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">Drag files here, or click to browse</p>
        <p className="text-xs text-gray-500">Up to {MAX_MB} MB per file.</p>
      </div>
      <input
        ref={input} type="file" multiple className="hidden"
        onChange={(e) => { send(e.target.files); e.target.value = ''; }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <span className="text-xs text-gray-500">Into</span>
          <select
            value={folderUid} onChange={(e) => setFolderUid(e.target.value)} disabled={running}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm"
          >
            <option value="">The room’s top level</option>
            {folders.map((f) => <option key={f.uid} value={f.uid}>{f.name}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={nda} onChange={(e) => setNda(e.target.checked)} disabled={running} />
          Require a signed NDA for these files
        </label>
      </div>
      {queue.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800" data-testid="upload-queue">
          {queue.map((row, i) => (
            <li key={`${row.name}-${i}`} className="py-2">
              <div className="flex items-center gap-3 text-sm">
                <FileText size={14} className="shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">{row.name}</span>
                <span className="text-xs tabular-nums text-gray-500">{fmtBytes(row.size) || <Unrecorded />}</span>
                <span className={`text-xs font-medium ${
                  row.state === 'done' ? 'text-emerald-700 dark:text-emerald-400'
                    : row.state === 'failed' || row.state === 'refused' ? 'text-red-700 dark:text-red-300' : 'text-gray-500'}`}
                >
                  {label[row.state]}
                </span>
              </div>
              {row.state === 'sending' && (
                <div className="mt-1.5 h-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
                  <div className="h-1 w-1/3 animate-pulse rounded bg-violet-500" />
                </div>
              )}
              {row.note && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{row.note}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] text-axal-muted">
        Files go one at a time. The bar says a file is being sent, not how far along it is — the browser reports no progress for this upload.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Folder tree                                                         *
 * ------------------------------------------------------------------ */

function FileRow({ file, depth, selected, onSelect }) {
  const downloads = downloadsLabel(file.downloads);
  return (
    <button
      type="button" onClick={() => onSelect({ kind: 'file', uid: file.uid })}
      className={`flex w-full items-center gap-2 py-2 pr-3 text-left text-sm ${
        selected ? 'bg-violet-50 dark:bg-violet-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
      style={{ paddingLeft: 12 + depth * 18 }}
    >
      <FileText size={14} className="shrink-0 text-gray-400" />
      <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">{file.name}</span>
      {file.visibility === 'nda' && <Pill tone="warn">NDA</Pill>}
      <span className="w-16 text-right text-xs tabular-nums text-gray-500">{fmtBytes(file.size_bytes) || <Unrecorded />}</span>
      <span className="w-24 text-right text-xs tabular-nums text-gray-500">{downloads || <Unrecorded />}</span>
    </button>
  );
}

function FolderNode({ node, depth, open, toggle, selected, onSelect }) {
  const isOpen = !!open[node.folder.uid];
  const count = filesUnder(node).length;
  return (
    <>
      <button
        type="button"
        onClick={() => { toggle(node.folder.uid); onSelect({ kind: 'folder', uid: node.folder.uid }); }}
        className={`flex w-full items-center gap-2 py-2 pr-3 text-left text-sm ${
          selected?.kind === 'folder' && selected.uid === node.folder.uid
            ? 'bg-violet-50 dark:bg-violet-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
        style={{ paddingLeft: 12 + depth * 18 }}
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
        {isOpen ? <FolderOpen size={14} className="text-gray-400" /> : <Folder size={14} className="text-gray-400" />}
        <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-gray-100">{node.folder.name}</span>
        <span className="text-xs text-gray-500">{`${count} file${count === 1 ? '' : 's'}`}</span>
        <VisibilityChip visibility={node.folder.visibility} />
      </button>
      {isOpen && (
        <>
          {node.folders.map((child) => (
            <FolderNode key={child.folder.uid} node={child} depth={depth + 1} open={open} toggle={toggle} selected={selected} onSelect={onSelect} />
          ))}
          {node.files.map((f) => (
            <FileRow key={f.uid} file={f} depth={depth + 1} selected={selected?.kind === 'file' && selected.uid === f.uid} onSelect={onSelect} />
          ))}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Settings for what is selected                                       *
 * ------------------------------------------------------------------ */

function Settings({ item, kind, node, grants, busy, onGate, onDelete }) {
  const [carry, setCarry] = useState(true);
  if (!item) {
    return (
      <Card variant="dashed">
        <p className="text-sm text-axal-muted">Select a folder or a file to see who can open it and to change its gate.</p>
      </Card>
    );
  }
  const nda = item.visibility === 'nda';
  const who = accessNow(item, grants);
  const inside = kind === 'folder' ? filesUnder(node).length : 0;
  const meta = kind === 'file'
    ? [fmtBytes(item.size_bytes), downloadsLabel(item.downloads), fmtWhen(item.created_at) && `added ${fmtWhen(item.created_at)}`].filter(Boolean).join(' · ')
    : `${inside} file${inside === 1 ? '' : 's'} inside`;
  return (
    <Card data-testid="data-room-settings">
      <div className={eyebrow}>{kind === 'folder' ? 'Folder settings' : 'File settings'}</div>
      <h3 className="mt-1 truncate text-[15px] font-bold text-axal-ink dark:text-gray-100">{item.name}</h3>
      <p className="text-xs text-axal-muted">{meta}</p>

      <div className={`${eyebrow} mt-4`}>Who can see this</div>
      <ul className="mt-1.5 space-y-1.5">
        {ACCESS_TIERS.map((t) => (
          <li key={t.label} className={`rounded-lg border p-2.5 ${
            t.built ? 'border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30' : 'border-gray-200 dark:border-gray-800'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm font-semibold ${t.built ? 'text-axal-ink dark:text-gray-100' : 'text-gray-500'}`}>{t.label}</span>
              {t.built ? <Pill tone="info">This room</Pill> : <Pill>Not built</Pill>}
            </div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-axal-muted">{t.note}</p>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-axal-ink dark:text-gray-100">Require signed NDA</div>
          <p className="text-[11.5px] text-axal-muted">
            {kind === 'folder'
              ? 'An investor needs a signed NDA with you before this folder’s name is shown.'
              : 'An investor needs a signed NDA with you before this file is listed or downloads.'}
          </p>
        </div>
        <button
          type="button" role="switch" aria-checked={nda} disabled={busy}
          onClick={() => onGate(nda ? 'open' : 'nda', kind === 'folder' && carry)}
          className={`relative h-6 w-10 shrink-0 rounded-full transition ${nda ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-700'} disabled:opacity-50`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${nda ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>
      {kind === 'folder' && (
        <label className="mt-2 flex items-start gap-2 text-[11.5px] text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} className="mt-0.5" />
          <span>
            Also set every folder and file inside. Each file keeps its own gate, and the file’s gate is what the
            download checks — so without this, marking the folder hides only its name.
          </span>
        </label>
      )}

      <div className={`${eyebrow} mt-4`}>With access now</div>
      {who.length === 0 ? (
        <p className="mt-1.5 text-[12px] text-axal-muted">{noAccessReason(item, grants)}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {who.map((g) => (
            <li key={g.uid} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-gray-900 dark:text-gray-100">{g.investor_name || g.investor_email}</span>
              <span className="text-[11px] text-gray-500">{g.nda_signed ? 'NDA signed' : 'no NDA on file'}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={`${eyebrow} mt-4`}>NDA terms</div>
      <p className="mt-1 text-[12px] text-axal-muted">
        <Unrecorded reason="The mutual NDA is signed through the e-sign rail; its terms are not stored with this room." />
        {' — '}the NDA is the one signed through e-sign; this room reads only whether it is active.
      </p>

      <p className="mt-4 rounded-lg bg-gray-50 p-2.5 text-[11.5px] leading-relaxed text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
        Not watermarked. A download is a link for one investor that works once and expires after two minutes, and
        it is logged. Changing a gate stops the next download; it does not reach a copy already saved.
      </p>

      <button type="button" disabled={busy} onClick={onDelete} className="mt-3 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600">
        <Trash2 size={12} /> {kind === 'folder' ? 'Delete this folder (its files move to the top level)' : 'Delete this file'}
      </button>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Activity log                                                        *
 * ------------------------------------------------------------------ */

function ActivityLog({ events }) {
  const [filter, setFilter] = useState('All');
  const rows = events.filter((e) => auditMatches(e, filter));
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Activity log</h2>
        <div className="flex flex-wrap gap-1" role="tablist">
          {AUDIT_FILTERS.map((f) => (
            <button
              key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                filter === f ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11.5px] text-axal-muted">
        The last fifty events. View is opening the room; NDA is anything on an NDA-marked file; Blocked is a
        download the NDA refused. Signing an NDA is recorded by e-sign, not here.
      </p>
      {rows.length === 0 ? (
        <div className="mt-3">
          <Empty
            title="No activity of this kind yet"
            body="Events appear here when an investor opens the room, downloads a file, or is refused one."
          />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800" data-testid="data-room-activity">
          {rows.map((a, i) => {
            const line = auditLine(a);
            return (
              <li key={i} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">
                  <strong className="font-semibold">{a.user_name || a.user_email}</strong>
                  {` ${line.verb}`}
                  {line.what && <span className="text-gray-600 dark:text-gray-300">{` ${line.what}`}</span>}
                </span>
                {line.tag && <Pill tone={line.tag === 'Blocked' ? 'warn' : 'neutral'}>{line.tag}</Pill>}
                <span className="whitespace-nowrap text-xs text-gray-400">{fmtWhen(a.created_at) || <Unrecorded />}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Founder                                                             *
 * ------------------------------------------------------------------ */

function FounderRoom({ projects, initialProjectUid }) {
  // NOT STATE ANY MORE (#181): the in-body picker was its only setter. The
  // parent remounts this component with `key={initialProjectUid}`, so the room
  // still follows `?project_id=` — it just cannot be switched from the body.
  const projectUid = initialProjectUid || projects[0]?.uid || '';
  const [room, setRoom] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | unreadable
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({});
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    if (!projectUid) return;
    try {
      setRoom(await api.dataRoom(projectUid));
      setState('ready');
    } catch (e) {
      reportError('data_room_load_failed', e);
      setState('unreadable');
    }
  }, [projectUid]);

  useEffect(() => { setRoom(null); setState('loading'); load(); }, [load]);

  async function guard(fn) {
    setBusy(true); setErr('');
    try { await fn(); await load(); }
    catch (e) { setErr(e?.message || 'That did not work'); }
    finally { setBusy(false); }
  }

  const files = room?.files || [];
  const folders = room?.folders || [];
  const grants = room?.grants || [];
  const tree = useMemo(() => folderTree(folders, files), [folders, files]);
  const findNode = (n, uid) => {
    for (const c of n.folders) { if (c.folder.uid === uid) return c; const hit = findNode(c, uid); if (hit) return hit; }
    return null;
  };
  const selNode = selected?.kind === 'folder' ? findNode(tree, selected.uid) : null;
  const selItem = selected?.kind === 'folder' ? selNode?.folder : files.find((f) => f.uid === selected?.uid);
  const activeGrants = grants.filter((g) => g.status === 'active');

  if (state === 'loading') return <p className="text-sm text-gray-500">Loading…</p>;
  if (state === 'unreadable') {
    return (
      <Card variant="dashed" padding="lg">
        <Unreadable
          what="This data room"
          claim="Nothing is shown rather than an empty room, which would say nothing was ever uploaded or shared."
          onRetry={() => { setState('loading'); load(); }}
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-6">
        {/* The in-body startup picker is gone (#181) — see MarketIntelPage for the
            reasoning. `projectUid` still defaults to `projects[0]?.uid`, which is
            what it resolved to whenever the picker was hidden. */}

        {err && <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300" role="alert">{err}</div>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="data-room-stats">
          {roomStats(room).map((s) => <StatTile key={s.k} {...s} />)}
        </div>

        <UploadQueue projectUid={projectUid} folders={folders} onDone={load} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Folders</h2>
              <button
                type="button" disabled={busy || !projectUid} className={btn}
                onClick={() => {
                  const name = prompt('Folder name');
                  if (name) guard(() => api.dataRoomCreateFolder(projectUid, { name }));
                }}
              >
                <FolderPlus size={15} /> New folder
              </button>
            </div>
            {files.length === 0 && folders.length === 0 ? (
              <Empty title="Nothing in the room yet." body="Upload a file, and choose whether it needs an NDA." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800" data-testid="data-room-tree">
                <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:bg-gray-900">
                  <span className="flex-1">Name</span><span className="w-16 text-right">Size</span><span className="w-24 text-right">Downloads</span>
                </div>
                {tree.folders.map((n) => (
                  <FolderNode
                    key={n.folder.uid} node={n} depth={0} open={open} selected={selected} onSelect={setSelected}
                    toggle={(uid) => setOpen((o) => ({ ...o, [uid]: !o[uid] }))}
                  />
                ))}
                {tree.files.map((f) => (
                  <FileRow key={f.uid} file={f} depth={0} selected={selected?.kind === 'file' && selected.uid === f.uid} onSelect={setSelected} />
                ))}
              </div>
            )}
            <p className="mt-2 text-[11.5px] text-axal-muted">
              A file’s figure is its downloads. Nothing here previews a file, so there is no per-file view to count.
            </p>
          </section>

          <Settings
            key={selected ? `${selected.kind}:${selected.uid}` : 'none'}
            item={selItem} kind={selected?.kind} node={selNode} grants={grants} busy={busy}
            onGate={(visibility, carry) => guard(() => (selected.kind === 'folder'
              ? api.dataRoomUpdateFolder(projectUid, selected.uid, { visibility, ...(carry ? { apply_to_contents: true } : {}) })
              : api.dataRoomUpdateFile(projectUid, selected.uid, { visibility })))}
            onDelete={() => guard(async () => {
              if (selected.kind === 'folder') await api.dataRoomDeleteFolder(projectUid, selected.uid);
              else await api.dataRoomDeleteFile(projectUid, selected.uid);
              setSelected(null);
            })}
          />
        </div>

        <section>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 inline-flex items-center gap-2">
            <Users size={15} /> Shared with
          </h2>
          <div className="flex gap-2 mb-3">
            <input
              type="email" placeholder="investor@fund.com" id="dr-grant-email"
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
            />
            <button
              type="button" disabled={busy} className={primary}
              onClick={() => {
                const el = document.getElementById('dr-grant-email');
                const email = el?.value?.trim();
                if (email) guard(async () => { await api.dataRoomGrant(projectUid, { email }); el.value = ''; });
              }}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : null} Share
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            This links an <strong>existing</strong> Axal account — it does not send an invitation.
            NDA-marked files stay hidden until that person has a signed NDA on file.
          </p>
          {grants.length === 0 ? (
            <Empty title="Not shared with anyone yet." />
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {grants.map((g) => (
                <div key={g.uid} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{g.investor_name || g.investor_email}</div>
                    <div className="text-[11px] text-gray-500">
                      {g.investor_name ? `${g.investor_email} · ` : ''}
                      {g.status === 'active' ? `shared ${fmtWhen(g.created_at) || 'on a date not recorded'}` : 'access revoked'}
                      {' · '}
                      {g.nda_signed ? 'NDA signed' : 'no NDA on file'}
                    </div>
                  </div>
                  {g.status === 'active' && (
                    <button type="button" disabled={busy}
                      onClick={() => guard(() => api.dataRoomRevoke(projectUid, g.uid))}
                      className="text-xs text-gray-500 hover:text-red-600">
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* The second grant type, beside the first. Both answer "who sees my
            company"; splitting them across two screens is how a founder ends up
            believing they revoked something they did not. */}
        <AdvisorGrantSection projectUid={projectUid} />

        <ActivityLog events={room?.recent_access || []} />
      </div>

      <WorkerRail
        workspace="Raise"
        role="founder"
        stance="Your room, your gates"
        note="Every figure here is counted from the room’s own log: opens, downloads, and downloads the NDA refused. Nothing is drafted or sent from this page."
        coverage={[
          `${files.length} file${files.length === 1 ? '' : 's'} in ${folders.length} folder${folders.length === 1 ? '' : 's'}`,
          `${activeGrants.length} investor${activeGrants.length === 1 ? '' : 's'} with access`,
        ]}
        coverageNote="The activity list is the last fifty events; the weekly figures count the whole log."
        unavailable={[
          ['Committed-only and private tiers', 'The investor reads show a file to anyone with a grant and a signed NDA, so a third mark would leak.'],
          ['Watermark and preview', 'There is no PDF pipeline in the worker; a download is single-use, expires in two minutes, and is logged.'],
          ['Per-file views', 'Only downloads are logged per file.'],
        ]}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function DataRoomPage({ user }) {
  const role = String(user?.role || '').toLowerCase();
  const isFounder = role === 'founder' || role === 'admin';
  const [projects, setProjects] = useState(null);
  const [projectsFailed, setProjectsFailed] = useState(false);
  const [searchParams] = useSearchParams();

  const loadProjects = useCallback(() => {
    if (!isFounder) { setProjects([]); return; }
    setProjectsFailed(false);
    setProjects(null);
    api.listProjects()
      .then((d) => setProjects(Array.isArray(d) ? d : (d?.items || [])))
      .catch((e) => { reportError('data_room_projects_failed', e); setProjectsFailed(true); });
  }, [isFounder]);
  useEffect(() => { loadProjects(); }, [loadProjects]);

  const body = useMemo(() => {
    // An investor's rooms live under Research · Diligence (D311); App.jsx
    // redirects them before this page mounts, and this is the same answer if
    // anything renders the page for them anyway.
    if (!isFounder) return <Navigate to="/research/diligence" replace />;
    if (projectsFailed) {
      return (
        <Card variant="dashed" padding="lg">
          <Unreadable
            what="Your projects"
            claim="This is not a claim that you have none — the room cannot be chosen until the list is read."
            onRetry={loadProjects}
          />
        </Card>
      );
    }
    if (projects === null) return <p className="text-sm text-gray-500">Loading…</p>;
    if (projects.length === 0) {
      return <Empty title="No project yet." body="A data room belongs to a venture — create one first." />;
    }
    const requested = projects.find((project) => String(project.id) === searchParams.get('project_id'));
    const initialProjectUid = requested?.uid || projects[0]?.uid || '';
    return <FounderRoom key={initialProjectUid} projects={projects} initialProjectUid={initialProjectUid} />;
  }, [isFounder, projects, projectsFailed, searchParams, loadProjects]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Data room</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {isFounder
            ? 'Share diligence documents with named investors. Mark anything sensitive as NDA-only.'
            : 'Documents founders have shared with you.'}
        </p>
      </header>
      {body}
    </div>
  );
}
