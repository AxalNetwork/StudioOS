import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, ArrowRight, FlaskConical, Globe, Circle, Lock, Unlock, FileText, BadgeCheck } from "lucide-react";
import { spinoutLab } from "../lib/api";
import { useAuth } from "../hooks/useAuthSync";
import { reportError } from "../lib/log";
import SpinoutLabMarketingPage from "./SpinoutLabMarketingPage";
import SpinoutLabWorkspace from "./SpinoutLabWorkspace";

// ---------- Cohort window helpers (client-side, mirrors Worker math) ----------
// Base anchor: May 2026 = Cohort 1 (Cohort 4 = Aug 2026 confirms the sequence).
const COHORT_BASE = { year: 2026, month: 5, num: 1 };
const COHORT_TZ = 'America/New_York'; // Delaware time — DST-correct via Intl

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
  let guess = wallAsUtc - offset1;
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
 */
export function resolveOpenCohort(nowMs = Date.now()) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: COHORT_TZ, year: 'numeric', month: '2-digit',
  }).formatToParts(new Date(nowMs))) p[part.type] = part.value;
  let year = Number(p.year), month = Number(p.month);
  // Advance until we find a cycle whose application window is still open.
  for (let i = 0; i < 24; i++) {
    const closeMs = _wallToUtcMs(year, month, -6, 23, 59, 59); // day -6 = 7 days before 1st
    if (closeMs > nowMs) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  const closeMs = _wallToUtcMs(year, month, -6, 23, 59, 59);
  const startMs = _wallToUtcMs(year, month, 1, 0, 0, 0);
  return { year, month, cohortNum: cohortNumFor(year, month), closeMs, startMs };
}
// ---------------------------------------------------------------------------

// Pipeline cards mirror the "Spin-Out Lab" design handoff
// (attached_assets/Spin-Out_Lab.dc_*.html), with one correction: the handoff
// drew FIVE phases over 30 days, but the program the product actually runs is
// FOUR weeks / 28 days (PROGRAM_DAYS in lib/scoringViewModel.js and in the
// worker's spinoutDeckData.ts). Each phase now maps 1:1 onto a real backend
// week, so `backendWeek` is unique per phase — previously Pitch and Fund both
// claimed week 4, which lit two cards as "active" at once for any founder in
// their final week.
//
// The handoff's separate "Structure" phase is folded into Fund: incorporation,
// 83(b) and the cap table happen in Week 4 ("Incorporate & Capital"), the same
// week as the raise — not in a week of their own.
//
// Milestones auto-complete from real product actions (lib/spinoutLabHooks.js)
// — there is no manual checklist on this page. Items default to Delaware
// wording; pipelineItemsFor() swaps the jurisdiction-specific lines.
export const PIPELINE_PHASES = [
  {
    name: "Validate", days: "Days 1–7",
    backendWeek: 1, color: "violet",
    items: [
      "Problem/solution definition workshop",
      "Market sizing and TAM analysis",
      "Competitor landscape mapping",
      "Go/no-go decision gate",
    ],
  },
  {
    name: "Build", days: "Days 8–14",
    backendWeek: 2, color: "teal",
    items: [
      "MVP scope definition",
      "90-day OKRs and product roadmap",
      "Prototype or landing page live",
      "Brand v1 and pitch deck v1 drafted",
    ],
  },
  {
    name: "Pitch", days: "Days 15–21",
    backendWeek: 3, color: "amber",
    items: [
      "First venture-readiness score",
      "Advisor matching and office-hours cadence",
      "Co-founder match",
      "Warm intro prep with partner network",
    ],
  },
  {
    name: "Fund", days: "Days 22–28",
    backendWeek: 4, color: "pink",
    // items[0] and items[1] are jurisdiction-specific — see pipelineItemsFor().
    items: [
      "Delaware C-Corp incorporation",
      "83(b) election filing",
      "Cap table, founder vesting and IP assignment",
      "Partner pitch sessions and term sheet review",
      "Graduate: venture-ready company",
    ],
  },
];

// Jurisdiction-specific wording for the incorporation lines (design handoff:
// juris.incLine / juris.filingInc). Unknown or "Soon" keys fall back to
// the Delaware record via labJurisdiction().
//
// These live on Fund rather than a separate "Structure" phase because
// incorporation and capital happen in the SAME program week — Week 4
// ("Incorporate & Capital"). See PIPELINE_PHASES above.
export function pipelineItemsFor(phase, jurisdictionKey) {
  if (phase.name !== "Fund") return phase.items;
  const j = labJurisdiction(jurisdictionKey);
  const items = [...phase.items];
  items[0] = j.incLine;
  items[1] = j.filingInc;
  return items;
}

export const PHASE_THEMES = {
  violet: {
    bg: "bg-violet-50/50 dark:bg-violet-950/20", border: "border-violet-200 dark:border-violet-900/50",
    chip: "bg-violet-100 dark:bg-violet-900/60", ink: "text-violet-700 dark:text-violet-300",
    ring: "ring-violet-400 dark:ring-violet-500 shadow-violet-500/20", fill: "#8b5cf6"
  },
  blue: {
    bg: "bg-blue-50/50 dark:bg-blue-950/20", border: "border-blue-200 dark:border-blue-900/50",
    chip: "bg-blue-100 dark:bg-blue-900/60", ink: "text-blue-700 dark:text-blue-300",
    ring: "ring-blue-400 dark:ring-blue-500 shadow-blue-500/20", fill: "#3b82f6"
  },
  teal: {
    bg: "bg-teal-50/50 dark:bg-teal-950/20", border: "border-teal-200 dark:border-teal-900/50",
    chip: "bg-teal-100 dark:bg-teal-900/60", ink: "text-teal-700 dark:text-teal-300",
    ring: "ring-teal-400 dark:ring-teal-500 shadow-teal-500/20", fill: "#0d9488"
  },
  amber: {
    bg: "bg-amber-50/50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-900/50",
    chip: "bg-amber-100 dark:bg-amber-900/60", ink: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-400 dark:ring-amber-500 shadow-amber-500/20", fill: "#d97706"
  },
  pink: {
    bg: "bg-pink-50/50 dark:bg-pink-950/20", border: "border-pink-200 dark:border-pink-900/50",
    chip: "bg-pink-100 dark:bg-pink-900/60", ink: "text-pink-700 dark:text-pink-300",
    ring: "ring-pink-400 dark:ring-pink-500 shadow-pink-500/20", fill: "#db2777"
  }
};

