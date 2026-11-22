/** D6237: fund-register contact corrections and safe removal, with transactional actor history. */
import type { Env } from '../types';
import { parseMinor } from '../../../frontend/src/lib/money.js';
import type { LimitedPartner } from '../models/funds';
function dollarsToCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const parsed = parseMinor(String(value), 'USD');
  return parsed.ok ? parsed.minor : null;
}

const FIELDS = new Set(['name', 'email', 'commitment_amount', 'status']);
export class LpMaintenanceError extends Error {
  code: string;
  status: number;
  /** A public sentence authored here; never database/provider diagnostics. */
  reason: string;
  constructor(code: string, reason: string, status = 400) { super(reason); this.code = code; this.status = status; this.reason = reason; }
}
export function lpPatch(body: unknown): Record<string, string | number | null> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LpMaintenanceError('lp_patch_invalid', 'Send the LP fields to correct.');
  const entries = Object.entries(body);
  if (!entries.length || entries.some(([key]) => !FIELDS.has(key))) throw new LpMaintenanceError('lp_patch_fields', 'Only name, email, commitment_amount and status can be corrected here.');
  const patch: Record<string, string | number | null> = {};
  for (const [key, value] of entries) {
    if (key === 'commitment_amount') {
      if (typeof value !== 'number' || dollarsToCents(value) == null) throw new LpMaintenanceError('lp_commitment_invalid', 'Commitment must be a non-negative dollar amount with at most two decimal places within the supported range.');
      patch[key] = value;
    } else if (key === 'status') {
      if (typeof value !== 'string' || !['committed', 'active', 'redeemed'].includes(value)) throw new LpMaintenanceError('lp_status_invalid', 'Status must be committed, active or redeemed.');
      patch[key] = value;
    } else {
      if (value !== null && typeof value !== 'string') throw new LpMaintenanceError('lp_contact_invalid', 'Name and email must be text, or null to clear them.');
      const text = value === null ? '' : (value as string).trim();
      if (text.length > (key === 'name' ? 200 : 320) || (key === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))) throw new LpMaintenanceError('lp_contact_invalid', 'Use a name of at most 200 characters and a valid email address of at most 320 characters.');
      patch[key] = text || null;
    }
  }
  return patch;
}
const called = `(SELECT COALESCE(SUM(COALESCE(cc.amount_cents, ROUND(cc.amount * ?))), 0) FROM capital_calls cc WHERE cc.limited_partner_id = limited_partners.id)`;
async function existing(env: Env, fundId: number, lpId: number) {
  const row = await env.DB.prepare('SELECT * FROM limited_partners WHERE id = ? AND fund_id = ?').bind(lpId, fundId).first<LimitedPartner>();
  if (!row) throw new LpMaintenanceError('lp_not_found', 'LP not found.', 404);
  return row;
}
function audit(env: Env, actorId: number, fundId: number, lpId: number, action: string, fields: string[]) {
  return env.DB.prepare(`INSERT INTO activity_logs (user_id, action, action_type, entity_type, entity_id, metadata)
    SELECT ?, ?, ?, 'limited_partner', ?, ? WHERE changes() > 0`)
    .bind(actorId, action, action, String(lpId), JSON.stringify({ fund_id: fundId, lp_id: lpId, fields }));
}
export async function correctLp(env: Env, fundId: number, lpId: number, actorId: number, body: unknown) {
  await existing(env, fundId, lpId);
  const patch = lpPatch(body), entries = Object.entries(patch);
  const floor = Object.hasOwn(patch, 'commitment_amount') ? ` AND ? >= ${called}` : '';
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE limited_partners SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = datetime('now')
      WHERE id = ? AND fund_id = ?${floor} RETURNING *`).bind(...entries.map(([,value]) => value), lpId, fundId,
        // The shared parser supplies the USD scale as well as the new amount; legacy aggregation stays atomic.
        ...(floor ? [dollarsToCents(patch.commitment_amount), dollarsToCents(1)] : [])),
    audit(env, actorId, fundId, lpId, 'lp_corrected', Object.keys(patch)),
  ]);
  const row = result[0].results?.[0];
  if (!row) {
    await existing(env, fundId, lpId);
    throw new LpMaintenanceError('lp_commitment_below_called', 'The commitment cannot be lower than the amount already called on this LP’s capital-call lines.', 409);
  }
  return row;
}
export async function removeLp(env: Env, fundId: number, lpId: number, actorId: number) {
  await existing(env, fundId, lpId);
  // No soft-delete columns or established LP deletion pattern exist. Preserve who/when in the append-only activity log.
  const result = await env.DB.batch([
    env.DB.prepare(`DELETE FROM limited_partners WHERE id = ? AND fund_id = ? AND NOT EXISTS (SELECT 1 FROM capital_calls cc WHERE cc.limited_partner_id = limited_partners.id)
      AND NOT EXISTS (SELECT 1 FROM capital_call_receipts r WHERE r.limited_partner_id = limited_partners.id) RETURNING id`).bind(lpId, fundId),
    audit(env, actorId, fundId, lpId, 'lp_removed', []),
    env.DB.prepare(`UPDATE vc_funds SET lp_count = (SELECT COUNT(*) FROM limited_partners WHERE fund_id = ?), updated_at = datetime('now')
      WHERE id = ? AND changes() > 0`).bind(fundId, fundId),
  ]);
  if (!result[0].results?.length) {
    await existing(env, fundId, lpId);
    throw new LpMaintenanceError('lp_has_capital_history', 'This LP has a capital-call line or receipt and cannot be removed. Correct its details instead.', 409);
  }
}
