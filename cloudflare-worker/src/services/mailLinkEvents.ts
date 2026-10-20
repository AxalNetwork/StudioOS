/** D811: one atomic batch, including receipts and actor audit. Addresses are bound, never logged. */
import type { Env } from '../types';
import { sha256Hex } from '../rpc/secret';
import { normalizeEmail } from './newsletter';
import { parseAudience } from './mailLinkAudiences';

type Event = { uid: string; type: string; email: string; audience: string | null; topic: string | null; at: string };
export async function parseMailEvents(body: string): Promise<Event[] | null> {
  let input: unknown;
  try { input = JSON.parse(body); } catch { return null; }
  if (!Array.isArray(input) || !input.length || input.length > 500) return null;
  const events: Event[] = [];
  const seen = new Set<string>();
  for (const e of input) {
    if (!e || typeof e !== 'object' || !['unsubscribe', 'bounce', 'complaint'].includes(e.type)) return null;
    const email = normalizeEmail(e.email);
    if (!email || typeof e.at !== 'string' || e.at.length > 40 || !Number.isFinite(Date.parse(e.at))) return null;
    if (e.message_id !== undefined && (typeof e.message_id !== 'string' || !e.message_id.length || e.message_id.length > 256)) return null;
    const audience = e.audience === undefined ? null : typeof e.audience === 'string' ? parseAudience(e.audience) : null;
    if (e.audience !== undefined && !audience) return null;
    const uid = await sha256Hex(JSON.stringify([e.type, email, e.message_id ?? '']));
    // First receipt wins even when duplicates disagree inside one batch.
    if (seen.has(uid)) continue;
    seen.add(uid);
    events.push({ uid, type: e.type,
      email, audience: audience?.key || null, topic: audience?.topic || null, at: new Date(e.at).toISOString() });
  }
  return events;
}

export async function applyMailEvents(env: Env, events: Event[]): Promise<number> {
  const claim = crypto.randomUUID();
  const body = JSON.stringify(events);
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO mail_link_events (uid, type, audience, occurred_at, claim_uid)
      SELECT json_extract(value, '$.uid'), json_extract(value, '$.type'), json_extract(value, '$.audience'),
        json_extract(value, '$.at'), ? FROM json_each(?)`).bind(claim, body),
    env.DB.prepare(`UPDATE newsletter_subscriber_topics SET enabled = 0, updated_at = datetime('now')
      WHERE EXISTS (SELECT 1 FROM json_each(?) j
        JOIN mail_link_events e ON e.uid = json_extract(j.value, '$.uid') AND e.claim_uid = ?
        JOIN newsletter_subscribers s ON s.email = json_extract(j.value, '$.email')
        WHERE s.id = newsletter_subscriber_topics.subscriber_id AND e.type = 'unsubscribe'
          AND (json_extract(j.value, '$.topic') IS NULL OR json_extract(j.value, '$.topic') = newsletter_subscriber_topics.topic))`).bind(body, claim),
    env.DB.prepare(`UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now')
      WHERE EXISTS (SELECT 1 FROM json_each(?) j
        JOIN mail_link_events e ON e.uid = json_extract(j.value, '$.uid') AND e.claim_uid = ?
        WHERE json_extract(j.value, '$.email') = newsletter_subscribers.email AND e.type = 'unsubscribe'
          AND json_extract(j.value, '$.topic') IS NULL)`).bind(body, claim),
    env.DB.prepare(`UPDATE insight_subscriptions SET is_subscribed = 0, updated_at = datetime('now')
      WHERE user_id IN (SELECT s.user_id FROM json_each(?) j
        JOIN mail_link_events e ON e.uid = json_extract(j.value, '$.uid') AND e.claim_uid = ?
        JOIN newsletter_subscribers s ON s.email = json_extract(j.value, '$.email')
        WHERE e.type = 'unsubscribe' AND (json_extract(j.value, '$.topic') IS NULL OR json_extract(j.value, '$.topic') = 'insights'))`).bind(body, claim),
    env.DB.prepare(`INSERT OR IGNORE INTO email_suppressions (email, reason, source)
      SELECT json_extract(j.value, '$.email'), e.type, 'mail-link'
      FROM json_each(?) j JOIN mail_link_events e ON e.uid = json_extract(j.value, '$.uid') AND e.claim_uid = ?
      WHERE e.type IN ('bounce', 'complaint') OR (e.type = 'unsubscribe' AND json_extract(j.value, '$.topic') IS NULL)`).bind(body, claim),
    env.DB.prepare(`INSERT INTO activity_logs (action, actor, details)
      SELECT 'mail_link_event', 'service:axal-mail', json_object('type', type, 'audience', audience)
      FROM mail_link_events WHERE claim_uid = ?`).bind(claim),
  ]);
  return results[0].meta.changes;
}
