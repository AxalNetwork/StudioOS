/**
 * D568 — the Account center's pure half.
 *
 * Everything the section components decide that can be proved without
 * rendering lives here, and every field name is the one the Worker route
 * serves — read off `cloudflare-worker/src/routes/*.ts`, never guessed:
 *
 *   identity    GET/PUT /settings/profile/identity  (routes/settings.ts pickIdentity)
 *   details     GET/PUT /settings/profile/details   (routes/settings.ts pickDetails)
 *   corporate   GET/PUT /settings/profile/corporate (services/profileExpansion.ts)
 *   history     GET /profile/history                (routes/profile_history.ts)
 *   reask       GET /profile/reask                  (services/profileEvolution.ts reaskList)
 *   push        GET /notifications/push/subscriptions
 *   follows     GET /follows/mine                   (routes/follows.ts)
 *   orders      GET /orders/mine                    (services/orders.ts rowToOrder)
 *   plan        GET /billing/tier/status, /billing/investor/status, /billing/plan/status
 *
 * A value a route does not hold is `null` here, and the components draw it as
 * "Not recorded". Nothing in this file turns a missing value into a zero.
 */
import { toUtcInstant } from '../../lib/notices';
import { archetypeMeta, archetypeAudienceFromRole, humanize } from '../../lib/assessmentMeta';
import { TIER_PLANS } from '../../components/PaywallModal';

// ---------------------------------------------------------------------------
// Dates and money
// ---------------------------------------------------------------------------

/**
 * The canvas writes dates as "12 Oct"; the year is kept because these lists
 * span years. An instant is shown in the reader's zone, read at call time.
 */
const DAY_OPTS = { day: 'numeric', month: 'short', year: 'numeric' };
// A bare calendar date (a date of birth) is a day, not an instant: formatted
// in the reader's zone, `1990-05-12` would read "11 May 1990" anywhere west
// of Greenwich. It is formatted in UTC, where it was written.
const DAY_UTC = new Intl.DateTimeFormat('en-GB', { ...DAY_OPTS, timeZone: 'UTC' });

function instant(value) {
  const iso = toUtcInstant(value);
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A date a route served, as "12 Oct 2026". Null when there is none or it does not parse. */
export function dayLabel(value) {
  const d = instant(value);
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()) ? DAY_UTC.format(d) : d.toLocaleDateString('en-GB', DAY_OPTS);
}

/** "09:41", for a moment this page itself recorded. */
export function timeLabel(value) {
  const d = value instanceof Date ? value : instant(value);
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
}

/**
 * Minor units in, a formatted amount out. Null when the amount is not a
 * finite number: an order with no total is not a free order.
 */
