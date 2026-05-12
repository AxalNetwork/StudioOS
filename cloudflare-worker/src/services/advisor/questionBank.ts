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
  | 'csv' | 'url' | 'email' | 'hex_color';

export interface UnlockRequirement {
  week?: number;          // minimum spinout_lab_week
  milestones?: string[];  // milestone keys that must all be completed
}

export interface Question {
  id: string;
  persona: Persona;
  persona_filter?: Persona[];
  section?: string;
  prompt: string;
  hint?: string;
  input_kind: 'short' | 'long' | 'number' | 'select' | 'multi';
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
}

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
import { NEW_FOUNDER_SPINOUT_BANK } from './banks/newFounderSpinout';
import { EXISTING_FOUNDER_BANK } from './banks/existingFounder';
import { INVESTOR_BANK } from './banks/investor';
import { OPERATING_PARTNER_BANK } from './banks/operatingPartner';
import { MENTOR_BANK } from './banks/mentor';

export type BankName =
  | 'newFounderSpinout' | 'existingFounder'
  | 'investor' | 'operatingPartner' | 'mentor' | 'admin';

const ADMIN_BANK: Question[] = [
  { id: 'admin.preferences.digest_freq', persona: 'admin', section: 'PREFS',
    prompt: 'How often do you want the daily-digest summary?',
    input_kind: 'select', options: ['Daily', 'Weekly', 'Off'],
    importance: 'normal', page_target: '/settings',
    doc_anchor: 'getting-started/personas', validate: 'select' },
];

export const BANKS: Record<BankName, Question[]> = {
  newFounderSpinout: NEW_FOUNDER_SPINOUT_BANK,
  existingFounder:   EXISTING_FOUNDER_BANK,
  investor:          INVESTOR_BANK,
  operatingPartner:  OPERATING_PARTNER_BANK,
  mentor:            MENTOR_BANK,
  admin:             ADMIN_BANK,
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
    case 'founder':  return ctx?.spinoutLabActive ? BANKS.newFounderSpinout : BANKS.existingFounder;
    case 'investor': return BANKS.investor;
    case 'partner':  return BANKS.operatingPartner;
    case 'mentor':   return BANKS.mentor;
    case 'admin':    return BANKS.admin;
    default:         return [];
  }
}

/**
 * Lookup any question by id across every bank + the role detector.
 */
export function questionById(id: string): Question | null {
  for (const name of Object.keys(BANKS) as BankName[]) {
    const hit = BANKS[name].find((q) => q.id === id);
    if (hit) return hit;
  }
  return ROLE_DETECTOR.find((q) => q.id === id) || null;
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
