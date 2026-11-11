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
 *   GET  /storage        every member's stored bytes as totals by kind, plan
 *                        and state; no name or file name (D1170)
 *   GET  /capacity       this Worker's D1 size against its plan limit, queue
 *                        backlog and oldest-message age, binding presence;
 *                        unavailable is never zero (D4559)
 *   GET  /capacity/history  daily snapshots and the D1 projected limit month,
 *                        with its window and confidence (D4559 part 2)
 *   GET  /capacity/alerts   open capacity alert episodes and those cleared in
 *                        the last 30 days (D4559 part 2)
 *   POST /capacity/alerts/:id/mute  mute an open episode for up to a week,
 *                        with a reason, audited (D4559 part 2)
 *   GET  /advisory-refunds-due  advisory charges owed back, open first (D4703)
 *   POST /advisory-refunds-due/:id/resolve  record that one was refunded, with
 *                        a reason, audited; moves no money (#5305)
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
import { backfillMemberFileSizes } from '../services/memberFileSizeBackfill';
import { ownBotTest, dispatchBotTest, validBotTestId } from '../services/meetingBotOperationsTest';
import { readMeetingBotOperations, meetingBotPricePolicy, readRecentBotFailures } from '../services/meetingBotOperationsRead';
import { startDiagnosis, readDiagnosis, readDiagnosisScreenshot } from '../services/meetingBotDiagnose';
import { BotError } from '../services/meetingBots';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { DERIVED_UNAVAILABLE } from './licence';
import { ensureAdminAuditLogTable } from './admin';
import {
  DEFAULT_TAKE_RATE_BPS, MAX_TAKE_RATE_BPS, TAKE_RATE_KEY, settlementMode, takeRate,
} from '../services/advisorMoney';
import {
  PLATFORM_SWITCH_KEYS, readOperatorSwitchEntries,
} from '../services/platformSwitches';
import {
  OPERATOR_SWITCH_REACH, OPERATOR_SWITCH_TTL_MS, SWITCH_REASON_MIN, isOperatorSwitchKey, readOperatorSwitches, setOperatorSwitch,
} from '../services/operatorSwitches';
import { adminAuditStatement, logAdminAction } from '../services/adminAudit';
import { describeTopology } from '../services/topology';
import { readPlatformStorage } from '../services/storageHq';
import { d1Policy, readPlatformCapacity } from '../services/platformCapacity';
import {
  HISTORY_DAYS_DEFAULT, HISTORY_DAYS_MAX, MUTE_MAX_HOURS, muteCapacityAlert, readCapacityAlerts, readCapacityHistory,
} from '../services/platformCapacityHistory';
import { branchOf } from '../util/branch';
import { readPlatformSummary } from '../services/platformSummary';

const r = new Hono<{ Bindings: Env }>();

// D4859 (#4859): the summary's panels, their words and their readers live in services/platformSummary.ts, one reader
// per panel, run together. The constants other code and tests name stay importable from here.
export { INCIDENT_WINDOW_DAYS, PROMO_LIST_LIMIT, STRIPE_WEBHOOK_PATH, WEBHOOK_WINDOW_HOURS } from '../services/platformSummary';

r.get('/summary', async (c) => {
  await requireSuperAdmin(c);
  // D4859: every panel is read at once, each in its own state; a reader that fails or hangs answers for its own block only.
  return c.json({ ...(await readPlatformSummary(c.env)), ...DERIVED_UNAVAILABLE });
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

  let body: { action?: unknown; reason?: unknown; revision?: unknown } = {};
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
  // D4703 (#4703): a release names the activation it ends. Without it an old
  // tab could clear a newer throw; a release that does not say which is refused.
  const revision = body.revision;
  if (!thrown && !(typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0)) {
    return c.json({
      error: 'A release must name the revision of the throw it ends. Reload the switch and try again.',
      code: 'revision_required',
    }, 400);
  }
  const auditAction = thrown ? 'platform_switch_thrown' : 'platform_switch_released';
  let changed: boolean;
  let recorded = true;
  let mirrored: boolean | null = null;
  try {
    // The change and its audit row in one batch: both or neither (D4703).
    // D4860 part 3: a throw is mirrored to KV first; a D1 outage then still
    // stops Eadwyn, answered 202 below with no audit row yet.
    await ensureAdminAuditLogTable(c.env);
    ({ changed, recorded, mirrored } = await setOperatorSwitch(c.env, key, thrown, reason, actor.id, {
      revision: thrown ? undefined : (revision as number),
      audit: adminAuditStatement(c.env, actor.id, auditAction, { reason, switch_key: key, ...(thrown ? {} : { revision }) }, { onlyIfChanged: true }),
      auditMirrorOnly: thrown ? undefined : adminAuditStatement(c.env, actor.id, auditAction, { reason, switch_key: key, revision, store: 'emergency' }),
    }));
  } catch {
    return c.json({
      error: 'The operator switch store could not be written, so nothing was changed.',
      code: 'store_unavailable',
    }, 503);
  }
  if (thrown && !recorded) {
    return c.json({
      ok: true,
      recorded: false,
      code: 'thrown_unrecorded',
      message: 'Thrown in the emergency store, so Eadwyn stops within about a minute everywhere. The database did not '
        + 'answer, so there is no audit row yet: throw it again once the database answers to record it.',
    }, 202);
  }
  if (!thrown && changed && mirrored === false) {
    return c.json({
      ok: true,
      code: 'release_incomplete',
      message: 'Released in the database, but the emergency store still holds the switch, so Eadwyn stays off. '
        + 'Release it again to clear the emergency store.',
    }, 202);
  }
  if (!changed) {
    if (!thrown) {
      const now = await readOperatorSwitches(c.env, { fresh: true }).catch(() => null);
      const row = now && now.readable ? now.rows.get(key) : null;
      if (row?.thrown && row.revision !== revision) {
        return c.json({
          error: 'This switch was thrown again after this page read it. Nothing was released. Reload to see the current throw.',
          code: 'stale_revision',
          current_revision: row.revision,
        }, 409);
      }
    }
    return c.json({
      error: thrown ? 'That switch is already thrown.' : 'That switch is not thrown, so there is nothing to release.',
      code: 'no_change',
    }, 409);
  }

  // The hashed-actor activity row stays best-effort: the governance row above
  // is the record, and it landed with the change.
  await logAdminActivityOnly(c.env, actor, auditAction, { reason, switch_key: key });

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
      ? `Thrown. This deployment refuses at once; every instance follows within ${OPERATOR_SWITCH_TTL_MS / 1000} seconds${mirrored === false ? ', but the emergency store did not take it, so a database outage could release it: throw it again to mirror it' : ''}.`
      : `Released. Every instance follows within ${OPERATOR_SWITCH_TTL_MS / 1000} seconds${mirrored ? ', and within about a minute where the emergency store is read' : ''}, unless the deployment still holds it on.`,
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
/**
 * D4703 (#4703): a take rate in basis points, or null. A JSON integer, or a
 * string of digits only. Missing, null, blank, `'0x10'`, `'1e3'`, `12.5` and
 * `true` are all refused: `Number('')` is 0, and the old parse wrote 0% for a
 * request that sent nothing.
 */
export function parseTakeRateBps(raw: unknown): number | null {
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) n = Number(raw.trim());
  else return null;
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_TAKE_RATE_BPS ? n : null;
}

/** The hashed-actor `activity_logs` row only; the governance row was batched with the change. */
async function logAdminActivityOnly(env: Env, actor: { id: number; email?: string | null }, action: string, details: Record<string, unknown>) {
  try {
    const { hashEmail } = await import('../util/hashEmail');
    await env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
      .bind(action, JSON.stringify(details), await hashEmail(actor.email || ''), actor.id).run();
  } catch (e) {
    console.warn('[admin_platform] activity_logs write failed', action, (e as Error).message);
  }
}

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
  const admin = await requireSuperAdminWriteBar(c);
  // D4703 (#4703): the write bar, as the switch write has — a TOTP session and
  // a recent step-up. A rate that decides what the platform charges is as
  // sensitive as a switch.
  const body = await c.req.json().catch(() => ({} as any));

  // BASIS POINTS ONLY, and no coercion from a percentage. Accepting both would
  // make `15` ambiguous — 15 bps is 0.15% and 15% is 1500 — and the form that
  // guessed wrong would undercharge by a factor of a hundred without erroring.
  const bps = parseTakeRateBps(body.bps);
  if (bps == null) {
    return c.json({
      detail: `bps must be a whole number of basis points between 0 and ${MAX_TAKE_RATE_BPS} `
        + `(1500 = 15%). A percentage is not accepted here: 15 would be 0.15%.`,
    }, 400);
  }

  const before = await takeRate(c.env);
  const actor = String((admin as any)?.email || (admin as any)?.id || 'super_admin');

  // AUDITED, and the BEFORE value is in the row. "Someone set it to 12%" does
  // not answer "what was it before, and for how long" — which is the question
  // asked when an advisor disputes a quarter.
  //
  // D4703 (#4703): THE SETTING AND ITS RECORD IN ONE BATCH. The audit used to
  // run after the write, inside a try/catch that swallowed a failure, so the
  // rate could change with no row saying who changed it or from what. Now a
  // failed audit fails the write too, and nothing changes.
  try {
    await ensureAdminAuditLogTable(c.env);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO platform_settings (key, value, updated_at, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      ).bind(TAKE_RATE_KEY, String(bps), new Date().toISOString(), actor),
      adminAuditStatement(c.env, (admin as any).id, 'advisor_take_rate_update',
        { from_bps: before.bps, from_source: before.source, to_bps: bps }),
    ]);
  } catch (e: any) {
    console.warn('[admin_platform] take-rate write failed:', String(e?.message || e));
    return c.json({ detail: 'The take rate could not be saved with its audit record, so nothing was changed.', code: 'store_unavailable' }, 503);
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

// D4703 (#4703): advisory charges that landed on a cancelled or missed
// booking, owed back under the no-cancellation-fee policy. Open rows first.
// Booking uid and amount only: no founder or advisor is named here. #5305 adds
// the row's id (what the resolve below names), and for a resolved row who
// resolved it (an operator, by name), when, and the reason they gave.
r.get('/advisory-refunds-due', async (c) => {
  await requireSuperAdmin(c);
  try {
    const rows = await c.env.DB.prepare(
      `SELECT r.id AS id, r.booking_uid AS booking_uid, r.booking_status AS booking_status,
              r.payment_intent_id AS payment_intent_id, r.amount_cents AS amount_cents, r.currency AS currency,
              r.created_at AS created_at, r.resolved_at AS resolved_at, r.resolved_by AS resolved_by,
              u.name AS resolved_by_name, r.resolution_reason AS resolution_reason
         FROM advisory_refunds_due r
         LEFT JOIN users u ON u.id = r.resolved_by
        ORDER BY (r.resolved_at IS NOT NULL), r.created_at DESC LIMIT 200`,
    ).all<Record<string, unknown>>();
    const items = rows.results || [];
    return c.json({ items, open: items.filter((r) => r.resolved_at == null).length });
  } catch {
    return c.json({ error: 'The refunds-due record could not be read.', code: 'store_unavailable' }, 503);
  }
});

// #5305 (D4703 "Built"): an operator records that one refund due was paid
// back. SUPER ADMIN with the write bar, like every other platform write
// (D4703 item 14). A written reason is required. The row and its
// `admin_audit_log` row are one batch, and the UPDATE is conditional on the
// row still being open, so two operators resolving at once leave one
// resolution and one audit row; the second is refused with 409.
//
// THIS MOVES NO MONEY AND CALLS NO PROVIDER. Refunds stay manual (the owner,
// 2026-11-07): the operator refunds outside the platform and records it here.
/** The shortest reason a resolve accepts: the same 12 a refund issued through HQ takes (D224). */
export const REFUND_DUE_REASON_MIN = 12;

r.post('/advisory-refunds-due/:id/resolve', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) {
    return c.json({ error: 'No refund due has that id.', code: 'not_found' }, 404);
  }
  let body: { reason?: unknown } = {};
  try { body = (await c.req.json()) ?? {}; } catch { body = {}; }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < REFUND_DUE_REASON_MIN || reason.length > 500) {
    return c.json({
      error: `Say how this was refunded, in ${REFUND_DUE_REASON_MIN} to 500 characters. It is kept with the row and in the audit log.`,
      code: 'reason_required',
    }, 400);
  }
  let row: { booking_uid: string; amount_cents: number | null; currency: string | null; resolved_at: string | null } | null;
  try {
    row = await c.env.DB.prepare(
      'SELECT booking_uid, amount_cents, currency, resolved_at FROM advisory_refunds_due WHERE id = ?',
    ).bind(id).first<{ booking_uid: string; amount_cents: number | null; currency: string | null; resolved_at: string | null }>();
  } catch {
    return c.json({ error: 'The refunds-due record could not be read, so nothing was changed.', code: 'store_unavailable' }, 503);
  }
  if (!row) return c.json({ error: 'No refund due has that id.', code: 'not_found' }, 404);
  const alreadyResolved = () => c.json({
    error: 'This refund due is already resolved. Nothing was changed.', code: 'already_resolved',
  }, 409);
  if (row.resolved_at != null) return alreadyResolved();
  let changed = 0;
  try {
    await ensureAdminAuditLogTable(c.env);
    const out = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE advisory_refunds_due
            SET resolved_at = datetime('now'), resolved_by = ?, resolution_reason = ?
          WHERE id = ? AND resolved_at IS NULL`,
      ).bind(actor.id, reason, id),
      adminAuditStatement(c.env, actor.id, 'advisory_refund_due_resolved', {
        refund_due_id: id, booking_uid: row.booking_uid, amount_cents: row.amount_cents,
        currency: row.currency, reason,
      }, { onlyIfChanged: true }),
    ]);
    changed = Number((out?.[0] as any)?.meta?.changes ?? 0);
  } catch {
    return c.json({
      error: 'The resolution could not be saved with its audit record, so nothing was changed.', code: 'store_unavailable',
    }, 503);
  }
  if (changed === 0) return alreadyResolved();
  const after = await c.env.DB.prepare(
    'SELECT resolved_at, resolved_by, resolution_reason FROM advisory_refunds_due WHERE id = ?',
  ).bind(id).first<{ resolved_at: string; resolved_by: number; resolution_reason: string }>().catch(() => null);
  return c.json({
    ok: true,
    id,
    resolved_at: after?.resolved_at ?? null,
    resolved_by: actor.id,
    resolution_reason: reason,
    moves_money: false,
  });
});

// D886 B10: aggregated HQ operations, never customer content.
r.get('/meeting-bots', async (c) => {
  await requireSuperAdmin(c);
  // D5153: the recent failed runs, each with its startup stage, code and next step.
  return c.json({ operations: await readMeetingBotOperations(c.env), pricing: meetingBotPricePolicy(), recent_failures: await readRecentBotFailures(c.env) });
});

// A test uses a fresh, consented session owned by the operator. It cannot
// dispatch on another member's behalf or skip B1's consent/token checks.
r.post('/meeting-bots/test', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const body = await c.req.json().catch(() => null);
  const id = body?.session_id;
  if (!Number.isSafeInteger(id) || id <= 0 || typeof body?.meeting_url !== 'string' || body.meeting_url.length > 2048)
    return c.json({ code: 'invalid_bot_test', message: 'Choose your consented audio session and enter a meeting link.' }, 400);
  const own = await c.env.DB.prepare('SELECT id FROM interview_sessions WHERE id=? AND created_by_user_id=?').bind(id,actor.id).first();
  if (!own) return c.json({ code: 'session_not_found', message: 'That test session is not available.' }, 404);
  try {
    const response = await dispatchBotTest(c.env,actor,id,body.meeting_url);
    const result: any = await response.json().catch(() => null);
    if (!response.ok) {
      // Fixed errors: never echo a link, provider text or member data.
      const codes: Record<string,string> = {
        consent_required: 'Record consent in the session before sending Eadwyn AI.',
        unsupported_link: 'Use a Zoom, Google Meet or Microsoft Teams meeting link.',
        bot_already_running: 'A bot is already running for this session.',
        session_in_use: 'Choose a fresh audio session for this check.',
        bot_price_unavailable: 'The bot price is not configured.',
        tokens: 'There are not enough AI tokens to continue.',
        budget_user_day: 'The daily AI-token budget is exhausted.',
        budget_user_month: 'There are not enough AI tokens for this check.',
        budget_review: 'An AI-token charge needs review before this check.',
        spend_limit: 'The AI-token spend limit prevents this check.',
        ai_paused: 'AI is paused for this account.',
        bot_needs_audio: 'Choose an audio recording session.',
      };
      const code = typeof result?.code === 'string' && codes[result.code] ? result.code : 'bot_unavailable';
      return c.json({ code, message: codes[code] || 'The meeting bot is not available for this check yet.' },
        [400,402,403,409].includes(response.status) ? response.status as 400 | 402 | 403 | 409 : 503);
    }
    const uid = result?.bot?.uid;
    if (typeof uid !== 'string' || !validBotTestId(uid)) throw new Error('invalid_bot_test_response');
    await logAdminAction(c.env,actor.id,actor.email,'meeting_bot_test_dispatched',{ target_user_id: actor.id });
    return c.json({ test: await ownBotTest(c.env,actor.id,uid) });
  } catch { return c.json({ code: 'bot_test_unreadable', message: 'The check could not be read. Check the session before trying again.' }, 503); }
});
r.get('/meeting-bots/test/:uid', async (c) => {
  const actor = await requireSuperAdmin(c);
  try {
    const result = await ownBotTest(c.env,actor.id,c.req.param('uid'));
    return result ? c.json({ test: result }) : c.json({ code: 'bot_test_not_found', message: 'That check is not available.' },404);
  } catch { return c.json({ code: 'bot_test_unreadable', message: 'The check timings could not be read.' },503); }
});

// #3708: the owner's staged diagnostic. A Meet or Zoom link the owner hosts; no
// session, consent or charge, and nothing but codes, counts and one screenshot
// kept, for the Super Admin who started it.
r.post('/meeting-bots/diagnose', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  c.header('Cache-Control', 'private, no-store');
  const body = await c.req.json().catch(() => null);
  try {
    const result = await startDiagnosis(c.env, actor, body?.meeting_url);
    await logAdminAction(c.env, actor.id, actor.email, 'meeting_bot_diagnosis_started', { target_user_id: actor.id, platform: result.platform });
    return c.json({ diagnosis: result }, 202);
  } catch (e) {
    if (e instanceof BotError) return c.json(e.body(), e.status as 400 | 503);
    return c.json({ code: 'diagnosis_unreadable', message: 'The diagnostic could not start. Try again.' }, 503);
  }
});
r.get('/meeting-bots/diagnose/:id', async (c) => {
  const actor = await requireSuperAdmin(c);
  c.header('Cache-Control', 'private, no-store');
  try {
    const result = await readDiagnosis(c.env, actor.id, c.req.param('id'));
    return result ? c.json({ diagnosis: result }) : c.json({ code: 'diagnosis_not_found', message: 'That diagnostic is not available.' }, 404);
  } catch { return c.json({ code: 'diagnosis_unreadable', message: 'The diagnostic could not be read.' }, 503); }
});
r.get('/meeting-bots/diagnose/:id/screenshot', async (c) => {
  const actor = await requireSuperAdmin(c);
  try {
    const png = await readDiagnosisScreenshot(c.env, actor.id, c.req.param('id'));
    if (!png) return c.json({ code: 'screenshot_not_found', message: 'No screenshot for that diagnostic.' }, 404);
    return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch { return c.json({ code: 'diagnosis_unreadable', message: 'The screenshot could not be read.' }, 503); }
});

/** D1168: one bounded, audited batch; calling again resumes persisted checkpoints. */
r.post('/storage/backfill-sizes', async (c) => {
  const actor=await requireSuperAdminWriteBar(c);
  c.header('Cache-Control','private, no-store');
  let body:any;
  try { body=await c.req.json(); } catch { return c.json({code:'backfill_input_invalid',message:'Choose a batch of 1 to 20 files.'},400); }
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='limit'&&k!=='rescan'))
    return c.json({code:'backfill_input_invalid',message:'Choose a batch of 1 to 20 files.'},400);
  if(body.rescan!==undefined&&typeof body.rescan!=='boolean') return c.json({code:'backfill_input_invalid',message:'Choose a valid rescan option.'},400);
  const limit=body.limit??10;
  if(!Number.isSafeInteger(limit)||limit<1||limit>20) return c.json({code:'backfill_input_invalid',message:'Choose a batch of 1 to 20 files.'},400);
  try { return c.json(await backfillMemberFileSizes(c.env,actor.id,limit,body.rescan===true)); }
  catch { return c.json({code:'storage_backfill_unreadable',message:'The batch could not be read. Try again to resume.'},503); }
});

/**
 * D1170 (#3083) — HQ › Platform › Storage (STG20's read): every member's
 * stored bytes as totals by kind, by plan and by state. No name, email, id or
 * file name leaves it (`services/storageHq.ts`).
 */
r.get('/storage', async (c) => {
  await requireSuperAdmin(c);
  c.header('Cache-Control', 'private, no-store');
  return c.json(await readPlatformStorage(c.env));
});

/**
 * D4559 (#4559) — platform capacity, read-only: this Worker's D1 size against
 * its plan limit with warning/critical levels, each producer queue's backlog
 * and oldest-message age, and which declared bindings are present. Worker-
 * native reads only (no account API, no token). A source that does not answer
 * is `unavailable` with a reason, never a zero, and keeps the overall level
 * from reading `ok`. No member, company or tenant is named.
 */
r.get('/capacity', async (c) => {
  await requireSuperAdmin(c);
  c.header('Cache-Control', 'private, no-store');
  return c.json(await readPlatformCapacity(c.env));
});

/**
 * D4559 part 2 — the trend. `days` is 1..365 (default 90). Each series is the
 * daily snapshot of one deployment metric; an unreadable day is a null point,
 * never a zero. `d1_projection` names a month, its window and a confidence, or
 * says why there is none.
 */
r.get('/capacity/history', async (c) => {
  await requireSuperAdmin(c);
  c.header('Cache-Control', 'private, no-store');
  const raw = c.req.query('days');
  const days = raw === undefined ? HISTORY_DAYS_DEFAULT : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > HISTORY_DAYS_MAX) {
    return c.json({ detail: `days must be a whole number from 1 to ${HISTORY_DAYS_MAX}.` }, 400);
  }
  const scope = branchOf(c.env) ? 'branch' : 'hq';
  const history = await readCapacityHistory(c.env, scope, days, d1Policy(c.env).limit);
  if (history.state === 'unreadable') return c.json({ ...history, detail: history.reason }, 503);
  return c.json(history);
});

/** D4559 part 2 — the alert episodes. An unreadable store is 503, never an empty list. */
r.get('/capacity/alerts', async (c) => {
  await requireSuperAdmin(c);
  c.header('Cache-Control', 'private, no-store');
  const alerts = await readCapacityAlerts(c.env, branchOf(c.env) ? 'branch' : 'hq');
  if (alerts.state === 'unreadable') return c.json({ ...alerts, detail: alerts.reason }, 503);
  return c.json(alerts);
});

/**
 * D4559 part 2 — mute one OPEN episode. It is still tracked and still clears on
 * recovery; only its notices stop until `muted_until`. A reason is required and
 * audited. A cleared or unknown episode is 404.
 */
r.post('/capacity/alerts/:id/mute', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ detail: 'Alert not found.' }, 404);
  const b = (await c.req.json().catch(() => ({}))) as { hours?: unknown; reason?: unknown };
  const hours = Number(b.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > MUTE_MAX_HOURS) {
    return c.json({ detail: `hours must be a whole number from 1 to ${MUTE_MAX_HOURS}.` }, 400);
  }
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) {
    return c.json({ detail: 'Say why this alert is muted (5 to 500 characters).' }, 400);
  }
  let result;
  try {
    result = await muteCapacityAlert(c.env, id, hours, reason, actor.id);
  } catch {
    return c.json({ detail: 'The alert could not be muted. Nothing changed.' }, 503);
  }
  if (!result.changed) return c.json({ detail: 'Alert not found, or it has already cleared.' }, 404);
  await logAdminAction(c.env, actor.id, actor.email, 'platform_capacity_alert_muted', { alert_id: id, hours, reason });
  return c.json({ ok: true, muted_until: result.muted_until });
});

export default r;
