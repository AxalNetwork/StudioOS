// Spin-Out Lab — Advisors (Week 3 tool page).
//
// Design handoff: attached_assets/Advisors.dc_*.html. The design's fabricated
// content (invented advisor personas, cohort "team score 72→84" projection,
// made-up equity suggestions, AI intro copy) is intentionally NOT reproduced.
// Everything on this page is live data:
//   - Ranked matches: Worker-only GET /api/advisors/match (real vector-based
//     engine: domain overlap 40 / values alignment 30 / skill complement 30).
//     ONLY a 404 means "engine not in this environment" — then we fall back
//     to the advisor directory's server-computed relevance ranking and say so.
//   - Score breakdown: the engine's three real components with their real
//     maximums. The design shows six invented dimensions (Archetype fit,
//     Sector relevance, Stage relevance…) with per-advisor numbers nothing
//     computes; we render only what actually produced the total.
//   - Likely contribution: the advisor's declared expertise intersected with
//     the founder's weakest scored dimensions. Omitted when either side is
//     unknown, rather than inventing the design's per-advisor prose.
//   - "Request another match" re-runs the SAME engine with narrowing filters
//     (?gap= radar axis, ?focus= specialist|generalist). Both filter the
//     scored set server-side, so a refined shortlist is always a subset and
//     the scores keep their meaning. The active refinement and the
//     before/after count are shown, so a short list is never mistaken for an
//     empty network. Hidden on the directory fallback, which cannot filter.
//   - Gap diagnosis: weakest dimensions from the user's latest real Scoring
//     Engine snapshot (shared buildDimensions from the scoring page).
//   - Team profile: readiness coverage from the same snapshot; values +
//     archetype from the Worker-only assessment endpoints (honest
//     unavailable/error states, same convention as the profiling page).
//   - Advisor bench: the user's real advisor session bookings.
//   - Booking a session is the real "engage an advisor" action and marks the
//     `advisor_meeting_booked` Week-3 milestone.
// The intro draft is a client-side template assembled ONLY from real profile
// and match fields, clearly labelled as a draft for the user to edit.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Loader2, Lock, Star, Calendar, Copy, Check,
  AlertTriangle, ExternalLink, X, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import { api, spinoutLab, assessment } from '../lib/api';
import { archetypeMeta, SKILL_AXES } from '../lib/assessmentMeta';
import { pickLabProject } from './SpinoutLabStartupPage';
import { buildDimensions } from '../lib/scoringViewModel';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function initialsOf(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
}

// Normalize a Worker /advisors/match item and a dev directory item into one
// shape. Both carry ONLY server-computed fields — no invented numbers.
export function normalizeMatch(item, source) {
  if (source === 'engine') {
    const a = item?.advisor || {};
    return {
      uid: a.uid || '',
      name: a.display_name || a.name || '—',
      headline: a.headline || '',
      bio: a.bio || '',
      specialties: Array.isArray(a.expertise) ? a.expertise : Array.isArray(a.specialties) ? a.specialties : [],
      sectors: Array.isArray(a.sectors) ? a.sectors : [],
      rating: Number.isFinite(Number(a.rating_avg)) && Number(a.rating_avg) > 0 ? Number(a.rating_avg) : null,
      score: Math.max(0, Math.min(100, num(item?.match_score))),
      breakdown: item?.breakdown && typeof item.breakdown === 'object' ? item.breakdown : null,
      reasons: Array.isArray(item?.reasons) ? item.reasons : [],
      watchOuts: Array.isArray(item?.watch_outs) ? item.watch_outs : [],
    };
  }
  const a = item || {};
  return {
    uid: a.uid || '',
    name: a.name || '—',
    headline: a.headline || '',
    bio: a.bio || '',
    specialties: Array.isArray(a.specialties) ? a.specialties : [],
    sectors: Array.isArray(a.sectors) ? a.sectors : [],
    rating: Number.isFinite(Number(a.rating_avg)) && Number(a.rating_avg) > 0 ? Number(a.rating_avg) : null,
    advisorId: a.id ?? null,
    score: Math.max(0, Math.min(100, num(a.match_score))),
    breakdown: null,
    reasons: Array.isArray(a.match_reasons) ? a.match_reasons : [],
    watchOuts: [],
  };
}

// The engine's three scoring components and their real maximums, straight from
// cloudflare-worker/src/routes/advisors.ts. The design shows six invented
// dimensions (Archetype fit, Sector relevance, Stage relevance…) with
// per-advisor numbers that nothing computes — we render the three that are
// actually scored, with the weights that actually produced the total.
export const BREAKDOWN_PARTS = [
  { key: 'domain_overlap', label: 'Domain overlap', max: 40, bar: 'bg-violet-500' },
  { key: 'values_alignment', label: 'Values alignment', max: 30, bar: 'bg-sky-500' },
  { key: 'skill_complementarity', label: 'Skill complementarity', max: 30, bar: 'bg-emerald-500' },
];

