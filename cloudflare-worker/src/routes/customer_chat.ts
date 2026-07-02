/**
 * Task #7 (IG) — Customer chat for paid tiers.
 *
 * Studio / Institutional / Partner-tier users can post a message that lands
 * in the Axal team's Slack channel as a new thread (or follow-up in their
 * existing thread). The `customer_chat_threads` table maps user_id ↔
 * (slack_channel, slack_thread_ts) so replies from Slack can route back.
 *
 * Free / Growth users see HTTP 402 (paywall) — the frontend redirects them
 * to the Help widget instead. Admin / mentor bypass tier (mirrors the
 * requireTier middleware pattern).
 *
 * Slack delivery uses an incoming-webhook posted to the
 * `AXAL_TEAM_SLACK_WEBHOOK_URL` env (the studio's own Slack workspace, not
 * the per-user `loadSlackWebhookForUser` integration). When the env is
 * unset the message is still stored in customer_chat_messages so we never
 * lose user intent; the route returns 202 with a `slack_delivered: false`
 * flag so the UI can show "queued — team will reply by email".
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

const customerChat = new Hono<{ Bindings: Env }>();

// Spec excludes Growth; Studio / Institutional / Partner only.
const ALLOWED_FOUNDER_TIERS = new Set(['studio']);
const ALLOWED_INVESTOR_TIERS = new Set(['institutional']);

/** True when the user's tier qualifies for customer chat. */
function isEligible(user: any): boolean {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  // Admin / mentor bypass — same as requireTier
  if (role === 'admin' || role === 'mentor') return true;
  // Partners get chat regardless of subscription tier (they're paying via partner contract).
  if (role === 'partner') return true;
  if (role === 'investor') {
    const t = String((user as any).investor_tier || 'free').toLowerCase();
    return ALLOWED_INVESTOR_TIERS.has(t);
  }
  // Founder default
  const t = String(user.subscription_tier || 'free').toLowerCase();
  return ALLOWED_FOUNDER_TIERS.has(t);
}

function tierPaywall() {
  return {
    error: 'chat_requires_paid_tier',
    message: 'Customer chat is available on Studio / Institutional / Partner plans. Free and Growth users can use the Help widget to reach the team.',
    upgrade_to: 'studio',
  };
}

/** GET /api/customer-chat/thread — fetch the user's active thread + history. */
customerChat.get('/thread', async (c) => {
  const user = await requireAuth(c);
  if (!isEligible(user)) return c.json(tierPaywall(), 402);

  const env = c.env;
  const thread = await env.DB.prepare(
    `SELECT id, slack_channel, slack_thread_ts, subject, status, created_at, last_message_at
       FROM customer_chat_threads
      WHERE user_id = ? AND status = 'open'
      ORDER BY last_message_at DESC
      LIMIT 1`,
  ).bind(user.id).first<any>();

  if (!thread) {
    return c.json({ thread: null, messages: [] });
  }

  const msgs = await env.DB.prepare(
    `SELECT id, direction, body, created_at
       FROM customer_chat_messages
      WHERE thread_id = ?
      ORDER BY created_at ASC
      LIMIT 200`,
  ).bind(thread.id).all();

  return c.json({ thread, messages: msgs.results || [] });
});

