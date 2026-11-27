/**
 * Liquidity / secondary-market model layer (D1 helpers).
 * All money values are integer cents.
 */
import type { Env } from '../types';

export interface LiquidityEvent {
  id: number;
  subsidiary_id: number | null;
  deal_id: number | null;
  event_type: 'secondary_sale' | 'm&a_exit' | 'ipo_prep' | 'distribution';
  status: 'listed' | 'matched' | 'executed' | 'cancelled';
  valuation_cents: number;
  shares_offered: number;
  buyer_type: string | null;
  executed_price_cents: number | null;
  metadata: string | null;
  created_at: string;
  executed_at: string | null;
}

export interface SecondaryListing {
  id: number;
  user_id: number;
  subsidiary_id: number;
  shares: number;
  asking_price_cents: number;
  ai_valuation_cents: number | null;
  status: 'open' | 'matched' | 'sold' | 'cancelled';
  notes: string | null;
  created_at: string;
  matched_at: string | null;
  sold_at: string | null;
}

export interface ExitMatch {
  id: number;
  listing_id: number;
  buyer_user_id: number | null;
  buyer_type: string;
  match_score: number;
  ai_explanation: string | null;
  status: 'proposed' | 'accepted' | 'rejected' | 'executed';
  proposed_price_cents: number | null;
  created_at: string;
  decided_at: string | null;
}

export const LiquidityEvents = {
  async create(env: Env, data: Partial<LiquidityEvent>) {
    return env.DB.prepare(
      `INSERT INTO liquidity_events
        (subsidiary_id, deal_id, event_type, status, valuation_cents, shares_offered, buyer_type, executed_price_cents, metadata)
       VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`
    ).bind(
      data.subsidiary_id ?? null, data.deal_id ?? null,
      data.event_type, data.status ?? 'listed',
      data.valuation_cents ?? 0, data.shares_offered ?? 0,
      data.buyer_type ?? null, data.executed_price_cents ?? null,
      data.metadata ?? null,
    ).first<LiquidityEvent>();
  },
  async markExecuted(env: Env, id: number, executedPriceCents: number, buyerType: string) {
    return env.DB.prepare(
      `UPDATE liquidity_events SET status='executed', executed_price_cents=?, buyer_type=?, executed_at=datetime('now')
       WHERE id=? RETURNING *`
    ).bind(executedPriceCents, buyerType, id).first<LiquidityEvent>();
  },
  async listRecent(env: Env, limit = 50) {
    const r = await env.DB.prepare(
      `SELECT * FROM liquidity_events ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all<LiquidityEvent>();
    return r.results || [];
  },
};

export const Listings = {
  async getById(env: Env, id: number) {
    return env.DB.prepare(`SELECT * FROM secondary_listings WHERE id = ?`).bind(id).first<SecondaryListing>();
  },
  async create(env: Env, data: Partial<SecondaryListing>) {
    return env.DB.prepare(
      `INSERT INTO secondary_listings
        (user_id, subsidiary_id, shares, asking_price_cents, ai_valuation_cents, notes, status)
       VALUES (?,?,?,?,?,?,'open') RETURNING *`
    ).bind(
      data.user_id, data.subsidiary_id, data.shares,
      data.asking_price_cents, data.ai_valuation_cents ?? null, data.notes ?? null,
    ).first<SecondaryListing>();
  },
  async updateValuation(env: Env, id: number, valuationCents: number) {
    await env.DB.prepare(
      `UPDATE secondary_listings SET ai_valuation_cents = ? WHERE id = ?`
    ).bind(valuationCents, id).run();
  },
  async markMatched(env: Env, id: number) {
    await env.DB.prepare(
      `UPDATE secondary_listings SET status='matched', matched_at=datetime('now')
       WHERE id = ? AND status = 'open'`
    ).bind(id).run();
  },
  async markSold(env: Env, id: number) {
    await env.DB.prepare(
      `UPDATE secondary_listings SET status='sold', sold_at=datetime('now')
       WHERE id = ? AND status IN ('open','matched')`
    ).bind(id).run();
  },
  async openMarketplace(env: Env, limit = 100) {
    const r = await env.DB.prepare(
      `SELECT l.*, s.subsidiary_name, s.jurisdiction, p.sector,
              u.name AS seller_name, u.email AS seller_email
         FROM secondary_listings l
         JOIN subsidiaries s ON s.id = l.subsidiary_id
         LEFT JOIN projects p ON p.id = s.deal_id
         LEFT JOIN users u ON u.id = l.user_id
        WHERE l.status IN ('open','matched')
          AND l.shares > 0
          AND l.asking_price_cents > 0
        ORDER BY l.created_at DESC LIMIT ?`
    ).bind(limit).all();
    return r.results || [];
  },
  async listByUser(env: Env, userId: number) {
    const r = await env.DB.prepare(
      `SELECT l.*, s.subsidiary_name FROM secondary_listings l
         JOIN subsidiaries s ON s.id = l.subsidiary_id
        WHERE l.user_id = ? ORDER BY l.created_at DESC`
    ).bind(userId).all();
    return r.results || [];
  },
};

export const Matches = {
  async insertMany(env: Env, listingId: number, items: Array<Partial<ExitMatch>>) {
    if (!items.length) return;
    const stmts = items.map(m =>
      env.DB.prepare(
        `INSERT INTO exit_matches (listing_id, buyer_user_id, buyer_type, match_score, ai_explanation, proposed_price_cents)
         VALUES (?,?,?,?,?,?)`
      ).bind(listingId, m.buyer_user_id ?? null, m.buyer_type ?? 'lp_rollover',
             m.match_score ?? 0, m.ai_explanation ?? null, m.proposed_price_cents ?? null)
    );
    await env.DB.batch(stmts);
  },
  async forListing(env: Env, listingId: number) {
    const r = await env.DB.prepare(
      `SELECT m.*, u.email AS buyer_email, u.name AS buyer_name
         FROM exit_matches m LEFT JOIN users u ON u.id = m.buyer_user_id
        WHERE m.listing_id = ? ORDER BY m.match_score DESC`
    ).bind(listingId).all();
    return r.results || [];
  },
  async clearForListing(env: Env, listingId: number) {
    await env.DB.prepare(`DELETE FROM exit_matches WHERE listing_id = ? AND status = 'proposed'`).bind(listingId).run();
  },
};
