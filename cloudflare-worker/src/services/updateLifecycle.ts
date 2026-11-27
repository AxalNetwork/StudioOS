/**
 * D4636 (#4636) — a company update's publication and delivery lifecycle.
 *
 * PUBLICATION. A `portfolio_updates` row of kind 'update' is a draft until it
 * is published (submit, or the first send). Publishing writes version 1 to
 * `portfolio_update_versions`; a change to a published update is a correction,
 * version N+1, carrying the actor and their reason. A version row is written
 * once and never updated. The row's `published_version` names the version its
 * content equals; `submitted_at` is the first publication and is never moved.
 * Every write that changes publication is conditional on the state that was
 * read (the content for a first publication, `published_version` for a
 * correction), so of two writers who read the same state one lands and the
 * other is told the update changed.
 *
 * DELIVERY. One logical delivery per recipient per version: a row in
 * `update_recipients` keyed by (version_id, recipient_key), reserved with
 * INSERT … ON CONFLICT DO NOTHING. A send then CLAIMS each reservation with a
 * conditional update (a fresh claim token), calls the provider, and records
 * the outcome only where its own claim still stands. So two concurrent sends
 * reserve each recipient once and attempt each delivery once.
 *
 *   reserved       reserved, not attempted yet
 *   attempting     a send holds the claim; one older than STALE_ATTEMPT_MS is
 *                  read as ambiguous (the attempt never recorded an outcome)
 *   delivered      the provider returned its record (`provider_ref`)
 *   declined       the notification path refused it (the recipient's
 *                  settings or inbox); not retried
 *   undeliverable  no Axal account for the address; not retried
 *   failed         the attempt stopped before the provider was called; a
 *                  later send retries it
 *   ambiguous      the provider was called and no outcome was recorded. A
 *                  later send looks for the provider's record by the
 *                  delivery's own uid (it travels in the notification
 *                  payload); found, it is delivered. Not found, it stays
 *                  ambiguous and is attempted again only when the sender
 *                  asks for that explicitly (`resendAmbiguous`), because the
 *                  provider does not promise exactly-once delivery.
 *
 * Nothing here runs on a schedule: a delivery is attempted only inside a send
 * someone made.
 */
import type { Env } from '../types';

export const STALE_ATTEMPT_MS = 15 * 60 * 1000;

export const DELIVERY_STATES = ['reserved', 'attempting', 'delivered', 'declined', 'undeliverable', 'failed', 'ambiguous'] as const;
export type DeliveryState = typeof DELIVERY_STATES[number];

/** What a recipient sees in `not_delivered_reason` for a state that is not delivered. */
export const STATE_REASON: Record<Exclude<DeliveryState, 'delivered'>, string> = {
  reserved: 'Not delivered yet',
  attempting: 'Not delivered yet',
  declined: 'Not delivered: their notification settings or the inbox refused it',
  undeliverable: 'No Axal account for this email, so it was not sent',
  failed: 'Not delivered: the attempt failed before it was sent. Sending again retries it.',
  ambiguous: 'Delivery could not be confirmed. Sending again checks whether it arrived.',
};

/** Thrown by a provider when it stopped before anything left: the delivery is `failed`, safe to retry. */
export class DeliveryNotAttempted extends Error {}

/** The update changed between the read and the write (another writer landed first). */
export class UpdateChanged extends Error {
  constructor() { super('This update changed since you opened it. Reload it and try again.'); }
}

export type LifecycleRow = {
  id: number; uid: string; author_user_id: number; status: string; submitted_at: string | null; updated_at: string;
  title: string; body: string | null; period: string | null; kpis_json: string | null;
  period_start?: string | null; period_end?: string | null; metrics_json?: string | null;
  highlights_json?: string | null; lowlights_json?: string | null; audience_json?: string | null;
  network_includes_metrics?: number | null; published_version?: number | null; sent_at?: string | null;
};

export type VersionRow = {
  id: number; uid: string; update_id: number; version: number; title: string; content_sha256: string;
  published_by_user_id: number; published_at: string; correction_reason: string | null;
};

export type DeliveryRow = {
  id: number; update_id: number; version_id: number; audience: string; user_id: number | null; email: string | null;
  label: string | null; recipient_key: string; delivery_uid: string; delivery_state: DeliveryState;
  attempts: number; attempt_claim: string | null; last_attempt_at: string | null; provider_ref: string | null;
};

export interface DeliveryProvider {
  /** Send one delivery. Returns the provider's record id, or null when the path declined it. */
  send(d: DeliveryRow): Promise<string | null>;
  /** The provider's record carrying this delivery's uid, or null when there is none. */
  find(d: DeliveryRow): Promise<string | null>;
}

const uid = (): string => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
};

export function recipientKey(userId: number | null, email: string | null): string {
  return userId == null ? `email:${(email || '').trim().toLowerCase()}` : `user:${userId}`;
}

