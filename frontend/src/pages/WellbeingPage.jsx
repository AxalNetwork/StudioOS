import React, { useEffect, useMemo, useState } from 'react';
import { Heart, Lock, Phone, Users, BookOpen, MessageCircle, ExternalLink, AlertTriangle, BarChart3 } from 'lucide-react';
import { api } from '../lib/api';

const QUESTIONS = [
  { key: 'stress',    label: 'Stress level',                    lowLabel: 'Calm',        highLabel: 'Overwhelmed', invert: true },
  { key: 'sleep',     label: 'Sleep quality this week',         lowLabel: 'Poor',        highLabel: 'Great' },
  { key: 'support',   label: 'Felt support from people around', lowLabel: 'Isolated',    highLabel: 'Strong' },
  { key: 'decisions', label: 'Clarity on key decisions',        lowLabel: 'Stuck',       highLabel: 'Clear' },
  { key: 'energy',    label: 'Energy level',                    lowLabel: 'Drained',     highLabel: 'High' },
];

const CATEGORY_META = {
  hotline:    { icon: Phone,         label: 'Crisis & hotlines' },
  therapy:    { icon: Heart,         label: 'Therapy & counselling' },
  peer_group: { icon: Users,         label: 'Peer & founder groups' },
  coaching:   { icon: MessageCircle, label: 'Coaching' },
  reading:    { icon: BookOpen,      label: 'Reading & essays' },
};

function readUser() {
  try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
}

function Scale({ value, onChange, lowLabel, highLabel, invert }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex-1 rounded-lg border py-3 text-sm font-medium transition ${
              value === n
                ? (invert
                    ? (n >= 4 ? 'border-red-500 bg-red-50 text-red-700'
                       : n === 3 ? 'border-amber-500 bg-amber-50 text-amber-700'
                       : 'border-emerald-500 bg-emerald-50 text-emerald-700')
                    : (n >= 4 ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                       : n === 3 ? 'border-amber-500 bg-amber-50 text-amber-700'
                       : 'border-red-500 bg-red-50 text-red-700'))
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-slate-400 px-0.5">
        <span>1 — {lowLabel}</span>
        <span>5 — {highLabel}</span>
      </div>
    </div>
  );
}

