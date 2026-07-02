/**
 * Task #2 (AR) — Promoted Question schema + canonical bank registry.
 *
 * Each persona bank lives in `./banks/<name>.ts`; this module is the
 * single registry that the advisor route + write-router consume.
 *
 * Promoted Question shape:
 *   - id              — opaque key persisted in advisor_answers
 *   - persona         — primary persona enum
 *   - persona_filter? — additional personas allowed to see this Q
 *   - section?        — bucket label (e.g. BUILD/CAPITAL/LEGAL/NETWORK)
 *   - prompt          — natural-language question
 *   - hint?           — short helper text
 *   - input_kind      — 'short'|'long'|'number'|'select'|'multi'
 *   - options?        — required for select / multi
 *   - skip_allowed?   — defaults true
 *   - sensitive?      — never echo to LLM
 *   - importance?     — 'critical'|'high'|'normal'|'low'
 *   - page_target?    — route the answer's data lives on
 *   - doc_anchor?     — docs/ section to deep-link from "Read more"
 *   - tier_required?  — billing tier needed to write
 *   - unlock_required?— { week?, milestones? } gating for spin-out lab
 *   - followups?      — IDs to surface immediately after this Q
 *   - validate?       — client-side validator name
 */

export type Persona = 'founder' | 'investor' | 'mentor' | 'partner' | 'admin' | 'unknown';
export type Importance = 'critical' | 'high' | 'normal' | 'low';
export type ValidateKind =
  | 'short' | 'long' | 'number' | 'select' | 'multi'
  | 'csv' | 'url' | 'email' | 'hex_color' | 'scale';

export interface UnlockRequirement {
  week?: number;          // minimum spinout_lab_week
  milestones?: string[];  // milestone keys that must all be completed
}

// Task #5 (CH) — Market Intelligence section tags. Every MI section
// in the dashboard must have ≥3 source questions across personas so
// the CE extractor (Task #?) has enough signal. Add tags freely; the
// drift CI script asserts coverage.
export type MISection =
  | 'sentiment'           // founder/operator mood, NPS-like signals
  | 'talc'                // tech-adoption-life-cycle stage of buyers
  | 'demand_supply'       // pipeline volume + supplier capacity
  | 'fit'                 // ICP / persona alignment
  | 'partner_pulse'       // partner engagement health
  | 'capital_velocity'    // round timing, deployment pace
  | 'sector_heat'         // which sectors are warming/cooling
  | 'sentiment_geo'       // geographic sentiment skew
  | 'investor_signals';   // thesis shifts, ticket-band moves

// Task #5 (CH) — operating-partner sub-types so the bank can split
// into 4 streams (each ≥50) without proliferating top-level banks.
// 'investor' is its own persona, so it isn't a partner sub-type.
export type PartnerSubtype =
  | 'service_provider'    // legal, accounting, design, PR, recruiting
  | 'mentor_advisor'      // formal advisor seats, EIRs, fractional
  | 'strategic'           // corporate / channel / distribution partner
  | 'corporate_venture';  // CVC investment + commercial bundle

// Task #19 — Best-Fit. Fit-question personas. Distinct from the advisor
// `Persona` enum: it adds 'coach' (no advisor role) and drops admin/unknown.
// Fit questions carry id `fit.<FitPersona>.<key>`; fitMeasuresIndex() derives
// the persona from that id prefix (NOT from Question.persona) so a coach fit
// bank can ride inside the mentor conversation without touching `Persona`.
export type FitPersona = 'founder' | 'investor' | 'partner' | 'mentor' | 'coach';

// Task #19 — what a fit question measures. Tagged on each `fit.*` question and
// consumed by services/axalFit.ts (rubric_category → RUBRICS) + the write-router
// (skill_axis → user_skills, value_dim → user_values, axal_value → axal_values).
// `red_flag` fires when the answer's 0..5 score is at or below `at_or_below`.
export interface FitMeasures {
  rubric_category?: string;   // a key in axalFit RUBRICS[persona]
  skill_axis?: string;        // RADAR_AXES slug → user_skills
  value_dim?: string;         // value_dimensions slug → user_values
  axal_value?: string;        // one of axalFit AXAL_VALUES → axal_values
  red_flag?: { key: string; at_or_below: number };
}