/** The content a version freezes, in a fixed key order so its digest is stable. */
export function versionContent(row: LifecycleRow, asks: Array<Record<string, unknown>>) {
  return {
    title: row.title, body: row.body ?? null, period: row.period ?? null,
    period_start: row.period_start ?? null, period_end: row.period_end ?? null,
    kpis_json: row.kpis_json ?? null, metrics_json: row.metrics_json ?? null,
    highlights_json: row.highlights_json ?? null, lowlights_json: row.lowlights_json ?? null,
    asks_json: JSON.stringify(asks.map((a) => ({ uid: a.uid ?? null, kind: a.kind ?? null, text: a.text ?? null, link_ref: a.link_ref ?? null }))),
    audience_json: row.audience_json ?? null, network_includes_metrics: Number(row.network_includes_metrics ?? 0) ? 1 : 0,
  };
}
type Content = ReturnType<typeof versionContent>;

export async function contentSha256(content: Content): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function asksFor(env: Env, updateId: number) {
  const r = await env.DB.prepare('SELECT uid, kind, text, link_ref FROM update_asks WHERE update_id = ? ORDER BY id').bind(updateId).all<any>();
  return r.results || [];
}

export async function readRow(env: Env, id: number): Promise<LifecycleRow | null> {
  return env.DB.prepare('SELECT * FROM portfolio_updates WHERE id = ?').bind(id).first<LifecycleRow>();
}

export async function readVersion(env: Env, updateId: number, version: number): Promise<VersionRow | null> {
  return env.DB.prepare('SELECT * FROM portfolio_update_versions WHERE update_id = ? AND version = ?').bind(updateId, version).first<VersionRow>();
}

export async function listVersions(env: Env, updateId: number) {
  const r = await env.DB.prepare(
    `SELECT v.uid, v.version, v.title, v.content_sha256, v.published_at, v.correction_reason,
            v.published_by_user_id, u.name AS published_by_name
       FROM portfolio_update_versions v LEFT JOIN users u ON u.id = v.published_by_user_id
      WHERE v.update_id = ? ORDER BY v.version`,
  ).bind(updateId).all<any>();
  return (r.results || []).map((v: any) => ({
    uid: v.uid, version: Number(v.version), title: v.title, content_sha256: v.content_sha256,
    published_at: v.published_at, correction_reason: v.correction_reason ?? null,
    published_by: { user_id: v.published_by_user_id, name: v.published_by_name ?? null },
  }));
}

const VERSION_INSERT = `INSERT INTO portfolio_update_versions
  (uid, update_id, version, title, body, period, period_start, period_end, kpis_json, metrics_json, highlights_json,
   lowlights_json, asks_json, audience_json, network_includes_metrics, content_sha256, published_by_user_id, published_at, correction_reason)
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
   WHERE EXISTS (SELECT 1 FROM portfolio_updates WHERE id = ? AND published_version = ?)
  ON CONFLICT (update_id, version) DO NOTHING`;

function versionBinds(vUid: string, updateId: number, version: number, c: Content, sha: string, actorId: number, at: string, reason: string | null) {
  return [vUid, updateId, version, c.title, c.body, c.period, c.period_start, c.period_end, c.kpis_json, c.metrics_json,
    c.highlights_json, c.lowlights_json, c.asks_json, c.audience_json, c.network_includes_metrics, sha, actorId, at, reason];
}

/**
 * The row as read, as a guard: the first publication lands only on the content
 * the publisher read (the `IS ?` list in ensurePublished's UPDATE, in this order).
 */
const unchangedBinds = (r: LifecycleRow) => [r.updated_at, r.title, r.body ?? null, r.period ?? null, r.period_start ?? null,
  r.period_end ?? null, r.kpis_json ?? null, r.metrics_json ?? null, r.highlights_json ?? null, r.lowlights_json ?? null, r.audience_json ?? null];

/**
 * The update's published version, publishing it first when it is a draft.
 * `published` says whether THIS call published it (so a caller notifies once).
 *
 * A row published before D4636 has no version: version 1 is recorded from the
 * row as it stands, attributed to its author at its original `submitted_at`.
 */
