/**
 * Task #3 — Telegram Bot API client.
 *
 * Wraps sendMessage / sendPhoto / sendDocument / getChat in a lightweight
 * retry + circuit-breaker layer. Mirrors the rate-limit / last_error
 * pattern used by integrations/providers/* (e.g. crunchbase.ts). Failures
 * surface as TYPED errors so the route layer can return a structured
 * `{ code: 'telegram_…' }` payload — never a silent 500.
 *
 * Bot token is read from `env.TELEGRAM_BOT_TOKEN`. When unset we throw
 * TelegramTokenMissing immediately (the route maps that to a 503 with
 * code `telegram_token_missing`).
 *
 * Per replit.md secrets handling: NEVER log the token, NEVER echo it in
 * a response body, and the token is provisioned via
 *   wrangler secret put TELEGRAM_BOT_TOKEN --env production
 */
import type { Env } from '../types';

const API_BASE = 'https://api.telegram.org/bot';

// In-isolate breaker: if the API returns 429/5xx N times in a row, hold
// off further calls for `RECOVERY_MS`. Reset on first successful call.
const BREAKER_THRESHOLD = 5;
const RECOVERY_MS = 60_000;
let _consecutiveFailures = 0;
let _openedAt = 0;

export class TelegramError extends Error {
  code: string;
  status?: number;
  retryAfter?: number;
  constructor(code: string, message: string, opts: { status?: number; retryAfter?: number } = {}) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
  }
}

export class TelegramTokenMissing extends TelegramError {
  constructor() {
    super('telegram_token_missing', 'TELEGRAM_BOT_TOKEN is not configured.');
  }
}

function breakerOpen(): boolean {
  if (_consecutiveFailures < BREAKER_THRESHOLD) return false;
  if (Date.now() - _openedAt > RECOVERY_MS) {
    // Half-open: allow one trial call.
    _consecutiveFailures = BREAKER_THRESHOLD - 1;
    return false;
  }
  return true;
}

function recordSuccess() {
  _consecutiveFailures = 0;
  _openedAt = 0;
}

function recordFailure() {
  _consecutiveFailures += 1;
  if (_consecutiveFailures === BREAKER_THRESHOLD) {
    _openedAt = Date.now();
  }
}

