/**
 * Slack bus — org-wide channel poster (Phase 1, 2026-05-26).
 *
 * Sits alongside `services/notify.ts` (which delivers per-user notifications
 * via each user's personal Slack webhook). This module is the opposite:
 * one bot token, multiple known channels, used by the worker to surface
 * org-wide platform events (customer chat, tickets, deal stage changes,
 * KYC/DD activity, market-intel signals, ops alerting, GitHub bridge).
 *
 * Channel routing is **key-based**, not name-based — every call site asks
 * for a `ChannelKey` ('ops' | 'founders' | 'review' | 'signals' | 'launch')
 * which maps to a Slack channel ID via env vars. This keeps channel
 * renames cost-free and stops typos from silently dropping messages.
 *
 * Failure model: every public function is best-effort. A 4xx from Slack,
 * a missing token, or a missing channel-ID env all return `{ ok: false,
 * reason }` — they MUST NEVER throw and MUST NEVER break the underlying
 * business action that triggered the call. Callers wrap with try/catch as
 * defense in depth, but the bus itself never propagates errors.
 *
 * Rate limiting: Slack's `chat.postMessage` is roughly 1 message/sec/channel
 * (Tier 3). We add a small in-isolate dedupe window keyed by
 * `${channel}:${hash(title+body)}` (30s) so retry storms / crash loops can't
 * blow the quota. This is intentionally per-isolate (no KV) — the dedupe is
 * a guard rail, not a contract.
 */
import type { Env } from '../types';
import { stripTrailingSlashes } from '../util/url';

export type ChannelKey = 'ops' | 'founders' | 'review' | 'signals' | 'launch';

/** Per-channel env-var name (typed so a typo doesn't ship). */
const CHANNEL_ENV: Record<ChannelKey, keyof Env> = {
  ops: 'SLACK_CHANNEL_OPS',
  founders: 'SLACK_CHANNEL_FOUNDERS',
  review: 'SLACK_CHANNEL_REVIEW',
  signals: 'SLACK_CHANNEL_SIGNALS',
  launch: 'SLACK_CHANNEL_LAUNCH',
};

export interface PostResult {
  ok: boolean;
  /** Slack message timestamp (used as thread_ts for follow-ups). */
  ts?: string;
  /** Channel ID Slack actually delivered to. */
  channel?: string;
  /** Machine-readable failure reason when ok=false. */
  reason?: 'no_token' | 'no_channel' | 'deduped' | 'slack_error' | 'network';
  /** Raw Slack `error` field when reason='slack_error'. */
  slack_error?: string;
}

export interface PostArgs {
  /** Channel key (resolved to ID via env). */
  channel: ChannelKey;
  /** Plain-text fallback (Slack requires either `text` or `blocks`). */
  text: string;
  /** Optional Block Kit blocks — when present, `text` is the screen-reader fallback. */
  blocks?: Array<Record<string, unknown>>;
  /** Optional thread_ts for follow-up replies. */
  thread_ts?: string;
  /** Optional override of the in-isolate dedupe window (ms). 0 disables. */
  dedupe_ms?: number;
}

// ─── In-isolate dedupe ──────────────────────────────────────────────────
// Map<`${channelKey}:${digest}`, expiresAtMs>. Pruned on every check to
// keep memory bounded. Capped at 256 entries — anything beyond that is
// either a misconfigured caller or a flood we'd want to see anyway.
const DEDUPE_CACHE = new Map<string, number>();
const DEDUPE_MAX = 256;

function dedupeKey(channel: ChannelKey, title: string, body: string): string {
  // Cheap non-crypto digest — collision risk is irrelevant for a 30s window
  // and the inputs are not security-sensitive.
  const s = `${title}\n${body}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${channel}:${h.toString(36)}`;
}

/** Pure check — does NOT mutate the cache. Mutation happens via
 *  `recordDedupe` only after Slack has confirmed delivery, so a
 *  transient failure never blocks a legitimate retry. */
function checkDedupe(key: string, windowMs: number): boolean {
  if (windowMs <= 0) return false;
  const now = Date.now();
  // Prune expired entries every check (cheap; map is small).
  for (const [k, exp] of DEDUPE_CACHE) {
    if (exp <= now) DEDUPE_CACHE.delete(k);
  }
  return DEDUPE_CACHE.has(key);
}

function recordDedupe(key: string, windowMs: number): void {
  if (windowMs <= 0) return;
  if (DEDUPE_CACHE.size >= DEDUPE_MAX) {
    const oldest = DEDUPE_CACHE.keys().next().value;
    if (oldest) DEDUPE_CACHE.delete(oldest);
  }
  DEDUPE_CACHE.set(key, Date.now() + windowMs);
}

/** Resolve a ChannelKey to a Slack channel ID via env. Returns null when unset. */
export function resolveChannelId(env: Env, key: ChannelKey): string | null {
  const envKey = CHANNEL_ENV[key];
  const id = (env[envKey] as string | undefined) || '';
  return id.trim() || null;
}

