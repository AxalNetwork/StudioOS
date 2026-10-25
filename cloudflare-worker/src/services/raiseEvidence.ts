/** D891 / #2447: recorded provenance and the actual investor download gates. */
import type { Env } from '../types';
import { grantFolderScope, tierAdmits } from './dataRoomAccess';

/** Count a file only if a currently granted, active account can download it. D1103 — inside that grant's folders. */
export async function readableRoomFiles(env: Env, projectId: number): Promise<any[]> {
  const files = await env.DB.prepare('SELECT * FROM data_room_files WHERE project_id = ?').bind(projectId).all<any>();
  const grants = await env.DB.prepare(
    `SELECT g.id, g.investor_user_id,
       EXISTS (SELECT 1 FROM raise_prospects rp WHERE rp.project_id = g.project_id
         AND rp.stage = 'committed' AND LOWER(rp.email) = LOWER(u.email)) AS committed,
       EXISTS (SELECT 1 FROM pairwise_ndas n JOIN users owner ON owner.id = n.party_a_user_id
         JOIN projects p ON p.founder_id = owner.founder_id
         WHERE p.id = g.project_id AND n.party_b_user_id = g.investor_user_id AND n.status = 'active'
           AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))) AS nda_signed
     FROM data_room_grants g JOIN users u ON u.id = g.investor_user_id AND u.is_active = 1
     WHERE g.project_id = ? AND g.status = 'active'
       AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))`,
  ).bind(projectId).all<any>();
  const now = Date.now();
  const scoped = await Promise.all((grants.results || []).map(async g => ({ ...g, folders: await grantFolderScope(env, Number(g.id)) })));
  return (files.results || []).filter(f => scoped.some(g =>
    tierAdmits(f, !!g.committed, now, g.folders) && (f.visibility === 'open' || (f.visibility === 'nda' && !!g.nda_signed))));
}

export type BankFact = { id: number; fact_key: string; label: string | null; amount_cents: number | null; burn_cents: number | null; value: number | null; as_of: string };
/** Recorded Mercury facts, only while the connection and its venture relationship remain live. */
export async function mercuryFacts(env: Env, projectId: number, kind: 'runway' | 'revenue'): Promise<BankFact[]> {
  const res = await env.DB.prepare(
    `SELECT f.id, f.fact_key, f.label, f.amount_cents, f.burn_cents, f.value, f.as_of
       FROM mercury_raise_facts f JOIN integrations i ON i.id = f.integration_id
       WHERE f.project_id = ? AND f.kind = ? AND i.provider_key = 'mercury' AND i.status = 'active'
         AND EXISTS (SELECT 1 FROM projects p JOIN users u ON u.id = i.user_id AND u.is_active = 1
           WHERE p.id = f.project_id AND ((p.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
             OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id AND pm.status = 'accepted')))
       ORDER BY f.as_of DESC, f.id DESC`,
  ).bind(projectId, kind).all<BankFact>();
  return res.results || [];
}
export async function mercuryRunway(env: Env, projectId: number): Promise<BankFact | null> {
  return (await mercuryFacts(env, projectId, 'runway')).find(f => f.fact_key === 'runway') ?? null;
}

/** Verified receipts for the last complete UTC month; never relabelled as MRR. */
export async function verifiedMonthlyRevenue(env: Env, projectId: number) {
  return env.DB.prepare(
    `SELECT substr(received_on, 1, 7) AS month, SUM(amount_cents) AS cents
       FROM revenue_entries WHERE project_id = ? AND verification = 'verified' AND currency = 'usd'
         AND received_on >= date('now', 'start of month', '-1 month')
         AND received_on < date('now', 'start of month')
       GROUP BY substr(received_on, 1, 7) ORDER BY month DESC LIMIT 1`,
  ).bind(projectId).first<{ month: string; cents: number }>();
}

/** A malformed selection compares nothing; an absent legacy selection keeps its original default. */
export function selectedCheckSources(raw: string | null | undefined): string[] {
  if (raw == null) return ['deck', 'metrics'];
  try { const v: unknown = JSON.parse(raw); return Array.isArray(v) ? v.filter(k => k === 'deck' || k === 'metrics') : []; }
  catch { return []; }
}
