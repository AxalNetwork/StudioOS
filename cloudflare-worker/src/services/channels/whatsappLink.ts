/**
 * D754 way B, "Send to Axal" (#1937, wb1) — a member's own WhatsApp, linked to
 * their Axal account through Axal's OWN WhatsApp Business number.
 *
 * Proven from both sides, inside one ten-minute code (linkCodes.ts):
 *   1. In Axal the member asks for a code; the page opens
 *      `wa.me/<Axal's number>?text=LINK <code>`.
 *   2. Sending that from their WhatsApp proves they hold the number. The
 *      webhook (routes/channels.ts) records the claim against the sender and
 *      replies once: "Confirm in Axal to finish linking this WhatsApp."
 *   3. Confirming in Axal, signed in, proves the account. Only then does an
 *      `integrations` row with provider_key 'whatsapp_link' exist.
 *
 * NO NUMBER IN CLEAR. The sender's WhatsApp id (their phone number) is kept
 *   - as an HMAC in `integrations.external_account_id` (and on the code, as
 *     its claimant), which is all the webhook's lookup needs;
 *   - encrypted, in `credentials_enc` (and `claim_details_enc` on the code),
 *     for the replies part 2 sends;
 *   - as '•••• 1234' in `config_json` and `external_account_name`, for show.
 * Attempt counters hash their subject too (events.ts `linkAttemptOverLimit`).
 *
 * ONE MEMBER PER NUMBER, ONE NUMBER PER MEMBER: migration 492's partial unique
 * index and `integrations`' UNIQUE(user_id, provider_key).
 *
 * INERT UNTIL THE OWNER SETS AXAL'S NUMBER: `axalNumberReady` needs all four
 * of WHATSAPP_AXAL_ACCESS_TOKEN, WHATSAPP_AXAL_PHONE_NUMBER_ID,
 * WHATSAPP_AXAL_WABA_ID and WHATSAPP_AXAL_DISPLAY_NUMBER. Until then every
 * way-B route answers 503 `not_available` and the webhook ignores the number.
 *
 * A link unused for CHANNEL_LIMITS.senderLinkDays lapses in the channel purge
 * (threads.ts), because phone numbers are reassigned.
 */
import type { Env } from '../../types';
import { indexHmac } from '../columnCipher';
import { decryptCredentials, encryptCredentials } from '../../integrations/secrets';
import { IntakeError, activeMember } from '../interviewIntake';
import { claimDetails, consumeLinkCodeRow, memberLinkClaim, type LinkClaim } from './linkCodes';
import { maskNumber } from './whatsapp';

/** The four settings Axal's number needs, by name. Names only: a value never leaves the Worker. */
export const AXAL_NUMBER_SETTINGS = ['WHATSAPP_AXAL_ACCESS_TOKEN', 'WHATSAPP_AXAL_PHONE_NUMBER_ID', 'WHATSAPP_AXAL_WABA_ID', 'WHATSAPP_AXAL_DISPLAY_NUMBER'] as const;

/** The names of the settings that are unset, in that order (#1939: for a Super Admin's 503 only). */
export function axalNumberMissing(env: Env): string[] {
  const vars = env as unknown as Record<string, unknown>;
  return AXAL_NUMBER_SETTINGS.filter((name) => typeof vars[name] !== 'string' || (vars[name] as string).trim() === '');
}

/** Whether the owner has set Axal's number up: all four settings, or way B is off. */
export function axalNumberReady(env: Env): boolean {
  return axalNumberMissing(env).length === 0;
}

/**
 * Axal's public number, as the owner wrote it, and a plain `wa.me` link to it
 * with no code (#1939: Record a Session's "From WhatsApp"). Empty while way B
 * is not set up, so nothing is drawn.
 */
