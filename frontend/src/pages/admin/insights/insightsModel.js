/**
 * D893 (#2366) — Admin › Insights, the page's model. Pure: no React, no fetch.
 *
 * The canvas is "Admin Insights" (INS1–INS11). This file turns the reads the
 * page makes into the canvas's KPI tiles and blocks, each in one of four
 * states, so a figure that could not be read never shows as a zero:
 *   ready       a measured value (0 is a value)
 *   loading     its read has not answered
 *   unreadable  its read failed; `reason` says which and that it is not a zero
 *   unrecorded  no read counts it yet; `reason` says what is missing
 *
 * WHAT IS READ TODAY, and from where:
 *   · the Studio glance (`GET /api/admin/studio/glance`, any admin): accounts
 *     by profile, new in 7/30 days, deactivated, sign-ups per Monday week,
 *     AI spend this month, open tickets by status;
 *   · the analytics overview (`GET /api/monitoring/analytics/overview`, any
 *     admin), once for last week and once for the week before: distinct
 *     signed-in accounts that made a logged request;
 *   · the retention cohorts (`GET /api/monitoring/analytics/cohorts`, any
 *     admin): each sign-up week's share active in the last 30 days;
 *   · HQ analytics (`GET /api/admin/hq/analytics`, Super Admin only): the
 *     HQ-held weekly active line and the activation funnel.
 * Everything else on the canvas waits for the Insights read (#2366's backend
 * task), and says so in its own block.
 */

export const INSIGHTS_PATH = '/admin/insights';
export const MOVED_KEY = 'held-insights';
export const MOVED_NOTICE = 'Insights has a new address. Update your bookmark.';
export const SCOPE_LABEL = 'HQ-held accounts · axal.vc';
export const SCOPE_TITLE = 'No subsidiary is deployed yet, so these are the accounts HQ holds directly.';
export const SCOPE_NOTE = 'Today only HQ-held accounts exist. Subsidiaries appear here once they are deployed.';
export const NO_PERMISSION = 'This view is for HQ. You see the accounts you manage.';
export const NO_PERMISSION_FILTER = 'Only HQ can look at another studio’s accounts.';
export const PAGE_UNREADABLE = 'Insights could not be read. Try again.';
export const EMPTY_LINE = 'No accounts yet. When people join, this page fills in.';

/** The ranges the canvas offers. Only eight weeks is read until the Insights read ships. */
export const RANGES = [
  { key: '8w', label: '8 weeks', ready: true },
  { key: 'quarter', label: 'Quarter', ready: false },
  { key: 'year', label: 'Year', ready: false },
];
export const PROFILE_FILTERS = ['All', 'Founders', 'Investors', 'LPs', 'Advisors', 'Operating Partners', 'Explorers', 'Product testers'];
export const FILTER_WAITS = 'Filtering by range, profile and country arrives with the Insights read.';

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
  explorer: { key: 'explorer', label: 'Explorers', tone: 'muted' },
  admin: { key: 'admin', label: 'Admins', tone: 'muted' },
};

export function profileOf(role) {
  const r = String(role || '').trim().toLowerCase();
  if (PROFILE_OF[r]) return PROFILE_OF[r];
  if (!r || r === 'no role') return { key: 'none', label: 'No role', tone: 'muted' };
  return { key: r, label: r.charAt(0).toUpperCase() + r.slice(1), tone: 'muted' };
}

const nf = (n) => Number(n).toLocaleString('en-US');
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
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

