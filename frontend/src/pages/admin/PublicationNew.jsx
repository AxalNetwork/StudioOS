import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Loader2 } from 'lucide-react';
import { publications } from '../../lib/api';
import { useToast } from '../../components/useToast';

const SECTIONS = [
  'sentiment', 'talc', 'demand_supply', 'sector_heat',
  'sentiment_geo', 'fit_match', 'thesis_embedding',
];
const AUDIENCES = ['internal', 'lp', 'founder', 'media', 'partners'];

export default function PublicationNew() {
  const nav = useNavigate();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    audience: 'internal',
    section: 'sector_heat',
    sector: '',
    period_from: '',
    period_to: '',
  });
  const [drafting, setDrafting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.title.trim().length < 3) {
      showToast({ kind: 'error', msg: 'Title must be at least 3 characters' });
      return;
    }
    setDrafting(true);
    try {
      const filters = {};
      if (form.sector) filters.sector = form.sector;
      if (form.period_from) filters.period_from = form.period_from;
      if (form.period_to) filters.period_to = form.period_to;
      const res = await publications.draft({
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || undefined,
        audience: form.audience,
        section: form.section,
        filters,
      });
      if (res.ai_ok === false) {
        showToast({ kind: 'warning', msg: `AI summary unavailable (${res.ai_error}); using fallback` });
      } else {
        showToast({ kind: 'success', msg: `Drafted with ${res.aggregate_count} aggregate cells` });
      }
      nav(`/admin/publications/${res.publication.id}`);
    } catch (err) {
      showToast({ kind: 'error', msg: err.message || 'Draft failed' });
    } finally { setDrafting(false); }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 dark:text-gray-100">
      <button onClick={() => nav('/admin/publications')} className="text-sm text-gray-500 hover:text-violet-600 flex items-center gap-1 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-violet-600" />
        New publication
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Pick an MI section + filters. We'll draft a 3–5 bullet headline summary you can edit before render.
      </p>

      <form onSubmit={submit} className="space-y-4 bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg p-6" data-card>
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input
            type="text" required minLength={3} maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Q2 sector heat brief"
            className="w-full border rounded-lg px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Subtitle <span className="text-gray-400 text-xs">(optional)</span></label>
          <input
            type="text" maxLength={200}
            value={form.subtitle}
            onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Section</label>
            <select
              value={form.section}
              onChange={(e) => setForm({ ...form, section: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
            >
              {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Audience</label>
            <select
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
            >
              {AUDIENCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Sector <span className="text-gray-400 text-xs">(filter)</span></label>
            <input
              type="text" value={form.sector} placeholder="e.g. fintech"
              onChange={(e) => setForm({ ...form, sector: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Period from</label>
            <input
              type="text" value={form.period_from} placeholder="2026-W01"
              onChange={(e) => setForm({ ...form, period_from: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Period to</label>
            <input
              type="text" value={form.period_to} placeholder="2026-W18"
              onChange={(e) => setForm({ ...form, period_to: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
        </div>
        <div className="pt-2 flex justify-end">
          <button
            type="submit" disabled={drafting}
            className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60"
          >
            {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Draft with AI
          </button>
        </div>
      </form>
    </div>
  );
}