export interface Question {
  id: string;
  persona: Persona;
  persona_filter?: Persona[];
  section?: string;
  prompt: string;
  hint?: string;
  input_kind: 'short' | 'long' | 'number' | 'select' | 'multi' | 'scale';
  options?: string[];
  skip_allowed?: boolean;
  sensitive?: boolean;
  importance?: Importance;
  page_target?: string;
  doc_anchor?: string;
  tier_required?: string;
  unlock_required?: UnlockRequirement;
  followups?: string[];
  validate?: ValidateKind;
  // Task #3 (AS) — when true, the writeRouter requires the caller
  // (LLM tool or UI) to attach an `evidence` string before the
  // answer is persisted. Surfaces in publicQuestion + on the
  // /answer rejection envelope when the gate fails.
  requires_evidence?: boolean;
  // Task #5 (CH) — MI extractor tag. The CE extractor (downstream
  // task) groups answers by mi_section to compute dashboard signals.
  mi_section?: MISection;
  // Task #5 (CH) — operating-partner sub-type. Only meaningful on
  // OPERATING_PARTNER_BANK rows; ignored elsewhere.
  partner_subtype?: PartnerSubtype;
  // Task #5 (CH) — sentiment / TALC eligibility flags so the CE
  // extractor + scoring layer can pick eligible answers without
  // re-classifying every question by id pattern.
  sentiment_eligible?: boolean;
  talc_eligible?: boolean;
  // Task #19 — Best-Fit. Present only on `fit.*` questions; tags what the 0..5
  // answer measures so axalFit + the write-router can route + score it.
  measures?: FitMeasures;
}

// Task #5 (CH) — per-persona size targets enforced by the drift CI
// script. Authored from the spec so changes flow through CI.
export const BANK_SIZE_TARGETS = {
  newFounderSpinout: 80,
  existingFounder: 120,
  investor: 60,
  mentor: 30,
  admin: 10,
  operatingPartnerPerSubtype: 50, // ×4 sub-types = 200 total
  // Task #19 — Best-Fit conversational banks. Documentation-only minimums
  // (not enforced by scripts/check-advisor-bank-drift.mjs, which scans only the
  // 6 manifest banks). Each must cover its full axalFit RUBRIC + the 5 Axal values.
  fitFounder: 25,
  fitInvestor: 18,
  fitPartner: 17,
  fitMentor: 17,
  fitCoach: 17,
} as const;

// ---------------------------------------------------------------------------
// Role detector — surfaced when users.role is null.
// ---------------------------------------------------------------------------
export const ROLE_DETECTOR: Question[] = [
  {
    id: 'role_detect.primary',
    persona: 'unknown',
    section: 'ROLE',
    prompt: "Welcome to Axal. Which best describes how you'll use StudioOS?",
    hint: 'You can change this any time in Settings.',
    input_kind: 'select',
    options: ['I am building a startup', 'I invest in startups', 'I mentor founders', 'I partner with the studio'],
    skip_allowed: false,
    importance: 'critical',
    page_target: '/onboarding/persona',
    doc_anchor: 'getting-started/personas',
    validate: 'select',
  },
  {
    id: 'role_detect.organization',
    persona: 'unknown',
    section: 'ROLE',
    prompt: 'What firm or organization are you with? (Type "Independent" if none.)',
    input_kind: 'short', skip_allowed: true,
    importance: 'normal', page_target: '/settings',
    doc_anchor: 'getting-started/personas', validate: 'short',
  },
  {
    id: 'role_detect.headline',
    persona: 'unknown',
    section: 'ROLE',
    prompt: 'In one line, what are you working on or known for right now?',
    input_kind: 'short', skip_allowed: true,
    importance: 'normal', page_target: '/settings',
    doc_anchor: 'getting-started/personas', validate: 'short',
  },
];

export function mapRoleAnswer(answerText: string): Persona | null {
  const t = answerText.toLowerCase();
  if (t.includes('build')) return 'founder';
  if (t.includes('invest')) return 'investor';
  if (t.includes('mentor')) return 'mentor';
  if (t.includes('partner')) return 'partner';
  return null;
}

