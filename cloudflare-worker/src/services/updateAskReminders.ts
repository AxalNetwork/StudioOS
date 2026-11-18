/**
 * D4645-p2 (#4645) — an "Ask again" reminder as a recorded round with one
 * durable delivery per recipient, on D4636's delivery conventions
 * (`services/updateLifecycle.ts`), so an interrupted reminder is reconciled
 * rather than re-sent.
 *
 * A ROUND is opened by the cooldown claim on `update_asks.asked_again_at`. The
 * claim, the round row and one reservation per current recipient of the
 * update's current version are written in ONE batch: either all of them land
 * or none does, so a claimed window always has a round and its reservations,
 * and two presses at once open one round.
 *
 * EACH DELIVERY is then claimed (a fresh token, conditional on the state it
 * was read in), checked against the records as they stand at that moment —
 * the ask still has no reply, the update's current version is still the
 * round's, the person is still one of its recipients — and only then sent.
 * Its outcome is written only where its own claim still stands.
 *
 * WHAT IS RECOVERED, AND WHAT IS NOT. A delivery whose attempt never recorded
 * an outcome (the Worker stopped, the response was lost) reads as `ambiguous`
 * once its claim is older than STALE_ATTEMPT_MS. It is looked for in the
 * inbox by its own `delivery_uid`, which travels in the notification's
 * payload: found, it is `delivered`; not found, it STAYS ambiguous and is sent
 * again only when the author asks for that explicitly (`resendAmbiguous`).
 * The deduplication here is logical — one reservation per recipient per round,
 * one inbox row looked for before any re-send. The notification path's email
 * and push are not exactly-once, and nothing here says they are.
 *
 * Nothing runs on a schedule: a round is opened, resumed or reconciled only
 * inside a request its author made.
 */
import type { Env } from '../types';
import { STALE_ATTEMPT_MS } from './updateLifecycle';

export const REMINDER_STATES = ['reserved', 'attempting', 'delivered', 'declined', 'failed', 'ambiguous', 'skipped'] as const;
export type ReminderState = typeof REMINDER_STATES[number];
export const SKIP_REASONS = ['replied', 'not_current_recipient', 'version_changed'] as const;
export type SkipReason = typeof SKIP_REASONS[number];

/** What the response and the page say about the guarantee, and no more. */
export const REMINDER_GUARANTEE = 'One reminder round per ask per window, and one reservation per recipient in it. '
  + 'Before anything is sent again, the in-app inbox is checked for the earlier attempt. '
  + 'Email and push go out through each person\'s notification settings and are not guaranteed exactly once.';

/** A request key a caller may send so a repeat of a lost request finds its round. */
export const REQUEST_KEY = /^[A-Za-z0-9_-]{8,80}$/;

export type ReminderRow = {
  id: number; uid: string; ask_id: number; update_id: number; version_id: number | null;
  request_key: string | null; requested_by_user_id: number; claimed_at: string;
};
export type ReminderDelivery = {
  id: number; reminder_id: number; user_id: number; delivery_uid: string; delivery_state: ReminderState;
  skip_reason: SkipReason | null; attempts: number; attempt_claim: string | null; last_attempt_at: string | null;
  settled_at: string | null; provider_ref: string | null;
};

export interface ReminderProvider {
  /** Send one reminder. The inbox row id, or null when the notification path wrote none. */
  send(d: ReminderDelivery): Promise<string | null>;
  /** The inbox row carrying this delivery's uid, or null when there is none. Throws when unreadable. */
  find(d: ReminderDelivery): Promise<string | null>;
}

const token = (): string => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
};

// The current recipients of a version: people with an account, whose delivery
// of that version was made (or who were sent the update before D4636 recorded
// deliveries). The version is bound twice: NULL matches the pre-version rows.
const RECIPIENTS_OF_VERSION = `SELECT DISTINCT ur.user_id FROM update_recipients ur
  WHERE ur.update_id = ? AND ur.user_id IS NOT NULL
    AND ((? IS NULL AND ur.version_id IS NULL) OR ur.version_id = ?)
    AND (ur.delivery_state IS NULL OR ur.delivery_state = 'delivered')`;

