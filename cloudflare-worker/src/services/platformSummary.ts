/**
 * D4859 (#4859) — HQ · Platform's summary, one reader per panel.
 *
 * `GET /api/admin/platform/summary` used to read every panel in turn inside the route: integrations, the scheduled
 * jobs, the dead-letter backlog, incidents, Telegram, X, switches, integration keys, GitHub sync, the payments
 * catalogue and promo codes, about a dozen round-trips one after another. Each block already failed on its own
 * (`{ available: false, reason }`), so nothing ordered them but the code. Each panel is now a reader here, and
 * `readPlatformSummary` runs them together.
 *
 * THE RULES THE ROUTE HAD, KEPT:
 *   - every block carries its own state; one store failing makes that block unreadable, with its reason, and leaves
 *     the others standing; an unreadable count is never sent as a zero (`countOf`);
 *   - no key material, chat id, Stripe or GitHub call, and no schema is created by reading;
 *   - the response is the same shape, key for key, as before.
 *
 * WHAT IS NEW: a reader that throws, or does not answer within `deadlineMs`, becomes ITS OWN block's unreadable state
 * (`settle`), so a slow or broken store cannot hold up or fail an unrelated panel. The readers are a fixed list of
 * eleven, so `Promise.all` over them is bounded by construction.
 */
import type { Env } from '../types';
import { readWebhookDeliveries } from './stripeWebhookDeliveries';
import { CRON_TRIGGERS, STALE_GRACE_MINUTES, latestRunPerTrigger, triggerState } from '../util/cronHistory';
import { dlqDepth } from './deadLetters';
import { readPlatformSwitches } from './platformSwitches';
import { telegramTokenConfigured } from './telegramClient';
import { xClientConfigured } from './xClient';
import { MANAGED_PROVIDERS, keyStateOf, readProviderKeyLastSet, readProviderKeyStatus } from './providerOauthKeys';
import { githubMirrorTarget } from './githubSync';
import { readRecentSyncAttempts, readTicketSync } from './supportQueues';
import { getPublishableKey, maskPublishableKey, publishableKeyMode, readCatalogMirrorSummary } from './catalog';
import { promoState, readProductIds } from './promos';

export { STRIPE_WEBHOOK_PATH, WEBHOOK_WINDOW_HOURS } from './stripeWebhookDeliveries';

/** H17 P5's "Incidents (7d)" — the window the count is taken over. */
export const INCIDENT_WINDOW_DAYS = 7;

/**
 * Said with the count, because a zero here is easy to misread. The public
 * status page publishes what `status_incidents` holds, and the only writer is
 * `POST /api/public/status/incidents` — an admin intake that nothing in the
 * product calls. So the number is what somebody entered, not what happened.
 */
export const INCIDENT_BASIS =
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
  'A promo ceiling belongs to a licence, not to a code. A branch checkout refuses a discount that is '
  + 'more than the ceiling HQ set for the period has left. A branch with no ceiling set for the period '
  + 'allows discounts until HQ sets one (set on Revenue); its ceiling is Not recorded, which is not 0 and '
  + 'not unlimited, and what it gives meanwhile is still counted. A checkout on HQ\'s own Worker has no '
  + 'licence, so no ceiling applies to it. '
  + 'Only a discount on the first payment is counted: later invoices of a repeating code are not.',
  'For a code that repeats, the number of months is kept by Stripe, not here.',
];

/**
 * A count read back from SQL, or a throw. Every console block below catches
 * into its own unreadable state, so a value that is not a number fails that
 * block instead of reading as a measured zero — the `|| 0` this page is
 * built not to have. `null` is refused before `Number()` sees it, because
 * `Number(null)` is 0.
 */
