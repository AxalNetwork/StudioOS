/**
 * Slack bus admin status (Phase 1, 2026-05-26).
 *
 * Read-only endpoint surfacing whether SLACK_BOT_TOKEN + each SLACK_CHANNEL_*
 * env var is wired, plus a per-channel test-post action so admins can verify
 * end-to-end delivery from the Admin → Integrations panel without leaving
 * the app.
 *
 * Mount BEFORE the catch-all /api/admin in index.ts (same precedence trick
 * as /api/admin/team, /api/admin/telegram, /api/admin/x).
 *
 * Surface:
 *   GET  /status            — { token_configured, channels: {ops,founders,...} }
 *   POST /test/:channel     — sends a verification card to that channel.
 *                              Body: { note?: string }. Admin audit logged.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import {
  isConfigured,
  channelStatus,
  postToChannel,
  buildEventCard,
  type ChannelKey,
} from '../services/slackBus';

const adminSlack = new Hono<{ Bindings: Env }>();

const VALID_KEYS: ReadonlySet<ChannelKey> = new Set(['ops', 'founders', 'review', 'signals', 'launch']);

adminSlack.get('/status', async (c) => {
  await requireAdmin(c);
  const env = c.env;
  return c.json({
    token_configured: !!env.SLACK_BOT_TOKEN,
    bus_configured: isConfigured(env),
    channels: channelStatus(env),
    // Surface the legacy webhook so the admin can confirm it's still the
    // active path during the transition window.
    legacy_webhook_configured: !!env.AXAL_TEAM_SLACK_WEBHOOK_URL,
  });
});

adminSlack.post('/test/:channel', async (c) => {
  const user = await requireAdmin(c);
  const key = c.req.param('channel') as ChannelKey;
  if (!VALID_KEYS.has(key)) {
    return c.json({ error: 'invalid_channel', valid: Array.from(VALID_KEYS) }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const note = String((body as { note?: unknown }).note || '').slice(0, 200);

  const card = buildEventCard({
    appUrl: (c.env as { APP_URL?: string }).APP_URL || '',
    header: ':white_check_mark: Slack bus test',
    title: `Test post to #axal-${key}`,
    body: note ? `> ${note}` : `Triggered from Admin → Integrations by ${user.name || user.email}.`,
    fields: [
      { label: 'Channel key', value: key },
      { label: 'Posted by', value: user.email || `user ${user.id}` },
    ],
    cta: { label: 'Open Admin', path: '/admin?tab=integration-keys' },
  });

  const result = await postToChannel(c.env, {
    channel: key,
    text: card.text,
    blocks: card.blocks,
    // Test posts should always deliver, never dedupe.
    dedupe_ms: 0,
  });

  // Audit trail — same `admin_audit_log` table other admin tools use.
  try {
    await c.env.DB.prepare(
      // `admin_user_id` and `filters_json` — the names every other admin
      // route uses and the only ones the table has. `actor_user_id`/`details`
      // matched nothing, so this audit row was never written.
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json)
       VALUES (?, ?, ?, ?)`,
    ).bind(
      user.id,
      result.ok ? 'slack_bus_test_ok' : 'slack_bus_test_failed',
      'slack_bus',
      JSON.stringify({ channel: key, reason: result.reason || null, ts: result.ts || null }),
    ).run();
  } catch { /* audit table may not exist in dev */ }

  if (!result.ok) {
    return c.json({
      ok: false,
      reason: result.reason,
      slack_error: result.slack_error,
      // `error` is what the SPA's request() helper turns into the thrown
      // message; without it an admin sees a bare "Request failed" instead of
      // the Slack API's own reason for refusing the post.
      error: `Slack rejected the message: ${result.slack_error || result.reason || 'unknown error'}`,
    }, 502);
  }
  return c.json({ ok: true, ts: result.ts, channel: result.channel });
});

export default adminSlack;
