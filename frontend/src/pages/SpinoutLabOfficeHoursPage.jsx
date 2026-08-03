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
//     scoring data, clearly labelled auto-generated; it can be edited in
//     place (local overrides — "Reset to generated" restores), attached to
//     a booking (goes into the booking's real `questions` field) or copied.
//   - Action items · execution handoff: the current week's real milestone
//     checklist (read-only — items complete by doing the work in the linked
//     tool, not by ticking a box here).
//   - Partner booking guidance ("When to book X", "Best for stage", "One
//     session gets you", "Bring to the session"): REAL partner-authored
//     content only. It lives in the `oh_*` columns on `partners` (D1
//     migration 160_partner_office_hours_guidance.sql), is written by the
//     partner themselves at /partner/office-hours, and rides along on
//     GET /partners. When a partner has not published it, the drawer says
//     so plainly — this page NEVER synthesises guidance prose, defaults or
//     role-derived guesses about a real named person, and none of the
//     design's invented persona copy is reproduced.
//   - Omitted (no backend): partner ratings, "Resend to partner",
//     rescheduling. Share / Export / Preview-as-investor render as disabled
//     quick actions with the reason in their tooltip.

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Lock, Calendar, CalendarCheck, Copy, Check, X,
  AlertTriangle, ExternalLink, Search, ChevronRight, Share2, Download, Eye,
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
// Borderless quick-action chrome (design L41-44) — text colour set per button.
const QA = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent';

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

// Design's fixed directory taxonomy (Office Hours.dc.html L283-285). Real
// roles map into it — Finance and generic Partner behave as service partners
// under "Operators"; the RoleTag chip still shows the true role.
export const FILTERS = [
  ['recommended', 'Recommended'],
  ['Investor', 'Investors'],
  ['Lawyer', 'Lawyers'],
  ['Operator', 'Operators'],
  ['all', 'All'],
];
const filterRoleOf = (role) => (role === 'Lawyer' || role === 'Investor' ? role : 'Operator');
// Per-filter directory note (design L286). The recommended note is dynamic
// (needs the current week) and built at render; the Operators wording is
// widened because the app folds finance partners into that bucket.
const DIR_NOTE = {
  Investor: 'Pre-seed and seed investors — book before and during your raise.',
  Lawyer: 'Formation and financing counsel — book before you sign.',
  Operator: 'Service partners for tactical execution — GTM, hiring, ops, product, and finance.',
  all: 'Every partner in the Axal network.',
};

// Rec-card tint per partner type (design recBg / recBorder L266-267).
const REC_TINT = {
  Lawyer: 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20',
  Operator: 'border-teal-200 bg-teal-50/60 dark:border-teal-900/60 dark:bg-teal-950/20',
  Investor: 'border-sky-200 bg-sky-50/60 dark:border-sky-900/60 dark:bg-sky-950/20',
};

// Deterministic avatar-tile colour per partner (design assigns one per persona).
const AVATAR_BGS = ['bg-teal-600', 'bg-sky-600', 'bg-amber-500', 'bg-violet-600', 'bg-emerald-600', 'bg-rose-500'];
const avatarBgOf = (name) => {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_BGS[h % AVATAR_BGS.length];
};

// Design objective list (L328) + the page's Product / Other additions.
const OBJECTIVES = ['Fundraising', 'Incorporation', 'Customer validation', 'GTM & pricing', 'Hiring & org', 'Deck feedback', 'Product', 'Other'];

