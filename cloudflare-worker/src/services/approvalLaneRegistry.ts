/**
 * D5879 (#5879, part 6 of #4716) — every approval lane's facts, written once.
 *
 * Before this file a lane's facts lived in four places that could drift:
 * - its label, who a decision notifies and the page that decides it, in
 *   `approvalSources.ts` and `hqApprovalSources.ts`;
 * - its inbox group, in `approvalInbox.ts`'s `LANE_GROUP`;
 * - whether its decisions are recorded, from when, and with what caveat, in
 *   `approvalDecisions.ts`'s `DECISION_LANES`.
 *
 * Each of those now reads its facts from here. They keep only what is theirs:
 * the inbox's count and rows SQL, the decision log's SQL.
 *
 * WHAT A LANE MUST STATE, and `approval_lane_registry_5879.test.ts` holds
 * every entry to it:
 * - `label`: its name on the board;
 * - `group`: its chip in the canvas's APR1 (`INBOX_GROUPS`);
 * - `scope`: `studio` (every studio's queue) or `hq` (HQ's own queue, a Super
 *   Admin's only, D1040);
 * - `notifies`: who a decision tells today, in the canvas's words (D1041);
 * - `decidedOn` (the page that decides it, APR2's "Decided on"), or, when
 *   nothing decides it yet, `decidedOn: null` with an `undecidedReason`;
 * - `decisionPath`: the lane's own address, only when it has one;
 * - `decisions`: the decision log's capability (D1044). Either
 *   `{ recorded: true, since, caveat? }` (`since` is the day the decision
 *   column landed, null when it records from the start) or
 *   `{ recorded: false, reason }`.
 *
 * THE ORDER IS THE CANVAS'S: every studio's lanes, then HQ's. The inbox board
 * and the decision log both follow it.
 *
 * NO BEHAVIOUR CHANGE. Every value below was moved from where it was written
 * on main, unchanged, and each response keeps its shape.
 */
import type { ApprovalLaneKey } from './approvalSources';
import type { HqLaneKey } from './hqApprovalSources';

export const INBOX_GROUPS = ['people', 'programs', 'community', 'deals', 'hq'] as const;
export type InboxGroup = typeof INBOX_GROUPS[number];

export const LANE_SCOPES = ['studio', 'hq'] as const;
export type LaneScope = typeof LANE_SCOPES[number];

/** The decision log's capability for a lane (D1044). */
export type LaneDecisions =
  | { recorded: true; since: string | null; caveat?: string }
  | { recorded: false; reason: string };

export type LaneFacts = {
  label: string;
  group: InboxGroup;
  scope: LaneScope;
  notifies: string;
  decidedOn: string | null;
  undecidedReason?: string;
  decisionPath?: string;
  decisions: LaneDecisions;
};

