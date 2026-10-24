/**
 * D893 (#2366, #2660) — Admin › Insights, the page's model. Pure: no React, no fetch.
 *
 * The canvas is "Admin Insights" (INS1–INS11). This file turns the page's one
 * read, `GET /api/admin/insights` (#2660, any admin, counts only), into the
 * canvas's KPI tiles and blocks, each in one of four states, so a figure that
 * could not be read never shows as a zero:
 *   ready       a measured value (0 is a value)
 *   loading     the read has not answered
 *   unreadable  the read, or that block's own store, failed; `reason` says so
 *   unrecorded  nothing counts it yet; `reason` says what is missing
 *
 * The Worker answers each block alone: `{ available: true, … }`,
 * `{ available: false, unreadable: true, reason }` or `{ recorded: false,
 * reason }`. `blockState` maps the last two onto the page's states, and every
 * builder below starts from it.
 *
 * THE FILTERS ARE THE URL'S. `range`, `profile`, `country` and `compare` are
 * query parameters, so a filtered view can be linked, and the read is made
 * with exactly what the URL holds (`readParams`).
 */

export const INSIGHTS_PATH = '/admin/insights';
export const MOVED_KEY = 'held-insights';
export const MOVED_NOTICE = 'Insights has a new address. Update your bookmark.';
export const SCOPE_LABEL = 'HQ-held accounts · axal.vc';
export const SCOPE_TITLE = 'No subsidiary is deployed yet, so these are the accounts HQ holds directly.';
export const SCOPE_NOTE = 'Today only HQ-held accounts exist. Subsidiaries appear here once they are deployed.';
/** D893 S08 (#2662): what the chip adds to a picked subsidiary's name (INS2). */
export const SCOPE_SOURCE = 'counts read from its own database';
export const SCOPE_READING = 'Reading the scope…';
export const HQ_SCOPE = { code: 'hq', label: 'HQ-held accounts', kind: 'hq' };
export const NO_PERMISSION = 'This view is for HQ. You see the accounts you manage.';
export const NO_PERMISSION_FILTER = 'Only HQ can look at another studio’s accounts.';
export const PAGE_UNREADABLE = 'Insights could not be read. Try again.';
export const EMPTY_LINE = 'No accounts yet. When people join, this page fills in.';

/** The ranges the canvas offers: the Worker's `ANALYTICS_RANGES`. */
export const RANGES = [
  { key: '8w', label: '8 weeks' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];
const RANGE_KEYS = RANGES.map((r) => r.key);

/**
 * The canvas's profile chips. `role` is the `users.role` the Worker filters
 * on; a chip with `waits` is drawn but cannot be chosen, and says why.
 */
export const PROFILE_FILTERS = [
  { label: 'All', role: null },
  { label: 'Founders', role: 'founder' },
  { label: 'Investors', role: 'investor' },
  { label: 'LPs', role: null, waits: 'LPs are investors with an approved LP application, not a profile of their own, so they are counted inside Investors.' },
  { label: 'Advisors', role: 'advisor' },
  { label: 'Operating Partners', role: 'partner' },
  { label: 'Explorers', role: 'exploring' },
  { label: 'Product testers', role: null, waits: 'A Product tester is a sub-account that #2377 has not defined yet, so nothing marks one.' },
];

/**
 * The chart palette (#2375's one palette): violet, sky, amber, emerald, muted.
 * Only violet changes in dark mode, as the canvas's INS6 says.
 */
export const PALETTE = ['violet', 'sky', 'amber', 'emerald', 'muted'];

/** A Worker role → the profile the canvas names, and its palette slot. */
const PROFILE_OF = {
  founder: { key: 'founder', label: 'Founders', tone: 'violet' },
  investor: { key: 'investor', label: 'Investors', tone: 'sky' },
  advisor: { key: 'advisor', label: 'Advisors', tone: 'amber' },
  mentor: { key: 'advisor', label: 'Advisors', tone: 'amber' },
  partner: { key: 'partner', label: 'Operating Partners', tone: 'emerald' },
  exploring: { key: 'exploring', label: 'Explorers', tone: 'muted' },
  explorer: { key: 'exploring', label: 'Explorers', tone: 'muted' },
  admin: { key: 'admin', label: 'Admins', tone: 'muted' },
};

export function profileOf(role) {
  const r = String(role || '').trim().toLowerCase();
  if (PROFILE_OF[r]) return PROFILE_OF[r];
  if (!r || r === 'no role' || r === 'no account') return { key: 'none', label: r === 'no account' ? 'No account' : 'No role', tone: 'muted' };
  return { key: r, label: r.charAt(0).toUpperCase() + r.slice(1), tone: 'muted' };
}

const nf = (n) => Number(n).toLocaleString('en-US');
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const usd = (v) => `$${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → '31 Aug'. */
export function dayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** 'YYYY-MM-DD' → '8 Sep 2026'. */
export function dateLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${dayLabel(iso)} ${m[1]}` : String(iso || '');
}

