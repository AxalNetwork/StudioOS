import type { Env } from '../types';

export type PersonalMatchTarget = 'engagement_invoice' | 'payout' | 'partner_deal_settlement';
export type BankMatch = { posted_on: string; last_four: string };

/** Read stored evidence only. Callers must first authorize access to the target.
 * Never reads an integration, credential, or bank account. */
export async function matchFor(env: Env, target_kind: PersonalMatchTarget, target_id: number): Promise<BankMatch | null> {
  return await env.DB.prepare(`SELECT posted_on, account_last_four AS last_four
    FROM mercury_personal_matches WHERE target_kind = ? AND target_id = ? AND state = 'confirmed'`)
    .bind(target_kind, target_id).first<BankMatch>();
}
