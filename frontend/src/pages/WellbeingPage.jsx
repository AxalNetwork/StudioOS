import React, { useEffect, useMemo, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { safeReadJSON } from '../lib/storage';
import {
  Heart, Lock, Phone, Users, BookOpen, MessageCircle, ExternalLink,
  AlertTriangle, BarChart3, Star, Search, Filter, Calendar, X, Check, Globe,
} from 'lucide-react';
import { api } from '../lib/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DAILY_QUESTIONS = [
  { key: 'mood',   label: 'Mood',         lowLabel: 'Low',          highLabel: 'Great' },
  { key: 'stress', label: 'Stress',       lowLabel: 'Calm',         highLabel: 'Overwhelmed', invert: true },
  { key: 'sleep',  label: 'Sleep',        lowLabel: 'Poor',         highLabel: 'Restful' },
  { key: 'energy', label: 'Energy',       lowLabel: 'Drained',      highLabel: 'Charged' },
  { key: 'focus',  label: 'Focus',        lowLabel: 'Scattered',    highLabel: 'Sharp' },
  { key: 'social', label: 'Connection',   lowLabel: 'Isolated',     highLabel: 'Supported' },
];

const RESOURCE_CATEGORY_META = {
  hotline:    { icon: Phone,         label: 'Crisis & hotlines' },
  therapy:    { icon: Heart,         label: 'Therapy & counselling' },
  peer_group: { icon: Users,         label: 'Peer & founder groups' },
  coaching:   { icon: MessageCircle, label: 'Coaching' },
  reading:    { icon: BookOpen,      label: 'Reading & essays' },
};

function readUser() { return safeReadJSON('user', {}); }

function getBrowserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
  catch { return null; }
}