export async function ensurePublished(env: Env, row: LifecycleRow, actorId: number, at: string): Promise<{ version: VersionRow; published: boolean; row: LifecycleRow }> {
  if (row.published_version != null) {
    const v = await readVersion(env, row.id, Number(row.published_version));
    if (v) return { version: v, published: false, row };
  }
  const legacy = row.status === 'submitted';
  const content = versionContent(row, await asksFor(env, row.id));
  const sha = await contentSha256(content);
  const vUid = uid();
  const publisher = legacy ? row.author_user_id : actorId;
  const publishedAt = legacy ? (row.submitted_at || row.updated_at) : at;
  const res = await env.DB.batch([
    env.DB.prepare(
      `UPDATE portfolio_updates SET status = 'submitted', submitted_at = COALESCE(submitted_at, ?), published_version = 1,
         updated_at = CASE WHEN status = 'submitted' THEN updated_at ELSE ? END
       WHERE id = ? AND published_version IS NULL AND updated_at IS ? AND title IS ? AND body IS ? AND period IS ?
         AND period_start IS ? AND period_end IS ? AND kpis_json IS ? AND metrics_json IS ? AND highlights_json IS ?
         AND lowlights_json IS ? AND audience_json IS ?`,
    ).bind(publishedAt, at, row.id, ...unchangedBinds(row)),
    env.DB.prepare(VERSION_INSERT).bind(...versionBinds(vUid, row.id, 1, content, sha, publisher, publishedAt, null), row.id, 1),
  ]);
  const published = Number((res[0] as any)?.meta?.changes ?? 0) === 1 && !legacy;
  const fresh = await readRow(env, row.id);
  if (!fresh || fresh.published_version == null) throw new UpdateChanged();
  const v = await readVersion(env, row.id, Number(fresh.published_version));
  if (!v) throw new UpdateChanged();
  return { version: v, published, row: fresh };
}

/**
 * Correct a published update: version N+1 with the new content, the actor and
 * the reason; the row takes the new content only if it is still at version N.
 * `expectedVersion`, when the client sends it, must be the stored version.
 */
export async function correctPublished(
  env: Env, row: LifecycleRow, next: Partial<Pick<LifecycleRow, 'title' | 'body' | 'period' | 'kpis_json'>>,
  actorId: number, reason: string | null, at: string, expectedVersion: number | null,
): Promise<VersionRow> {
  const current = await ensurePublished(env, row, actorId, at);
  const n = current.version.version;
  if (expectedVersion != null && expectedVersion !== n) throw new UpdateChanged();
  const base = current.row;
  const merged: LifecycleRow = { ...base, ...next };
  const content = versionContent(merged, await asksFor(env, row.id));
  const sha = await contentSha256(content);
  const vUid = uid();
  const res = await env.DB.batch([
    env.DB.prepare(VERSION_INSERT).bind(...versionBinds(vUid, row.id, n + 1, content, sha, actorId, at, reason), row.id, n),
    env.DB.prepare(
      `UPDATE portfolio_updates SET title = ?, body = ?, period = ?, kpis_json = ?, published_version = ?, updated_at = ?
        WHERE id = ? AND published_version = ? AND EXISTS (SELECT 1 FROM portfolio_update_versions WHERE uid = ?)`,
    ).bind(merged.title, merged.body ?? null, merged.period ?? null, merged.kpis_json ?? null, n + 1, at, row.id, n, vUid),
  ]);
  if (Number((res[1] as any)?.meta?.changes ?? 0) !== 1) throw new UpdateChanged();
  const v = await readVersion(env, row.id, n + 1);
  if (!v || v.uid !== vUid) throw new UpdateChanged();
  return v;
}

export type Recipient = { audience: string; user_id: number | null; email: string | null; label: string | null };

/**
 * Rows written before D4636 for this update (no version) become version 1's
 * deliveries, keeping what they recorded, so a send after the change never
 * reaches someone a send before it already reached. `UPDATE OR IGNORE` leaves
 * a duplicate of an adopted recipient as it was.
 */
async function adoptLegacy(env: Env, updateId: number, versionId: number, at: string) {
  await env.DB.prepare(
    `UPDATE OR IGNORE update_recipients SET version_id = ?,
        recipient_key = CASE WHEN user_id IS NULL THEN 'email:' || lower(trim(COALESCE(email, ''))) ELSE 'user:' || user_id END,
        delivery_uid = lower(hex(randomblob(16))),
        delivery_state = CASE WHEN delivered_via IS NOT NULL THEN 'delivered' WHEN user_id IS NULL THEN 'undeliverable' ELSE 'declined' END,
        settled_at = COALESCE(created_at, ?)
      WHERE update_id = ? AND version_id IS NULL`,
  ).bind(versionId, at, updateId).run();
}

/** Reserve one delivery per recipient for this version. Concurrent calls reserve each once. */
export async function reserveDeliveries(env: Env, updateId: number, version: VersionRow, recipients: Recipient[], actorId: number, at: string) {
  if (version.version === 1) await adoptLegacy(env, updateId, version.id, at);
  if (!recipients.length) return;
  await env.DB.batch(recipients.map((r) => env.DB.prepare(
    `INSERT INTO update_recipients (update_id, version_id, audience, user_id, email, label, recipient_key, delivery_uid,
       delivery_state, not_delivered_reason, attempts, reserved_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, 0, ?)
     ON CONFLICT (version_id, recipient_key) DO NOTHING`,
  ).bind(updateId, version.id, r.audience, r.user_id, r.email, r.label, recipientKey(r.user_id, r.email), uid(), STATE_REASON.reserved, actorId)));
}

