/**
 * D1490 (#3904) — the `event_syndication` job: one action on one listing.
 *
 * It re-reads the event and asks `eligibility` **at run time**: an event
 * cancelled, unpublished or made private while its post waited never posts.
 * Each run writes the row and one log row. A platform refusal stores its
 * reason (≤500 characters, credentials removed) and throws, so the queue
 * retries; the third failed run marks the row `failed` and stops. A 429 reads
 * "Rate limited by <channel>; retry after <time>" when the platform names one.
 *
 * Every status guard is in the UPDATE, so a repeated message, or two at once,
 * calls the adapter once: a row already `posted` takes no second `post`.
 */
import type { Env } from '../../types';
import { decryptChannelCredentials } from '../../integrations/secrets';
import { CHANNEL_NAMES, ChannelError, isChannelKey, syndicationChannel, type ListingInput, type SyndicationAdapter } from './channels';
import { contentHash, listingEvent, listingLink } from './content';
import { eligibility, readSettings } from './eligibility';
import type { SyndicationAction } from './hooks';

/** The runs a listing gets before it is `failed`: the queue's `max_retries` (3). */
export const MAX_ATTEMPTS = 3;
const DETAIL_MAX = 500;

type Row = {
  id: number; uid: string; event_id: number; account_id: number; channel: string; status: string; sync_state: string | null;
  overrides_json: string; external_id: string | null; attempts: number; content_hash: string | null;
};
type Account = { id: number; uid: string; status: string; owner_kind: string; owner_user_id: number | null; external_account_id: string; display_name: string; credentials_enc: string | null };

