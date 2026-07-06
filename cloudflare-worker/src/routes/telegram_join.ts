/**
 * User-facing Telegram channel join requests.
 *
 * Maps the caller's role to the canonical channel they belong in (per
 * `services/telegramSchema.ts` seeding) and pings the studio's Slack
 * inbox (`AXAL_TEAM_SLACK_WEBHOOK_URL`) so an admin can issue the
 * Telegram invite link manually. Telegram bots can't add users to
 * invite-only channels without prior interaction, so a human-in-the-loop
 * is the only reliable path — this endpoint just queues the ask.
 *
 * Idempotent within a 24h window per (user_id, channel_slug) via KV
 * (`telegram_join_req:{user_id}:{slug}`) so a double-click doesn't spam
 * the admin channel.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { ensureTelegramSchema } from '../services/telegramSchema';

const r = new Hono<{ Bindings: Env }>();

const ROLE_TO_CHANNEL_SLUG: Record<string, string> = {
  founder: 'axal-founders',
  investor: 'axal-investors',
  advisor: 'axal-advisors',
  partner: 'axal-partners',
  alumni: 'axal-alumni',
  admin: 'axal-founders', // admins can request any; default to founders, override via body.channel_slug
};

r.get('/channels', async (c) => {
  const user = await requireAuth(c);
  await ensureTelegramSchema(c.env);
  const role = String(user.role || '').toLowerCase();
  const defaultSlug = ROLE_TO_CHANNEL_SLUG[role] || 'axalvc-public';
  // Admins see every enabled channel; other roles see only their role
  // channel + the public one.
  const rows = role === 'admin'
    ? await c.env.DB.prepare(
        `SELECT slug, label, audience, is_invite_only FROM telegram_channels WHERE enabled = 1 ORDER BY audience, slug`,
      ).all<any>()
    : await c.env.DB.prepare(
        `SELECT slug, label, audience, is_invite_only FROM telegram_channels WHERE enabled = 1 AND (slug = ? OR audience = 'public') ORDER BY audience, slug`,
      ).bind(defaultSlug).all<any>();
  return c.json({
    default_slug: defaultSlug,
    channels: (rows.results || []).map((row: any) => ({
      slug: row.slug,
      label: row.label,
      audience: row.audience,
      is_invite_only: Number(row.is_invite_only) === 1,
    })),
  });
});

r.post('/join-request', async (c) => {
  const user = await requireAuth(c);
  await ensureTelegramSchema(c.env);
  const role = String(user.role || '').toLowerCase();
  const body = await c.req.json().catch(() => ({})) as { channel_slug?: string; note?: string };
  const requestedSlug = String(body.channel_slug || '').trim();
  const slug = requestedSlug || ROLE_TO_CHANNEL_SLUG[role] || 'axalvc-public';

  const channel = await c.env.DB.prepare(
    `SELECT slug, label, audience FROM telegram_channels WHERE slug = ? AND enabled = 1`,
  ).bind(slug).first<any>();
  if (!channel) return c.json({ error: 'channel_not_found' }, 404);

  // Role gate: non-admin callers may only join their own audience or
  // the public channel. Prevents an investor from requesting the
  // founders channel etc.
  if (role !== 'admin') {
    const expected = ROLE_TO_CHANNEL_SLUG[role];
    if (channel.slug !== expected && channel.audience !== 'public') {
      return c.json({ error: 'role_channel_mismatch', allowed: [expected, 'axalvc-public'] }, 403);
    }
  }

  // Race-safe daily idempotency: INSERT OR IGNORE into
  // telegram_join_requests with UNIQUE(user_id, channel_slug, day_bucket).
  // If meta.changes === 0 the row already existed, so we short-circuit
  // BEFORE posting to Slack. This is the atomic compare-and-set the
  // earlier KV `get → put` pattern lacked — two concurrent requests can
  // no longer both observe "not seen" and double-post.
  const dayBucket = new Date().toISOString().slice(0, 10); // yyyy-mm-dd UTC
  const ins = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO telegram_join_requests (user_id, channel_slug, day_bucket) VALUES (?, ?, ?)`,
  ).bind(user.id, channel.slug, dayBucket).run();
  const inserted = Number((ins as any)?.meta?.changes ?? (ins as any)?.changes ?? 0) > 0;
  if (!inserted) {
    return c.json({ ok: true, channel: { slug: channel.slug, label: channel.label }, deduped: true });
  }

  const webhookUrl = c.env.AXAL_TEAM_SLACK_WEBHOOK_URL || '';
  if (!webhookUrl) {
    // No silent fallback — admin can't be notified, so don't pretend.
    // Roll back the ledger row so the user can retry once ops sets the
    // webhook; otherwise this date+channel would be stuck-deduped.
    await c.env.DB.prepare(
      `DELETE FROM telegram_join_requests WHERE user_id = ? AND channel_slug = ? AND day_bucket = ?`,
    ).bind(user.id, channel.slug, dayBucket).run().catch(() => {});
    return c.json({ error: 'slack_webhook_unconfigured', message: 'The studio Slack inbox is not configured on this deployment.' }, 503);
  }

  const note = String(body.note || '').slice(0, 500);
  const slackText = `*Telegram join request* — <mailto:${user.email}|${user.name || user.email}> (${role}) wants the invite link to *${channel.label}* (\`${channel.slug}\`).${note ? `\n> ${note}` : ''}`;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: slackText,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: slackText },
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `:telegram: channel \`${channel.slug}\` · audience \`${channel.audience}\` · user_id ${user.id}` },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      // Roll back the ledger row so the user can retry instead of being
      // told they've already requested for the day.
      await c.env.DB.prepare(
        `DELETE FROM telegram_join_requests WHERE user_id = ? AND channel_slug = ? AND day_bucket = ?`,
      ).bind(user.id, channel.slug, dayBucket).run().catch(() => {});
      return c.json({ error: 'slack_post_failed', status: res.status }, 502);
    }
  } catch (e) {
    await c.env.DB.prepare(
      `DELETE FROM telegram_join_requests WHERE user_id = ? AND channel_slug = ? AND day_bucket = ?`,
    ).bind(user.id, channel.slug, dayBucket).run().catch(() => {});
    return c.json({ error: 'slack_post_failed', message: (e as Error).message }, 502);
  }

  return c.json({
    ok: true,
    channel: { slug: channel.slug, label: channel.label },
  });
});

export default r;
