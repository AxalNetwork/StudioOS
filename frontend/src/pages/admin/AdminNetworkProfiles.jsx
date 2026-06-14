/**
 * Task #1 — Admin mentor & partner network profiles.
 *
 * Admin-only roster that feeds the Axal VC Spin-Out Demo Day deck's
 * Mentors & Network slide. CRUD + photo upload + drag-to-reorder +
 * active toggle. Skills are picked from a fixed 12-axis catalog
 * (mirrors SKILL_CATALOG in cloudflare-worker/src/services/
 * networkProfilesSchema.ts — keep in sync).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Plus, RefreshCw, Loader2, Archive, Edit3, GripVertical,
  X, Eye, EyeOff, Image as ImageIcon, AlertCircle, ExternalLink,
} from 'lucide-react';
import { adminNetworkProfiles as api } from '../../lib/api';
import { useToast } from '../../components/useToast';
import { useEscapeClose } from '../../hooks/useEscapeClose';

const SKILL_CATALOG = [
  'Legal', 'Finance', 'GTM', 'Sales', 'Marketing', 'Product',
  'Engineering', 'Design', 'Recruiting', 'Technical DD',
  'Operations', 'Fundraising',
];
const NETWORK_KINDS = ['mentor', 'partner', 'advisor', 'investor'];

const EMPTY = {
  name: '', kind: 'mentor', role: '', company: '', bio: '',
  linkedin_url: '', skills: [], is_active: true,
};

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

function readFileAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(file);
  });
}

function SkillPicker({ value, onChange }) {
  const sel = new Set(value);
  return (
    <div className="flex flex-wrap gap-1">
      {SKILL_CATALOG.map((s) => {
        const on = sel.has(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== s) : [...value, s])}
            className={`text-xs px-2 py-1 rounded-full border transition ${
              on
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-violet-400'
            }`}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

function EditorModal({ initial, onClose, onSave, onPhoto, busy }) {
  useEscapeClose(onClose);
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(initial || {}) }));
  const [photoErr, setPhotoErr] = useState('');
  const fileRef = useRef(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submitPhoto = async (file) => {
    setPhotoErr('');
    if (!file) return;
    if (!ALLOWED_MIME.includes(file.type)) { setPhotoErr('JPG, PNG, or WebP only.'); return; }
    if (file.size > MAX_PHOTO_BYTES) { setPhotoErr('Photo must be ≤ 2 MB.'); return; }
    try {
      const dataUri = await readFileAsDataUri(file);
      await onPhoto(dataUri);
    } catch (e) {
      setPhotoErr(e?.message || 'Upload failed.');
    }
  };

  const canSave = String(form.name || '').trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl mt-12 mb-12">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {initial?.id ? 'Edit profile' : 'New profile'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <X className="w-5 h-5 text-zinc-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {initial?.id && (
            <div className="flex items-center gap-3">
              {initial.photo_url ? (
                <img src={initial.photo_url} alt={form.name} className="w-16 h-16 rounded-lg object-cover bg-zinc-100 dark:bg-zinc-800" />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-violet-500 to-amber-400 flex items-center justify-center text-white text-xl font-bold">
                  {(form.name || '?').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ALLOWED_MIME.join(',')}
                  className="hidden"
                  onChange={(e) => submitPhoto(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <ImageIcon className="w-4 h-4" /> Upload photo
                </button>
                <div className="text-xs text-zinc-500 mt-1">JPG / PNG / WebP, square recommended, ≤ 2 MB.</div>
                {photoErr && <div className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{photoErr}</div>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Name *</div>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                maxLength={200}
                placeholder="Jane Doe"
              />
            </label>
            <label className="block">
              <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Kind</div>
              <select
                value={form.kind}
                onChange={(e) => set('kind', e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              >
                {NETWORK_KINDS.map((k) => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Role / title</div>
            <input
              value={form.role || ''}
              onChange={(e) => set('role', e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              maxLength={200}
              placeholder="Partner @ Acme Capital"
            />
          </label>

          <label className="block">
            <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Company / affiliation</div>
            <input
              value={form.company || ''}
              onChange={(e) => set('company', e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              maxLength={200}
              placeholder="Acme Capital"
            />
          </label>

          <label className="block">
            <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Bio</div>
            <textarea
              value={form.bio || ''}
              onChange={(e) => set('bio', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              maxLength={2000}
              placeholder="One- or two-sentence biography surfaced in deck tooltips."
            />
          </label>

          <label className="block">
            <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">LinkedIn URL</div>
            <input
              value={form.linkedin_url || ''}
              onChange={(e) => set('linkedin_url', e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              placeholder="https://www.linkedin.com/in/…"
            />
          </label>

          <div>
            <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Skills (12-axis catalog)</div>
            <SkillPicker value={form.skills || []} onChange={(v) => set('skills', v)} />
          </div>

          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">Active (visible on Demo Day deck)</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-200 dark:border-zinc-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!canSave || busy}
            className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded inline-flex items-center gap-1"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminNetworkProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.list();
      setProfiles(Array.isArray(data?.profiles) ? data.profiles : []);
    } catch (e) {
      toast(e?.message || 'Failed to load profiles', 'error');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (form) => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        kind: form.kind,
        role: form.role || null,
        company: form.company || null,
        bio: form.bio || null,
        linkedin_url: form.linkedin_url || null,
        skills: form.skills || [],
        is_active: !!form.is_active,
      };
      if (editing?.id) {
        await api.update(editing.id, payload);
        toast('Profile updated', 'success');
      } else {
        await api.create(payload);
        toast('Profile created', 'success');
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast(e?.message || 'Save failed', 'error');
    } finally { setBusy(false); }
  }, [editing, toast, load]);

  const uploadPhoto = useCallback(async (dataUri) => {
    if (!editing?.id) return;
    setBusy(true);
    try {
      const r = await api.uploadPhoto(editing.id, dataUri);
      toast('Photo uploaded', 'success');
      setEditing((cur) => cur ? { ...cur, photo_url: `${r.photo_url}?t=${Date.now()}` } : cur);
      await load();
    } catch (e) {
      toast(e?.message || 'Upload failed', 'error');
      throw e;
    } finally { setBusy(false); }
  }, [editing, toast, load]);

  const remove = useCallback(async (p) => {
    if (!window.confirm(
      `Archive profile for "${p.name}"?\n\nIt will be hidden from the Demo Day deck immediately. ` +
      `The record (including photo) is preserved so you can re-activate it later from this list.`,
    )) return;
    try {
      await api.remove(p.id);
      toast('Profile archived', 'success');
      await load();
    } catch (e) { toast(e?.message || 'Archive failed', 'error'); }
  }, [toast, load]);

  const toggleActive = useCallback(async (p) => {
    try {
      await api.update(p.id, { is_active: !p.is_active });
      await load();
    } catch (e) { toast(e?.message || 'Update failed', 'error'); }
  }, [toast, load]);

  const onDragStart = (id) => setDragId(id);
  const onDragOver = (e) => e.preventDefault();
  const onDrop = async (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const ordered = [...profiles];
    const fromIdx = ordered.findIndex((p) => p.id === dragId);
    const toIdx = ordered.findIndex((p) => p.id === targetId);
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); return; }
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    setProfiles(ordered);
    setDragId(null);
    try { await api.reorder(ordered.map((p) => p.id)); }
    catch (e) { toast(e?.message || 'Reorder failed', 'error'); await load(); }
  };

  const counts = useMemo(() => {
    const m = { mentor: 0, partner: 0, advisor: 0, investor: 0, total: 0, active: 0 };
    for (const p of profiles) {
      m.total += 1; if (p.is_active) m.active += 1;
      if (p.kind in m) m[p.kind] += 1;
    }
    return m;
  }, [profiles]);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Users className="w-6 h-6 text-violet-600" /> Mentor & partner network
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Admin-only roster powering the Spin-Out Demo Day deck's Mentors & Network slide.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={() => setEditing({ ...EMPTY })}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded">
            <Plus className="w-4 h-4" /> New profile
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        {[
          ['Total', counts.total], ['Active', counts.active],
          ['Mentors', counts.mentor], ['Partners', counts.partner],
          ['Advisors', counts.advisor], ['Investors', counts.investor],
        ].map(([label, n]) => (
          <div key={label} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded p-3">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
            <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{n}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg">
          <Users className="w-12 h-12 mx-auto text-zinc-400 mb-3" />
          <div className="text-zinc-600 dark:text-zinc-400">No profiles yet.</div>
          <div className="text-xs text-zinc-500 mt-1">Add the first mentor or partner to populate the Demo Day deck.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => (
            <div
              key={p.id}
              draggable
              onDragStart={() => onDragStart(p.id)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(p.id)}
              className={`bg-white dark:bg-zinc-900 border rounded-lg p-3 flex items-center gap-3 ${
                p.is_active ? 'border-zinc-200 dark:border-zinc-800' : 'border-dashed border-zinc-300 dark:border-zinc-700 opacity-60'
              } ${dragId === p.id ? 'ring-2 ring-violet-400' : ''}`}
            >
              <GripVertical className="w-4 h-4 text-zinc-400 cursor-grab flex-shrink-0" />
              {p.photo_url ? (
                <img src={p.photo_url} alt={p.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-zinc-100 dark:bg-zinc-800" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-violet-500 to-amber-400 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {(p.name || '?').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{p.name}</div>
                  <span className="text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-400">{p.kind}</span>
                </div>
                {(p.role || p.company) && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {[p.role, p.company].filter(Boolean).join(' · ')}
                  </div>
                )}
                {p.skills?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.skills.slice(0, 6).map((s) => (
                      <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{s}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {p.linkedin_url && (
                  <a href={p.linkedin_url} target="_blank" rel="noreferrer noopener"
                    className="p-2 text-zinc-500 hover:text-violet-600 rounded" title="Open LinkedIn">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                <button onClick={() => toggleActive(p)}
                  className="p-2 text-zinc-500 hover:text-violet-600 rounded"
                  title={p.is_active ? 'Hide from deck' : 'Show on deck'}>
                  {p.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button onClick={() => setEditing(p)} className="p-2 text-zinc-500 hover:text-violet-600 rounded" title="Edit">
                  <Edit3 className="w-4 h-4" />
                </button>
                <button onClick={() => remove(p)} className="p-2 text-zinc-500 hover:text-red-600 rounded" title="Archive (hide from deck, keep history)">
                  <Archive className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditorModal
          initial={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={save}
          onPhoto={uploadPhoto}
        />
      )}
    </div>
  );
}