/** The update's current published version's id; null for an update sent before D4636 versions. */
export async function currentVersionId(env: Env, updateId: number): Promise<number | null> {
  const v = await env.DB.prepare(
    `SELECT v.id FROM portfolio_updates u JOIN portfolio_update_versions v ON v.update_id = u.id AND v.version = u.published_version
      WHERE u.id = ?`,
  ).bind(updateId).first<{ id: number }>();
  return v ? Number(v.id) : null;
}

export async function roundByUid(env: Env, askId: number, uid: string): Promise<ReminderRow | null> {
  return env.DB.prepare('SELECT * FROM update_ask_reminders WHERE ask_id = ? AND uid = ?').bind(askId, uid).first<ReminderRow>();
}
export async function roundByRequestKey(env: Env, askId: number, key: string): Promise<ReminderRow | null> {
  return env.DB.prepare('SELECT * FROM update_ask_reminders WHERE ask_id = ? AND request_key = ?').bind(askId, key).first<ReminderRow>();
}
export async function latestRound(env: Env, askId: number): Promise<ReminderRow | null> {
  return env.DB.prepare('SELECT * FROM update_ask_reminders WHERE ask_id = ? ORDER BY id DESC LIMIT 1').bind(askId).first<ReminderRow>();
}

/**
 * Claim the cooldown and open a round with its reservations, in one batch.
 * The claim's WHERE is `canAskAgain`'s rule on normalised times: the last ask
 * (or the send) is at least `earliest` old, and the ask has no reply. Returns
 * the round, or null when another claim or a reply got there first.
 */
export async function openRound(env: Env, args: {
  askId: number; updateId: number; versionId: number | null; requestKey: string | null;
  actorId: number; claimedAt: string; earliest: string;
}): Promise<ReminderRow | null> {
  const uid = token();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE update_asks SET asked_again_at = ?
        WHERE id = ?
          AND datetime(COALESCE(asked_again_at, (SELECT sent_at FROM portfolio_updates WHERE id = update_asks.update_id))) <= datetime(?)
          AND NOT EXISTS (SELECT 1 FROM update_ask_replies WHERE ask_id = update_asks.id)`,
    ).bind(args.claimedAt, args.askId, args.earliest),
    // The round exists only where this request's claim stands. A second
    // request in the same millisecond finds the first's round already there.
    env.DB.prepare(
      `INSERT INTO update_ask_reminders (uid, ask_id, update_id, version_id, request_key, requested_by_user_id, claimed_at)
       SELECT ?, a.id, a.update_id, ?, ?, ?, a.asked_again_at FROM update_asks a
        WHERE a.id = ? AND a.asked_again_at = ?
          AND NOT EXISTS (SELECT 1 FROM update_ask_reminders x WHERE x.ask_id = a.id AND x.claimed_at = a.asked_again_at)`,
    ).bind(uid, args.versionId, args.requestKey, args.actorId, args.askId, args.claimedAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO update_ask_reminder_deliveries (reminder_id, user_id, delivery_uid)
       SELECT r.id, x.user_id, lower(hex(randomblob(16))) FROM update_ask_reminders r
         JOIN (${RECIPIENTS_OF_VERSION}) x
        WHERE r.uid = ?`,
    ).bind(args.updateId, args.versionId, args.versionId, uid),
  ]);
  return env.DB.prepare('SELECT * FROM update_ask_reminders WHERE uid = ?').bind(uid).first<ReminderRow>();
}