// ---------------------------------------------------------------------------
// Daily pulse
// ---------------------------------------------------------------------------
function Slider({ value, onChange, lowLabel, highLabel, invert }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          const palette = invert
            ? (n >= 4 ? 'border-red-500 bg-red-50 text-red-700'
               : n === 3 ? 'border-amber-500 bg-amber-50 text-amber-700'
               : 'border-emerald-500 bg-emerald-50 text-emerald-700')
            : (n >= 4 ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
               : n === 3 ? 'border-amber-500 bg-amber-50 text-amber-700'
               : 'border-red-500 bg-red-50 text-red-700');
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-medium transition ${
                active ? palette : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'
              }`}
            >{n}</button>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-slate-400 px-0.5">
        <span>1 — {lowLabel}</span>
        <span>5 — {highLabel}</span>
      </div>
    </div>
  );
}

function DailyPulseCard({ alreadyToday, initialValues, onSubmitted }) {
  const [values, setValues] = useState(() => initialValues || {
    mood: 3, stress: 3, sleep: 3, energy: 3, focus: 3, social: 3,
  });
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setSaving(true); setErr(null); setOk(false);
    try {
      await api.wellbeingDailySubmit({ ...values, free_text: text || null });
      setOk(true);
      onSubmitted?.();
    } catch (e) {
      setErr(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Today's check-in</h3>
          <p className="text-sm text-slate-500">
            Six quick sliders. Takes under a minute. {alreadyToday && (
              <span className="ml-1 text-xs font-medium text-emerald-600">
                You've checked in today — submitting will overwrite.
              </span>
            )}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
          <Lock className="w-3 h-3" /> Encrypted
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {DAILY_QUESTIONS.map((q) => (
          <div key={q.key}>
            <div className="text-sm font-medium text-slate-700 mb-1.5">{q.label}</div>
            <Slider
              value={values[q.key]}
              onChange={(n) => setValues((v) => ({ ...v, [q.key]: n }))}
              lowLabel={q.lowLabel}
              highLabel={q.highLabel}
              invert={q.invert}
            />
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium text-slate-700">Anything else? (optional)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Encrypted at rest. Only you can read this."
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
        />
      </div>

      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
      {ok && <div className="mt-3 text-sm text-emerald-600">Saved.</div>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : alreadyToday ? 'Update today' : 'Save check-in'}
        </button>
      </div>
    </div>
  );
}

function DailyChart({ pulses }) {
  if (!pulses?.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Last 30 days</h3>
        <p className="mt-2 text-sm text-slate-500">No check-ins yet. Your first will appear here.</p>
      </div>
    );
  }
  const data = pulses.map((p) => {
    const vals = [p.mood, p.sleep, p.energy, p.focus, p.social].filter((v) => typeof v === 'number');
    if (typeof p.stress === 'number') vals.push(6 - p.stress);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { day: p.day, avg };
  });
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Last 30 days</h3>
        <span className="text-xs text-slate-500">{pulses.length} check-in{pulses.length === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-3 flex items-end gap-1 h-24">
        {data.map((d, i) => (
          <div
            key={i}
            title={`${d.day}: overall ${d.avg?.toFixed(1) ?? '—'}/5`}
            className="flex-1 rounded-t bg-rose-400/70"
            style={{ height: d.avg ? `${(d.avg / 5) * 100}%` : '4px' }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Experts
// ---------------------------------------------------------------------------
function StarRow({ avg, count }) {
  const filled = Math.round(avg);
  return (
    <div className="flex items-center gap-1 text-amber-500">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`w-3.5 h-3.5 ${n <= filled ? 'fill-amber-400' : 'opacity-40'}`} />
      ))}
      <span className="text-xs text-slate-500 ml-1">
        {avg ? avg.toFixed(1) : '—'} {count ? `(${count})` : ''}
      </span>
    </div>
  );
}

function ExpertCard({ expert, onBook, onView, categoryLabels }) {
  const [showWhy, setShowWhy] = useState(false);
  const topCats = (expert.categories || []).slice(0, 3).map((k) => categoryLabels.get(k) || k);
  const langs = (expert.languages || []).map((l) => l.toUpperCase()).join(' · ');

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col">
      <div className="flex items-start gap-3">
        {expert.photo_url ? (
          <img src={expert.photo_url} alt={expert.name} className="w-14 h-14 rounded-full bg-slate-100 object-cover" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-slate-100" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="font-semibold text-slate-900 truncate">{expert.name}</div>
            {expert.verified && (
              <span title="Verified" className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                <Check className="w-2.5 h-2.5" /> verified
              </span>
            )}
          </div>
          <div className="text-xs text-slate-600 truncate">{expert.headline}</div>
          <div className="mt-1"><StarRow avg={expert.rating_avg} count={expert.rating_count} /></div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {topCats.map((c) => (
          <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">{c}</span>
        ))}
        {expert.first_session_free && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">First session free</span>
        )}
        {expert.pricing_model === 'sliding_scale' && (
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">Sliding scale</span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><Globe className="w-3 h-3" />{langs || 'EN'}</span>
        {expert.hourly_rate_usd ? (
          <span>${expert.hourly_rate_usd}/hr</span>
        ) : expert.pricing_model === 'free' ? (
          <span>Free</span>
        ) : null}
      </div>

      {expert.match_breakdown && (
        <button
          type="button"
          onClick={() => setShowWhy((v) => !v)}
          className="mt-2 self-start text-[11px] font-medium text-rose-600 hover:underline"
        >
          {showWhy ? 'Hide' : 'Why these matches?'}
        </button>
      )}
      {showWhy && expert.match_breakdown && (
        <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2">
          {Object.entries(expert.match_breakdown).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="capitalize">{k.replace(/_/g, ' ')}</span>
              <span className="font-mono">{Number(v).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto pt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onView(expert)}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-slate-300"
        >
          Profile
        </button>
        <button
          type="button"
          onClick={() => onBook(expert)}
          className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
        >
          Book consultation
        </button>
      </div>
    </div>
  );
}

function formatSlot(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

function BookingModal({ expert, onClose }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [slots, setSlots] = useState(null); // null = loading, [] = none, [...] = available
  const [external, setExternal] = useState(null); // launch_url string when available
  const [chosen, setChosen] = useState(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    api.wellbeingExpertSlots(expert.uid)
      .then((r) => {
        if (cancelled) return;
        if (r.external) { setExternal(r.launch_url); setSlots([]); }
        else { setExternal(null); setSlots(r.slots || []); }
      })
      .catch((e) => { if (!cancelled) setErr(e.message || 'Failed to load slots'); });
    return () => { cancelled = true; };
  }, [expert.uid]);

  const book = async () => {
    setBusy(true); setErr(null);
    try {
      const payload = external
        ? {}
        : { scheduled_at: chosen, duration_minutes: 30, notes: notes || undefined };
      const r = await api.wellbeingExpertBook(expert.uid, payload);
      setResult(r);
      if (r.launch_url && external) window.open(r.launch_url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErr(e.message || 'Failed to book');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Book {expert.name}</h3>
            <p className="text-sm text-slate-500">{expert.headline}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!result && (
          <>
            {expert.first_session_free && (
              <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                First session free with this expert.
              </div>
            )}

            {slots === null && <div className="mt-4 text-sm text-slate-500">Loading availability…</div>}

            {slots !== null && external && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                This expert uses an external scheduler. Clicking "Open scheduler" will open it in a new tab and record your interest in your booking history.
              </div>
            )}

            {slots !== null && !external && (
              <div className="mt-4 space-y-3">
                <div className="text-sm font-medium text-slate-700">Pick a time (your local timezone)</div>
                {slots.length === 0 ? (
                  <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    No internal slots available right now. Please check back later.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                    {slots.map((s) => (
                      <button
                        key={s} type="button" onClick={() => setChosen(s)}
                        className={`text-left rounded-lg border px-3 py-2 text-xs ${
                          chosen === s
                            ? 'border-rose-500 bg-rose-50 text-rose-700 font-medium'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700'
                        }`}
                      >{formatSlot(s)}</button>
                    ))}
                  </div>
                )}
                {chosen && (
                  <div>
                    <label className="text-xs font-medium text-slate-600">Anything the expert should know? (optional)</label>
                    <textarea
                      value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                )}
              </div>
            )}

            {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={book}
                disabled={busy || slots === null || (!external && !chosen)}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busy ? 'Booking…' : external ? 'Open scheduler' : 'Confirm booking'}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{result.message}</span>
            </div>
            {result.launch_url && external && (
              <a href={result.launch_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600 hover:underline">
                <Calendar className="w-4 h-4" /> Open scheduler
              </a>
            )}
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ExpertDirectory({ wellnessGoals }) {
  const [matches, setMatches] = useState([]);
  const [meta, setMeta] = useState({ total_active: 0, filtered_count: 0, view_budget: null });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [filters, setFilters] = useState({
    category: '', language: '', modality: '', price_max: '', q: '',
  });
  const [bookingExpert, setBookingExpert] = useState(null);
  const [tierError, setTierError] = useState(null);

  const tz = useMemo(() => getBrowserTz(), []);

  const categoryLabels = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set(c.key, c.label));
    return m;
  }, [categories]);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [cats, list] = await Promise.all([
        api.wellbeingExpertCategories().catch(() => ({ categories: [] })),
        api.wellbeingExperts({
          ...filters,
          tz,
          want_categories: wellnessGoals,
          want_languages: ['en'],
          limit: 6,
        }),
      ]);
      setCategories(cats.categories || []);
      setMatches(list.matches || []);
      setMeta({
        total_active: list.total_active || 0,
        filtered_count: list.filtered_count || 0,
        view_budget: list.view_budget || null,
      });
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') {
        setMatches([]); setMeta({ total_active: 0, filtered_count: 0, view_budget: null });
      } else {
        setErr(e.message || 'Failed to load');
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [
    filters.category, filters.language, filters.modality, filters.price_max, filters.q,
    JSON.stringify(wellnessGoals || []),
  ]);

  const handleView = async (expert) => {
    try {
      await api.wellbeingExpertGet(expert.uid);
    } catch (e) {
      if (e?.status === 402 || (e?.message || '').toLowerCase().includes('tier')) {
        setTierError(e.data?.message || 'Free tier is capped at 3 matched expert profile views per month. Upgrade to Growth for unlimited matches.');
        return;
      }
      setTierError(e.message || 'Failed to open profile');
      return;
    }
    // Reuse the booking modal as a "Profile" view for v1.
    setBookingExpert(expert);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Experts matched to you</h3>
          <p className="text-sm text-slate-500">
            Top {matches.length} of {meta.filtered_count} {meta.filtered_count === 1 ? 'expert' : 'experts'}
            {meta.total_active ? ` (${meta.total_active} active in directory)` : ''}.
          </p>
        </div>
        {meta.view_budget?.views_limit != null && (
          <div className="text-xs text-slate-500">
            Free tier: {meta.view_budget.remaining}/{meta.view_budget.views_limit} profile views left this month
          </div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-5 gap-2">
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Search experts…"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select
          value={filters.category}
          onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <select
          value={filters.modality}
          onChange={(e) => setFilters((f) => ({ ...f, modality: e.target.value }))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Any modality</option>
          <option value="video">Video</option>
          <option value="phone">Phone</option>
          <option value="in_person">In person</option>
          <option value="async_chat">Async chat</option>
        </select>
        <select
          value={filters.price_max}
          onChange={(e) => setFilters((f) => ({ ...f, price_max: e.target.value }))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Any price</option>
          <option value="100">≤ $100/hr</option>
          <option value="200">≤ $200/hr</option>
          <option value="350">≤ $350/hr</option>
          <option value="500">≤ $500/hr</option>
        </select>
      </div>

      {tierError && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{tierError}</span>
          <button onClick={() => setTierError(null)} className="ml-auto text-amber-700"><X className="w-4 h-4" /></button>
        </div>
      )}
      {err && <div className="mb-3 text-sm text-red-600">{err}</div>}
      {loading && <div className="text-sm text-slate-500">Loading…</div>}
      {!loading && !matches.length && (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          <Filter className="w-5 h-5 mx-auto text-slate-400 mb-1" />
          No experts match these filters. Try clearing them.
        </div>
      )}
      {!loading && matches.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {matches.map((e) => (
            <ExpertCard
              key={e.uid}
              expert={e}
              categoryLabels={categoryLabels}
              onBook={setBookingExpert}
              onView={handleView}
            />
          ))}
        </div>
      )}

      {bookingExpert && (
        <BookingModal expert={bookingExpert} onClose={() => setBookingExpert(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------
function ResourceList({ resources }) {
  const grouped = useMemo(() => {
    const g = {};
    resources.forEach((r) => {
      if (!g[r.category]) g[r.category] = [];
      g[r.category].push(r);
    });
    return g;
  }, [resources]);

  return (
    <div className="space-y-6">
      {Object.entries(RESOURCE_CATEGORY_META).map(([cat, meta]) => {
        const items = grouped[cat] || [];
        if (!items.length) return null;
        const Icon = meta.icon;
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-slate-500" />
              <h4 className="text-sm font-semibold text-slate-700">{meta.label}</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((r) => (
                <a
                  key={r.id} href={r.url || '#'} target="_blank" rel="noopener noreferrer"
                  className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-slate-900 leading-tight">{r.name}</div>
                    {r.url && <ExternalLink className="w-3.5 h-3.5 text-slate-400 mt-1 shrink-0" />}
                  </div>
                  {r.description && <p className="mt-1 text-xs text-slate-600 leading-relaxed">{r.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.is_24_7 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">24/7</span>}
                    {r.is_free && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">Free</span>}
                    {r.region && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 uppercase">{r.region}</span>}
                  </div>
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin aggregate
// ---------------------------------------------------------------------------
function AdminAggregate() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [days, setDays] = useState(30);

  const load = async (d = days) => {
    setErr(null);
    try { setData(await api.wellbeingAggregate(d)); }
    catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') {
        setData({ insufficient_data: true, cohort_size: 0, submissions: 0, window_days: d, min_cohort: 0, averages: {} });
      } else { setErr(e.message || 'Failed'); }
    }
  };
  useEffect(() => { load(days); /* eslint-disable-next-line */ }, [days]);

  const labels = { stress: 'Stress', sleep: 'Sleep', support: 'Support', decisions: 'Decisions', energy: 'Energy' };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-900">Anonymized founder pulse</h3>
        </div>
        <select
          value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      <p className="text-xs text-slate-500 mb-4 flex items-start gap-1.5">
        <Lock className="w-3 h-3 mt-0.5 shrink-0" />
        Aggregate-only. We never show per-founder check-ins. Withheld below the minimum cohort size to prevent re-identification.
      </p>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {!data && !err && <div className="text-sm text-slate-500">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Founders</div>
              <div className="text-2xl font-semibold text-slate-900">{data.cohort_size}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Submissions</div>
              <div className="text-2xl font-semibold text-slate-900">{data.submissions}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Window</div>
              <div className="text-2xl font-semibold text-slate-900">{data.window_days}d</div>
            </div>
          </div>
          {data.insufficient_data ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Below the minimum cohort of {data.min_cohort} unique founders. Averages are withheld so a single response can't be inferred.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {Object.entries(labels).map(([k, label]) => (
                <div key={k} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="text-2xl font-semibold text-slate-900 mt-1">
                    {data.averages?.[k] ?? '—'}<span className="text-sm text-slate-400 font-normal">/5</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function WellbeingPage() {
  const user = readUser();
  const role = (user.role || '').toLowerCase();
  const viewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('viewMode')) || role;

  const [daily, setDaily] = useState({ pulses: [], submitted_today: false });
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const isInvestor = role === 'investor';
  const showAggregate = role === 'admin' && viewMode === 'admin';
  const canCheckIn = role === 'founder' || role === 'admin';

  const load = async () => {
    setLoading(true); setErr(null);
    const quiet404 = (fallback) => (e) => {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') return fallback;
      throw e;
    };
    try {
      const [res, d] = await Promise.all([
        api.wellbeingResources().catch(quiet404({ resources: [] })),
        canCheckIn
          ? api.wellbeingDaily(30).catch(quiet404({ pulses: [], submitted_today: false }))
          : Promise.resolve({ pulses: [], submitted_today: false }),
      ]);
      setResources(res.resources || []);
      setDaily(d);
    } catch (e) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (isInvestor) {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Heart className="w-6 h-6 text-rose-500" /> Founder Wellbeing
        </h1>
        <PageExplainer pageKey="wellbeing" />
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Wellbeing data is private to founders and admin operators. Investors do not have access.
        </div>
      </div>
    );
  }

  // Initial slider values from today's pulse if present.
  const todays = (daily.pulses || []).find((p) => p.day === daily.today);
  const initial = todays ? {
    mood: todays.mood ?? 3, stress: todays.stress ?? 3, sleep: todays.sleep ?? 3,
    energy: todays.energy ?? 3, focus: todays.focus ?? 3, social: todays.social ?? 3,
  } : null;

  // Top categories from recent tags = wellness goals → expert pre-match.
  const wellnessGoals = useMemo(() => {
    const counts = new Map();
    (daily.pulses || []).forEach((p) => {
      (p.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  }, [daily.pulses]);

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Heart className="w-6 h-6 text-rose-500" /> Founder Wellbeing
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Daily check-ins, a curated directory of vetted experts, and crisis resources.
          Your individual answers are encrypted at rest and never shared with investors.
        </p>
      </div>

      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {loading && <div className="text-sm text-slate-500">Loading…</div>}

      {!loading && (
        <div className="space-y-6">
          {showAggregate && <AdminAggregate />}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              {canCheckIn && (
                <DailyPulseCard
                  alreadyToday={!!daily.submitted_today}
                  initialValues={initial}
                  onSubmitted={load}
                />
              )}
            </div>
            <div className="space-y-6">
              {canCheckIn && <DailyChart pulses={daily.pulses || []} />}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-xs text-slate-600 leading-relaxed">
                <div className="flex items-center gap-1.5 font-medium text-slate-700 mb-2">
                  <Lock className="w-3.5 h-3.5" /> Privacy
                </div>
                <ul className="list-disc list-inside space-y-1">
                  <li>Daily answers stored encrypted at rest.</li>
                  <li>Only you can read your individual check-ins.</li>
                  <li>Admins see only anonymized averages above a minimum cohort.</li>
                  <li>Never shared with investors or fed into Market Intelligence.</li>
                </ul>
              </div>
            </div>
          </div>

          <ExpertDirectory wellnessGoals={wellnessGoals} />

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-slate-900">Resource directory</h3>
              <span className="text-xs text-slate-500">{resources.length} curated</span>
            </div>
            <ResourceList resources={resources} />
          </div>
        </div>
      )}
    </div>
  );
}
