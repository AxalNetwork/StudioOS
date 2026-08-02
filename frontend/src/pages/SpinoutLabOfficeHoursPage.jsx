// Spin-Out Lab — Office Hours (Week 3 tool page).
//
// Design handoff: spin-out-lab-pipeline/project/Office Hours.dc.html (same
// file uploaded to attached_assets). The design's fabricated content
// (invented partner personas, ratings, "Partner prep sent", fake session
// summaries) is intentionally NOT reproduced. Mapping to REAL surfaces only:
//   - Partner directory: GET /partners (real partner network — role tags
//     derived from each partner's marketplace categories/specialization).
//   - Booking: real partner office-hour slots
//     (GET /partner-office-hours/partners/:uid/slots +
//      POST /partner-office-hours/slots/:id/book) via the design's booking
//     drawer (objective pills → topic, desired outcome → questions).
//   - Upcoming sessions + history: the founder's real partner bookings
//     (GET /partner-office-hours/bookings/me) — countdown, Join via the
//     slot's meeting link, searchable archive of completed sessions.
//   - Recommended help now: derived from the user's real Week-3 context —
//     pending lab milestones (e.g. incorporation) + weakest dimensions from
//     the latest Scoring Engine snapshot (shared buildGaps).
//   - Pre-session brief: client-assembled from real project + lab state +
//     scoring data, clearly labelled auto-generated; it can be attached to
//     a booking (goes into the booking's real `questions` field) or copied.
//   - Action items · execution handoff: the current week's real milestone
//     checklist (read-only — items complete by doing the work in the linked
//     tool, not by ticking a box here).
//   - Omitted (no backend): partner ratings, "Resend to partner",
//     share/export/preview-as-investor, rescheduling.

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Lock, Calendar, CalendarCheck, Copy, Check, X,
  AlertTriangle, ExternalLink, Search, ChevronRight,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { reportError } from '../lib/log';
import { useToast } from '../components/useToast';
import { pickLabProject } from './SpinoutLabStartupPage';
import { initialsOf, buildGaps } from './SpinoutLabAdvisorsPage';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700';
const LBL = 'text-[10.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const BTN = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors';

// Role tag derived from the partner's real marketplace categories /
// specialization — the design's LAWYER / OPERATOR / INVESTOR chips.
export function roleOfPartner(p) {
  let cats = [];
  try { cats = JSON.parse(p?.categories_json || '[]'); } catch { cats = []; }
  const hay = `${cats.join(' ')} ${p?.specialization || ''} ${p?.headline || ''}`.toLowerCase();
  if (/legal|lawyer|counsel|attorney/.test(hay)) return 'Lawyer';
  if (/invest|capital|vc|fund/.test(hay)) return 'Investor';
  if (/account|cfo|finance|tax/.test(hay)) return 'Finance';
  if (/gtm|growth|marketing|sales|recruit|design|ops|operat|product|hiring/.test(hay)) return 'Operator';
  return 'Partner';
}

