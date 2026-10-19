/**
 * D684 — one-time codes that prove a Telegram account is the member's.
 *
 * The member asks for a code while signed in; Axal shows it once, inside a
 * `t.me/<bot>?start=<code>` link. Only its SHA-256 is stored. A code lives ten
 * minutes and works once: `consumeLinkCode` marks it used in the same UPDATE
 * that checks it is unused and unexpired, so two deliveries of one `/start`
 * cannot both link.
 *
 * Redeeming a code is not yet linking (telegram.ts): the Telegram account that
 * sent `/start` is recorded on the code, and only that account's `/confirm`,
 * within the original ten minutes, records that side's consent. Activation also
 * requires the signed-in member's confirmation in Axal (telegram.ts).
 *
 * Codes are 24 characters of an unambiguous alphabet (no 0/O, 1/l/I): about
 * 120 bits, and safe in a Telegram start parameter ([A-Za-z0-9_-], ≤ 64).
 *
 * D754 way B (#1937) reuses all of it for 'whatsapp_link': the member sends
 * `LINK <code>` to Axal's own WhatsApp number (whatsappLink.ts). There the
 * claimant is an HMAC of the sender's WhatsApp id, never the id, and sending
 * the code is that side's confirmation, so the claim is confirmed as it is
 * recorded (`consumeLinkCodeRow`'s `confirm`).
 */
import type { Env } from '../../types';
import { decryptColumn, encryptColumn } from '../columnCipher';
import { sha256Hex } from '../../rpc/secret';
import { CHANNEL_LIMITS } from './types';

export type LinkProvider = 'telegram' | 'whatsapp_link';

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
export async function createLinkCode(env: Env, userId: number, provider: LinkProvider): Promise<{ code: string; expiresAt: string }> {
  const code = newCode();
  const hash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + CHANNEL_LIMITS.linkCodeMinutes * 60_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE channel_link_codes SET cancelled_at = datetime('now'), updated_at = datetime('now')
        WHERE user_id = ? AND provider = ? AND activated_at IS NULL AND cancelled_at IS NULL`,
    ).bind(userId, provider),
    env.DB.prepare(
      `INSERT INTO channel_link_codes (uid, code_hash, user_id, provider, expires_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), hash, userId, provider, expiresAt),
  ]);
  return { code, expiresAt };
}

/**
 * The member a code belongs to, consuming it — or null when unknown, used or
 * expired. `claimant` is the Telegram account redeeming it, recorded on the
 * code so that only that account can confirm the link (`confirmLinkClaim`).
 */
export interface LinkClaim {
  uid: string; user_id: number; telegram_user_id: string | null; claim_details_enc: string | null;
  expires_at: string; used_at: string | null; confirmed_at: string | null; axal_confirmed_at: string | null;
  activated_at: string | null; cancelled_at: string | null;
}
export interface ClaimDetails {
  display_name: string | null; username: string | null;
  /** 'whatsapp_link' only: the sender's WhatsApp id, which exists in clear nowhere else. */
  wa_id?: string;
}

export async function consumeLinkCode(
  env: Env, code: string, provider: LinkProvider, claimant: string | null = null, details: ClaimDetails | null = null,
): Promise<number | null> {
  const row = await consumeLinkCodeRow(env, code, provider, claimant, details);
  return row ? row.userId : null;
}

