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
 * D1132: Product testers are counted on the glance now that part 4's store
 * exists; their board's table and decisions are part 8's (#2894).
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
  { key: 'proposals', label: 'Program proposals', door: null, waits: 'Programs › Proposals is not built yet (#2371).' },
  { key: 'grants', label: 'Program-grant requests', door: 'Licences › Program grants › Requests' },
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

/** The oldest wait across the lanes, said as a line under "Over 72 hours"; null when none waits. */
export function oldestLine(views) {
  const waiting = views.filter((v) => v.state === 'ready' && v.count > 0 && v.ageHours !== null);
  if (!waiting.length) return null;
  const top = waiting.reduce((a, b) => (b.ageHours > a.ageHours ? b : a));
  return `oldest ${top.age}, ${top.label}`;
}

// D1045 (#2893): the glance-built Inbox (its Waiting tile, lane rows, group
// counts, bars and filters) gave way to the inbox read; see inboxModel.js.

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

/** Wellbeing's tabs. D1046: part 5's declined state is its own tab. */
export const EXPERT_TABS = [
  { key: 'verify', label: 'To verify', path: '' },
  { key: 'incomplete', label: 'Profile incomplete', path: '/incomplete' },
  { key: 'verified', label: 'Verified', path: '/verified' },
  { key: 'declined', label: 'Declined', path: '/declined' },
  { key: 'hidden', label: 'Hidden', path: '/hidden' },
];

/** D1046: Product testers' tabs, one per stored status (D1042), `applied` drawn as Waiting. */
export const TESTER_TABS = [
  { key: 'waiting', status: 'applied', label: 'Waiting', path: '' },
  { key: 'active', status: 'active', label: 'Active', path: '/active' },
  { key: 'paused', status: 'paused', label: 'Paused', path: '/paused' },
  { key: 'declined', status: 'declined', label: 'Declined', path: '/declined' },
  { key: 'removed', status: 'removed', label: 'Removed', path: '/removed' },
];

const BOARD_TABS = [['co-marketing', PITCH_TABS], ['wellbeing-experts', EXPERT_TABS], ['product-testers', TESTER_TABS]];

/**
 * What a lane-board path opens: the board and its tab, or null. D1046: one
 * segment past a board that is not a tab is one item's address
 * (`/admin/approvals/co-marketing/<uid>`): the board on its first tab, with
 * that item's drawer open. Tab paths win, so no id can shadow a tab.
 */
export function boardOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  for (const [slug, tabs] of BOARD_TABS) {
    const t = tabs.find((x) => `${PATH}/${slug}${x.path}` === p);
    if (t) return { board: slug, tab: t.key };
  }
  for (const [slug, tabs] of BOARD_TABS) {
    const head = `${PATH}/${slug}/`;
    if (!p.startsWith(head)) continue;
    const rest = p.slice(head.length);
    if (rest && !rest.includes('/')) {
      let item;
      try { item = decodeURIComponent(rest); } catch { return null; }
      return { board: slug, tab: tabs[0].key, item };
    }
  }
  return null;
}

/** The path of a board's tab. */
export const tabPath = (board, key) => {
  const tabs = BOARD_TABS.find(([slug]) => slug === board)?.[1] || [];
  return `${PATH}/${board}${tabs.find((t) => t.key === key)?.path || ''}`;
};

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
 * An expert's state on the board, on part 5's review read (D1043). Hidden wins;
 * then a decline; then verified. A pending expert is "To verify" at the
 * directory's own bar (at least 70% complete) and "Profile incomplete" below
 * it. A sample from the seed is never a lane item (the Worker leaves samples
 * out; this holds if one arrives).
 */
export function expertState(e) {
  if (e?.hidden) return 'hidden';
  if (e?.decision_state === 'declined') return 'declined';
  if (e?.verified || e?.decision_state === 'verified') return 'verified';
  if (e?.is_sample) return null;
  return Number(e?.profile_completion_pct || 0) >= 70 ? 'verify' : 'incomplete';
}

/** "Licence and 2 files", "1 file", or null when nothing is given. */
export function credentialsText(c) {
  const files = Array.isArray(c?.files) ? c.files.length : 0;
  const parts = [c?.licence_number ? 'Licence' : null, files ? `${files} ${files === 1 ? 'file' : 'files'}` : null].filter(Boolean);
  return parts.length ? parts.join(' and ') : null;
}

