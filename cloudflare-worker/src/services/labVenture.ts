/**
 * D4659 (#4659) — the venture a Spin-Out Lab enrollment is about.
 *
 * WHY. "The Lab project" was picked four different ways: the frontend took the
 * founder's oldest owned project, Eadwyn's write router the newest, the
 * certificate the lowest id, and the grow checklist refused when there were
 * two. A founder with an older or unrelated project could see one company in
 * the workspace, prove milestones with another and graduate as a third.
 *
 * THE RULE. `spinout_lab_enrollments.project_id` is the venture. It is set:
 *   - automatically, only when the founder owns exactly one live project
 *     (`bound_single_project`);
 *   - by the founder choosing among their own live projects (`chosen`), when
 *     there are several or the bound project was deleted;
 *   - by migration 202611071800 from an issued credential.
 * Each change is an `spinout_lab_enrollment_events` row. A bound, live venture
 * is never switched silently: choosing again is refused while it stands.
 *
 *   resolveVenture → bound | none (no project yet) | needs_choice (several,
 *                    unbound) | deleted (the bound project was deleted)
 *
 * Evidence (labEvidence.ts), the certificate facts, the public graduate list
 * and the tools all read this one answer. Never logs a value.
 */
import type { Env } from '../types';

export type VentureProject = { id: number; uid: string | null; name: string | null };
export type Venture =
  | { status: 'bound'; enrollment_id: number; project: VentureProject }
  | { status: 'none'; enrollment_id: number | null }
  | { status: 'needs_choice'; enrollment_id: number; choices: VentureProject[] }
  | { status: 'deleted'; enrollment_id: number; project_id: number; choices: VentureProject[] };

async function ownedProjects(env: Env, userId: number): Promise<VentureProject[]> {
  const r = await env.DB.prepare(
    `SELECT p.id, p.uid, p.name FROM projects p JOIN users u ON u.founder_id = p.founder_id
      WHERE u.id = ? AND u.founder_id IS NOT NULL AND p.deleted_at IS NULL ORDER BY p.id`,
  ).bind(userId).all<VentureProject>();
  return (r.results || []).map((p) => ({ id: Number(p.id), uid: p.uid ?? null, name: p.name ?? null }));
}

async function recordEvent(env: Env, enrollmentId: number, userId: number, event: string, projectId: number | null, actor: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO spinout_lab_enrollment_events (enrollment_id, user_id, event, project_id, actor) VALUES (?, ?, ?, ?, ?)`,
  ).bind(enrollmentId, userId, event, projectId, actor).run();
}

/** The founder's venture. Binds the only owned project when none is bound. Throws when unreadable. */
export async function resolveVenture(env: Env, userId: number): Promise<Venture> {
  const e = await env.DB.prepare(
    `SELECT id, project_id FROM spinout_lab_enrollments WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(userId).first<{ id: number; project_id: number | null }>();
  const owned = await ownedProjects(env, userId);
  if (!e) return { status: 'none', enrollment_id: null };
  if (e.project_id !== null && e.project_id !== undefined) {
    const p = owned.find((x) => x.id === Number(e.project_id));
    if (p) return { status: 'bound', enrollment_id: Number(e.id), project: p };
    return { status: 'deleted', enrollment_id: Number(e.id), project_id: Number(e.project_id), choices: owned };
  }
  if (owned.length === 0) return { status: 'none', enrollment_id: Number(e.id) };
  if (owned.length > 1) return { status: 'needs_choice', enrollment_id: Number(e.id), choices: owned };
  // Exactly one live project: bind it, once (a racing bind writes nothing).
  const only = owned[0];
  const up = await env.DB.prepare(
    `UPDATE spinout_lab_enrollments SET project_id = ? WHERE id = ? AND project_id IS NULL`,
  ).bind(only.id, e.id).run();
  if (Number(up.meta?.changes ?? 0) === 1) await recordEvent(env, Number(e.id), userId, 'bound_single_project', only.id, 'system');
  return resolveVenture(env, userId);
}

export type ChooseOutcome =
  | { ok: true; venture: Venture }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string };

/** The founder names their venture among their own live projects. */
export async function chooseVenture(env: Env, userId: number, projectId: number, actor: string): Promise<ChooseOutcome> {
  if (!Number.isInteger(projectId) || projectId <= 0) return { ok: false, status: 400, code: 'project_id_required', error: 'Choose one of your projects.' };
  const v = await resolveVenture(env, userId);
  if (v.status === 'bound') {
    return { ok: false, status: 409, code: 'venture_bound', error: 'Your Lab venture is already recorded. Contact the programme team to change it.' };
  }
  if (v.enrollment_id === null) return { ok: false, status: 404, code: 'not_enrolled', error: 'There is no Lab enrollment to attach a venture to.' };
  const choices = v.status === 'none' ? await ownedProjects(env, userId) : v.choices;
  if (!choices.some((p) => p.id === projectId)) {
    return { ok: false, status: 404, code: 'project_not_owned', error: 'That project is not one of yours.' };
  }
  // A deleted venture is replaced; an unbound one is set. Never a live one.
  const up = await env.DB.prepare(
    `UPDATE spinout_lab_enrollments SET project_id = ?
      WHERE id = ? AND (project_id IS NULL OR project_id NOT IN (SELECT id FROM projects WHERE deleted_at IS NULL))`,
  ).bind(projectId, v.enrollment_id).run();
  if (Number(up.meta?.changes ?? 0) !== 1) {
    return { ok: false, status: 409, code: 'venture_bound', error: 'Your Lab venture changed meanwhile. Refresh and check it.' };
  }
  await recordEvent(env, v.enrollment_id, userId, 'chosen', projectId, actor);
  return { ok: true, venture: await resolveVenture(env, userId) };
}

/** The project id evidence may count: the bound venture; -1 (none) while a choice is pending; null before any project. */
export function evidenceProjectId(v: Venture): number | null {
  if (v.status === 'bound') return v.project.id;
  if (v.status === 'needs_choice' || v.status === 'deleted') return -1;
  return null;
}