/** `consumeLinkCode`, with the code's uid; `confirm` records the claimant's side as given in the same UPDATE. */
export async function consumeLinkCodeRow(
  env: Env, code: string, provider: LinkProvider, claimant: string | null = null, details: ClaimDetails | null = null,
  opts: { confirm?: boolean } = {},
): Promise<{ userId: number; uid: string } | null> {
  const clean = String(code ?? '').trim();
  if (clean.length !== CODE_LEN || ![...clean].every((ch) => ALPHABET.includes(ch))) return null;
  const hash = await sha256Hex(clean);
  const codeRow = await env.DB.prepare('SELECT uid FROM channel_link_codes WHERE code_hash = ?').bind(hash).first<{ uid: string }>();
  if (!codeRow) return null;
  const encrypted = details ? await encryptColumn(env, 'channel_link_codes', 'claim_details_enc', codeRow.uid, JSON.stringify(details)) : null;
  const row = await env.DB.prepare(
    `UPDATE channel_link_codes SET used_at = datetime('now'), telegram_user_id = ?, claim_details_enc = ?,
            confirmed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE confirmed_at END, updated_at = datetime('now')
      WHERE code_hash = ? AND provider = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?
      RETURNING user_id, uid`,
  ).bind(claimant, encrypted, opts.confirm ? 1 : 0, hash, provider, new Date().toISOString()).first<{ user_id: number; uid: string }>();
  return row ? { userId: Number(row.user_id), uid: row.uid } : null;
}

/** Telegram's own confirmation, still within the code's original lifetime. */
export async function confirmLinkClaim(env: Env, provider: LinkProvider, claimant: string): Promise<LinkClaim | null> {
  return env.DB.prepare(
    `UPDATE channel_link_codes SET confirmed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = (SELECT id FROM channel_link_codes
        WHERE provider = ? AND telegram_user_id = ? AND confirmed_at IS NULL AND used_at IS NOT NULL
          AND cancelled_at IS NULL AND activated_at IS NULL AND expires_at > ?
        ORDER BY id DESC LIMIT 1)
        AND confirmed_at IS NULL AND cancelled_at IS NULL
      RETURNING *`,
  ).bind(provider, String(claimant), new Date().toISOString()).first<LinkClaim>();
}

export function memberLinkClaim(env: Env, userId: number, uid: string, provider: LinkProvider = 'telegram'): Promise<LinkClaim | null> {
  return env.DB.prepare('SELECT * FROM channel_link_codes WHERE user_id = ? AND provider = ? AND uid = ?')
    .bind(userId, provider, uid).first<LinkClaim>();
}

export async function claimDetails(env: Env, claim: LinkClaim): Promise<ClaimDetails | null> {
  const plain = await decryptColumn(env, 'channel_link_codes', 'claim_details_enc', claim.uid, claim.claim_details_enc);
  if (!plain) return null;
  try { return JSON.parse(plain) as ClaimDetails; } catch { return null; }
}

export async function pendingLinkView(env: Env, userId: number, uid?: string) {
  const row = uid ? await memberLinkClaim(env, userId, uid) : await env.DB.prepare("SELECT * FROM channel_link_codes WHERE user_id = ? AND provider = 'telegram' ORDER BY id DESC LIMIT 1")
    .bind(userId).first<LinkClaim>();
  if (!row) return null;
  const details = await claimDetails(env, row);
  const status = row.activated_at ? 'linked' : row.cancelled_at ? 'cancelled' : row.expires_at <= new Date().toISOString() ? 'expired'
    : !row.telegram_user_id ? 'waiting_claim' : !details ? 'unreadable' : !row.confirmed_at ? 'waiting_telegram' : !row.axal_confirmed_at ? 'waiting_axal' : 'ready';
  return {
    uid: row.uid, display_name: details?.display_name ?? null, username: details?.username ?? null, expires_at: row.expires_at,
    telegram_confirmed: !!row.confirmed_at, axal_confirmed: !!row.axal_confirmed_at, status,
    message: status === 'expired' ? 'Both confirmations must arrive within ten minutes. Request a new Telegram link.'
      : status === 'cancelled' ? 'This link was replaced or cancelled. Request a new Telegram link.'
      : status === 'unreadable' ? 'The claimed Telegram account could not be read. Request a new link before confirming.'
      : status === 'waiting_telegram' ? 'Confirm in Telegram by sending /confirm to the Axal bot.'
      : status === 'waiting_axal' ? 'Confirm the claimed Telegram account in Axal to finish linking.'
      : status === 'ready' ? 'Both owners confirmed. Press Confirm again to finish activating this link.'
      : status === 'waiting_claim' ? 'Open the link in your Telegram account first.' : 'Both owners confirmed this Telegram link.',
  };
}
