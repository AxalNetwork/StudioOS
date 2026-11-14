/**
 * D1490 (#3904) — the four triggers. Each is one bound UPDATE of the event's
 * syndication rows, then one `event_syndication` job per row that has work,
 * keyed `uid:action:content_hash` so a repeated trigger queues nothing new.
 *
 *   · Approve (`admin_events.ts`): every `selected` row → `pending`, `post`.
 *   · An edit (`events.ts` PATCH), by the host or an admin: a `posted` row
 *     whose `pushed_hash` differs from the event's new content hash →
 *     `sync_state = 'pending'` and `update`, or `'unsupported'` when its
 *     channel cannot edit a post.
 *   · Cancel (both routes): `posted` rows → `cancel`; the rest → `cancelled`.
 *   · Unpublish: `posted` rows → `withdraw`; the rest → `withdrawn`.
 *
 * NEVER FAILS THE EVENT WRITE. `runHook` catches everything, logs a code and
 * writes one `failed` log row when it can; the event's own change has already
 * landed and stands.
 */
import type { Env } from '../../types';
import { enqueueJob } from '../queue';
import { contentHash } from './content';
import { syndicationChannel } from './channels';

export type SyndicationAction = 'post' | 'update' | 'cancel' | 'withdraw';

/** One queued job for one row. The key makes a repeated trigger a no-op. */
export async function enqueueSyndication(env: Env, uid: string, action: SyndicationAction, hash: string | null): Promise<void> {
  await enqueueJob(env, 'event_syndication', { syndication_uid: uid, action }, { idempotency_key: `${uid}:${action}:${hash ?? ''}` });
}

async function runHook(env: Env, name: string, eventId: number, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    console.warn('[event-syndication] hook_failed', name);
    try {
      await env.DB.prepare(
        "INSERT INTO event_syndication_log (event_id, channel, action, outcome, detail) VALUES (?, 'all', ?, 'failed', ?)",
      ).bind(eventId, name === 'approve' ? 'post' : name === 'edit' ? 'update' : name, 'The listing could not be queued. The event change was saved.').run();
    } catch { /* the table may not exist yet; the event write stands either way */ }
  }
}

/** The channels whose adapter can do it: bound as one JSON array. */
function channelsThat(can: 'updates' | 'cancels', rows: Array<{ channel: string }>): string {
  return JSON.stringify([...new Set(rows.map((r) => r.channel))].filter((ch) => syndicationChannel(ch)?.[can]));
}

/** Approve: the ticked channels post. */
export async function onEventApproved(env: Env, event: Record<string, any>): Promise<void> {
  await runHook(env, 'approve', Number(event.id), async () => {
    const hash = await contentHash(event);
    const rows = await env.DB.prepare(
      `UPDATE event_syndications SET status = 'pending', content_hash = ?, last_error = NULL, skip_reason = NULL, updated_at = datetime('now')
        WHERE event_id = ? AND status = 'selected' RETURNING uid`,
    ).bind(hash, event.id).all<{ uid: string }>();
    for (const r of rows.results || []) await enqueueSyndication(env, r.uid, 'post', hash);
  });
}

/** An edit: posted listings whose content changed are updated, where their channel can. */
export async function onEventEdited(env: Env, event: Record<string, any>): Promise<void> {
  await runHook(env, 'edit', Number(event.id), async () => {
    const hash = await contentHash(event);
    const posted = await env.DB.prepare(
      "SELECT channel FROM event_syndications WHERE event_id = ? AND status = 'posted'",
    ).bind(event.id).all<{ channel: string }>();
    if (!(posted.results || []).length) return;
    const rows = await env.DB.prepare(
      `UPDATE event_syndications
          SET sync_state = CASE WHEN channel IN (SELECT value FROM json_each(?)) THEN 'pending' ELSE 'unsupported' END,
              content_hash = ?, updated_at = datetime('now')
        WHERE event_id = ? AND status = 'posted' AND (pushed_hash IS NULL OR pushed_hash != ?)
        RETURNING uid, sync_state`,
    ).bind(channelsThat('updates', posted.results || []), hash, event.id, hash).all<{ uid: string; sync_state: string }>();
    for (const r of rows.results || []) if (r.sync_state === 'pending') await enqueueSyndication(env, r.uid, 'update', hash);
  });
}

async function closeListings(env: Env, eventId: number, kind: 'cancel' | 'withdraw'): Promise<void> {
  await runHook(env, kind, eventId, async () => {
    const closed = kind === 'cancel' ? 'cancelled' : 'withdrawn';
    // Not yet posted: nothing is out there to remove.
    await env.DB.prepare(
      `UPDATE event_syndications SET status = ?, sync_state = NULL, updated_at = datetime('now')
        WHERE event_id = ? AND status IN ('selected', 'pending', 'failed', 'skipped')`,
    ).bind(closed, eventId).run();
    const posted = await env.DB.prepare(
      "SELECT channel FROM event_syndications WHERE event_id = ? AND status = 'posted'",
    ).bind(eventId).all<{ channel: string }>();
    if (!(posted.results || []).length) return;
    const rows = await env.DB.prepare(
      `UPDATE event_syndications
          SET sync_state = CASE WHEN channel IN (SELECT value FROM json_each(?)) THEN 'pending' ELSE 'unsupported' END,
              updated_at = datetime('now')
        WHERE event_id = ? AND status = 'posted' RETURNING uid, sync_state`,
    ).bind(channelsThat('cancels', posted.results || []), eventId).all<{ uid: string; sync_state: string }>();
    for (const r of rows.results || []) if (r.sync_state === 'pending') await enqueueSyndication(env, r.uid, kind, null);
  });
}

/** Either cancel route: posted listings are cancelled on their channel. */
export const onEventCancelled = (env: Env, eventId: number) => closeListings(env, eventId, 'cancel');
/** The desk's unpublish: posted listings are withdrawn. */
export const onEventUnpublished = (env: Env, eventId: number) => closeListings(env, eventId, 'withdraw');
