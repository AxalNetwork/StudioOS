/**
 * Spin-Out Lab — the facts both surfaces of `/spinout-lab` read from.
 *
 * WHY THIS FILE EXISTS. The Lab intro renders in two places: logged out
 * (`pages/SpinoutLabMarketingPage.jsx`) and signed in but not yet applied
 * (the `Dashboard` branch of `pages/SpinoutLabPage.jsx`). Both used to import
 * their shared content from `SpinoutLabPage.jsx`, which already imports the
 * marketing page — a two-node import cycle that happened to work. Adding
 * `components/SpinoutLabIntro.jsx`, which both surfaces now render, would have
 * made it a three-node cycle. So the shared facts moved DOWN here, where
 * nothing imports a page, and the cycle is gone.
 *
 * WHAT BELONGS HERE. Cohort calendar math, the jurisdiction table, the four
 * week definitions, and the stats hook — the things that must have exactly one
 * answer no matter which surface asks. Presentation (theme maps, icon sets,
 * section components) stays with the pages.
 *
 * WHAT MUST NOT DRIFT. `resolveOpenCohort` mirrors `resolveApplicationTarget`
 * in `cloudflare-worker/src/services/cohortApplications.ts`. If the worker's
 * window moves and this does not, the page quotes a deadline the API rejects.
 */
import { useEffect, useState } from 'react';
import { spinoutLab } from './api';
import { reportError } from './log';

// ---------------------------------------------------------------------------
// Cohort window helpers (client-side, mirrors Worker math)
// ---------------------------------------------------------------------------
// Base anchor: May 2026 = Cohort 1 (Cohort 4 = Aug 2026 confirms the sequence).
const COHORT_BASE = { year: 2026, month: 5, num: 1 };
export const COHORT_TZ = 'America/New_York'; // Delaware time — DST-correct via Intl

/** How many 7-day weeks a cohort runs. Mirrors the worker's cohort timing. */
export const COHORT_WEEKS = 4;

/** UTC ms of a Delaware wall-clock datetime. Two-pass to handle DST correctly. */
function _wallToUtcMs(year, month, day, h = 0, m = 0, s = 0) {
  const wallAsUtc = Date.UTC(year, month - 1, day, h, m, s);
  const _localAt = (utcMs) => {
    const p = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone: COHORT_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(utcMs))) p[part.type] = part.value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  };
  const offset1 = _localAt(wallAsUtc) - wallAsUtc;
  const guess = wallAsUtc - offset1;
  return wallAsUtc - (_localAt(guess) - guess);
}

/** Ordinal cohort number for a given year/month. */
export function cohortNumFor(year, month) {
  return (year - COHORT_BASE.year) * 12 + (month - COHORT_BASE.month) + COHORT_BASE.num;
}

/**
 * Resolve the cohort currently open for applications.
 * Deadline = 7 days before the 1st of the cohort month at 23:59:59 ET
 * (day -6 in Date.UTC semantics — mirrors resolveApplicationTarget in
 * cloudflare-worker/src/services/cohortApplications.ts).
 * Workspace access is granted automatically at midnight Delaware time on the
 * 1st of the cohort month by the Worker's cohort-timing cron.
 *
 * `endMs` is DERIVED, never typed: the sprint is COHORT_WEEKS × 7 wall-clock
 * days from the start, which is how `services/cohortTiming.ts` lays out the
 * week windows. A hand-written end date is the failure the brief already had
 * once — "Cohort 4 · closes August 1, 2026" frozen in source and simply past
 * by the time anyone read it.
 */
export function resolveOpenCohort(nowMs = Date.now()) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: COHORT_TZ, year: 'numeric', month: '2-digit',
  }).formatToParts(new Date(nowMs))) p[part.type] = part.value;
  let year = Number(p.year), month = Number(p.month);
  // Advance until we find a cycle whose application window is still open.
  for (let i = 0; i < 24; i++) {
    const close = _wallToUtcMs(year, month, -6, 23, 59, 59); // day -6 = 7 days before 1st
    if (close > nowMs) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  const closeMs = _wallToUtcMs(year, month, -6, 23, 59, 59);
  const startMs = _wallToUtcMs(year, month, 1, 0, 0, 0);
  const endMs = _wallToUtcMs(year, month, 1 + COHORT_WEEKS * 7, 0, 0, 0);
  return { year, month, cohortNum: cohortNumFor(year, month), closeMs, startMs, endMs };
}