export function money(cents, currency) {
  const n = Number(cents);
  if (cents === null || cents === undefined || cents === '' || !Number.isFinite(n)) return null;
  const code = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return `${(n / 100).toFixed(2)} (currency not recorded)`;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(2)} ${code}`;
  }
}

// ---------------------------------------------------------------------------
// Profile and identity
// ---------------------------------------------------------------------------

/** `ALLOWED_LOCALES` in services/userSettings.ts; the worker refuses anything else. */
export const LOCALES = [
  ['en', 'English'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['pt', 'Português'],
];

export function localeLabel(code) {
  const hit = LOCALES.find(([k]) => k === code);
  return hit ? hit[1] : null;
}

let REGION_NAMES = null;
/** An ISO 3166 alpha-2 code as a country name, or the code itself when the runtime cannot name it. */
export function countryLabel(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  try {
    REGION_NAMES = REGION_NAMES || new Intl.DisplayNames(['en'], { type: 'region' });
    return REGION_NAMES.of(c) || c;
  } catch {
    return c;
  }
}

/** "Lausanne, Switzerland" from the details slice; null when neither half is recorded. */
export function locationLabel(details) {
  const city = String(details?.city || '').trim();
  const country = countryLabel(details?.country);
  return [city, country].filter(Boolean).join(', ') || null;
}

/** The stored phone is encrypted at rest; the route serves only its last four digits. */
export function phoneLabel(details) {
  if (!details?.has_phone) return null;
  return details.phone_last4 ? `•••• ${details.phone_last4}` : 'Saved (last digits not recorded)';
}

/**
 * Only the keys whose value changed, with an emptied field sent as `null` —
 * every profile writer treats `null` as "clear" and validates the rest.
 */
export function changedFields(original, draft, keys) {
  const out = {};
  for (const k of keys) {
    const before = original?.[k] ?? '';
    const raw = draft?.[k];
    const after = typeof raw === 'string' ? raw.trim() : (raw ?? '');
    if (String(after) !== String(before)) out[k] = after === '' ? null : after;
  }
  return out;
}

/**
 * The Personal details card spans three stores, and each key goes to the one
 * route that owns it: `name` to PATCH /settings (the account name every other
 * surface reads), the username and language to the identity route, phone and
 * location to the details route.
 */
export function splitPersonalPatch(patch) {
  const account = {};
  const identity = {};
  const details = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'name') account.name = v;
    else if (k === 'profile_slug' || k === 'locale') identity[k] = v;
    else if (k === 'phone_e164' || k === 'city' || k === 'country') details[k] = v;
  }
  return { account, identity, details };
}

/**
 * The route's own refusal, as field errors. The profile routes answer a bad
 * field with `{ error, field, errors: { [field]: message } }`; anything else is
 * a whole-form refusal and comes back under `_form`.
 */
export function fieldErrorsFrom(e) {
  const map = e?.data?.errors;
  if (map && typeof map === 'object' && Object.keys(map).length) return { ...map };
  if (e?.field) return { [e.field]: e.message || 'Not saved.' };
  return { _form: e?.message || 'Not saved. Try again in a moment.' };
}

/** True when the corporate route holds no row for this account (its GET answers all-null). */
export function corporateIsEmpty(corp) {
  if (!corp) return true;
  return !corp.updated_at && !['entity_name', 'registration_number', 'registered_country', 'signing_authority_title']
    .some((k) => String(corp[k] || '').trim());
}

const PERSONA_LABEL = { founder: 'Founder', investor: 'Investor', partner: 'Partner', advisor: 'Advisor', coach: 'Coach' };

function archetypeName(slug) {
  if (!slug) return null;
  return archetypeMeta(slug)?.label || humanize(slug);
}

/**
 * The archetype the profile shows: the newest snapshot (the route sorts by id,
 * newest first) carrying a displayed archetype, for the persona of the
 * caller's role when one exists. `confidence` is 0..1 in the store.
 */
export function latestArchetype(items, role) {
  const rows = (Array.isArray(items) ? items : []).filter((s) => s && s.displayed_slug);
  if (!rows.length) return null;
  const persona = archetypeAudienceFromRole(role);
  const pick = rows.find((s) => s.persona === persona) || rows[0];
  const conf = Number(pick.confidence);
  return {
    slug: pick.displayed_slug,
    label: archetypeName(pick.displayed_slug),
    confidencePct: pick.confidence !== null && pick.confidence !== undefined && Number.isFinite(conf)
      ? Math.round(conf * 100) : null,
    persona: pick.persona,
    at: pick.computed_at || null,
  };
}

/** `TRIGGERS` in services/profileHistory.ts: why a snapshot was written. */
const TRIGGER_COPY = {
  answer: 'Profile updated from your answers',
  evidence: 'Profile updated from your work on the platform',
  scheduled: 'Profile re-scored on the scheduled run',
  engine_bump: 'Profile re-scored under a new scoring version',
};

/**
 * One line per snapshot, newest first. A snapshot is written only on a
 * material change (§7.6), so each one is a real change; the line names the
 * archetype when that is what moved, and the trigger otherwise. The canvas's
 * "[n] questions" is not drawn: a snapshot does not record how many answers
 * moved it.
 */
export function historyLines(items) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  const several = new Set(rows.map((r) => r.persona)).size > 1;
  return rows.map((row, i) => {
    const older = rows.slice(i + 1).find((r) => r.persona === row.persona) || null;
    const name = archetypeName(row.displayed_slug);
    let what;
    if (!older) what = name ? `Profile first scored · ${name}` : 'Profile first scored';
    else if (name && row.displayed_slug !== older.displayed_slug) what = `Archetype changed to ${name}`;
    else what = TRIGGER_COPY[row.trigger] || 'Profile updated';
    const persona = PERSONA_LABEL[row.persona] || humanize(row.persona);
    return { id: row.id, when: row.computed_at || null, what: several && persona ? `${what} (${persona})` : what };
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * What the Worker will do for one type on one channel. `resolveChannels` in
 * services/notify.ts delivers a channel unless the stored value is exactly
 * `false`, so an unset channel is ON — and a matrix that drew it off would
 * tell the reader the opposite of what reaches their inbox.
 */
export function channelOn(prefs, type, channel) {
  const ev = prefs && typeof prefs === 'object' ? prefs[type] : null;
  return (ev && typeof ev === 'object' ? ev[channel] : undefined) !== false;
}

// ---------------------------------------------------------------------------
// Push devices
// ---------------------------------------------------------------------------

function osOf(ua) {
  let m = /\b(?:iPhone|iPad|iPod).*?\bOS (\d+)[_.](\d+)/.exec(ua);
  if (m) return `iOS ${m[1]}.${m[2]}`;
  m = /\bAndroid (\d+(?:\.\d+)?)/.exec(ua);
  if (m) return `Android ${m[1]}`;
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  // Both of these freeze their version in the user agent (macOS reads 10.15.7
  // on every release since 11; Windows NT 10.0 covers 10 and 11), so a version
  // here would be a wrong number rather than a missing one.
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'macOS';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return null;
}

function browserOf(ua) {
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera';
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return 'Firefox';
  if (/\bChrome\/|\bCriOS\//.test(ua)) return 'Chrome';
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return 'Safari';
  return null;
}

function deviceOf(ua) {
  if (/\biPhone\b/.test(ua)) return 'iPhone';
  if (/\biPad\b/.test(ua)) return 'iPad';
  if (/\bAndroid\b/.test(ua)) return /\bMobile\b/.test(ua) ? 'Android phone' : 'Android device';
  if (/\bCrOS\b/.test(ua)) return 'Chromebook';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'Mac';
  if (/\bWindows\b/.test(ua)) return 'Windows PC';
  if (/\bLinux\b/.test(ua)) return 'Linux computer';
  return null;
}

/**
 * A push subscription row names itself only by the user agent the browser
 * sent when it subscribed (`push_subscriptions.user_agent`). This reads that
 * string; it does not identify a device any other way. Null when nothing was
 * stored.
 */
export function deviceLabel(userAgent) {
  const ua = String(userAgent || '').trim();
  if (!ua) return null;
  const browser = browserOf(ua);
  const device = deviceOf(ua);
  const name = browser && device ? `${browser} on ${device}` : (browser || device || 'Unrecognised browser');
  return { name, os: osOf(ua) };
}

// ---------------------------------------------------------------------------
// Following
// ---------------------------------------------------------------------------

/**
 * `/follows/mine` answers `{ users, projects }`. A person is a user row, a
 * company is a startup (`projects`); each carries its public handle, which is
 * the address of its public profile. The follow's own date is selected by the
 * route but not returned, so no row here carries one.
 */
export function followRows(mine) {
  const users = Array.isArray(mine?.users) ? mine.users : [];
  const projects = Array.isArray(mine?.projects) ? mine.projects : [];
  return [
    ...users.map((u) => ({
      key: `user:${u.id}`,
      entityType: 'user',
      id: u.id,
      kind: 'person',
      name: String(u.name || '').trim() || null,
      sub: String(u.headline || '').trim() || (u.role ? humanize(u.role) : null),
      href: u.handle ? `/u/${encodeURIComponent(u.handle)}` : null,
    })),
    ...projects.map((p) => ({
      key: `project:${p.id}`,
      entityType: 'project',
      id: p.id,
      kind: 'company',
      name: String(p.name || '').trim() || null,
      sub: [p.sector, p.stage].filter(Boolean).map((v) => humanize(v)).join(' · ') || null,
      href: p.handle ? `/startups/${encodeURIComponent(p.handle)}` : null,
    })),
  ];
}

/**
 * Search and the People / Companies chips, sorted by name. The canvas sorts by
 * "Recent", and that order cannot be drawn: the route does not return the
 * follow dates and re-reads the rows by id, so their order is not the order
 * they were followed in.
 */
export function filterFollows(rows, { query = '', kind = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => kind === 'all' || r.kind === kind)
    .filter((r) => !q || `${r.name || ''} ${r.sub || ''}`.toLowerCase().includes(q))
    .sort((a, b) => {
      if (!a.name !== !b.name) return a.name ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** `OrderStatus` in services/orders.ts. The store has no refunded state. */
export const ORDER_STATUS = {
  paid: { label: 'Paid', tone: 'ok' },
  pending: { label: 'Pending', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
};

export function orderRow(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const first = String(items[0]?.name || '').trim() || null;
  const item = first ? (items.length > 1 ? `${first} + ${items.length - 1} more` : first) : null;
  const at = instant(order?.created_at);
  const known = ORDER_STATUS[order?.status];
  return {
    ref: order?.order_ref || null,
    when: order?.created_at || null,
    year: at ? String(at.getUTCFullYear()) : null,
    item,
    amount: money(order?.total, order?.currency),
    statusKey: known ? order.status : null,
    status: known || { label: 'Not recorded', tone: 'neutral' },
    paid: order?.status === 'paid',
  };
}

/** Search by item or order reference, the Status and Year chips, newest or oldest first. */
export function filterOrders(rows, { query = '', status = 'all', year = 'all', sort = 'newest' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const ts = (r) => instant(r.when)?.getTime() ?? -Infinity;
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => status === 'all' || r.statusKey === status)
    .filter((r) => year === 'all' || r.year === year)
    .filter((r) => !q || `${r.item || ''} ${r.ref || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (sort === 'oldest' ? ts(a) - ts(b) : ts(b) - ts(a)));
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