/** A Date → '24 Oct 2026, 09:40 UTC'. */
export function asOfLabel(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/* ------------------------------------------------------------------ *
 * The filters, from and to the URL
 * ------------------------------------------------------------------ */

/** What the URL asks the page to show. Anything it does not recognise is the default. */
export function filtersFromSearch(search) {
  const p = new URLSearchParams(search || '');
  const range = RANGE_KEYS.includes(p.get('range')) ? p.get('range') : '8w';
  const role = p.get('profile');
  const profile = PROFILE_FILTERS.some((f) => f.role && f.role === role) ? role : null;
  const country = (p.get('country') || '').trim() || null;
  return { range, profile, country, compare: p.get('compare') === '1' };
}

/** The read's query: the filters, and the group when the lightbox is open. Unset ones are left out. */
export function readParams(filters, group = null) {
  return {
    range: filters.range === '8w' ? undefined : filters.range,
    profile: filters.profile || undefined,
    country: filters.country || undefined,
    compare: filters.compare || undefined,
    group: group || undefined,
  };
}

export function rangeLabel(key) {
  return RANGES.find((r) => r.key === key)?.label || '8 weeks';
}

/** How many filters differ from the defaults: the badge on the phone's Filters button. */
export function activeFilterCount(f) {
  return (f.range !== '8w' ? 1 : 0) + (f.profile ? 1 : 0) + (f.country ? 1 : 0) + (f.compare ? 1 : 0);
}

/* ------------------------------------------------------------------ *
 * States
 * ------------------------------------------------------------------ */

const ready = (data) => ({ state: 'ready', ...data });
const loading = () => ({ state: 'loading' });
const unreadable = (reason) => ({ state: 'unreadable', reason });
const unrecorded = (reason) => ({ state: 'unrecorded', reason });

const READ_FAILED = 'Insights could not be read. This is not a claim that the count is zero.';
const NOT_IN_ANSWER = 'This block was not in the answer, so it is not shown as zero.';

/**
 * One Worker block → `null` when it is readable, else the page state to draw.
 * The read itself loading or failing decides first.
 */
export function blockState(read, block) {
  if (!read || read.status === 'loading') return loading();
  if (read.status === 'error') return unreadable(READ_FAILED);
  if (!block) return unreadable(NOT_IN_ANSWER);
  if (block.recorded === false) return unrecorded(block.reason);
  if (block.available === false) return unreadable(block.reason || READ_FAILED);
  return null;
}

const data = (read) => (read?.status === 'ready' ? read.data || {} : {});
const kpi = (read, k) => data(read).kpis?.[k];
const blk = (read, k) => data(read).blocks?.[k];

/* ------------------------------------------------------------------ *
 * The KPI row (INS1)
 * ------------------------------------------------------------------ */

export function buildKpis({ insights }) {
  const tiles = [];
  const accounts = kpi(insights, 'accounts');

  {
    const s = blockState(insights, accounts);
    tiles.push({
      key: 'accounts', label: 'Accounts', ...(s || ready({
        value: nf(accounts.total),
        delta: accounts.new_30d ? `+${nf(accounts.new_30d)} in 30 days` : '',
        deltaTone: 'positive',
        sub: `${nf(accounts.deactivated)} deactivated`,
      })),
    });
  }
  {
    const n = kpi(insights, 'new_this_week');
    const s = blockState(insights, n);
    tiles.push({
      key: 'new', label: 'New this week', ...(s || ready({
        value: nf(n.count), tag: 'to date', sub: `${nf(n.last_week)} last week`,
      })),
    });
  }
  {
    const a = kpi(insights, 'active_last_week');
    let s = blockState(insights, a);
    if (!s && (a.value === null || a.value === undefined)) {
      s = unrecorded('The request log holds nothing for last week, so it is left blank rather than shown as zero.');
    }
    let delta = '';
    let deltaTone = '';
    if (!s && Number.isFinite(a.week_before) && a.week_before > 0) {
      const change = Math.round(((a.value - a.week_before) / a.week_before) * 100);
      delta = `${change >= 0 ? '+' : '−'}${Math.abs(change)}% on the week before`;
      deltaTone = change >= 0 ? 'positive' : 'negative';
    }
    const total = accounts?.available ? accounts.total : null;
    tiles.push({
      key: 'active', label: 'Active last week', ...(s || ready({
        value: nf(a.value), sub: Number.isFinite(total) && total > 0 ? `${pct(a.value, total)}% of accounts` : '', delta, deltaTone,
      })),
    });
  }
  {
    const a = kpi(insights, 'activated');
    let s = blockState(insights, a);
    if (!s && a.rate_pct === null) s = unrecorded('No sign-up week in this range has finished its second week yet.');
    tiles.push({
      key: 'activated', label: 'Activated', ...(s || ready({
        value: `${Math.round(a.rate_pct)}%`,
        sub: `of accounts whose second week has ended were active in it (${nf(a.cohorts_counted)} sign-up week${a.cohorts_counted === 1 ? '' : 's'})`,
      })),
    });
  }
  return tiles;
}

/* ------------------------------------------------------------------ *
 * The blocks (INS1)
 * ------------------------------------------------------------------ */

/** The canvas's "How is this counted?" text, one entry per block (INS4). The Worker's sentence wins when it sends one. */
export const DEFINITIONS = {
  who: {
    title: 'Who your accounts are',
    body: 'Accounts that are not deactivated, grouped by the profile each one chose. An account has one profile.',
    more: [['LPs', 'investors with an approved LP application.'], ['Product testers', 'a sub-account any profile can apply for, so they are not added to the total.']],
  },
  plan: { title: 'Plan', body: 'Accounts on each plan today. Paid is every plan that is not free.' },
  growth: { title: 'Growth', body: 'New accounts per week, deactivated ones included. Weeks run Monday to Sunday in UTC. The current week is to date.' },
  activity: {
    title: 'Active accounts',
    body: 'An active account is a signed-in account that made at least one request the platform logs as activity during the week. Health checks, monitoring and requests refused for rate do not count. Weeks run Monday to Sunday in UTC.',
    more: [['Activated', 'active on any day from day 8 to day 14 after the account was created.']],
  },
  activation: {
    title: 'Activation',
    body: 'Accounts grouped by the UTC week they were created. Signed in: a sign-in in the activity log. Accepted the terms: the current Terms of Service accepted. Active in week two: any logged activity from day 8 to day 14 after the account was created.',
    more: [['Invited', 'counted beside the funnel, not as a step: accounts that came from an accepted invitation.']],
  },
  retention: { title: 'Still active after sign-up', body: 'For each sign-up week, the share of its accounts that made a logged request in the last 30 days.' },
  countries: { title: 'Where they are', body: 'Accounts by the country stated on the profile. Accounts that stated none are shown apart.' },
  identity: { title: 'Identity checks', body: 'Accounts by the state of their identity check: not started, waiting, approved or rejected.' },
  completeness: { title: 'Profile completeness', body: 'Accounts by how much of the profile is filled in, in four bands.' },
  dormant: { title: 'Dormant', body: 'Accounts with no logged activity in the last 30 days.' },
  tickets: { title: 'Open support tickets', body: 'Tickets that are open or in progress now.' },
  spend: { title: 'AI spend this month', body: 'The estimated cost of every AI call this calendar month (UTC), with the number of calls.' },
};

/** The dialog's text for one block: the Worker's sentence when the read sent one. */
export function definitionOf(key, insights) {
  const local = DEFINITIONS[key];
  if (!local) return null;
  const server = data(insights).definitions?.[key];
  return server ? { ...local, body: server } : local;
}

/** The source line under a definition. */
export const SOURCE_LINE = 'Source: this studio’s own database and request log.';

/** #2384's words for the identity-check states. */
export const IDENTITY_WORDS = [
  ['not_started', 'Not started', 'muted'],
  ['pending', 'Waiting', 'amber'],
  ['approved', 'Approved', 'emerald'],
  ['rejected', 'Rejected', 'violet'],
  ['other', 'Other', 'sky'],
];

/** Worker roles merged into the canvas's profiles, largest first. */
function mergeProfiles(list, valueOf) {
  const merged = new Map();
  for (const r of list || []) {
    const p = profileOf(r.profile);
    const cur = merged.get(p.key) || { ...p, value: 0 };
    cur.value += valueOf(r);
    merged.set(p.key, cur);
  }
  return [...merged.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function whoBlock(insights) {
  const base = { key: 'who', title: 'Who your accounts are', span: 8 };
  const w = blk(insights, 'who');
  const s = blockState(insights, w);
  if (s) return { ...base, ...s };
  const rows = mergeProfiles(w.by_profile, (r) => Number(r.count) || 0);
  const top = rows[0];
  const lps = w.lps === null || w.lps === undefined ? `not read: ${w.lps_reason || 'the LP applications could not be read'}` : `${nf(w.lps)} investors with an approved LP application`;
  const testers = w.product_testers?.recorded === false ? `not recorded: ${w.product_testers.reason}` : '';
  return {
    ...base, ...ready({
      take: top && w.total ? `${top.label} are the largest group, ${pct(top.value, w.total)}% of accounts.` : 'No accounts match these filters.',
      chart: { type: 'hbar', rows: rows.map((r) => ({ label: r.label, value: r.value, tone: r.tone, group: r.key })), axis: 'accounts', clickable: true },
      alt: `Accounts by profile: ${rows.map((r) => `${r.label} ${nf(r.value)}`).join(', ')}. Total ${nf(w.total)}.`,
      badges: [['LPs', lps], ...(testers ? [['Product testers', testers]] : [])],
      foot: `LPs and Product testers sit inside a profile, so they are not added to the total. Total ${nf(w.total)}.`,
    }),
  };
}

function planBlock(insights) {
  const base = { key: 'plan', title: 'Plan', span: 4 };
  const p = blk(insights, 'plan');
  const s = blockState(insights, p);
  if (s) return { ...base, ...s };
  // Free is muted; the paid tiers take the palette in order, violet first.
  let paidSlot = 0;
  const parts = (p.by_tier || []).map((t) => ({
    label: t.tier === 'free' ? 'Free' : t.tier.charAt(0).toUpperCase() + t.tier.slice(1),
    value: Number(t.count) || 0,
    tone: t.tier === 'free' ? 'muted' : PALETTE[paidSlot++ % 4],
  }));
  return {
    ...base, ...ready({
      take: p.paid_pct === null ? 'No accounts match these filters.' : `${p.paid_pct}% of accounts are on a paid plan.`,
      chart: { type: 'donut', parts, center: p.paid_pct === null ? '—' : `${Math.round(p.paid_pct)}%`, centerSub: 'paid' },
      alt: `Accounts by plan: ${parts.map((x) => `${x.label} ${nf(x.value)}`).join(', ')}. ${nf(p.paid)} paid.`,
      legend: parts.map((x) => ({ label: `${x.label} ${nf(x.value)}`, tone: x.tone })),
    }),
  };
}

function growthBlock(insights, range) {
  const base = { key: 'growth', title: 'Growth', span: 12 };
  const g = blk(insights, 'growth');
  const s = blockState(insights, g);
  if (s) return { ...base, ...s };
  const weeks = g.weeks || [];
  const profiles = mergeProfiles(
    Object.keys(Object.assign({}, ...weeks.map((w) => w.by_profile || {}))).map((p) => ({ profile: p })),
    (r) => weeks.reduce((t, w) => t + (Number(w.by_profile?.[r.profile]) || 0), 0),
  );
  // The roles each canvas profile merges, so a stack adds mentors to Advisors.
  const rolesOf = (key) => Object.keys(Object.assign({}, ...weeks.map((w) => w.by_profile || {}))).filter((r) => profileOf(r).key === key);
  const stacks = profiles.map((p, i) => ({ key: p.key, label: p.label, tone: PALETTE[i % PALETTE.length], roles: rolesOf(p.key) }));
  const total = weeks.reduce((t, w) => t + w.total, 0);
  const full = weeks.filter((w) => !w.to_date);
  const lastFull = full[full.length - 1];
  return {
    ...base, ...ready({
      take: `${nf(total)} new accounts in ${rangeLabel(range).toLowerCase()}${lastFull ? `, ${nf(lastFull.total)} last week` : ''}.`,
      chart: {
        type: 'stack',
        rows: weeks.map((w) => ({
          label: dayLabel(w.week),
          value: w.total,
          toDate: w.to_date,
          text: w.to_date ? `${nf(w.total)} to date` : nf(w.total),
          parts: stacks.map((st) => ({ tone: st.tone, value: st.roles.reduce((t, r) => t + (Number(w.by_profile?.[r]) || 0), 0) })),
        })),
      },
      alt: `New accounts per week, ${dayLabel(weeks[0]?.week)} to ${dayLabel(weeks[weeks.length - 1]?.week)}: ${weeks.map((w) => (w.to_date ? `and ${w.total} to date` : w.total)).join(', ')}.`,
      legend: [...stacks.map((st) => ({ label: st.label, tone: st.tone })), { label: 'This week, to date', tone: 'hatch' }],
      foot: 'Weeks start Monday, UTC. Y axis: new accounts that week, by profile.',
    }),
  };
}

function activityBlock(insights, compare) {
  const base = { key: 'activity', title: 'Activity', span: 12 };
  const a = blk(insights, 'activity');
  const s = blockState(insights, a);
  if (s) return { ...base, ...s };
  const values = a.values || [];
  const weeks = a.weeks || data(insights).weeks || [];
  const last = values[values.length - 2];
  const known = values.slice(0, -1).filter((v) => v !== null);
  const most = known.length > 1 && last !== null && last === Math.max(...known);
  const previous = compare && Array.isArray(a.previous) ? a.previous : null;
  return {
    ...base, ...ready({
      take: last === null || last === undefined ? 'Last week has no recorded value.' : `${nf(last)} accounts were active last week${most ? ', the most in this range' : ''}.`,
      chart: { type: 'line', values, labels: weeks.map(dayLabel), previous },
      alt: `Active accounts per week: ${values.map((v, i) => (i === values.length - 1 ? `and ${v ?? 'none'} to date` : v ?? 'none')).join(', ')}.${previous ? ` The period before: ${previous.map((v) => v ?? 'none').join(', ')}.` : ''}`,
      legend: [
        { label: 'Active accounts', tone: 'violet' },
        { label: 'This week, to date (hollow point)', tone: 'hollow' },
        ...(previous ? [{ label: 'The period before', tone: 'dotted' }] : []),
      ],
      note: values.some((v) => v === null) ? 'A week before the request log began is left blank, not drawn as zero.' : '',
      foot: 'Active: a signed-in account with at least one logged request that week.',
    }),
  };
}

/** The cohort the funnel shows: `pick` if it is one of the weeks, else the newest whose week two has ended. */
export function activationCohort(cohorts, pick) {
  if (!cohorts?.length) return null;
  const picked = cohorts.find((c) => c.week === pick);
  if (picked) return picked;
  const closed = cohorts.filter((c) => !c.week_two_open && c.created > 0);
  return closed[closed.length - 1] || [...cohorts].reverse().find((c) => c.created > 0) || cohorts[cohorts.length - 1];
}

function activationBlock(insights, pick) {
  const base = { key: 'activation', title: 'Activation', span: 6 };
  const a = blk(insights, 'activation');
  const s = blockState(insights, a);
  if (s) return { ...base, ...s };
  const cohorts = a.cohorts || [];
  const c = activationCohort(cohorts, pick);
  if (!c || !c.created) return { ...base, ...unrecorded('No account was created in these weeks.') };
  const step = (label, v) => ({ label, value: v ?? 0, text: v === null || v === undefined ? 'not read' : `${nf(v)} · ${pct(v, c.created)}%`, dash: v === null || v === undefined });
  const rows = [
    { label: 'Created', value: c.created, text: nf(c.created) },
    step('Signed in', c.signed_in),
    step('Accepted the terms', c.terms_accepted),
    c.week_two_open ? { label: 'Active in week two', value: 0, text: 'week two not finished', dash: true } : step('Active in week two', c.active_week_two),
  ];
  const shown = cohorts.filter((x) => x.created > 0);
  return {
    ...base, ...ready({
      select: { value: c.week, options: shown.map((x) => ({ value: x.week, label: `Accounts created in the week of ${dateLabel(x.week)}` })) },
      take: c.week_two_open || c.active_week_two === null
        ? 'That week’s accounts have not finished their second week.'
        : `${pct(c.active_week_two, c.created)}% of that week’s accounts were active in their second week.`,
      chart: { type: 'hbar', rows, axis: '' },
      alt: `Activation funnel for the week of ${dateLabel(c.week)}: created ${c.created}, signed in ${c.signed_in}, accepted the terms ${c.terms_accepted ?? 'not read'}, active in week two ${c.week_two_open ? 'not finished' : c.active_week_two ?? 'not read'}.`,
      note: c.invited === null || c.invited === undefined ? '' : `${nf(c.invited)} of them came from an invitation.`,
      chart2: {
        type: 'columns', pct: true, max: 100,
        rows: shown.map((x) => ({
          label: dayLabel(x.week),
          value: x.week_two_open || x.active_week_two === null ? 0 : pct(x.active_week_two, x.created),
          open: x.week_two_open,
          text: x.week_two_open ? 'open' : `${pct(x.active_week_two ?? 0, x.created)}%`,
        })),
      },
      alt2: 'Share active in week two per sign-up week. Weeks still open have not finished their second week.',
      legend: [{ label: 'Active in week two', tone: 'violet' }, { label: 'Week two not finished', tone: 'dash' }],
    }),
  };
}

function retentionBlock(insights) {
  const base = { key: 'retention', title: 'Still active after sign-up', span: 6 };
  const r = blk(insights, 'retention');
  const s = blockState(insights, r);
  if (s) return { ...base, ...s };
  const rows = (r.cohorts || []).filter((c) => c.signups > 0);
  if (!rows.length) return { ...base, ...unrecorded('No account signed up in these weeks.') };
  const shares = rows.map((c) => pct(c.retained_30d, c.signups));
  const oldest = shares[0];
  const newest = shares[shares.length - 1];
  return {
    ...base, ...ready({
      take: `${oldest}% of the oldest week are still active; ${newest < oldest ? 'newer weeks are lower' : newest > oldest ? 'newer weeks are higher' : 'the newest week is the same'}.`,
      chart: { type: 'columns', pct: true, max: 100, rows: rows.map((c, i) => ({ label: dayLabel(c.week), value: shares[i], text: `${shares[i]}%` })) },
      alt: `Share of each sign-up week active in the last 30 days: ${shares.join(', ')} percent.`,
      foot: 'Y axis: share of that week’s sign-ups active in the last 30 days. Weeks with no sign-up are left out.',
    }),
  };
}

function countriesBlock(insights) {
  const base = { key: 'countries', title: 'Where they are', span: 12 };
  const c = blk(insights, 'countries');
  const s = blockState(insights, c);
  if (s) return { ...base, ...s };
  const rows = (c.rows || []).slice(0, 12);
  const rest = (c.rows || []).slice(12).reduce((t, r) => t + r.count, 0);
  const total = (c.rows || []).reduce((t, r) => t + r.count, 0) + (c.not_stated || 0);
  return {
    ...base, ...ready({
      take: rows[0] ? `${rows[0].country} holds the most accounts, ${pct(rows[0].count, total)}%.` : 'No account has stated a country.',
      chart: rows.length ? { type: 'hbar', rows: [...rows.map((r) => ({ label: r.country, value: r.count })), ...(rest ? [{ label: 'Other countries', value: rest, tone: 'muted' }] : [])], axis: 'accounts' } : null,
      alt: `Accounts by country: ${rows.map((r) => `${r.country} ${nf(r.count)}`).join(', ')}${rest ? `, other countries ${nf(rest)}` : ''}. ${nf(c.not_stated)} stated none.`,
      foot: `${nf(c.not_stated)} accounts stated no country. The country is as written on the profile.`,
    }),
  };
}

function identityBlock(insights) {
  const base = { key: 'identity', title: 'Identity checks', span: 4, link: { label: 'Open KYC & KYB', to: '/admin?tab=kyc' } };
  const i = blk(insights, 'identity');
  const s = blockState(insights, i);
  if (s) return { ...base, ...s };
  const rows = IDENTITY_WORDS.filter(([k]) => k !== 'other' || i.other > 0).map(([k, label, tone]) => ({ label, value: Number(i[k]) || 0, tone }));
  return {
    ...base, ...ready({
      take: `${nf(i.pending)} waiting for a decision.`,
      chart: { type: 'hbar', rows, axis: '' },
      alt: `Identity checks: ${rows.map((r) => `${r.label} ${nf(r.value)}`).join(', ')}.`,
    }),
  };
}

function completenessBlock(insights) {
  const base = { key: 'completeness', title: 'Profile completeness', span: 4 };
  const c = blk(insights, 'completeness');
  const s = blockState(insights, c);
  if (s) return { ...base, ...s };
  const bands = c.bands || [];
  const top = bands[bands.length - 1];
  const counted = bands.reduce((t, b) => t + b.count, 0);
  return {
    ...base, ...ready({
      take: top ? `${pct(top.count, counted)}% of profiles are ${top.band}% complete.` : '',
      chart: { type: 'columns', rows: bands.map((b) => ({ label: `${b.band}%`, value: b.count })) },
      alt: `Profiles by completeness: ${bands.map((b) => `${b.band} percent ${nf(b.count)}`).join(', ')}.`,
      note: c.not_recorded ? `${nf(c.not_recorded)} accounts have no completeness figure, so they are not put in a band.` : '',
    }),
  };
}

function dormantBlock(insights) {
  const base = { key: 'dormant', title: 'Dormant', span: 4 };
  const d = blk(insights, 'dormant');
  const s = blockState(insights, d);
  if (s) return { ...base, ...s };
  return {
    ...base, ...ready({
      take: `No logged request in ${nf(d.days)} days.`,
      big: nf(d.count), bigSub: 'accounts',
      note: [
        d.never_seen ? `${nf(d.never_seen)} accounts have made no request since activity was first recorded, so they are not counted as dormant.` : '',
        d.last_month === null ? `No comparison with last month: ${d.last_month_reason || 'it cannot be read back.'}` : '',
      ].filter(Boolean).join(' '),
      chart: null,
    }),
  };
}

function ticketsBlock(insights) {
  const base = { key: 'tickets', title: 'Open support tickets', span: 6 };
  const t = blk(insights, 'tickets');
  const s = blockState(insights, t);
  if (s) return { ...base, ...s };
  const open = Number(t.by_status?.open) || 0;
  const inProgress = Number(t.by_status?.in_progress) || 0;
  return {
    ...base, ...ready({
      take: open === 1 ? 'One ticket is waiting for a first answer.' : `${nf(open)} tickets are waiting for a first answer.`,
      big: nf(t.open), bigSub: 'open now',
      chart: t.open ? { type: 'bar100', parts: [{ label: 'Open', value: open, tone: 'violet' }, { label: 'In progress', value: inProgress, tone: 'sky' }] } : null,
      alt: `Open support tickets: open ${open}, in progress ${inProgress}.`,
      legend: [{ label: `Open ${nf(open)}`, tone: 'violet' }, { label: `In progress ${nf(inProgress)}`, tone: 'sky' }],
    }),
  };
}

function spendBlock(insights) {
  const base = { key: 'spend', title: 'AI spend this month', span: 6 };
  const sp = blk(insights, 'spend');
  const s = blockState(insights, sp);
  if (s) return { ...base, ...s };
  const rows = mergeProfiles(sp.by_profile, (r) => Number(r.usd) || 0);
  return {
    ...base, ...ready({
      take: rows[0] && sp.usd > 0 ? `${rows[0].label} spent the most, ${pct(rows[0].value, sp.usd)}% of this month’s AI cost.` : 'No AI use this month.',
      big: usd(sp.usd),
      bigSub: `over ${nf(sp.calls)} calls`,
      chart: rows.length ? { type: 'hbar', rows: rows.map((r) => ({ label: r.label, value: Math.round(r.value * 100) / 100, tone: r.tone, text: usd(r.value) })), axis: 'USD' } : null,
      alt: `AI spend this month by profile: ${rows.map((r) => `${r.label} ${usd(r.value)}`).join(', ')}.`,
    }),
  };
}

/** Every block, in the canvas's order. `pick` is the Activation week the viewer chose. */
export function buildBlocks({ insights, filters = { range: '8w', compare: false }, pick }) {
  return [
    whoBlock(insights),
    planBlock(insights),
    growthBlock(insights, filters.range),
    activityBlock(insights, filters.compare),
    activationBlock(insights, pick),
    retentionBlock(insights),
    countriesBlock(insights),
    identityBlock(insights),
    completenessBlock(insights),
    dormantBlock(insights),
    ticketsBlock(insights),
    spendBlock(insights),
  ];
}

/* ------------------------------------------------------------------ *
 * The page's state
 * ------------------------------------------------------------------ */

/** The whole page failed: its one read failed. */
export function pageFailed(insights) {
  return insights?.status === 'error';
}

/** A new studio: the read answered, no filter is set, and it holds no account. */
export function isEmptyStudio(insights, filters) {
  const a = kpi(insights, 'accounts');
  const unfiltered = !filters || (!filters.profile && !filters.country);
  return insights?.status === 'ready' && unfiltered && a?.available === true && a.total === 0;
}

/** The countries the filter offers: the ones the read counted, and the one chosen. */
export function countryOptions(insights, chosen) {
  const rows = blk(insights, 'countries')?.rows || [];
  const list = rows.map((r) => r.country);
  if (chosen && !list.includes(chosen)) list.unshift(chosen);
  return list;
}

/**
 * What `?scope=` asks for. A plain Admin may only see their own accounts, so
 * any other scope is INS10's "no permission". A Super Admin may pick a
 * subsidiary the scopes read listed (D893 S08, #2662): `branch`, read from
 * that subsidiary's own database. Until the list answers the scope is
 * `pending`, and no read is made, so HQ's figures never sit under a
 * subsidiary's name. A code the list does not hold falls back to HQ's own.
 */
export function scopeState(search, superAdmin, scopes = null) {
  const raw = new URLSearchParams(search || '').get('scope');
  const asked = raw ? raw.trim() : '';
  if (!asked || asked === 'hq') return { kind: 'own', asked };
  if (!superAdmin) return { kind: 'noperm', asked };
  if (!Array.isArray(scopes)) return { kind: 'pending', asked };
  const code = asked.toLowerCase();
  const line = scopes.find((s) => s && s.kind === 'branch' && s.code === code);
  return line ? { kind: 'branch', asked, code, label: line.label || code } : { kind: 'unknown', asked };
}

/** The `scope` the read carries: a picked subsidiary's code, else none (this deployment's own). */
export function scopeParam(scope) {
  return scope?.kind === 'branch' ? scope.code : undefined;
}

/** The chip under the title (INS2): HQ-held, or "[Branch North] · counts read from its own database". */
export function scopeChip(scope) {
  if (scope?.kind === 'branch') return `${scope.label} · ${SCOPE_SOURCE}`;
  if (scope?.kind === 'pending') return SCOPE_READING;
  return SCOPE_LABEL;
}

/** The Scope select's lines: the scopes read's, or HQ-held alone until it answers. */
export function scopeLines(scopes) {
  const list = Array.isArray(scopes) ? scopes.filter((s) => s && (s.kind === 'hq' || s.kind === 'branch')) : [];
  return list.some((s) => s.kind === 'hq') ? list : [HQ_SCOPE, ...list];
}

/** The group the URL opens (INS3): `?group=founders`, matched to a profile. */
export function groupFromSearch(search) {
  const raw = new URLSearchParams(search || '').get('group');
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  const byLabel = Object.values(PROFILE_OF).find((p) => p.label.toLowerCase() === k || p.key === k || `${p.key}s` === k);
  return byLabel ? byLabel.key : null;
}

/** Countries in the group's table that match the search box, as typed. */
export function filterCountries(rows, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => String(r.country ?? 'Not stated').toLowerCase().includes(needle));
}

/**
 * The group lightbox's content (INS3), from the read made with `group=<role>`.
 * Counts only; its doors lead to Accounts, which holds the names.
 */
export function buildGroup(key, groupRead) {
  if (!key) return null;
  const label = Object.values(PROFILE_OF).find((p) => p.key === key)?.label || profileOf(key).label;
  const base = { key, label, accountsHref: `/admin/held/accounts?profile=${encodeURIComponent(key)}` };
  const g = data(groupRead).group;
  const s = blockState(groupRead, g);
  if (s) return { ...base, ...s, count: null, tiles: [], countries: [] };
  const v = (x, unit = '') => (x === null || x === undefined ? { text: 'Not recorded', missing: true } : { text: `${nf(x)}${unit}` });
  return {
    ...base,
    state: 'ready',
    count: g.count,
    tiles: [
      ['New in 30 days', v(g.new_30d)],
      ['Active last week', v(g.active_last_week)],
      ['Activated', v(g.activated_pct === null ? null : Math.round(g.activated_pct), '%')],
      ['Dormant', v(g.dormant)],
    ],
    signups: { type: 'columns', rows: (g.signups_by_week || []).map((w) => ({ label: dayLabel(w.week), value: w.count, toDate: w.to_date, text: w.to_date ? `${nf(w.count)} to date` : nf(w.count) })) },
    active: { type: 'line', values: (g.active_by_week || []).map((w) => w.count), labels: (g.active_by_week || []).map((w) => dayLabel(w.week)) },
    countries: (g.by_country || []).map((r) => ({
      country: r.country, accounts: r.accounts, new_30d: r.new_30d, active_last_week: r.active_last_week,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Export (INS5): the Worker's logged, counts-only file (#2661)
 * ------------------------------------------------------------------ */

export const EXPORT_WHAT = [
  { key: 'page', label: 'Figures on this page' },
  { key: 'group', label: 'This group only' },
];
export const EXPORT_FORMATS = [{ key: 'csv', label: 'CSV' }, { key: 'pdf', label: 'PDF' }];
export const EXPORT_LOGGED = 'Each export is logged under your name.';
export const EXPORT_NO_GROUP = 'Open a group to export it alone.';
const EXPORT_FAILED = 'The export could not be made. Try again.';

/**
 * The body of `POST /api/admin/insights/export` for what the page shows: its
 * range, profile, country and selected scope, and the open group when the export is that
 * group alone. Compare is the page's view, not a figure, so it is not sent.
 */
export function exportBody({ what, format, filters, group = null, scope }) {
  const body = { what, format, range: filters.range };
  if (scope) body.scope = scope;
  if (filters.profile) body.profile = filters.profile;
  if (filters.country) body.country = filters.country;
  if (what === 'group' && group) body.group = group;
  return body;
}

/**
 * The toast for an export's answer. The link is the Worker's signed one;
 * `fellBack` says a PDF shipped as HTML because Browser Run could not render
 * it. A refusal carries the Worker's own sentence, never a raw error.
 */
export function exportToast(answer, error = null) {
  if (error || !answer?.download_url) {
    const said = typeof error?.message === 'string' && error.code ? error.message : '';
    return { error: said || EXPORT_FAILED };
  }
  return { url: answer.download_url, format: answer.format, fellBack: answer.format === 'html', expires: answer.expires_in_seconds ?? null };
}

/** The read-only range line in the export dialog: '8 weeks · 31 Aug 2026 to 24 Oct 2026'. */
export function rangeLine(insights, nowMs) {
  const d = data(insights);
  const from = d.weeks?.[0];
  const label = rangeLabel(d.range);
  return from ? `${label} · ${dateLabel(from)} to ${dateLabel(new Date(nowMs).toISOString().slice(0, 10))}` : label;
}
