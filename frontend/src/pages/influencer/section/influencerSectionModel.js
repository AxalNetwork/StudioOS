/**
 * D4289 P7 (#4296) — the Influencer section's words and rules, pure: the six
 * tabs and their addresses, the honest values (a Count, "Fewer than 5", Not
 * recorded, Unreadable, HQ reads), money per currency, and each tab's view of
 * the reads (IN0–IN6, `design/incoming/Influencer Page.dc.html`).
 *
 * THE RULES IT HOLDS.
 *   · A Count is `number | { fewer_than: 5 }`. A group of 1 to 4 reads
 *     "Fewer than 5", never a number (D-h); a counted 0 is 0.
 *   · A figure nothing stores reads Not recorded, and a read that failed reads
 *     Unreadable. Neither is ever 0 or an empty list.
 *   · Money is per currency, one line each, and never summed across currencies.
 *   · Eadwyn's line is the analytics reply's `line`, shown as it is: nothing
 *     here writes a sentence about the figures.
 *   · No referred member is named: no read returns one, and no view here
 *     carries a field that could.
 * Both shapes of the analytics reply are drawn: `main`'s, where visits, paid
 * members, revenue, bonuses, channels, retention and visit → paid are each
 * `{ available: false, reason: 'not_recorded', source }`, and the wired one
 * (#4295), where they carry their figures.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };
export const UNREADABLE = 'Unreadable';
export const HQ_READS = 'HQ reads';
export const SMALL_GROUP = 5;

export const TITLE = 'Influencer';
export const EYEBROW = 'Programs · Influencer';
export const SUBTITLE = 'Share your handle, see what it brings in, and get paid for it.';

/** The six tabs, one address each (IN0–IN6). `/influencer` is the Overview. */
export const TABS = Object.freeze([
  { key: 'overview', label: 'Overview', to: '/influencer' },
  { key: 'links', label: 'Links', to: '/influencer/links' },
  { key: 'offers', label: 'Offers', to: '/influencer/offers' },
  { key: 'earnings', label: 'Earnings', to: '/influencer/earnings' },
  { key: 'audience', label: 'Audience', to: '/influencer/audience' },
  { key: 'resources', label: 'Resources', to: '/influencer/resources' },
]);

