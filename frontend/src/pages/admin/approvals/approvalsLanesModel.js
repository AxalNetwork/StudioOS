/** Lane definitions and labels, the glance counts, HQ access and the lane age breakdown. */
import { ageText, nf } from './approvalsFormat.js';

export const NOT_YET = 'Not read here yet';

export const GLANCE_FAILED = 'The Studio glance could not be read, so no lane is drawn as empty. That is not the same as nothing waiting.';

export const GROUPS = [
  { key: 'people', label: 'People and accounts' },
  { key: 'programs', label: 'Programs' },
  { key: 'community', label: 'Community and content' },
  { key: 'deals', label: 'Deals and portfolio' },
];

/**
 * The twenty lanes (D1038 §1), in the canvas's order and words.
 *   glance  the Worker's lane key on the glance, or null for a lane it does not count yet;
 *   door    the page that decides it today, by its name on the canvas;
 *   here    decided on one of this page's lane boards;
 *   isNew   one of the nine lanes this redesign adds.
 * The door's address is written as a literal link in AdminApprovals.jsx
 * (`LaneDoor`), so the reachability walk sees every one.
 * D5880: key, label, group and scope (this list is `studio`, `HQ_LANES` is
 * `hq`) must match the Worker's `services/approvalLaneRegistry.ts`, and each
 * door must be a registered route; `approval_lanes_registry_5880.test.mjs`
 * fails on any difference it does not list with a reason.
 */
export const LANES = [
  { key: 'kyc', group: 'people', label: 'KYC', glance: 'kyc', door: 'KYC & KYB' },
  { key: 'kyb', group: 'people', label: 'KYB', glance: 'kyb', door: 'KYC & KYB', isNew: true },
  { key: 'partner_profiles', group: 'people', label: 'Partner profiles', glance: 'partner_profiles', door: 'Partner profiles' },
  { key: 'exploring', group: 'people', label: 'Explorers ready for a profile', glance: 'exploring', door: 'Exploring board' },
  { key: 'product_testers', group: 'people', label: 'Product testers', glance: 'product_testers', here: true, isNew: true },
  { key: 'lp', group: 'people', label: 'LP applications', glance: 'lp', door: 'LP applications' },
  { key: 'cohort', group: 'programs', label: 'Spin-Out Lab applications', glance: 'cohort', door: 'Spin-Out Lab' },
  { key: 'lab_hosts', group: 'programs', label: 'Office-hours hosts', glance: 'lab_hosts', door: 'Spin-Out Lab › Hosts', isNew: true },
  { key: 'moderation', group: 'programs', label: 'Spin-Out moderation', glance: 'moderation', door: 'Spin-Out moderation' },
  { key: 'referrals', group: 'programs', label: 'Refer & Earn reviews', glance: 'referrals', door: 'Refer & Earn › Queue' },
  { key: 'strategic_access', group: 'programs', label: 'Strategic referral access', glance: 'strategic_access', door: 'Refer & Earn', isNew: true },
  { key: 'perk_listings', group: 'programs', label: 'Perk listings', glance: 'perk_listings', door: 'Perks', isNew: true },
  { key: 'best_fit', group: 'programs', label: 'Best-Fit consultations', glance: 'best_fit', door: 'Best-Fit' },
  { key: 'events', group: 'community', label: 'Events', glance: 'events', door: 'Events › Review' },
  { key: 'jobs', group: 'community', label: 'Jobs', glance: 'jobs', door: 'Jobs' },
  { key: 'wellbeing_experts', group: 'community', label: 'Wellbeing experts', glance: 'wellbeing_experts', here: true, isNew: true },
  { key: 'comarketing', group: 'community', label: 'Co-marketing pitches', glance: 'comarketing', here: true, isNew: true },
  { key: 'articles', group: 'community', label: 'Articles', glance: 'articles', door: 'Content queue', isNew: true },
  { key: 'due_diligence', group: 'deals', label: 'Due diligence', glance: 'due_diligence', door: 'Due diligence' },
  { key: 'score_flags', group: 'deals', label: 'Score sign-off', glance: 'score_flags', door: 'Monitoring', isNew: true, note: 'A flagged score stays hidden from LPs until an admin signs it off.' },
];

/** HQ decides (APR9): Super Admin only. The glance counts them as `approvals.hq_decides` for a Super Admin (D1041); part 7 (#2893) draws the counts. */
export const HQ_LANES = [
  { key: 'testing_programs', label: 'Testing programs sent to HQ', door: 'Platform › Product testing' },
  { key: 'learning', label: 'Learning exercises to review', door: 'Learning studio' },
  { key: 'tickets', label: 'Features and tasks', door: 'HQ review' },
  { key: 'payouts', label: 'Payout requests', door: 'Commissions' },
  { key: 'ai_runs', label: 'Held AI runs', door: 'Platform › AI allowances' },
  { key: 'notices', label: 'Notice responses', door: 'Licences' },
  { key: 'support', label: 'Requests from studios', door: 'Support' },
  // D5302: HQ's proposal queue is built (D964), and the Worker's lane is decided there and keeps its history.
  { key: 'proposals', label: 'Program proposals', door: 'Programs › Proposals' },
  { key: 'grants', label: 'Program-grant requests', door: 'Licences › Program access by licence › Requests' },
  { key: 'formation_cases', label: 'Formation cases waiting on HQ', note: 'Read and assign here. Case actions are recorded in Formation.' },
];