/** One log row. `detail` is a sentence: never a token, never an attendee's email. */
export async function logSyndication(env: Env, row: {
  syndication_id?: number | null; account_id?: number | null; event_id?: number | null; channel: string;
  action: string; outcome: 'ok' | 'failed' | 'skipped'; http_status?: number | null; detail?: string | null; actor_user_id?: number | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_syndication_log (syndication_id, account_id, event_id, channel, action, outcome, http_status, detail, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.syndication_id ?? null, row.account_id ?? null, row.event_id ?? null, row.channel, row.action, row.outcome,
    row.http_status ?? null, row.detail == null ? null : String(row.detail).slice(0, DETAIL_MAX), row.actor_user_id ?? null).run();
}

/** The platform's sentence, with every credential value removed and trimmed to 500 characters. */
export function cleanReason(message: string, credentials: Record<string, unknown> | null): string {
  let out = String(message || 'The channel refused the listing.');
  for (const v of Object.values(credentials ?? {})) {
    if (typeof v === 'string' && v.length >= 4) out = out.split(v).join('[redacted]');
  }
  out = out.replace(/\b(Bearer|token|key)[=:\s]+[A-Za-z0-9._~+/-]{8,}/gi, '$1 [redacted]');
  return out.slice(0, DETAIL_MAX);
}

function reasonOf(err: unknown, channel: string, credentials: Record<string, unknown> | null): { detail: string; status: number | null } {
  const status = err instanceof ChannelError ? err.status : null;
  if (status === 429) {
    const name = isChannelKey(channel) ? CHANNEL_NAMES[channel] : channel;
    const after = err instanceof ChannelError && err.retryAfter ? `; retry after ${err.retryAfter}` : '';
    return { detail: `Rate limited by ${name}${after}`.slice(0, DETAIL_MAX), status };
  }
  return { detail: cleanReason(err instanceof Error ? err.message : String(err), credentials), status };
}

function overridesOf(json: string): ListingInput['overrides'] {
  try {
    const o = JSON.parse(json || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

const httpsOrNull = (u: unknown) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u.slice(0, 2000) : null);

/** The job. Payload: `{ syndication_uid, action }`. */
export async function runSyndicationJob(env: Env, payload: { syndication_uid?: string; action?: string }): Promise<void> {
  const action = payload?.action as SyndicationAction;
  if (!payload?.syndication_uid || !['post', 'update', 'cancel', 'withdraw'].includes(action)) return;
  const row = await env.DB.prepare('SELECT * FROM event_syndications WHERE uid = ?').bind(payload.syndication_uid).first<Row>();
  if (!row) return; // unselected while queued
  // Only the state this action was queued from does work: a repeat is a no-op.
  if (action === 'post' && row.status !== 'pending') return;
  if (action !== 'post' && (row.status !== 'posted' || row.sync_state !== 'pending')) return;

  const account = await env.DB.prepare('SELECT * FROM event_channel_accounts WHERE id = ?').bind(row.account_id).first<Account>();
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(row.event_id).first<Record<string, any>>();
  const base = { syndication_id: row.id, account_id: row.account_id, event_id: row.event_id, channel: row.channel };

  if (action === 'post') {
    // The run-time check: cancelled while queued means cancelled, not posted.
    if (!event || event.status === 'cancelled') {
      await env.DB.prepare("UPDATE event_syndications SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'pending'").bind(row.id).run();
      await logSyndication(env, { ...base, action: 'post', outcome: 'skipped', detail: 'The event was cancelled before it posted.' });
      return;
    }
    const host = event.host_user_id == null ? null
      : await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(event.host_user_id).first<{ role: string }>();
    const settings = await readSettings(env);
    const ok = account ? eligibility(event as any, account, host?.role ?? null, settings) : { ok: false as const, reason: 'Account expired' as const };
    if (!ok.ok) {
      await env.DB.prepare("UPDATE event_syndications SET status = 'skipped', skip_reason = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
        .bind(ok.reason, row.id).run();
      await logSyndication(env, { ...base, action: 'skip', outcome: 'skipped', detail: ok.reason });
      return;
    }
  }

  const adapter = syndicationChannel(row.channel);
  if (!adapter || !account || !event) {
    await fail(env, row, base, action, 'This channel has no adapter yet, so nothing was sent.', null, true);
    return;
  }
  let credentials: Record<string, unknown> | null = null;
  try { credentials = await decryptChannelCredentials(env, account.uid, account.credentials_enc); }
  catch { credentials = null; }
  const input: ListingInput = {
    event: listingEvent(event),
    link: listingLink(env.APP_URL, String(event.slug), row.channel),
    overrides: overridesOf(row.overrides_json),
    credentials,
    account: { external_account_id: account.external_account_id, display_name: account.display_name },
  };
  try {
    await perform(env, adapter, action, row, input, base, event);
  } catch (err) {
    const { detail, status } = reasonOf(err, row.channel, credentials);
    const last = row.attempts + 1 >= MAX_ATTEMPTS;
    await fail(env, row, base, action, detail, status, last);
    if (!last) throw new Error(`event_syndication ${action} failed`); // the queue retries; no text in the message
  }
}

async function perform(env: Env, adapter: SyndicationAdapter, action: SyndicationAction, row: Row, input: ListingInput,
  base: { syndication_id: number; account_id: number; event_id: number; channel: string }, event: Record<string, any>): Promise<void> {
  const hash = await contentHash(event);
  if (action === 'post') {
    const r = await adapter.create(env, input);
    await env.DB.prepare(
      `UPDATE event_syndications SET status = 'posted', sync_state = 'in_sync', external_id = ?, external_url = ?, pushed_hash = ?,
          content_hash = ?, last_error = NULL, attempts = attempts + 1, posted_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'`,
    ).bind(String(r.external_id).slice(0, 200), httpsOrNull(r.external_url), hash, hash, row.id).run();
    await logSyndication(env, { ...base, action: 'post', outcome: 'ok' });
    return;
  }
  const withId = { ...input, external_id: String(row.external_id ?? '') };
  if (action === 'update') {
    const r = await adapter.update(env, withId);
    await env.DB.prepare(
      `UPDATE event_syndications SET sync_state = 'in_sync', pushed_hash = ?, content_hash = ?, external_url = COALESCE(?, external_url),
          last_error = NULL, attempts = attempts + 1, updated_at = datetime('now')
        WHERE id = ? AND status = 'posted' AND sync_state = 'pending'`,
    ).bind(hash, hash, httpsOrNull(r.external_url), row.id).run();
    await logSyndication(env, { ...base, action: 'update', outcome: 'ok' });
    return;
  }
  await adapter.cancel(env, withId);
  await env.DB.prepare(
    `UPDATE event_syndications SET status = ?, sync_state = 'in_sync', last_error = NULL, attempts = attempts + 1, updated_at = datetime('now')
      WHERE id = ? AND status = 'posted' AND sync_state = 'pending'`,
  ).bind(action === 'cancel' ? 'cancelled' : 'withdrawn', row.id).run();
  await logSyndication(env, { ...base, action, outcome: 'ok' });
}

/** A failed run: the reason on the row and in the log; `failed` once the runs are spent. */
async function fail(env: Env, row: Row, base: { syndication_id: number; account_id: number; event_id: number; channel: string },
  action: SyndicationAction, detail: string, status: number | null, final: boolean): Promise<void> {
  if (action === 'post') {
    await env.DB.prepare(
      `UPDATE event_syndications SET status = CASE WHEN ? THEN 'failed' ELSE status END, last_error = ?, attempts = attempts + 1, updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'`,
    ).bind(final ? 1 : 0, detail, row.id).run();
  } else {
    await env.DB.prepare(
      `UPDATE event_syndications SET sync_state = CASE WHEN ? THEN 'failed' ELSE sync_state END, last_error = ?, attempts = attempts + 1, updated_at = datetime('now')
        WHERE id = ? AND status = 'posted'`,
    ).bind(final ? 1 : 0, detail, row.id).run();
  }
  await logSyndication(env, { ...base, action, outcome: 'failed', http_status: status, detail });
}

/**
 * The queue's dead-letter end: a message that ran out of retries marks its row
 * failed, keeping the reason the last run stored.
 */
export async function markSyndicationDead(env: Env, payload: { syndication_uid?: string; action?: string }): Promise<void> {
  if (!payload?.syndication_uid) return;
  if (payload.action === 'post') {
    await env.DB.prepare("UPDATE event_syndications SET status = 'failed', updated_at = datetime('now') WHERE uid = ? AND status = 'pending'")
      .bind(payload.syndication_uid).run();
  } else {
    await env.DB.prepare("UPDATE event_syndications SET sync_state = 'failed', updated_at = datetime('now') WHERE uid = ? AND status = 'posted' AND sync_state = 'pending'")
      .bind(payload.syndication_uid).run();
  }
}
