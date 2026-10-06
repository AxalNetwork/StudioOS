/**
 * Partner earnings (D569) — the pure half of the four partner screens
 * (`/partner/earnings`, `/partner/referrals`, `/partner/relationships/:id`,
 * `/partner/leaderboard`) and the admin console `/admin/commissions`.
 *
 * Nothing here renders and nothing here fetches. Every vocabulary below is
 * the Worker's own, mirrored, and `frontend/test/partner_earnings_d569.test.mjs`
 * reads it back out of `cloudflare-worker/src/routes/network.ts` and
 * `partnernet.ts`, so a value added there fails the test until it is added here.
 *
 * THREE RULES THE ROUTES FORCE ON THE PAGES, said once:
 *
 *   1. MONEY IS PER CURRENCY. `commissions.currency` is a column, and a
 *      purchase commission carries the payment's own currency. The route's
 *      `balance_cents` and `lifetime_cents` add cents across currencies, so the
 *      pages total the rows themselves, one sum per currency, and never print a
 *      figure without its code.
 *   2. A PAYOUT IS A RUN OF WHOLE COMMISSIONS. `POST /network/payout/request`
 *      walks the accrued rows oldest first and refuses an amount that is not
 *      the sum of the first N of them, or is under 1000 cents. So the form
 *      offers exactly those sums (`payoutOptions`) rather than a free amount the
 *      route would refuse.
 *   3. ABSENT IS NEVER ZERO. Every reader here returns `null` for a value the
 *      row does not hold, and the page decides how "Not recorded" reads.
 */
import { bpsPercent } from './bps';
import { titleCase } from './absence';

/* ------------------------------------------------------------------ *
 * The routes' vocabularies
 * ------------------------------------------------------------------ */

/** `payout_method`, in the order `POST /network/payout/request` lists it. */
export const PAYOUT_METHODS = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'wire', label: 'Wire transfer' },
  { value: 'crypto', label: 'Crypto' },
];

/** The route refuses `amount_cents < 1000`. */
export const PAYOUT_MIN_CENTS = 1000;

/**
 * The currency a commission row carries when its writer sends none — the
 * column default on `commissions` and `payouts`. A rule stores no currency, so
 * a fixed rule amount accrues in this one.
 */
export const TABLE_DEFAULT_CURRENCY = 'USD';

/**
 * Why a payout's amount is shown with no currency. `POST
 * /network/payout/request` writes none, so every `payouts` row carries the
 * column default, `TABLE_DEFAULT_CURRENCY`, whatever the commissions it
 * claimed were in (D569, GAP 5). The default is not a fact about the payout.
 */
export const PAYOUT_CURRENCY_GAP = 'The payout request stores no currency, so the row holds the table default, not the currency of the commissions it claimed.';

/** `commissions.status`: accrued, then paid once a payout request claims it. */
export const COMMISSION_STATUS = {
  accrued: { label: 'Accrued', tone: 'info' },
  paid: { label: 'Paid', tone: 'ok' },
};

/** `payouts.status`, as the request and the process route write it. */
export const PAYOUT_STATUS = {
  requested: { label: 'Requested', tone: 'warn' },
  processing: { label: 'Processing', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** `referrals.status`: pending until a milestone converts it. */
export const REFERRAL_STATUS = {
  pending: { label: 'Signed up', tone: 'neutral' },
  converted: { label: 'Converted', tone: 'ok' },
};

/**
 * The `action` verbs `PATCH /network/admin/payouts/:id/process` accepts, and
 * the statuses each is offered from. The route itself checks no state, so this
 * table is the only thing keeping "complete" off a payout that already failed.
 */
export const PAYOUT_ACTIONS = {
  complete: { label: 'Process payout', from: ['requested', 'processing'] },
  process: { label: 'Mark processing', from: ['requested'] },
  fail: { label: 'Mark failed', from: ['requested', 'processing', 'completed'] },
};

/** The relationship types `partnernet.ts` accepts (REL_TYPES), in words. */
export const RELATIONSHIP_TYPES = {
  co_investor: 'Co-investor',
  advisor_founder: 'Advisor and founder',
  operator_partner: 'Operator and partner',
  strategic_alliance: 'Strategic alliance',
  advisor_mentee: 'Advisor and mentee',
};

/** What a person picks when logging an interaction. `kind` is free text on the route. */
export const INTERACTION_KINDS = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'message', label: 'Message' },
  { value: 'note', label: 'Note' },
];