// D700 — the founder tiers read by D683's names, from the paywall's own table,
// so the Billing pane and the phone index (`accountPhone.js`) say one name.
const FOUNDER_TIERS = { free: 'Free', growth: TIER_PLANS.growth.label, studio: TIER_PLANS.studio.label };
const INVESTOR_TIERS = { free: 'Free', professional: 'Professional', institutional: 'Institutional' };
const PLAN_GROUPS = { partner: 'Partner', advisor: 'Advisor' };
/** PersonaBillingPanel's own rule for "subscribed". */
const SUBSCRIBED = new Set(['active', 'trialing', 'past_due']);

/** Which status route a role reads, and which portal opens its billing. */
export function billingSourceFor(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'founder') return { status: 'tierStatus', portal: 'tierPortal', pricing: '/pricing' };
  if (r === 'investor') return { status: 'investorBillingStatus', portal: 'investorPortal', pricing: '/pricing/investor' };
  // Every other role's plan lives on the general Stripe customer, which is
  // the customer `POST /billing/tier/portal` opens (routes/billing.ts).
  return { status: 'planStatus', portal: 'tierPortal', pricing: '/pricing' };
}

/**
 * The plan line the canvas draws — name, tier, seats, renewal — from whichever
 * status route the role reads. `plan: null` means no subscription plan applies
 * to this role (`/billing/plan/status` answers `plan_group: null`).
 */