export const APPROVAL_LANES: Readonly<Record<ApprovalLaneKey, LaneFacts>> = {
  lp: {
    label: 'LP applications', group: 'people', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'LP applications',
    decisions: {
      recorded: true, since: null,
      caveat: 'An LP application keeps the time of its last review, so a note saved after the decision moves the time.',
    },
  },
  referrals: {
    label: 'Referrals', group: 'programs', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'Refer & Earn › Queue',
    decisions: { recorded: true, since: null },
  },
  cohort: {
    label: 'Cohort applications', group: 'programs', scope: 'studio',
    notifies: 'The member', decidedOn: 'Spin-Out Lab',
    decisions: {
      recorded: true, since: null,
      caveat: 'A cohort decision made again replaces the earlier one, and an activated applicant keeps only its activation, so it is not listed.',
    },
  },
  moderation: {
    label: 'Spinout moderation', group: 'programs', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'Spin-Out moderation',
    decisions: { recorded: true, since: null },
  },
  kyc: {
    label: 'KYC', group: 'people', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'KYC & KYB',
    decisions: { recorded: true, since: null },
  },
  partner_profiles: {
    label: 'Partner profiles', group: 'people', scope: 'studio',
    notifies: 'The partner, when an agreement is sent', decidedOn: 'Partner profiles',
    decisions: { recorded: true, since: '2026-10-25' },
  },
  exploring: {
    label: 'Exploring', group: 'people', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'Exploring board',
    decisions: { recorded: true, since: null },
  },
  jobs: {
    label: 'Jobs', group: 'community', scope: 'studio',
    notifies: 'The host', decidedOn: 'Jobs',
    decisions: {
      recorded: false,
      reason: 'A job posting keeps no decision time and no decider; an approval or rejection is only in the admin audit log.',
    },
  },
  events: {
    label: 'Events', group: 'community', scope: 'studio',
    notifies: 'The host', decidedOn: 'Events › Review',
    decisions: {
      recorded: true, since: '2026-10-24',
      caveat: 'Events records when it approved, not who approved, and a sent-back event keeps no time, so only approvals are listed.',
    },
  },
  best_fit: {
    label: 'Best-Fit consultations', group: 'programs', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'Best-Fit',
    decisions: {
      recorded: true, since: '2026-11-10',
      caveat: 'Best-Fit decisions before 10 November 2026 were not recorded.',
    },
  },
  due_diligence: {
    label: 'Due diligence', group: 'deals', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'Due diligence',
    decisions: {
      recorded: true, since: null,
      caveat: 'A due-diligence case decided again keeps only its latest decision, and its reason is kept encrypted with the case, so the log shows no note.',
    },
  },
  kyb: {
    label: 'KYB', group: 'people', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'KYC & KYB › Businesses',
    decisionPath: '/admin/kyc/businesses',
    decisions: {
      recorded: true, since: null,
      caveat: 'A business keeps the reason for its latest decision only, so the log shows no note.',
    },
  },
  comarketing: {
    label: 'Co-marketing pitches', group: 'community', scope: 'studio',
    notifies: 'The partner', decidedOn: 'Co-marketing',
    decisions: {
      recorded: true, since: null,
      caveat: 'A pitch published before 10 Nov 2026 lost its approval time to the publish, so it is not listed.',
    },
  },
  wellbeing_experts: {
    label: 'Wellbeing experts', group: 'community', scope: 'studio',
    notifies: 'The expert', decidedOn: 'Wellbeing',
    decisions: {
      recorded: true, since: '2026-10-26',
      caveat: 'An expert verified before 26 Oct 2026 has no record of who verified them or when, so they are not listed.',
    },
  },
  perk_listings: {
    label: 'Perk listings', group: 'programs', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'Perks',
    decisions: {
      recorded: true, since: null,
      caveat: 'A perk listing keeps no submission time once it is reviewed, so its wait is not recorded.',
    },
  },
  strategic_access: {
    label: 'Strategic referral access', group: 'programs', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'Refer & Earn',
    decisions: {
      recorded: true, since: null,
      caveat: 'Strategic access records when it was decided, not who decided it.',
    },
  },
  lab_hosts: {
    label: 'Office-hours hosts', group: 'programs', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'Spin-Out Lab › Hosts',
    decisions: {
      recorded: true, since: null,
      caveat: 'Revoking a host replaces its approval, so a revoked host shows only the revocation.',
    },
  },
  score_flags: {
    label: 'Score sign-off', group: 'deals', scope: 'studio',
    notifies: 'Nobody yet', decidedOn: 'Monitoring',
    decisions: { recorded: true, since: null },
  },
  articles: {
    label: 'Articles', group: 'community', scope: 'studio',
    notifies: 'The author', decidedOn: 'Content queue',
    decisions: { recorded: true, since: null },
  },
  product_testers: {
    label: 'Product testers', group: 'people', scope: 'studio',
    notifies: 'The member', decidedOn: 'Approvals › Product testers',
    decisions: { recorded: true, since: null },
  },
  // HQ's own lanes (D1041 §4): a Super Admin's only.
  testing_programs: {
    label: 'Testing programs sent to HQ', group: 'hq', scope: 'hq',
    notifies: 'The partner', decidedOn: 'Platform › Product testing',
    decisions: { recorded: true, since: null },
  },
  learning: {
    label: 'Learning exercises to review', group: 'hq', scope: 'hq',
    notifies: 'Nobody yet', decidedOn: 'Learning studio',
    decisions: { recorded: true, since: null },
  },
  tickets: {
    label: 'Features and tasks', group: 'hq', scope: 'hq',
    notifies: 'The member', decidedOn: 'HQ review',
    decisions: { recorded: true, since: null },
  },
  payouts: {
    label: 'Payout requests', group: 'hq', scope: 'hq',
    notifies: 'Nobody yet', decidedOn: 'Commissions',
    decisions: { recorded: true, since: null },
  },
  ai_runs: {
    label: 'Held AI runs', group: 'hq', scope: 'hq',
    notifies: 'Nobody yet', decidedOn: 'Platform › AI allowances',
    decisions: {
      recorded: false,
      reason: 'A held AI run keeps no time or decider for its charge or refund; only the activity log records it.',
    },
  },
  notices: {
    label: 'Notice responses', group: 'hq', scope: 'hq',
    notifies: 'The studio', decidedOn: 'Licences',
    decisions: { recorded: true, since: null },
  },
  support: {
    label: 'Requests from studios', group: 'hq', scope: 'hq',
    notifies: 'The studio', decidedOn: 'Support',
    decisions: { recorded: true, since: null },
  },
  proposals: {
    label: 'Program proposals', group: 'hq', scope: 'hq',
    notifies: 'Nobody yet', decidedOn: 'Programs › Proposals',
    decisions: { recorded: true, since: null },
  },
  grants: {
    label: 'Program-grant requests', group: 'hq', scope: 'hq',
    notifies: 'The studio', decidedOn: 'Licences › Program grants › Requests',
    decisions: { recorded: true, since: null },
  },
};

