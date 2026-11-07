/**
 * D4670 (#4670) — who may confirm an advisor's proof claim, and about what.
 *
 * THE LINK IS AN INVITATION, NOT A CREDENTIAL. The advisor hands the person
 * they name a link (`/attest/:token`), and may read it back to hand it over
 * again. Holding the link lets someone READ the claim; it does not let them
 * answer. Every answer (confirm, decline, withdraw, reconfirm) needs a
 * six-digit code that Axal emails, on the attester's own request, to the
 * address the advisor named. So the advisor, who holds the link, cannot answer
 * for the attester, and a withdrawal cannot be reversed with what the advisor
 * holds. The named address cannot be the advisor's own.
 *
 * THE CLAIM IS PINNED. A request records the claim exactly as it read (kind,
 * title, organization, period, detail) and its SHA-256. The attester is shown
 * that text, and a confirmation counts only while the claim still reads that
 * way. A row recorded before this decision has no pinned claim: its answer is
 * kept and shown, and it no longer counts as confirmed (the owner's call on
 * #4670).
 *
 * Nothing here logs an address, a code or a claim.
 */
import type { Env } from '../types';
import { isSuppressed } from './newsletter';
import { sendNotificationEmail, escapeHtml } from './email';

export type ClaimFields = { kind: string; title: string; organization: string | null; period_note: string | null; detail: string | null };

/** The claim as it is pinned: a fixed key order, so the same claim always hashes the same. */
export function claimJson(item: ClaimFields): string {
  return JSON.stringify({
    kind: item.kind, title: item.title, organization: item.organization ?? null,
    period_note: item.period_note ?? null, detail: item.detail ?? null,
  });
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const claimSha256 = (item: ClaimFields) => sha256Hex(claimJson(item));

/** A plausible single address, lower-cased, or null. */
export function emailOf(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s.length <= 300 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s) ? s : null;
}

/** "s***@example.com": enough for the attester to recognise their address, not enough to read it off the page. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  return domain ? `${local.slice(0, 1)}***@${domain}` : null;
}

export const CODE_TTL_MS = 15 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
/** Codes one consent may send in an hour: enough for a mistyped address to be retried, not a mail cannon. */
export const CODES_PER_HOUR = 5;

/**
 * A six-digit code from the platform CSPRNG, every code equally likely.
 *
 * Each digit is a random nibble (0 to 15) kept only when it is below 10; the
 * other six values are thrown away and drawn again. The six digits are
 * independent and each of 0 to 9 is exactly as likely as any other, so every
 * one of the million codes is. No remainder and no division is taken of the
 * random value: `random % 10` and `floor(random / span)` both read as biased
 * to CodeQL (js/biased-cryptographic-random), and the first one is.
 */
export function newCode(draw: () => number = () => crypto.getRandomValues(new Uint8Array(1))[0] & 0x0f): string {
  let code = '';
  while (code.length < 6) {
    const nibble = draw();
    if (nibble < 10) code += String(nibble);
  }
  return code;
}
/** Bound to its consent, so a hash leaked from one row answers no other. */
export const codeHash = (consentId: number, code: string) => sha256Hex(`advisor-proof:${consentId}:${code}`);

/**
 * How the code is mailed. An object, so a test swaps `send` and reads the code
 * it would have sent; production sends through the platform's mail path,
 * which honours the suppression list.
 */
export const attestationMailer = {
  async send(env: Env, to: string, advisorName: string, code: string): Promise<boolean> {
    if (await isSuppressed(env, to, 'security')) return false;
    const subject = 'Your Axal confirmation code';
    const body = `Your code to answer ${advisorName}'s request on Axal is ${code}. It lasts 15 minutes. If you did not ask for it, ignore this email: nothing is recorded without the code.`;
    const html = `<p style="font-family:sans-serif;font-size:14px;color:#111;">Your code to answer ${escapeHtml(advisorName)}’s request on Axal is</p>`
      + `<p style="font-family:monospace;font-size:24px;letter-spacing:4px;color:#111;"><b>${code}</b></p>`
      + '<p style="font-family:sans-serif;font-size:12px;color:#6b7280;">It lasts 15 minutes. If you did not ask for it, ignore this email: nothing is recorded without the code.</p>';
    return sendNotificationEmail(env, to, subject, body, { html });
  },
};

/** What a consent row says, as the advisor and the attester both read it. */
export type ConsentState = 'pending' | 'confirmed' | 'declined' | 'withdrawn' | 'needs_reconfirmation';
export function consentState(row: { consent_given: number; withdrawn_at: string | null; consent_given_at: string | null; claim_sha256: string | null }, currentClaimSha: string): ConsentState {
  if (row.withdrawn_at) return row.consent_given_at ? 'withdrawn' : 'declined';
  if (Number(row.consent_given) !== 1) return 'pending';
  // Confirmed through a link the advisor held (before D4670), or about a claim that has since changed.
  if (!row.claim_sha256 || row.claim_sha256 !== currentClaimSha) return 'needs_reconfirmation';
  return 'confirmed';
}
