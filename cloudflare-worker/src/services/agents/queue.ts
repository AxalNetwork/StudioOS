/**
 * D1496 part 3 (#3843, of #3727) — the approvals queue: every proposal a team
 * agent made, in its scope, for a person to decide once.
 *
 * An agent's proposal is an `ai_rail_proposals` row with `agent_id`, under its
 * sponsor's `user_id` (part 2). The queue reads those rows by the agent's
 * scope, never by the caller's `user_id`, so the whole team sees what its
 * agents wait on. The member route (`/api/ai/rail/proposals`) is unchanged:
 * it binds `user_id`, so an agent's proposal shows there only to its sponsor.
 *
 * WHO DECIDES. The scope's manager (`canManage`, part 1's gate) or the
 * agent's sponsor. The press goes through `decideRailAs`, the one decide the
 * member route also uses: once only, atomically, the never-fill check, and
 * `decided_by_user_id`. A `proposal_decided` event follows.
 *
 * NEVER AN EMAIL, NEVER A NUMERIC USER ID: a person is `{ uid, name }`. A
 * cost or a count that cannot be read is `{ available: false }`, never 0.
 */
import type { Env, User } from '../../types';
import { chargedFor } from './agentRun';
import { moduleOf, roleOf } from './catalogue';
import { NeverFillRefusal, decideRailAs, type RailDecision, type RailProposal, type RailProposalStatus } from '../railProposals';
import { canManage, canRead, logEvent, scopeCols, scopeOfAgent, type AgentRow, type Scope, type Spend } from './teams';

export const QUEUE_PAGE = 25;
export const QUEUE_STATUSES: readonly RailProposalStatus[] = ['proposed', 'accepted', 'edited', 'discarded', 'withdrawn'];
const HEADLINE_MAX = 120;

type Person = { uid: string; name: string };

export type QueueItem = {
  uid: string;
  kind: string;
  option: string;
  module: string | null;
  headline: string;
  payload: Record<string, unknown>;
  status: RailProposalStatus;
  agent: { uid: string; role_key: string; role_name: string; first_name: string | null; last_name: string | null };
  sponsor: Person | null;
  cost: Spend;
  created_at: string;
  decided_by: Person | null;
  decided_at: string | null;
};

type QueueRow = {
  id: number; uid: string; user_id: number; kind: string; rail_option: string; record_ref: string | null;
  payload_json: string; decided_payload_json: string | null; status: RailProposalStatus; created_at: string; decided_at: string | null;
  usage_log_id: number | null; agent_id: number;
  agent_uid: string; role_key: string; first_name: string | null; last_name: string | null; sponsor_user_id: number;
  scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null;
  sponsor_uid: string | null; sponsor_name: string | null; decider_uid: string | null; decider_name: string | null;
  module: string | null; run_usage_log_id: number | null;
};


const parse = (s: string | null): Record<string, unknown> | null => {
  if (!s) return null;
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};

/** A line a person can scan: the payload's own headline, else its text's first line. */
export function headlineOf(payload: Record<string, unknown>): string {
  const own = typeof payload.headline === 'string' ? payload.headline : typeof payload.title === 'string' ? payload.title : null;
  const text = own ?? (typeof payload.text === 'string' ? payload.text : typeof payload.value === 'string' ? payload.value : '');
  const line = text.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? '';
  if (!line) return 'A proposal';
  return line.length > HEADLINE_MAX ? `${line.slice(0, HEADLINE_MAX - 1)}…` : line;
}