export function axalContact(env: Env): { axal_number?: string; axal_link?: string } {
  if (!axalNumberReady(env)) return {};
  const shown = String(env.WHATSAPP_AXAL_DISPLAY_NUMBER).trim();
  const digits = shown.replace(/\D/g, '');
  return digits ? { axal_number: shown, axal_link: `https://wa.me/${digits}` } : {};
}

/** Whether a webhook delivery is for Axal's own number. False while it is unset. */
export function isAxalNumber(env: Env, phoneNumberId: string | null | undefined): boolean {
  const own = String(env.WHATSAPP_AXAL_PHONE_NUMBER_ID ?? '').trim();
  return own !== '' && String(phoneNumberId ?? '').trim() === own;
}

/** The link a member opens: Axal's number with `LINK <code>` already typed. */
export function waLink(env: Env, code: string): string {
  const digits = String(env.WHATSAPP_AXAL_DISPLAY_NUMBER ?? '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=LINK%20${encodeURIComponent(code)}`;
}

/** `LINK <code>`, any case for the word and any spacing; the code itself is case-sensitive. */
export function linkCodeIn(text: string | null | undefined): string | null {
  const m = /^link\s+([A-Za-z0-9]{24})$/i.exec(String(text ?? '').trim());
  return m ? m[1] : null;
}

export const isStop = (text: string | null | undefined) => /^stop[.!]?$/i.test(String(text ?? '').trim());

/** The stored form of a sender's WhatsApp id: an HMAC, never the id. */
export function senderRef(env: Env, waId: string): Promise<string> {
  return indexHmac(env, 'integrations', 'external_account_id', `whatsapp_link:${String(waId).replace(/\D/g, '')}`);
}

/** The words Axal's number sends. Plain sentences; never a code or a number. */
export const WHATSAPP_LINK_COPY = {
  claimed: 'Confirm in Axal to finish linking this WhatsApp.',
  unlinked: 'Unlinked. Axal will not read what you send here.',
} as const;

export interface SenderLink { id: number; uid: string; user_id: number }

/** The active link for a sender, or null. */
export async function linkedSender(env: Env, waId: string): Promise<SenderLink | null> {
  return env.DB.prepare(
    `SELECT id, uid, user_id FROM integrations WHERE provider_key = 'whatsapp_link' AND status = 'active' AND external_account_id = ?`,
  ).bind(await senderRef(env, waId)).first<SenderLink>();
}

/** A linked sender's message counts as use, for the lapse. */
export async function touchLink(env: Env, integrationId: number): Promise<void> {
  await env.DB.prepare(`UPDATE integrations SET last_synced_at = ? WHERE id = ?`).bind(new Date().toISOString(), integrationId).run();
}

async function memberStanding(env: Env, userId: number): Promise<boolean> {
  try {
    await activeMember(env, userId);
    return true;
  } catch (err) {
    if (err instanceof IntakeError) return false;
    throw err;
  }
}

export type WhatsAppClaimOutcome =
  | { claimed: true; userId: number; codeUid: string }
  | { claimed: false; reason: 'code_invalid' | 'member_inactive' | 'identity_taken' };

/**
 * `LINK <code>` from a sender: spend the code and record the sender on it,
 * already confirmed from WhatsApp's side. Links nothing on its own.
 */
export async function claimWhatsAppLink(env: Env, code: string, waId: string): Promise<WhatsAppClaimOutcome> {
  const ref = await senderRef(env, waId);
  const row = await consumeLinkCodeRow(env, code, 'whatsapp_link', ref,
    { display_name: maskNumber(waId), username: null, wa_id: String(waId) }, { confirm: true });
  if (!row) return { claimed: false, reason: 'code_invalid' };
  if (!(await memberStanding(env, row.userId))) return { claimed: false, reason: 'member_inactive' };
  const holder = await linkedSender(env, waId);
  if (holder && Number(holder.user_id) !== row.userId) return { claimed: false, reason: 'identity_taken' };
  return { claimed: true, userId: row.userId, codeUid: row.uid };
}

const hexUid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

const expired = () => new IntakeError(410, 'link_expired', 'Both confirmations must arrive within ten minutes. Request a new WhatsApp link.');

/**
 * The signed-in member confirms the exact claim they were shown. Every write
 * is one D1 batch, each guarded by the claim still standing, so a newer code,
 * an unlink, expiry or a unique-index race leaves nothing half-done.
 */
export async function confirmWhatsAppLink(env: Env, userId: number, uid: string): Promise<{ linked: true; integrationId: number }> {
  await activeMember(env, userId);
  const claim = await memberLinkClaim(env, userId, uid, 'whatsapp_link');
  if (!claim) throw new IntakeError(404, 'link_not_found', 'That WhatsApp link is not waiting on this Axal account.');
  if (claim.activated_at) {
    // Idempotent: both sides already confirmed in time.
    const row = await env.DB.prepare(
      "SELECT id FROM integrations WHERE user_id = ? AND provider_key = 'whatsapp_link' AND status = 'active' AND external_account_id = ?",
    ).bind(userId, claim.telegram_user_id).first<{ id: number }>();
    if (row) return { linked: true, integrationId: Number(row.id) };
    throw new IntakeError(409, 'link_cancelled', 'This WhatsApp link was replaced or unlinked. Request a new link.');
  }
  if (claim.cancelled_at) throw new IntakeError(409, 'link_cancelled', 'This WhatsApp link was replaced or unlinked. Request a new link.');
  if (claim.expires_at <= new Date().toISOString()) throw expired();
  const details = await claimDetails(env, claim);
  if (!claim.telegram_user_id || !claim.confirmed_at || !details?.wa_id) {
    throw new IntakeError(409, 'link_not_claimed', 'Send the code from your WhatsApp first, then confirm here.');
  }
  const ref = claim.telegram_user_id;
  const holder = await env.DB.prepare(
    "SELECT user_id FROM integrations WHERE provider_key = 'whatsapp_link' AND status = 'active' AND external_account_id = ?",
  ).bind(ref).first<{ user_id: number }>();
  if (holder && Number(holder.user_id) !== userId) throw new IntakeError(409, 'number_taken', 'This WhatsApp is already linked to another Axal account.');

  // The credentials are bound to the integration's uid: a re-link keeps the row's uid.
  const existing = await env.DB.prepare("SELECT uid FROM integrations WHERE user_id = ? AND provider_key = 'whatsapp_link'")
    .bind(userId).first<{ uid: string }>();
  const integrationUid = existing?.uid ?? hexUid();
  const creds = await encryptCredentials(env, integrationUid, { wa_id: details.wa_id });
  const masked = details.display_name;
  const now = new Date().toISOString();
  const guard = `EXISTS (SELECT 1 FROM channel_link_codes c JOIN users u ON u.id = c.user_id
    WHERE c.uid = ? AND c.user_id = ? AND c.provider = 'whatsapp_link' AND c.telegram_user_id = ?
      AND c.confirmed_at IS NOT NULL AND c.activated_at IS NULL AND c.cancelled_at IS NULL AND c.expires_at > ?
      AND COALESCE(u.is_active, 1) != 0 AND u.deletion_requested_at IS NULL)`;
  const guarded = (sql: string, values: unknown[]) => env.DB.prepare(sql).bind(...values, claim.uid, userId, ref, now);
  try {
    await env.DB.batch([
      guarded(`INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json,
            external_account_id, external_account_name, last_synced_at)
        SELECT ?, ?, 'whatsapp_link', 'WhatsApp (Send to Axal)', 'active', 'webhook', ?, ?, ?, ?, ? WHERE ${guard}
        ON CONFLICT(user_id, provider_key) DO UPDATE SET
          status = 'active', auth_type = 'webhook', display_name = excluded.display_name, credentials_enc = excluded.credentials_enc,
          external_account_id = excluded.external_account_id, external_account_name = excluded.external_account_name,
          config_json = excluded.config_json, last_synced_at = excluded.last_synced_at,
          last_error = NULL, last_error_at = NULL, updated_at = CURRENT_TIMESTAMP`,
        [integrationUid, userId, creds, JSON.stringify({ connected_at: now, number_masked: masked }), ref, masked, now]),
      guarded(`UPDATE channel_link_codes SET axal_confirmed_at = datetime('now'), activated_at = datetime('now'), updated_at = datetime('now')
        WHERE uid = ? AND ${guard}`, [claim.uid]),
    ]);
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(err instanceof Error ? err.message : '')) {
      throw new IntakeError(409, 'number_taken', 'This WhatsApp is already linked to another Axal account.');
    }
    throw err;
  }
  const done = await memberLinkClaim(env, userId, claim.uid, 'whatsapp_link');
  const row = await env.DB.prepare(
    "SELECT id FROM integrations WHERE user_id = ? AND provider_key = 'whatsapp_link' AND status = 'active' AND external_account_id = ?",
  ).bind(userId, ref).first<{ id: number }>();
  if (!done?.activated_at || !row) throw expired();
  return { linked: true, integrationId: Number(row.id) };
}