async function call<T>(
  env: Env,
  method: string,
  body: Record<string, unknown>,
  opts: { attempt?: number } = {},
): Promise<T> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramTokenMissing();
  if (breakerOpen()) {
    throw new TelegramError(
      'telegram_breaker_open',
      'Telegram API circuit breaker is open after repeated failures; retry shortly.',
    );
  }

  const attempt = opts.attempt ?? 0;
  const url = `${API_BASE}${token}/${method}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    recordFailure();
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      return call<T>(env, method, body, { attempt: attempt + 1 });
    }
    throw new TelegramError('telegram_network', `Telegram network error: ${(e as Error).message}`);
  }

  if (res.status === 429) {
    const data = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
    const retryAfter = data.parameters?.retry_after ?? 1;
    recordFailure();
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
      return call<T>(env, method, body, { attempt: attempt + 1 });
    }
    throw new TelegramError('telegram_rate_limited', `Telegram rate limited; retry in ${retryAfter}s`, {
      status: 429,
      retryAfter,
    });
  }

  if (res.status >= 500) {
    recordFailure();
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return call<T>(env, method, body, { attempt: attempt + 1 });
    }
    throw new TelegramError('telegram_upstream', `Telegram upstream ${res.status}`, { status: res.status });
  }

  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!data.ok) {
    const desc = String(data.description || `Telegram error ${data.error_code}`);
    // Map common Bot API failures to friendly codes.
    let code = 'telegram_api_error';
    if (/chat not found/i.test(desc)) code = 'telegram_chat_not_found';
    else if (/not enough rights|kicked|forbidden/i.test(desc)) code = 'telegram_forbidden';
    else if (/unauthorized/i.test(desc)) code = 'telegram_unauthorized';
    // Deterministic content / permission errors (chat_not_found,
    // forbidden, unauthorized, generic 4xx api_error) MUST NOT trip the
    // breaker — they're operator/content mistakes, not upstream
    // instability. Only transient classes (5xx, 429, network) count.
    throw new TelegramError(code, desc, { status: res.status });
  }
  recordSuccess();
  return data.result as T;
}

// ---------- Markdown V2 escaping ----------
// Per Telegram docs, MarkdownV2 requires escaping these chars OUTSIDE of
// formatting entities: _ * [ ] ( ) ~ ` > # + - = | { } . !
const MD2_SPECIAL = /[_*\[\]()~`>#+\-=|{}.!\\]/g;
export function escapeMd2(s: string): string {
  return String(s ?? '').replace(MD2_SPECIAL, (m) => `\\${m}`);
}

// ---------- High-level methods ----------
export interface TgMessage {
  message_id: number;
  chat: { id: number | string; username?: string };
}

export async function sendMessage(
  env: Env,
  chatId: string,
  text: string,
  opts: { disablePreview?: boolean } = {},
): Promise<TgMessage> {
  return call<TgMessage>(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: opts.disablePreview ?? false,
  });
}

export async function sendPhoto(
  env: Env,
  chatId: string,
  photoBytes: Uint8Array,
  filename: string,
  caption: string,
): Promise<TgMessage> {
  return sendMultipart(env, 'sendPhoto', chatId, 'photo', photoBytes, filename, caption);
}

export async function sendDocument(
  env: Env,
  chatId: string,
  docBytes: Uint8Array,
  filename: string,
  caption: string,
): Promise<TgMessage> {
  return sendMultipart(env, 'sendDocument', chatId, 'document', docBytes, filename, caption);
}

async function sendMultipart(
  env: Env,
  method: string,
  chatId: string,
  fieldName: string,
  bytes: Uint8Array,
  filename: string,
  caption: string,
  attempt = 0,
): Promise<TgMessage> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramTokenMissing();
  if (breakerOpen()) {
    throw new TelegramError('telegram_breaker_open', 'Telegram API circuit breaker is open.');
  }
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('parse_mode', 'MarkdownV2');
  form.append(fieldName, new Blob([bytes]), filename);
  const url = `${API_BASE}${token}/${method}`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: form });
  } catch (e) {
    recordFailure();
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      return sendMultipart(env, method, chatId, fieldName, bytes, filename, caption, attempt + 1);
    }
    throw new TelegramError('telegram_network', `Telegram network error: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    const data = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
    const retryAfter = data.parameters?.retry_after ?? 1;
    recordFailure();
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
      return sendMultipart(env, method, chatId, fieldName, bytes, filename, caption, attempt + 1);
    }
    throw new TelegramError('telegram_rate_limited', `Telegram rate limited; retry in ${retryAfter}s`, {
      status: 429, retryAfter,
    });
  }
  if (res.status >= 500) {
    recordFailure();
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return sendMultipart(env, method, chatId, fieldName, bytes, filename, caption, attempt + 1);
    }
    throw new TelegramError('telegram_upstream', `Telegram ${res.status} on ${method}`, { status: res.status });
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: TgMessage; description?: string };
  if (!data.ok) {
    const desc = String(data.description || `Telegram ${method} failed`);
    let code = 'telegram_api_error';
    if (/chat not found/i.test(desc)) code = 'telegram_chat_not_found';
    else if (/not enough rights|kicked|forbidden/i.test(desc)) code = 'telegram_forbidden';
    else if (/unauthorized/i.test(desc)) code = 'telegram_unauthorized';
    // Same rule as call(): deterministic content errors do not trip the breaker.
    throw new TelegramError(code, desc, { status: res.status });
  }
  recordSuccess();
  return data.result as TgMessage;
}

export interface TgChat {
  id: number | string;
  title?: string;
  username?: string;
  type: string;
}

export async function getChat(env: Env, chatId: string): Promise<TgChat> {
  return call<TgChat>(env, 'getChat', { chat_id: chatId });
}

export function buildTelegramLink(chat: TgChat | undefined, messageId: number | undefined): string | null {
  if (!chat || !messageId) return null;
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  // For private channels chat.id is negative like -1001234567890; the public
  // permalink uses the last 10 digits as the "channel" path.
  const id = String(chat.id);
  const m = id.match(/^-100(\d+)$/);
  if (m) return `https://t.me/c/${m[1]}/${messageId}`;
  return null;
}