/** `verified_badges`, as `recomputeNetworkScore` awards them. */
export const BADGE_LABELS = {
  top_referrer: 'Top referrer',
  connector: 'Connector',
  high_earner: 'High earner',
  syndicate_lead: 'Syndicate lead',
};

/** The commission sources the rules seed, plus a purchase. */
export const SOURCE_LABELS = {
  kyc_approved: 'KYC approved',
  deal_funding: 'Deal funded',
  lp_onboarded: 'LP onboarded',
  spinout: 'Spin-out',
  partner_fee: 'Partner fee',
  purchase: 'Purchase',
};

/**
 * The four screens' own row, drawn by `ZoneNav` with this as its bucket. They
 * are not a bucket of the partner shell (`shellConfig.js` has no `/partner`
 * prefix, by D4), so the shell draws no pill row for them and this one stands
 * in. The relationship log is not on it: it is a page of one relationship,
 * reached from Network.
 */
export const EARNINGS_AREA = {
  label: 'Earnings',
  prefix: '/partner',
  zones: [
    { slug: 'earnings', label: 'Earnings' },
    { slug: 'referrals', label: 'Referrals' },
    { slug: 'leaderboard', label: 'Leaderboard' },
  ],
};

/** Where one accepted relationship's log lives (`/partner/relationships/:id`). */
export const relationshipLogPath = (id) => `/partner/relationships/${encodeURIComponent(String(id))}`;

export const PERIODS = [
  { key: 'all', label: 'All time', days: null },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '365d', label: 'Last 12 months', days: 365 },
];

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

/**
 * An integer number of cents, or null. The type test is the guard, as in
 * `bpsPercent`: `Number('')` and `Number(null)` are both 0, and a 0 here is a
 * claim that something is worth nothing.
 */
export function centsOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** An ISO 4217 code, upper-cased, or null. */
export function currencyOf(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Cents as an amount in its own currency's symbol, or null. The code itself is
 * printed beside it by the page, so "$" is never the only mark of what the
 * money is. With no currency the amount is a bare number and the page says
 * the currency is not recorded.
 */
export function formatMoney(cents, currency) {
  const n = centsOf(cents);
  if (n === null) return null;
  const code = currencyOf(currency);
  const amount = n / 100;
  if (code) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
    } catch {
      // A code Intl does not know: the number, and the page prints the code.
    }
  }
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A stored timestamp as milliseconds, or null. SQLite's CURRENT_TIMESTAMP is
 * `YYYY-MM-DD HH:MM:SS` in UTC with no zone mark, which `Date` would read as
 * local time, so that shape is read as UTC explicitly.
 */