export const isHqLane = (key) => HQ_LANES.some((l) => l.key === key);

export const HQ_ONLY_TITLE = 'This lane belongs to the Super Admin.';

export const HQ_ONLY_LINE = 'HQ decides it on its own page. Your inbox is unchanged.';

/** Not a queue (APR2's card), in the canvas's words. */
export const NOT_A_QUEUE = [
  { key: 'directory', label: 'Directory', reason: 'A partner is listed or not; nothing is submitted for a listing decision.' },
  { key: 'circles', label: 'Circles', reason: 'Admins create circles and publish them; nobody submits one for review.' },
  { key: 'invitations', label: 'Partner invitations', reason: 'An open invitation waits on the invitee, not an admin.' },
  { key: 'mentor', label: 'Mentor cohort access', reason: 'Access is assigned by an admin; nobody can ask for it.' },
  { key: 'formation', label: '83(b) follow-ups and formation packets', reason: 'Tasks on the Spin-Out Lab’s Formation tab, not decisions.' },
];

/** The platform's age bands (APR1): no pill under 24 hours, amber to 72, red past it. */
export function bandOf(hours) {
  const h = Number(hours);
  if (hours === null || hours === undefined || !Number.isFinite(h)) return null;
  if (h >= 72) return { key: 'past', label: 'Over 72 hours', tone: 'bad' };
  if (h >= 24) return { key: 'due', label: '24 to 72 hours', tone: 'warn' };
  return { key: 'ok', label: 'Under 24 hours', tone: null };
}

/**
 * One lane as the page draws it, from the glance's view (`hqApprovalsView`).
 * `state`: 'loading', 'unreadable' (the glance or this lane failed),
 * 'unrecorded' (the glance does not count it yet) or 'ready'.
 */
export function laneView(lane, glance) {
  const base = { ...lane };
  if (!lane.glance) return { ...base, state: 'unrecorded', count: undefined, reason: lane.waits || NOT_YET };
  if (!glance || glance.status === 'loading') return { ...base, state: 'loading' };
  const ap = glance.hq?.approvals;
  if (glance.status !== 'ready' || ap?.kind !== 'ready') return { ...base, state: 'unreadable', count: null, reason: GLANCE_FAILED };
  const g = ap.lanes.find((l) => l.key === lane.glance);
  if (!g) return { ...base, state: 'unrecorded', count: undefined, reason: 'This lane was not on the Studio glance.' };
  if (g.count === null || g.count === undefined) return { ...base, state: 'unreadable', count: null, reason: g.reason || 'That is not the same as nothing waiting.' };
  return { ...base, state: 'ready', count: g.count, ageHours: g.oldest_age_hours ?? null, age: ageText(g.oldest_age_hours), band: g.count > 0 ? bandOf(g.oldest_age_hours) : null };
}

export const laneViews = (glance) => LANES.map((l) => laneView(l, glance));

/** The oldest wait across the lanes, said as a line under "Over 72 hours"; null when none waits. */
export function oldestLine(views) {
  const waiting = views.filter((v) => v.state === 'ready' && v.count > 0 && v.ageHours !== null);
  if (!waiting.length) return null;
  const top = waiting.reduce((a, b) => (b.ageHours > a.ageHours ? b : a));
  return `oldest ${top.age}, ${top.label}`;
}

/** The groups the inbox filters by: the canvas's four, and HQ's for a Super Admin. */
export const HQ_GROUP = { key: 'hq', label: 'HQ decides' };

export const inboxGroups = (superAdmin) => (superAdmin ? [...GROUPS, HQ_GROUP] : GROUPS);

// D5880: every lane the UI names, with its group (`hq` for HQ's own), exported so
// `approval_lanes_registry_5880.test.mjs` holds it to the Worker's registry.
export const LANE_BY_KEY = Object.fromEntries([...LANES.map((l) => [l.key, l]), ...HQ_LANES.map((l) => [l.key, { ...l, group: 'hq' }])]);

export const groupLabel = (g) => (g === 'hq' ? HQ_GROUP.label : GROUPS.find((x) => x.key === g)?.label || null);

export const laneLabelOf = (key, fallback) => LANE_BY_KEY[key]?.label || fallback || key;