// `new Date(null)` is epoch 0, not Invalid Date — without the falsy guard a
// booking with no scheduled time renders as "Thu, Jan 1" (1970). Guard first.
const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const fmtDay = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Partner-authored office-hours guidance (D1 migration 160). NULL/blank means
// the partner has not published that field — the drawer says so plainly. This
// page NEVER synthesises guidance prose about a real named partner: there are
// deliberately no defaults, no placeholders and no role-derived guesses here.
export function normGuidance(p) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  let bring = [];
  try {
    const raw = JSON.parse(p?.oh_bring_json || '[]');
    if (Array.isArray(raw)) bring = raw.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 5);
  } catch { bring = []; }
  const g = {
    whenToBook: s(p?.oh_when_to_book, 600),
    stageFit: s(p?.oh_stage_fit, 60),
    outcome: s(p?.oh_session_outcome, 120),
    bring,
  };
  g.any = !!(g.whenToBook || g.stageFit || g.outcome || g.bring.length);
  return g;
}
export const firstNameOf = (name) => (String(name || '').trim().split(/\s+/)[0] || 'This partner');
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
  const start = b.scheduled_start ?? b.starts_at ?? null;
  const end = b.scheduled_end ?? b.ends_at ?? null;
  let duration = b.duration_min;
  if (!Number.isFinite(duration) && start && end) {
    const ms = new Date(end) - new Date(start);
    if (Number.isFinite(ms) && ms > 0) duration = Math.round(ms / 60000);
  }
  return {
    ...b,
    status: b.status === 'pending' ? 'requested' : b.status,
    questions: b.questions ?? b.notes ?? null,
    scheduled_start: start,
    // The worker's booking DTO now LEFT JOINs the slot for starts_at/ends_at/
    // meeting_url; older deployments send neither, so this stays null and the
    // row simply omits the time rather than inventing one.
    duration_min: Number.isFinite(duration) ? duration : null,
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
  // `user` backs the milestone call on booking success — markMilestone gates
  // on user.spinout_lab_active, so it needs the real /me payload.
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [partners, setPartners] = useState(null); // [] | {failed}
  const [bookings, setBookings] = useState(null); // {items} | {failed}
  const [snapshot, setSnapshot] = useState(null);

  const [filter, setFilter] = useState('recommended');
  const [historyQ, setHistoryQ] = useState('');
  const [copiedBrief, setCopiedBrief] = useState(false);
  // Brief editing (B26) — local overrides keyed by section heading. They feed
  // briefText, so an edited brief is what travels with a booking.
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefEdits, setBriefEdits] = useState(null); // { [heading]: text } | null

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
        setUser(me || null);
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

  const isAdmin = user?.role === 'admin';
  const unlocked = isAdmin || (state?.unlocked_features || []).includes('office-hours');
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
  // "Follow-ups pending" — sessions that still need something from you: an
  // upcoming confirmed session to prep for, or a request the partner hasn't
  // answered yet.
  const followUpsPending = allBookings.filter((b) => b.status === 'requested'
    || (b.status === 'confirmed' && (startMs(b) === null || startMs(b) > now))).length;

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
  const recommendedRoles = useMemo(() => new Set(helpCards.map((c) => c.role)), [helpCards]);
  // Exact role first, then the directory's folded bucket (Finance/Partner sit
  // under Operator) — so "Book now" resolves to a real partner or to null,
  // never to an unrelated first-in-list fallback.
  const matchForRole = (role) => dirItems.find((p) => p.role === role)
    || dirItems.find((p) => filterRoleOf(p.role) === filterRoleOf(role))
    || null;
  // The recommendation reason is derived from the founder's OWN milestones and
  // scoring gaps (helpCards), never from anything claimed about the partner.
  const recTitleByRole = useMemo(() => {
    const m = new Map();
    for (const c of helpCards) if (!m.has(c.role)) m.set(c.role, c.title);
    return m;
  }, [helpCards]);
  const visiblePartners = filter === 'all' ? dirItems
    : filter === 'recommended'
      ? [...dirItems].sort((a, b) => (recommendedRoles.has(b.role) ? 1 : 0) - (recommendedRoles.has(a.role) ? 1 : 0))
      : dirItems.filter((p) => filterRoleOf(p.role) === filter);
  const dirNote = filter === 'recommended'
    ? `Matched to your week ${Number(state?.week || 1)} context, scoring gaps, and open blockers.`
    : DIR_NOTE[filter] || '';

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

  // Founder overrides win over the generated text, so an edited brief is what
  // gets copied and what travels with a booking.
  const briefSections = useMemo(
    () => (brief || []).map((s) => ({ ...s, v: briefEdits?.[s.h] ?? s.v })),
    [brief, briefEdits],
  );

  const briefText = useMemo(
    () => briefSections.map((s) => `${s.h.toUpperCase()}\n${s.v}`).join('\n\n'),
    [briefSections],
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
    const target = matchForRole(role);
    if (target) openDrawer(target);
    else showToast('No partner in the network matches this yet.', 'error');
  };

  // Partner-authored guidance for the partner whose drawer is open (if any).
  const guidance = drawerFor ? normGuidance(drawerFor) : null;
  // Inline editing of guidance is deliberately OUT OF SCOPE in this drawer:
  // this page is the founder-facing booking tool, so a partner-only write form
  // here would need role branching inside the drawer, a second dirty-state
  // machine alongside the brief editor, and would hide a write control behind a
  // modal a founder opens. The editor lives on the partner's own console
  // (/partner/office-hours#guidance); we only deep-link to it.
  const viewerIsThisPartner = !!(drawerFor && user?.partner_id && user.partner_id === drawerFor.id);

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
        {/* Quick actions (design L41-44). Share / Export / Preview have no
            backend on this surface, so they render disabled with the reason
            in their tooltip rather than as dead-end buttons. */}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={`${QA} text-gray-500 dark:text-gray-400`} disabled title="Sharing office-hours sessions isn't supported yet." data-testid="qa-share">
            <Share2 className="w-3.5 h-3.5" /> Share
          </button>
          <button type="button" className={`${QA} text-gray-500 dark:text-gray-400`} disabled title="Session export isn't supported yet." data-testid="qa-export">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button type="button" className={`${QA} text-gray-500 dark:text-gray-400`} disabled title="Office Hours has no investor-facing view." data-testid="qa-preview">
            <Eye className="w-3.5 h-3.5" /> Preview as investor
          </button>
          <button
            type="button"
            className={`${QA} text-gray-600 dark:text-gray-300`}
            onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); showToast('Link copied.'); } catch { showToast('Could not copy link.', 'error'); } }}
            data-testid="button-copy-link"
          >
            <Copy className="w-3.5 h-3.5" /> Copy link
          </button>
        </div>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mb-3">
        Live sessions with partners — investors, lawyers, and operators — turned into tracked execution.
      </p>
      {/* Design's 3px teal accent rule under the header (Office Hours.dc.html L30). */}
      <div className="h-[3px] bg-teal-600 rounded-full mb-5" aria-hidden="true" />

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
          { v: followUpsPending, l: 'Follow-ups pending', tid: 'stat-awaiting' },
          // Counts active partners — network membership, not availability.
          { v: dirItems.length, l: 'Partners in network', tid: 'stat-partners' },
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
            {helpCards.map((c) => {
              // The partner this card would actually open — null means the
              // network has nobody for it, so "Book now" is disabled with the
              // reason in its tooltip rather than erroring into a toast.
              const match = matchForRole(c.role);
              return (
                <div key={c.id} className={`rounded-xl border p-3.5 flex flex-col ${REC_TINT[c.role] || 'border-gray-200 dark:border-gray-700'}`} data-testid={`help-card-${c.id}`}>
                  <div className="flex items-center justify-between mb-2">
                    <RoleTag role={c.role} />
                    <span className={`text-[10.5px] font-bold ${c.urgency === 'Urgent' ? 'text-red-600' : c.urgency === 'This week' ? 'text-amber-600' : 'text-sky-600'}`}>{c.urgency}</span>
                  </div>
                  <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100 mb-1">{c.title}</div>
                  <div className="text-[12px] text-gray-500 dark:text-gray-400 flex-1">{c.body}</div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    {/* Design L63 attributes the card to the partner it resolves
                        to — real resolved row only, nothing when there is none. */}
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate" data-testid={`help-match-${c.id}`}>
                      {match ? match.name : ''}
                    </span>
                    <button
                      type="button"
                      className={`${BTN} bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 shrink-0`}
                      disabled={!unlocked || !match}
                      title={!unlocked ? 'Office Hours unlocks in Week 3' : !match ? 'No partner in the network matches this yet' : undefined}
                      onClick={() => bookTopMatch(c.role)}
                      data-testid={`button-book-help-${c.id}`}
                    >
                      Book now
                    </button>
                  </div>
                </div>
              );
            })}
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
              <div className={`w-9 h-9 rounded-full ${avatarBgOf(p?.name)} text-white grid place-items-center text-[12px] font-bold shrink-0`}>
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
              {FILTERS.map(([key, label]) => (
                <button
                  key={key} type="button" onClick={() => setFilter(key)}
                  className={`px-2.5 h-7 rounded-full text-[11.5px] font-semibold border ${filter === key ? 'bg-teal-600 text-white border-teal-600 dark:bg-teal-600 dark:text-white dark:border-teal-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}
                  data-testid={`filter-${key.toLowerCase()}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[11.5px] text-gray-400 mb-3">{dirNote}</div>
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
                // `capacity_status` is a dev-FastAPI-only column — it is
                // undefined against production D1, so "Unavailable" would be a
                // lie for every real partner. Say nothing when it is unknown;
                // `accepting_intros` IS a real D1 column and is the honest
                // signal. The drawer's slot list stays the ground truth.
                const cap = p.capacity_status;
                const capLabel = cap === 'available' ? 'Available'
                  : cap === 'limited' ? 'Limited availability'
                    : cap === 'unavailable' ? 'Not taking sessions'
                      : p.accepting_intros === 0 ? 'Not taking intros'
                        : '';
                return (
                  <div key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3.5 flex flex-col" data-testid={`partner-card-${p.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className={`w-9 h-9 rounded-xl ${avatarBgOf(p.name)} text-white grid place-items-center text-[12px] font-bold shrink-0`} aria-hidden="true">
                          {initialsOf(p.name || '?')}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100 truncate">{p.name}</div>
                          <div className="text-[11.5px] text-gray-500">{p.headline || p.specialization || p.company || '—'}</div>
                        </div>
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
                      // The reason names the founder's OWN matched gap/blocker
                      // (from helpCards), never a claim about the partner.
                      <div className="rounded-lg border border-teal-200 dark:border-teal-900/60 bg-teal-50/60 dark:bg-teal-950/20 px-2 py-1.5 mt-2 text-[11.5px] font-semibold text-teal-800 dark:text-teal-300">
                        ✓ Recommended — {recTitleByRole.get(p.role) || 'matches an open gap or blocker this week'}
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      {capLabel ? <span className="text-[11px] text-gray-400">{capLabel}</span> : <span />}
                      <button
                        type="button"
                        className={`${BTN} border border-teal-600 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/30 disabled:opacity-50`}
                        disabled={!unlocked || cap === 'unavailable' || p.accepting_intros === 0}
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
              <div className="flex items-center gap-2">
                {brief && brief.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setEditingBrief((v) => !v)}
                    className="text-[11.5px] font-semibold text-gray-500 dark:text-gray-400"
                    data-testid="button-edit-brief"
                  >
                    {editingBrief ? 'Done' : 'Edit'}
                  </button>
                )}
                {briefEdits && (
                  <button
                    type="button"
                    onClick={() => { setBriefEdits(null); showToast('Brief reset to the generated version.'); }}
                    className="text-[11.5px] font-semibold text-gray-500 dark:text-gray-400"
                    data-testid="button-reset-brief"
                  >
                    Reset to generated
                  </button>
                )}
                <button type="button" onClick={copyBrief} className="text-[11.5px] font-semibold text-teal-700 dark:text-teal-300 inline-flex items-center gap-1" data-testid="button-copy-brief">
                  {copiedBrief ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copiedBrief ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="text-[11px] text-gray-400 mb-3">
              Auto-generated from your startup data — attach it when you book and it travels with the request.
              {briefEdits ? ' Edited by you.' : ''}
            </div>
            {!brief ? (
              <div className="text-[12.5px] text-gray-500">Set up your startup profile to generate a brief.</div>
            ) : briefSections.map((s) => (
              <div key={s.h} className="mb-3 last:mb-0">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">{s.h}</div>
                {editingBrief ? (
                  <textarea
                    value={s.v}
                    onChange={(e) => { const v = e.target.value; setBriefEdits((prev) => ({ ...(prev || {}), [s.h]: v })); }}
                    rows={3}
                    className="w-full mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-[12px] text-gray-700 dark:text-gray-300"
                    data-testid={`brief-edit-${s.h.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  />
                ) : (
                  <div className="text-[12px] text-gray-700 dark:text-gray-300 whitespace-pre-line">{s.v}</div>
                )}
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
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-[46px] h-[46px] rounded-xl ${avatarBgOf(drawerFor.name)} text-white grid place-items-center text-[15px] font-bold shrink-0`} aria-hidden="true">
                  {initialsOf(drawerFor.name || '?')}
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-100">{drawerFor.name}</div>
                  <div className="text-[12px] text-gray-500">{drawerFor.headline || drawerFor.specialization || drawerFor.company || ''}</div>
                  <div className="mt-1"><RoleTag role={roleOfPartner(drawerFor)} /></div>
                </div>
              </div>
              <button type="button" onClick={() => setDrawerFor(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" data-testid="button-close-drawer">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            {drawerFor.bio && <p className="text-[12.5px] text-gray-600 dark:text-gray-300 mb-4">{drawerFor.bio}</p>}

            {/* Partner-authored booking guidance (design L191-196). Rendered
                ONLY from real partner-supplied content — see normGuidance().
                Each sub-block appears only when its own field is non-empty;
                there are no placeholders, defaults or filler. */}
            {guidance?.any ? (
              <div className="space-y-4 mb-5" data-testid="partner-guidance">
                {guidance.whenToBook && (
                  <div>
                    <div className={`${LBL} mb-1.5`}>When to book {firstNameOf(drawerFor.name)}</div>
                    <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-line" data-testid="guidance-when">
                      {guidance.whenToBook}
                    </p>
                  </div>
                )}
                {(guidance.stageFit || guidance.outcome) && (
                  <div className="grid grid-cols-2 gap-3">
                    {guidance.stageFit && (
                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3" data-testid="guidance-stage">
                        <div className={`${LBL} mb-1`}>Best for stage</div>
                        <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">{guidance.stageFit}</div>
                      </div>
                    )}
                    {guidance.outcome && (
                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3" data-testid="guidance-outcome">
                        <div className={`${LBL} mb-1`}>One session gets you</div>
                        <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">{guidance.outcome}</div>
                      </div>
                    )}
                  </div>
                )}
                {guidance.bring.length > 0 && (
                  <div>
                    <div className={`${LBL} mb-1.5`}>Bring to the session</div>
                    <ul className="space-y-1.5" data-testid="guidance-bring">
                      {guidance.bring.map((b, i) => (
                        <li key={`${i}-${b}`} className="flex gap-2 text-[12.5px] text-gray-700 dark:text-gray-300">
                          <span aria-hidden="true" className="text-teal-600 dark:text-teal-400">›</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3.5 mb-5" data-testid="guidance-empty">
                <div className="text-[12.5px] text-gray-600 dark:text-gray-300">
                  {firstNameOf(drawerFor.name)} hasn't published booking guidance yet.
                </div>
                <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1">
                  Set your objective and desired outcome below so they can prep for the session.
                </div>
              </div>
            )}

            {viewerIsThisPartner && (
              <Link to="/partner/office-hours#guidance" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 dark:text-teal-300 mb-5" data-testid="link-edit-guidance">
                {guidance?.any ? 'Edit your booking guidance' : 'Add your booking guidance'} <ChevronRight className="w-3 h-3" />
              </Link>
            )}

            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100 mb-3">Book a session</div>
            </div>

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
                    <span className="text-[11.5px] text-gray-400">
                      {Number.isFinite(s.duration_min) ? `${s.duration_min} min` : 'Duration TBC'}{s.title ? ` · ${s.title}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
              <input type="checkbox" checked={attachBrief} onChange={(e) => setAttachBrief(e.target.checked)} className="accent-teal-600" data-testid="checkbox-attach-brief" />
              <span className="text-[12.5px] text-gray-700 dark:text-gray-300">Attach my pre-session brief to the request</span>
            </label>

            {/* A blank desired outcome also trips the hint — the partner preps
                from these fields, so a thin brief wastes the session. Outcome
                stays advisory: the confirm button does not require it. */}
            {(!objective || !outcome.trim() || !slotId) && (slots?.items || []).length > 0 && (
              <div className="text-[11.5px] text-amber-700 dark:text-amber-400 mb-3" data-testid="readiness-hint">
                Add an objective, a desired outcome, and a slot — the partner preps from these.
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
