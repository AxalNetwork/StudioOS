/**
 * D1038 (#2390) — Admin › Approvals as pure functions: the addresses and tabs,
 * the twenty lanes in the canvas's groups with the page that decides each, the
 * HQ group, and every block built from the reads that exist today. No React
 * here, so `node --test` loads it alone.
 *
 * The reads (each answers alone; D1038 §2):
 *   - `glance`   GET /api/admin/studio/glance, `requireAdmin` — the eleven
 *                laned queues (`approvals.lanes`: key, label, count or null,
 *                oldest_age_hours, sla), `pending_total` (null when a lane
 *                failed) and the lanes with no queue. Counts per lane, never
 *                items: who waits, who holds it and what was decided are the
 *                inbox read's (part 2) and the decision log's (part 6).
 *   - `pitches`  GET /api/comarketing/admin/queue?status=… — every pitch in one
 *                state, newest first, no limit, with partner and attribution.
 *   - `experts`  GET /api/wellbeing/experts?limit=50 — for an admin, every
 *                active expert ranked, at most 50, with `total_active`. It
 *                carries no created date, so no wait is drawn.
 * Product testers have no store yet (part 4), so their board reads nothing.
 */

export const PATH = '/admin/approvals';
export const TITLE = 'Approvals';
export const LINE = 'Everything that waits on an admin, oldest first. Decide here, or open the page that decides it.';
export const LANES_LINE = 'Each lane is one kind of decision. Most are decided on their own page.';
export const DECIDED_LINE = 'Decisions made here and on each lane’s own page, newest first.';
export const RAIL_NOTE = 'Eadwyn reads what is waiting here. Nothing is decided until you decide it.';
export const NOT_YET = 'Not read here yet';
export const MOVED_KEY = 'held-approvals';
export const MOVED_NOTICE = 'Approvals has a new address. Update your bookmark.';
export const GLANCE_FAILED = 'The Studio glance could not be read, so no lane is drawn as empty. That is not the same as nothing waiting.';
export const LANE_FAILED = 'Could not be read';

/** The page's tabs (APR1, APR2, APR10), each its own address. */
export const TABS = [
  { key: 'inbox', label: 'Inbox', path: '' },
  { key: 'lanes', label: 'Lanes', path: '/lanes' },
  { key: 'decided', label: 'Decided', path: '/decided' },
];

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  const t = TABS.find((x) => `${PATH}${x.path}` === p);
  return t ? t.key : 'inbox';
}

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
 */
