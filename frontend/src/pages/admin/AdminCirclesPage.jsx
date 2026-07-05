// Task #9 — Communities & Circles: admin management console.
// Replaces the former hardcoded circles data with an admin-authored system.
// NOTE: the admin/circles routes are worker-only; the dev FastAPI backend does
// not implement them, so this page 404s in local dev (takes effect on deploy).
// gray palette, useToast, no nav wrapper (rendered inside the admin layout).
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Star, Eye, EyeOff, Pencil, Trash2, Plus, Loader2, X, Globe, Lock,
} from 'lucide-react';
import { adminCircles } from '../../lib/api';
import { useToast } from '../../components/useToast';
import {
  CIRCLE_TYPES, CIRCLE_TYPE_LABEL, ACCESS_TYPES, ACTIVITY_LEVELS,
} from '../../data/network';

const STATUS_TABS = [
  { id: '', label: 'All' },
  { id: 'published', label: 'Published' },
  { id: 'draft', label: 'Drafts' },
];

const ACTIVITY_KEYS = Object.keys(ACTIVITY_LEVELS);

const EMPTY_FORM = {
  name: '', type: 'founder', access: 'public', activity: 'new',
  tagline: '', region: '', theme: '', hostedBy: '',
  members: 0, upcomingEvents: 0, discussions: 0, sortOrder: 0,
  tags: '', featured: false, published: false,
};

function circleToForm(c) {
  return {
    name: c.name || '',
    type: c.type || 'founder',
    access: c.access || 'public',
    activity: c.activity || 'new',
    tagline: c.tagline || '',
    region: c.region || '',
    theme: c.theme || '',
    hostedBy: c.hostedBy || '',
    members: c.members ?? 0,
    upcomingEvents: c.upcomingEvents ?? 0,
    discussions: c.discussions ?? 0,
    sortOrder: c.sortOrder ?? 0,
    tags: (c.tags || []).join(', '),
    featured: !!c.featured,
    published: !!c.published,
  };
}

const inputCls =
  'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