/** The group chips' counts, from each lane's count: null when a lane in the group failed. */
export function inboxGroupCounts(reply, superAdmin) {
  const lanes = Array.isArray(reply?.lanes) ? reply.lanes : [];
  const out = {};
  for (const g of inboxGroups(superAdmin)) {
    const inG = lanes.filter((l) => l.group === g.key);
    out[g.key] = inG.some((l) => l.count === null || l.count === undefined) ? null : inG.reduce((t, l) => t + l.count, 0);
  }
  const vals = Object.values(out);
  out.all = vals.some((n) => n === null) ? null : vals.reduce((t, n) => t + n, 0);
  return out;
}

/**
 * "Waiting by lane" (APR1): one stacked bar per lane that waits, split by age
 * band, worst first (most over 72 hours, then 24 to 72, then most items). A
 * lane that could not be read, or was cut at the read's cap, is a row that
 * says so, never an empty bar. `sum` is the chart's one sentence.
 */
export const BAND_PARTS = [
  { key: 'ok', label: 'Under 24 hours', tone: 'sky' },
  { key: 'due_soon', label: '24 to 72 hours', tone: 'amber' },
  { key: 'past', label: 'Over 72 hours', tone: 'violet' },
  { key: 'unknown', label: 'Age not recorded', tone: 'muted' },
];

export function laneAgeChart(reply) {
  const lanes = Array.isArray(reply?.lanes) ? reply.lanes : [];
  const waiting = lanes.filter((l) => l.bands && l.count > 0).sort((a, b) => (b.bands.past - a.bands.past) || (b.bands.due_soon - a.bands.due_soon) || (b.count - a.count));
  const missing = lanes.filter((l) => !l.bands && (l.count === null || l.count > 0));
  const rows = [
    ...waiting.map((l) => ({
      key: l.key, label: laneLabelOf(l.key, l.label), total: `${nf(l.count)} waiting`,
      parts: BAND_PARTS.map((p) => ({ key: p.key, label: p.label, tone: p.tone, value: l.bands[p.key] || 0 })),
    })),
    ...missing.map((l) => ({ key: l.key, label: laneLabelOf(l.key, l.label), total: l.count === null ? 'Could not be read' : 'Split not shown', parts: [], reason: l.bands_reason || null })),
  ];
  const top = waiting[0];
  const most = waiting.slice().sort((a, b) => b.count - a.count)[0];
  const parts = [];
  if (!waiting.length) parts.push('No lane has anything waiting.');
  else {
    parts.push(`Items waiting by lane in age bands. ${laneLabelOf(most.key, most.label)} holds the most, ${nf(most.count)}`);
    if (top.bands.past) parts[0] += `; ${laneLabelOf(top.key, top.label)} has ${nf(top.bands.past)} over 72 hours`;
    parts[0] += '.';
  }
  if (missing.length) parts.push(`${missing.map((l) => laneLabelOf(l.key, l.label)).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not split: ${missing.length === 1 ? 'it' : 'they'} could not be read in full.`);
  return { type: 'stackbars', head: 'Lane', rows, parts: BAND_PARTS, sum: parts.join(' ') };
}

/* ------------------------------------------------------------------ *
 * Lanes (APR2, APR9)
 * ------------------------------------------------------------------ */

/**
 * A lane's Notifies cell (APR2), from the glance's lane (`notifies`, D1041).
 * "Nobody yet" is a warning pill; a glance without it is not read here.
 */
export function notifiesOf(glanceLane) {
  if (!glanceLane || !glanceLane.notifies) return { state: 'unrecorded', text: 'Not read here yet' };
  return { state: 'ready', text: glanceLane.notifies, warn: glanceLane.notifies === 'Nobody yet' };
}

/**
 * HQ decides' counts (APR9), from the glance's `hq_decides` (D1041), which a
 * Super Admin's glance alone carries. Each HQ lane is a number, "Could not be
 * read", or not on the glance.
 */
export function hqLaneViews(hqDecides) {
  const lanes = Array.isArray(hqDecides?.lanes) ? hqDecides.lanes : null;
  return HQ_LANES.map((l) => {
    if (!lanes) return { ...l, state: 'unrecorded', reason: 'HQ’s counts were not on the glance.' };
    const g = lanes.find((x) => x.key === l.key);
    if (!g) return { ...l, state: 'unrecorded', reason: 'This lane was not on the glance.' };
    if (g.count === null || g.count === undefined) return { ...l, state: 'unreadable', count: null, reason: g.reason || 'That is not the same as nothing waiting.' };
    return { ...l, state: 'ready', count: g.count, age: g.count > 0 ? ageText(g.oldest_age_hours) : null, notifies: notifiesOf(g) };
  });
}

/** "HQ decides · 22 waiting", or why there is no total. */
export function hqBandLine(hqDecides) {
  if (!hqDecides) return null;
  const t = hqDecides.pending_total;
  return t === null || t === undefined
    ? `HQ decides · ${(hqDecides.unreadable || []).join(', ') || 'a lane'} could not be read, so no total · only Super Admins see this group`
    : `HQ decides · ${nf(t)} waiting · only Super Admins see this group`;
}