// ---------------------------------------------------------------------------
// Bank registry — imports the canonical TS modules under ./banks/.
// ---------------------------------------------------------------------------
import { NEW_FOUNDER_SPINOUT_BANK } from './banks/newFounderSpinout.ts';
import { EXISTING_FOUNDER_BANK } from './banks/existingFounder.ts';
import { INVESTOR_BANK } from './banks/investor.ts';
import { OPERATING_PARTNER_BANK } from './banks/operatingPartner.ts';
import { MENTOR_BANK } from './banks/mentor.ts';
import { ADMIN_BANK } from './banks/admin.ts';
// Task #19 — Best-Fit fit banks. Registered here so bankFor/questionById/
// fitMeasuresIndex see them, but kept OUT of banks.manifest.json (fit answers
// are routed by a generic fit.* branch in writeRouter, not per-id).
import { FIT_FOUNDER_BANK } from './banks/fit_founder.ts';
import { FIT_INVESTOR_BANK } from './banks/fit_investor.ts';
import { FIT_PARTNER_BANK } from './banks/fit_partner.ts';
import { FIT_MENTOR_BANK } from './banks/fit_mentor.ts';
import { FIT_COACH_BANK } from './banks/fit_coach.ts';

export type BankName =
  | 'newFounderSpinout' | 'existingFounder'
  | 'investor' | 'operatingPartner' | 'mentor' | 'admin'
  | 'fitFounder' | 'fitInvestor' | 'fitPartner' | 'fitMentor' | 'fitCoach';

export const BANKS: Record<BankName, Question[]> = {
  newFounderSpinout: NEW_FOUNDER_SPINOUT_BANK,
  existingFounder:   EXISTING_FOUNDER_BANK,
  investor:          INVESTOR_BANK,
  operatingPartner:  OPERATING_PARTNER_BANK,
  mentor:            MENTOR_BANK,
  admin:             ADMIN_BANK,
  fitFounder:        FIT_FOUNDER_BANK,
  fitInvestor:       FIT_INVESTOR_BANK,
  fitPartner:        FIT_PARTNER_BANK,
  fitMentor:         FIT_MENTOR_BANK,
  fitCoach:          FIT_COACH_BANK,
};

export function bankByName(name: BankName): Question[] {
  return BANKS[name] || [];
}

/**
 * Pick the canonical bank for a persona. Founders split into the
 * Spin-Out Lab bank when `spinout_lab_active === 1`, else the
 * existing-founder bank.
 */
export function bankFor(persona: Persona, ctx?: { spinoutLabActive?: boolean }): Question[] {
  switch (persona) {
    // Task #19 — append the persona's Best-Fit bank so the conversational
    // profiling questions are delivered inline (importance:'low' → trailing).
    // Mentor carries both mentor + coach fit banks (coach has no advisor role).
    case 'founder':  return [...(ctx?.spinoutLabActive ? BANKS.newFounderSpinout : BANKS.existingFounder), ...BANKS.fitFounder];
    case 'investor': return [...BANKS.investor, ...BANKS.fitInvestor];
    case 'partner':  return [...BANKS.operatingPartner, ...BANKS.fitPartner];
    case 'mentor':   return [...BANKS.mentor, ...BANKS.fitMentor, ...BANKS.fitCoach];
    case 'admin':    return BANKS.admin;
    default:         return [];
  }
}

// ---------------------------------------------------------------------------
// Task #19 — Best-Fit. Flat index of every fit question's measures across all
// banks, keyed by the FitPersona parsed from its `fit.<persona>.<key>` id.
// services/axalFit.ts consumes this to aggregate rubric categories + red-flag
// probes; the write-router consumes per-question measures to route answers.
// Returns [] until the fit_* banks are registered in BANKS (WS2).
// ---------------------------------------------------------------------------
export const FIT_ID_RE = /^fit\.(founder|investor|partner|mentor|coach)\./;

export interface FitMeasureEntry {
  question_id: string;
  persona: FitPersona;
  measures: FitMeasures;
}

