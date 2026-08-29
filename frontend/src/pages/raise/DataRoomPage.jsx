import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderPlus, Upload, Trash2, ShieldCheck, ShieldAlert, Users, Download,
  FileText, Folder, Loader2, X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

/**
 * Data room — /raise/data-room. One route, two audiences.
 *
 * A founder sees their own project's room: folders, files, who it is shared
 * with, and what those people opened. An investor sees the rooms shared with
 * them. The role decides which, so there is no second top-level route and no
 * page that shows two companies at once.
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
 */

const MAX_MB = 20;

function Empty({ title, body }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
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
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------------------------------------------ *
 * Founder                                                             *
 * ------------------------------------------------------------------ */

function FounderRoom({ projects }) {
  const [projectUid, setProjectUid] = useState(projects[0]?.uid || '');
  const [room, setRoom] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    if (!projectUid) return;
    setErr('');
    try { setRoom(await api.dataRoom(projectUid)); }
    catch (e) { reportError('data_room_load_failed', e); setErr(e?.message || 'Could not load the data room'); }
  }, [projectUid]);

  useEffect(() => { setRoom(null); load(); }, [load]);

  async function guard(fn) {
    setBusy(true); setErr('');
    try { await fn(); await load(); }
    catch (e) { setErr(e?.message || 'That did not work'); }
    finally { setBusy(false); }
  }

  async function onUpload(file) {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setErr(`${file.name} is larger than ${MAX_MB} MB`);
      return;
    }
    const data = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Could not read that file'));
      fr.readAsDataURL(file);
    });
    await guard(() => api.dataRoomUploadFile(projectUid, { name: file.name, data, visibility: 'open' }));
  }

  const files = room?.files || [];
  const folders = room?.folders || [];
  const grants = room?.grants || [];

  return (
    <div className="space-y-6">
      {projects.length > 1 && (
        <select
          value={projectUid}
          onChange={(e) => setProjectUid(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          aria-label="Project"
        >
          {projects.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
        </select>
      )}

      {err && <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">{err}</div>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button" disabled={busy || !projectUid}
          onClick={() => {
            const name = prompt('Folder name');
            if (name) guard(() => api.dataRoomCreateFolder(projectUid, { name }));
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm disabled:opacity-50"
        >
          <FolderPlus size={15} /> New folder
        </button>
        <button
          type="button" disabled={busy || !projectUid}
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Upload
        </button>
        <input
          ref={fileInput} type="file" className="hidden"
          onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ''; }}
        />
        <span className="self-center text-xs text-gray-500">Up to {MAX_MB} MB per file.</span>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Documents</h2>
        {!room ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : files.length === 0 && folders.length === 0 ? (
          <Empty title="Nothing in the room yet." body="Upload a file, and choose whether it needs an NDA." />
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {folders.map((f) => (
              <div key={f.uid} className="flex items-center gap-3 p-3">
                <Folder size={15} className="text-gray-400 shrink-0" />
                <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 truncate">{f.name}</span>
                <VisibilityChip visibility={f.visibility} />
                <button type="button" disabled={busy}
                  onClick={() => guard(() => api.dataRoomDeleteFolder(projectUid, f.uid))}
                  className="text-gray-400 hover:text-red-600" aria-label={`Delete folder ${f.name}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {files.map((f) => (
              <div key={f.uid} className="flex items-center gap-3 p-3">
                <FileText size={15} className="text-gray-400 shrink-0" />
                <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 truncate">{f.name}</span>
                <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{fmtBytes(f.size_bytes)}</span>
                <button type="button" disabled={busy}
                  onClick={() => guard(() => api.dataRoomUpdateFile(projectUid, f.uid, {
                    visibility: f.visibility === 'nda' ? 'open' : 'nda',
                  }))}
                  title="Toggle whether this file needs a signed NDA">
                  <VisibilityChip visibility={f.visibility} />
                </button>
                <button type="button" disabled={busy}
                  onClick={() => guard(() => api.dataRoomDeleteFile(projectUid, f.uid))}
                  className="text-gray-400 hover:text-red-600" aria-label={`Delete ${f.name}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

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
            type="button" disabled={busy}
            onClick={() => {
              const el = document.getElementById('dr-grant-email');
              const email = el?.value?.trim();
              if (email) guard(async () => { await api.dataRoomGrant(projectUid, { email }); el.value = ''; });
            }}
            className="rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Share
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
                  <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{g.investor_email}</div>
                  <div className="text-[11px] text-gray-500">
                    {g.status === 'active' ? `shared ${fmtWhen(g.created_at)}` : 'access revoked'}
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

      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Recent activity</h2>
        {(room?.recent_access || []).length === 0 ? (
          <Empty title="Nobody has opened the room yet." />
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {room.recent_access.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="truncate text-gray-900 dark:text-gray-100">{a.user_email}</span>
                <span className="text-xs text-gray-500 truncate">
                  {a.action === 'download' ? `downloaded ${a.file_name || 'a file'}` : 'opened the room'}
                </span>
                <span className="text-xs text-gray-400 whitespace-nowrap">{fmtWhen(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Investor                                                            *
 * ------------------------------------------------------------------ */

function SharedRooms() {
  const [rooms, setRooms] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.dataRoomsSharedWithMe()
      .then((d) => setRooms(d?.items || []))
      .catch((e) => { reportError('data_room_shared_failed', e); setErr(e?.message || 'Could not load'); });
  }, []);

  useEffect(() => {
    if (!open) { setDetail(null); return; }
    let cancelled = false;
    api.dataRoomShared(open)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not open that room'); });
    return () => { cancelled = true; };
  }, [open]);

  async function download(fileUid) {
    setErr('');
    try {
      const res = await api.dataRoomDownload(open, fileUid);
      if (res?.url) window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) { setErr(e?.message || 'Could not start that download'); }
  }

  if (err) return <div className="text-sm text-red-600 dark:text-red-400">{err}</div>;
  if (!rooms) return <p className="text-sm text-gray-500">Loading…</p>;
  if (rooms.length === 0) {
    return <Empty title="No data rooms have been shared with you." body="A founder shares a room from their own Raise workspace." />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {rooms.map((rm) => (
          <button key={rm.project_uid} type="button" onClick={() => setOpen(rm.project_uid)}
            className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{rm.project_name}</span>
            <span className="text-xs text-gray-500 whitespace-nowrap">{rm.file_count} files</span>
          </button>
        ))}
      </div>

      {open && detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button aria-label="Close" onClick={() => setOpen(null)} className="flex-1 bg-black/30" />
          <div className="w-full max-w-lg overflow-y-auto bg-white dark:bg-gray-900 shadow-xl">
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{detail.project?.name}</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  {detail.nda_signed ? 'NDA signed — you can see everything shared with you.' : 'No NDA on file.'}
                </p>
              </div>
              <button onClick={() => setOpen(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              {(detail.files || []).length === 0 ? (
                <Empty title="Nothing shared here yet." />
              ) : (
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  {detail.files.map((f) => (
                    <div key={f.uid} className="flex items-center gap-3 p-3">
                      <FileText size={15} className="shrink-0 text-gray-400" />
                      <span className="flex-1 truncate text-sm text-gray-900 dark:text-gray-100">{f.name}</span>
                      <span className="text-xs text-gray-500 tabular-nums">{fmtBytes(f.size_bytes)}</span>
                      <button type="button" onClick={() => download(f.uid)}
                        className="inline-flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300 hover:underline">
                        <Download size={13} /> Download
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {detail.withheld_behind_nda > 0 && (
                <p className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
                  {detail.withheld_behind_nda} more {detail.withheld_behind_nda === 1 ? 'document is' : 'documents are'} behind
                  an NDA. Sign one with this company and they appear here.
                </p>
              )}

              <p className="text-[11px] text-gray-500">
                Download links are issued to you alone, work once, and expire after two minutes.
                The founder can see which documents you opened. Files are not watermarked.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function DataRoomPage({ user }) {
  const role = String(user?.role || '').toLowerCase();
  const isFounder = role === 'founder' || role === 'admin';
  const [projects, setProjects] = useState(null);

  useEffect(() => {
    if (!isFounder) { setProjects([]); return; }
    api.listProjects()
      .then((d) => setProjects(Array.isArray(d) ? d : (d?.items || [])))
      .catch((e) => { reportError('data_room_projects_failed', e); setProjects([]); });
  }, [isFounder]);

  const body = useMemo(() => {
    if (!isFounder) return <SharedRooms />;
    if (projects === null) return <p className="text-sm text-gray-500">Loading…</p>;
    if (projects.length === 0) {
      return <Empty title="No project yet." body="A data room belongs to a venture — create one first." />;
    }
    return <FounderRoom projects={projects} />;
  }, [isFounder, projects]);

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
