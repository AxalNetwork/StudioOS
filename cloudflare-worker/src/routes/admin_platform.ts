/**
 * HQ · Platform — canvas H6 ("Keys, flags, jobs") and H17 ("Monitoring,
 * Broadcast, Feature flags").
 *
 * SUPER ADMIN ONLY.
 *
 *   GET  /summary        connected integrations, scheduled-job health, the
 *                        monitoring and broadcast consoles, and the platform's
 *                        switches, read-only
 *   GET  /switches       the switches an operator can throw, both halves (D203)
 *   POST /switches/:key  throw or release one, with a reason, audited (D203)
 *   GET  /topology       what this Worker binds, exports and calls, and what
 *                        the shared services do and do not carry (D209, H14)
 *
 * EVERY BLOCK CARRIES ITS OWN STATE. One store failing to answer makes that
 * block unreadable, with the reason, and leaves the others standing: an
 * unreadable count is never sent as a zero.
 *
 *   Keys   `integrations` carries a provider, a display name and a status
 *          (active | paused | error | disconnected), which is what the
 *          artboard's Slack and Telegram rows are. The **secret itself is
 *          never read here** and never leaves the worker — this endpoint
 *          counts and states, it does not reveal. The artboard's "reveal on
 *          click, re-hide after thirty seconds" exists on NO screen (D213):
 *          a saved key is write-only, promoted to a Worker secret and never
 *          read back (D.10). Removing one does exist, on the Integration
 *          keys console, and that is where this page links.
 *   Jobs   `cron_run_history` records every scheduled tick, including,
 *          since D201, the tick that found the lease held and ran nothing.
 *          Each DECLARED trigger is read against its own schedule
 *          (util/cronHistory `triggerState`): never recorded, stale past
 *          the last time it was due, failed, or ok. Before D201 this read
 *          one row per trigger name via a GROUP BY over the whole table,
 *          aged every cadence against one 26-hour window, and compared an
 *          ISO cutoff to rows stored as `YYYY-MM-DD HH:MM:SS`. Five of the
 *          six triggers read as silent while their work ran.
 *   Monitoring (D202, H17 P5) — the dead-letter backlog summed over both of
 *          its tables (services/deadLetters), and the incidents entered in
 *          the last seven days. The page adds branch health and the cron
 *          triggers from reads it already makes, so no figure is fetched
 *          twice.
 *   Broadcast (D202, H17 P6) — Telegram channels: bound to a chat or not,
 *          how many posts each has sent and when the last went, and whether
 *          the bot token is set. THE CHAT ID NEVER LEAVES THE DATABASE: the
 *          SELECT reduces it to a boolean, by the same test `/send` applies.
 *          X: whether its OAuth client is configured and how many accounts
 *          exist — no token state, which admin_x already refuses to echo.
 *   Flags  services/platformSwitches lists every switch, each asked
 *          through the predicate the code that obeys it uses. Since D203 one
 *          of them an operator can throw: Eadwyn's kill has a stored half in
 *          `platform_switches` beside its deploy variables, and the two
 *          /switches routes below read and write it. Everything else is
 *          still set at deploy or by the platform itself.
 *
 * H16's four consoles (D213) — four read-only summaries, each of its console's
 * own store. The page links each to its console with a literal path, so the
 * link stands even when a block is unreadable, and no path travels in here. No
 * console retires; no Stripe or GitHub call is made on this load; no schema is
 * created by reading it.
 *   Integration keys  where each managed provider's key lives (a Worker secret,
 *          the database, neither, or unknown because the table did not
 *          answer), and when the console last saved it. NO client id, masked
 *          or not: this page promises no key material, and half a pair is some.
 *   GitHub sync  the mirror's target by the mirror's own rule, the 24-hour
 *          window Support already draws (one reader, D204), and the latest
 *          attempts, one per ticket, with no ticket title.
 *   Payments catalog  the publishable key checkout is served, masked; the
 *          mirror's products and prices counted from the mirror itself, never
 *          through the read that falls back to Stripe; the webhook's deliveries
 *          from the request log.
 *   Promo codes  every code's terms, cap, redemptions and one state, by the
 *          rule checkout itself applies (services/promos `promoState`).
 *
 * Mounted at /api/admin/platform BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { DERIVED_UNAVAILABLE } from './licence';
import { ensureAdminAuditLogTable } from './admin';
import {
  DEFAULT_TAKE_RATE_BPS, MAX_TAKE_RATE_BPS, TAKE_RATE_KEY, settlementMode, takeRate,
} from '../services/advisorMoney';
import {
  CRON_TRIGGERS, STALE_GRACE_MINUTES, latestRunPerTrigger, triggerState,
} from '../util/cronHistory';
import { dlqDepth } from '../services/deadLetters';
import {
  PLATFORM_SWITCH_KEYS, readOperatorSwitchEntries, readPlatformSwitches,
} from '../services/platformSwitches';
import {
  OPERATOR_SWITCH_REACH, OPERATOR_SWITCH_TTL_MS, SWITCH_REASON_MIN, isOperatorSwitchKey, setOperatorSwitch,
} from '../services/operatorSwitches';
import { logAdminAction } from '../services/adminAudit';
import { telegramTokenConfigured } from '../services/telegramClient';
import { xClientConfigured } from '../services/xClient';
import { describeTopology } from '../services/topology';
import {
  MANAGED_PROVIDERS, keyStateOf, readProviderKeyLastSet, readProviderKeyStatus,
} from '../services/providerOauthKeys';
import { githubMirrorTarget } from '../services/githubSync';
import { readRecentSyncAttempts, readTicketSync } from '../services/supportQueues';
import {
  getPublishableKey, maskPublishableKey, publishableKeyMode, readCatalogMirrorSummary,
} from '../services/catalog';
import { promoState } from '../services/promos';

const r = new Hono<{ Bindings: Env }>();

/** H17 P5's "Incidents (7d)" — the window the count is taken over. */
export const INCIDENT_WINDOW_DAYS = 7;