/** POST /api/customer-chat/send — send a message into the Axal team Slack channel. */
customerChat.post('/send', async (c) => {
  const user = await requireAuth(c);
  if (!isEligible(user)) return c.json(tierPaywall(), 402);

  const body = await c.req.json().catch(() => ({}));
  const text = String(body?.text || '').trim();
  if (!text) return c.json({ error: 'empty_message' }, 400);
  if (text.length > 4000) return c.json({ error: 'message_too_long' }, 400);

  const env = c.env;

  // Look up existing open thread (newest first).
  let thread = await env.DB.prepare(
    `SELECT id, slack_channel, slack_thread_ts FROM customer_chat_threads
      WHERE user_id = ? AND status = 'open'
      ORDER BY last_message_at DESC LIMIT 1`,
  ).bind(user.id).first<any>();

  const tierLabel = user.role === 'investor'
    ? `investor/${(user as any).investor_tier || 'free'}`
    : user.role === 'partner'
      ? 'partner'
      : `founder/${(user as any).subscription_tier || 'free'}`;

  // Phase 1 (2026-05-26) — prefer the org-wide slackBus (bot token +
  // #axal-founders channel ID) when configured. Falls back to the legacy
  // AXAL_TEAM_SLACK_WEBHOOK_URL incoming webhook when the bot path isn't
  // wired yet so customer chat keeps working through the transition.
  const { postToChannel, resolveChannelId } = await import('../services/slackBus');
  const useBus = !!env.SLACK_BOT_TOKEN && !!resolveChannelId(env, 'founders');
  const legacyWebhookUrl = env.AXAL_TEAM_SLACK_WEBHOOK_URL || '';
  const legacyChannelLabel = env.AXAL_TEAM_SLACK_CHANNEL || '#customer-chat';

  // Common block payload used by both delivery paths.
  const composedBlocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${user.name || user.email}* _(${tierLabel})_\n${text}`,
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `:email: ${user.email} · user_id ${user.id}` },
      ],
    },
  ];
  const composedText = `*${user.name || user.email}* (${tierLabel}) — ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`;

  let slackDelivered = false;
  let newThreadTs: string | null = thread?.slack_thread_ts || null;

  // Helper for the legacy webhook path — also used as a fallback when
  // the bot path is configured but Slack rejects (bad scope, missing
  // channel membership, outage). Returns true on confirmed delivery.
  async function deliverViaLegacyWebhook(): Promise<boolean> {
    if (!legacyWebhookUrl) return false;
    const slackPayload: any = { text: composedText, blocks: composedBlocks };
    if (thread?.slack_thread_ts && !String(thread.slack_thread_ts).startsWith('pending:') && !String(thread.slack_thread_ts).startsWith('local:')) {
      slackPayload.thread_ts = thread.slack_thread_ts;
    }
    try {
      const res = await fetch(legacyWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackPayload),
      });
      if (!res.ok) return false;
      if (!thread) {
        // Webhooks don't return ts — synthesise a placeholder that the
        // /slack-reply Events handler rewrites to the real ts on first
        // inbound reply (existing behaviour, preserved).
        newThreadTs = `pending:${user.id}:${Date.now()}`;
      }
      return true;
    } catch (e) {
      console.warn('[customer-chat] legacy webhook post failed', (e as Error).message);
      return false;
    }
  }

  if (useBus) {
    // Bot-token path — chat.postMessage returns a real `ts` we can pin
    // as thread_ts for follow-ups, no more `pending:` placeholders.
    // Don't pass an existing `pending:` placeholder to Slack — it's not a
    // real ts and Slack would reject it. Only thread when we have a real ts.
    const realThreadTs = thread?.slack_thread_ts && !String(thread.slack_thread_ts).startsWith('pending:') && !String(thread.slack_thread_ts).startsWith('local:')
      ? thread.slack_thread_ts
      : undefined;
    const result = await postToChannel(env, {
      channel: 'founders',
      text: composedText,
      blocks: composedBlocks,
      thread_ts: realThreadTs,
      // Customer messages are unique enough that the 30s dedupe is fine,
      // but disable it on follow-ups inside an existing thread so quick
      // back-to-back messages don't get dropped.
      dedupe_ms: realThreadTs ? 0 : 30_000,
    });
    slackDelivered = result.ok;
    if (result.ok && !thread && result.ts) {
      newThreadTs = result.ts;
    }
    // Fallback to legacy webhook on bot failure (bad scope, missing
    // channel membership, Slack outage). `deduped` is not a real
    // failure — same payload already delivered seconds ago, no retry
    // needed and no fallback either.
    if (!result.ok && result.reason !== 'deduped' && legacyWebhookUrl) {
      slackDelivered = await deliverViaLegacyWebhook();
    }
  } else if (legacyWebhookUrl) {
    // Legacy webhook path — kept verbatim until the bot is provisioned.
    const slackPayload: any = { text: composedText, blocks: composedBlocks };
    if (thread?.slack_thread_ts && !String(thread.slack_thread_ts).startsWith('pending:') && !String(thread.slack_thread_ts).startsWith('local:')) {
      slackPayload.thread_ts = thread.slack_thread_ts;
    }
    try {
      const res = await fetch(legacyWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackPayload),
      });
      slackDelivered = res.ok;
      // Webhooks don't return ts — synthesise a placeholder that the
      // /slack-reply Events handler rewrites to the real ts on first
      // inbound reply (existing behaviour, preserved).
      if (!thread) {
        newThreadTs = `pending:${user.id}:${Date.now()}`;
      }
    } catch (e) {
      console.warn('[customer-chat] slack post failed', (e as Error).message);
    }
  }
  // Channel label used purely for the DB row's slack_channel column.
  const channel = useBus ? (resolveChannelId(env, 'founders') || '#axal-founders') : legacyChannelLabel;

  // Persist thread + message no matter what (so the user's intent is never lost).
  if (!thread) {
    const ins = await env.DB.prepare(
      `INSERT INTO customer_chat_threads (user_id, slack_channel, slack_thread_ts, subject, status, created_at, last_message_at)
       VALUES (?, ?, ?, ?, 'open', datetime('now'), datetime('now'))`,
    ).bind(user.id, channel, newThreadTs || `local:${user.id}:${Date.now()}`, text.slice(0, 80)).run();
    thread = { id: (ins as any).meta?.last_row_id, slack_channel: channel, slack_thread_ts: newThreadTs };
  } else {
    await env.DB.prepare(
      `UPDATE customer_chat_threads SET last_message_at = datetime('now') WHERE id = ?`,
    ).bind(thread.id).run();
  }

  await env.DB.prepare(
    `INSERT INTO customer_chat_messages (thread_id, direction, body, created_at)
     VALUES (?, 'in', ?, datetime('now'))`,
  ).bind(thread.id, text).run();

  return c.json({
    ok: true,
    thread_id: thread.id,
    slack_delivered: slackDelivered,
  }, slackDelivered ? 200 : 202);
});

/**
 * POST /api/customer-chat/slack-reply — webhook handler for Slack Events API
 * `message.channels` events. Matches thread_ts back to a thread row and
 * appends the reply as a direction='out' message. Signature verification
 * is via the SLACK_SIGNING_SECRET (skipped when the env is unset — dev).
 *
 * Body shape (Slack Events API outer envelope):
 *   { type: 'event_callback', event: { type: 'message', thread_ts, text, channel, user, bot_id } }
 */
customerChat.post('/slack-reply', async (c) => {
  const env = c.env;
  const raw = await c.req.text();
  let payload: any = {};
  try { payload = JSON.parse(raw); } catch { return c.json({ error: 'invalid_json' }, 400); }

  // URL verification handshake (Slack sends this once when the endpoint is registered).
  if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
    return c.json({ challenge: payload.challenge });
  }

  // Optional signature check — recommended in prod.
  const signingSecret = (env as any).SLACK_SIGNING_SECRET || '';
  if (signingSecret) {
    const ts = c.req.header('x-slack-request-timestamp') || '';
    const sig = c.req.header('x-slack-signature') || '';
    const age = Math.abs(Date.now() / 1000 - Number(ts));
    if (!ts || age > 60 * 5) return c.json({ error: 'stale_request' }, 401);
    const base = `v0:${ts}:${raw}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(signingSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (`v0=${hex}` !== sig) return c.json({ error: 'bad_signature' }, 401);
  }

  if (payload.type !== 'event_callback' || payload.event?.type !== 'message') {
    return c.json({ ok: true, ignored: true });
  }
  const event = payload.event;
  // Ignore bot echoes of our own outgoing messages.
  if (event.bot_id || event.subtype === 'bot_message') return c.json({ ok: true, ignored: true });
  const threadTs = event.thread_ts || event.ts;
  const channel = event.channel;
  const text = String(event.text || '').trim();
  if (!threadTs || !channel || !text) return c.json({ ok: true, ignored: true });

  // Resolve thread row. First try an exact match on the canonical Slack
  // thread_ts. If none, fall back to the most-recent `pending:*`
  // placeholder thread on this channel (incoming-webhooks don't return
  // ts, so we synthesize a placeholder on the outbound write and
  // reconcile it here on the first reply). The fallback window is
  // 30 minutes to avoid mis-mapping replies on unrelated old threads.
  let row = await env.DB.prepare(
    `SELECT id FROM customer_chat_threads
      WHERE slack_channel = ? AND slack_thread_ts = ?
      LIMIT 1`,
  ).bind(channel, threadTs).first<any>();

  if (!row) {
    const pending = await env.DB.prepare(
      `SELECT id FROM customer_chat_threads
        WHERE slack_channel = ?
          AND slack_thread_ts LIKE 'pending:%'
          AND created_at > datetime('now', '-30 minutes')
        ORDER BY created_at DESC
        LIMIT 1`,
    ).bind(channel).first<any>();
    if (pending) {
      // Rewrite the placeholder to the canonical Slack ts so future
      // replies match the fast path above.
      await env.DB.prepare(
        `UPDATE customer_chat_threads SET slack_thread_ts = ? WHERE id = ?`,
      ).bind(threadTs, pending.id).run();
      row = pending;
    }
  }

  if (!row) {
    // No matching thread — silently drop. Slack retries are bounded by their
    // own backoff; returning 200 prevents endless re-deliveries.
    return c.json({ ok: true, unmatched: true });
  }

  await env.DB.prepare(
    `INSERT INTO customer_chat_messages (thread_id, direction, body, created_at)
     VALUES (?, 'out', ?, datetime('now'))`,
  ).bind(row.id, text).run();
  await env.DB.prepare(
    `UPDATE customer_chat_threads SET last_message_at = datetime('now') WHERE id = ?`,
  ).bind(row.id).run();

  return c.json({ ok: true });
});

export default customerChat;
export { isEligible as isCustomerChatEligible };
