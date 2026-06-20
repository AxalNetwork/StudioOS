// Task #20 — "Your Profile & Fit" section. Shared by the dashboard (rendered
// after the Personal Advisor) and the dedicated /profile page. Reads ONLY the
// self endpoints that exist today:
//   - api.radar.me()          → 8-axis skill radar
//   - api.values.getMe()      → 15-dimension values lean
//   - api.assessment.myResults() → latest archetype
//   - api.advisor.progress()  → conversational-profiling completion %
//   - api.matches.summary()   → cross-counterparty match range (see MatchSummaryCard)
//   - api.bestFit.me()        → the caller's own Axal Fit scorecard + 5 Axal values
//
// api.bestFit.me() is read-only and leaner than the admin report: it carries the
// per-persona fit scorecard + behavioral values only. Cross-counterparty matches
// stay gated via api.matches.summary(); the full report stays admin-only. Until
// the advisor conversation has enough signal, the fit card shows a clean empty
// state instead of fabricating data.
import React, { useEffect, useState, useCallback } from 'react';
import {
  UserCircle, Target, Heart, Sparkles, Lock, Loader2, AlertCircle,
  CheckCircle2, CalendarPlus, ArrowRight, Users,
} from 'lucide-react';
import { api } from '../../lib/api';
import SkillRadar from '../play/SkillRadar';
import { openPaywall } from '../PaywallModal';
import { archetypeMeta, iconFor, humanize } from '../../lib/assessmentMeta';

const CARD = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5';
const H = 'text-sm font-semibold text-gray-900 dark:text-gray-100';
const SUB = 'text-xs text-gray-500 dark:text-gray-400';

function CardShell({ title, icon: Icon, className = '', children, action }) {
  return (
    <div className={`${CARD} ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon ? <Icon size={16} className="text-violet-600 dark:text-violet-400" /> : null}
          <h4 className={H}>{title}</h4>
        </div>
        {action || null}
      </div>
      {children}
    </div>
  );
}

function Nudge({ children }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/40 p-4 text-sm text-gray-600 dark:text-gray-300">
      {children}
    </div>
  );
}

function ErrorNote({ children }) {
  return (
    <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
      <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ── Skills radar ────────────────────────────────────────────────────────────
function SkillsRadarCard({ state, className }) {
  const { data, error } = state;
  let body;
  if (error) {
    body = <ErrorNote>Couldn’t load your skills radar. {error}</ErrorNote>;
  } else if (!data) {
    body = <div className="h-[200px] flex items-center justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else {
    const axes = Array.isArray(data.axes) ? data.axes : [];
    const hasData = axes.some((a) => Number(a.skill_count) > 0 || Number(a.score) > 0);
    if (!hasData) {
      body = <Nudge>Answer a few skill questions in the advisor to build your 8-axis radar.</Nudge>;
    } else {
      // Radar scores are 0–100; SkillRadar plots a 0–5 domain keyed by axis slug.
      const skillVector = {};
      for (const a of axes) skillVector[a.slug] = (Number(a.score) || 0) / 20;
      body = (
        <>
          <SkillRadar skillVector={skillVector} height={210} />
          <p className={`${SUB} text-center mt-1`}>Overall {Math.round(Number(data.overall) || 0)} / 100</p>
        </>
      );
    }
  }
  return <CardShell title="Skills radar" icon={Target} className={className}>{body}</CardShell>;
}

// ── 15-dimension values lean ──────────────────────────────────────────────────
function leanLabel(v) {
  const s = Number(v.score) || 0;
  if (s > 0.2) return v.pole_high || 'High';
  if (s < -0.2) return v.pole_low || 'Low';
  return 'Balanced';
}
function ValuesLeanCard({ state, className }) {
  const { data, error } = state;
  let body;
  if (error) {
    body = <ErrorNote>Couldn’t load your values. {error}</ErrorNote>;
  } else if (!data) {
    body = <div className="py-6 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else {
    const vector = (Array.isArray(data.vector) ? data.vector : []).filter((v) => Number(v.confidence) > 0);
    if (vector.length === 0) {
      body = <Nudge>Your values profile builds as you talk to the advisor — nothing measured yet.</Nudge>;
    } else {
      const top = (data.summary?.top || []).map((t) => t.label).filter(Boolean);
      body = (
        <>
          {top.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {top.map((label) => (
                <span key={label} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                  {label}
                </span>
              ))}
            </div>
          )}
          <ul className="space-y-1.5">
            {vector.slice(0, 6).map((v) => (
              <li key={v.dimension_slug} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-700 dark:text-gray-300 truncate">{v.dimension_label || v.dimension_slug}</span>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">{leanLabel(v)}</span>
              </li>
            ))}
          </ul>
        </>
      );
    }
  }
  return <CardShell title="Values lean" icon={Heart} className={className}>{body}</CardShell>;
}

// ── Archetype ─────────────────────────────────────────────────────────────────
function ArchetypeCard({ state, className }) {
  const { data, error } = state;
  let body;
  if (error) {
    body = <ErrorNote>Couldn’t load your archetype. {error}</ErrorNote>;
  } else if (!data) {
    body = <div className="py-6 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else {
    const list = (Array.isArray(data.results) ? data.results : []).filter((r) => r.archetype_slug);
    const latest = list.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0] || null;
    if (!latest) {
      body = <Nudge>Complete the advisor’s founder questions to reveal your archetype.</Nudge>;
    } else {
      const meta = archetypeMeta(latest.archetype_slug);
      const Icon = iconFor(meta?.icon);
      const accent = meta?.accent || '#7c3aed';
      body = (
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${accent}22`, color: accent }}>
            <Icon size={22} />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{latest.archetype_label || meta?.label || latest.archetype_slug}</p>
            {meta?.tagline && <p className="text-xs font-medium" style={{ color: accent }}>{meta.tagline}</p>}
            {meta?.description && <p className={`${SUB} mt-1`}>{meta.description}</p>}
          </div>
        </div>
      );
    }
  }
  return <CardShell title="Your archetype" icon={Sparkles} className={className}>{body}</CardShell>;
}

