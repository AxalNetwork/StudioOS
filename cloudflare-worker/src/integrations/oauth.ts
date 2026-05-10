/**
 * Task #1 — Generic OAuth helpers shared by every oauth2 provider.
 *
 * - PKCE pair (S256) the start handler ships back to the client + stores
 *   server-side keyed by the signed state token.
 * - Signed state tokens (HMAC-SHA256 over JWT_SECRET) bind the user, the
 *   provider, and the random nonce so an attacker can't replay another
 *   user's callback. The signature is verified before any code exchange.
 *
 * State storage uses the existing `oauth_state_tokens` table (created by
 * Task #10 calendar) — same idempotency / TTL semantics — so we don't
 * need another bespoke table. If the table is absent (fresh DB without
 * calendar migration), the helper bootstraps it lazily.
 */
import type { Env } from '../types';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TEXT = new TextEncoder();

let _stateSchemaReady = false;
async function ensureStateSchema(env: Env): Promise<void> {
  if (_stateSchemaReady) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS oauth_state_tokens (' +
      'state TEXT PRIMARY KEY, ' +
      'user_id INTEGER NOT NULL, ' +
      'provider TEXT NOT NULL, ' +
      'pkce_verifier TEXT, ' +
      'extra_json TEXT, ' +
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
      'consumed_at TIMESTAMP)',
    );
    _stateSchemaReady = true;
  } catch (e) {
    console.warn('[oauth] ensureStateSchema failed:', (e as Error).message);
  }
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', TEXT.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, TEXT.encode(message));
  return b64url(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** PKCE pair: a 64-byte verifier and its S256 challenge. */
export async function buildPkce(): Promise<{ verifier: string; challenge: string; method: 'S256' }> {
  const verifier = b64url(randomBytes(64));
  const digest = await crypto.subtle.digest('SHA-256', TEXT.encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)), method: 'S256' };
}

/**
 * Issue a state token bound to (user, provider). Format: `<nonce>.<sig>`
 * — the signature covers `${userId}:${provider}:${nonce}` keyed off
 * JWT_SECRET. Persists the PKCE verifier + any extra metadata so the
 * callback handler can complete the code exchange.
 */
export async function issueOauthState(
  env: Env,
  userId: number,
  provider: string,
  pkceVerifier: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  await ensureStateSchema(env);
  const secret = env.JWT_SECRET || '';
  if (!secret) throw new Error('JWT_SECRET is required to sign OAuth state');
  const nonce = b64url(randomBytes(16));
  const sig = await hmac(secret, `${userId}:${provider}:${nonce}`);
  const state = `${nonce}.${sig}`;
  await env.DB.prepare(
    'INSERT INTO oauth_state_tokens (state, user_id, provider, pkce_verifier, extra_json) VALUES (?, ?, ?, ?, ?)',
  ).bind(state, userId, provider, pkceVerifier, JSON.stringify(extra)).run();
  return state;
}

/**
 * Verify state on callback. Returns the verifier + extras, or null if the
 * signature is invalid, the row is missing/expired/already-consumed.
 * Single-use: marks the row as consumed before returning.
 */
export async function consumeOauthState(
  env: Env,
  userId: number,
  provider: string,
  state: string,
): Promise<{ pkce_verifier: string | null; extra: Record<string, unknown> } | null> {
  await ensureStateSchema(env);
  const secret = env.JWT_SECRET || '';
  if (!secret) return null;
  const dot = state.lastIndexOf('.');
  if (dot <= 0) return null;
  const nonce = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = await hmac(secret, `${userId}:${provider}:${nonce}`);
  if (!constantTimeEqual(sig, expected)) return null;

  const row = await env.DB.prepare(
    'SELECT pkce_verifier, extra_json, created_at, consumed_at FROM oauth_state_tokens WHERE state = ? AND user_id = ? AND provider = ?',
  ).bind(state, userId, provider).first<{
    pkce_verifier: string | null;
    extra_json: string | null;
    created_at: string;
    consumed_at: string | null;
  }>();
  if (!row) return null;
  if (row.consumed_at) return null;
  const created = Date.parse(row.created_at + 'Z') || Date.now();
  if (Date.now() - created > STATE_TTL_MS) return null;

  await env.DB.prepare('UPDATE oauth_state_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE state = ?').bind(state).run();
  let extra: Record<string, unknown> = {};
  if (row.extra_json) { try { extra = JSON.parse(row.extra_json); } catch { /* ignore */ } }
  return { pkce_verifier: row.pkce_verifier, extra };
}