/** The tab a pathname opens; anything else under `/influencer` is the Overview. */
export function tabFor(pathname) {
  const p = String(pathname || '').split(/[?#]/)[0].replace(/\/+$/, '');
  return (TABS.find((t) => t.to === p) || TABS[0]).key;
}

/**
 * The viewer's role accent (IN0: "the section keeps the viewer's role accent
 * and adds no colour"): the four licences' own inks, as `workspaces/shellConfig`
 * names them. Anyone else (an admin, an explorer) reads the founder violet,
 * the app's default.
 */
const ACCENTS = {
  founder: {
    button: 'bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-400',
    tab: 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300',
    link: 'text-violet-700 dark:text-violet-300',
    chip: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300',
    bar: 'bg-violet-600 dark:bg-violet-400',
  },
  investor: {
    button: 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:text-white dark:hover:bg-indigo-400',
    tab: 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300',
    link: 'text-indigo-700 dark:text-indigo-300',
    chip: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
    bar: 'bg-indigo-600 dark:bg-indigo-400',
  },
  advisor: {
    button: 'bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-500',
    tab: 'border-emerald-700 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300',
    link: 'text-emerald-700 dark:text-emerald-300',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    bar: 'bg-emerald-700 dark:bg-emerald-400',
  },
  partner: {
    button: 'bg-amber-700 text-white hover:bg-amber-800 dark:bg-amber-600 dark:text-white dark:hover:bg-amber-500',
    tab: 'border-amber-700 text-amber-800 dark:border-amber-400 dark:text-amber-300',
    link: 'text-amber-700 dark:text-amber-300',
    chip: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
    bar: 'bg-amber-700 dark:bg-amber-400',
  },
};
export function accentFor(role) {
  return ACCENTS[role] || ACCENTS.founder;
}

/* ------------------------------------------------------------------ *
 * Honest values
 * ------------------------------------------------------------------ */

/** `{ available: false, reason }`: a figure the reply does not have. */
export function isUnavailable(x) {
  return !!x && typeof x === 'object' && x.available === false;
}

/** 'not_recorded' | 'unreadable' | 'hq_reads' for an unavailable figure; an unknown reason is Unreadable. */
export function unavailableKind(x) {
  if (!isUnavailable(x)) return null;
  return x.reason === 'not_recorded' || x.reason === 'hq_reads' ? x.reason : 'unreadable';
}

const KIND_TEXT = { not_recorded: NOT_RECORDED, unreadable: UNREADABLE, hq_reads: HQ_READS };

/** Whether a Count is a masked small group. */
export function isSmall(c) {
  return !!c && typeof c === 'object' && Number.isFinite(Number(c.fewer_than));
}

/** A Count as words: a number with separators, or "Fewer than 5". Null when it is not a Count. */
export function countText(c) {
  if (typeof c === 'number' && Number.isFinite(c)) return c.toLocaleString('en-US');
  if (isSmall(c)) return `Fewer than ${Number(c.fewer_than)}`;
  return null;
}

/**
 * One figure: `{ state, text, source? }`, `state` one of 'ok', 'small',
 * 'not_recorded', 'unreadable', 'hq_reads'. A figure is a Count, a
 * `{ total, series }` or an unavailable answer; anything else is Unreadable
 * (a reply in another shape is not a zero).
 */
export function figure(x) {
  if (isUnavailable(x)) {
    const kind = unavailableKind(x);
    return { state: kind, text: KIND_TEXT[kind], source: x.source || null };
  }
  const c = x && typeof x === 'object' && 'total' in x ? x.total : x;
  const text = countText(c);
  if (text === null) return { state: 'unreadable', text: UNREADABLE, source: null };
  return { state: isSmall(c) ? 'small' : 'ok', text, value: isSmall(c) ? null : c };
}

/** A failed read of a whole block, as the page holds it: `{ status: 'error' }`. */
export const blockFailed = (state) => state?.status === 'error';

/* ------------------------------------------------------------------ *
 * Money: per currency, never summed
 * ------------------------------------------------------------------ */

/** Cents in one currency, as the board writes it ($1,236.00, €96.00). */
export function money(cents, currency) {
  const n = cents === null || cents === undefined || cents === '' ? NaN : Number(cents);
  const cur = String(currency || '').toUpperCase();
  if (!Number.isFinite(n) || !/^[A-Z]{3}$/.test(cur)) return NOT_RECORDED;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(2)} ${cur}`;
  }
}

/**
 * One line per currency for `field` of a per-currency list
 * (`[{ currency, <field> }]`), sorted by currency. Never summed: two
 * currencies are two lines.
 */
export function moneyLines(list, field) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && typeof r.currency === 'string' && r[field] !== null && r[field] !== undefined && Number.isFinite(Number(r[field])))
    .map((r) => ({ currency: r.currency.toUpperCase(), cents: Number(r[field]), text: money(r[field], r.currency) }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/**
 * A money figure from the analytics reply (`revenue` or `commission`): either
 * unavailable (`{ state, text }`) or `{ state: 'ok', lines }`, one per currency.
 * An empty list is "None yet" — counted, not missing.
 */
export function moneyFigure(x, field) {
  if (isUnavailable(x)) {
    const kind = unavailableKind(x);
    return { state: kind, text: KIND_TEXT[kind], source: x.source || null, lines: [] };
  }
  if (!x || !Array.isArray(x.by_currency)) return { state: 'unreadable', text: UNREADABLE, lines: [] };
  const lines = moneyLines(x.by_currency, field);
  return { state: 'ok', text: lines.length ? lines.map((l) => l.text).join(' · ') : 'None yet', lines };
}

/* ------------------------------------------------------------------ *
 * Header (IN0)
 * ------------------------------------------------------------------ */

/** The handle chip, tier badge and Share target. */
export function headerView(me, handle) {
  const membership = me?.membership || null;
  const h = handle?.handle || membership?.handle || null;
  const url = handle?.url || (h ? `https://axal.vc/@${h}` : null);
  return {
    handle: h,
    chip: h ? `@${h}` : null,
    url,
    shortUrl: url ? String(url).replace(/^https?:\/\//, '') : null,
    tier: membership?.tier_label || null,
    paused: membership ? membership.status !== 'active' : false,
  };
}

/* ------------------------------------------------------------------ *
 * Overview (IN1)
 * ------------------------------------------------------------------ */

const pctOf = (num, den) => {
  if (typeof num !== 'number' || typeof den !== 'number' || den <= 0) return null;
  return `${((num / den) * 100).toFixed(1)}%`;
};

/** The funnel's three steps, each its own honest value, and a share only between two counted numbers. */
export function funnelView(funnel) {
  const f = funnel && typeof funnel === 'object' ? funnel : {};
  const steps = [
    { key: 'visits', label: 'Visits', ...figure(f.visits) },
    { key: 'signups', label: 'Sign-ups', ...figure(f.signups) },
    { key: 'paid', label: 'Paid', ...figure(f.paid) },
  ];
  const share = (i, of) => {
    const s = pctOf(steps[i].value ?? null, steps[i - 1].value ?? null);
    return s ? `${s} of ${of}` : null;
  };
  steps[0].share = null;
  steps[1].share = share(1, 'visits');
  steps[2].share = share(2, 'sign-ups');
  return steps;
}

/** The next milestone, in the reply's own terms: `needs` a number or `{ more_than }`. */
export function milestoneView(bonuses) {
  if (isUnavailable(bonuses)) return { state: unavailableKind(bonuses), text: KIND_TEXT[unavailableKind(bonuses)], source: bonuses.source || null };
  if (!bonuses || typeof bonuses !== 'object' || !Array.isArray(bonuses.earned)) return { state: 'unreadable', text: UNREADABLE };
  const earned = bonuses.earned.map((b) => ({
    milestone: Number(b.milestone),
    text: `${Number(b.milestone)} paid members`,
    amount: money(b.amount_cents, b.currency),
    at: typeof b.achieved_at === 'string' ? b.achieved_at.slice(0, 10) : null,
  }));
  const n = bonuses.next;
  let next = null;
  if (n && Number.isFinite(Number(n.milestone))) {
    const to = n.kind === 'custom' ? `your custom milestone at ${n.milestone}` : `the ${n.milestone}-member bonus`;
    if (typeof n.needs === 'number') next = `${n.needs.toLocaleString('en-US')} more paid member${n.needs === 1 ? '' : 's'} to ${to}`;
    else if (n.needs && Number.isFinite(Number(n.needs.more_than))) next = `More than ${Number(n.needs.more_than)} more paid members to ${to}`;
  }
  return { state: 'ok', earned, next, done: !n };
}

/** A channel's label: `@handle/<channel>`, or `@handle · direct` for visits with no channel. */
export function channelLabel(handle, channel) {
  const h = handle ? `@${handle}` : '@';
  return channel ? `${h}/${channel}` : `${h} · direct`;
}

/** The channels table, from the reply: unavailable, or one row per channel with its three Counts. */
export function channelsView(channels, handle) {
  if (isUnavailable(channels)) return { state: unavailableKind(channels), text: KIND_TEXT[unavailableKind(channels)], source: channels.source || null, rows: [] };
  if (!Array.isArray(channels)) return { state: 'unreadable', text: UNREADABLE, rows: [] };
  return {
    state: 'ok',
    rows: channels.map((c) => ({
      key: c.channel || '(direct)',
      channel: c.channel || null,
      label: channelLabel(handle, c.channel),
      visits: figure(c.visits),
      signups: figure(c.signups),
      paid: figure(c.paid),
    })),
  };
}

/**
 * Nothing to show yet: the reply was read, nothing in it is unreadable, and
 * every counted figure is 0 (or not stored yet) with no money earned. IN1s's
 * "First day · no visits yet".
 */
export function isFirstDay(a) {
  if (!a || typeof a !== 'object') return false;
  const counts = [a.visits, a.signups, a.paid_members].map(figure);
  if (counts.some((c) => c.state === 'unreadable')) return false;
  if (counts.some((c) => c.state === 'small' || (c.state === 'ok' && c.value > 0))) return false;
  const com = a.commission;
  if (isUnavailable(com)) return unavailableKind(com) !== 'unreadable' && counts.some((c) => c.state === 'ok');
  if (!com || !Array.isArray(com.by_currency)) return false;
  const any = com.by_currency.some((m) => ['pending_cents', 'payable_cents', 'in_payout_cents', 'paid_cents', 'reversed_cents'].some((k) => Number(m[k]) > 0));
  return !any && counts.some((c) => c.state === 'ok');
}

/** The weekly commission per currency: one series per currency, never added together. */
export function weeklyByCurrency(commission) {
  if (isUnavailable(commission) || !commission || !Array.isArray(commission.series)) return [];
  const by = new Map();
  for (const p of commission.series) {
    if (!p || typeof p.currency !== 'string') continue;
    if (!by.has(p.currency)) by.set(p.currency, []);
    by.get(p.currency).push({ week: p.week, cents: Number(p.earned_cents) || 0 });
  }
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([currency, weeks]) => ({ currency, weeks }));
}

/** Everything the Overview draws, from the analytics reply. */
export function overviewView(a, handle) {
  if (!a || typeof a !== 'object') return null;
  const commission = moneyFigure(a.commission, 'payable_cents');
  return {
    firstDay: isFirstDay(a),
    kpis: [
      { key: 'visits', label: 'Visits', ...figure(a.visits) },
      { key: 'signups', label: 'Sign-ups', ...figure(a.signups) },
      { key: 'paid', label: 'Paid members', ...figure(a.paid_members) },
      { key: 'revenue', label: 'Revenue influenced', money: true, ...moneyFigure(a.revenue, 'net_cents') },
      { key: 'commission', label: 'Commission payable', money: true, ...commission },
    ],
    pending: moneyFigure(a.commission, 'pending_cents'),
    payable: commission,
    funnel: funnelView(a.funnel),
    milestone: milestoneView(a.bonuses),
    channels: channelsView(a.channels, handle),
    weekly: weeklyByCurrency(a.commission),
    // Eadwyn's line is the reply's own, never written here.
    line: typeof a.line === 'string' && a.line.trim() ? a.line : null,
    range: a.range ? `${a.range.from} to ${a.range.to}` : null,
  };
}

/* ------------------------------------------------------------------ *
 * Links (IN2)
 * ------------------------------------------------------------------ */

export const CHANNEL_RULE = /^[a-z0-9_]{1,24}$/;

/** The handle's change rule: `{ canChange, line }` from `next_change_at`. */
export function handleChange(handle, now = Date.now()) {
  const next = handle?.next_change_at || null;
  const t = next ? Date.parse(next) : NaN;
  if (Number.isFinite(t) && t > now) {
    const days = Math.ceil((t - now) / 86_400_000);
    return { canChange: false, line: `You can change it again in ${days} day${days === 1 ? '' : 's'}. Old links keep working and move to the new handle.` };
  }
  return { canChange: true, line: 'Old links keep working and move to the new handle.' };
}

/** Each sub-link with its figures from the analytics reply's channels (or their state). */
export function linksView(reply, analytics) {
  const handle = reply?.handle || null;
  const ch = channelsView(analytics ? analytics.channels : { available: false, reason: 'unreadable' }, handle);
  const byChannel = new Map(ch.rows.map((r) => [r.channel, r]));
  const missing = ch.state === 'ok' ? { state: 'ok', text: '0', value: 0 } : { state: ch.state, text: ch.text, source: ch.source || null };
  const links = Array.isArray(reply?.links) ? reply.links : [];
  return {
    handle,
    state: ch.state,
    rows: links.map((l) => {
      const hit = byChannel.get(l.channel);
      return {
        uid: l.uid,
        channel: l.channel,
        label: channelLabel(handle, l.channel),
        campaign: l.utm_campaign || null,
        url: l.url,
        visits: hit ? hit.visits : missing,
        signups: hit ? hit.signups : missing,
        paid: hit ? hit.paid : missing,
      };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Offers (IN3)
 * ------------------------------------------------------------------ */

/** An offer's status as IN3 names it: Active, Paused by HQ, Ended, Budget used up, or Unreadable. */
export function offerStatus(o) {
  if (!o) return { key: 'unreadable', label: UNREADABLE, tone: 'danger' };
  if (o.code_state === 'unreadable') return { key: 'unreadable', label: UNREADABLE, tone: 'danger' };
  if (o.status === 'ended' || o.code_state === 'ended' || o.code_state === 'expired') return { key: 'ended', label: 'Ended', tone: 'neutral' };
  if (o.status === 'paused' || o.code_state === 'paused') return { key: 'paused', label: 'Paused by HQ', tone: 'warn' };
  if (o.remaining_budget && typeof o.remaining_budget === 'object' && o.remaining_budget.budget_used) return { key: 'budget_used', label: 'Budget used up', tone: 'warn' };
  return { key: 'active', label: 'Active', tone: 'ok' };
}

const asText = (v) => (typeof v === 'string' && v ? v : NOT_RECORDED);

/** One offer card. `discount_given` is per currency; an empty list (no uses) is "None yet". */
export function offerView(o) {
  const status = offerStatus(o);
  const plans = Array.isArray(o?.plans) ? o.plans : [asText(o?.plans)];
  const given = Array.isArray(o?.discount_given)
    ? (o.discount_given.length ? moneyLines(o.discount_given, 'cents').map((l) => l.text).join(' · ') : 'None yet')
    : asText(o?.discount_given);
  const budget = o?.budget && Number.isFinite(Number(o.budget.cents)) ? money(o.budget.cents, o.budget.currency) : NOT_RECORDED;
  const rb = o?.remaining_budget;
  const remaining = rb && typeof rb === 'object' && Number.isFinite(Number(rb.cents))
    ? `${money(rb.cents, rb.currency)} of ${budget}`
    : asText(rb);
  const pct = rb && typeof rb === 'object' && o?.budget?.cents > 0 ? Math.round((Number(rb.cents) / Number(o.budget.cents)) * 100) : null;
  return {
    uid: o?.uid,
    status,
    code: o?.code || null,
    featured: !!o?.featured,
    plans,
    discount: asText(o?.discount),
    whoFor: asText(o?.who_for),
    uses: typeof o?.uses === 'number' ? o.uses.toLocaleString('en-US') : asText(o?.uses),
    given,
    unrecordedUses: Number(o?.uses_without_recorded_discount) > 0 ? Number(o.uses_without_recorded_discount) : 0,
    remaining,
    remainingPct: pct,
    ends: asText(o?.ends_at),
  };
}

/** The plans an "Ask HQ for an offer" request can name (IN3b). */
export const OFFER_PLANS = Object.freeze(['Validate + Build', 'Raise + Grow', 'Investor Pro', 'Advisor Pro', 'Operating Partner Pro']);

/** The `{ message }` the request sends: the influencer's own words, with the plans and date they named. */
export function offerRequestMessage({ plans = [], idea = '', when = '' } = {}) {
  const parts = [];
  if (plans.length) parts.push(`Plans: ${plans.join(', ')}`);
  if (String(idea).trim()) parts.push(`What I have in mind: ${String(idea).trim()}`);
  if (String(when).trim()) parts.push(`When I'll publish: ${String(when).trim()}`);
  return parts.join('\n');
}
export const offerRequestArmed = (draft) => {
  const m = offerRequestMessage(draft);
  return String(draft?.idea || '').trim().length > 0 && m.length <= 2000;
};

/* ------------------------------------------------------------------ *
 * Earnings (IN4)
 * ------------------------------------------------------------------ */

export const EARNING_TILES = Object.freeze([
  { key: 'pending', label: 'Pending · held 30 days', field: 'pending_cents' },
  { key: 'payable', label: 'Payable', field: 'payable_cents' },
  { key: 'in_payout', label: 'In a payout', field: 'in_payout_cents' },
  { key: 'paid', label: 'Paid', field: 'paid_cents' },
  { key: 'reversed', label: 'Reversed', field: 'reversed_cents' },
]);

/** The earnings tiles, each one line per currency (never summed). */
export function earningTiles(commission) {
  return EARNING_TILES.map((t) => ({ ...t, ...moneyFigure(commission, t.field) }));
}

const ITEM_LABEL = {
  identity: 'Identity check', tax_form: 'Tax form', terms: 'Influencer terms', payout_method: 'Payout method', minimum: 'Payout minimum', monthly: 'One payout a month',
};
const itemOf = (r, key) => (Array.isArray(r?.items) ? r.items.find((i) => i?.key === key) : null) || null;

/** The checklist rows, in the Worker's order and words. */
export function readinessRows(r) {
  if (!r || !Array.isArray(r.items)) return [];
  return r.items.map((i) => ({ key: i.key, label: ITEM_LABEL[i.key] || i.key, ready: i.ready === true, line: i.line || '', blocks: i.blocks !== false }));
}

/** A payout method named in the request form: a method, a label and the last four. */
export function methodNamed(draft) {
  return !!draft && ['wire', 'stripe', 'crypto'].includes(draft.method) && String(draft.label || '').trim().length > 0 && /^[0-9A-Za-z]{4}$/.test(String(draft.last4 || ''));
}

/**
 * Request payout stays off until the identity check, the tax form and a
 * payout method are all done (IN4), and until the Worker's own checklist is
 * ready (terms, the minimum, one a month). A first payout names its method in
 * the form, so a named method counts as done.
 */
export function payoutGate(readiness, draft = null) {
  if (!readiness || readiness.ready !== true) return false;
  const ok = (k) => itemOf(readiness, k)?.ready === true;
  return ok('identity') && ok('tax_form') && (ok('payout_method') || methodNamed(draft));
}

/** The payout body for `POST /api/network/payout/request`: the payable balance in the terms' currency. */
export function payoutBody(readiness, draft) {
  const min = itemOf(readiness, 'minimum');
  const method = itemOf(readiness, 'payout_method');
  const named = methodNamed(draft);
  return {
    amount_cents: Number(min?.payable_cents) || 0,
    currency: readiness?.currency || min?.currency || 'USD',
    payout_method: draft?.method || 'wire',
    destination_label: named ? String(draft.label).trim() : method?.label ?? null,
    destination_last4: named ? String(draft.last4) : method?.last4 ?? null,
  };
}

/** What the tax form card offers: upload (missing, rejected), wait (submitted), or nothing (accepted). */
export function taxFormAction(item) {
  const s = item?.status || 'missing';
  if (s === 'accepted') return 'none';
  if (s === 'submitted') return 'wait';
  return 'upload';
}

/** The payout history, from `GET /api/network/payouts/me`: date, amount in its currency, status. Nothing else. */
export function payoutHistory(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((p) => ({
    key: String(p.id ?? p.created_at),
    date: typeof p.created_at === 'string' ? p.created_at.slice(0, 10) : NOT_RECORDED,
    amount: money(p.amount_cents, p.currency || 'USD'),
    status: typeof p.status === 'string' ? p.status : NOT_RECORDED,
  }));
}

/** "Your terms": the tier and its stored rate and duration (`GET /api/influencer/tiers`); unset is "Not set". */
export function termsView(membership, tiers) {
  const t = Array.isArray(tiers) ? tiers.find((x) => x.tier === membership?.tier) : null;
  return [
    { k: 'Tier', v: membership?.tier_label || NOT_RECORDED },
    { k: 'Rate', v: t && t.percentage_bps != null ? `${(Number(t.percentage_bps) / 100).toLocaleString('en-US')}% of each subscription` : 'Not set' },
    { k: 'Duration', v: t && t.duration_invoices != null ? `${t.duration_invoices} invoices per member` : 'Not set' },
    { k: 'Admitted', v: typeof membership?.admitted_at === 'string' ? membership.admitted_at.slice(0, 10) : NOT_RECORDED },
  ];
}

/* ------------------------------------------------------------------ *
 * Audience (IN5)
 * ------------------------------------------------------------------ */

/** Bars for one grouping: each row a Count; "Fewer than 5" draws no bar and no number. */
export function audienceBars(list, key, labelOf = (v) => v) {
  if (isUnavailable(list)) return { state: unavailableKind(list), text: KIND_TEXT[unavailableKind(list)], source: list.source || null, rows: [] };
  if (!Array.isArray(list)) return { state: 'unreadable', text: UNREADABLE, rows: [] };
  return {
    state: 'ok',
    rows: list.map((r, i) => {
      const f = figure(r.members);
      return { key: `${r[key] ?? 'none'}-${i}`, label: labelOf(r[key]), value: f.state === 'ok' ? f.value : null, text: f.text };
    }),
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** `2026-10` → `October 2026`. */
export function monthLabel(m) {
  const x = /^(\d{4})-(\d{2})$/.exec(String(m || ''));
  return x ? `${MONTHS[Number(x[2]) - 1]} ${x[1]}` : String(m || NOT_RECORDED);
}
export const regionLabel = (c) => (c ? String(c) : 'No country recorded');
const FAMILY = { founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', operating_partner: 'Operating Partner' };
export const familyLabel = (f) => FAMILY[f] || (f ? String(f) : NOT_RECORDED);

/**
 * "Still paying, by month joined": each cell the share of the month's members
 * still paying. A month with fewer than 5 members shows "<5", never a share;
 * a cell of 1 to 4 members shows "<5" too.
 */
export function retentionView(retention) {
  if (isUnavailable(retention)) return { state: unavailableKind(retention), text: KIND_TEXT[unavailableKind(retention)], source: retention.source || null, rows: [], width: 0 };
  if (!Array.isArray(retention)) return { state: 'unreadable', text: UNREADABLE, rows: [], width: 0 };
  const width = Math.max(0, ...retention.map((r) => (Array.isArray(r.months) ? r.months.length : 0)));
  return {
    state: 'ok',
    width,
    rows: retention.map((r) => {
      const small = isSmall(r.members) || typeof r.members !== 'number';
      const months = Array.isArray(r.months) ? r.months : [];
      return {
        cohort: monthLabel(r.cohort),
        members: countText(r.members) ?? UNREADABLE,
        cells: Array.from({ length: width }, (_, i) => {
          if (i >= months.length) return '';
          if (small) return i === 0 ? '<5' : '';
          const c = months[i];
          if (isSmall(c)) return '<5';
          return typeof c === 'number' && r.members > 0 ? `${Math.round((c / r.members) * 100)}%` : UNREADABLE;
        }),
      };
    }),
  };
}

/** Time from first visit to paid: the median in days, unless the group is small or nothing is stored. */
export function medianView(x) {
  if (isUnavailable(x)) return { state: unavailableKind(x), text: KIND_TEXT[unavailableKind(x)], source: x.source || null };
  if (!x || typeof x !== 'object' || !('members' in x)) return { state: 'unreadable', text: UNREADABLE };
  if (isSmall(x.members)) return { state: 'small', text: countText(x.members) };
  if (x.days == null) return { state: 'ok', text: 'No paid member yet' };
  const d = Number(x.days);
  return { state: 'ok', text: `${d.toLocaleString('en-US')} day${d === 1 ? '' : 's'}`, members: countText(x.members) };
}

/** Everything the Audience tab draws. */
export function audienceView(a) {
  const au = a?.audience || {};
  return {
    planFamily: audienceBars(au.by_plan_family, 'plan_family', familyLabel),
    region: audienceBars(au.by_region, 'country', regionLabel),
    month: audienceBars(au.by_month_joined, 'month', monthLabel),
    retention: retentionView(au.retention),
    median: medianView(au.visit_to_paid_median_days),
  };
}

/* ------------------------------------------------------------------ *
 * Resources (IN6) — static: the rules the influencer agreed to.
 * ------------------------------------------------------------------ */

export const RESOURCES = Object.freeze({
  disclosure: [
    'Label every post as a paid partnership, with #ad.',
    'Say that you earn a commission when someone subscribes.',
    'Keep the label on reposts and stories.',
  ],
  notPromote: [
    'A specific deal or company raising money.',
    'An Axal VC fund or any fund.',
    'Investment returns. Memberships are software.',
  ],
  brandKit: [
    { key: 'logos', title: 'Logos', sub: 'SVG and PNG, light and dark' },
    { key: 'shots', title: 'Product shots', sub: 'Screens of the product' },
    { key: 'copy', title: 'Approved copy', sub: 'Posts and captions' },
  ],
  brandKitLine: 'Use these as they are. Ask HQ before changing them. HQ has not published the files here yet.',
  faq: [
    { q: 'When am I paid?', a: 'Monthly, once your payable balance reaches the minimum. Commission is held 30 days in case of a refund.' },
    { q: 'What if someone cancels?', a: 'You stop earning on that member. A refund reverses the line it refunds.' },
    { q: 'Can I promote a startup on Axal?', a: 'No. You promote Axal memberships, which are software.' },
  ],
});

/** The Investor Pro benefit from the membership's own flag. */
export function benefitView(membership) {
  if (!membership) return { on: false, text: NOT_RECORDED };
  return membership.investor_pro
    ? { on: true, text: 'Active · included with your tier' }
    : { on: false, text: 'Not included with your tier' };
}