// ── Completion % ──────────────────────────────────────────────────────────────
function CompletionCard({ state, className }) {
  const { data, error } = state;
  let body;
  if (error) {
    body = <ErrorNote>Couldn’t load your progress. {error}</ErrorNote>;
  } else if (!data) {
    body = <div className="py-4 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else {
    // /api/advisor/progress returns { persona, total, answered, skipped, percent }.
    const pct = Math.max(0, Math.min(100, Math.round(Number(data.percent) || 0)));
    const asked = Number(data.answered) || 0;
    const total = Number(data.total) || 0;
    body = (
      <>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{pct}%</span>
          <span className={SUB}>{asked}{total ? ` / ${total}` : ''} answered</span>
        </div>
        <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div className="h-full bg-violet-600 dark:bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className={`${SUB} mt-2`}>
          {pct >= 100
            ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={13} /> Profiling complete</span>
            : 'Keep chatting with the advisor to sharpen every result above.'}
        </p>
      </>
    );
  }
  return <CardShell title="Profiling completion" icon={UserCircle} className={className}>{body}</CardShell>;
}

// ── Fit + Axal-5 (self: api.bestFit.me) ──────────────────────────────────────
const FIT_BAND = {
  strong_yes: { label: 'Strong yes', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' },
  yes_caution: { label: 'Yes, with caution', cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-700' },
  hold: { label: 'Hold — more diligence', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700' },
  no: { label: 'No', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600' },
};

function FitCard({ state, className }) {
  const { data, error } = state;
  let body;
  if (error) {
    body = <ErrorNote>Couldn’t load your Axal Fit. {error}</ErrorNote>;
  } else if (!data) {
    body = <div className="py-4 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else {
    // GET /api/best-fit/me → { primary_persona, fit[], axal_values[], computed_at }.
    const fit = Array.isArray(data.fit) ? data.fit : [];
    const axal = Array.isArray(data.axal_values) ? data.axal_values : [];
    const axalWithSignal = axal.filter((v) => Number(v.confidence) > 0);
    if (fit.length === 0 && axalWithSignal.length === 0) {
      body = (
        <Nudge>
          <p className="font-medium text-gray-700 dark:text-gray-200">Complete your profiling to unlock</p>
          <p className="mt-1">
            Your personal <strong>Axal Fit score &amp; band</strong> and your <strong>5 Axal behavioral values</strong>
            {' '}are computed once your advisor conversation has enough signal. Finish the questions above to reveal them.
          </p>
        </Nudge>
      );
    } else {
      body = (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className={`${SUB} mb-2`}>Axal Fit scorecard</p>
            {fit.length === 0 ? (
              <p className={SUB}>No fit computed yet (insufficient signal).</p>
            ) : (
              <div className="space-y-2">
                {fit.map((f) => {
                  const b = FIT_BAND[f.band] || FIT_BAND.no;
                  return (
                    <div key={f.persona} className={`rounded-lg border p-2.5 ${data.primary_persona === f.persona ? 'ring-1 ring-violet-500/50' : ''} ${b.cls}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold capitalize">{humanize(f.persona)}</span>
                        <span className="text-base font-bold">{Math.round(Number(f.total_score) || 0)}<span className="text-xs font-normal">/100</span></span>
                      </div>
                      <p className="text-xs font-medium mt-0.5">{f.band_label || b.label}</p>
                      {f.narrative_fit && <p className="text-xs mt-1 opacity-90 line-clamp-3">{f.narrative_fit}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <p className={`${SUB} mb-2`}>5 Axal behavioral values</p>
            {axalWithSignal.length === 0 ? (
              <p className={SUB}>No behavioral values recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {axal.map((v) => (
                  <li key={v.value_key}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="capitalize text-gray-700 dark:text-gray-300">{humanize(v.value_key)}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{(Number(v.score) || 0).toFixed(1)}/5</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      <div className="h-full bg-violet-500 dark:bg-violet-400" style={{ width: `${Math.max(0, Math.min(100, (Number(v.score) || 0) / 5 * 100))}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      );
    }
  }
  return <CardShell title="Your Axal Fit & values" icon={Sparkles} className={className}>{body}</CardShell>;
}

// ── Match range (counts + teaser free; full list gated) ───────────────────────
const MATCH_BAND = {
  strong: { label: 'Strong', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
  good: { label: 'Good', cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  fair: { label: 'Fair', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  low: { label: 'Low', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' },
};
function BandPill({ band }) {
  const b = MATCH_BAND[band] || MATCH_BAND.low;
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${b.cls}`}>{b.label}</span>;
}
function MatchSummaryCard({ className }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.matches.summary()
      .then((res) => { if (alive) setData(res); })
      .catch((e) => { if (alive) setError(e?.message || 'Failed to load matches'); });
    return () => { alive = false; };
  }, []);

  const unlock = useCallback(() => {
    openPaywall('studio', 'Upgrade to Studio to see your full match list — names, scores, and the reasons behind every match.');
  }, []);

  let body;
  if (error) {
    body = <ErrorNote>Couldn’t load your matches. {error}</ErrorNote>;
  } else if (!data) {
    body = <div className="py-6 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else {
    const types = Array.isArray(data.types) ? data.types : [];
    const anyMatches = types.some((t) => Number(t.count) > 0);
    if (!anyMatches) {
      body = <Nudge>No matches yet. Complete your profile and opt in to matching to see who you fit with across the network.</Nudge>;
    } else {
      body = (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {types.map((t) => {
              const teaser = t.teaser || null;
              const list = Array.isArray(t.matches) ? t.matches : [];
              return (
                <div key={t.type} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{t.label}</span>
                    <span className="text-xs font-semibold text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 rounded-full">{Number(t.count) || 0}</span>
                  </div>
                  {data.unlocked ? (
                    list.length > 0 ? (
                      <ul className="mt-2 space-y-1.5">
                        {list.slice(0, 3).map((m) => (
                          <li key={m.user_id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-gray-700 dark:text-gray-300 truncate">{m.name || m.uid || `#${m.user_id}`}</span>
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              <BandPill band={m.band} />
                              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{Math.round(Number(m.match_score) || 0)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className={`${SUB} mt-2`}>No qualifying matches yet.</p>
                  ) : teaser ? (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">Top match</span>
                        <span className="flex items-center gap-1.5">
                          <BandPill band={teaser.band} />
                          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{Math.round(Number(teaser.match_score) || 0)}</span>
                        </span>
                      </div>
                      {teaser.top_reason && (
                        <p className={`${SUB} mt-1 line-clamp-2`}>“{teaser.top_reason}”</p>
                      )}
                    </div>
                  ) : <p className={`${SUB} mt-2`}>No match preview yet.</p>}
                </div>
              );
            })}
          </div>
          {!data.unlocked && (
            <button
              type="button"
              onClick={unlock}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline"
            >
              <Lock size={13} /> Unlock full match list
            </button>
          )}
        </>
      );
    }
  }
  return <CardShell title="Best-fit matches" icon={Users} className={className}>{body}</CardShell>;
}

// ── Book with Guillaume ───────────────────────────────────────────────────────
function BookConsultationCard({ className }) {
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getMyConsultations()
      .then((res) => setMine(Array.isArray(res) ? res : (res?.consultations || res?.bookings || [])))
      .catch(() => setMine([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = useCallback(async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.bookConsultation({ topic: topic.trim() || undefined, notes: notes.trim() || undefined });
      setTopic(''); setNotes('');
      load();
    } catch (err) {
      setError(err?.message || 'Could not request a consultation. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [topic, notes, load]);

  const STATUS = {
    requested: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    confirmed: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    completed: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
    cancelled: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  };

  return (
    <CardShell title="Book with Guillaume" icon={CalendarPlus} className={className}>
      <p className={`${SUB} mb-3`}>Request a 1:1 to walk through your Best-Fit report and matches.</p>
      <form onSubmit={submit} className="space-y-2">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic (optional)"
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-gray-500"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything you’d like to cover (optional)"
          rows={2}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-gray-500 resize-none"
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CalendarPlus size={15} />}
          {busy ? 'Requesting…' : 'Request a slot'}
        </button>
      </form>
      {Array.isArray(mine) && mine.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-gray-200 dark:border-gray-700 pt-3">
          {mine.slice(0, 3).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-gray-700 dark:text-gray-300 truncate">{c.topic || 'Consultation'}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS[c.status] || STATUS.requested}`}>{c.status || 'requested'}</span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
export default function ProfileFitSection({ className = '' }) {
  const [radar, setRadar] = useState({ data: null, error: '' });
  const [values, setValues] = useState({ data: null, error: '' });
  const [results, setResults] = useState({ data: null, error: '' });
  const [progress, setProgress] = useState({ data: null, error: '' });
  const [fit, setFit] = useState({ data: null, error: '' });

  useEffect(() => {
    let alive = true;
    const wire = (p, set) => p
      .then((d) => { if (alive) set({ data: d, error: '' }); })
      .catch((e) => { if (alive) set({ data: null, error: e?.message || 'Failed to load' }); });
    wire(api.radar.me(), setRadar);
    wire(api.values.getMe(), setValues);
    wire(api.assessment.myResults(), setResults);
    wire(api.advisor.progress(), setProgress);
    wire(api.bestFit.me(), setFit);
    return () => { alive = false; };
  }, []);

  return (
    <section id="profile" className={`space-y-4 ${className}`}>
      <div className="flex items-center gap-2">
        <UserCircle size={20} className="text-violet-600 dark:text-violet-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Your Profile &amp; Fit</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <SkillsRadarCard state={radar} className="lg:col-span-2" />
        <ValuesLeanCard state={values} className="lg:col-span-2" />
        <ArchetypeCard state={results} className="lg:col-span-2" />
        <CompletionCard state={progress} className="md:col-span-1 lg:col-span-2" />
        <FitCard state={fit} className="md:col-span-1 lg:col-span-4" />
        <MatchSummaryCard className="md:col-span-2 lg:col-span-4" />
        <BookConsultationCard className="md:col-span-2 lg:col-span-2" />
      </div>
    </section>
  );
}