const ROLE_STYLE = {
  Lawyer: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  Operator: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  Investor: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  Finance: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  Partner: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

function RoleTag({ role }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${ROLE_STYLE[role] || ROLE_STYLE.Partner}`}>
      {role}
    </span>
  );
}

const OBJECTIVES = ['Fundraising', 'Incorporation', 'GTM & pricing', 'Hiring & org', 'Product', 'Other'];

const fmtWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const fmtDay = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
// The dev FastAPI and the production Worker expose different wire shapes for
// slots and bookings (start_at vs starts_at, questions vs notes, remaining vs
// available, requested vs pending, meeting_uri vs meeting_url). Normalize both
// into one client shape so the page renders identically in every environment.
export function normSlot(s) {
  const start = s.start_at ?? s.starts_at ?? null;
  let duration = s.duration_min;
  if (!Number.isFinite(duration) && start && s.ends_at) {
    const ms = new Date(s.ends_at) - new Date(start);
    if (Number.isFinite(ms) && ms > 0) duration = Math.round(ms / 60000);
  }
  return {
    ...s,
    start_at: start,
    duration_min: Number.isFinite(duration) ? duration : null,
    remaining: Number.isFinite(s.remaining) ? s.remaining
      : Number.isFinite(s.available) ? s.available : 0,
    open: s.status !== undefined ? s.status === 'open' : !s.is_cancelled,
  };
}
export function normBooking(b) {
  return {
    ...b,
    status: b.status === 'pending' ? 'requested' : b.status,
    questions: b.questions ?? b.notes ?? null,
    scheduled_start: b.scheduled_start ?? b.starts_at ?? null,
    meeting_uri: b.meeting_uri ?? b.meeting_url ?? null,
  };
}

const countdown = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
};

// Milestone → the lab tool where it actually gets done (design's "→ links").
const MILESTONE_TOOLS = {
  problem_defined: { label: 'Startup Profile', to: '/spinout-lab/startup' },
  icp_defined: { label: 'Customer Discovery', to: '/spinout-lab/discovery' },
  interviews_logged: { label: 'Customer Discovery', to: '/spinout-lab/discovery' },
  market_sizing_done: { label: 'Market Sizing', to: '/spinout-lab/market' },
  okrs_created: { label: 'Roadmap', to: '/spinout-lab/roadmap' },
  brand_basics_filled: { label: 'Brand & Landing', to: '/spinout-lab/brand' },
  pitch_deck_drafted: { label: 'Pitch Deck', to: '/spinout-lab/pitch-deck' },
  scoring_run_completed: { label: 'Scoring Engine', to: '/spinout-lab/scoring' },
  advisor_meeting_booked: { label: 'Advisors', to: '/spinout-lab/advisors' },
  cofounder_request_sent: { label: 'Co-founder Agreement', to: '/spinout-lab/cofounder-agreement' },
  incorporation_completed: { label: 'Incorporate', to: '/incorporate' },
};
const MILESTONE_LABELS = {
  problem_defined: 'Define the problem statement',
  icp_defined: 'Define your ICP',
  interviews_logged: 'Log customer interviews',
  market_sizing_done: 'Complete market sizing',
  okrs_created: 'Create your OKRs',
  brand_basics_filled: 'Fill in brand basics',
  pitch_deck_drafted: 'Draft your pitch deck',
  scoring_run_completed: 'Run the Scoring Engine',
  advisor_meeting_booked: 'Book an advisor meeting',
  cofounder_request_sent: 'Send a co-founder request',
  incorporation_completed: 'Complete incorporation',
};

export default function SpinoutLabOfficeHoursPage() {
  const { toast, showToast } = useToast(3500);

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [state, setState] = useState(null);
  const [project, setProject] = useState(null);
  const [partners, setPartners] = useState(null); // [] | {failed}
  const [bookings, setBookings] = useState(null); // {items} | {failed}
  const [snapshot, setSnapshot] = useState(null);

  const [filter, setFilter] = useState('recommended');
  const [historyQ, setHistoryQ] = useState('');
  const [copiedBrief, setCopiedBrief] = useState(false);

  // Booking drawer state.
  const [drawerFor, setDrawerFor] = useState(null); // partner dto
  const [slots, setSlots] = useState(null); // 'loading' | {items} | {failed}
  const [slotId, setSlotId] = useState(null);
  const [objective, setObjective] = useState('');
  const [outcome, setOutcome] = useState('');
  const [attachBrief, setAttachBrief] = useState(true);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookError, setBookError] = useState('');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects, dir, mine] = await Promise.all([
          spinoutLab.state(),
          api.getMe(),
          api.listProjects().catch(() => []),
          api.listPartners().catch(() => ({ failed: true })),
          api.listMyPartnerRequests().catch(() => ({ failed: true })),
        ]);
        if (dead) return;
        setState(st);
        setPartners(Array.isArray(dir) ? dir : { failed: true });
        setBookings(mine?.failed ? { failed: true } : { items: (Array.isArray(mine?.items) ? mine.items : []).map(normBooking) });
        const proj = pickLabProject(projects, me);
        setProject(proj || null);
        if (proj) {
          const scores = await api.getScores(proj.id, { includeSandbox: true }).catch(() => null);
          if (!dead && Array.isArray(scores)) setSnapshot(scores[0] || null);
        }
        setStatus('ready');
      } catch (e) {
        reportError('spinout-office-hours', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const refreshBookings = async () => {
    const mine = await api.listMyPartnerRequests().catch(() => null);
    if (mine && Array.isArray(mine.items)) setBookings({ items: mine.items.map(normBooking) });
  };

  const unlocked = (state?.unlocked_features || []).includes('office-hours');
  const partnerById = useMemo(() => {
    const m = new Map();
    for (const p of Array.isArray(partners) ? partners : []) m.set(p.id, p);
    return m;
  }, [partners]);

  const allBookings = bookings?.items || [];
  const now = Date.now();
  // Bookings without a start time (Worker DTO omits it) stay "upcoming" while
  // active — never silently dropped.
  const startMs = (b) => {
    const t = new Date(b.scheduled_start || '').getTime();
    return Number.isFinite(t) ? t : null;
  };
  const upcoming = useMemo(() => allBookings
    .filter((b) => ['requested', 'confirmed'].includes(b.status) && (startMs(b) === null || startMs(b) > now))
    .sort((a, b) => (startMs(a) ?? Infinity) - (startMs(b) ?? Infinity)), [allBookings, now]);
  const past = useMemo(() => allBookings
    .filter((b) => b.status === 'completed' || (b.status !== 'cancelled' && startMs(b) !== null && startMs(b) <= now))
    .sort((a, b) => (startMs(b) ?? 0) - (startMs(a) ?? 0)), [allBookings, now]);
  const completedCount = allBookings.filter((b) => b.status === 'completed').length;
  const awaitingConfirm = allBookings.filter((b) => b.status === 'requested').length;

  // ---- Recommended help now (real blockers + real scoring gaps) ----
  const milestoneDone = (key) => (state?.milestones || []).some((m) => (m.key || m.milestone_key) === key);
  const gaps = useMemo(() => buildGaps(snapshot), [snapshot]);
  const helpCards = useMemo(() => {
    const cards = [];
    const week = Number(state?.week || 1);
    if (week >= 3 && !milestoneDone('incorporation_completed')) {
      cards.push({
        id: 'incorporation', role: 'Lawyer', urgency: week >= 4 ? 'Urgent' : 'This week',
        title: 'Incorporation & 83(b) timing',
        body: `You have an open incorporation blocker${week >= 4 ? ' and Week 4 has started' : ' and Week 4 starts soon'}. Get entity formation and 83(b) timing right before signing anything.`,
      });
    }
    for (const g of gaps.slice(0, 2)) {
      const role = /legal/i.test(g.title) ? 'Lawyer' : /market|traction|fundrais/i.test(g.title) ? 'Investor' : 'Operator';
      cards.push({
        id: g.key, role, urgency: 'Soon',
        title: `${g.title} — scoring weak point`,
        body: `${g.detail}. A ${role.toLowerCase()} session can turn this gap into a concrete plan.`,
      });
    }
    return cards.slice(0, 3);
  }, [state, gaps]);

  // ---- Partner directory + filters ----
  const dirItems = useMemo(() => (Array.isArray(partners) ? partners : [])
    .filter((p) => p.status !== 'inactive')
    .map((p) => ({ ...p, role: roleOfPartner(p) })), [partners]);
  const rolesPresent = useMemo(
    () => [...new Set(dirItems.map((p) => p.role))].sort(),
    [dirItems],
  );
  const recommendedRoles = useMemo(() => new Set(helpCards.map((c) => c.role)), [helpCards]);
  const visiblePartners = filter === 'all' ? dirItems
    : filter === 'recommended'
      ? [...dirItems].sort((a, b) => (recommendedRoles.has(b.role) ? 1 : 0) - (recommendedRoles.has(a.role) ? 1 : 0))
      : dirItems.filter((p) => p.role === filter);

  // ---- Pre-session brief (client-assembled from real data, labelled) ----
  const brief = useMemo(() => {
    if (!project) return null;
    const week = Number(state?.week || 1);
    const sections = [
      { h: 'Company', v: `${project.name || 'Untitled'}${project.description ? ` — ${project.description}` : ''}` },
      { h: 'Sector · Week', v: `${project.sector || 'Unspecified sector'} · Week ${week}` },
      project.problem ? { h: 'Thesis', v: project.problem } : null,
      {
        h: 'Active blockers',
        v: ['scoring_run_completed', 'advisor_meeting_booked', 'incorporation_completed']
          .filter((k) => !milestoneDone(k))
          .map((k) => MILESTONE_LABELS[k]).join('; ') || 'None — all tracked milestones complete.',
      },
      snapshot ? {
        h: 'Scoring',
        v: `Latest readiness snapshot on file${gaps.length ? ` — weakest: ${gaps.map((g) => g.title).join(', ')}` : ''}`,
      } : null,
      gaps.length ? {
        h: 'Questions for partner',
        v: gaps.map((g) => `› How do we close the ${g.title.toLowerCase()} gap (${g.detail})?`).join('\n'),
      } : null,
    ].filter(Boolean);
    return sections;
  }, [project, state, snapshot, gaps]);

  const briefText = useMemo(
    () => (brief ? brief.map((s) => `${s.h.toUpperCase()}\n${s.v}`).join('\n\n') : ''),
    [brief],
  );

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(briefText);
      setCopiedBrief(true); setTimeout(() => setCopiedBrief(false), 1800);
    } catch { showToast('Could not copy — clipboard unavailable.', 'error'); }
  };

  // ---- Action items: this week's real milestone checklist (read-only) ----
  const actionItems = useMemo(() => {
    const week = Number(state?.week || 1);
    const WEEK_KEYS = {
      1: ['problem_defined', 'icp_defined', 'interviews_logged', 'market_sizing_done'],
      2: ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'],
      3: ['scoring_run_completed', 'advisor_meeting_booked', 'cofounder_request_sent'],
      4: ['incorporation_completed'],
    };
    return (WEEK_KEYS[week] || []).map((k) => ({
      key: k, label: MILESTONE_LABELS[k] || k, done: milestoneDone(k), tool: MILESTONE_TOOLS[k],
    }));
  }, [state]);

  // ---- Booking drawer ----
  const drawerSeq = React.useRef(0);
  const openDrawer = async (partner) => {
    const seq = ++drawerSeq.current; // guard: A's late response must not fill B's drawer
    setDrawerFor(partner); setSlots('loading'); setSlotId(null);
    setObjective(''); setOutcome(''); setAttachBrief(true); setBookError('');
    try {
      const res = await api.listPartnerSlots(partner.uid, true);
      if (seq !== drawerSeq.current) return;
      const items = (Array.isArray(res?.items) ? res.items : []).map(normSlot).filter((s) => s.open && s.remaining > 0);
      setSlots({ items });
      if (items.length === 1) setSlotId(items[0].id);
    } catch (e) {
      reportError('spinout-office-hours:slots', e);
      if (seq === drawerSeq.current) setSlots({ failed: true });
    }
  };

  const onBook = async () => {
    if (!slotId || !objective || bookingBusy) return;
    setBookingBusy(true); setBookError('');
    try {
      // Backend caps questions at 2000 chars — truncate rather than 422.
      const composed = [
        outcome ? `Desired outcome: ${outcome}` : null,
        attachBrief && briefText ? `— Pre-session brief —\n${briefText}` : null,
      ].filter(Boolean).join('\n\n');
      const questions = composed ? composed.slice(0, 2000) : null;
      await api.bookPartnerSlot(slotId, {
        topic: objective,
        questions,           // dev FastAPI field
        notes: questions,    // production Worker reads `notes` (extra field is ignored by FastAPI)
        project_id: project?.id ?? null,
      });
      setDrawerFor(null);
      showToast('Session requested — the partner will confirm and your brief travels with the booking.');
      // W3 deliverable — a real partner session was requested.
      markMilestone(user, 'office_hours_booked');
      await refreshBookings();
    } catch (e) {
      reportError('spinout-office-hours:book', e);
      setBookError(e?.data?.message || e?.message || 'Booking failed.');
    } finally { setBookingBusy(false); }
  };

  const bookTopMatch = (role) => {
    const target = dirItems.find((p) => p.role === role) || dirItems[0];
    if (target) openDrawer(target);
    else showToast('No partners available for this yet.', 'error');
  };

  const filteredHistory = past.filter((b) => {
    if (!historyQ.trim()) return true;
    const p = partnerById.get(b.partner_id);
    const hay = `${b.topic || ''} ${b.questions || ''} ${p?.name || ''} ${p?.specialization || ''}`.toLowerCase();
    return hay.includes(historyQ.trim().toLowerCase());
  });

  // ------------------------------------------------------------------
  if (status === 'loading') {
    return (
      <div className="min-h-[60vh] grid place-items-center" data-testid="spinout-office-hours-loading">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="max-w-3xl mx-auto p-8" data-testid="spinout-office-hours-error">
        <div className={`${CARD} p-6 flex items-start gap-3`}>
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
          <div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">Couldn't load Office Hours</div>
            <div className="text-sm text-gray-500 mt-1">Refresh to try again. If it persists, the Lab API may be unavailable.</div>
          </div>
        </div>
      </div>
    );
  }

  const bookingChip = (b) => (b.questions
    ? { text: 'Brief attached', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' }
    : { text: 'Questions missing', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' });

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6" data-testid="spinout-office-hours-page">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-1.5">
        <Link to="/spinout-lab" className={`${BTN} border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800`} data-testid="link-back-workspace">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Workspace
        </Link>
        <h1 className="text-lg font-extrabold text-gray-900 dark:text-gray-100">Office Hours</h1>
        {unlocked ? (
          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">Active</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Unlocks in Week 3</span>
        )}
        <button
          type="button"
          className={`${BTN} ml-auto border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800`}
          onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); showToast('Link copied.'); } catch { showToast('Could not copy link.', 'error'); } }}
          data-testid="button-copy-link"
        >
          <Copy className="w-3.5 h-3.5" /> Copy link
        </button>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mb-5">
        Live sessions with partners — investors, lawyers, and operators — turned into tracked execution.
      </p>

      {!unlocked && (
        <div className={`${CARD} p-4 mb-5 flex items-center gap-3`} data-testid="banner-locked">
          <Lock className="w-4 h-4 text-gray-400" />
          <div className="text-[12.5px] text-gray-600 dark:text-gray-300">
            Office Hours is a Week 3 tool. You can browse the partner network now; booking unlocks with Week 3.
          </div>
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6" data-testid="stat-tiles">
        {[
          { v: upcoming.length, l: 'Upcoming sessions', tid: 'stat-upcoming' },
          { v: completedCount, l: 'Sessions completed', tid: 'stat-completed' },
          { v: awaitingConfirm, l: 'Awaiting confirmation', tid: 'stat-awaiting' },
          { v: dirItems.length, l: 'Partners available', tid: 'stat-partners' },
        ].map((s) => (
          <div key={s.tid} className={`${CARD} px-4 py-3`} data-testid={s.tid}>
            <div className="text-2xl font-extrabold font-mono text-gray-900 dark:text-gray-100">{s.v}</div>
            <div className="text-[11.5px] text-gray-500 dark:text-gray-400">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Recommended help now */}
      {helpCards.length > 0 && (
        <div className={`${CARD} p-5 mb-6`} data-testid="recommended-help">
          <div className="flex items-center justify-between mb-3">
            <div className={LBL}>Recommended help now</div>
            <div className="text-[11px] text-gray-400">From your week {Number(state?.week || 1)} context, scoring gaps, and open blockers</div>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {helpCards.map((c) => (
              <div key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3.5 flex flex-col" data-testid={`help-card-${c.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <RoleTag role={c.role} />
                  <span className={`text-[10.5px] font-bold ${c.urgency === 'Urgent' ? 'text-red-600' : c.urgency === 'This week' ? 'text-amber-600' : 'text-sky-600'}`}>{c.urgency}</span>
                </div>
                <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100 mb-1">{c.title}</div>
                <div className="text-[12px] text-gray-500 dark:text-gray-400 flex-1">{c.body}</div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className={`${BTN} bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50`}
                    disabled={!unlocked}
                    onClick={() => bookTopMatch(c.role)}
                    data-testid={`button-book-help-${c.id}`}
                  >
                    Book now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming sessions */}
      <div className={`${CARD} p-5 mb-6`} data-testid="upcoming-sessions">
        <div className={`${LBL} mb-3`}>Upcoming sessions</div>
        {bookings?.failed ? (
          <div className="text-[12.5px] text-gray-500">Couldn't load your sessions.</div>
        ) : upcoming.length === 0 ? (
          <div className="text-[12.5px] text-gray-500 dark:text-gray-400">No sessions booked yet — pick a partner below to book your first one.</div>
        ) : upcoming.map((b) => {
          const p = partnerById.get(b.partner_id);
          const chip = bookingChip(b);
          return (
            <div key={b.id} className="flex items-center gap-3 py-2.5 border-b last:border-0 border-gray-100 dark:border-gray-800" data-testid={`upcoming-${b.id}`}>
              <div className="w-9 h-9 rounded-full bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 grid place-items-center text-[12px] font-bold shrink-0">
                {initialsOf(p?.name || '?')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{p?.name || 'Partner'}</span>
                  <RoleTag role={p ? roleOfPartner(p) : 'Partner'} />
                  <span className="text-[12px] text-gray-500 truncate">{b.topic}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11.5px] text-gray-500">
                  <span className={`px-1.5 py-0.5 rounded font-semibold ${chip.cls}`}>{chip.text}</span>
                  <span>{fmtWhen(b.scheduled_start)}</span>
                  <span>· {b.status === 'requested' ? 'awaiting partner confirmation' : 'confirmed'}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] text-gray-400 mb-1">{b.scheduled_start ? countdown(b.scheduled_start) : '—'}</div>
                {b.meeting_uri ? (
                  <a href={b.meeting_uri} target="_blank" rel="noopener noreferrer" className={`${BTN} bg-teal-600 hover:bg-teal-700 text-white`} data-testid={`button-join-${b.id}`}>
                    Join <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-[11px] text-gray-400">link at confirm</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Directory + brief rail */}
      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start mb-6">
        <div className={`${CARD} p-5`} data-testid="partner-directory">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <div className={LBL}>Partner directory · Book a session</div>
            <div className="flex gap-1.5 flex-wrap" data-testid="directory-filters">
              {['recommended', ...rolesPresent, 'all'].map((f) => (
                <button
                  key={f} type="button" onClick={() => setFilter(f)}
                  className={`px-2.5 h-7 rounded-full text-[11.5px] font-semibold border ${filter === f ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}
                  data-testid={`filter-${f.toLowerCase()}`}
                >
                  {f === 'recommended' ? 'Recommended' : f === 'all' ? 'All' : `${f}s`}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[11.5px] text-gray-400 mb-3">Matched to your week {Number(state?.week || 1)} context, scoring gaps, and open blockers.</div>
          {partners?.failed ? (
            <div className="text-[12.5px] text-gray-500">Couldn't load the partner network.</div>
          ) : dirItems.length === 0 ? (
            <div className="text-[12.5px] text-gray-500 dark:text-gray-400">No partners in the network yet.</div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3" data-testid="partner-grid">
              {visiblePartners.map((p) => {
                const recommended = recommendedRoles.has(p.role);
                let tags = [];
                try { tags = JSON.parse(p.categories_json || '[]'); } catch { tags = []; }
                return (
                  <div key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3.5 flex flex-col" data-testid={`partner-card-${p.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{p.name}</div>
                        <div className="text-[11.5px] text-gray-500">{p.headline || p.specialization || p.company || '—'}</div>
                      </div>
                      <RoleTag role={p.role} />
                    </div>
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {tags.slice(0, 4).map((t) => (
                          <span key={t} className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10.5px] font-semibold text-gray-600 dark:text-gray-300">{String(t).replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    )}
                    {p.bio && <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">{p.bio}</div>}
                    {recommended && (
                      <div className="text-[11.5px] text-emerald-700 dark:text-emerald-400 font-semibold mt-2">
                        ✓ Recommended — matches an open gap or blocker this week.
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[11px] text-gray-400">{p.capacity_status === 'available' ? 'Available' : p.capacity_status === 'limited' ? 'Limited availability' : 'Unavailable'}</span>
                      <button
                        type="button"
                        className={`${BTN} border border-teal-600 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/30 disabled:opacity-50`}
                        disabled={!unlocked || p.capacity_status === 'unavailable'}
                        onClick={() => openDrawer(p)}
                        data-testid={`button-book-${p.id}`}
                      >
                        Book <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pre-session brief rail */}
        <div className="space-y-4">
          <div className={`${CARD} p-5`} data-testid="brief-panel">
            <div className="flex items-center justify-between mb-1">
              <div className={LBL}>Pre-session brief</div>
              <button type="button" onClick={copyBrief} className="text-[11.5px] font-semibold text-teal-700 dark:text-teal-300 inline-flex items-center gap-1" data-testid="button-copy-brief">
                {copiedBrief ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copiedBrief ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="text-[11px] text-gray-400 mb-3">Auto-generated from your startup data — attach it when you book and it travels with the request.</div>
            {!brief ? (
              <div className="text-[12.5px] text-gray-500">Set up your startup profile to generate a brief.</div>
            ) : brief.map((s) => (
              <div key={s.h} className="mb-3 last:mb-0">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">{s.h}</div>
                <div className="text-[12px] text-gray-700 dark:text-gray-300 whitespace-pre-line">{s.v}</div>
              </div>
            ))}
          </div>

          <div className={`${CARD} p-5`} data-testid="action-items">
            <div className={`${LBL} mb-1`}>Action items · Execution handoff</div>
            <div className="text-[11px] text-gray-400 mb-3">This week's milestone checklist — items complete when you do the work in the linked tool.</div>
            {actionItems.map((it) => (
              <div key={it.key} className="flex items-start gap-2 py-1.5" data-testid={`action-${it.key}`}>
                <span className={`mt-0.5 w-4 h-4 rounded grid place-items-center border ${it.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                  {it.done && <Check className="w-3 h-3" />}
                </span>
                <div className="min-w-0">
                  <div className={`text-[12.5px] ${it.done ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>{it.label}</div>
                  {it.tool && (
                    <Link to={it.tool.to} className="text-[11.5px] font-semibold text-teal-700 dark:text-teal-300">→ {it.tool.label}</Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={`${CARD} p-5`} data-testid="feeds-into">
            <div className={`${LBL} mb-2`}>Feeds into</div>
            {[
              { dot: 'bg-sky-500', label: 'Advisors', desc: 'operator matches & value-add', to: '/spinout-lab/advisors' },
              { dot: 'bg-amber-500', label: 'Capital', desc: 'investor intros & narrative', to: '/spinout-lab/capital' },
              { dot: 'bg-emerald-500', label: 'Incorporate', desc: 'legal formation plan', to: '/incorporate' },
            ].map((r) => (
              <Link key={r.label} to={r.to} className="flex items-center gap-2 py-1.5 group" data-testid={`feeds-${r.label.toLowerCase()}`}>
                <span className={`w-2 h-2 rounded-full ${r.dot}`} />
                <span className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200 group-hover:underline">{r.label}</span>
                <span className="text-[11.5px] text-gray-400">· {r.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Session history */}
      <div className={`${CARD} p-5 mb-8`} data-testid="session-history">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className={LBL}>Session history · Advice archive</div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={historyQ}
              onChange={(e) => setHistoryQ(e.target.value)}
              placeholder="Search sessions…"
              className="h-8 pl-8 pr-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              data-testid="input-history-search"
            />
          </div>
        </div>
        {filteredHistory.length === 0 ? (
          <div className="text-[12.5px] text-gray-500 dark:text-gray-400">
            {past.length === 0 ? 'No past sessions yet — your completed sessions and their notes will archive here.' : 'No sessions match your search.'}
          </div>
        ) : filteredHistory.map((b) => {
          const p = partnerById.get(b.partner_id);
          return (
            <div key={b.id} className="py-3 border-b last:border-0 border-gray-100 dark:border-gray-800" data-testid={`history-${b.id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{p?.name || 'Partner'}</span>
                <RoleTag role={p ? roleOfPartner(p) : 'Partner'} />
                <span className="ml-auto text-[11.5px] text-gray-400">{fmtDay(b.scheduled_start)}</span>
              </div>
              <div className="text-[12.5px] text-gray-700 dark:text-gray-300 mt-0.5 font-semibold">{b.topic}</div>
              {b.questions && <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 whitespace-pre-line">{b.questions}</div>}
              <div className="text-[11px] text-gray-400 mt-1">{b.status === 'completed' ? 'Completed' : 'Held'}</div>
            </div>
          );
        })}
      </div>

      {/* Booking drawer */}
      {drawerFor && (
        <div className="fixed inset-0 z-50 flex justify-end" data-testid="booking-drawer">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setDrawerFor(null)} />
          <div className="relative w-full max-w-[480px] h-full bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-100">{drawerFor.name}</div>
                <div className="text-[12px] text-gray-500">{drawerFor.headline || drawerFor.specialization || drawerFor.company || ''}</div>
                <div className="mt-1"><RoleTag role={roleOfPartner(drawerFor)} /></div>
              </div>
              <button type="button" onClick={() => setDrawerFor(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" data-testid="button-close-drawer">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            {drawerFor.bio && <p className="text-[12.5px] text-gray-600 dark:text-gray-300 mb-4">{drawerFor.bio}</p>}

            <div className={`${LBL} mb-1.5`}>Objective</div>
            <div className="flex flex-wrap gap-1.5 mb-4" data-testid="objective-pills">
              {OBJECTIVES.map((o) => (
                <button
                  key={o} type="button" onClick={() => setObjective(o)}
                  className={`px-2.5 h-7 rounded-full text-[11.5px] font-semibold border ${objective === o ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
                  data-testid={`objective-${o.replace(/[^a-z]/gi, '-').toLowerCase()}`}
                >
                  {o}
                </button>
              ))}
            </div>

            <div className={`${LBL} mb-1.5`}>Desired outcome</div>
            <input
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="e.g. A pricing model + 30-day GTM plan"
              className="w-full h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 mb-4"
              data-testid="input-outcome"
            />

            <div className={`${LBL} mb-1.5`}>Open slots</div>
            {slots === 'loading' ? (
              <div className="py-4"><Loader2 className="w-4 h-4 animate-spin text-teal-600" /></div>
            ) : slots?.failed ? (
              <div className="text-[12.5px] text-gray-500 mb-4">Couldn't load this partner's availability.</div>
            ) : (slots?.items || []).length === 0 ? (
              <div className="text-[12.5px] text-gray-500 mb-4" data-testid="no-slots">
                No open slots published yet — check back, or pick another partner.
              </div>
            ) : (
              <div className="space-y-1.5 mb-4" data-testid="slot-list">
                {slots.items.map((s) => (
                  <button
                    key={s.id} type="button" onClick={() => setSlotId(s.id)}
                    className={`w-full flex items-center justify-between px-3 h-10 rounded-lg border text-left ${slotId === s.id ? 'border-teal-600 ring-2 ring-teal-500/30' : 'border-gray-200 dark:border-gray-700'}`}
                    data-testid={`slot-${s.id}`}
                  >
                    <span className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200 inline-flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-teal-600" /> {fmtWhen(s.start_at)}
                    </span>
                    <span className="text-[11.5px] text-gray-400">{s.duration_min} min{s.title ? ` · ${s.title}` : ''}</span>
                  </button>
                ))}
              </div>
            )}

            <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
              <input type="checkbox" checked={attachBrief} onChange={(e) => setAttachBrief(e.target.checked)} className="accent-teal-600" data-testid="checkbox-attach-brief" />
              <span className="text-[12.5px] text-gray-700 dark:text-gray-300">Attach my pre-session brief to the request</span>
            </label>

            {(!objective || !slotId) && (slots?.items || []).length > 0 && (
              <div className="text-[11.5px] text-amber-700 dark:text-amber-400 mb-3" data-testid="readiness-hint">
                Pick an objective and a slot — sessions with a clear goal get confirmed faster.
              </div>
            )}
            {bookError && <div className="text-[12px] text-red-600 mb-3" data-testid="book-error">{bookError}</div>}

            <button
              type="button"
              onClick={onBook}
              disabled={!objective || !slotId || bookingBusy}
              className={`${BTN} w-full justify-center h-10 bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50`}
              data-testid="button-confirm-booking"
            >
              {bookingBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />} Request session
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold ${toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'}`} data-testid="toast">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