export async function roundDeliveries(env: Env, reminderId: number): Promise<ReminderDelivery[]> {
  const r = await env.DB.prepare('SELECT * FROM update_ask_reminder_deliveries WHERE reminder_id = ? ORDER BY id')
    .bind(reminderId).all<ReminderDelivery>();
  return (r.results || []) as ReminderDelivery[];
}

/** Why this delivery is no longer due, read from the records as they stand now; null when it is due. */
export async function notDueReason(env: Env, round: ReminderRow, userId: number): Promise<SkipReason | null> {
  const row = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM update_ask_replies WHERE ask_id = ?) AS replied,
            (SELECT v.id FROM portfolio_updates u JOIN portfolio_update_versions v ON v.update_id = u.id AND v.version = u.published_version
              WHERE u.id = ?) AS current_version,
            EXISTS (SELECT 1 FROM (${RECIPIENTS_OF_VERSION}) x WHERE x.user_id = ?) AS recipient`,
  ).bind(round.ask_id, round.update_id, round.update_id, round.version_id, round.version_id, userId)
    .first<{ replied: number; current_version: number | null; recipient: number }>();
  if (!row) throw new Error('reminder check unreadable');
  if (Number(row.replied)) return 'replied';
  if ((row.current_version == null ? null : Number(row.current_version)) !== (round.version_id == null ? null : Number(round.version_id))) {
    return 'version_changed';
  }
  if (!Number(row.recipient)) return 'not_current_recipient';
  return null;
}

async function claim(env: Env, d: ReminderDelivery, at: string): Promise<string | null> {
  const t = token();
  const r = await env.DB.prepare(
    `UPDATE update_ask_reminder_deliveries SET delivery_state = 'attempting', attempt_claim = ?, attempts = attempts + 1, last_attempt_at = ?
      WHERE id = ? AND delivery_state = ? AND attempt_claim IS ?`,
  ).bind(t, at, d.id, d.delivery_state, d.attempt_claim).run();
  return Number((r as any)?.meta?.changes ?? 0) === 1 ? t : null;
}

async function settle(env: Env, d: ReminderDelivery, claimToken: string, state: ReminderState, at: string,
                      extra: { ref?: string | null; reason?: SkipReason | null } = {}) {
  await env.DB.prepare(
    `UPDATE update_ask_reminder_deliveries SET delivery_state = ?, provider_ref = ?, skip_reason = ?, settled_at = ?
      WHERE id = ? AND attempt_claim = ?`,
  ).bind(state, extra.ref ?? null, extra.reason ?? null, at, d.id, claimToken).run();
}

async function attempt(env: Env, round: ReminderRow, d: ReminderDelivery, provider: ReminderProvider, now: () => string) {
  const t = await claim(env, d, now());
  if (!t) return; // another request holds it
  let reason: SkipReason | null;
  try { reason = await notDueReason(env, round, d.user_id); }
  catch { await settle(env, d, t, 'failed', now()); return; } // nothing was sent: safe to retry
  if (reason) { await settle(env, d, t, 'skipped', now(), { reason }); return; }
  let ref: string | null;
  try { ref = await provider.send(d); }
  catch { await settle(env, d, t, 'ambiguous', now()); return; }
  if (ref == null) {
    // The notification path answers null both when it wrote nothing and when
    // it failed after writing the inbox row, so the row is looked for first.
    let found: string | null;
    try { found = await provider.find(d); } catch { await settle(env, d, t, 'ambiguous', now()); return; }
    await settle(env, d, t, found != null ? 'delivered' : 'declined', now(), { ref: found });
    return;
  }
  await settle(env, d, t, 'delivered', now(), { ref });
}

async function reconcile(env: Env, round: ReminderRow, d: ReminderDelivery, provider: ReminderProvider, now: () => string, resend: boolean) {
  let found: string | null;
  try { found = await provider.find(d); } catch { return; /* unreadable: leave it ambiguous, never re-send blind */ }
  if (found != null) {
    const t = await claim(env, d, now());
    if (t) await settle(env, d, t, 'delivered', now(), { ref: found });
    return;
  }
  if (resend) await attempt(env, round, d, provider, now);
}

const stale = (d: ReminderDelivery, nowMs: number) => {
  const since = Date.parse(d.last_attempt_at || '');
  return !Number.isFinite(since) || nowMs - since >= STALE_ATTEMPT_MS;
};

/**
 * Attempt, reconcile or leave each delivery of a round, by its state:
 * reserved and failed are attempted; an attempt older than STALE_ATTEMPT_MS
 * becomes ambiguous and is looked for; ambiguous is looked for, and re-sent
 * only on `resendAmbiguous`; the rest are settled and left alone.
 */
export async function runRound(env: Env, round: ReminderRow, provider: ReminderProvider,
                               opts: { resendAmbiguous?: boolean; now?: () => string } = {}) {
  const now = opts.now ?? (() => new Date().toISOString());
  for (const d of await roundDeliveries(env, round.id)) {
    if (d.delivery_state === 'reserved' || d.delivery_state === 'failed') { await attempt(env, round, d, provider, now); continue; }
    if (d.delivery_state === 'attempting') {
      if (!stale(d, Date.parse(now()))) continue; // another request is on it
      const r = await env.DB.prepare(
        `UPDATE update_ask_reminder_deliveries SET delivery_state = 'ambiguous' WHERE id = ? AND delivery_state = 'attempting' AND attempt_claim IS ?`,
      ).bind(d.id, d.attempt_claim).run();
      if (Number((r as any)?.meta?.changes ?? 0) !== 1) continue;
      await reconcile(env, round, { ...d, delivery_state: 'ambiguous' }, provider, now, !!opts.resendAmbiguous);
      continue;
    }
    if (d.delivery_state === 'ambiguous') await reconcile(env, round, d, provider, now, !!opts.resendAmbiguous);
  }
  return summariseRound(round, await roundDeliveries(env, round.id), Date.parse(now()));
}

/**
 * A round's recorded progress. A fresh attempt is `pending`; one past
 * STALE_ATTEMPT_MS is counted `unconfirmed` with the ambiguous ones, since
 * nothing recorded its outcome. `failed` is declined plus failed.
 */
export function summariseRound(round: ReminderRow, rows: ReminderDelivery[], nowMs = Date.now()) {
  const states = Object.fromEntries(REMINDER_STATES.map((s) => [s, 0])) as Record<ReminderState, number>;
  const skipped = Object.fromEntries(SKIP_REASONS.map((s) => [s, 0])) as Record<SkipReason, number>;
  let staleAttempts = 0;
  for (const r of rows) {
    if (r.delivery_state in states) states[r.delivery_state] += 1;
    if (r.delivery_state === 'attempting' && stale(r, nowMs)) staleAttempts += 1;
    if (r.delivery_state === 'skipped' && r.skip_reason && r.skip_reason in skipped) skipped[r.skip_reason] += 1;
  }
  const pending = states.reserved + states.attempting - staleAttempts;
  const unconfirmed = states.ambiguous + staleAttempts;
  return {
    reminder_uid: round.uid,
    asked_again_at: round.claimed_at,
    recipients: rows.length,
    notified: states.delivered,
    failed: states.declined + states.failed,
    unconfirmed,
    pending,
    skipped: states.skipped,
    skipped_reasons: skipped,
    states,
    settled: pending === 0 && unconfirmed === 0,
  };
}
export type RoundSummary = ReturnType<typeof summariseRound>;

/** The latest round of each of these asks, summarised, keyed by ask id. */
export async function latestRounds(env: Env, askIds: number[]): Promise<Map<number, RoundSummary>> {
  const out = new Map<number, RoundSummary>();
  for (const askId of askIds) {
    const round = await latestRound(env, askId);
    if (round) out.set(askId, summariseRound(round, await roundDeliveries(env, round.id)));
  }
  return out;
}