export function countOf(value: unknown, what: string): number {
  const n = value === null || value === undefined ? NaN : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${what} unreadable`);
  return n;
}


/** A block that did not answer. Every panel's unreadable state has this shape, plus what the panel always carries. */
export type Unreadable = { available: false; reason: string } & Record<string, unknown>;

// ── Keys and connections ────────────────────────────────────────────────────

export async function readIntegrationsSummary(env: Env) {
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
    return {
      available: true as const,
      total,
      unhealthy,
      providers: [...byProvider.entries()].map(([provider, by_status]) => ({ provider, by_status })),
      // Said explicitly so nobody wires a reveal into this payload later.
      secrets_included: false,
      secrets_note: 'Key material is never read by this endpoint. It counts connections and reports their state.',
    };
  } catch {
    return { available: false as const, reason: 'The integrations table could not be read.' };
  }
}

// ── Scheduled jobs ──────────────────────────────────────────────────────────
// THE LIST IS THE DECLARED TRIGGERS, NOT WHATEVER NAMES THE TABLE HOLDS. A trigger that has never recorded a run is
// the finding, so it has to be on the list to be seen, and a row under a name nobody declares is not a job HQ runs.
// One indexed read per trigger, in place of a GROUP BY that read the whole table on every load.

export async function readJobsSummary(env: Env, now = new Date()) {
  try {
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
    return {
      available: true as const,
      grace_minutes: STALE_GRACE_MINUTES,
      triggers: list,
      failing: list.filter((j) => j.state === 'failed').length,
      stale: list.filter((j) => j.state === 'stale').length,
      never: list.filter((j) => j.state === 'never').length,
    };
  } catch {
    return { available: false as const, reason: 'The scheduled-run history could not be read.' };
  }
}

// ── Monitoring (D202, H17 P5) ──────────────────────────────────────────────
// Two of P5's four stats are computed here. The other two are the page's, from reads it already makes: Workers
// healthy from /deployments, cron triggers from `jobs`.

/** The dead-letter backlog over both of its tables; `dlqDepth` carries its own unreadable state. */
export const readDlqSummary = (env: Env) => dlqDepth(env);

export async function readIncidentSummary(env: Env) {
  try {
    // datetime() on both sides: `created_at` is written by datetime('now'),
    // and a bound ISO cutoff would read a same-day row as older than it is.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM status_incidents
        WHERE datetime(created_at) >= datetime('now', ?)`,
    ).bind(`-${INCIDENT_WINDOW_DAYS} days`).first<{ n: number }>();
    const count = countOf(row?.n, 'incident count');
    return { available: true as const, window_days: INCIDENT_WINDOW_DAYS, count, basis: INCIDENT_BASIS };
  } catch {
    return {
      available: false as const,
      window_days: INCIDENT_WINDOW_DAYS,
      reason: 'The status-page incident table could not be read, so the count is unknown rather '
        + 'than zero.',
    };
  }
}

// ── Broadcast (D202, H17 P6) ───────────────────────────────────────────────

export async function readTelegramSummary(env: Env) {
  // The token is a deployment fact, not a row, so it is reported whichever
  // way the channel read goes — and said once, not once per channel.
  const tokenConfigured = telegramTokenConfigured(env);
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
    return {
      available: true as const,
      token_configured: tokenConfigured,
      channels,
      members_available: false,
      members_reason: MEMBERS_REASON,
    };
  } catch {
    return {
      available: false as const,
      token_configured: tokenConfigured,
      reason: 'The Telegram channel table could not be read.',
    };
  }
}

