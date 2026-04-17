/**
 * Queue consumer — claims pending jobs and dispatches them to AI/business
 * handlers. Invoked by the cron `scheduled()` handler and by the manual
 * admin trigger POST /api/infra/process.
 *
 * Each job's outcome is logged to system_metrics so the Infrastructure tab
 * can show throughput live.
 */
import type { Env } from '../types';
import { Jobs, QueueJob } from '../models/jobs';
import { aiScoreDeal } from '../../ai-workers/scoring';
import { aiTractionReview } from '../../ai-workers/traction';
import { aiRecommendEquity } from '../../ai-workers/equity';
import { aiValueAsset, aiMatchBuyers, BuyerCandidate } from '../../ai-workers/valuation';
import { Listings, Matches } from '../models/liquidity';

async function meter(env: Env, jobType: string, status: 'completed' | 'failed', latency: number) {
  try {
    await env.DB.prepare(
      `INSERT INTO system_metrics (metric_name, value, labels) VALUES (?, ?, ?)`
    ).bind('job', 1, JSON.stringify({ job_type: jobType, status, latency_ms: latency })).run();
  } catch {}
}

async function handle(env: Env, job: QueueJob): Promise<void> {
  const payload = job.payload ? JSON.parse(job.payload) : {};
  switch (job.job_type) {
    case 'ai_scoring': {
      const result = await aiScoreDeal(env, payload);
      await env.DB.prepare(
        `INSERT INTO score_snapshots (project_id, market_score, team_score, product_score, capital_score, total_score, ai_rationale)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(payload.project_id, result.market, result.team, result.product, result.capital, result.total, result.rationale)
        .run().catch(() => {});
      return;
    }
    case 'traction_review': {
      const snaps = await env.DB.prepare(
        `SELECT metric_name, value, captured_at FROM metrics_snapshots
         WHERE scope = 'project' AND scope_id = ? ORDER BY captured_at DESC LIMIT 30`
      ).bind(payload.project_id).all<{ metric_name: string; value: number; captured_at: string }>();
      const result = await aiTractionReview(env, { project_id: payload.project_id, snapshots: snaps.results || [] });
      await env.DB.prepare(
        `INSERT INTO metrics_snapshots (scope, scope_id, metric_name, value, extra)
         VALUES ('project', ?, 'ai_momentum', ?, ?)`
      ).bind(payload.project_id, result.momentum, JSON.stringify(result)).run();
      return;
    }
    case 'spinout_processing': {
      // Move spin-out to next state if guard passes
      const subId = payload.subsidiary_id;
      const target = payload.target_status;
      if (!subId || !target) throw new Error('missing subsidiary_id/target_status');
      await env.DB.prepare(
        `UPDATE subsidiaries SET spinout_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(target, subId).run();
      return;
    }
    case 'capital_call': {
      const fundId = payload.fund_id;
      const amount = Number(payload.amount) || 0;
      if (!fundId) throw new Error('missing fund_id');
      await env.DB.prepare(
        `UPDATE vc_funds SET deployed_capital = deployed_capital + ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(amount, fundId).run();
      return;
    }
    case 'pipeline_advance': {
      const dealId = payload.deal_id;
      const stage = payload.next_stage;
      if (!dealId || !stage) throw new Error('missing deal_id/next_stage');
      await env.DB.prepare(
        `UPDATE deals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(stage, dealId).run();
      return;
    }
    case 'metrics_aggregation': {
      // Roll up project metrics into a global snapshot (lightweight example).
      const totals = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM projects WHERE created_at > datetime('now','-1 day')`
      ).first<{ n: number }>();
      await env.DB.prepare(
        `INSERT INTO metrics_snapshots (scope, scope_id, metric_name, value)
         VALUES ('global', NULL, 'projects_24h', ?)`
      ).bind(totals?.n ?? 0).run();
      return;
    }
    case 'liquidity_valuation': {
      const listingId = payload.listing_id;
      const subId = payload.subsidiary_id;
      if (!listingId || !subId) throw new Error('missing listing_id/subsidiary_id');
      const sub: any = await env.DB.prepare(
        `SELECT s.*, p.sector, p.stage FROM subsidiaries s
         LEFT JOIN projects p ON p.id = s.deal_id WHERE s.id = ?`
      ).bind(subId).first();
      const lastScore: any = await env.DB.prepare(
        `SELECT total_score FROM score_snapshots WHERE project_id = ?
         ORDER BY id DESC LIMIT 1`
      ).bind(sub?.deal_id ?? 0).first();
      const momentum: any = await env.DB.prepare(
        `SELECT value FROM metrics_snapshots WHERE scope='project' AND scope_id=? AND metric_name='ai_momentum'
         ORDER BY id DESC LIMIT 1`
      ).bind(sub?.deal_id ?? 0).first();
      const result = await aiValueAsset(env, {
        subsidiary_id: subId,
        subsidiary_name: sub?.subsidiary_name,
        deal_id: sub?.deal_id,
        sector: sub?.sector,
        stage: sub?.stage,
        total_score: lastScore?.total_score,
        momentum: momentum?.value,
      });
      await Listings.updateValuation(env, listingId, result.valuation_cents);
      return;
    }
    case 'liquidity_matching': {
      const listingId = payload.listing_id;
      if (!listingId) throw new Error('missing listing_id');
      const listing = await Listings.getById(env, listingId);
      if (!listing) throw new Error(`listing ${listingId} not found`);
      const subRow: any = await env.DB.prepare(
        `SELECT s.subsidiary_name, p.sector FROM subsidiaries s
         LEFT JOIN projects p ON p.id = s.deal_id WHERE s.id = ?`
      ).bind(listing.subsidiary_id).first();
      // Candidates: any partner + any LP user (excluding the seller themself).
      const cands = await env.DB.prepare(
        `SELECT u.id AS user_id, u.email, u.name, u.role,
                COALESCE(SUM(lp.commitment_amount - lp.invested_amount), 0) AS available_capital
           FROM users u LEFT JOIN limited_partners lp ON lp.user_id = u.id
          WHERE u.id != ? AND (u.role = 'partner' OR lp.id IS NOT NULL)
          GROUP BY u.id LIMIT 50`
      ).bind(listing.user_id).all<{ user_id: number; email: string; name: string; role: any; available_capital: number }>();
      const candidates: BuyerCandidate[] = (cands.results || []).map(r => ({
        user_id: r.user_id,
        email: r.email,
        name: r.name,
        role: r.role,
        available_capital_cents: Math.round((r.available_capital || 0) * 100),
        preferred_sectors: subRow?.sector ? [subRow.sector] : [],
      }));
      const matches = await aiMatchBuyers(env, {
        id: listing.id,
        subsidiary_name: subRow?.subsidiary_name,
        sector: subRow?.sector,
        shares: listing.shares,
        asking_price_cents: listing.asking_price_cents,
        ai_valuation_cents: listing.ai_valuation_cents,
      }, candidates, 5);
      await Matches.insertMany(env, listing.id, matches);
      if (matches.length) await Listings.markMatched(env, listing.id);
      return;
    }
    default:
      throw new Error(`unknown job type ${job.job_type}`);
  }
}

// AI calls are expensive — cap per drain so a backlog doesn't burn the AI quota.
const AI_JOB_TYPES = new Set(['ai_scoring', 'traction_review', 'liquidity_valuation', 'liquidity_matching']);
const MAX_AI_PER_DRAIN = 5;

export async function processQueueBatch(env: Env, batchSize = 10): Promise<{ processed: number; failed: number; deferred: number }> {
  const jobs = await Jobs.claimBatch(env, batchSize);
  let processed = 0, failed = 0, deferred = 0, aiUsed = 0;
  for (const job of jobs) {
    // AI budget enforcement: defer extra AI jobs back to pending so they run next minute.
    if (AI_JOB_TYPES.has(job.job_type) && aiUsed >= MAX_AI_PER_DRAIN) {
      await env.DB.prepare(
        `UPDATE queue_jobs SET status='pending', attempts = attempts - 1, started_at = NULL, updated_at = datetime('now') WHERE id = ?`
      ).bind(job.id).run().catch(() => {});
      deferred++;
      continue;
    }
    if (AI_JOB_TYPES.has(job.job_type)) aiUsed++;

    const t0 = Date.now();
    try {
      await handle(env, job);
      await Jobs.markCompleted(env, job.id);
      processed++;
      await meter(env, job.job_type, 'completed', Date.now() - t0);
    } catch (e: any) {
      failed++;
      await Jobs.markFailed(env, job.id, String(e?.message || e));
      await meter(env, job.job_type, 'failed', Date.now() - t0);
    }
  }
  return { processed, failed, deferred };
}

/** Lightweight equity helper for the spin-out flow. */
export async function recommendEquityForSpinout(env: Env, subsidiaryId: number) {
  const sub: any = await env.DB.prepare(`SELECT * FROM subsidiaries WHERE id = ?`).bind(subsidiaryId).first();
  if (!sub) throw new Error('subsidiary not found');
  // Minimal contributor list (extend with real founders/partners join when wired).
  const contributors = [
    { name: 'Axal Studio', role: 'studio' as const, impact_tier: 1 as const },
    { name: 'Founders', role: 'founder' as const, impact_tier: 1 as const },
  ];
  return aiRecommendEquity(env, contributors, { spinout_name: sub.subsidiary_name });
}
