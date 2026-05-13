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
    requiredAny: ['mentor_meeting_booked', 'cofounder_request_sent'],
    unlockedFeatures: [
      'cofounder-match',
      'mentors',
      'office-hours',
      'scoring',
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
      'kyc',
    ],
  },
];

export const VALID_MILESTONE_KEYS = new Set<string>(
  MILESTONES.flatMap((w) => [...w.requiredAll, ...(w.requiredAny ?? [])]),
);

export function weekForKey(key: string): number | null {
  for (const w of MILESTONES) {
    if (w.requiredAll.includes(key) || (w.requiredAny ?? []).includes(key)) {
      return w.week;
    }
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
