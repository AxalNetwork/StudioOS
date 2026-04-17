/**
 * fund_distributions model layer (D1 helpers).
 * All money columns are integer cents.
 */
import type { Env } from '../types';

export interface FundDistribution {
  id: number;
  fund_id: number;
  lp_id: number;
  amount_cents: number;
  distribution_type: 'return_of_capital' | 'profit_share' | 'exit_proceeds';
  source_liquidity_event_id: number | null;
  status: 'pending' | 'paid' | 'failed';
  notes: string | null;
  distributed_at: string | null;
  created_at: string;
}

export const Distributions = {
  async insertMany(env: Env, items: Array<Partial<FundDistribution>>) {
    if (!items.length) return;
    // OR IGNORE relies on the unique (event, fund, lp) index; safe under retries.
    const stmts = items.map(d =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO fund_distributions
          (fund_id, lp_id, amount_cents, distribution_type, source_liquidity_event_id, status, notes)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(d.fund_id, d.lp_id, d.amount_cents, d.distribution_type,
             d.source_liquidity_event_id ?? null, d.status ?? 'pending', d.notes ?? null)
    );
    await env.DB.batch(stmts);
  },
  async listByFund(env: Env, fundId: number, limit = 100) {
    const r = await env.DB.prepare(
      `SELECT d.*, lp.user_id, u.email AS lp_email, u.name AS lp_name
         FROM fund_distributions d
         JOIN limited_partners lp ON lp.id = d.lp_id
         LEFT JOIN users u ON u.id = lp.user_id
        WHERE d.fund_id = ? ORDER BY d.created_at DESC LIMIT ?`
    ).bind(fundId, limit).all();
    return r.results || [];
  },
  async listByUser(env: Env, userId: number, limit = 100) {
    const r = await env.DB.prepare(
      `SELECT d.*, f.name AS fund_name
         FROM fund_distributions d
         JOIN limited_partners lp ON lp.id = d.lp_id
         JOIN vc_funds f ON f.id = d.fund_id
        WHERE lp.user_id = ? ORDER BY d.created_at DESC LIMIT ?`
    ).bind(userId, limit).all();
    return r.results || [];
  },
  async markPaid(env: Env, id: number) {
    return env.DB.prepare(
      `UPDATE fund_distributions SET status='paid', distributed_at=datetime('now')
        WHERE id = ? AND status = 'pending' RETURNING *`
    ).bind(id).first<FundDistribution>();
  },
};
