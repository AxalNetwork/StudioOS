/**
 * D684 — one-time codes that prove a Telegram account is the member's.
 *
 * The member asks for a code while signed in; Axal shows it once, inside a
 * `t.me/<bot>?start=<code>` link. Only its SHA-256 is stored. A code lives ten
 * minutes and works once: `consumeLinkCode` marks it used in the same UPDATE
 * that checks it is unused and unexpired, so two deliveries of one `/start`
 * cannot both link.
 *
 * Codes are 24 characters of an unambiguous alphabet (no 0/O, 1/l/I): about
 * 120 bits, and safe in a Telegram start parameter ([A-Za-z0-9_-], ≤ 64).
 */
import type { Env } from '../../types';
import { sha256Hex } from '../../rpc/secret';
import { CHANNEL_LIMITS } from './types';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 24;

export function newCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** A fresh code for the member. Earlier unused codes for the same provider are retired. */
export async function createLinkCode(env: Env, userId: number, provider: 'telegram'): Promise<{ code: string; expiresAt: string }> {
  const code = newCode();
  const hash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + CHANNEL_LIMITS.linkCodeMinutes * 60_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE channel_link_codes SET used_at = datetime('now'), updated_at = datetime('now')
        WHERE user_id = ? AND provider = ? AND used_at IS NULL`,
    ).bind(userId, provider),
    env.DB.prepare(
      `INSERT INTO channel_link_codes (uid, code_hash, user_id, provider, expires_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), hash, userId, provider, expiresAt),
  ]);
  return { code, expiresAt };
}

/** The member a code belongs to, consuming it — or null when unknown, used or expired. */
export async function consumeLinkCode(env: Env, code: string, provider: 'telegram'): Promise<number | null> {
  const clean = String(code ?? '').trim();
  if (clean.length !== CODE_LEN || ![...clean].every((ch) => ALPHABET.includes(ch))) return null;
  const hash = await sha256Hex(clean);
  const row = await env.DB.prepare(
    `UPDATE channel_link_codes SET used_at = datetime('now'), updated_at = datetime('now')
      WHERE code_hash = ? AND provider = ? AND used_at IS NULL AND expires_at > ?
      RETURNING user_id`,
  ).bind(hash, provider, new Date().toISOString()).first<{ user_id: number }>();
  return row ? Number(row.user_id) : null;
}