/**
 * The experts, as tab counts and rows, oldest first. `reply` is every page the
 * board read: `{ items, total }`. When it holds fewer than `total` the counts
 * are not drawn (`partial`), never drawn short.
 */
export function expertBoard(reply, tab, now = Date.now()) {
  const list = Array.isArray(reply?.items) ? reply.items : [];
  const total = Number.isFinite(Number(reply?.total)) ? Number(reply.total) : null;
  const partial = total === null || list.length < total;
  const counts = {};
  for (const t of EXPERT_TABS) counts[t.key] = list.filter((e) => expertState(e) === t.key).length;
  const rows = list.filter((e) => expertState(e) === tab).map((e) => {
    const hrs = hoursSince(e.created_at, now);
    return {
      key: e.uid, name: e.name || 'Not recorded', headline: e.headline || null,
      pct: e.profile_completion_pct == null ? null : Math.round(Number(e.profile_completion_pct)),
      ageHours: hrs, age: ageText(hrs), band: bandOf(hrs),
      credentials: credentialsText(e.credentials), decidedOn: dayText(e.decided_at),
    };
  }).sort((a, b) => (b.ageHours ?? -1) - (a.ageHours ?? -1));
  const waiting = rows.length && tab === 'verify' ? rows[0] : null;
  return { counts, rows, partial, total, read: list.length, oldest: waiting?.age || null };
}

/* ------------------------------------------------------------------ *
 * D1046 (#2894): Product testers (APR4, APR5)
 * ------------------------------------------------------------------ */

/** The five profiles that can apply, in the canvas's words. Admins cannot apply. */
export const PROFILES = [
  { role: 'founder', label: 'Founders', one: 'Founder' },
  { role: 'investor', label: 'Investors', one: 'Investor' },
  { role: 'advisor', label: 'Advisors', one: 'Advisor' },
  { role: 'partner', label: 'Operating Partners', one: 'Operating Partner' },
  { role: 'exploring', label: 'Explorers', one: 'Explorer' },
];
export const profileWord = (role) => PROFILES.find((x) => x.role === role)?.one || 'Other';

/**
 * Member intake (#2318). No route lets a member apply yet (D1042 §4), so
 * intake is paused in fact: #2318's answer A. When a member apply route lands
 * this becomes a read, not a constant.
 */
export const INTAKE_PAUSED = true;
export const INTAKE_PAUSED_LINE = 'Member intake is paused. Nobody can apply now. Applications already stored still wait here.';

const KYC_WORD = { approved: 'Approved', pending: 'Pending', submitted: 'Pending', rejected: 'Rejected', review: 'In review' };
export const identityWord = (k) => KYC_WORD[String(k || '').toLowerCase()] || 'Not started';

/** The table's rows for one tab, in the order the Worker gives (oldest application first). */
export function testerRows(rows, now = Date.now()) {
  return (Array.isArray(rows) ? rows : []).map((t) => {
    const hrs = hoursSince(t.applied_at, now);
    return {
      key: t.id, id: t.id, status: t.status,
      name: t.member?.name || 'Name not recorded', email: t.member?.email || null,
      profile: profileWord(t.member?.role), emailVerified: !!t.member?.email_verified,
      identity: identityWord(t.member?.kyc_status),
      applied: dayText(t.applied_at) || 'Not recorded', ageHours: hrs, age: ageText(hrs), band: bandOf(hrs),
      availability: t.availability && String(t.availability).trim() ? String(t.availability) : null,
      consent: t.consent_email_at ? `Given · ${t.consent_version || 'version not recorded'}` : null,
      decidedBy: t.decided_by_name || null, decidedOn: dayText(t.decided_at),
      reason: t.reason || null,
      programmes: t.programmes || null,
    };
  });
}

/**
 * The chart by profile (APR4): applications in the last 12 weeks, from every
 * tester the board read. A read that stopped short draws no bars (`partial`).
 */