/** A Delaware-time date label, or null. Never an Invalid Date on screen. */
export function cohortDateLabel(ms, opts = { month: 'long', day: 'numeric', year: 'numeric' }) {
  if (ms == null || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleDateString('en-US', { ...opts, timeZone: COHORT_TZ });
  } catch {
    return null;
  }
}

/**
 * The open cohort's number and application deadline, formatted in Delaware
 * time. Shared so the marketing CTA, the intro and the printable brief can
 * never quote different dates for the same cohort. Returns null if the cohort
 * math throws, which every caller renders as a generic "next cohort" line
 * rather than a wrong one.
 */
export function openCohortCopy(nowMs = Date.now()) {
  try {
    const c = resolveOpenCohort(nowMs);
    if (!c) return null;
    return {
      cohortNum: c.cohortNum,
      deadlineLabel: cohortDateLabel(c.closeMs),
      startLabel: cohortDateLabel(c.startMs),
      endLabel: cohortDateLabel(c.endMs),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The four weeks — one definition, for everyone
// ---------------------------------------------------------------------------
/**
 * THE GATES ARE NOT PER-TRACK. The intro offers three starting points (see
 * `spinoutLabArsenal.js`), and the design that introduced them drew each track
 * its own four gates. The product does not work that way: `MILESTONES` in
 * `cloudflare-worker/src/services/spinoutLabCatalog.ts` is ONE list, enforced
 * identically for every founder in the cohort. Drawing four track-specific
 * gate sets would tell a founder that week 2 asks something it does not ask.
 *
 * So this array stays the single source, every surface renders it, and the
 * intro says out loud that the gates are the same whichever track you pick.
 *
 * Each phase maps 1:1 onto a real backend week, so `backendWeek` is unique per
 * phase — previously Pitch and Fund both claimed week 4, which lit two cards
 * as "active" at once for any founder in their final week.
 *
 * Milestones auto-complete from real product actions (lib/spinoutLabHooks.js)
 * — there is no manual checklist. Items default to Delaware wording;
 * pipelineItemsFor() swaps the jurisdiction-specific lines.
 */
export const PIPELINE_PHASES = [
  {
    name: 'Validate', days: 'Days 1–7',
    backendWeek: 1, color: 'violet',
    gate: 'discovery evidence the record can show',
    items: [
      'Problem/solution definition workshop',
      'Market sizing and TAM analysis',
      'Competitor landscape mapping',
      'Go/no-go decision gate',
    ],
  },
  {
    name: 'Build', days: 'Days 8–14',
    backendWeek: 2, color: 'teal',
    gate: 'a scope and a surface, both written down',
    items: [
      'MVP scope definition',
      '90-day OKRs and product roadmap',
      'Prototype or landing page live',
      'Brand v1 and pitch deck v1 drafted',
    ],
  },
  {
    name: 'Pitch', days: 'Days 15–21',
    backendWeek: 3, color: 'amber',
    gate: 'a score, and someone who has read it',
    items: [
      'First venture-readiness score',
      'Advisor matching and office-hours cadence',
      'Co-founder match',
      'Warm intro prep with partner network',
    ],
  },
  {
    name: 'Fund', days: 'Days 22–28',
    backendWeek: 4, color: 'pink',
    gate: 'a raise the record supports',
    // items[0] and items[1] are jurisdiction-specific — see pipelineItemsFor().
    items: [
      'Delaware C-Corp incorporation',
      '83(b) election filing',
      'Cap table, founder vesting and IP assignment',
      'Partner pitch sessions and term sheet review',
      'Graduate: venture-ready company',
    ],
  },
];

/**
 * Jurisdiction-specific wording for the incorporation lines.
 *
 * These live on Fund rather than a separate "Structure" phase because
 * incorporation and capital happen in the SAME program week — Week 4
 * ("Incorporate & Capital").
 */
export function pipelineItemsFor(phase, jurisdictionKey) {
  if (phase.name !== 'Fund') return phase.items;
  const j = labJurisdiction(jurisdictionKey);
  const items = [...phase.items];
  items[0] = j.incLine;
  items[1] = j.filingInc;
  return items;
}

// ---------------------------------------------------------------------------
// Jurisdictions
// ---------------------------------------------------------------------------
/**
 * Full jurisdiction metadata: entity + equity-filing wording that the hero
 * chips, the Fund-week lines and the deliverables all derive from.
 *
 * SEVEN, not four. Two are live (Delaware, Wyoming); five are marked `soon`
 * and are not selectable. A surface that draws only the four it feels like
 * drawing is quietly telling a founder the other three do not exist.
 */
export const LAB_JURISDICTIONS = [
  {
    key: 'de', label: 'Delaware, USA', entity: 'Delaware C-Corp',
    incLine: 'Delaware C-Corp incorporation', entityDesc: 'Fully incorporated entity with EIN and registered agent.',
    filingBadge: '83(b) Filed', filingName: '83(b) Election', filingInc: '83(b) election filing',
    filingDesc: 'Filed within the 30-day IRS window, archived in your data room.',
  },
  {
    key: 'wy', label: 'Wyoming, USA', entity: 'Wyoming C-Corp',
    incLine: 'Wyoming C-Corp incorporation', entityDesc: 'Fully incorporated Wyoming entity with EIN and registered agent.',
    filingBadge: '83(b) Filed', filingName: '83(b) Election', filingInc: '83(b) election filing',
    filingDesc: 'Filed within the 30-day IRS window, archived in your data room.',
  },
  {
    key: 'sg', label: 'Singapore', soon: true, entity: 'Singapore Pte Ltd',
    incLine: 'Singapore Pte Ltd incorporation', entityDesc: 'Private Limited entity with ACRA registration and a company secretary.',
    filingBadge: 'ACRA Lodged', filingName: 'ACRA Share Allotment', filingInc: 'ACRA share allotment lodgement',
    filingDesc: 'Founder shares allotted and lodged with ACRA within the statutory window.',
  },
  {
    key: 'uk', label: 'London, UK', soon: true, entity: 'UK Ltd',
    incLine: 'UK Ltd incorporation', entityDesc: 'Private Limited company filed with Companies House.',
    filingBadge: 'EMI Registered', filingName: 'EMI Option Scheme', filingInc: 'EMI option scheme setup',
    filingDesc: 'HMRC-valued EMI scheme registered for founders and early hires.',
  },
  {
    key: 'ee', label: 'Estonia', soon: true, entity: 'Estonia OÜ',
    incLine: 'Estonia OÜ incorporation', entityDesc: 'Private Limited (OÜ) via e-Residency with Business Register entry.',
    filingBadge: 'Registry Filed', filingName: 'e-Residency Registry', filingInc: 'Business Register entry',
    filingDesc: 'Founder holdings entered in the Estonian Business Register.',
  },
  {
    key: 'ae', label: 'Dubai, UAE', soon: true, entity: 'ADGM entity',
    incLine: 'ADGM incorporation', entityDesc: 'ADGM company with registered agent.',
    filingBadge: 'ADGM Filed', filingName: 'ADGM Share Filing', filingInc: 'ADGM share filing',
    filingDesc: 'Founder shares filed with the ADGM registrar.',
  },
  {
    key: 'ca', label: 'Alberta, Canada', soon: true, entity: 'Alberta Corp',
    incLine: 'Alberta Corp incorporation', entityDesc: 'Canadian corporation with registered agent.',
    filingBadge: 'CRA Filed', filingName: 'Section 7 Filing', filingInc: 'Section 7 equity filing',
    filingDesc: 'Founder equity documented under CRA rules.',
  },
];

/**
 * An unknown key — or a "Soon" jurisdiction that cannot be selected yet —
 * resolves to the Delaware record.
 */
export function labJurisdiction(key) {
  const j = LAB_JURISDICTIONS.find((x) => x.key === key);
  return !j || j.soon ? LAB_JURISDICTIONS[0] : j;
}

/** Hero outcome chips — 4 chips, two of them jurisdiction-derived. */
export function outcomeBadgesFor(jurisdictionKey) {
  const j = labJurisdiction(jurisdictionKey);
  return [j.entity, 'Vesting Cap Table', j.filingBadge, 'Pitch Deck Ready'];
}

// ---------------------------------------------------------------------------
// Apply targets
// ---------------------------------------------------------------------------
/**
 * The logged-out CTA. Deliberately carries only `lane` and `product`:
 * `pages/RegisterPage.jsx` reads exactly those two params, so any third —
 * a `track`, say — would be dropped in silence and the page would be
 * promising a choice nothing records.
 */
export const LAB_APPLY_HREF = '/register?lane=founder&product=spinout-lab';
export const LAB_APPLY_HREF_SIGNED_IN = '/spinout-lab/apply';
export const LAB_CONTACT_HREF = 'mailto:hello@axal.vc?subject=Spin-Out%20Lab';

// ---------------------------------------------------------------------------
// Timestamps and figures
// ---------------------------------------------------------------------------
/**
 * Parse a SQLite timestamp.
 *
 * `datetime('now')` returns "YYYY-MM-DD HH:MM:SS" in UTC — no `T`, no `Z`.
 * That string is not a valid ISO-8601 date-time, so `new Date()` handling of
 * it is implementation-defined: V8 accepts it and reads it as LOCAL time,
 * Safari returns Invalid Date. Both are wrong for a UTC value, and the local
 * reading is the more dangerous one because it silently shifts every rendered
 * date by the viewer's offset.
 *
 * Normalises the separator, then appends `Z` unless the string already carries
 * a zone. Returns null rather than an Invalid Date so callers can fall back to
 * omitting the date instead of printing "Invalid Date" at a founder.
 */
export function parseSqliteUtc(s) {
  if (s == null || s === '') return null;
  const raw = String(s);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `null` for anything that is not a positive amount — never "$0". */
export function fmtRaised(n) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v) || v <= 0) return null;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

/**
 * Live programme figures from the public `GET /spinout-lab/stats`.
 *
 * `null` means "not loaded or failed", and every caller renders that as an
 * em-dash rather than a zero: "0 companies" is a claim about the programme,
 * and a failed fetch has not earned it.
 */
export function useSpinoutStats() {
  // null = loading, 'error' = fetch failed, object = loaded
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let alive = true;
    spinoutLab
      .stats()
      .then((r) => {
        if (alive) setStats(r && typeof r === 'object' ? r : 'error');
      })
      .catch((e) => {
        reportError('spinout-lab:stats', e);
        if (alive) setStats('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  const loaded = stats && stats !== 'error' ? stats : null;
  return {
    companies: loaded ? Number(loaded.companies) || 0 : null,
    raised: loaded ? (fmtRaised(loaded.total_raised) ?? '$0') : null,
  };
}

/** Label for the companies-built stat, singular-correct. */
export function companiesLabel(companies) {
  return companies === null ? '—' : `${companies} ${companies === 1 ? 'company' : 'companies'}`;
}

// ---------------------------------------------------------------------------
// Cohort reads
// ---------------------------------------------------------------------------
/**
 * The four-state shape every Lab section renders against.
 *
 *   { loading: true }                  — in flight
 *   { error: '…' }                     — the read failed; say so, do not guess
 *   { rows: [] }                       — the read worked and there is nothing
 *   { rows: [ … ] }                    — the read worked
 *
 * "Failed" and "empty" are kept apart on purpose. An empty cohort directory
 * means no company is in the sprint this month; a failed one means we do not
 * know. Collapsing them renders the second as the first, which is a claim.
 */
function useCohortRead(fetcher, { enabled = true } = {}) {
  const [state, setState] = useState({ loading: enabled, error: '', rows: [] });

  useEffect(() => {
    if (!enabled) { setState({ loading: false, error: '', rows: [] }); return undefined; }
    let alive = true;
    setState((c) => ({ ...c, loading: true, error: '' }));
    fetcher()
      .then((r) => { if (alive) setState({ loading: false, error: '', rows: Array.isArray(r) ? r : [] }); })
      .catch((e) => {
        reportError('spinout-lab:cohort-read', e);
        if (alive) setState({ loading: false, error: e?.message || 'That could not be read.', rows: [] });
      });
    return () => { alive = false; };
    // `fetcher` is a stable module-level method on the api object.
  }, [enabled, fetcher]);

  return state;
}

/**
 * The companies in the sprint right now — public, company-level facts only
 * (`GET /spinout-lab/cohort`; the route returns a working name, sector and
 * week, never a founder name).
 */
export function useCohortDirectory() {
  return useCohortRead(spinoutLab.cohort);
}

/**
 * Gate clears across the active cohort (`GET /spinout-lab/shipped`).
 *
 * Signed-in only, so `enabled` is the caller's session. Firing it logged out
 * would 401 every time; the logged-out surface states the limit instead of
 * rendering an error it caused itself.
 */
export function useShippedFeed({ enabled }) {
  return useCohortRead(spinoutLab.shipped, { enabled });
}
