/**
 * D8775 (#8775): who may own, build and review a Build must-have or roadmap item, and the address a test returns.
 *
 * WHO MAY OWN (Q1, option A, drawn by the canvas and built pending the owner's answer): the project's
 * Team as #3994 lists it (`teamRoster.assignable`: accepted `project_members` and the founder-owner),
 * plus the company's linked members, who could always own one. Before this, only `user_company_links`
 * counted, so a project whose team had no company link said "No member to choose yet."
 *
 * WHO MAY BUILD (Q2, option A): a person, or one of the project's own ACTIVE agents with a named person
 * reviewing. The agent only drafts; opening Lovable, linking, testing and offering to Pitch stay with
 * people, so nothing here lets an agent be an owner or a reviewer.
 *
 * Bound SQL only; no email is read.
 */
import type { Env } from '../types';

export type Choice = { value: string; label: string };

/** The project's team people and its company's members, each once, by name. */
export async function ownerChoices(env: Env, projectId: number): Promise<Choice[]> {
  const rows = await env.DB.prepare(
    `SELECT u.id, u.name FROM users u
      WHERE u.is_active = 1 AND (
        u.id IN (SELECT pm.user_id FROM project_members pm WHERE pm.project_id = ? AND pm.status = 'accepted')
        OR (u.role = 'founder' AND u.founder_id IS NOT NULL AND u.founder_id = (SELECT founder_id FROM projects WHERE id = ?))
        OR u.id IN (SELECT l.user_id FROM user_company_links l JOIN projects p ON p.company_id = l.company_id WHERE p.id = ?))
      ORDER BY lower(u.name), u.id`,
  ).bind(projectId, projectId, projectId).all<{ id: number; name: string | null }>();
  return (rows.results ?? []).map((u) => ({ value: String(u.id), label: u.name ?? 'Unnamed member' }));
}

/** Whether a person may own or review this project's Build work (the same people `ownerChoices` lists). */
export async function mayOwn(env: Env, projectId: number, userId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM users u
      WHERE u.id = ? AND u.is_active = 1 AND (
        EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = ? AND pm.user_id = u.id AND pm.status = 'accepted')
        OR (u.role = 'founder' AND u.founder_id IS NOT NULL AND u.founder_id = (SELECT founder_id FROM projects WHERE id = ?))
        OR EXISTS (SELECT 1 FROM user_company_links l JOIN projects p ON p.company_id = l.company_id WHERE p.id = ? AND l.user_id = u.id))`,
  ).bind(userId, projectId, projectId, projectId).first();
  return !!row;
}

/** The project's own active agents, the builders a must-have may name. A paused agent builds nothing. */
export async function agentChoices(env: Env, projectId: number): Promise<Choice[]> {
  const rows = await env.DB.prepare(
    `SELECT id, first_name, last_name, role_key FROM team_agents
      WHERE scope_kind = 'project' AND project_id = ? AND status = 'active' ORDER BY id`,
  ).bind(projectId).all<{ id: number; first_name: string | null; last_name: string | null; role_key: string }>();
  return (rows.results ?? []).map((a) => ({ value: String(a.id), label: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.role_key }));
}

export async function isProjectAgent(env: Env, projectId: number, agentId: number): Promise<boolean> {
  return !!await env.DB.prepare(
    "SELECT 1 FROM team_agents WHERE id = ? AND scope_kind = 'project' AND project_id = ? AND status = 'active'",
  ).bind(agentId, projectId).first();
}

/** Why an owner list is empty, and where to add someone: the form shows it in place of "No member". */
export const NO_OWNER_NOTE = 'No one can own this yet: an owner is someone on this project’s team or in its company. Save it without an owner, or add a teammate and come back.';
export const ownerNote = (projectId: number) => ({ text: NO_OWNER_NOTE, href: `/projects/${projectId}/settings/team`, link: 'Add a teammate' });

/**
 * A test session's deliverable: an https address with no credentials, port or control character,
 * at most 1000 characters. `undefined` when the body names none; `false` when it is not one.
 */
export function deliverableUrl(raw: unknown): string | null | undefined | false {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.trim().length > 1000 || /[\u0000-\u001f\u007f\s]/.test(raw.trim())) return false;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.')) return false;
  return u.toString();
}

/**
 * The stage a must-have's proof has reached, from its own sessions (#8775, BLV00). Each word says
 * what certifies it:
 *   - `tested`: a done session that kept a finding;
 *   - `returned`: a session holds a deliverable address, and no done session kept a finding;
 *   - `none`: neither.
 * An address alone is never Tested.
 */
export type ProofStage = 'tested' | 'returned' | 'none';
export function proofStage(sessions: Array<{ status: string; deliverable_url: string | null; kept: number }>): ProofStage {
  if (sessions.some((s) => s.status === 'done' && Number(s.kept) > 0)) return 'tested';
  if (sessions.some((s) => typeof s.deliverable_url === 'string' && s.deliverable_url !== '')) return 'returned';
  return 'none';
}