/** Every lane key, in the canvas's order. */
export const APPROVAL_LANE_KEYS = Object.keys(APPROVAL_LANES) as ApprovalLaneKey[];

/** A lane's facts; a key with no entry here is a programming error, refused at load. */
export function laneFacts(key: ApprovalLaneKey): LaneFacts {
  const facts = (APPROVAL_LANES as Record<string, LaneFacts | undefined>)[key];
  if (!facts) throw new Error(`approval lane ${key} has no entry in approvalLaneRegistry.ts`);
  return facts;
}

/** Each lane's inbox group, derived from the registry (`approvalInbox.ts` re-exports it). */
export const LANE_GROUP = Object.fromEntries(
  APPROVAL_LANE_KEYS.map((k) => [k, APPROVAL_LANES[k].group]),
) as Record<ApprovalLaneKey, InboxGroup>;

/** The fields an inbox source took from its lane, as `ApprovalSource` spells them. */
function sourceFields(key: ApprovalLaneKey) {
  const f = laneFacts(key);
  return {
    label: f.label,
    notifies: f.notifies,
    decidedOn: f.decidedOn,
    ...(f.decisionPath ? { decisionPath: f.decisionPath } : {}),
    ...(f.undecidedReason ? { undecidedReason: f.undecidedReason } : {}),
  };
}

/** A studio lane's inbox fields: no `scope`, as before. */
export function studioSource<K extends ApprovalLaneKey>(key: K) {
  if (laneFacts(key).scope !== 'studio') throw new Error(`approval lane ${key} is not a studio lane`);
  return { key, ...sourceFields(key) };
}

/** An HQ lane's inbox fields, with `scope: 'hq'` (D1040's `sourcesFor`). */
export function hqSource<K extends HqLaneKey>(key: K) {
  if (laneFacts(key).scope !== 'hq') throw new Error(`approval lane ${key} is not an HQ lane`);
  return { key, ...sourceFields(key), scope: 'hq' as const };
}

/** The scope field a decision lane carries: `hq` only, as before. */
const decisionScope = (key: ApprovalLaneKey) => (laneFacts(key).scope === 'hq' ? { scope: 'hq' as const } : {});

/** A recorded lane's decision-log fields. Refused at load when the registry says it is not recorded. */
export function recordedLane(key: ApprovalLaneKey) {
  const d = laneFacts(key).decisions;
  if (!d.recorded) throw new Error(`approval lane ${key} does not record its decisions`);
  return { key, ...decisionScope(key), recorded: true as const, since: d.since, ...(d.caveat ? { caveat: d.caveat } : {}) };
}

/** An unrecorded lane's decision-log fields, with the reason the page prints. */
export function unrecordedLane(key: ApprovalLaneKey) {
  const d = laneFacts(key).decisions;
  if (d.recorded) throw new Error(`approval lane ${key} records its decisions`);
  return { key, ...decisionScope(key), recorded: false as const, since: null, reason: d.reason };
}
