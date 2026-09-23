/**
 * HQ · Platform — canvas H6 ("Keys, flags, jobs") and H17 ("Monitoring,
 * Broadcast, Feature flags").
 *
 * SUPER ADMIN ONLY.
 *
 *   GET /summary      connected integrations, scheduled-job health, the
 *                     monitoring and broadcast consoles, and the platform's
 *                     switches, read-only
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
 *          click, re-hide after thirty seconds" belongs to the console that
 *          owns key material, not to a read-only HQ summary.
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
 *   Flags  STILL NO STORE. D202 corrects the reason this endpoint gave for
 *          it and D203 builds one. What the platform has is switches set at
 *          deploy, listed read-only by services/platformSwitches, each asked
 *          through the predicate the code that obeys it uses.
 *
 * Mounted at /api/admin/platform BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { DERIVED_UNAVAILABLE } from './licence';
import { ensureAdminAuditLogTable } from './admin';
import {
  DEFAULT_TAKE_RATE_BPS, MAX_TAKE_RATE_BPS, TAKE_RATE_KEY, settlementMode, takeRate,
} from '../services/advisorMoney';
import {
  CRON_TRIGGERS, STALE_GRACE_MINUTES, latestRunPerTrigger, triggerState,
} from '../util/cronHistory';
import { dlqDepth } from '../services/deadLetters';
import { readPlatformSwitches } from '../services/platformSwitches';
import { telegramTokenConfigured } from '../services/telegramClient';
import { xClientConfigured } from '../services/xClient';

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

  return c.json({
    integrations,
    jobs,
    monitoring: { dlq, incidents },
    broadcast: { telegram, x },
    switches,

    // Still no store, and now the reason is true. The old one said that
    // what the codebase calls flags is per-user settings, and the codebase
    // also calls MI_FLAG_* and DD_FLAG_* flags — platform switches, set at
    // deploy. D202.
    flags_available: false,
    flags_reason:
      'There is no feature-flag store: nothing an operator can throw from the product or stage to '
      + 'one territory, and per-user settings (services/userSettings.ts) are a person\'s own '
      + 'preferences, not platform switches. What the platform does have is switches set at deploy, '
      + 'and one the AI router throws by itself, listed below read-only.',

    ...DERIVED_UNAVAILABLE,
  });
});

// ---------------------------------------------------------------------------
// 241 — the advisory take rate. SUPER ADMIN ONLY.
//
//   GET  /take-rate    what the platform charges an advisory session, and
//                      whether that is a stored decision or the default
//   PUT  /take-rate    change it, audited
//
// THIS IS NOT THE FLAGS PANEL the summary above says does not exist, and the
// distinction is worth keeping. `flags_available: false` is still true: there
// is no feature-flag registry, and nothing here creates one. What migration
// 241 adds is ONE typed platform number, in `platform_settings`, with an
// `updated_by` because a rate that decides what the platform charges is a
// thing somebody has to be answerable for having changed.
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
