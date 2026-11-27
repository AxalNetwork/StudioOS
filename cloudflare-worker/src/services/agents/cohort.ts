/** HQ's opt-in agent cohort, read by both runtimes' admission gate (D4423, #4423). */
import type { Env } from '../../types';
import type { ScopeRef } from '../../agents/runtime';
import { aiAdminAuditStatement } from './adminAudit';

export type CohortKind = 'user' | 'company' | 'project';
export class CohortError extends Error {
  status: 400 | 404;
  constructor(status: 400 | 404, message: string) { super(message); this.status = status; }
}
/** A scope-only automated start needs an explicit scope entry; no actor is inferred. */
export async function inCohort(env: Env, by: number | null, scope?: ScopeRef) {
  const hit = await env.DB.prepare(`SELECT 1 AS ok FROM agent_engine_cohort c
    WHERE (c.kind = 'user' AND c.target_id = ? AND EXISTS
      (SELECT 1 FROM users u WHERE u.id = c.target_id AND u.is_active = 1 AND u.deletion_requested_at IS NULL))
    OR (c.kind = ? AND c.target_id = ? AND
      ((c.kind = 'project' AND EXISTS (SELECT 1 FROM projects p WHERE p.id = c.target_id AND p.deleted_at IS NULL))
      OR (c.kind = 'company' AND EXISTS (SELECT 1 FROM company_profiles p WHERE p.id = c.target_id AND p.archived_at IS NULL)))) LIMIT 1`)
    .bind(by, scope?.kind ?? '', scope?.id ?? 0).first();
  return !!hit;
}
export async function cohortList(env: Env) {
  const rows = (await env.DB.prepare(`SELECT c.uid, c.kind, c.created_at,
      CASE c.kind WHEN 'user' THEN u.name WHEN 'project' THEN p.name ELSE co.company_name END AS name,
      CASE c.kind WHEN 'user' THEN u.uid WHEN 'project' THEN CAST(p.id AS TEXT) ELSE co.uid END AS target
    FROM agent_engine_cohort c
    LEFT JOIN users u ON c.kind = 'user' AND u.id = c.target_id AND u.is_active = 1 AND u.deletion_requested_at IS NULL
    LEFT JOIN projects p ON c.kind = 'project' AND p.id = c.target_id AND p.deleted_at IS NULL
    LEFT JOIN company_profiles co ON c.kind = 'company' AND co.id = c.target_id AND co.archived_at IS NULL
    ORDER BY c.created_at, c.uid LIMIT 1001`).all<{uid:string;kind:CohortKind;created_at:string;name:string|null;target:string|null}>()).results ?? [];
  return { entries: rows.slice(0,1000), has_more:rows.length > 1000 };
}
/** Email is input only, never a response, subject or audit value. */
export async function addToCohort(env: Env, actorId: number, input: unknown) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string,unknown> : {};
  let kind: CohortKind, target: number;
  if (typeof b.email === 'string' && b.scope == null) {
    const email=b.email.trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CohortError(400,'Enter a valid founder email.');
    const found=(await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ? AND role = 'founder' AND is_active = 1 AND deletion_requested_at IS NULL LIMIT 2")
      .bind(email).all<{id:number}>()).results ?? [];
    if(found.length!==1) throw new CohortError(404,'No active founder matches that email.');
    kind='user';target=found[0].id;
  } else if (b.email == null && b.scope && typeof b.scope === 'object') {
    const s=b.scope as Record<string,unknown>; target=Number(s.id);
    if((s.kind!=='project'&&s.kind!=='company')||!Number.isSafeInteger(target)||target<=0) throw new CohortError(400,'Choose a valid project or company scope.');
    kind=s.kind;
    const row=kind==='project' ? await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(target).first()
      : await env.DB.prepare('SELECT id FROM company_profiles WHERE id = ? AND archived_at IS NULL').bind(target).first();
    if(!row) throw new CohortError(404,'That scope is unavailable.');
  } else throw new CohortError(400,'Add a founder email or one scope.');
  const subject=`${kind}:${target}`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO agent_engine_cohort (uid, kind, target_id, added_by) VALUES (?, ?, ?, ?) ON CONFLICT(kind, target_id) DO NOTHING')
      .bind(crypto.randomUUID(),kind,target,actorId),
    aiAdminAuditStatement(env,{adminUserId:actorId,action:'cohort.add',area:'policy',subject,after:{kind,target_id:target},reason:'HQ added an opt-in cohort member.'}),
  ]);
  return {ok:true};
}
export async function removeFromCohort(env: Env, actorId:number, uid:string) {
  const row=await env.DB.prepare('SELECT kind, target_id FROM agent_engine_cohort WHERE uid = ?').bind(uid).first<{kind:CohortKind;target_id:number}>();
  if(!row) throw new CohortError(404,'That cohort entry is no longer listed.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM agent_engine_cohort WHERE uid = ?').bind(uid),
    aiAdminAuditStatement(env,{adminUserId:actorId,action:'cohort.remove',area:'policy',subject:`${row.kind}:${row.target_id}`,before:row,reason:'HQ removed an opt-in cohort member.'}),
  ]);
  return {ok:true};
}
