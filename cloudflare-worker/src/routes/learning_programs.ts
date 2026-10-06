/**
 * D558 (#1159) — Learning programs, member and assigned-admin side. Mounted at
 * /api/learning beside `learning.ts`.
 *
 *   GET  /programs                       published programs open to self-enrolment, and whether the caller is in each
 *   GET  /programs/enrolled              the caller's own programs
 *   GET  /programs/mine                  the programs the caller is assigned to follow (the Super Admin: every program)
 *   POST /programs/:uid/enrol            self-enrol, into a published open program only
 *   GET  /programs/:uid                  a program and its contents, with the caller's own completion when enrolled
 *   GET  /programs/:uid/learners         read-only: each enrolled learner's completion of each content item
 *   GET  /programs/:uid/learners/:userUid
 *
 * THE LEARNER VIEW IS READ-ONLY AND ASSIGNED. Only an admin assigned to the
 * program, or the Super Admin, reads its learners; any other admin gets 403.
 * Learners are named by name and uid, never by email.
 *
 * A PROGRAM THE CALLER CANNOT SEE IS NOT FOUND. A draft or archived program,
 * or an invite-only one the caller is not in or assigned to, answers 404 on
 * the detail read, so its uid is not confirmed to exist.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { isAssignedAdmin } from '../services/learningAccess';
import {
  PROGRAM_COLS, P_COLS, programView, programContents, describeContents, programLearners, completionFor, type ProgramRow,
} from '../services/learningPrograms';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

async function auth(c: C): Promise<any | Response> {
  try { return await requireAuth(c); } catch (e) { return mapError(c, e); }
}

const byUid = (env: Env, uid: string) =>
  env.DB.prepare('SELECT ' + PROGRAM_COLS + ' FROM learning_programs WHERE uid = ?').bind(uid).first<ProgramRow>();

const enrolmentOf = (env: Env, programId: number, userId: number) =>
  env.DB.prepare('SELECT status, enrolled_at FROM learning_enrollments WHERE program_id = ? AND user_id = ?')
    .bind(programId, userId).first<{ status: string; enrolled_at: string }>();

r.get('/programs', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const res = await c.env.DB.prepare(
    `SELECT ${P_COLS},
            (SELECT e.status FROM learning_enrollments e WHERE e.program_id = p.id AND e.user_id = ?) AS my_status
       FROM learning_programs p WHERE p.status = 'published' AND p.enrolment = 'open'
      ORDER BY p.name COLLATE NOCASE, p.id LIMIT 200`,
  ).bind(user.id).all<any>();
  return c.json({ programs: (res.results || []).map((p) => ({ ...programView(p), enrolled: p.my_status === 'active' })) });
});

r.get('/programs/enrolled', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const res = await c.env.DB.prepare(
    `SELECT ${P_COLS}, e.enrolled_at
       FROM learning_enrollments e JOIN learning_programs p ON p.id = e.program_id
      WHERE e.user_id = ? AND e.status = 'active' AND p.status = 'published'
      ORDER BY p.name COLLATE NOCASE, p.id`,
  ).bind(user.id).all<any>();
  return c.json({ programs: (res.results || []).map((p) => ({ ...programView(p), enrolled_at: p.enrolled_at })) });
});

r.get('/programs/mine', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const sa = isSuperAdmin(user);
  if (!sa && String(user.role ?? '').toLowerCase() !== 'admin') {
    return refuse(c, 403, { code: 'admins_only', message: 'Programs are assigned to admins.' });
  }
  const res = await c.env.DB.prepare(
    `SELECT ${P_COLS},
            (SELECT COUNT(*) FROM learning_enrollments e WHERE e.program_id = p.id AND e.status = 'active') AS learners,
            (SELECT COUNT(*) FROM learning_program_contents pc WHERE pc.program_id = p.id) AS contents
       FROM learning_programs p
      WHERE ? = 1 OR p.id IN (SELECT program_id FROM learning_program_admins WHERE user_id = ?)
      ORDER BY p.name COLLATE NOCASE, p.id LIMIT 500`,
  ).bind(sa ? 1 : 0, user.id).all<any>();
  return c.json({
    programs: (res.results || []).map((p) => ({ ...programView(p), learners: Number(p.learners), contents: Number(p.contents) })),
  });
});

r.post('/programs/:uid/enrol', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const p = await byUid(c.env, c.req.param('uid') ?? '');
  if (!p || p.status !== 'published') return refuse(c, 404, { code: 'not_found', message: 'No such program.' });
  const mine = await enrolmentOf(c.env, p.id, user.id);
  if (mine?.status === 'active') return c.json({ enrolment: { program_uid: p.uid, status: 'active', enrolled_at: mine.enrolled_at } });
  if (p.enrolment !== 'open') {
    return refuse(c, 403, { code: 'invite_only', message: 'This program enrols by invitation.' });
  }
  if (mine?.status === 'removed') {
    // Only the Super Admin removes a member, and a member cannot undo that.
    return refuse(c, 403, { code: 'removed', message: 'You were removed from this program; ask its administrator.' });
  }
  const t = new Date().toISOString();
  // The member's own row only: the user id is the session's.
  await c.env.DB.prepare(
    `INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, enrolled_at, status, updated_at) VALUES (?, ?, ?, ?, 'active', ?)`,
  ).bind(p.id, user.id, user.id, t, t).run();
  return c.json({ enrolment: { program_uid: p.uid, status: 'active', enrolled_at: t } }, 201);
});

/** What the caller is to this program: the Super Admin, an assigned admin, an enrolled member, or none. */
async function standing(c: C, user: any, p: ProgramRow) {
  if (isSuperAdmin(user)) return { reader: true, enrolled: false };
  const reader = await isAssignedAdmin(c.env, user, p.id);
  const e = await enrolmentOf(c.env, p.id, user.id);
  return { reader, enrolled: e?.status === 'active' };
}