export function profileChart(rows, { complete = true, now = Date.now() } = {}) {
  if (!complete) return { partial: true, bars: [], total: null, sentence: 'Not every tester could be read, so the chart is not drawn.' };
  const since = now - 84 * 24 * 3_600_000;
  const recent = (Array.isArray(rows) ? rows : []).filter((t) => { const h = hoursSince(t.applied_at, now); return h !== null && now - h * 3_600_000 >= since; });
  const bars = PROFILES.map((p) => ({ role: p.role, label: p.label, n: recent.filter((t) => t.member?.role === p.role).length }));
  const other = recent.length - bars.reduce((a, b) => a + b.n, 0);
  if (other) bars.push({ role: 'other', label: 'Other', n: other });
  const total = recent.length;
  const sentence = total
    ? `Applications to test products in the last 12 weeks: ${bars.map((b) => `${b.label.toLowerCase()} ${b.n}`).join(', ')}.`
    : 'No application to test products in the last 12 weeks.';
  return { partial: false, bars, total, sentence, max: Math.max(1, ...bars.map((b) => b.n)) };
}

/** The member's answers as question and answer pairs, whatever shape they were stored in. */
export function answerPairs(answers) {
  if (Array.isArray(answers)) {
    return answers.map((a, i) => {
      if (a && typeof a === 'object') return { q: String(a.question || a.q || a.label || `Answer ${i + 1}`), a: String(a.answer ?? a.a ?? a.value ?? '') };
      return { q: `Answer ${i + 1}`, a: String(a ?? '') };
    }).filter((x) => x.a.trim());
  }
  if (answers && typeof answers === 'object') return Object.entries(answers).map(([q, a]) => ({ q, a: String(a ?? '') })).filter((x) => x.a.trim());
  return [];
}

const TESTER_EVENT = { approve: 'Approved', decline: 'Declined', pause: 'Paused', resume: 'Resumed', remove: 'Removed', apply: 'Applied' };
/** A tester's history, oldest first: "Approved by Admin A · 21 Oct 2026". */
export function testerHistory(events) {
  return (Array.isArray(events) ? events : []).map((e) => ({
    key: e.id,
    line: `${TESTER_EVENT[e.action] || 'Changed'}${e.actor_name ? ` by ${e.actor_name}` : ''}`,
    on: dayText(e.created_at) || 'Date not recorded',
    reason: e.reason || null,
  }));
}

/** What a tester's drawer offers, by status. Declined and removed are the record. */
export function testerActions(status) {
  if (status === 'applied') return ['decline', 'approve'];
  if (status === 'active') return ['pause-remove'];
  if (status === 'paused') return ['remove', 'resume'];
  return [];
}

/* ------------------------------------------------------------------ *
 * The decisions (APR5, APR7, APR8): what each dialog says changes, who
 * is told, and what is recorded. A refusal needs a reason the other person
 * sees; the minimums are the Worker's.
 * ------------------------------------------------------------------ */

export const REASON_MIN = { tester_decline: 10, tester_pause: 1, tester_remove: 1, pitch_reject: 10, expert_decline: 10 };
export const reasonReady = (kind, text) => String(text || '').trim().length >= (REASON_MIN[kind] || 0);

/** A published link the Worker takes: a complete https address, no credentials, at most 500 characters. */
export function publishUrlOk(raw) {
  const v = String(raw || '').trim();
  if (!v || v.length > 500) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch { return false; }
}

