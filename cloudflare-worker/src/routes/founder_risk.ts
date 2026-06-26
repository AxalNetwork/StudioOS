/**
 * Task #1 (AG) — Founder Risk surface.
 *
 * Mounted at /api/founder-risk. Privileged read for admin/partner/investor;
 * founders may read their OWN risk row only. Pull/recompute is admin-only.
 *
 * Endpoints:
 *   GET  /by-deal/:dealId        — latest pull for the deal's founder
 *   GET  /by-founder/:founderId  — latest pull for a founder
 *   POST /:founderId/pull        — refresh / record a new pull (admin)
 *   POST /:founderId/recompute   — recompute the cached score (admin)
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, canAccessFounderResource } from '../auth';

const founderRisk = new Hono<{ Bindings: Env }>();

type Pull = {
  id: number;
  founder_id: number;
  score: number | null;
  signals_json: string | null;
  source: string | null;
  pulled_by: number | null;
  created_at: string;
};

function isPrivileged(role: User['role']): boolean {
  // Investor removed from the read-allowlist per the IDOR contract (matches
  // progress.ts / financials.ts — audit M2). Founder-risk pulls are raw,
  // un-masked signals about a founder; an investor reading them across
  // founders would be a cross-founder IDOR. NDA-gated investor access would be
  // a future masked feature, not a blanket read.
  return role === 'admin' || role === 'partner';
}

async function loadFounderId(env: Env, founderId: number): Promise<{ id: number } | null> {
  return env.DB.prepare('SELECT id FROM founders WHERE id = ?').bind(founderId).first<{ id: number }>();
}

async function latestPull(env: Env, founderId: number): Promise<Pull | null> {
  return env.DB.prepare(
    'SELECT * FROM founder_risk_pulls WHERE founder_id = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(founderId).first<Pull>();
}

type SerializedPull = {
  founder_id: number;
  score: number | null;
  signals: unknown;
  source: string | null;
  pulled_at: string | null;
};

function serialize(p: Pull | null, founderId: number): SerializedPull {
  if (!p) {
    return {
      founder_id: founderId,
      score: null,
      signals: [],
      source: null,
      pulled_at: null,
    };
  }
  let signals: unknown = [];
  try { signals = p.signals_json ? JSON.parse(p.signals_json) : []; } catch { signals = []; }
  return {
    founder_id: p.founder_id,
    score: p.score,
    signals,
    source: p.source,
    pulled_at: p.created_at,
  };
}

function ensureCanRead(user: User, founderId: number): boolean {
  if (isPrivileged(user.role)) return true;
  if (user.role === 'founder') {
    return canAccessFounderResource(user, founderId);
  }
  return false;
}

founderRisk.get('/by-deal/:dealId', async (c) => {
  const user = await requireAuth(c);
  const dealId = Number(c.req.param('dealId'));
  if (!Number.isFinite(dealId)) return c.json({ detail: 'Invalid deal_id' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT p.founder_id FROM deals d JOIN projects p ON p.id = d.project_id WHERE d.id = ?',
  ).bind(dealId).first<{ founder_id: number | null }>();
  if (!row || row.founder_id == null) return c.json({ detail: 'Deal or founder not found' }, 404);
  if (!ensureCanRead(user, row.founder_id)) return c.json({ detail: 'Forbidden' }, 403);
  const pull = await latestPull(c.env, row.founder_id);
  return c.json(serialize(pull, row.founder_id));
});

founderRisk.get('/by-founder/:founderId', async (c) => {
  const user = await requireAuth(c);
  const founderId = Number(c.req.param('founderId'));
  if (!Number.isFinite(founderId)) return c.json({ detail: 'Invalid founder_id' }, 400);
  if (!ensureCanRead(user, founderId)) return c.json({ detail: 'Forbidden' }, 403);
  const founder = await loadFounderId(c.env, founderId);
  if (!founder) return c.json({ detail: 'Founder not found' }, 404);
  const pull = await latestPull(c.env, founderId);
  return c.json(serialize(pull, founderId));
});

founderRisk.post('/:founderId/pull', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ detail: 'Admin only' }, 403);
  const founderId = Number(c.req.param('founderId'));
  if (!Number.isFinite(founderId)) return c.json({ detail: 'Invalid founder_id' }, 400);
  const founder = await loadFounderId(c.env, founderId);
  if (!founder) return c.json({ detail: 'Founder not found' }, 404);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const score = body?.score != null && Number.isFinite(Number(body.score)) ? Number(body.score) : null;
  const signalsJson = JSON.stringify(Array.isArray(body?.signals) ? body.signals : []);
  const source = body?.source ? String(body.source).slice(0, 80) : 'manual';
  await c.env.DB.prepare(
    `INSERT INTO founder_risk_pulls (founder_id, score, signals_json, source, pulled_by, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(founderId, score, signalsJson, source, user.id).run();
  const pull = await latestPull(c.env, founderId);
  return c.json(serialize(pull, founderId));
});

founderRisk.post('/:founderId/recompute', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ detail: 'Admin only' }, 403);
  const founderId = Number(c.req.param('founderId'));
  if (!Number.isFinite(founderId)) return c.json({ detail: 'Invalid founder_id' }, 400);
  const founder = await loadFounderId(c.env, founderId);
  if (!founder) return c.json({ detail: 'Founder not found' }, 404);
  // Recompute is a no-op placeholder until the scoring pipeline is wired.
  // Re-issue the latest signals as a fresh pull so the cache timestamp moves.
  const last = await latestPull(c.env, founderId);
  await c.env.DB.prepare(
    `INSERT INTO founder_risk_pulls (founder_id, score, signals_json, source, pulled_by, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(founderId, last?.score ?? null, last?.signals_json ?? '[]', 'recompute', user.id).run();
  const pull = await latestPull(c.env, founderId);
  return c.json(serialize(pull, founderId));
});

export default founderRisk;