/**
 * Said with the count, because a zero here is easy to misread. The public
 * status page publishes what `status_incidents` holds, and the only writer is
 * `POST /api/public/status/incidents` — an admin intake that nothing in the
 * product calls. So the number is what somebody entered, not what happened.
 */
const INCIDENT_BASIS =
  'Incidents entered for the public status page in the last seven days. No screen in the '
  + 'product enters one — the intake exists and nothing calls it — so a zero means none was '
  + 'entered, not that nothing went wrong.';

/** P6's member counts, and why the canvas's figure is not drawn. */
const MEMBERS_REASON =
  'Member counts are not recorded: the platform never asks Telegram how many people are in a '
  + 'channel, so any number here would be invented.';

// ── H16 (D213) ─────────────────────────────────────────────────────────────

/** P1's two notes: the keys this list does not hold, and where they are. */
const KEY_NOTES = [
  'Google sign-in is set at deploy and no console manages it, so it is not on this list.',
  'The GitHub token belongs to the ticket mirror and is reported under GitHub sync, not here.',
];

/** Why a key's date is what it is, so the page never has to guess. */
const LAST_SET_BASIS_NOTE =
  'A key held as a Worker secret is dated by the last save or rotation the Integration keys '
  + 'console recorded; one set at deploy, or saved again at deploy after being removed from the '
  + 'console, has no date here. A key held in the database is dated by its row.';

/** P2's note: what the recent list is, and is not. */
const SYNC_RECENT_NOTE =
  'A ticket keeps only its latest mirror attempt, so this is the latest attempt per ticket, not '
  + 'a log of failures: a ticket that failed and later synced shows the sync.';

/**
 * The path Stripe delivers to. `billing` is mounted at /api/billing in
 * index.ts and its handler is `/stripe/webhook` in routes/billing.ts; a test
 * reads both files and holds this equal, so a moved route cannot leave P3
 * counting a path nothing is served at.
 */
export const STRIPE_WEBHOOK_PATH = '/api/billing/stripe/webhook';

/** P3's webhook window. */
export const WEBHOOK_WINDOW_HOURS = 24;

const WEBHOOK_BASIS =
  'Read from the request log: the time this Worker took to handle each delivery, not the round '
  + 'trip Stripe measures. A delivery refused for rate is not logged, and nothing turns a failed '
  + 'delivery into an incident.';

const STOREFRONT_NOTE =
  'Each deployment reads its own mirror of its own Stripe catalog. A sync on this deployment '
  + 'changes what this storefront sells and no branch\'s.';