/** The sender's WhatsApp id for a link, decrypted — for part 2's replies. Null when unreadable. */
export async function linkedWaId(env: Env, link: { uid: string; credentials_enc: string | null }): Promise<string | null> {
  const creds = await decryptCredentials(env, link.uid, link.credentials_enc);
  return typeof creds?.wa_id === 'string' && creds.wa_id ? creds.wa_id : null;
}

/** Unlink: the row stays, disconnected, with nothing that names the number but its mask. */
export async function unlinkMember(env: Env, userId: number): Promise<boolean> {
  const [, , r] = await env.DB.batch([
    env.DB.prepare(`UPDATE channel_link_codes SET cancelled_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ? AND provider = 'whatsapp_link' AND activated_at IS NULL AND cancelled_at IS NULL`).bind(userId),
    // #1939: the venture choice goes with the link. The row stays (disconnected), so no cascade would clear it.
    env.DB.prepare(`DELETE FROM whatsapp_link_settings
      WHERE integration_id IN (SELECT id FROM integrations WHERE provider_key = 'whatsapp_link' AND user_id = ?)`).bind(userId),
    env.DB.prepare(`UPDATE integrations SET status = 'disconnected', credentials_enc = NULL, external_account_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE provider_key = 'whatsapp_link' AND status = 'active' AND user_id = ?`).bind(userId),
  ]);
  return Number(r.meta?.changes ?? 0) > 0;
}

