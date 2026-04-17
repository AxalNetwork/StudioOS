/**
 * vc_funds + limited_partners model layer (lightweight D1 helpers).
 * No ORM — just typed prepared statements.
 */
import type { Env } from '../types';

export interface VcFund {
  id: number;
  name: string;
  vintage_year: number | null;
  total_commitment: number;
  deployed_capital: number;
  lp_count: number;
  status: 'fundraising' | 'active' | 'closed' | 'wound_down';
  created_at: string;
  updated_at: string;
}

export interface LimitedPartner {
  id: number;
  user_id: number | null;
  fund_id: number;
  commitment_amount: number;
  invested_amount: number;
  returns: number;
  status: 'committed' | 'active' | 'redeemed';
  created_at: string;
  updated_at: string;
}

// ---------- vc_funds ----------
export const Funds = {
  async getById(env: Env, id: number) {
    return env.DB.prepare(`SELECT * FROM vc_funds WHERE id = ?`).bind(id).first<VcFund>();
  },
  async list(env: Env, status?: string) {
    if (status) {
      return env.DB.prepare(`SELECT * FROM vc_funds WHERE status = ? ORDER BY created_at DESC`)
        .bind(status).all<VcFund>();
    }
    return env.DB.prepare(`SELECT * FROM vc_funds ORDER BY created_at DESC`).all<VcFund>();
  },
  async create(env: Env, data: Partial<VcFund>) {
    const r = await env.DB.prepare(
      `INSERT INTO vc_funds (name, vintage_year, total_commitment, deployed_capital, lp_count, status)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(
      data.name, data.vintage_year ?? null,
      data.total_commitment ?? 0, data.deployed_capital ?? 0,
      data.lp_count ?? 0, data.status ?? 'fundraising',
    ).first<VcFund>();
    return r;
  },
  async update(env: Env, id: number, patch: Partial<VcFund>) {
    const fields: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (['name', 'vintage_year', 'total_commitment', 'deployed_capital', 'lp_count', 'status'].includes(k)) {
        fields.push(`${k} = ?`); vals.push(v);
      }
    }
    if (!fields.length) return this.getById(env, id);
    fields.push(`updated_at = datetime('now')`);
    vals.push(id);
    return env.DB.prepare(`UPDATE vc_funds SET ${fields.join(', ')} WHERE id = ? RETURNING *`)
      .bind(...vals).first<VcFund>();
  },
  async recountLPs(env: Env, fundId: number) {
    await env.DB.prepare(
      `UPDATE vc_funds SET lp_count = (SELECT COUNT(*) FROM limited_partners WHERE fund_id = ?), updated_at = datetime('now') WHERE id = ?`
    ).bind(fundId, fundId).run();
  },
};

// ---------- limited_partners ----------
export const LPs = {
  async getById(env: Env, id: number) {
    return env.DB.prepare(`SELECT * FROM limited_partners WHERE id = ?`).bind(id).first<LimitedPartner>();
  },
  async listByFund(env: Env, fundId: number) {
    return env.DB.prepare(
      `SELECT lp.*, u.email, u.name FROM limited_partners lp
       LEFT JOIN users u ON u.id = lp.user_id
       WHERE lp.fund_id = ? ORDER BY lp.commitment_amount DESC`
    ).bind(fundId).all();
  },
  async listByUser(env: Env, userId: number) {
    return env.DB.prepare(
      `SELECT lp.*, f.name AS fund_name, f.status AS fund_status
       FROM limited_partners lp JOIN vc_funds f ON f.id = lp.fund_id
       WHERE lp.user_id = ? ORDER BY lp.created_at DESC`
    ).bind(userId).all();
  },
  async create(env: Env, data: Partial<LimitedPartner>) {
    const r = await env.DB.prepare(
      `INSERT INTO limited_partners (user_id, fund_id, commitment_amount, invested_amount, returns, status)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(
      data.user_id ?? null, data.fund_id,
      data.commitment_amount ?? 0, data.invested_amount ?? 0,
      data.returns ?? 0, data.status ?? 'committed',
    ).first<LimitedPartner>();
    if (data.fund_id) await Funds.recountLPs(env, data.fund_id);
    return r;
  },
  async update(env: Env, id: number, patch: Partial<LimitedPartner>) {
    const fields: string[] = []; const vals: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (['commitment_amount', 'invested_amount', 'returns', 'status'].includes(k)) {
        fields.push(`${k} = ?`); vals.push(v);
      }
    }
    if (!fields.length) return this.getById(env, id);
    fields.push(`updated_at = datetime('now')`);
    vals.push(id);
    return env.DB.prepare(`UPDATE limited_partners SET ${fields.join(', ')} WHERE id = ? RETURNING *`)
      .bind(...vals).first<LimitedPartner>();
  },
};