async function toItem(env: Env, r: QueueRow): Promise<QueueItem> {
  const payload = (r.status === 'edited' ? parse(r.decided_payload_json) : null) ?? parse(r.payload_json) ?? {};
  return {
    uid: r.uid,
    kind: r.kind,
    option: r.rail_option,
    module: r.module ?? null,
    headline: headlineOf(parse(r.payload_json) ?? {}),
    payload,
    status: r.status,
    agent: { uid: r.agent_uid, role_key: r.role_key, role_name: roleOf(r.role_key)?.name ?? r.role_key, first_name: r.first_name, last_name: r.last_name },
    sponsor: r.sponsor_uid ? { uid: r.sponsor_uid, name: r.sponsor_name ?? '' } : null,
    cost: await chargedFor(env, r.run_usage_log_id ?? r.usage_log_id ?? null),
    created_at: r.created_at,
    decided_by: r.decider_uid ? { uid: r.decider_uid, name: r.decider_name ?? '' } : null,
    decided_at: r.decided_at,
  };
}

export type QueueFilter = { role?: string | null; module?: string | null; option?: string | null; status?: RailProposalStatus | null; cursor?: number | null; includeProjects?: boolean };

/**
 * The scope's own agents' proposals, newest first. `includeProjects` (a
 * company's editors only, the caller checks) adds the agents of the projects
 * inside the company (owner authority rule, #3697).
 */
// The scope filter (written out in each statement, so the SQL guard reads it whole) binds five values:
// kind, company, project, then (include flag, company) for the projects inside it.

function scopeBinds(s: Scope, includeProjects: boolean): (string | number)[] {
  const [companyId, projectId] = scopeCols(s);
  return [s.kind, companyId ?? 0, projectId ?? 0, includeProjects && s.kind === 'company' ? 1 : 0, s.kind === 'company' ? s.id : 0];
}

export async function queueList(env: Env, s: Scope, f: QueueFilter): Promise<{ items: QueueItem[]; next_cursor: string | null }> {
  const role = f.role || null; const option = f.option || null; const status = f.status || null; const module = f.module || null;
  const cursor = f.cursor ?? null;
  const r = await env.DB.prepare(
    `SELECT p.id, p.uid, p.user_id, p.kind, p.rail_option, p.record_ref, p.payload_json, p.decided_payload_json, p.status,
         p.created_at, p.decided_at, p.usage_log_id, p.agent_id,
         a.uid AS agent_uid, a.role_key, a.first_name, a.last_name, a.sponsor_user_id, a.scope_kind, a.company_id, a.project_id,
         su.uid AS sponsor_uid, su.name AS sponsor_name, du.uid AS decider_uid, du.name AS decider_name,
         (SELECT json_extract(e.detail_json, '$.module') FROM team_agent_events e
           WHERE e.agent_id = p.agent_id AND e.proposal_uid = p.uid AND e.kind = 'run' ORDER BY e.id LIMIT 1) AS module,
         (SELECT e.usage_log_id FROM team_agent_events e
           WHERE e.agent_id = p.agent_id AND e.proposal_uid = p.uid AND e.kind = 'run' ORDER BY e.id LIMIT 1) AS run_usage_log_id
    FROM ai_rail_proposals p
    JOIN team_agents a ON a.id = p.agent_id
    LEFT JOIN users su ON su.id = a.sponsor_user_id
    LEFT JOIN users du ON du.id = p.decided_by_user_id
      WHERE p.agent_id IS NOT NULL AND ((a.scope_kind = ? AND IFNULL(a.company_id, 0) = ? AND IFNULL(a.project_id, 0) = ?)
         OR (? = 1 AND a.scope_kind = 'project' AND a.project_id IN (SELECT id FROM projects WHERE company_id = ?)))
        AND (? IS NULL OR a.role_key = ?)
        AND (? IS NULL OR p.rail_option = ?)
        AND (? IS NULL OR p.status = ?)
        AND (? IS NULL OR (SELECT json_extract(e.detail_json, '$.module') FROM team_agent_events e
                            WHERE e.agent_id = p.agent_id AND e.proposal_uid = p.uid AND e.kind = 'run' ORDER BY e.id LIMIT 1) = ?)
        AND (? IS NULL OR p.id < ?)
      ORDER BY p.id DESC LIMIT ?`,
  ).bind(...scopeBinds(s, !!f.includeProjects), role, role, option, option, status, status, module, module, cursor, cursor, QUEUE_PAGE + 1).all<QueueRow>();
  const rows = r.results ?? [];
  const page = rows.slice(0, QUEUE_PAGE);
  const items: QueueItem[] = [];
  for (const row of page) items.push(await toItem(env, row));
  return { items, next_cursor: rows.length > QUEUE_PAGE ? String(page[page.length - 1].id) : null };
}