// X is listed whether or not it is set up: the canvas's own rule, that an
// absent row looks like a decision nobody made.
export async function readXSummary(env: Env) {
  const xConfigured = xClientConfigured(env);
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS accounts,
              COALESCE(SUM(CASE WHEN enabled THEN 1 ELSE 0 END), 0) AS enabled
         FROM x_accounts`,
    ).first<{ accounts: number; enabled: number }>();
    return {
      available: true as const,
      client_configured: xConfigured,
      accounts: countOf(row?.accounts, 'X account count'),
      enabled_accounts: countOf(row?.enabled, 'enabled X account count'),
    };
  } catch {
    return { available: false as const, client_configured: xConfigured, reason: 'The X account table could not be read.' };
  }
}

// ── Switches (D202, H17 P7) ────────────────────────────────────────────────

export async function readSwitchSummary(env: Env) {
  try {
    return { available: true as const, items: await readPlatformSwitches(env) };
  } catch {
    return { available: false as const, reason: 'The platform switches could not be read.' };
  }
}

// ── Integration keys (D213, H16 P1) ────────────────────────────────────────
// The read lives in services/providerOauthKeys, beside the table it reads: this reader never names that table's
// columns. `readProviderKeyStatus` creates nothing and reports a failed read, and only four fields per key leave it.

export async function readIntegrationKeySummary(env: Env) {
  try {
    const [status, lastSet] = await Promise.all([readProviderKeyStatus(env), readProviderKeyLastSet(env)]);
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
    return {
      available: true as const,
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
    return { available: false as const, reason: 'The managed keys could not be read.' };
  }
}

// ── GitHub sync (D213, H16 P2) ─────────────────────────────────────────────
// Three reads, three states. The target is an env fact and cannot fail; the window is Support's own reader, reused
// rather than restated; the recent list is its own read. None of them creates a column.

export async function readGithubSummary(env: Env) {
  const [window, recent] = await Promise.all([readTicketSync(env), readRecentSyncAttempts(env)]);
  return { target: githubMirrorTarget(env), window, recent, recent_note: SYNC_RECENT_NOTE };
}

// ── Payments catalog (D213, H16 P3) ────────────────────────────────────────
// The publishable key is one KV read, the same answer checkout is given. Masked by the Payments console's own mask;
// its mode comes from its own prefix, never from anything secret. The deliveries are one reader shared with
// Payments' PAY5 (D1011).

export async function readPaymentsSummary(env: Env) {
  const [pk, catalog, webhook] = await Promise.all([getPublishableKey(env), readCatalogMirrorSummary(env), readWebhookDeliveries(env)]);
  const publishable = { configured: !!pk, masked: maskPublishableKey(pk), mode: publishableKeyMode(pk) };
  return { publishable, catalog, webhook, storefront_note: STOREFRONT_NOTE };
}

// ── Promo codes (D213, H16 P4) ─────────────────────────────────────────────
// No schema bootstrap: migration 099 is in the baseline, and a database without it answers unreadable rather than
// being altered by a read. The state of every code is counted, not only the listed fifty.

export async function readPromoSummary(env: Env, nowMs = Date.now()) {
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
    const counts = { active: 0, inactive: 0, expired: 0, exhausted: 0 };
    const all = (res.results || []).map((row) => {
      const redeemed = countOf(row.times_redeemed, 'times redeemed');
      const state = promoState(row, redeemed, nowMs);
      counts[state] += 1;
      // null in the column is the migration default, an empty list: every product.
      // A value that is not a JSON array of strings did not parse.
      const products = readProductIds(row.product_ids_json ?? '[]');
      const productCount = products.ok ? products.ids.length : null;
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
    return {
      available: true as const,
      total: all.length,
      counts,
      items: all.slice(0, PROMO_LIST_LIMIT),
      listed_limit: PROMO_LIST_LIMIT,
      truncated: all.length > PROMO_LIST_LIMIT,
      caveats: PROMO_CAVEATS,
    };
  } catch {
    return {
      available: false as const,
      reason: 'The promo code mirror could not be read, so no code is listed rather than none existing.',
    };
  }
}

// ── The orchestration ──────────────────────────────────────────────────────

/** How long one panel may take before it reads as unanswered; the others are not held. */
export const READER_DEADLINE_MS = 8_000;

const DEADLINE = Symbol('deadline');

/**
 * `read()`'s answer, or `fallback` when it throws or has not answered within `deadlineMs`. A reader already catches
 * its own store's failure into its own state; this is the second wall, for a throw nobody expected and for a store
 * that hangs, so neither reaches another block. The timer is cleared, so a fast answer leaves nothing pending.
 */
export async function settle<T, F>(read: () => Promise<T>, fallback: (why: 'failed' | 'timed_out') => F, deadlineMs = READER_DEADLINE_MS): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<typeof DEADLINE>((resolve) => { timer = setTimeout(() => resolve(DEADLINE), deadlineMs); });
  try {
    const out = await Promise.race([read(), deadline]);
    if (out === DEADLINE) {
      console.warn('[platform-summary] a reader did not answer in time');
      return fallback('timed_out');
    }
    return out as T;
  } catch (e) {
    console.warn('[platform-summary] a reader failed', (e as Error)?.message);
    return fallback('failed');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const why = (what: string) => (w: 'failed' | 'timed_out') => (w === 'timed_out'
  ? `${what} did not answer in time, so it is not shown. That is not the same as none.`
  : `${what} could not be read.`);

/** The readers the summary is made of, by the key each one fills. Swapped in tests to prove isolation. */
export type PlatformSummaryReaders = {
  integrations: (env: Env) => Promise<unknown>;
  jobs: (env: Env) => Promise<unknown>;
  dlq: (env: Env) => Promise<unknown>;
  incidents: (env: Env) => Promise<unknown>;
  telegram: (env: Env) => Promise<unknown>;
  x: (env: Env) => Promise<unknown>;
  switches: (env: Env) => Promise<unknown>;
  integration_keys: (env: Env) => Promise<unknown>;
  github_sync: (env: Env) => Promise<unknown>;
  payments_catalog: (env: Env) => Promise<unknown>;
  promo_codes: (env: Env) => Promise<unknown>;
};

export const PLATFORM_SUMMARY_READERS: PlatformSummaryReaders = {
  integrations: readIntegrationsSummary,
  jobs: (env) => readJobsSummary(env),
  dlq: readDlqSummary,
  incidents: readIncidentSummary,
  telegram: readTelegramSummary,
  x: readXSummary,
  switches: readSwitchSummary,
  integration_keys: readIntegrationKeySummary,
  github_sync: readGithubSummary,
  payments_catalog: readPaymentsSummary,
  promo_codes: (env) => readPromoSummary(env),
};

/** Each block's answer when its reader fails or times out: its own shape, `available: false`, and why. */
function fallbacks(env: Env): Record<keyof PlatformSummaryReaders, (w: 'failed' | 'timed_out') => unknown> {
  return {
    integrations: (w: 'failed' | 'timed_out') => ({ available: false, reason: why('The integrations table')(w) }),
    jobs: (w: 'failed' | 'timed_out') => ({ available: false, reason: why('The scheduled-run history')(w) }),
    dlq: (w: 'failed' | 'timed_out') => ({ available: false, reason: why('The dead-letter backlog')(w) }),
    incidents: (w: 'failed' | 'timed_out') => ({ available: false, window_days: INCIDENT_WINDOW_DAYS, reason: why('The status-page incident table')(w) }),
    telegram: (w: 'failed' | 'timed_out') => ({ available: false, token_configured: telegramTokenConfigured(env), reason: why('The Telegram channel table')(w) }),
    x: (w: 'failed' | 'timed_out') => ({ available: false, client_configured: xClientConfigured(env), reason: why('The X account table')(w) }),
    switches: (w: 'failed' | 'timed_out') => ({ available: false, reason: why('The platform switches')(w) }),
    integration_keys: (w: 'failed' | 'timed_out') => ({ available: false, reason: why('The managed keys')(w) }),
    github_sync: (w: 'failed' | 'timed_out') => ({
      target: githubMirrorTarget(env),
      window: { available: false, reason: why('The mirror window')(w) },
      recent: { available: false, reason: why('The recent mirror attempts')(w) },
      recent_note: SYNC_RECENT_NOTE,
    }),
    payments_catalog: (w: 'failed' | 'timed_out') => ({
      publishable: { configured: null, masked: null, mode: null },
      catalog: { available: false, reason: why('The catalog mirror')(w) },
      webhook: { available: false, reason: why('The webhook deliveries')(w) },
      storefront_note: STOREFRONT_NOTE,
    }),
    promo_codes: (w: 'failed' | 'timed_out') => ({ available: false, reason: why('The promo code mirror')(w) }),
  };
}

/**
 * Every panel of `GET /summary`, read concurrently, in the response's own shape. The route adds only its own
 * derived-unavailable fields.
 */
export async function readPlatformSummary(env: Env, { readers = PLATFORM_SUMMARY_READERS, deadlineMs = READER_DEADLINE_MS }: { readers?: PlatformSummaryReaders; deadlineMs?: number } = {}) {
  const fb = fallbacks(env);
  const keys = Object.keys(readers) as (keyof PlatformSummaryReaders)[];
  const answers = await Promise.all(keys.map((k) => settle(() => readers[k](env), fb[k], deadlineMs)));
  const got = Object.fromEntries(keys.map((k, i) => [k, answers[i]])) as Record<keyof PlatformSummaryReaders, unknown>;
  return {
    integrations: got.integrations,
    jobs: got.jobs,
    monitoring: { dlq: got.dlq, incidents: got.incidents },
    broadcast: { telegram: got.telegram, x: got.x },
    // D213 — H16's four consoles, summarised, each block its own state.
    integration_keys: got.integration_keys,
    github_sync: got.github_sync,
    payments_catalog: got.payments_catalog,
    promo_codes: got.promo_codes,
    // D203 — the switches block is the whole answer now. It used to travel with `flags_available: false` and a
    // sentence saying no operator store existed; the store exists, and the writable entry in `switches` says what it
    // holds. A refusal nothing reads would be a producer with no reader, so the pair is gone rather than flipped.
    switches: got.switches,
  };
}