export const LANES = [
  { key: 'kyc', group: 'people', label: 'KYC', glance: 'kyc', door: 'KYC & KYB' },
  { key: 'kyb', group: 'people', label: 'KYB', glance: 'kyb', door: 'KYC & KYB', isNew: true },
  { key: 'partner_profiles', group: 'people', label: 'Partner profiles', glance: 'partner_profiles', door: 'Partner profiles' },
  { key: 'exploring', group: 'people', label: 'Explorers ready for a profile', glance: 'exploring', door: 'Exploring board', note: 'Counts every Explorer, signed or not, until part 1 counts only those who signed the binding agreement.' },
  { key: 'product_testers', group: 'people', label: 'Product testers', glance: null, here: true, isNew: true, waits: 'No product tester application is stored yet (part 4).' },
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
  { key: 'proposals', label: 'Program proposals', door: null, waits: 'Programs › Proposals is not built yet (#2371).' },
  { key: 'grants', label: 'Program-grant requests', door: null, waits: 'Licences › Program grants › Requests is not built yet (#2376).' },
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

const nf = (n) => Number(n).toLocaleString('en-US');

/** "6 d 2 h", "9 h", "40 min"; null when the age was not read. */
export function ageText(hours) {
  const h = Number(hours);
  if (hours === null || hours === undefined || !Number.isFinite(h) || h < 0) return null;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  const d = Math.floor(h / 24);
  const r = Math.floor(h - d * 24);
  return d ? `${d} d ${r} h` : `${r} h`;
}

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

/**
 * The Waiting tile (APR1, APR13): the sum over the lanes that answered, with
 * "+" when one failed, and how many of the twenty are counted at all.
 */
export function waitingTile(views) {
  if (views.some((v) => v.state === 'loading')) return { state: 'loading' };
  const counted = views.filter((v) => v.glance);
  const ready = counted.filter((v) => v.state === 'ready');
  const failed = counted.filter((v) => v.state === 'unreadable');
  if (!ready.length) return { state: 'unreadable', reason: GLANCE_FAILED };
  const total = ready.reduce((t, v) => t + v.count, 0);
  const uncounted = views.length - counted.length;
  return {
    state: 'ready',
    value: failed.length ? `${nf(total)} +` : nf(total),
    sub: failed.length
      ? `${failed.map((v) => v.label).join(', ')} could not be read`
      : `across ${nf(ready.length)} of ${nf(views.length)} lanes; ${nf(uncounted)} ${uncounted === 1 ? 'is' : 'are'} not counted yet`,
  };
}

/** The oldest wait across the lanes, said as a line under "Over 72 hours"; null when none waits. */
export function oldestLine(views) {
  const waiting = views.filter((v) => v.state === 'ready' && v.count > 0 && v.ageHours !== null);
  if (!waiting.length) return null;
  const top = waiting.reduce((a, b) => (b.ageHours > a.ageHours ? b : a));
  return `oldest ${top.age}, ${top.label}`;
}

/**
 * The lanes with items, longest wait first (APR1's order); a lane whose age
 * was not read sorts last, never first.
 */
export function waitingLanes(views, { group = null, q = '' } = {}) {
  const s = String(q || '').trim().toLowerCase();
  return views
    .filter((v) => v.state === 'ready' && v.count > 0)
    .filter((v) => !group || v.group === group)
    .filter((v) => s.length < 2 || v.label.toLowerCase().includes(s))
    .sort((a, b) => (b.ageHours ?? -1) - (a.ageHours ?? -1));
}

/** The group chips' counts: a number when every counted lane in it answered, else null. */
export function groupCounts(views) {
  const out = {};
  for (const g of GROUPS) {
    const counted = views.filter((v) => v.group === g.key && v.glance);
    out[g.key] = counted.some((v) => v.state !== 'ready') ? null : counted.reduce((t, v) => t + v.count, 0);
  }
  const all = Object.values(out);
  out.all = all.some((n) => n === null) ? null : all.reduce((t, n) => t + n, 0);
  return out;
}

/** "Waiting by lane" (APR1), one bar per waiting lane, its tone the oldest item's band. */
export function laneBars(views) {
  const tone = { past: 'violet', due: 'amber', ok: 'sky' };
  return waitingLanes(views).map((v) => ({
    key: v.key, label: v.label, value: v.count, text: `${nf(v.count)} waiting`, tone: tone[v.band?.key] || 'muted',
  }));
}

/** A filter from the address (`?group=`, `?lane=`), so other pages can link to one. */
export function filtersOf(search) {
  const p = new URLSearchParams(search || '');
  const group = GROUPS.some((g) => g.key === p.get('group')) ? p.get('group') : null;
  const lane = p.get('lane') || null;
  return { group, lane, q: p.get('q') || '' };
}

/* ------------------------------------------------------------------ *
 * The lane boards (APR4, APR6, APR8)
 * ------------------------------------------------------------------ */

export const BOARDS = {
  'product-testers': { title: 'Product testers', line: 'Anyone with a profile can apply to test products. Approve them and testing programs can pick them.' },
  'co-marketing': { title: 'Co-marketing pitches', line: 'Partners pitch joint webinars, posts and events. Approve the idea, then publish it when it goes out.' },
  'wellbeing-experts': { title: 'Wellbeing experts', line: 'Members only see verified experts. Check each expert’s credentials before you verify them.' },
};

/** Co-marketing's tabs: the Worker's five stored states, `rejected` drawn as Declined. */
export const PITCH_TABS = [
  { key: 'proposed', label: 'Proposed', path: '' },
  { key: 'approved', label: 'Approved, to publish', path: '/approved' },
  { key: 'published', label: 'Published', path: '/published' },
  { key: 'rejected', label: 'Declined', path: '/declined' },
  { key: 'withdrawn', label: 'Withdrawn', path: '/withdrawn' },
];

/** Wellbeing's tabs. There is no declined state yet (part 5), so no Declined tab. */
export const EXPERT_TABS = [
  { key: 'verify', label: 'To verify', path: '' },
  { key: 'incomplete', label: 'Profile incomplete', path: '/incomplete' },
  { key: 'verified', label: 'Verified', path: '/verified' },
  { key: 'hidden', label: 'Hidden', path: '/hidden' },
];

/** What a lane-board path opens: the board and its tab, or null. */
export function boardOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  for (const [slug, tabs] of [['co-marketing', PITCH_TABS], ['wellbeing-experts', EXPERT_TABS], ['product-testers', [{ key: 'waiting', path: '' }]]]) {
    const t = tabs.find((x) => `${PATH}/${slug}${x.path}` === p);
    if (t) return { board: slug, tab: t.key };
  }
  return null;
}