export function breakdownRows(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return [];
  return BREAKDOWN_PARTS.map((p) => {
    const raw = Number(breakdown[p.key]);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(p.max, raw)) : null;
    return { ...p, value: v, pct: v == null ? 0 : Math.round((v / p.max) * 100) };
  }).filter((r) => r.value != null);
}

/**
 * "Likely contribution" — the advisor's own declared expertise, narrowed to
 * the areas the founder is actually weak in. Returns [] when either side is
 * unknown, so the card is omitted rather than guessing: the design's version
 * ("Enterprise GTM, first sales hires, pricing") is per-advisor prose that
 * nothing generates.
 */
// Advisor expertise and scoring-dimension labels are different vocabularies
// ("gtm" vs "Go-to-market"), so a raw substring test misses real overlaps.
// This is the client-side echo of EXPERTISE_AXIS in the worker's matcher —
// same intent, but expanding to words that appear in dimension TITLES rather
// than to radar-axis slugs.
const CONTRIBUTION_SYNONYMS = {
  gtm: 'go-to-market', sales: 'go-to-market', growth: 'go-to-market',
  marketing: 'go-to-market', 'go to market': 'go-to-market',
  fundraising: 'capital', capital: 'capital', investor: 'capital',
  ops: 'operations', operating: 'operations',
  hiring: 'team', recruiting: 'team', people: 'team', talent: 'team',
  eng: 'product', engineering: 'product', technical: 'product',
};
function contributionTerms(s) {
  const t = String(s || '').toLowerCase().trim();
  const syn = CONTRIBUTION_SYNONYMS[t];
  return syn && syn !== t ? [t, syn] : [t];
}

export function likelyContribution(specialties, gapLabels) {
  const gaps = (gapLabels || []).map((g) => String(g).toLowerCase()).filter(Boolean);
  if (!gaps.length) return [];
  return (specialties || [])
    .filter((s) => {
      const terms = contributionTerms(s).filter(Boolean);
      // Guard against the empty string, which is a substring of everything and
      // would make every advisor look like a match.
      return terms.some((t) => t && gaps.some((g) => g.includes(t) || t.includes(g)));
    })
    .slice(0, 3);
}

// Values-fit label from the REAL engine breakdown (values_alignment is out of
// 30 in the Worker matcher). Null when there is no breakdown — the fallback
// directory ranking has no values signal and we never invent one.
export function valuesFitLabel(breakdown) {
  const v = Number(breakdown?.values_alignment);
  if (!Number.isFinite(v)) return null;
  const pct = (v / 30) * 100;
  if (pct >= 70) return 'High values fit';
  if (pct >= 50) return 'Medium values fit';
  return 'Low values fit';
}

// Gap cards from the latest real scoring snapshot: dimensions under 70%,
// weakest first (buildDimensions already sorts weakest-first).
export function buildGaps(snapshot) {
  if (!snapshot) return [];
  return buildDimensions(snapshot)
    .filter((d) => d.pct < 70)
    .slice(0, 4)
    .map((d) => {
      const weakest = (d.subs || []).reduce(
        (worst, s) => (worst === null || s.points / s.max < worst.points / worst.max ? s : worst),
        null,
      );
      return {
        key: d.key,
        kind: d.key === 'team' ? 'Missing skill' : 'Scoring weak point',
        title: d.label,
        detail: weakest ? `${weakest.label} ${weakest.points}/${weakest.max} self-scored` : `${d.pct}% of available points`,
        pointsAvailable: d.pointsAvailable,
      };
    });
}

// Client-side intro DRAFT assembled only from real fields. Clearly labelled a
// draft — nothing here claims to be AI-personalized.
export function buildIntroDraft(match, projectName) {
  const first = String(match?.name || '').split(/\s+/)[0] || 'there';
  const lines = [`Hi ${first},`, ''];
  lines.push(
    `I'm working on ${projectName || 'an early-stage project'} in the Axal Spin-Out Lab, and your background${match?.headline ? ` in ${match.headline.toLowerCase()}` : ''} came up as a strong complement to our team.`,
  );
  const reasons = (match?.reasons || []).slice(0, 2).filter((r) => typeof r === 'string' && !r.startsWith('⭐'));
  if (reasons.length) {
    lines.push('', `Specifically: ${reasons.join('; ')}.`);
  }
  const specs = (match?.specialties || []).slice(0, 2).join(' and ');
  lines.push('', `Would you be open to a 30-minute intro call${specs ? ` to talk ${specs}` : ''}?`, '', 'Thanks,');
  return lines.join('\n');
}