/** Monday 00:00 UTC of the week holding `ms`, as 'YYYY-MM-DD' (the Worker's `weekStart`). */
export function mondayOf(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/**
 * The two whole weeks the overview is read for: last week and the one before,
 * as `{ from, to }` ISO dates (Monday to Sunday, UTC), for `api.analyticsOverview`.
 */
export function lastTwoWeeks(nowMs) {
  const thisMonday = Date.parse(`${mondayOf(nowMs)}T00:00:00Z`);
  const day = 86_400_000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  return {
    last: { from: iso(thisMonday - 7 * day), to: iso(thisMonday - day) },
    before: { from: iso(thisMonday - 14 * day), to: iso(thisMonday - 8 * day) },
  };
}

/**
 * SQLite's `strftime('%Y-W%W')` cohort key → the Monday it starts.
 * `%W` counts weeks from the year's first Monday (week 01); days before it are
 * week 00, whose Monday falls in the previous year.
 */
export function cohortMonday(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const w = Number(m[2]);
  const jan1 = Date.UTC(year, 0, 1);
  const dow = (new Date(jan1).getUTCDay() + 6) % 7; // Monday = 0
  const firstMonday = jan1 + ((7 - dow) % 7) * 86_400_000;
  return new Date(firstMonday + (w - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * States
 * ------------------------------------------------------------------ */

const ready = (data) => ({ state: 'ready', ...data });
const loading = () => ({ state: 'loading' });
const unreadable = (reason) => ({ state: 'unreadable', reason });
const unrecorded = (reason) => ({ state: 'unrecorded', reason });

/** One read's status → the state a block built on it starts from, or null when it is ready. */
function gate(read, reason) {
  if (!read || read.status === 'loading') return loading();
  if (read.status === 'error') return unreadable(reason);
  return null;
}

export const WAITS_FOR_READ = {
  plan: 'Plans are not counted for this page yet: the read that counts accounts by plan is not built.',
  activity: 'Weekly active accounts are not counted for this page yet. Last week’s figure is in the tiles above.',
  activation: 'The activation funnel is read for HQ only today. It reaches this page with the Insights read.',
  activated: 'The activation funnel is read for HQ only today.',
  countries: 'Countries are not counted for this page yet: the read that counts accounts by country is not built.',
  identity: 'Identity checks are not counted for this page yet: the read that counts them by state is not built.',
  completeness: 'Profile completeness is not counted for this page yet.',
  dormant: 'Dormant accounts are not counted for this page yet.',
  lps: 'not counted yet, investors with an approved LP application',
  testers: 'not counted yet, a sub-account any profile can apply for (#2377)',
  spendByProfile: 'AI spend by profile is not counted for this page yet.',
  growthSplit: 'The split by profile is not counted yet, so each week is one column.',
};

/* ------------------------------------------------------------------ *
 * The KPI row (INS1)
 * ------------------------------------------------------------------ */

const GLANCE_FAILED = 'The Studio glance could not be read. This is not a claim that the count is zero.';
const LOG_FAILED = 'The request log did not answer. This is not a claim that nobody was active.';

/** Reads the glance's two HQ blocks, or a failure the tiles can name. */
export function glanceParts(read) {
  const accounts = read?.data?.hq?.accounts;
  const insights = read?.data?.hq?.insights;
  return {
    accounts: accounts && accounts.available !== false && Array.isArray(accounts.by_role) ? accounts : null,
    accountsReason: accounts?.reason || GLANCE_FAILED,
    signups: insights?.signups_by_week?.available ? insights.signups_by_week : null,
    signupsReason: insights?.signups_by_week?.reason || GLANCE_FAILED,
    spend: insights?.ai_spend_month?.available ? insights.ai_spend_month : null,
    spendReason: insights?.ai_spend_month?.reason || GLANCE_FAILED,
    tickets: insights?.open_tickets?.available ? insights.open_tickets : null,
    ticketsReason: insights?.open_tickets?.reason || GLANCE_FAILED,
    hasHq: Boolean(read?.data?.hq),
  };
}

/** The closed activation cohorts of the HQ-held line, or null. */
export function hqActivation(hq) {
  const line = hq?.status === 'ready' ? (hq.data?.activation?.lines || []).find((l) => l.code === 'hq') : null;
  return line && line.available !== false && Array.isArray(line.cohorts) ? line : null;
}

export function buildKpis({ glance, overview, hq, superAdmin }) {
  const g = glanceParts(glance);
  const tiles = [];

  // Accounts
  {
    const s = gate(glance, GLANCE_FAILED);
    if (s) tiles.push({ key: 'accounts', label: 'Accounts', ...s });
    else if (!g.accounts) tiles.push({ key: 'accounts', label: 'Accounts', ...unreadable(g.accountsReason) });
    else {
      tiles.push({
        key: 'accounts', label: 'Accounts', ...ready({
          value: nf(g.accounts.total),
          delta: g.accounts.new_30d ? `+${nf(g.accounts.new_30d)} in 30 days` : '',
          deltaTone: 'positive',
          sub: `${nf(g.accounts.deactivated)} deactivated`,
        }),
      });
    }
  }

  // New this week
  {
    const s = gate(glance, GLANCE_FAILED);
    if (s) tiles.push({ key: 'new', label: 'New this week', ...s });
    else if (!g.signups) tiles.push({ key: 'new', label: 'New this week', ...unreadable(g.signupsReason) });
    else {
      const w = g.signups.weeks;
      const now = w[w.length - 1];
      const prev = w[w.length - 2];
      tiles.push({
        key: 'new', label: 'New this week', ...ready({
          value: nf(now?.count ?? 0), tag: now?.to_date ? 'to date' : '',
          sub: prev ? `${nf(prev.count)} last week` : '',
        }),
      });
    }
  }

  // Active last week
  {
    const s = gate(overview?.last, LOG_FAILED);
    if (s) tiles.push({ key: 'active', label: 'Active last week', ...s });
    else {
      const v = Number(overview.last.data?.active_users) || 0;
      const total = g.accounts?.total;
      const before = overview.before?.status === 'ready' ? Number(overview.before.data?.active_users) : null;
      let delta = '';
      let deltaTone = '';
      if (Number.isFinite(before) && before > 0) {
        const change = Math.round(((v - before) / before) * 100);
        delta = `${change >= 0 ? '+' : '−'}${Math.abs(change)}% on the week before`;
        deltaTone = change >= 0 ? 'positive' : 'negative';
      }
      tiles.push({
        key: 'active', label: 'Active last week', ...ready({
          value: nf(v), sub: Number.isFinite(total) && total > 0 ? `${pct(v, total)}% of accounts` : '', delta, deltaTone,
        }),
      });
    }
  }

  // Activated
  {
    if (!superAdmin) tiles.push({ key: 'activated', label: 'Activated', ...unrecorded(WAITS_FOR_READ.activated) });
    else {
      const s = gate(hq, 'HQ analytics could not be read. This is not a claim that nobody activated.');
      if (s) tiles.push({ key: 'activated', label: 'Activated', ...s });
      else {
        const line = hqActivation(hq);
        const closed = line ? line.cohorts.filter((c) => !c.week_two_open && c.active_week_two !== null) : [];
        const created = closed.reduce((t, c) => t + c.created, 0);
        if (!line) tiles.push({ key: 'activated', label: 'Activated', ...unreadable('The activation funnel could not be read.') });
        else if (!created) tiles.push({ key: 'activated', label: 'Activated', ...unrecorded('No sign-up week has finished its second week yet.') });
        else {
          const active = closed.reduce((t, c) => t + c.active_week_two, 0);
          tiles.push({
            key: 'activated', label: 'Activated', ...ready({
              value: `${pct(active, created)}%`,
              sub: `of accounts whose second week has ended were active in it (last ${closed.length} sign-up weeks)`,
            }),
          });
        }
      }
    }
  }
  return tiles;
}

/* ------------------------------------------------------------------ *
 * The blocks (INS1)
 * ------------------------------------------------------------------ */

/** The canvas's "How is this counted?" text, one entry per block (INS4). */
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
    more: [['LPs', 'investors with an approved LP application.'], ['Activated', 'active on any day from day 8 to day 14 after the account was created.']],
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

/** The source line under a definition. */
export const SOURCE_LINE = 'Source: this studio’s own database and request log.';

function whoBlock(glance, g) {
  const base = { key: 'who', title: 'Who your accounts are', span: 8 };
  const s = gate(glance, GLANCE_FAILED);
  if (s) return { ...base, ...s };
  if (!g.accounts) return { ...base, ...unreadable(g.accountsReason) };
  const merged = new Map();
  for (const r of g.accounts.by_role) {
    const p = profileOf(r.role);
    const cur = merged.get(p.key) || { ...p, value: 0 };
    cur.value += Number(r.count) || 0;
    merged.set(p.key, cur);
  }
  const rows = [...merged.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const total = g.accounts.total;
  const top = rows[0];
  return {
    ...base, ...ready({
      take: top && total ? `${top.label} are the largest group, ${pct(top.value, total)}% of accounts.` : '',
      chart: { type: 'hbar', rows: rows.map((r) => ({ label: r.label, value: r.value, tone: r.tone, group: r.key })), axis: 'accounts', clickable: true },
      alt: `Accounts by profile: ${rows.map((r) => `${r.label} ${nf(r.value)}`).join(', ')}. Total ${nf(total)}.`,
      badges: [['LPs', WAITS_FOR_READ.lps], ['Product testers', WAITS_FOR_READ.testers]],
      foot: `LPs and Product testers sit inside a profile, so they are not added to the total. Total ${nf(total)}.`,
    }),
  };
}

function growthBlock(glance, g) {
  const base = { key: 'growth', title: 'Growth', span: 12 };
  const s = gate(glance, GLANCE_FAILED);
  if (s) return { ...base, ...s };
  if (!g.signups) return { ...base, ...unreadable(g.signupsReason) };
  const weeks = g.signups.weeks;
  const total = weeks.reduce((t, w) => t + w.count, 0);
  const full = weeks.filter((w) => !w.to_date);
  const lastFull = full[full.length - 1];
  return {
    ...base, ...ready({
      take: `${nf(total)} new accounts in eight weeks${lastFull ? `, ${nf(lastFull.count)} last week` : ''}.`,
      chart: {
        type: 'columns',
        rows: weeks.map((w) => ({ label: dayLabel(w.week_start), value: w.count, toDate: w.to_date, text: w.to_date ? `${nf(w.count)} to date` : nf(w.count) })),
      },
      alt: `New accounts per week, ${dayLabel(weeks[0]?.week_start)} to ${dayLabel(weeks[weeks.length - 1]?.week_start)}: ${weeks.map((w) => (w.to_date ? `and ${w.count} to date` : w.count)).join(', ')}.`,
      note: WAITS_FOR_READ.growthSplit,
      legend: [{ label: 'New accounts', tone: 'violet' }, { label: 'This week, to date', tone: 'hatch' }],
      foot: 'Weeks start Monday, UTC. Y axis: new accounts that week.',
    }),
  };
}

function activityBlock(hq, superAdmin) {
  const base = { key: 'activity', title: 'Activity', span: 12 };
  if (!superAdmin) return { ...base, ...unrecorded(WAITS_FOR_READ.activity) };
  const s = gate(hq, LOG_FAILED);
  if (s) return { ...base, ...s };
  const a = hq.data?.active_accounts;
  const line = a?.available ? (a.series || []).find((x) => x.code === 'hq') : null;
  if (!line) return { ...base, ...unreadable(a?.reason || LOG_FAILED) };
  const weeks = hq.data.weeks || [];
  const values = line.values || [];
  const lastIdx = values.length - 2;
  const last = values[lastIdx];
  const known = values.slice(0, -1).filter((v) => v !== null);
  const most = known.length && last !== null && last === Math.max(...known);
  return {
    ...base, ...ready({
      take: last === null || last === undefined ? 'Last week has no recorded value.' : `${nf(last)} accounts were active last week${most ? ', the most in this range' : ''}.`,
      chart: { type: 'line', values, labels: weeks.map(dayLabel) },
      alt: `Active accounts per week: ${values.map((v, i) => (i === values.length - 1 ? `and ${v ?? 'none'} to date` : v ?? 'none')).join(', ')}.`,
      legend: [{ label: 'Active accounts', tone: 'violet' }, { label: 'This week, to date (hollow point)', tone: 'hollow' }],
      foot: 'Active: a signed-in account with at least one logged request that week. HQ-held accounts only.',
    }),
  };
}

/** The cohort the funnel shows: `pick` if it is one of the weeks, else the newest whose week two has ended. */
export function activationCohort(line, pick) {
  if (!line) return null;
  const picked = line.cohorts.find((c) => c.week === pick);
  if (picked) return picked;
  const closed = line.cohorts.filter((c) => !c.week_two_open);
  return closed[closed.length - 1] || line.cohorts[line.cohorts.length - 1] || null;
}

function activationBlock(hq, superAdmin, pick) {
  const base = { key: 'activation', title: 'Activation', span: 6 };
  if (!superAdmin) return { ...base, ...unrecorded(WAITS_FOR_READ.activation) };
  const s = gate(hq, 'HQ analytics could not be read. This is not a claim that nobody activated.');
  if (s) return { ...base, ...s };
  const line = hqActivation(hq);
  if (!line) return { ...base, ...unreadable('The activation funnel could not be read.') };
  const c = activationCohort(line, pick);
  if (!c || !c.created) return { ...base, ...unrecorded('No account was created in these weeks.') };
  const step = (label, v) => ({ label, value: v ?? 0, text: v === null || v === undefined ? 'not read' : `${nf(v)} · ${pct(v, c.created)}%`, dash: v === null || v === undefined });
  const rows = [
    { label: 'Created', value: c.created, text: nf(c.created) },
    step('Signed in', c.signed_in),
    step('Accepted the terms', c.terms_accepted),
    c.week_two_open ? { label: 'Active in week two', value: 0, text: 'week two not finished', dash: true } : step('Active in week two', c.active_week_two),
  ];
  return {
    ...base, ...ready({
      select: { value: c.week, options: line.cohorts.map((x) => ({ value: x.week, label: `Accounts created in the week of ${dateLabel(x.week)}` })) },
      take: c.week_two_open || c.active_week_two === null
        ? 'That week’s accounts have not finished their second week.'
        : `${pct(c.active_week_two, c.created)}% of that week’s accounts were active in their second week.`,
      chart: { type: 'hbar', rows, axis: '' },
      alt: `Activation funnel for the week of ${dateLabel(c.week)}: created ${c.created}, signed in ${c.signed_in}, accepted the terms ${c.terms_accepted ?? 'not read'}, active in week two ${c.week_two_open ? 'not finished' : c.active_week_two ?? 'not read'}.`,
      note: c.invited === null || c.invited === undefined ? '' : `${nf(c.invited)} of them came from an invitation.`,
      chart2: {
        type: 'columns', pct: true, max: 100,
        rows: line.cohorts.map((x) => ({
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

function retentionBlock(cohorts) {
  const base = { key: 'retention', title: 'Still active after sign-up', span: 6 };
  const s = gate(cohorts, LOG_FAILED);
  if (s) return { ...base, ...s };
  const rows = (cohorts.data?.cohorts || [])
    .map((c) => ({ monday: cohortMonday(c.cohort), signups: Number(c.signups) || 0, retained: Number(c.retained_30d) || 0 }))
    .filter((c) => c.monday && c.signups > 0)
    .slice(-8);
  if (!rows.length) return { ...base, ...unrecorded('No account signed up in the last twelve months.') };
  const shares = rows.map((r) => pct(r.retained, r.signups));
  const oldest = shares[0];
  const newest = shares[shares.length - 1];
  return {
    ...base, ...ready({
      take: `${oldest}% of the oldest week are still active; ${newest < oldest ? 'newer weeks are lower' : newest > oldest ? 'newer weeks are higher' : 'the newest week is the same'}.`,
      chart: { type: 'columns', pct: true, max: 100, rows: rows.map((r, i) => ({ label: dayLabel(r.monday), value: shares[i], text: `${shares[i]}%` })) },
      alt: `Share of each sign-up week active in the last 30 days: ${shares.join(', ')} percent.`,
      foot: 'Y axis: share of that week’s sign-ups active in the last 30 days.',
    }),
  };
}

function ticketsBlock(glance, g) {
  const base = { key: 'tickets', title: 'Open support tickets', span: 6 };
  const s = gate(glance, GLANCE_FAILED);
  if (s) return { ...base, ...s };
  if (!g.tickets) return { ...base, ...unreadable(g.ticketsReason) };
  const open = Number(g.tickets.by_status?.open) || 0;
  const inProgress = Number(g.tickets.by_status?.in_progress) || 0;
  return {
    ...base, ...ready({
      take: open === 1 ? 'One ticket is waiting for a first answer.' : `${nf(open)} tickets are waiting for a first answer.`,
      big: nf(g.tickets.open), bigSub: 'open now',
      chart: g.tickets.open ? { type: 'bar100', parts: [{ label: 'Open', value: open, tone: 'violet' }, { label: 'In progress', value: inProgress, tone: 'sky' }] } : null,
      alt: `Open support tickets: open ${open}, in progress ${inProgress}.`,
      legend: [{ label: `Open ${nf(open)}`, tone: 'violet' }, { label: `In progress ${nf(inProgress)}`, tone: 'sky' }],
    }),
  };
}

function spendBlock(glance, g) {
  const base = { key: 'spend', title: 'AI spend this month', span: 6 };
  const s = gate(glance, GLANCE_FAILED);
  if (s) return { ...base, ...s };
  if (!g.spend) return { ...base, ...unreadable(g.spendReason) };
  const usd = Number(g.spend.usd) || 0;
  return {
    ...base, ...ready({
      take: 'This month’s AI use, across every account.',
      big: `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      bigSub: `over ${nf(g.spend.calls)} calls`,
      note: WAITS_FOR_READ.spendByProfile,
      chart: null,
    }),
  };
}

/** Every block, in the canvas's order. `pick` is the Activation week the viewer chose. */
export function buildBlocks({ glance, cohorts, hq, superAdmin, pick }) {
  const g = glanceParts(glance);
  return [
    whoBlock(glance, g),
    { key: 'plan', title: 'Plan', span: 4, ...unrecorded(WAITS_FOR_READ.plan) },
    growthBlock(glance, g),
    activityBlock(hq, superAdmin),
    activationBlock(hq, superAdmin, pick),
    retentionBlock(cohorts),
    { key: 'countries', title: 'Where they are', span: 12, ...unrecorded(WAITS_FOR_READ.countries) },
    { key: 'identity', title: 'Identity checks', span: 4, ...unrecorded(WAITS_FOR_READ.identity), link: { label: 'Open KYC & KYB', to: '/admin?tab=kyc' } },
    { key: 'completeness', title: 'Profile completeness', span: 4, ...unrecorded(WAITS_FOR_READ.completeness) },
    { key: 'dormant', title: 'Dormant', span: 4, ...unrecorded(WAITS_FOR_READ.dormant) },
    ticketsBlock(glance, g),
    spendBlock(glance, g),
  ];
}

/* ------------------------------------------------------------------ *
 * The page's state
 * ------------------------------------------------------------------ */

/** The whole page failed: every read the page made failed. */
export function pageFailed(reads, superAdmin) {
  const list = [reads.glance, reads.cohorts, reads.overview?.last, ...(superAdmin ? [reads.hq] : [])];
  return list.every((r) => r && r.status === 'error');
}

/** A new studio: the glance answered and holds no account. */
export function isEmptyStudio(glance) {
  const a = glanceParts(glance).accounts;
  return glance?.status === 'ready' && Boolean(a) && a.total === 0;
}

/**
 * What `?scope=` asks for. A plain Admin may only see their own accounts, so
 * any other scope is INS10's "no permission". A Super Admin may ask for HQ's
 * accounts; no subsidiary is deployed yet, so any other value falls back.
 */
export function scopeState(search, superAdmin) {
  const raw = new URLSearchParams(search || '').get('scope');
  const asked = raw ? raw.trim() : '';
  if (!asked || asked === 'hq') return { kind: 'own', asked };
  return superAdmin ? { kind: 'unknown', asked } : { kind: 'noperm', asked };
}

/** The group the URL opens (INS3): `?group=founders`, matched to a profile. */
export function groupFromSearch(search) {
  const raw = new URLSearchParams(search || '').get('group');
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  const byLabel = Object.values(PROFILE_OF).find((p) => p.label.toLowerCase() === k || p.key === k || `${p.key}s` === k);
  return byLabel ? byLabel.key : null;
}

/** The group lightbox's content (INS3). Counts only, from the glance. */
export function buildGroup(key, glance) {
  if (!key) return null;
  const g = glanceParts(glance);
  const label = Object.values(PROFILE_OF).find((p) => p.key === key)?.label || profileOf(key).label;
  let count = null;
  if (g.accounts) {
    count = g.accounts.by_role.filter((r) => profileOf(r.role).key === key).reduce((t, r) => t + (Number(r.count) || 0), 0);
  }
  return {
    key,
    label,
    count,
    state: glance?.status === 'ready' ? (g.accounts ? 'ready' : 'unreadable') : glance?.status === 'error' ? 'unreadable' : 'loading',
    tiles: ['New in 30 days', 'Active last week', 'Activated', 'Dormant'],
    waits: 'These figures for one profile arrive with the Insights read.',
    accountsHref: `/admin/held/accounts?profile=${encodeURIComponent(key)}`,
  };
}

/* ------------------------------------------------------------------ *
 * Export (INS5): the figures on the page, as counts only
 * ------------------------------------------------------------------ */

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The page's figures as CSV rows: block, item, value. Counts only — no block
 * on this page carries a name, an email or an id, and none is added here.
 * A block that is not ready is written with its state, never as a zero.
 */
export function figuresCsv({ kpis, blocks, asOf, scope = SCOPE_LABEL }) {
  const out = [['block', 'item', 'value']];
  out.push(['scope', '', scope]);
  out.push(['as of', '', asOf]);
  for (const k of kpis) out.push(['tiles', k.label, k.state === 'ready' ? `${k.value}${k.tag ? ` ${k.tag}` : ''}` : k.state === 'unrecorded' ? 'not recorded' : k.state === 'unreadable' ? 'could not be read' : 'reading']);
  for (const b of blocks) {
    if (b.state !== 'ready') { out.push([b.title, '', b.state === 'unrecorded' ? 'not recorded' : b.state === 'unreadable' ? 'could not be read' : 'reading']); continue; }
    if (b.big) out.push([b.title, b.bigSub || '', b.big]);
    const c = b.chart;
    if (c?.type === 'hbar' || c?.type === 'columns') for (const r of c.rows) out.push([b.title, r.label, r.text ?? r.value]);
    if (c?.type === 'line') c.values.forEach((v, i) => out.push([b.title, c.labels[i] || String(i), v ?? '']));
    if (c?.type === 'bar100') for (const p of c.parts) out.push([b.title, p.label, p.value]);
  }
  return out.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** The read-only range line in the export dialog: '8 weeks · 31 Aug 2026 to 24 Oct 2026'. */
export function rangeLine(glance, nowMs) {
  const w = glanceParts(glance).signups?.weeks;
  const from = w?.[0]?.week_start;
  return from ? `8 weeks · ${dateLabel(from)} to ${dateLabel(new Date(nowMs).toISOString().slice(0, 10))}` : '8 weeks';
}
