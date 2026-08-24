/**
 * Task #11 — User Skill Profile.
 *
 * A category-grouped tag/level picker over the Skills & Values taxonomy. The
 * user rates their own proficiency (0–5) per skill, with an optional evidence
 * link + years of experience. Where peers have endorsed them, each skill also
 * shows the peer average and the blended self+peer score (0.4*self+0.6*peer)
 * that feeds the radar and matching.
 *
 * Worker-only feature: the dev FastAPI does not mount /api/skills, so in dev
 * the loaders fail and the page shows an error banner instead of crashing.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Target, Save, Search, Users, Check, Loader2, AlertCircle, Link2, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

const LEVEL_HINTS = ['Not rated', 'Aware', 'Working', 'Proficient', 'Advanced', 'Expert'];

function LevelPicker({ value, onChange, levelLabels }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Proficiency level">
      {[0, 1, 2, 3, 4, 5].map((n) => {
        const active = value === n;
        const hint = (n > 0 && levelLabels && levelLabels[n - 1]) || LEVEL_HINTS[n];
        return (
          <button
            key={n}
            type="button"
            title={`${n} · ${hint}`}
            aria-pressed={active}
            onClick={() => onChange(n)}
            className={[
              'w-7 h-7 rounded-md text-xs font-semibold transition-colors',
              active
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-blue-100 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600',
            ].join(' ')}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

export default function SkillsProfilePage() {
  const [categories, setCategories] = useState([]);
  const [levels, setLevels] = useState({});          // skill_id -> self_level (0..5)
  const [details, setDetails] = useState({});        // skill_id -> { evidence_url, years }
  const [original, setOriginal] = useState({});      // snapshot for dirty diff: skill_id -> {level,evidence_url,years}
  const [agg, setAgg] = useState({});                // skill_id -> { peer_avg, peer_count, blended }
  const [expanded, setExpanded] = useState({});      // skill_id -> bool (details open)
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [tax, mine, aggregate] = await Promise.all([
        api.skills.getTaxonomy(),
        api.skills.getMySkills(),
        api.skills.getMyAggregate().catch(() => ({ skills: [] })),
      ]);
      setCategories(Array.isArray(tax?.categories) ? tax.categories : []);

      const lvl = {};
      const det = {};
      const orig = {};
      for (const r of mine?.ratings || []) {
        lvl[r.skill_id] = r.self_level || 0;
        det[r.skill_id] = { evidence_url: r.evidence_url || '', years: r.years ?? '' };
        orig[r.skill_id] = { level: r.self_level || 0, evidence_url: r.evidence_url || '', years: r.years ?? '' };
      }
      setLevels(lvl);
      setDetails(det);
      setOriginal(orig);

      const am = {};
      for (const s of aggregate?.skills || []) {
        am[s.skill_id] = { peer_avg: s.peer_avg || 0, peer_count: s.peer_count || 0, blended: s.blended || 0 };
      }
      setAgg(am);
    } catch (e) {
      reportError('skills_profile_load_failed', e);
      setError(e?.message || 'Failed to load your skill profile.');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function setLevel(skillId, n) {
    setLevels((prev) => ({ ...prev, [skillId]: n }));
    if (n > 0) setExpanded((p) => ({ ...p, [skillId]: p[skillId] }));
  }
  function setDetail(skillId, patch) {
    setDetails((prev) => ({ ...prev, [skillId]: { evidence_url: '', years: '', ...prev[skillId], ...patch } }));
  }

  // Dirty diff: skills whose level/evidence/years differ from the loaded snapshot.
  const dirty = useMemo(() => {
    const out = [];
    const ids = new Set([...Object.keys(levels), ...Object.keys(original)]);
    for (const idStr of ids) {
      const id = Number(idStr);
      const lvl = levels[id] || 0;
      const d = details[id] || { evidence_url: '', years: '' };
      const o = original[id] || { level: 0, evidence_url: '', years: '' };
      const evidence = (d.evidence_url || '').trim();
      const years = d.years === '' || d.years == null ? '' : String(d.years);
      const oYears = o.years === '' || o.years == null ? '' : String(o.years);
      const changed = lvl !== o.level
        || (lvl > 0 && (evidence !== (o.evidence_url || '') || years !== oYears));
      if (changed) out.push(id);
    }
    return out;
  }, [levels, details, original]);

  async function save() {
    if (!dirty.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      const ratings = dirty.map((id) => {
        const lvl = levels[id] || 0;
        if (lvl <= 0) return { skill_id: id, self_level: 0 };
        const d = details[id] || {};
        const ev = (d.evidence_url || '').trim();
        const yrs = d.years === '' || d.years == null ? null : Number(d.years);
        return { skill_id: id, self_level: lvl, evidence_url: ev || null, years: Number.isFinite(yrs) ? yrs : null };
      });
      const res = await api.skills.saveMySkills(ratings);
      const lvl = {};
      const det = {};
      const orig = {};
      for (const r of res?.ratings || []) {
        lvl[r.skill_id] = r.self_level || 0;
        det[r.skill_id] = { evidence_url: r.evidence_url || '', years: r.years ?? '' };
        orig[r.skill_id] = { level: r.self_level || 0, evidence_url: r.evidence_url || '', years: r.years ?? '' };
      }
      setLevels(lvl);
      setDetails(det);
      setOriginal(orig);
      const aggregate = await api.skills.getMyAggregate().catch(() => ({ skills: [] }));
      const am = {};
      for (const s of aggregate?.skills || []) {
        am[s.skill_id] = { peer_avg: s.peer_avg || 0, peer_count: s.peer_count || 0, blended: s.blended || 0 };
      }
      setAgg(am);
      setSavedAt(Date.now());
    } catch (e) {
      reportError('skills_profile_save_failed', e);
      setError(e?.message || 'Failed to save your changes.');
    }
    setSaving(false);
  }

  const q = query.trim().toLowerCase();
  const visibleCategories = useMemo(() => {
    if (!q) return categories;
    return categories
      .map((c) => ({ ...c, skills: (c.skills || []).filter((s) => (s.label || '').toLowerCase().includes(q)) }))
      .filter((c) => (c.skills || []).length > 0);
  }, [categories, q]);

  const ratedCount = useMemo(
    () => Object.values(levels).filter((n) => n > 0).length,
    [levels],
  );

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Target className="w-7 h-7 text-blue-600" /> Skills Profile
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
            Rate your proficiency (0–5) across the skills taxonomy. Add an evidence link
            or years of experience where it helps. Connections can endorse you — your
            blended score combines your self-rating with peer endorsements.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{ratedCount} skill{ratedCount === 1 ? '' : 's'} rated</p>
        </div>
        <div className="flex items-center gap-3">
          {savedAt > 0 && !dirty.length && (
            <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="w-4 h-4" /> Saved
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty.length || saving}
            className={[
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              dirty.length && !saving
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-slate-700 dark:text-gray-400',
            ].join(' ')}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}` : 'Saved'}
          </button>
        </div>
      </header>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter skills…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading your skill profile…
        </div>
      ) : (
        <div className="space-y-5">
          {visibleCategories.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
              {q ? 'No skills match your filter.' : 'No skills are available yet.'}
            </p>
          )}
          {visibleCategories.map((cat) => {
            const ratedInCat = (cat.skills || []).filter((s) => (levels[s.id] || 0) > 0).length;
            return (
              <section
                key={cat.slug}
                className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100">{cat.label}</h2>
                    {cat.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">{cat.description}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    {ratedInCat}/{(cat.skills || []).length}
                  </span>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-slate-700">
                  {(cat.skills || []).map((s) => {
                    const lvl = levels[s.id] || 0;
                    const d = details[s.id] || { evidence_url: '', years: '' };
                    const a = agg[s.id];
                    const isOpen = !!expanded[s.id];
                    return (
                      <li key={s.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-800 dark:text-gray-200" title={s.description || ''}>
                              {s.label}
                            </div>
                            {a && a.peer_count > 0 && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                                <Users className="w-3 h-3" />
                                {a.peer_count} endorsement{a.peer_count === 1 ? '' : 's'} · peer avg {a.peer_avg}
                                <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium">
                                  blended {a.blended}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <LevelPicker value={lvl} onChange={(n) => setLevel(s.id, n)} levelLabels={s.seniority_levels} />
                            <button
                              type="button"
                              onClick={() => setExpanded((p) => ({ ...p, [s.id]: !p[s.id] }))}
                              disabled={lvl <= 0}
                              className={[
                                'p-1.5 rounded-md transition-colors',
                                lvl > 0
                                  ? 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700'
                                  : 'text-gray-300 cursor-not-allowed dark:text-gray-600',
                              ].join(' ')}
                              title="Add evidence / years"
                              aria-label="Toggle details"
                            >
                              <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </button>
                          </div>
                        </div>
                        {lvl > 0 && isOpen && (
                          <div className="mt-3 grid sm:grid-cols-[1fr_8rem] gap-3">
                            <label className="block">
                              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-1">
                                <Link2 className="w-3 h-3" /> Evidence link (optional)
                              </span>
                              <input
                                type="url"
                                value={d.evidence_url}
                                onChange={(e) => setDetail(s.id, { evidence_url: e.target.value })}
                                placeholder="https://…"
                                className="w-full px-3 py-1.5 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Years</span>
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={d.years}
                                onChange={(e) => setDetail(s.id, { years: e.target.value })}
                                placeholder="0"
                                className="w-full px-3 py-1.5 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </label>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