export function fitMeasuresIndex(): FitMeasureEntry[] {
  const out: FitMeasureEntry[] = [];
  for (const bank of Object.values(BANKS)) {
    for (const q of bank) {
      if (!q.measures) continue;
      const m = FIT_ID_RE.exec(q.id);
      if (!m) continue;
      out.push({ question_id: q.id, persona: m[1] as FitPersona, measures: q.measures });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Task #12 (BLOCK-ADV-07) — dynamic reflection questions.
//
// When a persona bank is exhausted the state machine generates an
// open-ended `dyn.reflect.N` question (see stateMachine.ts::
// generateDynamicQuestion). These ids are NOT in any bank or the
// manifest, so `questionById` synthesises a generic Question for them
// — needed so the /answer + /skip round-trip and the conversation
// history renderer recognise the id instead of 400-ing on it. The
// regex is deliberately STRICT (`dyn.reflect.<digits>`) so callers
// can't smuggle arbitrary keys into `users.advisor_extras_json` via a
// fabricated `dyn.*` id.
// ---------------------------------------------------------------------------
export const DYNAMIC_ID_RE = /^dyn\.reflect\.\d{1,4}$/;

export function synthesizeDynamicQuestion(id: string): Question | null {
  if (!DYNAMIC_ID_RE.test(id)) return null;
  return {
    id,
    persona: 'unknown',
    section: 'REFLECT',
    prompt: 'Anything else on your mind right now?',
    input_kind: 'long',
    importance: 'low',
    page_target: undefined,
    doc_anchor: 'getting-started/personas',
    validate: 'long',
    skip_allowed: true,
  };
}

/**
 * Lookup any question by id across every bank + the role detector.
 * Synthesises a generic Question for dynamic `dyn.reflect.N` ids.
 */
export function questionById(id: string): Question | null {
  for (const name of Object.keys(BANKS) as BankName[]) {
    const hit = BANKS[name].find((q) => q.id === id);
    if (hit) return hit;
  }
  const detector = ROLE_DETECTOR.find((q) => q.id === id);
  if (detector) return detector;
  return synthesizeDynamicQuestion(id);
}

// ---------------------------------------------------------------------------
// Filtering — applies week + tier + unlock + persona_filter + section focus.
// Returns { visible, deferred } so the route can surface "not yet" hints.
// ---------------------------------------------------------------------------
export interface FilterContext {
  persona: Persona;
  week?: number;                  // user's current spinout_lab_week (1..4)
  tiers?: Set<string>;            // active billing tiers (e.g. 'investor_pro')
  completedMilestones?: Set<string>;
  focusSection?: string;          // pin to one section
  focusPage?: string;             // pin to one page_target (e.g. '/build/discovery')
}

export interface DeferredQuestion {
  question: Question;
  reason: 'week' | 'milestones' | 'tier' | 'persona_filter';
  detail?: string;                // human-readable explainer
}

export interface FilteredBank {
  visible: Question[];
  deferred: DeferredQuestion[];
}

export function filterByContext(bank: Question[], ctx: FilterContext): FilteredBank {
  const visible: Question[] = [];
  const deferred: DeferredQuestion[] = [];
  const tiers = ctx.tiers ?? new Set<string>();
  const completed = ctx.completedMilestones ?? new Set<string>();

  for (const q of bank) {
    // persona_filter — absent means "primary persona only"; present
    // means an explicit allow-list.
    if (q.persona_filter && q.persona_filter.length > 0 && !q.persona_filter.includes(ctx.persona)) {
      deferred.push({ question: q, reason: 'persona_filter' });
      continue;
    }
    // focus pin — supports either section (BUILD/CAPITAL/…) or
    // page_target (`/build/discovery`). When set we silently exclude
    // off-focus questions from BOTH visible and deferred so the
    // /next-question?focus= envelope only contains in-focus rows.
    if (ctx.focusSection && q.section && q.section !== ctx.focusSection) continue;
    if (ctx.focusPage && q.page_target && q.page_target !== ctx.focusPage) continue;

    // week gate
    const u = q.unlock_required;
    if (u?.week && (ctx.week ?? 0) < u.week) {
      deferred.push({ question: q, reason: 'week', detail: `Unlocks in Spin-Out Week ${u.week}.` });
      continue;
    }
    // milestones gate
    if (u?.milestones && u.milestones.length > 0) {
      const missing = u.milestones.filter((m) => !completed.has(m));
      if (missing.length > 0) {
        deferred.push({
          question: q,
          reason: 'milestones',
          detail: `Complete first: ${missing.join(', ')}.`,
        });
        continue;
      }
    }
    // tier gate — Task #2 (AR) hides tier-locked questions entirely
    // from the served bank. They appear only in the manifest's
    // `deferred` list so the upgrade CTA can render with copy, but
    // /next-question / /answer / /skip / /progress treat them as
    // not present until the user upgrades.
    if (q.tier_required && !tiers.has(q.tier_required)) {
      deferred.push({ question: q, reason: 'tier', detail: `Requires ${q.tier_required}.` });
      continue;
    }
    visible.push(q);
  }
  return { visible, deferred };
}

/**
 * Group a bank by `page_target` for the per-page progress rail.
 */
export function groupByPage(bank: Question[]): Array<{ page: string; doc_anchor?: string; ids: string[] }> {
  const groups = new Map<string, { page: string; doc_anchor?: string; ids: string[] }>();
  for (const q of bank) {
    if (!q.page_target) continue;
    let g = groups.get(q.page_target);
    if (!g) { g = { page: q.page_target, doc_anchor: q.doc_anchor, ids: [] }; groups.set(q.page_target, g); }
    g.ids.push(q.id);
  }
  return Array.from(groups.values()).sort((a, b) => a.page.localeCompare(b.page));
}

/**
 * Group a bank by `section` for section-level progress.
 */
export function groupBySection(bank: Question[]): Array<{ section: string; ids: string[] }> {
  const groups = new Map<string, { section: string; ids: string[] }>();
  for (const q of bank) {
    const s = q.section || 'OTHER';
    let g = groups.get(s);
    if (!g) { g = { section: s, ids: [] }; groups.set(s, g); }
    g.ids.push(q.id);
  }
  return Array.from(groups.values()).sort((a, b) => a.section.localeCompare(b.section));
}

// ---------------------------------------------------------------------------
// Profiling completion — the "Your Profile & Fit" dimensions ONLY.
//
// The dashboard-population bank (existingFounder ~120, operatingPartner ~200,
// …) exists to fill EVERY page's data, so counting it as "profiling completion"
// on the Profile & Fit card produced the wrong "200+ questions" figure. The
// four Profile & Fit dimensions are driven exclusively by the conversational
// `fit.*` banks (17–34 questions/persona). This helper buckets those fit
// questions into the sections the Profile & Fit UI actually renders so the
// completion card can report a true per-section count.
//
// Each fit question is assigned to exactly ONE section (no double-counting) by
// priority: skill_axis → Skills, value_dim → Work values, everything else
// (rubric_category / axal_value / red-flag probes) → Axal Fit & values.
// Archetype is a separate assessment-game flow and is reported independently.
// ---------------------------------------------------------------------------
export type ProfilingSectionKey = 'skills' | 'values' | 'axal_fit';

export const PROFILING_SECTIONS: Array<{ key: ProfilingSectionKey; label: string }> = [
  { key: 'skills', label: 'Skills' },
  { key: 'values', label: 'Work values' },
  { key: 'axal_fit', label: 'Axal Fit & values' },
];

/** The Profile & Fit section a single fit.* question feeds. */
export function profilingSectionFor(q: Question): ProfilingSectionKey | null {
  if (!FIT_ID_RE.test(q.id)) return null;
  const m = q.measures;
  if (m?.skill_axis) return 'skills';
  if (m?.value_dim) return 'values';
  return 'axal_fit'; // rubric_category, axal_value, or a bare red-flag probe
}

export interface ProfilingSectionGroup {
  key: ProfilingSectionKey;
  label: string;
  ids: string[];
}

/**
 * Group a working bank's fit.* questions into the Profile & Fit sections.
 * Returns every section (even empty ones) in display order so the completion
 * card renders a stable layout. Non-fit dashboard questions are ignored.
 */
export function profilingSectionsForBank(bank: Question[]): ProfilingSectionGroup[] {
  const byKey = new Map<ProfilingSectionKey, string[]>();
  for (const s of PROFILING_SECTIONS) byKey.set(s.key, []);
  for (const q of bank) {
    const key = profilingSectionFor(q);
    if (!key) continue;
    byKey.get(key)!.push(q.id);
  }
  return PROFILING_SECTIONS.map((s) => ({ key: s.key, label: s.label, ids: byKey.get(s.key)! }));
}

/**
 * Sort questions critical-first within their section, preserving
 * original order otherwise.
 */
const IMPORTANCE_RANK: Record<Importance, number> = { critical: 0, high: 1, normal: 2, low: 3 };
export function sortByImportance(bank: Question[]): Question[] {
  return bank.slice().sort((a, b) => {
    const sa = a.section || ''; const sb = b.section || '';
    if (sa !== sb) return sa.localeCompare(sb);
    const ia = IMPORTANCE_RANK[a.importance ?? 'normal'];
    const ib = IMPORTANCE_RANK[b.importance ?? 'normal'];
    return ia - ib;
  });
}