export function timeOf(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** A calendar day, read in UTC, or null. */
export function dayOf(value) {
  const t = timeOf(value);
  if (t === null) return null;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** `{ key, label, tone }` for a status, from one of the maps above. */
export function statusOf(map, value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (map[key]) return { key, ...map[key] };
  return { key, label: titleCase(key) || 'Not recorded', tone: 'neutral' };
}

/** A commission's source in words; a compounding bonus says so. Null when absent. */
export function sourceLabel(sourceType) {
  const raw = String(sourceType ?? '').trim();
  if (!raw) return null;
  const compound = raw.endsWith('_compound');
  const base = compound ? raw.slice(0, -'_compound'.length) : raw;
  const label = SOURCE_LABELS[base] || titleCase(base);
  return compound ? `${label} · compounding` : label;
}

/** The distinct sources in a list of commissions, as chip options sorted by label. */
export function sourcesIn(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    const key = String(r?.source_type ?? '').trim();
    if (key && !seen.has(key)) seen.set(key, sourceLabel(key));
  }
  return [...seen.entries()].map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Who a row belongs to on the admin console: a name, an email, or the account id. */
export function personOf(row) {
  const name = String(row?.name ?? '').trim();
  if (name) return name;
  const email = String(row?.email ?? '').trim();
  if (email) return email;
  return row?.user_id != null ? `Account #${row.user_id}` : null;
}

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

/**
 * Rows summed per status and, inside a status, per currency.
 *
 * `order` lists the statuses always returned, even with no rows, so the page
 * can say "none accrued" — a status the table was read for and holds nothing
 * in is a real empty, not an absent value. A row whose amount is unreadable is
 * counted in `unreadable` rather than added as zero.
 */
export function totalsByStatus(rows, order = ['accrued', 'paid'], map = COMMISSION_STATUS) {
  const groups = new Map(order.map((s) => [s, new Map()]));
  let unreadable = 0;
  for (const r of rows || []) {
    const status = String(r?.status ?? '').trim().toLowerCase();
    const cents = centsOf(r?.amount_cents);
    if (!status || cents === null) { unreadable += 1; continue; }
    if (!groups.has(status)) groups.set(status, new Map());
    const byCurrency = groups.get(status);
    const code = currencyOf(r?.currency) || '';
    const prev = byCurrency.get(code) || { currency: code || null, cents: 0, count: 0 };
    byCurrency.set(code, { currency: prev.currency, cents: prev.cents + cents, count: prev.count + 1 });
  }
  const statuses = [...groups.entries()].map(([status, byCurrency]) => {
    const sums = [...byCurrency.values()].sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
    return { ...statusOf(map, status), sums, count: sums.reduce((n, s) => n + s.count, 0) };
  });
  return { statuses, unreadable };
}

/**
 * The payouts still in flight — requested or processing — counted. Their
 * amounts are not added up: a payout's currency is not recorded
 * (`PAYOUT_CURRENCY_GAP`), so two requests could be in different currencies.
 */
export function payoutsInFlight(payouts) {
  const open = (payouts || []).filter((p) => ['requested', 'processing'].includes(String(p?.status ?? '').toLowerCase()));
  return { count: open.length };
}

/* ------------------------------------------------------------------ *
 * The payout request
 * ------------------------------------------------------------------ */

/**
 * The amounts `POST /network/payout/request` will accept, in the order it
 * checks them.
 *
 * The route reads the caller's accrued commissions `ORDER BY created_at ASC`
 * and claims whole rows from the oldest until the amount is used up; a row
 * larger than what is left refuses the request. So the only amounts it takes
 * are the sum of the oldest one, the oldest two, and so on — and only those of
 * at least `PAYOUT_MIN_CENTS`.
 *
 * ONE CURRENCY PER REQUEST. The route adds cents without reading `currency`,
 * so a run that crossed from one currency into another would be a payout of
 * nothing in particular. The options stop where the currency changes, and
 * `stoppedAt` says so, so the page can tell the partner why the rest of their
 * balance is not offered.
 */
export function payoutOptions(rows, minCents = PAYOUT_MIN_CENTS) {
  const accrued = (rows || [])
    .filter((r) => String(r?.status ?? '').toLowerCase() === 'accrued')
    .map((r) => ({ id: r?.id, cents: centsOf(r?.amount_cents), currency: currencyOf(r?.currency), t: timeOf(r?.created_at) }))
    .sort((a, b) => {
      if (a.t !== b.t) {
        if (a.t === null) return -1;
        if (b.t === null) return 1;
        return a.t - b.t;
      }
      return Number(a.id) - Number(b.id);
    });
  const options = [];
  let sum = 0;
  let stoppedAt = null;
  const currency = accrued[0]?.currency ?? null;
  for (let i = 0; i < accrued.length; i += 1) {
    const row = accrued[i];
    if (row.cents === null || row.cents <= 0) { stoppedAt = 'amount'; break; }
    if (row.currency !== currency) { stoppedAt = 'currency'; break; }
    sum += row.cents;
    if (sum >= minCents) {
      options.push({ count: i + 1, cents: sum, currency, ids: accrued.slice(0, i + 1).map((r) => r.id) });
    }
  }
  return { accruedCount: accrued.length, currency, options, stoppedAt };
}

/** The request body the route reads: `amount_cents`, `payout_method`, `payout_details`. */
export function payoutRequestBody(option, method, note) {
  const text = String(note ?? '').trim();
  return {
    amount_cents: option?.cents,
    payout_method: method,
    ...(text ? { payout_details: { note: text.slice(0, 500) } } : {}),
  };
}

/**
 * `payout_details` as the page can show it: a list of `[key, value]` pairs
 * for a JSON object, the text for anything else, or null. It is free JSON on
 * the route, so no key is assumed.
 */
export function payoutDetails(raw) {
  if (raw == null || raw === '') return null;
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return raw.trim() || null; }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const pairs = Object.entries(value)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    return pairs.length ? pairs : null;
  }
  const s = String(value).trim();
  return s || null;
}

