import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Plus, RefreshCw, Loader2, Trash2, Edit3, GripVertical, X,
  Eye, EyeOff, Image as ImageIcon, Globe, Mail, AlertCircle,
} from 'lucide-react';

const Linkedin = ({ className, size }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>
  </svg>
);

const Twitter = ({ className, size }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);
import { adminTeam as api } from '../../lib/api';
import { useToast } from '../../components/useToast';
import { useEscapeClose } from '../../hooks/useEscapeClose';

const EMPTY = {
  slug: '',
  name: '',
  title: '',
  location: '',
  short_bio: '',
  long_bio: '',
  focus_areas: [],
  social_linkedin: '',
  social_x: '',
  social_website: '',
  social_email: '',
  published: true,
};

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function readFileAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(file);
  });
}

function FocusAreasInput({ value, onChange }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || value.includes(v) || value.length >= 12) { setDraft(''); return; }
    onChange([...value, v]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
            {tag}
            <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} className="hover:text-red-600">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add a focus area"
          className="flex-1 border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700"
        />
        <button type="button" onClick={add} className="px-3 py-1 text-xs border rounded hover:bg-gray-50 dark:hover:bg-slate-800 dark:border-slate-700">
          Add
        </button>
      </div>
    </div>
  );
}

function MemberEditor({ initial, onClose, onSaved }) {
  useEscapeClose(onClose);
  const isNew = !initial?.id;
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const { showToast } = useToast();

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  const onSave = async () => {
    setError(''); setBusy(true);
    try {
      const payload = { ...form, slug: form.slug || slugify(form.name) };
      if (isNew) {
        const created = await api.create(payload);
        showToast({ kind: 'success', msg: `Created ${form.name}` });
        onSaved({ ...payload, id: created.id });
      } else {
        await api.update(initial.id, payload);
        showToast({ kind: 'success', msg: `Saved ${form.name}` });
        onSaved({ ...form, id: initial.id });
      }
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally { setBusy(false); }
  };

  const onPhotoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_MIME.includes(file.type)) {
      setError(`Unsupported type ${file.type}. Use JPEG, PNG, or WebP.`);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError(`Photo is ${(file.size / 1024 / 1024).toFixed(1)}MB — max 3MB.`);
      return;
    }
    if (isNew) {
      setError('Save the member first, then upload a photo.');
      return;
    }
    setError(''); setPhotoBusy(true);
    try {
      const dataUri = await readFileAsDataUri(file);
      const res = await api.uploadPhoto(initial.id, dataUri);
      update({ photo_r2_key: res.photo_r2_key, has_photo: true, _photo_bust: Date.now() });
      showToast({ kind: 'success', msg: 'Photo uploaded' });
    } catch (e2) {
      setError(e2?.message || 'Upload failed');
    } finally { setPhotoBusy(false); }
  };

  const photoUrl = form.has_photo && initial?.slug
    ? `/api/public/team/${encodeURIComponent(initial.slug)}/photo?v=${form._photo_bust || ''}`
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b dark:border-slate-800">
          <h2 className="font-semibold">{isNew ? 'Add team member' : `Edit ${initial.name}`}</h2>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 rounded text-xs">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1 flex flex-col items-center gap-2">
              <div className="w-32 h-32 rounded-lg border dark:border-slate-700 bg-gray-50 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                {photoUrl
                  ? <img src={photoUrl} alt={form.name} className="w-full h-full object-cover" />
                  : <ImageIcon className="w-10 h-10 text-gray-300 dark:text-slate-600" />}
              </div>
              <input ref={fileRef} type="file" accept={ALLOWED_MIME.join(',')} className="hidden" onChange={onPhotoPick} />
              <button
                type="button"
                disabled={photoBusy || isNew}
                onClick={() => fileRef.current?.click()}
                className="text-xs px-2 py-1 border rounded hover:bg-gray-50 dark:hover:bg-slate-800 dark:border-slate-700 disabled:opacity-50"
                title={isNew ? 'Save the member first' : 'Upload square photo (max 3MB)'}
              >
                {photoBusy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Upload photo'}
              </button>
            </div>

            <div className="col-span-2 space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-slate-400">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => update({ name: e.target.value, slug: form.slug || slugify(e.target.value) })}
                  className="w-full border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="Guillaume Lauzier"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-slate-400">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => update({ title: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="CEO & Founder · Venture Partner"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-slate-400">Slug</label>
                  <input
                    value={form.slug}
                    onChange={(e) => update({ slug: slugify(e.target.value) })}
                    className="w-full border rounded px-2 py-1 text-sm font-mono dark:bg-slate-900 dark:border-slate-700"
                    placeholder="guillaume-lauzier"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-slate-400">Location</label>
                  <input
                    value={form.location || ''}
                    onChange={(e) => update({ location: e.target.value })}
                    className="w-full border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700"
                    placeholder="Montréal · Global"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 dark:text-slate-400">Short bio (one line)</label>
            <input
              value={form.short_bio || ''}
              onChange={(e) => update({ short_bio: e.target.value })}
              className="w-full border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700"
              maxLength={500}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-slate-400">Long bio</label>
            <textarea
              value={form.long_bio || ''}
              onChange={(e) => update({ long_bio: e.target.value })}
              rows={4}
              className="w-full border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700"
              maxLength={5000}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 dark:text-slate-400">Focus areas</label>
            <FocusAreasInput value={form.focus_areas || []} onChange={(v) => update({ focus_areas: v })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1"><Linkedin className="w-3 h-3" /> LinkedIn</label>
              <input value={form.social_linkedin || ''} onChange={(e) => update({ social_linkedin: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700" placeholder="https://www.linkedin.com/in/…" />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1"><Twitter className="w-3 h-3" /> X (Twitter)</label>
              <input value={form.social_x || ''} onChange={(e) => update({ social_x: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700" placeholder="https://x.com/…" />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1"><Globe className="w-3 h-3" /> Website</label>
              <input value={form.social_website || ''} onChange={(e) => update({ social_website: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700" placeholder="https://…" />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1"><Mail className="w-3 h-3" /> Email</label>
              <input value={form.social_email || ''} onChange={(e) => update({ social_email: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm dark:bg-slate-900 dark:border-slate-700" placeholder="name@axal.vc" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.published} onChange={(e) => update({ published: e.target.checked })} />
            Published (visible on axal.vc/team)
          </label>
        </div>

        <div className="px-5 py-3 border-t dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 dark:hover:bg-slate-800 dark:border-slate-700">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={busy || !form.name.trim() || !form.title.trim()}
            className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded disabled:opacity-50 flex items-center gap-1"
          >
            {busy && <Loader2 className="w-3 h-3 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminTeam() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {...row} = edit
  const [dragId, setDragId] = useState(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.list();
      setMembers(res.members || []);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Failed to load' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const togglePublished = async (m) => {
    try {
      await api.update(m.id, { published: !m.published });
      setMembers((arr) => arr.map((x) => x.id === m.id ? { ...x, published: !m.published } : x));
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Update failed' });
    }
  };

  const onDelete = async (m) => {
    if (!window.confirm(`Delete ${m.name}? This is permanent.`)) return;
    try {
      await api.remove(m.id);
      setMembers((arr) => arr.filter((x) => x.id !== m.id));
      showToast({ kind: 'success', msg: 'Deleted' });
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Delete failed' });
    }
  };

  const onDrop = async (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const from = members.findIndex((m) => m.id === dragId);
    const to = members.findIndex((m) => m.id === targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    const next = [...members];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setMembers(next);
    setDragId(null);
    try {
      await api.reorder(next.map((m) => m.id));
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Reorder failed' });
      load();
    }
  };

  const sorted = useMemo(() => members, [members]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 dark:text-gray-100">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-violet-600" />
            Team
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage the leadership + venture partners shown on{' '}
            <a href="https://axal.vc/team" target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">axal.vc/team</a>.
            Drag rows to reorder.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg border hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setEditing({})}
            className="bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> Add member
          </button>
        </div>
      </header>

      <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-lg overflow-hidden" data-card>
        {loading ? (
          <div className="p-8 text-center text-gray-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No team members yet. <button onClick={() => setEditing({})} className="text-violet-600 hover:underline">Add the first one</button>.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase text-gray-500">
              <tr>
                <th className="w-8"></th>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Title</th>
                <th className="text-left px-4 py-2">Order</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr
                  key={m.id}
                  draggable
                  onDragStart={() => setDragId(m.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(m.id)}
                  className={`border-t dark:border-slate-800 ${dragId === m.id ? 'opacity-50' : ''}`}
                >
                  <td className="px-2 py-2 text-gray-400 cursor-grab"><GripVertical className="w-4 h-4" /></td>
                  <td className="px-4 py-2 font-medium flex items-center gap-2">
                    {m.has_photo
                      ? <img src={`/api/public/team/${encodeURIComponent(m.slug)}/photo`} alt="" className="w-8 h-8 rounded object-cover" />
                      : <div className="w-8 h-8 rounded bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-[10px] text-gray-400">{m.name.charAt(0)}</div>}
                    <div>
                      <div>{m.name}</div>
                      <code className="text-[10px] text-gray-400">{m.slug}</code>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-gray-600 dark:text-slate-300">{m.title}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{m.display_order}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => togglePublished(m)}
                      className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                        m.published
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : 'bg-gray-200 text-gray-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                      title="Click to toggle"
                    >
                      {m.published ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      {m.published ? 'Published' : 'Draft'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(m)} className="p-1 text-gray-500 hover:text-violet-600" title="Edit">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(m)} className="p-1 text-gray-500 hover:text-red-600" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing !== null && (
        <MemberEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => { setEditing(null); load(); void saved; }}
        />
      )}
    </div>
  );
}