export default function AdminCirclesPage() {
  const { toast, showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | circle object
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminCircles.list({ status: statusFilter || undefined });
      setRows(Array.isArray(res?.circles) ? res.circles : []);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load circles.' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, showToast]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm(EMPTY_FORM); setEditing('new'); };
  const openEdit = (c) => { setForm(circleToForm(c)); setEditing(c); };
  const closeForm = () => { setEditing(null); setForm(EMPTY_FORM); };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast({ kind: 'error', msg: 'Name is required.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        access: form.access,
        activity: form.activity,
        tagline: form.tagline.trim() || null,
        region: form.region.trim() || null,
        theme: form.theme.trim() || null,
        hostedBy: form.hostedBy.trim() || null,
        members: Number(form.members) || 0,
        upcomingEvents: Number(form.upcomingEvents) || 0,
        discussions: Number(form.discussions) || 0,
        sortOrder: Number(form.sortOrder) || 0,
        tags: form.tags,
        featured: !!form.featured,
        published: !!form.published,
      };
      if (editing === 'new') {
        await adminCircles.create(payload);
        showToast({ kind: 'success', msg: 'Circle created.' });
      } else {
        await adminCircles.update(editing.id, payload);
        showToast({ kind: 'success', msg: 'Circle updated.' });
      }
      closeForm();
      await load();
    } catch (err) {
      showToast({ kind: 'error', msg: err?.message || 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn, id, okMsg) => {
    setBusyId(id);
    try {
      await fn();
      showToast({ kind: 'success', msg: okMsg });
      await load();
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Action failed.' });
    } finally {
      setBusyId(null);
    }
  };

  const togglePublish = (c) => (c.published
    ? act(() => adminCircles.unpublish(c.id), c.id, 'Circle unpublished.')
    : act(() => adminCircles.publish(c.id), c.id, 'Circle published.'));
  const toggleFeature = (c) => act(() => adminCircles.feature(c.id, !c.featured), c.id, c.featured ? 'Unfeatured.' : 'Featured.');
  const remove = (c) => {
    if (!window.confirm(`Delete circle “${c.name}”? This cannot be undone.`)) return;
    return act(() => adminCircles.remove(c.id), c.id, 'Circle deleted.');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {toast ? (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${toast.kind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
          {toast.msg}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Communities &amp; Circles</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Publish and manage the circles shown on the public{' '}
            <Link to="/circles" className="text-blue-600 dark:text-blue-400 hover:underline">/circles</Link>{' '}
            page. Only published circles appear publicly.
          </p>
        </div>
        <button
          onClick={openNew}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={16} /> New circle
        </button>
      </div>

      <div className="flex flex-wrap gap-2 my-5">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id || 'all'}
            onClick={() => setStatusFilter(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              statusFilter === t.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 py-12 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Users size={32} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium">No circles yet</p>
          <p className="text-sm mt-1">Create your first circle — it stays a draft until you publish it.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{c.name}</h2>
                    {c.featured ? <Star size={15} className="shrink-0 text-amber-500 fill-amber-500" /> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <span className="inline-flex items-center gap-1 rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 font-medium text-gray-700 dark:text-gray-300">
                      {CIRCLE_TYPE_LABEL[c.type] || c.type}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {c.access === 'private' ? <Lock size={12} /> : <Globe size={12} />}
                      {c.access === 'private' ? 'Invite-only' : 'Public'}
                    </span>
                    {c.region ? <span>{c.region}</span> : null}
                    <span>{c.members} members</span>
                    <span>sort {c.sortOrder}</span>
                  </div>
                </div>
                <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${
                  c.published
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}>
                  {c.published ? 'Published' : 'Draft'}
                </span>
              </div>
              {c.tagline ? (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{c.tagline}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => openEdit(c)}
                  disabled={busyId === c.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  <Pencil size={14} /> Edit
                </button>
                <button
                  onClick={() => togglePublish(c)}
                  disabled={busyId === c.id}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white disabled:opacity-50 ${
                    c.published ? 'bg-gray-600 hover:bg-gray-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {busyId === c.id ? <Loader2 size={14} className="animate-spin" /> : (c.published ? <EyeOff size={14} /> : <Eye size={14} />)}
                  {c.published ? 'Unpublish' : 'Publish'}
                </button>
                <button
                  onClick={() => toggleFeature(c)}
                  disabled={busyId === c.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  <Star size={14} className={c.featured ? 'text-amber-500 fill-amber-500' : ''} />
                  {c.featured ? 'Unfeature' : 'Feature'}
                </button>
                <button
                  onClick={() => remove(c)}
                  disabled={busyId === c.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing !== null ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="mt-8 w-full max-w-2xl rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {editing === 'new' ? 'New circle' : `Edit — ${editing.name}`}
              </h2>
              <button onClick={closeForm} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <Field label="Name *">
                <input className={inputCls} value={form.name} onChange={(e) => setField('name', e.target.value)} required maxLength={200} />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Type">
                  <select className={inputCls} value={form.type} onChange={(e) => setField('type', e.target.value)}>
                    {CIRCLE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Access">
                  <select className={inputCls} value={form.access} onChange={(e) => setField('access', e.target.value)}>
                    {ACCESS_TYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </Field>
                <Field label="Activity">
                  <select className={inputCls} value={form.activity} onChange={(e) => setField('activity', e.target.value)}>
                    {ACTIVITY_KEYS.map((k) => <option key={k} value={k}>{ACTIVITY_LEVELS[k].label}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Tagline">
                <textarea className={inputCls} rows={2} value={form.tagline} onChange={(e) => setField('tagline', e.target.value)} maxLength={500} />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Region">
                  <input className={inputCls} value={form.region} onChange={(e) => setField('region', e.target.value)} maxLength={120} />
                </Field>
                <Field label="Theme">
                  <input className={inputCls} value={form.theme} onChange={(e) => setField('theme', e.target.value)} maxLength={120} />
                </Field>
                <Field label="Hosted by">
                  <input className={inputCls} value={form.hostedBy} onChange={(e) => setField('hostedBy', e.target.value)} maxLength={160} />
                </Field>
              </div>

              <Field label="Tags (comma-separated)">
                <input className={inputCls} value={form.tags} onChange={(e) => setField('tags', e.target.value)} placeholder="AI, fintech, NYC" />
              </Field>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Members">
                  <input type="number" min={0} className={inputCls} value={form.members} onChange={(e) => setField('members', e.target.value)} />
                </Field>
                <Field label="Upcoming events">
                  <input type="number" min={0} className={inputCls} value={form.upcomingEvents} onChange={(e) => setField('upcomingEvents', e.target.value)} />
                </Field>
                <Field label="Discussions">
                  <input type="number" min={0} className={inputCls} value={form.discussions} onChange={(e) => setField('discussions', e.target.value)} />
                </Field>
                <Field label="Sort order">
                  <input type="number" min={0} className={inputCls} value={form.sortOrder} onChange={(e) => setField('sortOrder', e.target.value)} />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" className="rounded border-gray-300 dark:border-gray-700" checked={form.featured} onChange={(e) => setField('featured', e.target.checked)} />
                  Featured
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" className="rounded border-gray-300 dark:border-gray-700" checked={form.published} onChange={(e) => setField('published', e.target.checked)} />
                  Published (visible on /circles)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {editing === 'new' ? 'Create circle' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