async function settle(env: Env, d: DeliveryRow, claim: string, state: DeliveryState, at: string, ref: string | null = null) {
  await env.DB.prepare(
    `UPDATE update_recipients SET delivery_state = ?, delivered_via = ?, not_delivered_reason = ?, provider_ref = ?, settled_at = ?
      WHERE id = ? AND attempt_claim = ?`,
  ).bind(state, state === 'delivered' ? 'notification' : null, state === 'delivered' ? null : STATE_REASON[state], ref, at, d.id, claim).run();
}

/** Take the attempt on one delivery, from the state it was read in. False when another send holds it. */
async function claim(env: Env, d: DeliveryRow, at: string): Promise<string | null> {
  const token = uid();
  const r = await env.DB.prepare(
    `UPDATE update_recipients SET delivery_state = 'attempting', attempt_claim = ?, attempts = attempts + 1, last_attempt_at = ?,
        not_delivered_reason = ?
      WHERE id = ? AND delivery_state = ? AND attempt_claim IS ?`,
  ).bind(token, at, STATE_REASON.attempting, d.id, d.delivery_state, d.attempt_claim).run();
  return Number((r as any)?.meta?.changes ?? 0) === 1 ? token : null;
}

async function attempt(env: Env, d: DeliveryRow, provider: DeliveryProvider, now: () => string) {
  const token = await claim(env, d, now());
  if (!token) return;
  if (d.user_id == null) { await settle(env, d, token, 'undeliverable', now()); return; }
  let ref: string | null;
  try {
    ref = await provider.send(d);
  } catch (e) {
    await settle(env, d, token, e instanceof DeliveryNotAttempted ? 'failed' : 'ambiguous', now());
    return;
  }
  await settle(env, d, token, ref != null ? 'delivered' : 'declined', now(), ref);
}

/** An ambiguous delivery: delivered if the provider holds its record; otherwise left, or re-sent on request. */
async function reconcile(env: Env, d: DeliveryRow, provider: DeliveryProvider, now: () => string, resendAmbiguous: boolean) {
  let found: string | null;
  try { found = await provider.find(d); } catch { return; /* unreadable: leave it ambiguous, never re-send blind */ }
  if (found != null) {
    const token = await claim(env, d, now());
    if (token) await settle(env, d, token, 'delivered', now(), found);
    return;
  }
  if (resendAmbiguous) await attempt(env, d, provider, now);
}

export async function versionDeliveries(env: Env, versionId: number): Promise<DeliveryRow[]> {
  const r = await env.DB.prepare('SELECT * FROM update_recipients WHERE version_id = ? ORDER BY id').bind(versionId).all<DeliveryRow>();
  return (r.results || []) as DeliveryRow[];
}

/** Attempt, reconcile or leave each of a version's deliveries, by its state. */
export async function runDeliveries(
  env: Env, versionId: number, provider: DeliveryProvider,
  opts: { resendAmbiguous?: boolean; now?: () => string } = {},
) {
  const now = opts.now ?? (() => new Date().toISOString());
  for (const d of await versionDeliveries(env, versionId)) {
    if (d.delivery_state === 'reserved' || d.delivery_state === 'failed') { await attempt(env, d, provider, now); continue; }
    if (d.delivery_state === 'attempting') {
      const since = Date.parse(d.last_attempt_at || '');
      if (!Number.isFinite(since) || Date.parse(now()) - since < STALE_ATTEMPT_MS) continue; // another send is on it
      const r = await env.DB.prepare(
        `UPDATE update_recipients SET delivery_state = 'ambiguous', not_delivered_reason = ? WHERE id = ? AND delivery_state = 'attempting' AND attempt_claim IS ?`,
      ).bind(STATE_REASON.ambiguous, d.id, d.attempt_claim).run();
      if (Number((r as any)?.meta?.changes ?? 0) !== 1) continue;
      await reconcile(env, { ...d, delivery_state: 'ambiguous' }, provider, now, !!opts.resendAmbiguous);
      continue;
    }
    if (d.delivery_state === 'ambiguous') await reconcile(env, d, provider, now, !!opts.resendAmbiguous);
  }
  return summarise(await versionDeliveries(env, versionId));
}

export function summarise(rows: DeliveryRow[]) {
  const states = Object.fromEntries(DELIVERY_STATES.map((s) => [s, 0])) as Record<DeliveryState, number>;
  for (const r of rows) if (r.delivery_state in states) states[r.delivery_state] += 1;
  return { recipients: rows.length, delivered: states.delivered, not_delivered: rows.length - states.delivered, states };
}
