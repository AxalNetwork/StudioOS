/**
 * Pure Spin-Out Lab milestone catalog — extracted from
 * `routes/spinout_lab.ts` so it can be imported by modules (notably
 * `services/advisor/stateMachine.ts`) without dragging in Hono, the
 * DB binding, and the auth stack. The route file re-exports these
 * symbols so consumers there continue to work unchanged.
 *
 * Single source of truth — never duplicate the catalog literals
 * elsewhere.
 */
export type WeekDef = {
  week: 1 | 2 | 3 | 4;
  requiredAll: string[];
  requiredAny?: string[];
  unlockedFeatures: string[];
};

export const MILESTONES: WeekDef[] = [
  {
    week: 1,
    requiredAll: [
      'project_created',
      'customer_interview_logged_1',
      'customer_interview_logged_2',
      'customer_interview_logged_3',
    ],
    unlockedFeatures: [
      'spinout-lab',
      'projects',
      'customer-discovery',
      'market-intelligence',
      'profiling',
    ],
  },
  {
    week: 2,
    requiredAll: ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'],
    unlockedFeatures: ['roadmap', 'brand-builder', 'pitch-deck'],
  },
  {
    week: 3,
    requiredAll: ['scoring_run_completed'],
    requiredAny: ['advisor_meeting_booked', 'cofounder_request_sent'],
    unlockedFeatures: [
      'cofounder-match',
      'advisors',
      'office-hours',
      'scoring',
      'revenue',
    ],
  },
  {
    week: 4,
    requiredAll: ['incorporation_completed'],
    unlockedFeatures: [
      'incorporate',
      'captable',
      'section-83b',
      'cofounder-agreement',
      'capital',
      'compliance',
      'use-of-funds',
    ],
  },
];

/**
 * Deliverable-only milestones: recorded per user like gating milestones and
 * surfaced on the workspace checklist, but NOT part of the week-advance gate
 * (`weekMet` ignores them). Fired by the owning module on real completion
 * events. Mirror of OPTIONAL_MILESTONES in backend/app/api/routes/spinout_lab.py.
 */
export const OPTIONAL_MILESTONES: Record<number, string[]> = {
  1: [
    'customer_interview_logged_4',
    'customer_interview_logged_5',
    'market_sizing_completed',
    'profiling_completed',
    'icp_defined',
    'market_research_shared',
  ],
  2: [
    'mvp_scoped',
    'landing_page_created',
    'studio_ops_cadence_set',
    'discovery_followups_mapped',
  ],
  3: [
    'office_hours_booked',
    'revenue_proof_added',
    'revenue_summary_generated',
    'scoring_confidence_70',
  ],
  4: [
    'ein_received',
    'founder_stock_issued',
    'section83b_filed',
    'cofounder_agreement_signed',
    'fundraise_ask_locked',
    'use_of_funds_filled',
    'investor_intros_secured',
    'captable_locked',
    'data_room_built',
  ],
};

export const VALID_MILESTONE_KEYS = new Set<string>([
  ...MILESTONES.flatMap((w) => [...w.requiredAll, ...(w.requiredAny ?? [])]),
  ...Object.values(OPTIONAL_MILESTONES).flat(),
]);

export function weekForKey(key: string): number | null {
  for (const w of MILESTONES) {
    if (w.requiredAll.includes(key) || (w.requiredAny ?? []).includes(key)) {
      return w.week;
    }
  }
  for (const [week, keys] of Object.entries(OPTIONAL_MILESTONES)) {
    if (keys.includes(key)) return Number(week);
  }
  return null;
}

/**
 * Pure: returns true iff every requirement for `week` is in `completed`.
 */
export function weekMet(week: number, completed: Set<string>): boolean {
  const def = MILESTONES.find((w) => w.week === week);
  if (!def) return false;
  if (!def.requiredAll.every((k) => completed.has(k))) return false;
  if (def.requiredAny && def.requiredAny.length > 0) {
    if (!def.requiredAny.some((k) => completed.has(k))) return false;
  }
  return true;
}

/** Cumulative unlocked features through `currentWeek` (inclusive). */
export function unlockedFeaturesThrough(currentWeek: number): string[] {
  const out: string[] = [];
  for (const w of MILESTONES) {
    if (w.week <= currentWeek) out.push(...w.unlockedFeatures);
  }
  return out;
}