const DIconCorp = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 11h.01M15 11h.01"/></svg>;
const DIconCap = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 4"/></svg>;
const DIconFile83 = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15l2 2 4-4"/></svg>;
const DIconDeck = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>;
const DIconModel = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 15l3-4 3 3 5-7"/></svg>;
const DIconIntro = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 11a3 3 0 0 0 0-6"/><path d="M21 20c0-2.5-1.3-4-3.5-4.6"/></svg>;
const DIconAdvisor = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 21l-4.9-2.6.9-5.5-4-3.9L9.5 8z"/></svg>;
const DIconDataroom = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
const DIconBadge = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="9" r="6"/><path d="M9 14.5 8 22l4-2 4 2-1-7.5"/></svg>;

// Rows [0] (entity) and [2] (equity filing) are jurisdiction-derived in the
// design handoff — render via deliverablesFor(jurisdictionKey); this base
// array carries the Delaware record's wording.
export const DELIVERABLES = [
  { icon: <DIconCorp />, name: "Delaware C-Corp", desc: "Fully incorporated entity with EIN and registered agent." },
  { icon: <DIconCap />, name: "Vesting Cap Table", desc: "Founder equity with 4-year vest, 1-year cliff on Carta." },
  { icon: <DIconFile83 />, name: "83(b) Election", desc: "Filed within the 30-day IRS window, archived in your data room." },
  { icon: <DIconDeck />, name: "Pitch Deck", desc: "12-slide venture-standard deck, designed and reviewed." },
  { icon: <DIconModel />, name: "Financial Model", desc: "3-year P&L, revenue model, and unit economics." },
  { icon: <DIconIntro />, name: "Warm Introductions", desc: "5–10 curated intros to the Axal VC investor network." },
  { icon: <DIconAdvisor />, name: "Advisor Network", desc: "2 matched advisors with equity agreements in place." },
  { icon: <DIconDataroom />, name: "Data Room", desc: "Organized deal room ready for investor due diligence." },
  { icon: <DIconBadge />, name: "Verified Badge", desc: "Spin-Out Lab Alumni badge for your profile." }
];