/** Quick boolean: is the bus wired (token + at least one channel)? */
export function isConfigured(env: Env): boolean {
  if (!env.SLACK_BOT_TOKEN) return false;
  return (Object.keys(CHANNEL_ENV) as ChannelKey[]).some((k) => !!resolveChannelId(env, k));
}

/** Returns a per-channel configured/unconfigured map for the admin status panel. */
export function channelStatus(env: Env): Record<ChannelKey, { configured: boolean; channel_id: string | null }> {
  const out = {} as Record<ChannelKey, { configured: boolean; channel_id: string | null }>;
  for (const k of Object.keys(CHANNEL_ENV) as ChannelKey[]) {
    const id = resolveChannelId(env, k);
    out[k] = { configured: !!id, channel_id: id };
  }
  return out;
}

/**
 * Post a message to a known channel.
 *
 * Best-effort, never throws. Use `result.ok` + `result.reason` to surface
 * delivery state to the caller's own activity log if needed.
 */
export async function postToChannel(env: Env, args: PostArgs): Promise<PostResult> {
  const token = env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, reason: 'no_token' };

  const channelId = resolveChannelId(env, args.channel);
  if (!channelId) return { ok: false, reason: 'no_channel' };

  const dedupeMs = args.dedupe_ms ?? 30_000;
  const bodyForDedupe = args.blocks ? JSON.stringify(args.blocks) : '';
  const dKey = dedupeKey(args.channel, args.text, bodyForDedupe);
  if (checkDedupe(dKey, dedupeMs)) {
    return { ok: false, reason: 'deduped' };
  }

  const payload: Record<string, unknown> = {
    channel: channelId,
    text: args.text,
  };
  if (args.blocks && args.blocks.length > 0) payload.blocks = args.blocks;
  if (args.thread_ts) payload.thread_ts = args.thread_ts;

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    // Slack always returns 200 with { ok: false, error: '...' } on logical errors.
    if (!res.ok) {
      console.warn('[slackBus] http error', res.status, args.channel);
      return { ok: false, reason: 'network' };
    }
    const json = await res.json().catch(() => ({})) as { ok?: boolean; ts?: string; channel?: string; error?: string };
    if (!json.ok) {
      console.warn('[slackBus] slack rejected', json.error, args.channel);
      return { ok: false, reason: 'slack_error', slack_error: json.error };
    }
    // Only record dedupe after Slack confirms delivery — a transient
    // failure must not suppress a legitimate retry.
    recordDedupe(dKey, dedupeMs);
    return { ok: true, ts: json.ts, channel: json.channel };
  } catch (e) {
    console.warn('[slackBus] network failure', (e as Error).message);
    return { ok: false, reason: 'network' };
  }
}

// ─── Standard renderers ─────────────────────────────────────────────────
// Block Kit helpers that callers can compose. Centralised so every event
// has the same visual shape ("Open in Axal" CTA, context footer, etc.).

export interface EventCardArgs {
  appUrl: string;
  /** Headline emoji + short label, e.g. ":wave: New customer chat". */
  header: string;
  /** Bold title line under the header. */
  title: string;
  /** Optional body paragraph (markdown). */
  body?: string | null;
  /** Optional list of metadata field rows ({label, value}, both markdown). */
  fields?: Array<{ label: string; value: string }>;
  /** Optional CTA button — `path` is resolved against appUrl when relative. */
  cta?: { label: string; path: string };
  /** Optional footer line (markdown) — defaults to "Axal StudioOS". */
  footer?: string;
}

export function buildEventCard(args: EventCardArgs): { text: string; blocks: Array<Record<string, unknown>> } {
  const root = stripTrailingSlashes(args.appUrl || '');
  const ctaUrl = args.cta
    ? (args.cta.path.startsWith('http') ? args.cta.path : `${root}${args.cta.path.startsWith('/') ? '' : '/'}${args.cta.path}`)
    : null;
  const blocks: Array<Record<string, unknown>> = [
    { type: 'header', text: { type: 'plain_text', text: args.header, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${args.title}*${args.body ? `\n${args.body}` : ''}` } },
  ];
  if (args.fields && args.fields.length > 0) {
    // Slack section `fields` arrays are 2-column; we cap at 10 (Slack max).
    const fieldBlocks = args.fields.slice(0, 10).map((f) => ({
      type: 'mrkdwn',
      text: `*${f.label}*\n${f.value}`,
    }));
    blocks.push({ type: 'section', fields: fieldBlocks });
  }
  if (ctaUrl) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: args.cta!.label, emoji: true },
        url: ctaUrl,
        style: 'primary',
      }],
    });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: args.footer || 'Axal StudioOS' }],
  });
  return {
    text: `${args.title}${args.body ? ` — ${args.body.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`,
    blocks,
  };
}