r.get('/programs/:uid', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const p = await byUid(c.env, c.req.param('uid') ?? '');
  if (!p) return refuse(c, 404, { code: 'not_found', message: 'No such program.' });
  const s = await standing(c, user, p);
  const memberMaySee = p.status === 'published' && (p.enrolment === 'open' || s.enrolled);
  if (!s.reader && !memberMaySee) return refuse(c, 404, { code: 'not_found', message: 'No such program.' });
  const contents = await programContents(c.env, p.id);
  const described = await describeContents(c.env, contents);
  let mine = null;
  if (s.enrolled) {
    const self = { user_id: user.id, uid: String(user.uid ?? ''), name: null, enrolled_at: '' };
    mine = (await completionFor(c.env, p.id, contents, [self]))[0].completion;
  }
  return c.json({ program: programView(p), contents: described, enrolled: s.enrolled, my_completion: mine });
});

async function readerOf(c: C, user: any): Promise<ProgramRow | Response> {
  const p = await byUid(c.env, c.req.param('uid') ?? '');
  if (!p) return refuse(c, 404, { code: 'not_found', message: 'No such program.' });
  if (!isSuperAdmin(user) && !(await isAssignedAdmin(c.env, user, p.id))) {
    return refuse(c, 403, { code: 'not_assigned', message: 'You can follow the learners of programs assigned to you.' });
  }
  return p;
}

r.get('/programs/:uid/learners', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const p = await readerOf(c, user); if (p instanceof Response) return p;
  const contents = await programContents(c.env, p.id);
  const learners = await programLearners(c.env, p.id);
  return c.json({
    program: programView(p),
    contents: await describeContents(c.env, contents),
    learners: await completionFor(c.env, p.id, contents, learners),
  });
});

r.get('/programs/:uid/learners/:userUid', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const p = await readerOf(c, user); if (p instanceof Response) return p;
  const learners = await programLearners(c.env, p.id, c.req.param('userUid'));
  if (!learners.length) return refuse(c, 404, { code: 'not_enrolled', message: 'No such learner in this program.' });
  const contents = await programContents(c.env, p.id);
  return c.json({
    program: programView(p),
    contents: await describeContents(c.env, contents),
    learner: (await completionFor(c.env, p.id, contents, learners))[0],
  });
});

export default r;