/** The actions the admin queue offers on a payout in this status. */
export function payoutActionsFor(status) {
  const key = String(status ?? '').toLowerCase();
  return Object.entries(PAYOUT_ACTIONS)
    .filter(([, a]) => a.from.includes(key))
    .map(([action, a]) => ({ action, label: a.label }));
}

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

/**
 * Commissions narrowed by status, source, period and a search over the
 * description, the source and (on the admin console) the partner.
 */
export function filterCommissions(rows, { status = 'all', source = 'all', period = 'all', query = '', now = Date.now() } = {}) {
  const days = PERIODS.find((p) => p.key === period)?.days ?? null;
  const since = days === null ? null : now - days * 86400000;
  const q = String(query ?? '').trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (status !== 'all' && String(r?.status ?? '').toLowerCase() !== status) return false;
    if (source !== 'all' && String(r?.source_type ?? '') !== source) return false;
    if (since !== null) {
      const t = timeOf(r?.created_at);
      if (t === null || t < since) return false;
    }
    if (q) {
      const hay = [r?.description, sourceLabel(r?.source_type), r?.name, r?.email]
        .map((v) => String(v ?? '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Referrals and credits
 * ------------------------------------------------------------------ */

/** The commissions that name this referral. A purchase commission names none. */
export function commissionsForReferral(referralId, commissions) {
  if (referralId == null) return [];
  return (commissions || []).filter((c) => c?.referral_id != null && Number(c.referral_id) === Number(referralId));
}

/** Who signed up: their name, their email, or null. */
export function referralName(row) {
  const name = String(row?.referred_name ?? '').trim();
  if (name) return name;
  const email = String(row?.referred_email ?? '').trim();
  return email || null;
}

/**
 * The day the monthly allowance resets, from the credit state's `month`
 * ("2026-10"). The service keys the allowance on the UTC month, so it renews
 * on the first of the next one.
 */
export function creditsResetDay(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? '').trim());
  if (!m) return null;
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
  return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** A whole count, or null — never a coerced zero. */
export function countOf(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/* ------------------------------------------------------------------ *
 * The relationship log
 * ------------------------------------------------------------------ */

const EVENT_TITLES = {
  requested: 'Request sent',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  removed: 'Removed',
  updated: 'Updated',
};

const FIELD_WORDS = {
  strength_score: 'strength',
  relationship_type: 'type',
  private_note: 'a private note',
  metadata: 'details',
};

/** One `relationship_events` row as a timeline entry. */
export function eventEntry(event) {
  const type = String(event?.event_type ?? '').trim().toLowerCase();
  const title = EVENT_TITLES[type] || titleCase(type) || 'Event';
  const details = event?.details && typeof event.details === 'object' ? event.details : {};
  let detail = null;
  if (type === 'updated' && Array.isArray(details.fields) && details.fields.length) {
    detail = `Changed ${details.fields.map((f) => FIELD_WORDS[f] || String(f).replace(/_/g, ' ')).join(', ')}.`;
  } else if (type === 'requested' && details.type) {
    detail = `Asked to record the relationship as ${(RELATIONSHIP_TYPES[details.type] || titleCase(details.type)).toLowerCase()}.`;
  }
  return {
    key: `event-${event?.id ?? title}`,
    kind: 'event',
    title,
    detail,
    by: null,
    at: event?.created_at ?? null,
    t: timeOf(event?.created_at),
  };
}

/**
 * One `partner_interactions` row as a timeline entry. A touch its recorder
 * voided is still returned by the route, with `voided_at`; it stays in the
 * log, marked, and is counted apart from the live entries.
 */
export function interactionEntry(row) {
  const kind = String(row?.kind ?? '').trim().toLowerCase();
  const title = INTERACTION_KINDS.find((k) => k.value === kind)?.label || titleCase(kind) || 'Interaction';
  const note = String(row?.note ?? '').trim();
  return {
    key: `interaction-${row?.uid || row?.id || title}`,
    kind: 'interaction',
    title,
    detail: note || null,
    by: String(row?.recorded_by_name ?? '').trim() || null,
    at: row?.interacted_at ?? null,
    t: timeOf(row?.interacted_at),
    voided: Boolean(row?.voided_at),
    voidedAt: row?.voided_at ?? null,
  };
}

/** Both logs as one timeline, newest first; an entry with no date sinks to the end. */
export function timeline(events, interactions) {
  return [...(events || []).map(eventEntry), ...(interactions || []).map(interactionEntry)]
    .sort((a, b) => {
      if (a.t === b.t) return 0;
      if (a.t === null) return 1;
      if (b.t === null) return -1;
      return b.t - a.t;
    });
}

/**
 * The body `POST /partnernet/relationships/:id/interactions` reads. A date with
 * no time is noon UTC, as the investor book sends it; with a time, the
 * reader's own clock is turned into an instant.
 */
export function interactionBody({ kind, date, time, note }) {
  const body = { kind: String(kind || 'note'), note: String(note ?? '').trim() || null };
  const day = String(date ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const clock = String(time ?? '').trim();
    if (/^\d{2}:\d{2}$/.test(clock)) {
      const local = new Date(`${day}T${clock}`);
      if (!Number.isNaN(local.getTime())) body.interacted_at = local.toISOString();
    } else {
      body.interacted_at = `${day}T12:00:00.000Z`;
    }
  }
  return body;
}

/* ------------------------------------------------------------------ *
 * The leaderboard
 * ------------------------------------------------------------------ */

/**
 * The rows as the route returned them, each with a rank and whether it is the
 * viewer's.
 *
 * THE RANK IS READ, NOT MADE. The route orders by `network_score` and returns
 * at most 25; a rank here is one plus the number of returned rows with a
 * strictly higher score, so equal scores share a rank rather than being split
 * by an order the database chose. A row with no score has no rank.
 */
export function rankBoard(rows, viewerId) {
  const list = Array.isArray(rows) ? rows : [];
  const scores = list.map((r) => {
    const n = Number(r?.network_score);
    return r?.network_score != null && r?.network_score !== '' && Number.isFinite(n) ? n : null;
  });
  return list.map((row, i) => {
    const score = scores[i];
    return {
      row,
      score,
      rank: score === null ? null : 1 + scores.filter((s) => s !== null && s > score).length,
      isViewer: viewerId != null && row?.id != null && Number(row.id) === Number(viewerId),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Rules and the take rate
 * ------------------------------------------------------------------ */

/**
 * What a rule pays, the way `fireCommissionEvent` reads it: a fixed
 * `amount_cents` wins, else `percentage_bps` of the amount the event carries.
 * Null when the rule holds neither, which the route would treat as nothing.
 */
export function ruleAmount(rule) {
  const cents = centsOf(rule?.amount_cents);
  if (cents !== null && cents > 0) {
    return { kind: 'fixed', text: formatMoney(cents, TABLE_DEFAULT_CURRENCY), currency: TABLE_DEFAULT_CURRENCY };
  }
  const bps = centsOf(rule?.percentage_bps);
  if (bps !== null && bps > 0) return { kind: 'percentage', text: bpsPercent(bps), currency: null };
  return null;
}

/** Whether a rule is on: the column is an integer flag, null meaning the default 1. */
export function ruleActive(rule) {
  if (rule?.active == null) return true;
  return Number(rule.active) === 1;
}

/**
 * A typed take rate in basis points, or an error a person can act on. The
 * route takes whole basis points only, so this does the same check before
 * sending rather than after.
 */
export function takeRateInput(raw, maxBps) {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return { error: 'Enter whole basis points, for example 1500 for 15%.' };
  const bps = Number(s);
  const max = centsOf(maxBps);
  if (max !== null && bps > max) return { error: `The highest rate the route accepts is ${max} basis points (${bpsPercent(max)}).` };
  return { bps };
}