/** P4 lists this many codes, newest first, and says when there are more. */
export const PROMO_LIST_LIMIT = 50;

/** P4's caveats, each a thing the panel's figures cannot say. */
const PROMO_CAVEATS = [
  'Redemptions are the ones this platform recorded. Stripe counts subscription redemptions and '
  + 'nothing mirrors them, so a figure here is a lower bound, and a code is called exhausted '
  + 'only when the recorded count alone reaches its cap.',
  'A code names no licence and no cohort: any buyer can apply it, to the products it lists or '
  + 'to every product when it lists none.',
  'A promo ceiling is not checked against these codes: nothing enforces one at checkout, and no '
  + 'screen sets one yet.',
  'For a code that repeats, the number of months is kept by Stripe, not here.',
];

/**
 * A count read back from SQL, or a throw. Every console block below catches
 * into its own unreadable state, so a value that is not a number fails that
 * block instead of reading as a measured zero — the `|| 0` this page is
 * built not to have. `null` is refused before `Number()` sees it, because
 * `Number(null)` is 0.
 */
function countOf(value: unknown, what: string): number {
  const n = value === null || value === undefined ? NaN : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${what} unreadable`);
  return n;
}

r.get('/summary', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

  // ── Keys and connections ──────────────────────────────────────────────
  let integrations: unknown;
  try {
    const rows = await env.DB.prepare(
      `SELECT provider_key, status, COUNT(*) AS n
         FROM integrations GROUP BY provider_key, status ORDER BY provider_key`,
    ).all<{ provider_key: string; status: string; n: number }>();
    const byProvider = new Map<string, Record<string, number>>();
    let total = 0;
    let unhealthy = 0;
    for (const row of rows.results || []) {
      const key = String(row.provider_key);
      const status = String(row.status);
      const n = Number(row.n) || 0;
      if (!byProvider.has(key)) byProvider.set(key, {});
      byProvider.get(key)![status] = n;
      total += n;
      if (status === 'error' || status === 'disconnected') unhealthy += n;
    }
    integrations = {
      available: true,
      total,
      unhealthy,
      providers: [...byProvider.entries()].map(([provider, by_status]) => ({ provider, by_status })),
      // Said explicitly so nobody wires a reveal into this payload later.
      secrets_included: false,
      secrets_note: 'Key material is never read by this endpoint. It counts connections and reports their state.',
    };
  } catch {
    integrations = { available: false, reason: 'The integrations table could not be read.' };
  }

  // ── Scheduled jobs ────────────────────────────────────────────────────
  // THE LIST IS THE DECLARED TRIGGERS, NOT WHATEVER NAMES THE TABLE HOLDS.
  // A trigger that has never recorded a run is the finding, so it has to be
  // on the list to be seen, and a row under a name nobody declares is not a
  // job HQ runs. One indexed read per trigger, in place of a GROUP BY that
  // read the whole table on every load.
  let jobs: unknown;
  try {
    const now = new Date();
    const latest = await latestRunPerTrigger(env, CRON_TRIGGERS.map((t) => t.expr), now);
    const list = CRON_TRIGGERS.map((t) => {
      const row = latest.get(t.expr) ?? null;
      const { state, expected_at } = triggerState(t.expr, row, now, STALE_GRACE_MINUTES);
      return {
        name: t.name,
        trigger_name: t.expr,
        expected_at,
        last_started_at: row?.started_at || null,
        last_finished_at: row?.finished_at || null,
        status: row?.status || null,
        error: row?.error || null,
        state,
      };
    });
    jobs = {
      available: true,
      grace_minutes: STALE_GRACE_MINUTES,
      triggers: list,
      failing: list.filter((j) => j.state === 'failed').length,
      stale: list.filter((j) => j.state === 'stale').length,
      never: list.filter((j) => j.state === 'never').length,
    };
  } catch {
    jobs = { available: false, reason: 'The scheduled-run history could not be read.' };
  }

  // ── Monitoring (D202, H17 P5) ─────────────────────────────────────────
  // Two of P5's four stats are computed here. The other two are the page's,
  // from reads it already makes: Workers healthy from /deployments, cron
  // triggers from `jobs` above.
  const dlq = await dlqDepth(env);
  let incidents: unknown;
  try {
    // datetime() on both sides: `created_at` is written by datetime('now'),
    // and a bound ISO cutoff would read a same-day row as older than it is.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM status_incidents
        WHERE datetime(created_at) >= datetime('now', ?)`,
    ).bind(`-${INCIDENT_WINDOW_DAYS} days`).first<{ n: number }>();
    const count = countOf(row?.n, 'incident count');
    incidents = { available: true, window_days: INCIDENT_WINDOW_DAYS, count, basis: INCIDENT_BASIS };
  } catch {
    incidents = {
      available: false,
      window_days: INCIDENT_WINDOW_DAYS,
      reason: 'The status-page incident table could not be read, so the count is unknown rather '
        + 'than zero.',
    };
  }

  // ── Broadcast (D202, H17 P6) ──────────────────────────────────────────
  // The token is a deployment fact, not a row, so it is reported whichever
  // way the channel read goes — and said once, not once per channel.
  const tokenConfigured = telegramTokenConfigured(env);
  let telegram: unknown;
  try {
    // `chat_bound` is `/send`'s own test (`if (!post.chat_id)`) done in SQL,
    // so the id is reduced to a boolean before it leaves the database.
    const rows = await env.DB.prepare(
      `SELECT c.id, c.label, c.audience, c.enabled, c.last_test_at, c.last_error,
              CASE WHEN c.chat_id IS NULL OR c.chat_id = '' THEN 0 ELSE 1 END AS chat_bound,
              (SELECT COUNT(*) FROM telegram_posts p
                WHERE p.channel_id = c.id AND p.status = 'sent') AS sent_count,
              (SELECT MAX(p.sent_at) FROM telegram_posts p
                WHERE p.channel_id = c.id AND p.status = 'sent') AS last_sent_at
         FROM telegram_channels c
        ORDER BY c.audience ASC, c.id ASC`,
    ).all<{
      id: number; label: string; audience: string; enabled: number;
      last_test_at: string | null; last_error: string | null;
      chat_bound: number; sent_count: number; last_sent_at: string | null;
    }>();
    const channels = (rows.results || []).map((ch) => {
      const enabled = !!ch.enabled;
      const chatBound = !!ch.chat_bound;
      return {
        id: ch.id,
        label: String(ch.label),
        audience: String(ch.audience),
        enabled,
        chat_bound: chatBound,
        // A channel's own facts decide its state; the token is platform-wide
        // and is reported beside the list rather than folded into each row.
        state: !enabled ? 'disabled' : !chatBound ? 'unbound' : 'ready',
        sent_count: countOf(ch.sent_count, 'sent count'),
        last_sent_at: ch.last_sent_at || null,
        last_test_at: ch.last_test_at || null,
        last_error: ch.last_error ? String(ch.last_error).slice(0, 200) : null,
      };
    });
    telegram = {
      available: true,
      token_configured: tokenConfigured,
      channels,
      members_available: false,
      members_reason: MEMBERS_REASON,
    };
  } catch {
    telegram = {
      available: false,
      token_configured: tokenConfigured,
      reason: 'The Telegram channel table could not be read.',
    };
  }

  // X is listed whether or not it is set up: the canvas's own rule, that an
  // absent row looks like a decision nobody made.
  const xConfigured = xClientConfigured(env);
  let x: unknown;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS accounts,
              COALESCE(SUM(CASE WHEN enabled THEN 1 ELSE 0 END), 0) AS enabled
         FROM x_accounts`,
    ).first<{ accounts: number; enabled: number }>();
    x = {
      available: true,
      client_configured: xConfigured,
      accounts: countOf(row?.accounts, 'X account count'),
      enabled_accounts: countOf(row?.enabled, 'enabled X account count'),
    };
  } catch {
    x = { available: false, client_configured: xConfigured, reason: 'The X account table could not be read.' };
  }

  // ── Switches (D202, H17 P7) ───────────────────────────────────────────
  let switches: unknown;
  try {
    switches = { available: true, items: await readPlatformSwitches(env) };
  } catch {
    switches = { available: false, reason: 'The platform switches could not be read.' };
  }

  // ── Integration keys (D213, H16 P1) ──────────────────────────────────
  // The read lives in services/providerOauthKeys, beside the table it reads:
  // this file never names that table's columns. `readProviderKeyStatus`
  // creates nothing and reports a failed read, and only four fields per key
  // leave this block.
  let integrationKeys: unknown;
  try {
    const status = await readProviderKeyStatus(env);
    const lastSet = await readProviderKeyLastSet(env);
    const items = status.items.map((item) => {
      const state = keyStateOf(item, status.db_readable);
      let lastSetAt: string | null = null;
      let lastSetBasis: 'console_audit' | 'd1_row' | 'no_record' | 'unreadable' | null = null;
      if (state === 'env') {
        if (!lastSet.available) {
          lastSetBasis = 'unreadable';
        } else {
          lastSetAt = lastSet.byProvider.get(item.provider_key) ?? null;
          lastSetBasis = lastSetAt ? 'console_audit' : 'no_record';
        }
      } else if (state === 'db') {
        lastSetAt = item.updated_at ?? null;
        lastSetBasis = lastSetAt ? 'd1_row' : 'no_record';
      }
      return { provider_key: item.provider_key, state, last_set_at: lastSetAt, last_set_basis: lastSetBasis };
    });
    const count = (st: string) => items.filter((it) => it.state === st).length;
    integrationKeys = {
      available: true,
      managed: MANAGED_PROVIDERS.length,
      db_readable: status.db_readable,
      db_reason: status.db_readable
        ? null
        : 'The key table could not be read, so a key not set as a Worker secret may or may not be '
          + 'held there. Those rows say unknown rather than unset.',
      counts: { env: count('env'), db: count('db'), unset: count('unset'), unreadable: count('unreadable') },
      items,
      last_set_available: lastSet.available,
      last_set_reason: lastSet.available
        ? LAST_SET_BASIS_NOTE
        : 'The audit log could not be read, so when a key held as a Worker secret was last saved is unknown.',
      notes: KEY_NOTES,
    };
  } catch {
    integrationKeys = {
      available: false,
      reason: 'The managed keys could not be read.',
    };
  }

  // ── GitHub sync (D213, H16 P2) ────────────────────────────────────────
  // Three reads, three states. The target is an env fact and cannot fail; the
  // window is Support's own reader, reused rather than restated; the recent
  // list is its own read. None of them creates a column.
  const githubSync = {
    target: githubMirrorTarget(env),
    window: await readTicketSync(env),
    recent: await readRecentSyncAttempts(env),
    recent_note: SYNC_RECENT_NOTE,
  };

  // ── Payments catalog (D213, H16 P3) ───────────────────────────────────
  // The publishable key is one KV read, the same answer checkout is given.
  // Masked by the Payments console's own mask; its mode comes from its own
  // prefix, never from anything secret.
  const pk = await getPublishableKey(env);
  const publishable = { configured: !!pk, masked: maskPublishableKey(pk), mode: publishableKeyMode(pk) };
  const catalog = await readCatalogMirrorSummary(env);
  let webhook: unknown;
  try {
    // The last delivery rides idx_activity_endpoint and the rowid within it.
    const last = await env.DB.prepare(
      `SELECT status_code, latency_ms, created_at FROM activity_logs
        WHERE endpoint = ? ORDER BY id DESC LIMIT 1`,
    ).bind(STRIPE_WEBHOOK_PATH).first<{ status_code: number | null; latency_ms: number | null; created_at: string }>();
    // datetime() on both sides: `created_at` is written by datetime('now').
    // A row with no recorded status is a delivery, not a refusal: only a
    // status that was written and is outside 2xx counts as not-2xx.
    const day = await env.DB.prepare(
      `SELECT COUNT(*) AS deliveries,
              COALESCE(SUM(CASE WHEN status_code IS NOT NULL
                                 AND (status_code < 200 OR status_code >= 300) THEN 1 ELSE 0 END), 0) AS refused
         FROM activity_logs
        WHERE endpoint = ?
          AND datetime(created_at) > datetime('now', ?)`,
    ).bind(STRIPE_WEBHOOK_PATH, `-${WEBHOOK_WINDOW_HOURS} hours`).first<{ deliveries: number; refused: number }>();
    webhook = {
      available: true,
      window_hours: WEBHOOK_WINDOW_HOURS,
      last: last
        ? {
            status_code: last.status_code == null ? null : Number(last.status_code),
            latency_ms: last.latency_ms == null ? null : Number(last.latency_ms),
            at: String(last.created_at),
          }
        : null,
      deliveries: countOf(day?.deliveries, 'webhook delivery count'),
      not_2xx: countOf(day?.refused, 'webhook non-2xx count'),
      basis: WEBHOOK_BASIS,
    };
  } catch {
    webhook = {
      available: false,
      window_hours: WEBHOOK_WINDOW_HOURS,
      reason: 'The request log could not be read, so the webhook\'s deliveries are unknown rather than none.',
    };
  }
  const paymentsCatalog = {
    publishable,
    catalog,
    webhook,
    storefront_note: STOREFRONT_NOTE,
  };

  // ── Promo codes (D213, H16 P4) ────────────────────────────────────────
  // No schema bootstrap: migration 099 is in the baseline, and a database
  // without it answers unreadable rather than being altered by a read. The
  // state of every code is counted, not only the listed fifty.
  let promoCodes: unknown;
  try {
    const res = await env.DB.prepare(
      `SELECT id, code, percent_off, amount_off, currency, duration, product_ids_json,
              max_redemptions, times_redeemed, active, expires_at, created_at
         FROM promo_codes
        ORDER BY datetime(created_at) DESC, id DESC`,
    ).all<{
      id: string; code: string; percent_off: number | null; amount_off: number | null;
      currency: string | null; duration: string; product_ids_json: string | null;
      max_redemptions: number | null; times_redeemed: number; active: number;
      expires_at: string | null; created_at: string;
    }>();
    const nowMs = Date.now();
    const counts = { active: 0, inactive: 0, expired: 0, exhausted: 0 };
    const all = (res.results || []).map((row) => {
      const redeemed = countOf(row.times_redeemed, 'times redeemed');
      const state = promoState(row, redeemed, nowMs);
      counts[state] += 1;
      let productCount: number | null;
      try {
        const ids = JSON.parse(String(row.product_ids_json ?? '[]'));
        productCount = Array.isArray(ids) ? ids.length : null;
      } catch {
        productCount = null;
      }
      return {
        code: String(row.code),
        state,
        percent_off: row.percent_off == null ? null : Number(row.percent_off),
        amount_off: row.amount_off == null ? null : Number(row.amount_off),
        currency: row.currency ? String(row.currency) : null,
        duration: String(row.duration),
        // null is "the list did not parse", which is not "all products" (0).
        product_count: productCount,
        max_redemptions: row.max_redemptions == null ? null : Number(row.max_redemptions),
        times_redeemed: redeemed,
        expires_at: row.expires_at || null,
      };
    });
    promoCodes = {
      available: true,
      total: all.length,
      counts,
      items: all.slice(0, PROMO_LIST_LIMIT),
      listed_limit: PROMO_LIST_LIMIT,
      truncated: all.length > PROMO_LIST_LIMIT,
      caveats: PROMO_CAVEATS,
    };
  } catch {
    promoCodes = {
      available: false,
      reason: 'The promo code mirror could not be read, so no code is listed rather than none existing.',
    };
  }

  return c.json({
    integrations,
    jobs,
    monitoring: { dlq, incidents },
    broadcast: { telegram, x },
    // D213 — H16's four consoles, summarised, each block its own state.
    integration_keys: integrationKeys,
    github_sync: githubSync,
    payments_catalog: paymentsCatalog,
    promo_codes: promoCodes,
    // D203 — the switches block is the whole answer now. It used to travel
    // with `flags_available: false` and a sentence saying no operator store
    // existed; the store exists, and the writable entry in `switches` says
    // what it holds. A refusal nothing reads would be a producer with no
    // reader, so the pair is gone rather than flipped.
    switches,

    ...DERIVED_UNAVAILABLE,
  });
});

// ---------------------------------------------------------------------------
// D203 — the operator switches. SUPER ADMIN ONLY.
//
//   GET  /switches       every switch an operator can throw, with both halves
//   POST /switches/:key  throw or release one: { action: 'throw'|'release', reason }
//
// THE WRITE TAKES force-reauth's SHAPE, step for step, because it is the same
// kind of act — one operator, changing what every user gets:
//
//   1. requireSuperAdminWriteBar — a TOTP-minted session, a recent step-up,
//      the elevation. On a branch the elevation does not exist (D106), so a
//      branch answers "HQ only" before anything else is read.
//   2. The key. One nobody knows is 404; one the registry knows but an
//      operator cannot throw is 409, and says what does change it.
//   3. The action, then a reason of SWITCH_REASON_MIN characters — stored on
//      the row and in the audit entry.
//   4. No change is 409, decided INSIDE the write, so two operators pressing
//      at once cannot both record one.
//   5. A store that cannot be written is 503 and nothing changed.
//   6. One audit row through logAdminAction, after the act and never before
//      it. No `user_id` key — the switch is nobody's account.
// ---------------------------------------------------------------------------
r.get('/switches', async (c) => {
  await requireSuperAdmin(c);
  let items: unknown;
  try {
    items = await readOperatorSwitchEntries(c.env);
  } catch {
    return c.json({ available: false, reason: 'The operator switches could not be read.' });
  }
  return c.json({
    available: true,
    items,
    reason_min: SWITCH_REASON_MIN,
    // Stated, not implied: the writing isolate sees a change at once, every
    // other isolate within this many seconds.
    propagation_seconds: OPERATOR_SWITCH_TTL_MS / 1000,
    reach: OPERATOR_SWITCH_REACH,
  });
});

// ---------------------------------------------------------------------------
// D209 — H14, the topology stated once. Pure over `env` (services/topology.ts),
// so there is no store to fail and no unreadable state of its own. The branch
// rows it is drawn beside come from GET /api/admin/deployments, which carries
// their registry rows and live health; this says what each of them IS.
//
// Super admin only, and on a branch it answers "HQ only": a branch reads its
// own half at GET /api/branch/deployment.
// ---------------------------------------------------------------------------
r.get('/topology', async (c) => {
  await requireSuperAdmin(c);
  return c.json(describeTopology(c.env));
});

r.post('/switches/:key', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);

  const key = String(c.req.param('key') || '');
  if (!isOperatorSwitchKey(key)) {
    if ((PLATFORM_SWITCH_KEYS as readonly string[]).includes(key)) {
      return c.json({
        error: 'That switch is not one an operator throws. It is set by the deployment, or by the '
          + 'platform itself, and only that changes it.',
        code: 'not_operator_switch',
      }, 409);
    }
    return c.json({ error: 'No switch has that name.', code: 'unknown_switch' }, 404);
  }

  let body: { action?: unknown; reason?: unknown } = {};
  try { body = (await c.req.json()) ?? {}; } catch { body = {}; }
  const action = String(body.action ?? '');
  if (action !== 'throw' && action !== 'release') {
    return c.json({ error: 'The action must be "throw" or "release".', code: 'invalid_action' }, 400);
  }
  const reason = String(body.reason ?? '').trim();
  if (reason.length < SWITCH_REASON_MIN) {
    return c.json({
      error: `A reason of at least ${SWITCH_REASON_MIN} characters is required. It is stored with the switch and in the audit log.`,
      code: 'reason_required',
    }, 400);
  }

  const thrown = action === 'throw';
  let changed: boolean;
  try {
    ({ changed } = await setOperatorSwitch(c.env, key, thrown, reason, actor.id));
  } catch {
    return c.json({
      error: 'The operator switch store could not be written, so nothing was changed.',
      code: 'store_unavailable',
    }, 503);
  }
  if (!changed) {
    return c.json({
      error: thrown ? 'That switch is already thrown.' : 'That switch is not thrown, so there is nothing to release.',
      code: 'no_change',
    }, 409);
  }

  await logAdminAction(c.env, actor.id, actor.email, thrown ? 'platform_switch_thrown' : 'platform_switch_released', {
    reason,
    switch_key: key,
  });

  // The switch as it now stands, read back from the store — including whether
  // the deploy half still holds it on after a release, which a release cannot
  // change and the operator needs told.
  let entry: unknown = null;
  try {
    entry = (await readOperatorSwitchEntries(c.env)).find((sw) => sw.key === key) ?? null;
  } catch { entry = null; }
  return c.json({
    ok: true,
    switch: entry,
    message: thrown
      ? `Thrown. This deployment refuses at once; every instance follows within ${OPERATOR_SWITCH_TTL_MS / 1000} seconds.`
      : `Released. Every instance follows within ${OPERATOR_SWITCH_TTL_MS / 1000} seconds, unless the deployment still holds it on.`,
  });
});

// ---------------------------------------------------------------------------
// 241 — the advisory take rate. SUPER ADMIN ONLY.
//
//   GET  /take-rate    what the platform charges an advisory session, and
//                      whether that is a stored decision or the default
//   PUT  /take-rate    change it, audited
//
// THIS IS NOT A SWITCH, and the distinction is worth keeping now that D203
// gives the platform an operator switch store. A switch can only switch
// something off; this is ONE typed platform number, in `platform_settings`,
// with an `updated_by` because a rate that decides what the platform charges
// is a thing somebody has to be answerable for having changed (migration 241).
//
// NOTHING HERE MOVES MONEY. Advisory charging is off — `settlementMode()`
// answers 'none' until PR5b's flag flips — so this sets the rate that a
// future charge WOULD use and that today's ledger projects with. The response
// says so rather than leaving a percentage to imply otherwise. D75.
// ---------------------------------------------------------------------------
r.get('/take-rate', async (c) => {
  const admin = await requireSuperAdmin(c);
  void admin;
  const rate = await takeRate(c.env);
  return c.json({
    bps: rate.bps,
    // Both forms, because the store is basis points and every human reads
    // percent. Derived here so no component divides by 100 on its own.
    pct: rate.bps / 100,
    source: rate.source,
    updated_at: rate.updated_at,
    updated_by: rate.updated_by,
    max_bps: MAX_TAKE_RATE_BPS,
    default_bps: DEFAULT_TAKE_RATE_BPS,
    settlement: settlementMode(c.env),
    note: 'Applied to advisory sessions when a price is recorded, and stamped on that '
      + 'line so a later change to this rate cannot restate a past quarter.',
  });
});

r.put('/take-rate', async (c) => {
  const admin = await requireSuperAdmin(c);
  const body = await c.req.json().catch(() => ({} as any));

  // BASIS POINTS ONLY, and no coercion from a percentage. Accepting both would
  // make `15` ambiguous — 15 bps is 0.15% and 15% is 1500 — and the form that
  // guessed wrong would undercharge by a factor of a hundred without erroring.
  const raw = body.bps;
  const bps = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_TAKE_RATE_BPS) {
    return c.json({
      detail: `bps must be a whole number of basis points between 0 and ${MAX_TAKE_RATE_BPS} `
        + `(1500 = 15%). A percentage is not accepted here: 15 would be 0.15%.`,
    }, 400);
  }

  const before = await takeRate(c.env);
  const actor = String((admin as any)?.email || (admin as any)?.id || 'super_admin');
  await c.env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(TAKE_RATE_KEY, String(bps), new Date().toISOString(), actor).run();

  // AUDITED, and the BEFORE value is in the row. "Someone set it to 12%" does
  // not answer "what was it before, and for how long" — which is the question
  // asked when an advisor disputes a quarter. Best-effort, matching the
  // convention elsewhere: the setting has already changed, so a logging hiccup
  // must not imply it has not.
  try {
    await ensureAdminAuditLogTable(c.env);
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json)
       VALUES (?, ?, ?, ?)`,
    ).bind(
      (admin as any).id, 'advisor_take_rate_update', 'platform',
      JSON.stringify({ from_bps: before.bps, from_source: before.source, to_bps: bps }),
    ).run();
  } catch (e: any) {
    console.warn('[admin_platform] take-rate audit failed:', String(e?.message || e));
  }

  const after = await takeRate(c.env);
  return c.json({
    bps: after.bps,
    pct: after.bps / 100,
    source: after.source,
    updated_at: after.updated_at,
    updated_by: after.updated_by,
    previous_bps: before.bps,
    // SAID ON THE WRITE, not only on the read. An operator who has just
    // changed a rate is exactly the person who might assume it started
    // charging something.
    settlement: settlementMode(c.env),
    applies_from: 'Sessions priced after this change. Lines already recorded keep the rate '
      + 'they were stamped with.',
  });
});

export default r;