/** The "Approvals [n]" badge and the Ask "[n] waiting" chip: the open ones under the same filter. Unreadable is never 0. */
export async function queueCount(env: Env, s: Scope, f: QueueFilter): Promise<{ available: false } | { available: true; value: number }> {
  try {
    const role = f.role || null; const option = f.option || null; const module = f.module || null;
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ai_rail_proposals p JOIN team_agents a ON a.id = p.agent_id
        WHERE p.status = 'proposed' AND ((a.scope_kind = ? AND IFNULL(a.company_id, 0) = ? AND IFNULL(a.project_id, 0) = ?)
         OR (? = 1 AND a.scope_kind = 'project' AND a.project_id IN (SELECT id FROM projects WHERE company_id = ?)))
          AND (? IS NULL OR a.role_key = ?)
          AND (? IS NULL OR p.rail_option = ?)
          AND (? IS NULL OR (SELECT json_extract(e.detail_json, '$.module') FROM team_agent_events e
                              WHERE e.agent_id = p.agent_id AND e.proposal_uid = p.uid AND e.kind = 'run' ORDER BY e.id LIMIT 1) = ?)`,
    ).bind(...scopeBinds(s, !!f.includeProjects), role, role, option, option, module, module).first<{ n: number }>();
    if (!row || row.n == null) return { available: false };
    return { available: true, value: Number(row.n) };
  } catch {
    return { available: false };
  }
}

async function rowByUid(env: Env, uid: string): Promise<QueueRow | null> {
  if (typeof uid !== 'string' || !uid || uid.length > 64) return null;
  return env.DB.prepare(`SELECT p.id, p.uid, p.user_id, p.kind, p.rail_option, p.record_ref, p.payload_json, p.decided_payload_json, p.status,
         p.created_at, p.decided_at, p.usage_log_id, p.agent_id,
         a.uid AS agent_uid, a.role_key, a.first_name, a.last_name, a.sponsor_user_id, a.scope_kind, a.company_id, a.project_id,
         su.uid AS sponsor_uid, su.name AS sponsor_name, du.uid AS decider_uid, du.name AS decider_name,
         (SELECT json_extract(e.detail_json, '$.module') FROM team_agent_events e
           WHERE e.agent_id = p.agent_id AND e.proposal_uid = p.uid AND e.kind = 'run' ORDER BY e.id LIMIT 1) AS module,
         (SELECT e.usage_log_id FROM team_agent_events e
           WHERE e.agent_id = p.agent_id AND e.proposal_uid = p.uid AND e.kind = 'run' ORDER BY e.id LIMIT 1) AS run_usage_log_id
    FROM ai_rail_proposals p
    JOIN team_agents a ON a.id = p.agent_id
    LEFT JOIN users su ON su.id = a.sponsor_user_id
    LEFT JOIN users du ON du.id = p.decided_by_user_id
    WHERE p.uid = ? AND p.agent_id IS NOT NULL`).bind(uid).first<QueueRow>();
}

const agentPart = (r: QueueRow): Pick<AgentRow, 'scope_kind' | 'company_id' | 'project_id'> => ({ scope_kind: r.scope_kind, company_id: r.company_id, project_id: r.project_id });

export type QueueRefusal = { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };
const no = (status: number, code: string, message: string, extra?: Record<string, unknown>): QueueRefusal => ({ ok: false, status, code, message, ...(extra ? { extra } : {}) });
const missing = () => no(404, 'not_found', 'There is no such proposal.');

/** What the agent read for it: read-only, named. Part 2 reads no record; part 5 adds its tool reads. */
function inputsOf(r: QueueRow): { source: string; read_only: true; summary: string }[] {
  const out: { source: string; read_only: true; summary: string }[] = [];
  const m = r.module ? moduleOf(r.module) : null;
  out.push({ source: 'request', read_only: true, summary: 'What its sponsor asked it to work on.' });
  if (m) out.push({ source: `module:${m.key}`, read_only: true, summary: `Its rule book for ${m.label}.` });
  if (r.record_ref) out.push({ source: `record:${r.record_ref}`, read_only: true, summary: `The record it was asked about (${r.record_ref}).` });
  return out;
}

/** One proposal, for anyone who can read its agent's scope. */
export async function queueItem(env: Env, user: User, uid: string): Promise<{ ok: true; item: QueueItem; inputs: ReturnType<typeof inputsOf> } | QueueRefusal> {
  const r = await rowByUid(env, uid);
  const s = r && await scopeOfAgent(env, agentPart(r));
  if (!r || !s) return missing();
  if (!(await canRead(env, s, user))) return no(403, 'not_member', 'Only the team can see its approvals.');
  return { ok: true, item: await toItem(env, r), inputs: inputsOf(r) };
}

/**
 * The press from the queue: the scope's manager or the agent's sponsor, once.
 * Throws `NeverFillRefusal` (from `decideRailAs`) for a field Eadwyn never fills.
 */
export async function queueDecide(env: Env, user: User, uid: string, decision: RailDecision, payload: Record<string, unknown> | null): Promise<{ ok: true; item: QueueItem } | QueueRefusal> {
  const r = await rowByUid(env, uid);
  const s = r && await scopeOfAgent(env, agentPart(r));
  if (!r || !s) return missing();
  if (!(await canRead(env, s, user))) return no(403, 'not_member', 'Only the team can see its approvals.');
  const sponsor = r.sponsor_user_id === user.id;
  if (!sponsor && !(await canManage(env, s, user))) return no(403, 'not_manager', 'Only the team’s editors, or the person who added this agent, can decide its proposals.');
  if (r.status !== 'proposed') return closed(env, r);
  let decided: RailProposal | null;
  try {
    decided = await decideRailAs(env, { ownerId: r.user_id, deciderId: user.id }, r.uid, decision, payload);
  } catch (e) {
    // A stored never-fill field is discarded by the press: that is still a decision, so it is logged.
    if (e instanceof NeverFillRefusal && e.discarded) {
      await logEvent(env, r.agent_id, user.id, 'proposal_decided', { decision, status: 'discarded', never_fill: true }, { proposalUid: r.uid, usageLogId: r.run_usage_log_id ?? r.usage_log_id ?? null });
    }
    throw e;
  }
  if (!decided) {
    const now = await rowByUid(env, uid);
    return now && now.status !== 'proposed' ? closed(env, now) : no(409, 'not_open', 'That proposal could not be decided.');
  }
  await logEvent(env, r.agent_id, user.id, 'proposal_decided', { decision, status: decided.status }, { proposalUid: r.uid, usageLogId: r.run_usage_log_id ?? r.usage_log_id ?? null });
  const fresh = await rowByUid(env, uid);
  return { ok: true, item: await toItem(env, fresh!) };
}

/** 409 `not_open`, naming who decided it and when (or that the platform withdrew it). */
function closed(_env: Env, r: QueueRow): QueueRefusal {
  return no(409, 'not_open', r.status === 'withdrawn' ? 'That proposal was withdrawn.' : 'Someone already decided that proposal.', {
    status: r.status,
    decided_by: r.decider_uid ? { uid: r.decider_uid, name: r.decider_name ?? '' } : null,
    decided_at: r.decided_at,
  });
}