const ASSET = { webinar: 'Webinar', blog: 'Blog', podcast: 'Podcast', event: 'Event', newsletter: 'Newsletter' };
export const assetWord = (t) => ASSET[String(t || '').toLowerCase()] || 'Other';

const stampMs = (s) => {
  if (!s) return null;
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`).getTime();
  return Number.isNaN(t) ? null : t;
};
export const hoursSince = (s, now = Date.now()) => { const t = stampMs(s); return t === null ? null : Math.max(0, (now - t) / 3_600_000); };

/** "14 Nov 2026"; null when there is no date. */
export function dayText(s) {
  const t = stampMs(s);
  return t === null ? null : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** One tab's pitches, oldest first (the queue is newest first), each with its wait. */
export function pitchRows(items, now = Date.now()) {
  return (Array.isArray(items) ? items : []).map((p) => {
    const h = hoursSince(p.created_at, now);
    return {
      key: p.uid || p.id, title: p.title || 'Untitled pitch', type: assetWord(p.asset_type),
      partner: p.partner_company || p.partner_name || 'Not recorded', submitter: p.partner_company && p.partner_name ? p.partner_name : null,
      date: dayText(p.proposed_date) || 'No date', audience: p.target_audience || 'Not given',
      ageHours: h, age: ageText(h), band: bandOf(h), code: p.attribution_code || null,
      attribution: p.attribution || null, publishedUrl: p.published_url || null,
    };
  }).sort((a, b) => (b.ageHours ?? -1) - (a.ageHours ?? -1));
}

/** Visits and sign-ups over the published pitches (all time; the 30-day window is part 5's). */
export function attributionTotals(items) {
  const list = Array.isArray(items) ? items : [];
  const sum = (k) => list.reduce((t, p) => t + (Number(p?.attribution?.[k]) || 0), 0);
  return { visits: sum('visit'), signups: sum('signup'), leads: sum('lead'), conversions: sum('conversion') };
}

/**
 * An expert's state on the board. "To verify" is the directory's own bar
 * (active, unverified, not hidden, at least 70% complete, not a sample);
 * below 70% is Profile incomplete. A sample from the seed is never a lane item.
 */
export function expertState(e) {
  if (e?.hidden) return 'hidden';
  if (e?.verified) return 'verified';
  if (e?.is_sample) return null;
  return Number(e?.profile_completion_pct || 0) >= 70 ? 'verify' : 'incomplete';
}

/**
 * The experts read, as tab counts and rows. The read stops at 50 ranked
 * experts; when it holds fewer than `total_active` the counts are floors and
 * say so (`partial`).
 */
export function expertBoard(reply, tab) {
  const list = Array.isArray(reply?.matches) ? reply.matches : [];
  const total = Number.isFinite(Number(reply?.total_active)) ? Number(reply.total_active) : null;
  const partial = total === null || list.length < total;
  const counts = {};
  for (const t of EXPERT_TABS) counts[t.key] = list.filter((e) => expertState(e) === t.key).length;
  const rows = list.filter((e) => expertState(e) === tab).map((e) => ({
    key: e.uid, name: e.name || 'Not recorded', headline: e.headline || null,
    categories: Array.isArray(e.categories) ? e.categories : [],
    pricing: e.first_session_free ? 'Free first session' : Number(e.hourly_rate_usd) > 0 ? `$${nf(Number(e.hourly_rate_usd))} an hour` : 'Not recorded',
    pct: Math.round(Number(e.profile_completion_pct || 0)),
  }));
  return { counts, rows, partial, total, read: list.length };
}
