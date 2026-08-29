import React, { useEffect, useState } from 'react';
import { Package, Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Chip, Section, SlideOver, EmptyState, Badge, formatDay,
} from './kit';

// Capabilities — the partner's REAL service catalog (service_offerings rows
// they own), with create/edit/deactivate. Wave 1a: previously a fixture
// catalog of six fictional services. `?mine=1` returns the caller's own
// offerings including inactive drafts; the founder marketplace continues to
// list active offerings only.
const CATEGORIES = [
  'design', 'engineering', 'legal', 'finance', 'marketing', 'sales',
  'recruiting', 'ops', 'pr', 'data', 'ai_ml', 'product', 'research', 'other',
];

const EMPTY_FORM = { title: '', category: 'other', summary: '', price_usd: '', is_active: true };

export default function CapabilitiesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | offering
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await api.listServiceOfferings({ mine: 1 });
      setItems(r.items || []);
    } catch (e) {
      setError(e?.message || 'Could not load your service catalog.');
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY_FORM); setEditing('new'); };
  const openEdit = (o) => {
    setForm({
      title: o.title || '',
      category: o.category || 'other',
      summary: o.summary || '',
      price_usd: o.price_usd != null ? String(o.price_usd) : '',
      is_active: !!o.is_active,
    });
    setEditing(o);
  };

  const save = async () => {
    setSaving(true); setError('');
    const payload = {
      title: form.title.trim(),
      category: form.category,
      summary: form.summary.trim() || null,
      price_usd: form.price_usd === '' ? null : Number(form.price_usd),
      is_active: form.is_active,
    };
    try {
      if (!payload.title) throw new Error('Title is required.');
      if (payload.price_usd != null && (!Number.isFinite(payload.price_usd) || payload.price_usd < 0)) {
        throw new Error('Price must be a non-negative number, or blank for "on request".');
      }
      if (editing === 'new') await api.createServiceOffering(payload);
      else await api.updateServiceOffering(editing.id, payload);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e?.message || 'Could not save the offering.');
    }
    setSaving(false);
  };

  const remove = async (o) => {
    setError('');
    try {
      await api.deleteServiceOffering(o.id);
      await load();
    } catch (e) {
      setError(e?.message || 'Could not delete the offering.');
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading your service catalog…</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <Section
        title={`Service catalog (${items.length})`}
        action={(
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700"
          >
            <Plus size={13} /> New offering
          </button>
        )}
      >
        {items.length === 0 ? (
          <EmptyState>
            <p className="font-medium text-gray-700 dark:text-gray-300">No services listed yet.</p>
            <p className="mt-1">
              Offerings you add here appear in the founder marketplace and are what
              founders engage you for. Start with your core service.
            </p>
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map((o) => (
              <div key={o.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
                      <Package size={15} className="text-violet-500 flex-shrink-0" />
                      <span className="truncate">{o.title}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {o.category && <Chip tone="violet">{o.category}</Chip>}
                      <Badge tone={o.is_active ? 'emerald' : 'gray'}>{o.is_active ? 'Listed' : 'Unlisted'}</Badge>
                      <Chip>{o.price_usd != null ? `$${Number(o.price_usd).toLocaleString()}` : 'Price on request'}</Chip>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(o)}
                      title="Edit"
                      className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:border-violet-300"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => remove(o)}
                      title="Delete"
                      className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:border-rose-300 hover:text-rose-500"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {o.summary && <p className="text-sm text-gray-600 dark:text-gray-400 mt-2.5">{o.summary}</p>}
                <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-2.5">Listed {formatDay(o.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <SlideOver
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New offering' : 'Edit offering'}
        subtitle="Shown to founders in the marketplace"
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Title</span>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. GTM Strategy Sprint"
              className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100"
            >
              {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Summary</span>
            <textarea
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              rows={4}
              placeholder="What the engagement covers and what the founder walks away with."
              className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Price (USD, blank = on request)</span>
            <input
              value={form.price_usd}
              onChange={(e) => setForm((f) => ({ ...f, price_usd: e.target.value }))}
              inputMode="numeric"
              placeholder="e.g. 25000"
              className="mt-1 w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100"
            />
          </label>
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Listed in the marketplace</span>
          </label>
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save offering'}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      </SlideOver>
    </div>
  );
}