// Active-cohort tracker columns — LIVE data from GET /spinout-lab/cohort
// (public; the section renders on the logged-out marketing page too). Only
// the column theming below is presentational: weeks 1-4 map to the first
// four columns; recent graduates fill "Incorporated".
const TRACKER_COLUMNS = [
  { key: 1, name: 'VALIDATE', accent: 'border-violet-500', tint: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300' },
  { key: 2, name: 'STRUCTURE', accent: 'border-blue-500', tint: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  { key: 3, name: 'BUILD', accent: 'border-teal-500', tint: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300' },
  { key: 4, name: 'PITCH & FUND', accent: 'border-amber-500', tint: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  { key: 5, name: 'INCORPORATED', accent: 'border-pink-500', tint: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300' },
];

// Reference-design shared content (Spin-Out Lab.dc.html): graduate alumni
// cards, jurisdiction chips, and the application CTA. Shared with
// SpinoutLabMarketingPage so both surfaces stay in lockstep.
export const LAB_APPLY_HREF = '/register?lane=founder&product=spinout-lab';
export const LAB_CONTACT_HREF = 'mailto:hello@axal.vc?subject=Spin-Out%20Lab';

// Graduate cards are LIVE data — GET /spinout-lab/graduates (public; the
// section renders on the logged-out marketing page too). Only the avatar
// color themes below are presentational.
const GRAD_AVATAR_THEMES = [
  { bg: 'bg-violet-100 dark:bg-violet-900', ink: 'text-violet-700 dark:text-violet-200' },
  { bg: 'bg-blue-100 dark:bg-blue-900', ink: 'text-blue-700 dark:text-blue-200' },
  { bg: 'bg-teal-100 dark:bg-teal-900', ink: 'text-teal-700 dark:text-teal-200' },
  { bg: 'bg-amber-100 dark:bg-amber-900', ink: 'text-amber-700 dark:text-amber-200' },
  { bg: 'bg-pink-100 dark:bg-pink-900', ink: 'text-pink-700 dark:text-pink-200' },
  { bg: 'bg-indigo-100 dark:bg-indigo-900', ink: 'text-indigo-700 dark:text-indigo-200' },
];

function gradInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function fmtRaised(n) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v) || v <= 0) return null;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

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

function gradDateLabel(iso) {
  const d = parseSqliteUtc(iso);
  if (!d) return null;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function gradCohortLabel(cohort) {
  if (cohort == null || cohort === '') return 'Alumni';
  const s = String(cohort).trim();
  return /^\d+$/.test(s) ? `Cohort ${s}` : s;
}

// Full jurisdiction metadata table from the design handoff (Spin-Out
// Lab.dc.html `jurisdictions`): entity + equity-filing wording that the
// hero chips, pipeline Structure lines, and deliverables derive from.
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

// Design fallback: an unknown key — or a "Soon" jurisdiction that can't be
// selected yet — resolves to the Delaware record.
export function labJurisdiction(key) {
  const j = LAB_JURISDICTIONS.find((x) => x.key === key);
  return !j || j.soon ? LAB_JURISDICTIONS[0] : j;
}

// Hero outcome chips (design: outcomeBadges) — 4 chips, two of them
// jurisdiction-derived.
export function outcomeBadgesFor(jurisdictionKey) {
  const j = labJurisdiction(jurisdictionKey);
  return [j.entity, 'Vesting Cap Table', j.filingBadge, 'Pitch Deck Ready'];
}

// DELIVERABLES with rows [0] (entity) and [2] (equity filing) swapped in
// from the selected jurisdiction's record (design: deliverables).
export function deliverablesFor(jurisdictionKey) {
  const j = labJurisdiction(jurisdictionKey);
  const rows = [...DELIVERABLES];
  rows[0] = { ...rows[0], name: j.entity, desc: j.entityDesc };
  rows[2] = { ...rows[2], name: j.filingName, desc: j.filingDesc };
  return rows;
}

// Jurisdiction selector bar (design: "Incorporation jurisdiction" chips).
// Client-state only — the selection restyles copy across the program view.
// Shared by the signed-in Dashboard and the logged-out marketing page.
export function JurisdictionBar({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[14px] p-3 px-4 mb-8 shadow-sm">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">Incorporation jurisdiction</span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {LAB_JURISDICTIONS.map((j) => (
          j.soon ? (
            <button key={j.key} disabled className="h-[34px] px-3 rounded-lg bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-800 text-[13px] font-semibold opacity-60 cursor-not-allowed flex items-center gap-1.5">
              {j.label} <span className="text-[9px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 rounded px-1.5 py-0.5">Soon</span>
            </button>
          ) : (
            <button
              key={j.key}
              type="button"
              onClick={() => onChange(j.key)}
              className={`h-[34px] px-3 rounded-lg text-[13px] font-semibold transition-colors border ${
                value === j.key
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {j.label}
            </button>
          )
        ))}
      </div>
      <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto hidden md:inline">Entity & equity filing update across the program →</span>
    </div>
  );
}

export function GraduatesSection() {
  // null = loading, 'error' = fetch failed, [] = no graduates yet
  const [grads, setGrads] = useState(null);

  useEffect(() => {
    let alive = true;
    spinoutLab
      .graduates()
      .then((r) => {
        if (alive) setGrads(Array.isArray(r) ? r : []);
      })
      .catch((e) => {
        reportError('spinout-lab:graduates', e);
        if (alive) setGrads('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">Graduate companies.</h2>
        {Array.isArray(grads) && grads.length > 0 && (
          <span className="text-[12.5px] text-gray-400">Select a company to view its profile</span>
        )}
      </div>
      {grads === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-4 shadow-sm animate-pulse">
              <div className="w-11 h-11 rounded-[11px] bg-gray-100 dark:bg-gray-800 mb-3.5" />
              <div className="h-3.5 w-2/5 rounded bg-gray-100 dark:bg-gray-800 mb-2" />
              <div className="h-3 w-3/5 rounded bg-gray-100 dark:bg-gray-800" />
            </div>
          ))}
        </div>
      )}
      {grads === 'error' && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-6 text-[13px] text-gray-500 dark:text-gray-400">
          Couldn't load graduate companies right now — please try again later.
        </div>
      )}
      {Array.isArray(grads) && grads.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-[16px] p-8 text-center">
          <div className="text-[14px] font-bold text-gray-700 dark:text-gray-300 mb-1">No graduates yet.</div>
          <div className="text-[12.5px] text-gray-500 dark:text-gray-400">
            Companies appear here automatically when their founders complete the 4-week sprint.
          </div>
        </div>
      )}
      {Array.isArray(grads) && grads.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {grads.map((g, i) => {
            const t = GRAD_AVATAR_THEMES[i % GRAD_AVATAR_THEMES.length];
            const raised = fmtRaised(g.raised);
            const gradDate = gradDateLabel(g.graduated_at);
            const cardBody = (
              <>
                <div className="flex items-center justify-between mb-3.5">
                  <div className={`w-11 h-11 rounded-[11px] font-extrabold text-[15px] flex items-center justify-center ${t.bg} ${t.ink}`}>{gradInitials(g.name)}</div>
                  <span className="tabular-nums text-[11px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/50 border border-violet-100 dark:border-violet-800/50 rounded-full px-2.5 py-1">{gradCohortLabel(g.cohort)}</span>
                </div>
                <div className="text-[15px] font-bold text-gray-900 dark:text-gray-100">{g.name}</div>
                <div className="text-[12px] text-gray-400 mb-3.5">{g.sector || 'Spin-Out Lab graduate'}</div>
                <div className="tabular-nums text-[19px] font-extrabold tracking-[-.01em]">
                  {raised ? `${raised} raised` : 'Incorporated'}
                </div>
                <div className="text-[12px] text-gray-500 mt-1 leading-[1.4]">
                  {g.last_round ? `Last round: ${g.last_round}` : gradDate ? `Graduated ${gradDate}` : 'Completed the 4-week sprint'}
                </div>
                {g.uid && (
                  <div className="mt-3.5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-1.5 text-[12px] font-semibold text-violet-600 dark:text-violet-400">
                    View profile <span className="text-[13px]" aria-hidden="true">→</span>
                  </div>
                )}
              </>
            );
            const cardClass = 'text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-4 shadow-sm block w-full';
            return g.uid ? (
              <Link
                key={g.uid}
                to={`/startups/${encodeURIComponent(g.uid)}`}
                className={`${cardClass} hover:border-violet-300 hover:shadow-lg dark:hover:border-violet-700 transition-all -translate-y-0 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2`}
              >
                {cardBody}
              </Link>
            ) : (
              <div key={`${g.name}-${i}`} className={cardClass}>
                {cardBody}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Hero stats panel — LIVE data from GET /spinout-lab/stats (public; the
// hero also renders on the logged-out marketing page). Companies built and
// total raised are real; the "28 days" row is the program's promise, not a
// measurement. The raised row always shows: "$0" when there is no funding
// recorded yet (dev has no funding columns; production sums
// projects.total_funding).
export function HeroStatsPanel() {
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
  const companies = loaded ? Number(loaded.companies) || 0 : null;
  const raised = loaded ? (fmtRaised(loaded.total_raised) ?? '$0') : null;

  return (
    <div className="flex flex-col gap-[1px] min-w-[230px] bg-white/10 border border-white/20 rounded-[16px] overflow-hidden">
      <div className="p-4 px-5 flex flex-col gap-0.5">
        <div className="tabular-nums text-[26px] font-extrabold tracking-tight">
          {companies === null ? '—' : `${companies} ${companies === 1 ? 'company' : 'companies'}`}
        </div>
        <div className="text-[12.5px] text-[#a89fce]">Built to date</div>
      </div>
      <div className="p-4 px-5 flex flex-col gap-0.5 border-t border-white/10">
        <div className="tabular-nums text-[26px] font-extrabold tracking-tight">{raised === null ? '—' : raised}</div>
        <div className="text-[12.5px] text-[#a89fce]">Total capital raised by graduates</div>
      </div>
      <div className="p-4 px-5 flex flex-col gap-0.5 border-t border-white/10">
        <div className="tabular-nums text-[26px] font-extrabold tracking-tight">28 days</div>
        <div className="text-[12.5px] text-[#a89fce]">Average time to incorporation</div>
      </div>
    </div>
  );
}

export function CohortTrackerSection() {
  // null = loading, 'error' = fetch failed, [] = no active cohort
  const [members, setMembers] = useState(null);

  useEffect(() => {
    let alive = true;
    spinoutLab
      .cohort()
      .then((r) => {
        if (alive) setMembers(Array.isArray(r) ? r : []);
      })
      .catch((e) => {
        reportError('spinout-lab:cohort', e);
        if (alive) setMembers('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  const list = Array.isArray(members) ? members : [];
  const active = list.filter((m) => m.status === 'active');
  // Subtitle facts are derived from the live members — no invented numbers.
  const cohortLabel = gradCohortLabel(active.find((m) => m.cohort)?.cohort ?? null);
  const earliestStart = active
    .map((m) => parseSqliteUtc(m.started_at))
    .filter(Boolean)
    .sort((a, b) => a - b)[0];

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">Active cohort.</h2>
        {active.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500" style={{ animation: 'wsPulse 2s infinite' }}></span>Live tracker
          </span>
        )}
      </div>
      {active.length > 0 && (
        <p className="m-0 mb-4 text-[13.5px] text-gray-500 tabular-nums">
          {cohortLabel !== 'Alumni' ? `${cohortLabel} · ` : ''}
          {earliestStart ? `Started ${earliestStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · ` : ''}
          {active.length} {active.length === 1 ? 'company' : 'companies'}
        </p>
      )}
      {members === null && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-4 shadow-sm mt-4 animate-pulse" aria-hidden="true">
          <div className="grid grid-cols-5 gap-3.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i}>
                <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 mb-3" />
                <div className="h-16 rounded-xl bg-gray-50 dark:bg-gray-800/50" />
              </div>
            ))}
          </div>
        </div>
      )}
      {members === 'error' && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-6 mt-4 text-[13px] text-gray-500 dark:text-gray-400">
          Couldn't load the cohort tracker right now — please try again later.
        </div>
      )}
      {Array.isArray(members) && members.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-[16px] p-8 mt-4 text-center">
          <div className="text-[14px] font-bold text-gray-700 dark:text-gray-300 mb-1">No cohort in session right now.</div>
          <div className="text-[12.5px] text-gray-500 dark:text-gray-400">
            Companies appear here in real time while their founders run the 4-week sprint.
          </div>
        </div>
      )}
      {Array.isArray(members) && members.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-4 shadow-sm">
          <div className="overflow-x-auto no-scrollbar">
            <div className="grid grid-cols-5 gap-3.5 min-w-[820px]">
              {TRACKER_COLUMNS.map((col) => {
                const cards = list.filter((m) => (m.status === 'graduated' ? 5 : m.week) === col.key);
                return (
                  <div key={col.key}>
                    <div className={`flex items-center justify-between px-1 pb-2.5 border-b-2 mb-3 ${col.accent}`}>
                      <span className="text-[12.5px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">{col.name}</span>
                      <span className="tabular-nums text-[11.5px] font-bold text-gray-400 bg-gray-100 dark:bg-gray-800 dark:text-gray-500 rounded-md px-2 py-0.5">{cards.length}</span>
                    </div>
                    <div className="flex flex-col gap-2.5 min-h-[40px]">
                      {cards.map((m, ci) => {
                        const t = GRAD_AVATAR_THEMES[list.indexOf(m) % GRAD_AVATAR_THEMES.length];
                        return (
                          <div key={`${m.name}-${ci}`} className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-xl p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`w-8 h-8 rounded-lg flex-none font-extrabold text-[12px] flex items-center justify-center ${t.bg} ${t.ink}`}>
                                {gradInitials(m.name)}
                              </div>
                              <div className="min-w-0">
                                <div className="text-[13px] font-bold whitespace-nowrap overflow-hidden text-ellipsis">{m.name}</div>
                                <div className="text-[11px] text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis">{m.sector || 'In the sprint'}</div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={`tabular-nums text-[11px] font-bold rounded-md px-2 py-1 ${col.tint}`}>
                                {m.status === 'graduated' ? (m.day ? `Done in ${m.day}d` : 'Incorporated') : `Day ${m.day}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// LP-facing counterpart to ApplyCtaSection. An investor browsing the program
// is a prospective source of capital, not a cohort applicant, so the call to
// action points at the LP workspace instead of the founder application.
export function LpCtaSection() {
  return (
    <section className="rounded-[20px] p-10 text-center relative overflow-hidden text-white" style={{ background: 'radial-gradient(900px 300px at 85% 120%,rgba(196,181,253,.35),transparent 60%),linear-gradient(115deg,#5b21b6,#7c3aed)' }}>
      <h2 className="m-0 text-[32px] font-black tracking-[-.03em]">Back the graduates.</h2>
      <p className="tabular-nums my-3 mb-6 text-[15px] text-[#e9d5ff]">
        Axal VC Spin-Out Fund I invests exclusively in Lab graduates — underwritten by 28 days of
        observed execution data, not a pitch.
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link to="/spinout-lab/investor-workspace" data-testid="link-lp-workspace" className="h-11 px-5.5 rounded-[11px] bg-white dark:bg-gray-100 text-[#6d28d9] text-[14px] font-bold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-white transition-colors">
          Open LP Workspace <span className="text-[16px]" aria-hidden="true">→</span>
        </Link>
        <a href={LAB_CONTACT_HREF} className="h-11 px-5.5 rounded-[11px] border border-white/40 bg-transparent text-white text-[14px] font-semibold flex items-center hover:bg-white/10 transition-colors">
          Talk to the GP
        </a>
      </div>
      <p className="mt-6 text-[12px] text-[#c4b5fd]">Participation is limited to accredited investors and reviewed individually.</p>
    </section>
  );
}

export function ApplyCtaSection({ applyHref = LAB_APPLY_HREF }) {
  // Resolve the currently-open cohort client-side (mirrors Worker math).
  // Deadline = 7 days before the 1st of the cohort month at 23:59:59 ET.
  // Workspace access is automatically granted at midnight Delaware time on
  // the 1st by the Worker's cohort-timing cron — no client action needed.
  const cohort = useMemo(() => {
    try { return resolveOpenCohort(); } catch { return null; }
  }, []);

  const headline = cohort
    ? `Apply to Cohort ${cohort.cohortNum}.`
    : 'Apply to the next cohort.';

  const deadline = cohort
    ? new Date(cohort.closeMs).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        timeZone: COHORT_TZ,
      })
    : null;

  const sub = deadline
    ? `Applications close ${deadline}. 8 spots available.`
    : 'Applications are now open. 8 spots available.';

  return (
    <section className="rounded-[20px] p-10 text-center relative overflow-hidden text-white" style={{ background: 'radial-gradient(900px 300px at 85% 120%,rgba(196,181,253,.35),transparent 60%),linear-gradient(115deg,#5b21b6,#7c3aed)' }}>
      <h2 className="m-0 text-[32px] font-black tracking-[-.03em]">{headline}</h2>
      <p className="tabular-nums my-3 mb-6 text-[15px] text-[#e9d5ff]">{sub}</p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link to={applyHref} className="h-11 px-5.5 rounded-[11px] bg-white dark:bg-gray-100 text-[#6d28d9] text-[14px] font-bold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-white transition-colors">
          Apply Now <span className="text-[16px]" aria-hidden="true">→</span>
        </Link>
        <a href={LAB_CONTACT_HREF} className="h-11 px-5.5 rounded-[11px] border border-white/40 bg-transparent text-white text-[14px] font-semibold flex items-center hover:bg-white/10 transition-colors">
          Talk to a Program Manager
        </a>
      </div>
      <p className="mt-6 text-[12px] text-[#c4b5fd]">Spin-Out Lab is open to all Axal VC users. Acceptance is selective. No equity taken by Axal VC.</p>
    </section>
  );
}

/**
 * Standing acknowledgement of the founder's own application.
 *
 * `GET /spinout-lab/state` has always returned the founder's latest
 * `spinout_applications` row, and this page has always thrown it away — so a
 * founder who applied on Tuesday came back on Thursday to the same marketing
 * page and the same "Apply Now" button, with nothing anywhere confirming their
 * application exists. Pressing it again is not merely redundant: the apply
 * endpoint 409s a second pending application, so the only feedback the product
 * gave them was an error.
 *
 * Pending REPLACES the apply CTA (re-applying is the thing that 409s).
 * Refused sits ABOVE it, because a refused founder genuinely may re-apply —
 * the insert only guards against a second *pending* row.
 */
export function ApplicationStatusSection({ application }) {
  const status = String(application?.status || '').toLowerCase();
  if (status !== 'pending' && status !== 'refused') return null;

  const submitted = parseSqliteUtc(application.created_at);
  const decided = parseSqliteUtc(application.decided_at);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const pending = status === 'pending';
  const tone = pending
    ? { ring: 'ring-amber-300/70 dark:ring-amber-400/30', chip: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300', dot: 'bg-amber-500' }
    : { ring: 'ring-gray-300/70 dark:ring-gray-600/40', chip: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300', dot: 'bg-gray-400' };

  return (
    <section
      data-testid="application-status"
      data-status={status}
      className={`rounded-[20px] p-8 bg-white dark:bg-gray-800 ring-1 ${tone.ring} shadow-sm`}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`h-2 w-2 rounded-full ${tone.dot}`} aria-hidden="true" />
        <span className={`text-[11px] font-bold uppercase tracking-[.08em] px-2 py-0.5 rounded-full ${tone.chip}`}>
          {pending ? 'In review' : 'Not this cohort'}
        </span>
      </div>

      <h2 className="m-0 text-[24px] font-black tracking-[-.02em] text-gray-900 dark:text-gray-50">
        {pending ? 'Your application is in review.' : 'You weren’t selected for this cohort.'}
      </h2>

      <p className="mt-2.5 text-[14.5px] leading-relaxed text-gray-600 dark:text-gray-300">
        {pending ? (
          <>
            We have your application{application.company_name ? <> for <strong className="font-semibold text-gray-900 dark:text-gray-100">{application.company_name}</strong></> : null}
            {submitted ? <>, submitted {fmt(submitted)}</> : null}. Every application is read by a
            program manager, and you’ll get an email either way — you don’t need to apply again.
          </>
        ) : (
          <>
            {decided ? <>We reviewed your application on {fmt(decided)}. </> : null}
            Cohorts are capped at 8 companies, so strong applications get turned down for space
            alone. You’re welcome to apply again below.
          </>
        )}
      </p>

      {application.cohort ? (
        <p className="mt-4 text-[12.5px] text-gray-500 dark:text-gray-400">
          Applied to <span className="font-semibold text-gray-700 dark:text-gray-200">{application.cohort}</span>
        </p>
      ) : null}

      {pending ? (
        <div className="mt-6 flex gap-3 flex-wrap">
          <a href={LAB_CONTACT_HREF} className="h-10 px-4 rounded-[10px] border border-gray-300 dark:border-gray-600 text-[13.5px] font-semibold text-gray-700 dark:text-gray-200 flex items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            Talk to a Program Manager
          </a>
        </div>
      ) : null}
    </section>
  );
}

// Task #7 — "You're in" celebration for admitted-but-not-started founders.
// Rendered on /spinout-lab (sidebar stays); the CTA calls the existing
// start endpoint and hands over to the workspace Dashboard. Exported for
// the admin journey preview (Task #106), which feeds it simulated props.
export function CongratulationsScreen({ cohort, onStart, starting, startError }) {
  return (
    <div className="min-h-[100dvh] bg-[#F8F8FA] dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100 flex items-center justify-center px-6 py-16">
      <div className="max-w-[620px] w-full text-center">
        <div className="rounded-[24px] p-10 md:p-14 text-white relative overflow-hidden mb-6" style={{ background: 'radial-gradient(1200px 400px at 12% -20%,rgba(139,92,246,.5),transparent 60%),linear-gradient(115deg,#1e1b3a 0%,#2a1d54 55%,#3b1d6e 100%)' }}>
          <div className="relative z-10">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
              <FlaskConical size={30} className="text-violet-300" />
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-[12.5px] font-semibold text-[#ede9fe] mb-4">
              Spin-Out Lab · {cohort || 'Next cohort'}
            </div>
            <h1 className="m-0 text-[40px] leading-[1.05] font-black tracking-[-0.03em] text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(90deg,#fff,#c4b5fd)', WebkitBackgroundClip: 'text' }}>
              Congratulations — you're in.
            </h1>
            <p className="mt-4 mb-8 text-[16px] text-[#cbc4e8] font-medium leading-relaxed">
              You've been admitted to the Spin-Out Lab. Over the next 28 days you'll go
              from idea to incorporated — customer discovery, MVP scope,
              venture-readiness scoring, and Delaware C-Corp formation.
            </p>
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="inline-flex items-center gap-2 bg-white dark:bg-gray-100 text-violet-900 font-bold text-[16px] px-8 py-4 rounded-2xl hover:bg-violet-50 dark:hover:bg-white transition-colors disabled:opacity-60"
            >
              {starting ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
              Start Week 1
            </button>
          </div>
        </div>
        {startError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3 px-4 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400">
            {startError}
          </div>
        )}
        <p className="text-[13px] text-gray-500 dark:text-gray-400">
          Week 1 opens your founder workspace: the 4-week program timeline, your
          deliverables checklist, and every Lab tool as it unlocks.
        </p>
      </div>
    </div>
  );
}

// Exported for the admin journey preview (Task #106). `previewAllUnlocked`
// is preview-only: it swaps phase Lock icons for Unlock (every phase
// browsable) and shows the "All weeks unlocked · N days remaining" badge
// from the workspace design handoff. Founders never receive this prop, so
// real locking rules are untouched.
export function Dashboard({ state, previewAllUnlocked = false, investorView = false }) {
  const week = Math.max(1, Math.min(4, state.week || 1));
  const completedKeys = new Set((state.milestones || []).map((m) => m.key));
  const isIncorporated = completedKeys.has("incorporation_completed");

  // Reference design: Delaware + Wyoming selectable, the rest "Soon".
  // Client-side selection only — incorporation itself is Delaware-first.
  const [jurisdiction, setJurisdiction] = useState('de');
  const juris = labJurisdiction(jurisdiction);

  return (
    <div className="min-h-[100dvh] bg-[#F8F8FA] dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100 flex flex-col">
      <main className="flex-1 w-full max-w-[1080px] mx-auto px-6 py-8 pb-20">
        
        {/* HEADER */}
        <div className="flex flex-wrap gap-5 items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400">
                 <FlaskConical size={20} />
              </div>
              <h1 className="m-0 text-3xl font-extrabold tracking-tight">Spin-Out Lab</h1>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500" style={{animation: 'wsPulse 2s infinite'}}></span>
                {state.cohort || (() => { try { const c = resolveOpenCohort(); return `Cohort ${c.cohortNum}`; } catch { return 'Next Cohort'; } })()} · Applications Open
              </span>
            </div>
            <p className="mt-2.5 ml-[52px] text-[15px] text-gray-500 dark:text-gray-400">From idea to incorporated in 28 days.</p>
          </div>
          <div className="flex gap-2.5 items-center flex-wrap">
            {previewAllUnlocked && (
              <span data-testid="preview-all-weeks-badge" className="h-10 px-3.5 rounded-[10px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-[8px] bg-violet-50 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                  <Unlock size={14} aria-hidden="true" />
                </span>
                <span className="leading-[1.15]">
                  <span className="block text-[13px] font-bold text-gray-800 dark:text-gray-100">All weeks unlocked</span>
                  <span className="block tabular-nums text-[12px] text-gray-500 dark:text-gray-400">{state.days_remaining ?? 0} days remaining</span>
                </span>
              </span>
            )}
            <Link to="/spinout-lab/brief" data-testid="download-program-brief" className="h-10 px-4 rounded-[10px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 text-[13.5px] font-semibold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <FileText size={15} aria-hidden="true" /> Download Program Brief
            </Link>
            <Link to="/spinout-lab/apply" data-testid="apply-next-cohort" className="h-10 px-4 rounded-[10px] bg-violet-600 text-white text-[13.5px] font-semibold flex items-center gap-2 shadow-sm shadow-violet-500/30 hover:bg-violet-700 transition-colors">
              Apply to Next Cohort <span className="text-[15px]" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        {/* JURISDICTION SELECTOR */}
        <JurisdictionBar value={jurisdiction} onChange={setJurisdiction} />

        {/* HERO SECTION */}
        <section className="rounded-[20px] p-[38px] md:p-[40px] mb-10 overflow-hidden relative text-white" style={{ background: 'radial-gradient(1200px 400px at 12% -20%,rgba(139,92,246,.5),transparent 60%),linear-gradient(115deg,#1e1b3a 0%,#2a1d54 55%,#3b1d6e 100%)' }}>
          <div className="flex flex-wrap gap-10 justify-between items-center relative z-10">
            <div className="min-w-[300px] flex-1">
              <div className="tabular-nums text-[76px] leading-[0.9] font-black tracking-[-0.04em] text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(90deg,#fff,#c4b5fd)', WebkitBackgroundClip: 'text' }}>28 days</div>
              <p className="my-3.5 mb-5 text-[16px] text-[#cbc4e8] font-medium">Idea <span className="text-[#8b5cf6]">→</span> {juris.entity} <span className="text-[#8b5cf6]">→</span> Funded</p>
              <div className="flex flex-wrap gap-2">
                {outcomeBadgesFor(jurisdiction).map((b) => (
                  <span key={b} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 border border-white/20 text-[12.5px] font-semibold text-[#ede9fe]">{b}</span>
                ))}
              </div>
            </div>
            <HeroStatsPanel />
          </div>
        </section>

        {/* 28-DAY PIPELINE */}
        <section className="mb-12">
          <div className="flex items-baseline justify-between mb-1.5">
            <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">The 28-day pipeline</h2>
            <span className="text-[12.5px] text-gray-400">4 phases · sequential gates</span>
          </div>
          <p className="m-0 mb-5 text-[13.5px] text-gray-500">Each phase ends at a gate. Companies advance only on completion.</p>

          <div className="flex flex-col lg:flex-row items-stretch gap-3 lg:gap-0">
            {PIPELINE_PHASES.map((p, i) => {
              const isDone = isIncorporated || week > p.backendWeek;
              const isActive = !isDone && week === p.backendWeek;
              const t = PHASE_THEMES[p.color];
              
              const statusIcon = isDone ? <Check size={14} strokeWidth={3} className="text-white" aria-hidden="true" /> : isActive ? <Circle size={14} fill="currentColor" stroke="none" style={{ animation: "wsPulse 2s infinite" }} className={t.ink} aria-hidden="true" /> : previewAllUnlocked ? <Unlock size={14} className="text-gray-400" aria-hidden="true" /> : <Lock size={14} className="text-gray-400" aria-hidden="true" />;
              
              return (
                <div key={i} className="flex items-stretch flex-1 min-w-0">
                  <div className={`flex-1 min-w-0 rounded-[16px] p-[18px] flex flex-col transition-all border ${t.bg} ${t.border} ${isActive ? `ring-2 ring-offset-2 dark:ring-offset-gray-950 shadow-lg ${t.ring}` : ''}`}>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-[30px] h-[30px] flex-none rounded-[9px] font-extrabold text-[14px] flex items-center justify-center ${t.chip} ${t.ink}`}>{i + 1}</div>
                        <div className="text-[15px] font-extrabold tracking-[-.01em]">{p.name}</div>
                      </div>
                      <span className={`w-[24px] h-[24px] flex-none flex items-center justify-center ${isDone ? 'rounded-full' : ''}`} style={isDone ? { background: t.fill } : {}}>
                        {statusIcon}
                      </span>
                    </div>
                    <span className={`tabular-nums self-start whitespace-nowrap px-[9px] py-[3px] rounded-[7px] text-[11px] font-bold mb-[13px] ${t.chip} ${t.ink}`}>
                      {p.days}
                    </span>
                    <ul className="m-0 p-0 list-none flex flex-col gap-2">
                      {pipelineItemsFor(p, jurisdiction).map((d) => (
                        <li key={d} className="flex gap-2 text-[12.5px] leading-[1.35] text-gray-700 dark:text-gray-300">
                          <span className={`flex-none font-bold ${t.ink}`} aria-hidden="true">·</span>
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {i < PIPELINE_PHASES.length - 1 && (
                    <div className="w-[26px] flex-none hidden lg:flex items-center justify-center text-violet-300 dark:text-violet-800">
                      <ArrowRight size={18} aria-hidden="true" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Sprint-progress widgets (gate checklist + Demo Day deck card)
              were removed at the user's request. Milestones still
              auto-complete from real product actions (lib/spinoutLabHooks.js);
              deck readiness lives on the deck builder itself. */}
          <p className="mt-4 mb-0 text-[12.5px] text-gray-400 flex items-center gap-2">
            <BadgeCheck size={16} className="flex-none text-violet-500" aria-hidden="true" />
            All Spin-Out Lab graduates receive a verified "Spin-Out Lab Alumni" badge on their Axal VC founder profile.
          </p>
        </section>

        {/* WHAT YOU LEAVE WITH */}
        <section className="mb-12">
          <h2 className="m-0 mb-5 text-[20px] font-extrabold tracking-[-.02em]">What you leave with.</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
            {deliverablesFor(jurisdiction).map((d, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[16px] p-5 shadow-sm">
                <div className="w-10 h-10 rounded-[11px] bg-violet-50 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center mb-3.5">
                  {d.icon}
                </div>
                <div className="text-[14.5px] font-bold mb-1.5">{d.name}</div>
                <div className="text-[12.7px] leading-[1.45] text-gray-500 dark:text-gray-400">{d.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ACTIVE COHORT TRACKER — live data */}
        <CohortTrackerSection />

        {/* GRADUATE COMPANIES */}
        <GraduatesSection />

        {/* APPLICATION CTA — investors get the LP route, not the founder one.
            POST /spinout-lab/apply hard-403s any role outside founder/exploring
            (spinout_lab.ts), so showing "Apply Now" to an investor would be a
            dead end.

            An investor's own /spinout-lab now resolves to the LP & Investor
            Workspace before this page is ever mounted (see the route in
            App.jsx), so in normal navigation this branch does not fire. It
            stays because the rule it encodes — never offer a cohort
            application to someone whose role the apply endpoint refuses — is a
            property of THIS page, and should hold for anything that renders it
            directly rather than depending on the router getting it right. */}
        {investorView ? <LpCtaSection /> : (
          <>
            {/* A founder mid-review gets their own status instead of a button
                that 409s. Refused founders get BOTH — the acknowledgement and
                the CTA — because only a *pending* row blocks re-application. */}
            <ApplicationStatusSection application={state?.application} />
            {String(state?.application?.status || '').toLowerCase() === 'pending'
              ? null
              : <ApplyCtaSection applyHref="/spinout-lab/apply" />}
          </>
        )}

      </main>
    </div>
  );
}

export default function SpinoutLabPage() {
  const { user, refresh } = useAuth();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const next = await spinoutLab.state();
      setState(next);
    } catch (e) {
      // A failed /state fetch (backend restart, rate limit) must NOT
      // silently render the wrong page for an active founder — surface an
      // explicit retry instead.
      setLoadError(true);
      reportError("spinout-lab:state", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user, load]);

  useEffect(() => {
    const onAdvanced = () => {
      load();
    };
    window.addEventListener("spinout-lab:advanced", onAdvanced);
    return () => window.removeEventListener("spinout-lab:advanced", onAdvanced);
  }, [load]);

  if (!user) return <SpinoutLabMarketingPage />;

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading your sprint…
      </div>
    );
  }

  // Task #7 — admitted-but-not-started founders see the "You're in"
  // celebration; Start Week 1 flips the lab on via the existing endpoint.
  if (state && !state.active && state.admitted && !state.is_incorporated) {
    const onStart = async () => {
      setStarting(true);
      setStartError("");
      try {
        const next = await spinoutLab.start();
        setState(next);
        try { await refresh({ force: true }); } catch { /* no-op */ }
      } catch (e) {
        setStartError(e?.message || "Could not start the Lab — please try again");
        reportError("spinout-lab:start", e);
      } finally {
        setStarting(false);
      }
    };
    return (
      <CongratulationsScreen
        cohort={state.cohort}
        onStart={onStart}
        starting={starting}
        startError={startError}
      />
    );
  }

  const isAdmin = user?.role === 'admin';

  // Active (or graduated) founders get the real workspace: week timeline,
  // deliverables checklist, and the unlocked-tools grid, all at /spinout-lab.
  // Admins always get previewAllUnlocked so every week and tool is accessible
  // for product review, regardless of milestone progress.
  if (state && (state.active || state.is_incorporated)) {
    return <SpinoutLabWorkspace state={state} previewAllUnlocked={isAdmin} />;
  }

  // Admins without an active enrollment still need to review the workspace.
  // Synthesise a minimal Week 1 state so the workspace renders fully unlocked.
  if (isAdmin) {
    const adminPreviewState = { active: true, week: 1, days_remaining: 28, milestones: [], unlocked_features: [] };
    return <SpinoutLabWorkspace state={adminPreviewState} previewAllUnlocked />;
  }

  // If we couldn't load state at all, don't guess — the program overview
  // would look like "no access" to an active founder. Offer a retry.
  if (!state && loadError) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-center px-6">
        <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="text-spinout-state-error">
          We couldn't load your Spin-Out Lab status. This is usually temporary.
        </p>
        <button
          type="button"
          data-testid="button-retry-spinout-state"
          onClick={() => { setLoading(true); load(); }}
          className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
        >
          Try again
        </button>
      </div>
    );
  }

  // Everyone else (not applied / application pending) sees the program
  // overview with the Apply CTA — except investors, whose route into the
  // program is the LP fund, not a cohort application.
  return <Dashboard state={state || {}} investorView={user?.role === 'investor'} />;
}