const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const STATUS_STYLE = {
  requested: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  confirmed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  completed: 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  no_show: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

export default function SpinoutLabAdvisorsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [snapshot, setSnapshot] = useState(null); // latest score snapshot | null
  const [snapshotError, setSnapshotError] = useState(false);
  const [matches, setMatches] = useState(null); // {source, items, filters} | {failed} | null
  // "Request another match" — re-runs the real engine with narrowing filters.
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineGap, setRefineGap] = useState('');
  const [refineFocus, setRefineFocus] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState(null);
  const [bookings, setBookings] = useState(null); // {items} | {failed} | null
  const [values, setValues] = useState(null); // dto | {unavailable} | {failed}
  const [results, setResults] = useState(null); // [] | {unavailable} | {failed}
  const [filter, setFilter] = useState('all');
  const [slotsFor, setSlotsFor] = useState(null); // advisor uid with open slot panel
  const [slots, setSlots] = useState(null); // {items} | {failed} | 'loading'
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookError, setBookError] = useState('');
  const [introFor, setIntroFor] = useState(null); // match object
  const [copied, setCopied] = useState(false);

  const milestoneDone = (st, key) =>
    (st?.milestones || []).some((m) => (m.key || m.milestone_key) === key);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        // Worker-only endpoints: ONLY 404 = "not in this environment".
        const wkOnly = (e) => (e?.status === 404 ? { unavailable: true } : { failed: true });
        const [st, me, projects, vals, res, myBookings] = await Promise.all([
          spinoutLab.state().catch(() => null),
          api.getMe(),
          api.listProjects().catch(() => []),
          api.values.getMe().catch(wkOnly),
          assessment.myResults().catch(wkOnly),
          api.listMyMenteeBookings().catch(() => ({ failed: true })),
        ]);
        if (dead) return;
        setState(st);
        setUser(me);
        setValues(vals);
        setResults(res?.unavailable || res?.failed ? res : Array.isArray(res?.results) ? res.results : []);
        const bk = myBookings?.failed
          ? { failed: true }
          : { items: Array.isArray(myBookings?.items) ? myBookings.items : [] };
        setBookings(bk);
        const proj = pickLabProject(projects, me);
        setProject(proj || null);

        // Ranked matches: real engine first, directory ranking as the honest
        // dev fallback (a labelled source note renders below).
        const engine = await api.advisorsMatch().catch(wkOnly);
        if (dead) return;
        if (engine?.unavailable) {
          const dir = await api.listAdvisors().catch(() => null);
          if (dead) return;
          setMatches(
            dir && Array.isArray(dir.items)
              ? { source: 'directory', items: dir.items.map((it) => normalizeMatch(it, 'directory')) }
              : { failed: true },
          );
        } else if (engine?.failed) {
          setMatches({ failed: true });
        } else {
          setMatches({
            source: 'engine',
            items: (Array.isArray(engine?.items) ? engine.items : []).map((it) => normalizeMatch(it, 'engine')),
            filters: engine?.filters || null,
            totalBeforeFilters: Number.isFinite(Number(engine?.total_before_filters))
              ? Number(engine.total_before_filters)
              : null,
          });
        }

        if (proj) {
          const scores = await api.getScores(proj.id, { includeSandbox: true }).catch(() => null);
          if (dead) return;
          if (Array.isArray(scores)) setSnapshot(scores[0] || null);
          else setSnapshotError(true);
        }

        // Reconcile the Week-3 milestone: a booking made anywhere (e.g. the
        // /advisors directory) counts — the deliverable is the meeting, not
        // which page it was booked from.
        if (st?.active && !milestoneDone(st, 'advisor_meeting_booked') && (bk.items || []).some((b) => b.status !== 'cancelled')) {
          try {
            await spinoutLab.complete('advisor_meeting_booked');
            const fresh = await spinoutLab.state().catch(() => null);
            if (!dead && fresh) setState(fresh);
          } catch (err) {
            console.warn('[spinout-advisors:milestone]', err);
          }
        }
        setStatus('ready');
      } catch (e) {
        console.error('[spinout-advisors]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  // NOTE: declared before first use — referencing it below a later `const`
  // declaration threw a TDZ crash ("Cannot access 'isAdmin' before
  // initialization") that took down the whole page.
  const isAdmin = user?.role === 'admin';
  const unlocked = isAdmin || (state?.unlocked_features || []).includes('advisors');
  const items = useMemo(() => {
    const list = Array.isArray(matches?.items) ? [...matches.items] : [];
    return list.sort((a, b) => b.score - a.score);
  }, [matches]);

  // Filter chips derived from the specialties actually present.
  const filterOptions = useMemo(() => {
    const counts = new Map();
    for (const m of items) for (const s of m.specialties) counts.set(s, (counts.get(s) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  }, [items]);
  const visible = filter === 'all' ? items : items.filter((m) => m.specialties.includes(filter));

  const gaps = useMemo(() => buildGaps(snapshot), [snapshot]);
  const coverage = useMemo(() => (snapshot ? buildDimensions(snapshot).sort((a, b) => a.label.localeCompare(b.label)) : []), [snapshot]);

  const valueRows = useMemo(() => {
    if (!values || values.unavailable || values.failed) return null;
    return (Array.isArray(values.vector) ? values.vector : [])
      .filter((v) => Number.isFinite(Number(v?.score)))
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, 4);
  }, [values]);

  const latestResult = Array.isArray(results) && results.length ? results[0] : null;
  const archMeta = latestResult ? archetypeMeta(latestResult.archetype_slug) : null;

  const advisorNameById = useMemo(() => {
    const map = new Map();
    for (const m of items) if (m.advisorId != null) map.set(m.advisorId, m.name);
    return map;
  }, [items]);

  // Re-run the real engine with narrowing filters. Only reachable when the
  // engine itself answered — the directory fallback has no filter support, so
  // the control is hidden rather than silently doing nothing.
  // `override` lets a caller pass the filters explicitly. The Clear button
  // needs it: setState is async, so calling this straight after setRefineGap('')
  // would re-query with the OLD filter values still in scope.
  const runRefine = async (e, override) => {
    e?.preventDefault?.();
    const gap = override ? override.gap : refineGap;
    const focus = override ? override.focus : refineFocus;
    setRefining(true);
    setRefineError(null);
    try {
      const res = await api.advisorsMatch({ gap: gap || undefined, focus: focus || undefined });
      setMatches({
        source: 'engine',
        items: (Array.isArray(res?.items) ? res.items : []).map((it) => normalizeMatch(it, 'engine')),
        filters: res?.filters || null,
        totalBeforeFilters: Number.isFinite(Number(res?.total_before_filters))
          ? Number(res.total_before_filters)
          : null,
      });
      setFilter('all'); // a stale specialty chip could hide the new shortlist
      setRefineOpen(false);
    } catch (err) {
      setRefineError(err?.message || 'Could not regenerate the shortlist.');
    } finally {
      setRefining(false);
    }
  };

  const openSlots = async (uid) => {
    if (slotsFor === uid) { setSlotsFor(null); setSlots(null); setBookError(''); return; }
    setSlotsFor(uid);
    setSlots('loading');
    setBookError('');
    try {
      const res = await api.listAdvisorSlots(uid, true);
      setSlots({ items: Array.isArray(res?.items) ? res.items : [] });
    } catch (e) {
      console.error('[spinout-advisors:slots]', e);
      setSlots({ failed: true });
    }
  };

  const bookSlot = async (slot) => {
    if (bookingBusy) return;
    setBookingBusy(true);
    setBookError('');
    try {
      await api.bookAdvisorSlot(slot.id, {
        topic: `Spin-Out Lab intro — ${project?.name || 'my project'}`,
        project_id: project?.id,
      });
      const fresh = await api.listMyMenteeBookings().catch(() => null);
      if (fresh && Array.isArray(fresh.items)) setBookings({ items: fresh.items });
      if (state?.active && !milestoneDone(state, 'advisor_meeting_booked')) {
        try {
          await spinoutLab.complete('advisor_meeting_booked');
          const st = await spinoutLab.state().catch(() => null);
          if (st) setState(st);
        } catch (err) {
          console.warn('[spinout-advisors:milestone]', err);
        }
      }
      setSlotsFor(null);
      setSlots(null);
    } catch (e) {
      console.error('[spinout-advisors:book]', e);
      setBookError(e?.data?.detail || e?.message || 'Booking failed.');
    } finally {
      setBookingBusy(false);
    }
  };

  const copyIntro = async () => {
    try {
      await navigator.clipboard.writeText(buildIntroDraft(introFor, project?.name));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="advisors-loading">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="advisors-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load Advisors</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Reload the page to try again.</p>
      </div>
    );
  }
  if (!state?.active && !isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="advisors-inactive">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Spin-Out Lab is not active</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Advisor matching is part of the Spin-Out Lab program.{' '}
          <Link to="/spinout-lab" className="text-violet-600 hover:underline">Go to the Lab</Link>
        </p>
      </div>
    );
  }
  if (!unlocked) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="advisors-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Advisors unlocks in Week 3</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Finish your current week's deliverables to unlock advisor matching.
        </p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }

  const week = num(user?.spinout_lab_week) || state?.week || 3;

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-advisors">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/spinout-lab')}
          data-testid="button-back-workspace"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft size={14} /> Back to Workspace
        </button>
        <div className="flex items-center gap-2">
          <Users size={16} className="text-violet-500" />
          <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Advisors</h1>
          <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Active</span>
        </div>
        <span className="ml-auto text-[11px] font-semibold text-gray-400 dark:text-gray-500">Unlocked · Wk {week}</span>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Advisor matching — ranked by how well each candidate complements your founding team.
      </p>

      {/* Gap diagnosis strip — from the latest real scoring run */}
      <div className={CARD} data-testid="card-gaps">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">Best advisors to complement your founding team</div>
            <div className="text-[11.5px] text-gray-400 dark:text-gray-500">
              {snapshot
                ? `Diagnosed from your latest Scoring Engine run · ${visible.length} match${visible.length === 1 ? '' : 'es'} shown`
                : 'Gap diagnosis needs a Scoring Engine run'}
            </div>
          </div>
          {snapshot && (
            <div className="text-right">
              <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-50 tabular-nums" data-testid="text-gaps-team-score">
                Team {num(snapshot.team_total)}/20
              </div>
              <div className="text-[10.5px] text-gray-400">team dimension, latest run</div>
            </div>
          )}
        </div>
        {snapshotError ? (
          <div className="text-[12.5px] text-amber-600 dark:text-amber-400" data-testid="gaps-error">
            Couldn't load your scoring history right now, so gap diagnosis is unavailable.
          </div>
        ) : !snapshot ? (
          <div className="text-[12.5px] text-gray-500 dark:text-gray-400" data-testid="gaps-empty">
            No scoring run yet —{' '}
            <Link to="/spinout-lab/scoring" className="text-violet-600 font-semibold hover:underline">run a practice score</Link>{' '}
            to see which gaps an advisor should close.
          </div>
        ) : gaps.length === 0 ? (
          <div className="text-[12.5px] text-emerald-600 dark:text-emerald-400" data-testid="gaps-none">
            No dimension is below 70% in your latest run — pick advisors that deepen strengths rather than patch gaps.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {gaps.map((g) => (
              <div
                key={g.key}
                data-testid={`gap-${g.key}`}
                className={`rounded-xl border px-3 py-2.5 ${g.kind === 'Missing skill' ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-900/20' : 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-900/20'}`}
              >
                <div className={`text-[9.5px] font-bold uppercase tracking-wider mb-1 ${g.kind === 'Missing skill' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {g.kind}
                </div>
                <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50">{g.title}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">{g.detail} · +{g.pointsAvailable} pts available</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
        {/* Ranked matches */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className={LBL}>Ranked matches · best complement first</div>
            {matches?.source === 'engine' && (
              <button
                type="button"
                onClick={() => { setRefineError(null); setRefineOpen(true); }}
                data-testid="button-request-another-match"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300 hover:underline"
              >
                <RefreshCw size={11} /> Request another match
              </button>
            )}
            <div className="ml-auto flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setFilter('all')}
                data-testid="filter-all"
                className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${filter === 'all' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
              >
                All
              </button>
              {filterOptions.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  data-testid={`filter-${f}`}
                  className={`text-[11px] font-semibold rounded-full px-2.5 py-1 capitalize ${filter === f ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Active refinement — stated explicitly so a short shortlist never
              reads as "the network is empty". */}
          {(matches?.filters?.gap || matches?.filters?.focus) && (
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="active-refinement">
              <span>
                Refined to
                {matches.filters.gap ? ` ${SKILL_AXES[matches.filters.gap] || matches.filters.gap}` : ''}
                {matches.filters.focus ? ` ${matches.filters.focus}s` : ''}
                {matches.totalBeforeFilters != null
                  ? ` — ${items.length} of ${matches.totalBeforeFilters} ranked advisors`
                  : ''}.
              </span>
              <button
                type="button"
                onClick={() => { setRefineGap(''); setRefineFocus(''); runRefine(null, { gap: '', focus: '' }); }}
                data-testid="button-clear-refinement"
                className="font-semibold text-violet-700 dark:text-violet-300 hover:underline"
              >
                Clear
              </button>
            </div>
          )}

          {matches?.failed ? (
            <div className={`${CARD} text-center py-10`} data-testid="matches-error">
              <AlertTriangle className="w-7 h-7 text-amber-400 mx-auto mb-2" />
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load advisor matches</div>
              <p className="text-[12px] text-gray-500 dark:text-gray-400">Reload the page to try again.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className={`${CARD} text-center py-10`} data-testid="matches-empty">
              <Users className="w-7 h-7 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50 mb-1">
                {filter === 'all' ? 'No advisors available yet' : 'No advisors match this filter'}
              </div>
              <p className="text-[12px] text-gray-500 dark:text-gray-400">
                {filter === 'all'
                  ? 'The advisor network is still growing — check back soon.'
                  : 'Try another specialty filter.'}
              </p>
            </div>
          ) : (
            visible.map((m) => {
              const fit = valuesFitLabel(m.breakdown);
              return (
                <div key={m.uid || m.name} className={CARD} data-testid={`match-row-${m.uid}`}>
                  <div className="flex gap-3">
                    <div className="w-9 h-9 shrink-0 rounded-lg bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 flex items-center justify-center text-[12px] font-extrabold">
                      {initialsOf(m.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">{m.name}</span>
                        {m.headline && <span className="text-[11.5px] text-gray-400 dark:text-gray-500">· {m.headline}</span>}
                        {m.rating != null && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            <Star size={11} className="fill-current" /> {m.rating.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.specialties.slice(0, 4).map((s) => (
                          <span key={s} className="text-[10px] font-semibold capitalize rounded-full px-2 py-0.5 bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">{s}</span>
                        ))}
                        {m.sectors.slice(0, 2).map((s) => (
                          <span key={s} className="text-[10px] font-semibold capitalize rounded-full px-2 py-0.5 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{s}</span>
                        ))}
                      </div>
                      {m.bio && <p className="text-[12px] text-gray-600 dark:text-gray-300 mt-2 line-clamp-2">{m.bio}</p>}
                      {(() => {
                        const contribution = likelyContribution(m.specialties, gaps.map((g) => g.title));
                        return contribution.length > 0 ? (
                          <div className="mt-2" data-testid={`contribution-${m.uid}`}>
                            <div className={`${LBL} mb-0.5`}>Likely contribution</div>
                            <p className="text-[11.5px] text-gray-600 dark:text-gray-300 capitalize">
                              {contribution.join(' · ')}
                            </p>
                            <p className="text-[10.5px] text-gray-400 dark:text-gray-500">
                              Their declared expertise, matched to your weakest dimensions.
                            </p>
                          </div>
                        ) : null;
                      })()}
                      {m.reasons.length > 0 && (
                        <div className="mt-2">
                          <div className={`${LBL} mb-0.5`}>Why this match</div>
                          <ul className="text-[11.5px] text-gray-600 dark:text-gray-300 space-y-0.5">
                            {m.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
                          </ul>
                        </div>
                      )}
                      {(() => {
                        const rows = breakdownRows(m.breakdown);
                        return rows.length > 0 ? (
                          <div className="mt-2.5" data-testid={`breakdown-${m.uid}`}>
                            <div className={`${LBL} mb-1.5`}>Score breakdown</div>
                            <div className="space-y-1.5">
                              {rows.map((r) => (
                                <div key={r.key}>
                                  <div className="flex justify-between text-[11px] mb-0.5">
                                    <span className="text-gray-600 dark:text-gray-300">{r.label}</span>
                                    <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200">
                                      {r.value} <span className="text-gray-400 dark:text-gray-500 font-normal">/ {r.max}</span>
                                    </span>
                                  </div>
                                  <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                                    <div className={`h-full rounded-full ${r.bar}`} style={{ width: `${r.pct}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null;
                      })()}
                      {m.watchOuts.length > 0 && (
                        <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid={`watchout-${m.uid}`}>
                          ⚠ {m.watchOuts[0]}
                        </div>
                      )}
                      {slotsFor === m.uid && (
                        <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3" data-testid={`slots-panel-${m.uid}`}>
                          <div className={`${LBL} mb-2`}>Upcoming office-hour slots</div>
                          {slots === 'loading' ? (
                            <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                          ) : slots?.failed ? (
                            <div className="text-[11.5px] text-amber-600 dark:text-amber-400">Couldn't load slots right now.</div>
                          ) : (slots?.items || []).length === 0 ? (
                            <div className="text-[11.5px] text-gray-500 dark:text-gray-400">
                              No open slots right now — check{' '}
                              <Link to="/advisors" className="text-violet-600 font-semibold hover:underline">the directory</Link> later.
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {(slots.items || []).slice(0, 4).map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  disabled={bookingBusy || (s.remaining != null && s.remaining <= 0)}
                                  onClick={() => bookSlot(s)}
                                  data-testid={`slot-option-${s.id}`}
                                  className="text-[11.5px] font-semibold rounded-lg border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 px-2.5 py-1.5 hover:bg-violet-50 dark:hover:bg-violet-900/30 disabled:opacity-40 inline-flex items-center gap-1"
                                >
                                  <Calendar size={11} /> {fmtDate(s.start_at || s.starts_at)}
                                </button>
                              ))}
                            </div>
                          )}
                          {bookError && <div className="text-[11.5px] text-rose-600 dark:text-rose-400 mt-2" data-testid="book-error">{bookError}</div>}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5 w-[120px]">
                      <div className="text-right">
                        <div className="text-[22px] leading-none font-extrabold text-gray-900 dark:text-gray-50 tabular-nums" data-testid={`match-score-${m.uid}`}>{m.score}</div>
                        <div className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400">Match</div>
                      </div>
                      {fit && (
                        <span className={`text-[10px] font-bold ${fit.startsWith('High') ? 'text-emerald-600 dark:text-emerald-400' : fit.startsWith('Medium') ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'}`} data-testid={`values-fit-${m.uid}`}>
                          {fit}
                        </span>
                      )}
                      <Link
                        to="/advisors"
                        data-testid={`link-view-profile-${m.uid}`}
                        className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1 w-full justify-center"
                      >
                        View profile <ExternalLink size={10} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setIntroFor(m)}
                        data-testid={`button-intro-${m.uid}`}
                        className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 w-full"
                      >
                        Draft intro
                      </button>
                      <button
                        type="button"
                        onClick={() => openSlots(m.uid)}
                        data-testid={`button-book-${m.uid}`}
                        className="text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-2.5 py-1.5 w-full inline-flex items-center justify-center gap-1"
                      >
                        Book intro {slotsFor === m.uid ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {matches?.source === 'directory' && items.length > 0 && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500" data-testid="matches-source-note">
              Ranked by directory relevance — the full team-complement matching engine isn't available in this
              environment.
            </p>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className={CARD} data-testid="card-team-profile">
            <div className={`${LBL} mb-3`}>Your team profile</div>
            <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200 mb-2">Readiness coverage</div>
            {snapshotError ? (
              <div className="text-[11.5px] text-amber-600 dark:text-amber-400">Couldn't load coverage right now.</div>
            ) : coverage.length === 0 ? (
              <div className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="coverage-empty">
                From your Scoring Engine runs —{' '}
                <Link to="/spinout-lab/scoring" className="text-violet-600 font-semibold hover:underline">run one</Link> to populate.
              </div>
            ) : (
              <div className="space-y-1.5 mb-1">
                {coverage.map((d) => (
                  <div key={d.key} className="flex items-center gap-2" data-testid={`coverage-${d.key}`}>
                    <span className="text-[10.5px] text-gray-500 dark:text-gray-400 w-[88px] shrink-0 truncate">{d.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${d.pct >= 70 ? 'bg-emerald-500' : d.pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                        style={{ width: `${Math.max(3, d.pct)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-gray-400 w-7 text-right">{d.pct}%</span>
                  </div>
                ))}
              </div>
            )}

            <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200 mt-4 mb-2">Archetype</div>
            {results?.unavailable ? (
              <div className="text-[11.5px] text-gray-400 dark:text-gray-500" data-testid="archetype-unavailable">Not available in this environment.</div>
            ) : results?.failed ? (
              <div className="text-[11.5px] text-amber-600 dark:text-amber-400" data-testid="archetype-error">Couldn't load right now.</div>
            ) : latestResult ? (
              <span className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" data-testid="archetype-chip">
                {archMeta?.label || latestResult.archetype_label || '—'}
              </span>
            ) : (
              <div className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="archetype-empty">
                No archetype yet — finish the assessment in Studio.
              </div>
            )}

            <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200 mt-4 mb-2">Values profile</div>
            {values?.unavailable ? (
              <div className="text-[11.5px] text-gray-400 dark:text-gray-500" data-testid="values-unavailable">Not available in this environment.</div>
            ) : values?.failed ? (
              <div className="text-[11.5px] text-amber-600 dark:text-amber-400" data-testid="values-error">Couldn't load right now.</div>
            ) : valueRows && valueRows.length > 0 ? (
              <div className="space-y-1">
                {valueRows.map((v) => (
                  <div key={v.slug || v.label} className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-500 dark:text-gray-400 capitalize">{v.label || v.slug}</span>
                    <span className="font-bold text-gray-800 dark:text-gray-100 tabular-nums">{Number(v.score).toFixed(1)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="values-empty">
                No values survey yet — complete it in your profile.
              </div>
            )}
          </div>

          <div className={CARD} data-testid="card-bench">
            <div className={`${LBL} mb-3`}>Advisor bench</div>
            {bookings?.failed ? (
              <div className="text-[11.5px] text-amber-600 dark:text-amber-400" data-testid="bench-error">Couldn't load your sessions right now.</div>
            ) : (bookings?.items || []).length === 0 ? (
              <div className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="bench-empty">
                No advisor sessions yet. Book an intro from a match to build your bench.
              </div>
            ) : (
              <div className="space-y-2.5">
                {(bookings.items || []).slice(0, 5).map((b) => (
                  <div key={b.id || b.uid} className="flex items-start gap-2" data-testid={`bench-row-${b.id}`}>
                    <div className="w-7 h-7 shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex items-center justify-center text-[10px] font-extrabold">
                      {initialsOf(advisorNameById.get(b.advisor_id) || b.advisor_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] font-bold text-gray-900 dark:text-gray-50 truncate">
                        {advisorNameById.get(b.advisor_id) || b.advisor_name || 'Advisor session'}
                      </div>
                      <div className="text-[10.5px] text-gray-400 truncate">{fmtDate(b.scheduled_start)} · {b.topic || '—'}</div>
                    </div>
                    <span className={`text-[9.5px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5 ${STATUS_STYLE[b.status] || STATUS_STYLE.pending}`}>
                      {String(b.status || '').replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Request another match — re-runs the real engine with filters */}
      {refineOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setRefineOpen(false)}
          data-testid="refine-modal"
        >
          <form className={`${CARD} w-full max-w-md`} onClick={(e) => e.stopPropagation()} onSubmit={runRefine}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-extrabold text-gray-900 dark:text-gray-50">Request another match</h3>
              <button type="button" onClick={() => setRefineOpen(false)} data-testid="button-close-refine" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={18} />
              </button>
            </div>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-4">
              Refine the criteria — we regenerate a ranked shortlist from the same engine.
            </p>

            <label className={`${LBL} block mb-1.5`} htmlFor="refine-gap">What gap is still unresolved?</label>
            <select
              id="refine-gap"
              value={refineGap}
              onChange={(e) => setRefineGap(e.target.value)}
              data-testid="select-refine-gap"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-50 mb-3.5"
            >
              <option value="">Any — rank on overall complement</option>
              {Object.entries(SKILL_AXES).map(([slug, label]) => (
                <option key={slug} value={slug}>{label}</option>
              ))}
            </select>

            <span className={`${LBL} block mb-1.5`}>Specialist or generalist?</span>
            <div className="flex gap-1.5 mb-2">
              {[['', 'Either'], ['specialist', 'Specialist'], ['generalist', 'Generalist']].map(([v, label]) => (
                <button
                  key={v || 'either'}
                  type="button"
                  onClick={() => setRefineFocus(v)}
                  aria-pressed={refineFocus === v}
                  data-testid={`chip-focus-${v || 'either'}`}
                  className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-full border ${
                    refineFocus === v
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-4">
              Based on how many areas an advisor's declared expertise spans — one or two reads as a
              specialist, three or more as a generalist. Advisors who haven't listed expertise are
              excluded from both.
            </p>

            {refineError && (
              <p className="text-[12px] text-rose-600 dark:text-rose-400 mb-3" data-testid="refine-error">{refineError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRefineOpen(false)}
                className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-[13px] font-semibold text-gray-600 dark:text-gray-300">
                Cancel
              </button>
              <button type="submit" disabled={refining} data-testid="button-generate-shortlist"
                className="h-9 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-[13px] font-bold inline-flex items-center gap-1.5">
                {refining && <Loader2 size={14} className="animate-spin" />}
                Generate new shortlist →
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Intro draft modal */}
      {introFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setIntroFor(null)}>
          <div className={`${CARD} w-full max-w-lg`} onClick={(e) => e.stopPropagation()} data-testid="intro-modal">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">Intro draft · {introFor.name}</div>
              <button type="button" onClick={() => setIntroFor(null)} data-testid="button-close-intro" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={16} />
              </button>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
              Assembled from this advisor's real profile and match signals — edit before sending.
            </p>
            <pre className="whitespace-pre-wrap text-[12px] text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 rounded-xl p-3 mb-3 font-sans" data-testid="intro-body">
              {buildIntroDraft(introFor, project?.name)}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={copyIntro}
                data-testid="button-copy-intro"
                className="text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 inline-flex items-center gap-1.5"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy to clipboard'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