export async function unlinkSender(env: Env, integrationId: number): Promise<boolean> {
  const [, r] = await env.DB.batch([
    env.DB.prepare('DELETE FROM whatsapp_link_settings WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare(`UPDATE integrations SET status = 'disconnected', credentials_enc = NULL, external_account_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE provider_key = 'whatsapp_link' AND status = 'active' AND id = ?`).bind(integrationId),
  ]);
  return Number(r.meta?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// #1939 part 3: where a linked member's recordings go
// ---------------------------------------------------------------------------

/**
 * A venture the member may send recordings to: one their founder account owns,
 * not deleted. The same rule picks the fallback venture when a capture opens
 * (whatsappCapture.ts), so the picker never offers a venture the import refuses.
 */
export const WRITABLE_VENTURE_SQL = `SELECT p.id, p.name FROM projects p
  JOIN users u ON u.id = ? AND u.founder_id IS NOT NULL AND p.founder_id = u.founder_id
  WHERE p.id = ? AND p.deleted_at IS NULL`;

/**
 * The member's choice, while their link is active and they can still write the
 * venture. A choice whose venture was deleted or given away reads as none.
 */
export async function ventureChoice(env: Env, userId: number): Promise<{ project_id: number; name: string | null } | null> {
  const row = await env.DB.prepare(`SELECT p.id AS project_id, p.name AS name FROM whatsapp_link_settings s
      JOIN integrations i ON i.id = s.integration_id AND i.provider_key = 'whatsapp_link' AND i.status = 'active' AND i.user_id = ?
      JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
      JOIN users u ON u.id = i.user_id AND u.founder_id IS NOT NULL AND p.founder_id = u.founder_id`)
    .bind(userId).first<{ project_id: number; name: string | null }>();
  return row ? { project_id: Number(row.project_id), name: row.name ?? null } : null;
}

export type VentureChoiceOutcome = { ok: true } | { ok: false; reason: 'not_linked' | 'forbidden' };

/**
 * Record (or, with null, clear) the venture the member's recordings go to.
 * A venture they cannot write is `forbidden`, whether it is missing or another
 * member's, so the answer never says which.
 */
export async function setVentureChoice(env: Env, userId: number, projectId: number | null): Promise<VentureChoiceOutcome> {
  const link = await env.DB.prepare("SELECT id FROM integrations WHERE user_id = ? AND provider_key = 'whatsapp_link' AND status = 'active'")
    .bind(userId).first<{ id: number }>();
  if (!link) return { ok: false, reason: 'not_linked' };
  if (projectId === null) {
    await env.DB.prepare('DELETE FROM whatsapp_link_settings WHERE integration_id = ?').bind(link.id).run();
    return { ok: true };
  }
  const venture = await env.DB.prepare(WRITABLE_VENTURE_SQL).bind(userId, projectId).first<{ id: number }>();
  if (!venture) return { ok: false, reason: 'forbidden' };
  await env.DB.prepare(`INSERT INTO whatsapp_link_settings (integration_id, project_id, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(integration_id) DO UPDATE SET project_id = excluded.project_id, updated_at = excluded.updated_at`)
    .bind(link.id, projectId).run();
  return { ok: true };
}

/** What the member sees: the newest claim and the current link. Masked numbers only. */
export async function whatsappLinkView(env: Env, userId: number) {
  const row = await env.DB.prepare("SELECT * FROM channel_link_codes WHERE user_id = ? AND provider = 'whatsapp_link' ORDER BY id DESC LIMIT 1")
    .bind(userId).first<LinkClaim>();
  const link = await env.DB.prepare(
    "SELECT external_account_name, last_synced_at, created_at, updated_at FROM integrations WHERE user_id = ? AND provider_key = 'whatsapp_link' AND status = 'active'",
  ).bind(userId).first<{ external_account_name: string | null; last_synced_at: string | null; created_at: string; updated_at: string }>();
  let claim = null;
  if (row) {
    const details = await claimDetails(env, row);
    const status = row.activated_at ? 'linked' : row.cancelled_at ? 'cancelled' : row.expires_at <= new Date().toISOString() ? 'expired'
      : !row.telegram_user_id || !row.confirmed_at ? 'waiting_whatsapp' : !details ? 'unreadable' : 'waiting_axal';
    claim = {
      uid: row.uid, number_masked: details?.display_name ?? null, expires_at: row.expires_at, status,
      message: status === 'expired' ? 'Both confirmations must arrive within ten minutes. Request a new WhatsApp link.'
        : status === 'cancelled' ? 'This link was replaced or unlinked. Request a new WhatsApp link.'
        : status === 'unreadable' ? 'The WhatsApp that sent the code could not be read. Request a new link before confirming.'
        : status === 'waiting_whatsapp' ? 'Send the code to Axal on WhatsApp first.'
        : status === 'waiting_axal' ? 'Check the number and confirm in Axal to finish linking.'
        : 'This WhatsApp is linked.',
    };
  }
  return {
    claim,
    link: link ? { number_masked: link.external_account_name, linked_at: link.updated_at ?? link.created_at, last_used_at: link.last_synced_at } : null,
    // #1939 part 3: where recordings go. Null with no choice: the member's most recently updated venture.
    venture: link ? await ventureChoice(env, userId) : null,
  };
}