export function planSummary(role, status) {
  if (!status || typeof status !== 'object') return null;
  const r = String(role || '').toLowerCase();
  const sub = String(status.status || '').toLowerCase() || null;
  const base = {
    renewsAt: status.renews_at || null,
    trialEndsAt: status.trial_ends_at || null,
    hasCustomer: !!status.has_customer,
    seats: null,
  };
  if (r === 'founder' || r === 'investor') {
    const tiers = r === 'founder' ? FOUNDER_TIERS : INVESTOR_TIERS;
    const tier = String(status.tier || 'free').toLowerCase();
    // The investor route serves the tier that APPLIES (`tier`, after a lapse
    // or a cancellation) beside the one on the subscription (`raw_tier`).
    const raw = String(status.raw_tier || tier).toLowerCase();
    const q = status.quotas || {};
    const seatsKnown = q.seats !== null && q.seats !== undefined && q.seat_count !== null && q.seat_count !== undefined
      && Number.isFinite(Number(q.seats)) && Number.isFinite(Number(q.seat_count));
    return {
      ...base,
      plan: r === 'founder' ? 'Founder workspace' : 'Investor',
      tier: tiers[tier] || humanize(tier),
      subscribedTier: r === 'investor' && raw !== tier ? (tiers[raw] || humanize(raw)) : null,
      paid: tier !== 'free',
      status: sub,
      seats: r === 'investor' && seatsKnown ? { used: Number(q.seat_count), cap: Number(q.seats) } : null,
    };
  }
  const group = status.plan_group || null;
  if (!group) return { ...base, plan: null, tier: null, paid: false, status: null };
  const paid = SUBSCRIBED.has(sub);
  return { ...base, plan: PLAN_GROUPS[group] || humanize(group), tier: paid ? 'Pro' : 'Starter', paid, status: paid ? sub : 'free' };
}

/** Codes a billing route answers without a sentence of its own. */
const BILLING_REFUSALS = {
  no_subscription: 'There is no billing account to manage yet. The portal opens once you have subscribed.',
};

/** The route's own refusal text, or a sentence for a bare code it sends. */
export function refusalText(e, fallback) {
  return BILLING_REFUSALS[e?.code] || e?.message || fallback;
}