function PulseForm({ onSubmitted, alreadyThisWeek }) {
  const [values, setValues] = useState({ stress: 3, sleep: 3, support: 3, decisions: 3, energy: 3 });
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    setOk(false);
    try {
      await api.wellbeingSubmit({ ...values, notes: notes || null });
      setOk(true);
      onSubmitted?.();
    } catch (e) {
      setErr(e.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Weekly pulse</h3>
          <p className="text-sm text-slate-500">
            Five quick questions. Takes about a minute.
            {alreadyThisWeek && (
              <span className="ml-2 text-xs text-emerald-600 font-medium">You've already checked in this week — submitting again will overwrite.</span>
            )}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
          <Lock className="w-3 h-3" /> Private to you
        </span>
      </div>

      <div className="mt-4 space-y-5">
        {QUESTIONS.map((q) => (
          <div key={q.key}>
            <div className="text-sm font-medium text-slate-700 mb-2">{q.label}</div>
            <Scale
              value={values[q.key]}
              onChange={(n) => setValues((v) => ({ ...v, [q.key]: n }))}
              lowLabel={q.lowLabel}
              highLabel={q.highLabel}
              invert={q.invert}
            />
          </div>
        ))}

        <div>
          <label className="text-sm font-medium text-slate-700">Anything else? (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Encrypted at rest. Only you can read this."
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
          />
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}
        {ok && <div className="text-sm text-emerald-600">Saved — see you next week.</div>}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Submit pulse'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistorySparkline({ checkins }) {
  if (!checkins?.length) return null;
  const ordered = [...checkins].reverse(); // oldest -> newest
  const overall = ordered.map((c) => {
    const vals = [c.sleep, c.support, c.decisions, c.energy].filter((v) => typeof v === 'number');
    // Invert stress: 5 = high stress is bad, so use 6 - stress
    if (typeof c.stress === 'number') vals.push(6 - c.stress);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Your history</h3>
        <span className="text-xs text-slate-500">{checkins.length} check-in{checkins.length === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-3 flex items-end gap-1 h-20">
        {overall.map((v, i) => (
          <div
            key={i}
            title={`${ordered[i].week_anchor}: overall ${v?.toFixed(1) ?? '—'}/5`}
            className="flex-1 rounded-t bg-rose-400/70"
            style={{ height: v ? `${(v / 5) * 100}%` : '4px' }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400">
        <span>{ordered[0]?.week_anchor}</span>
        <span>{ordered[ordered.length - 1]?.week_anchor}</span>
      </div>
    </div>
  );
}

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
      {Object.entries(CATEGORY_META).map(([cat, meta]) => {
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
                  key={r.id}
                  href={r.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
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

function AdminAggregate() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [days, setDays] = useState(30);

  const load = async (d = days) => {
    setErr(null);
    try {
      setData(await api.wellbeingAggregate(d));
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') {
        // Route missing on this deployment — render the "withheld" state
        // rather than a raw red banner above it.
        setData({ insufficient_data: true, cohort_size: 0, submissions: 0, window_days: d, min_cohort: 0, averages: {} });
      } else {
        setErr(e.message || 'Failed');
      }
    }
  };
  useEffect(() => { load(days); /* eslint-disable-next-line */ }, [days]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-900">Anonymized founder pulse</h3>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      <p className="text-xs text-slate-500 mb-4 flex items-start gap-1.5">
        <Lock className="w-3 h-3 mt-0.5 shrink-0" />
        Aggregate-only. We never show per-founder check-ins. Withheld below the minimum cohort size to prevent re-identification. Investors do not have access to this view.
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
              <span>
                Below the minimum cohort of {data.min_cohort} unique founders. Averages are withheld
                so a single response can't be inferred. Encourage more founders to opt in.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {QUESTIONS.map((q) => (
                <div key={q.key} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{q.label}</div>
                  <div className="text-2xl font-semibold text-slate-900 mt-1">
                    {data.averages?.[q.key] ?? '—'}<span className="text-sm text-slate-400 font-normal">/5</span>
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

export default function WellbeingPage() {
  const user = readUser();
  const role = (user.role || '').toLowerCase();
  const viewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('viewMode')) || role;

  const [history, setHistory] = useState({ checkins: [], submitted_this_week: false });
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const isInvestor = role === 'investor';
  const showAggregate = role === 'admin' && viewMode === 'admin';
  const canCheckIn = role === 'founder' || role === 'admin';

  const load = async () => {
    setLoading(true);
    setErr(null);
    // 404 = wellbeing route missing on this deployment (stale worker). The
    // page already has empty/default UI for missing data — don't show a raw
    // red banner above it.
    const quiet404 = (fallback) => (e) => {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') return fallback;
      throw e;
    };
    try {
      const [res, hist] = await Promise.all([
        api.wellbeingResources().catch(quiet404({ resources: [] })),
        canCheckIn
          ? api.wellbeingMyCheckins().catch(quiet404({ checkins: [], submitted_this_week: false }))
          : Promise.resolve({ checkins: [], submitted_this_week: false }),
      ]);
      setResources(res.resources || []);
      setHistory(hist);
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
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Wellbeing data is private to founders and admin operators. Investors do not have access.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Heart className="w-6 h-6 text-rose-500" /> Founder Wellbeing
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Optional weekly pulse + a curated directory of mental-health resources for founders.
          Your individual answers are encrypted at rest and never shared with investors.
        </p>
      </div>

      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {loading && <div className="text-sm text-slate-500">Loading…</div>}

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {showAggregate && <AdminAggregate />}
            {canCheckIn && (
              <PulseForm
                alreadyThisWeek={history.submitted_this_week}
                onSubmitted={load}
              />
            )}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-slate-900">Resource directory</h3>
                <span className="text-xs text-slate-500">{resources.length} curated resource{resources.length === 1 ? '' : 's'}</span>
              </div>
              <ResourceList resources={resources} />
            </div>
          </div>
          <div className="space-y-6">
            {canCheckIn && <HistorySparkline checkins={history.checkins} />}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-xs text-slate-600 leading-relaxed">
              <div className="flex items-center gap-1.5 font-medium text-slate-700 mb-2">
                <Lock className="w-3.5 h-3.5" /> Privacy contract
              </div>
              <ul className="list-disc list-inside space-y-1">
                <li>Your answers are stored encrypted at rest (Fernet).</li>
                <li>Only you can read your individual check-ins.</li>
                <li>Admins see only anonymized averages, and only above a minimum cohort size.</li>
                <li>Investors do not have access to this surface — neither rows nor aggregates.</li>
                <li>If you are in crisis, please contact one of the hotlines above.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