/** The dialog's words for one decision. `who` is the person's name; `profile` a tester's. */
export function decisionCopy(kind, { who = 'They', profile, partner, version } = {}) {
  const name = who || 'They';
  switch (kind) {
    case 'tester_approve': return {
      title: `Approve ${name} as a product tester?`, button: 'Approve',
      changes: `They join the tester pool, and testing programs can pick them. They keep their ${profile || 'current'} profile.`,
      told: 'They are told by email and in their inbox.',
      recorded: 'Recorded in their history: who approved them and when. Your note is kept for admins.',
    };
    case 'tester_decline': return {
      title: `Decline ${name}’s application?`, button: 'Decline',
      changes: 'They can apply again after 90 days.',
      told: 'They are told by email and in their inbox, with your reason.',
      recorded: 'Recorded in their history: who declined them, when and why.',
    };
    case 'tester_pause': return {
      title: `Pause or remove ${name}?`, button: 'Pause',
      changes: 'Pause: no new programs; current ones carry on.',
      told: 'They are told by email and in their inbox, with your reason.',
      recorded: 'Recorded in their history: who paused them, when and why.',
    };
    case 'tester_remove': return {
      title: `Remove ${name}?`, button: 'Remove',
      changes: 'Remove: they leave the pool; their open program places end.',
      told: 'They are told by email and in their inbox, with your reason.',
      recorded: 'Recorded in their history: who removed them, when and why, and each program place that ended.',
    };
    case 'tester_resume': return {
      title: `Resume ${name}?`, button: 'Resume',
      changes: 'They are back in the tester pool, and testing programs can pick them again.',
      told: 'They are told by email and in their inbox.',
      recorded: 'Recorded in their history: who resumed them and when.',
    };
    case 'pitch_approve': return {
      title: `Approve ${partner || 'the partner'}’s pitch?`, button: 'Approve',
      changes: 'An attribution code is issued, and they can start preparing it. Nothing is published yet.',
      told: `${partner || 'The partner'} is told by email and in their inbox.`,
      recorded: 'Recorded on the pitch: who approved it and when.',
    };
    case 'pitch_reject': return {
      title: `Decline ${partner || 'the partner'}’s pitch?`, button: 'Decline',
      changes: 'A declined pitch is closed; they can send a new one.',
      told: `${partner || 'The partner'} is told by email and in their inbox, with your reason.`,
      recorded: 'Recorded on the pitch: who declined it, when and why.',
    };
    case 'pitch_publish': return {
      title: 'Mark it published?', button: 'Publish',
      changes: 'It appears on the published list for members, with its attribution code.',
      told: `${partner || 'The partner'} is told by email and in their inbox, with the link.`,
      recorded: 'Recorded on the pitch: who published it, when, and the link.',
    };
    case 'expert_verify': return {
      title: `Verify ${name}?`, button: 'Verify',
      changes: 'They appear in the wellbeing directory for members.',
      told: 'They are told by email and in their inbox.',
      recorded: `Recorded: who verified them, when, and that you checked their credentials${version != null ? ` (review version ${version})` : ''}.`,
    };
    case 'expert_decline': return {
      title: `Decline ${name}?`, button: 'Decline',
      changes: 'They can update their profile and ask again.',
      told: 'They are told by email and in their inbox, with your reason.',
      recorded: 'Recorded: who declined them, when and why.',
    };
    case 'expert_hide': return {
      title: `Hide ${name} from the directory?`, button: 'Hide',
      changes: 'Members can no longer find or book them. Their record stays.',
      told: 'They are told by email and in their inbox.',
      recorded: 'Recorded in their decision history: who hid them and when.',
    };
    case 'expert_restore': return {
      title: `Restore ${name} to the directory?`, button: 'Restore',
      changes: 'Members can find them again if they are verified.',
      told: 'They are told by email and in their inbox.',
      recorded: 'Recorded in their decision history: who restored them and when.',
    };
    case 'expert_unverify': return {
      title: `Remove ${name}’s verification?`, button: 'Remove verification',
      changes: 'They leave the directory until they are verified again.',
      told: 'They are told by email and in their inbox.',
      recorded: 'Recorded in their decision history: who removed it and when.',
    };
    default: return null;
  }
}

/** The line a board shows after a decision lands. */
export function doneLine(kind, who, extra = {}) {
  const name = who || 'They';
  const ended = Number(extra.places_ended) || 0;
  return {
    tester_approve: `${name} is a product tester now. They are told.`,
    tester_decline: `${name}’s application is declined. They are told, with your reason.`,
    tester_pause: `${name} is paused. They are told, with your reason.`,
    tester_remove: `${name} is removed from the pool${ended ? `, and ${ended} open program ${ended === 1 ? 'place' : 'places'} ended` : ''}. They are told, with your reason.`,
    tester_resume: `${name} is back in the pool. They are told.`,
    pitch_approve: `${name} is approved, with an attribution code. The partner is told.`,
    pitch_reject: `${name} is declined. The partner is told, with your reason.`,
    pitch_publish: `${name} is published. The partner is told.`,
    expert_verify: `${name} is verified and listed. They are told.`,
    expert_decline: `${name} is declined. They are told, with your reason.`,
    expert_hide: `${name} is hidden from the directory. They are told.`,
    expert_restore: `${name} is back in the directory. They are told.`,
    expert_unverify: `${name}’s verification is removed. They are told.`,
  }[kind] || 'Saved.';
}

/** A refusal in the Worker's own sentence (the client's `e.message`), or one that says nothing changed. */
export function refusalLine(e) {
  const said = typeof e?.message === 'string' && e.message.includes(' ') && e.message !== 'Request failed' ? e.message : null;
  if (said && e?.status && e.status < 500) return said;
  if (e?.status >= 500 || !e?.status) return 'This could not be saved. Nothing changed. Read the item again before retrying.';
  return 'This was refused. Nothing changed. Read the item again before retrying.';
}
