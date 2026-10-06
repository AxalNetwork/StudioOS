/**
 * D558 (#1159) — authoring Learning programs. Mounted at /api/admin/learning
 * beside `admin_learning.ts`.
 *
 * THE SUPER ADMIN ONLY, and every write recorded with `logAdminAction`
 * (`learning.program.*`), actor and subject.
 *
 *   GET    /programs
 *   POST   /programs                         create (a draft)
 *   GET    /programs/:uid                    with contents, assigned admins and enrolments
 *   PATCH  /programs/:uid                    name, region, description, enrolment, status
 *   PUT    /programs/:uid/contents           the full ordered list: [{subject_kind, subject_uid}]
 *   POST   /programs/:uid/admins             {user_uid}; the target must be an admin
 *   DELETE /programs/:uid/admins/:userUid
 *   POST   /programs/:uid/enrollments        {user_uid}
 *   DELETE /programs/:uid/enrollments/:userUid   the row stays, as 'removed'
 *
 * A WEBINAR IS NOT YET CONTENT. The column allows it for D560 (#1161), but
 * there is no webinar store to check a uid against, so it is refused
 * (`webinar_not_built`) rather than stored unchecked.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { refuse } from '../util/refusal';
import { newUid } from './_t13t14t15_helpers';
import { gate, record, text, oneOf, guarded, bad } from './admin_learning';
import { LEARNING_STATUSES, PROGRAM_SUBJECT_KINDS } from '../services/learningAccess';
import { PROGRAM_COLS, P_COLS, programView, programContents, describeContents, type ProgramRow } from '../services/learningPrograms';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

const ENROLMENTS = ['invite', 'open'] as const;
const MAX_CONTENTS = 200;
const now = () => new Date().toISOString();

const byUid = (env: Env, uid: string) =>
  env.DB.prepare('SELECT ' + PROGRAM_COLS + ' FROM learning_programs WHERE uid = ?').bind(uid).first<ProgramRow>();

async function programOr404(c: C): Promise<ProgramRow | Response> {
  const p = await byUid(c.env, c.req.param('uid') ?? '');
  return p ?? refuse(c, 404, { code: 'not_found', message: 'No such program.' });
}

/** A user by uid: name, uid and role. Never the email. */
const userByUid = (env: Env, uid: unknown) =>
  typeof uid === 'string' && uid.trim()
    ? env.DB.prepare('SELECT id, uid, COALESCE(display_name, name) AS name, role FROM users WHERE uid = ?').bind(uid.trim()).first<any>()
    : Promise.resolve(null);

async function detail(env: Env, p: ProgramRow) {
  const [contents, admins, enrolments] = await Promise.all([
    programContents(env, p.id),
    env.DB.prepare(
      `SELECT u.uid, COALESCE(u.display_name, u.name) AS name, a.assigned_at FROM learning_program_admins a
         JOIN users u ON u.id = a.user_id WHERE a.program_id = ? ORDER BY a.id`,
    ).bind(p.id).all<any>(),
    env.DB.prepare(
      `SELECT u.uid, COALESCE(u.display_name, u.name) AS name, e.status, e.enrolled_at, e.updated_at,
              CASE WHEN e.enrolled_by = e.user_id THEN 'self' ELSE 'super_admin' END AS enrolled_by
         FROM learning_enrollments e JOIN users u ON u.id = e.user_id WHERE e.program_id = ? ORDER BY e.id`,
    ).bind(p.id).all<any>(),
  ]);
  return {
    program: programView(p),
    contents: await describeContents(env, contents),
    admins: admins.results || [],
    enrolments: enrolments.results || [],
  };
}

function programFields(b: any, creating: boolean) {
  const name = text(b?.name, 200);
  if ((creating && !name) || name === null) bad('bad_name', 'A program needs a name.');
  return {
    name,
    region: text(b?.region, 120),
    description: text(b?.description, 5000),
    enrolment: oneOf(b?.enrolment, ENROLMENTS, 'enrolment'),
    status: creating ? undefined : oneOf(b?.status, LEARNING_STATUSES, 'status'),
  };
}

r.get('/programs', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const res = await c.env.DB.prepare(
    `SELECT ${P_COLS},
            (SELECT COUNT(*) FROM learning_enrollments e WHERE e.program_id = p.id AND e.status = 'active') AS learners,
            (SELECT COUNT(*) FROM learning_program_admins a WHERE a.program_id = p.id) AS admins
       FROM learning_programs p ORDER BY p.updated_at DESC, p.id DESC LIMIT 500`,
  ).all<any>();
  return c.json({ programs: (res.results || []).map((p) => ({ ...programView(p), learners: Number(p.learners), admins: Number(p.admins) })) });
});

r.post('/programs', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const f = programFields(await c.req.json().catch(() => ({})), true);
    const uid = newUid();
    const t = now();
    await c.env.DB.prepare(
      `INSERT INTO learning_programs (uid, name, region, description, enrolment, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(uid, f.name, f.region ?? null, f.description ?? null, f.enrolment ?? 'invite', admin.id, t, t).run();
    await record(c, admin, 'learning.program.create', { uid });
    return c.json(await detail(c.env, (await byUid(c.env, uid)) as ProgramRow), 201);
  });
});

r.get('/programs/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const p = await programOr404(c); if (p instanceof Response) return p;
  return c.json(await detail(c.env, p));
});

r.patch('/programs/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const p = await programOr404(c); if (p instanceof Response) return p;
  return guarded(c, async () => {
    const f = programFields(await c.req.json().catch(() => ({})), false) as Record<string, unknown>;
    const set: string[] = [];
    const vals: unknown[] = [];
    for (const col of ['name', 'region', 'description', 'enrolment', 'status']) {
      if (f[col] !== undefined) {
        if ((col === 'enrolment' || col === 'status') && f[col] === null) bad(`bad_${col}`, `${col} cannot be empty.`);
        set.push(col + ' = ?'); vals.push(f[col]);
      }
    }
    if (!set.length) bad('nothing_to_change', 'Send at least one of name, region, description, enrolment or status.');
    await c.env.DB.prepare(`UPDATE learning_programs SET ${set.join(', ')}, updated_at = ? WHERE id = ?`).bind(...vals, now(), p.id).run();
    await record(c, admin, 'learning.program.update', { uid: p.uid, fields: Object.keys(f).filter((k) => f[k] !== undefined) });
    return c.json(await detail(c.env, (await byUid(c.env, p.uid)) as ProgramRow));
  });
});

const EXISTS_SQL: Record<string, string> = {
  course: 'SELECT 1 AS ok FROM learning_courses WHERE uid = ?',
  item: 'SELECT 1 AS ok FROM learning_items WHERE uid = ?',
  exam: 'SELECT 1 AS ok FROM learning_exams WHERE uid = ?',
  exercise: 'SELECT 1 AS ok FROM learning_exercises WHERE uid = ?',
};

r.put('/programs/:uid/contents', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const p = await programOr404(c); if (p instanceof Response) return p;
  return guarded(c, async () => {
    const b = await c.req.json().catch(() => ({} as any));
    const list = b?.contents;
    if (!Array.isArray(list) || list.length > MAX_CONTENTS) bad('bad_contents', `contents is a list of at most ${MAX_CONTENTS} {subject_kind, subject_uid}.`);
    const seen = new Set<string>();
    const rows: Array<{ kind: string; uid: string }> = [];
    for (const x of list) {
      const kind = String(x?.subject_kind ?? '');
      const uid = typeof x?.subject_uid === 'string' ? x.subject_uid.trim() : '';
      if (!(PROGRAM_SUBJECT_KINDS as readonly string[]).includes(kind) || !uid || uid.length > 64) {
        bad('bad_contents', `Each entry names a subject_kind (${PROGRAM_SUBJECT_KINDS.join(', ')}) and a subject_uid.`);
      }
      if (kind === 'webinar') bad('webinar_not_built', 'Webinars are not a Learning store yet (D560), so a program cannot hold one.');
      if (seen.has(kind + '|' + uid)) bad('duplicate_content', `${kind} ${uid} is listed twice.`);
      seen.add(kind + '|' + uid);
      if (!(await c.env.DB.prepare(EXISTS_SQL[kind]).bind(uid).first())) bad('unknown_content', `No ${kind} has the uid ${uid}.`);
      rows.push({ kind, uid });
    }
    const t = now();
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM learning_program_contents WHERE program_id = ?').bind(p.id),
      ...rows.map((x, i) => c.env.DB.prepare(
        'INSERT INTO learning_program_contents (program_id, subject_kind, subject_uid, position, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(p.id, x.kind, x.uid, i, t)),
      c.env.DB.prepare('UPDATE learning_programs SET updated_at = ? WHERE id = ?').bind(t, p.id),
    ]);
    await record(c, admin, 'learning.program.contents', { uid: p.uid, contents: rows.map((x) => `${x.kind}:${x.uid}`) });
    return c.json(await detail(c.env, p));
  });
});

r.post('/programs/:uid/admins', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const p = await programOr404(c); if (p instanceof Response) return p;
  const b = await c.req.json().catch(() => ({} as any));
  const target = await userByUid(c.env, b?.user_uid);
  if (!target) return refuse(c, 404, { code: 'no_such_user', message: 'No user has that uid.' });
  if (String(target.role ?? '').toLowerCase() !== 'admin') {
    return refuse(c, 400, { code: 'not_an_admin', message: 'Only an admin can be assigned to a program.' });
  }
  await c.env.DB.prepare(
    'INSERT INTO learning_program_admins (program_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?) ON CONFLICT (program_id, user_id) DO NOTHING',
  ).bind(p.id, target.id, admin.id, now()).run();
  await record(c, admin, 'learning.program.admin.assign', { uid: p.uid, user_uid: target.uid });
  return c.json(await detail(c.env, p));
});

r.delete('/programs/:uid/admins/:userUid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const p = await programOr404(c); if (p instanceof Response) return p;
  const target = await userByUid(c.env, c.req.param('userUid'));
  const res = target
    ? await c.env.DB.prepare('DELETE FROM learning_program_admins WHERE program_id = ? AND user_id = ?').bind(p.id, target.id).run()
    : null;
  if (!target || !Number((res as any)?.meta?.changes ?? 0)) {
    return refuse(c, 404, { code: 'not_assigned', message: 'That user is not assigned to this program.' });
  }
  await record(c, admin, 'learning.program.admin.unassign', { uid: p.uid, user_uid: target.uid });
  return c.json(await detail(c.env, p));
});

r.post('/programs/:uid/enrollments', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const p = await programOr404(c); if (p instanceof Response) return p;
  const b = await c.req.json().catch(() => ({} as any));
  const target = await userByUid(c.env, b?.user_uid);
  if (!target) return refuse(c, 404, { code: 'no_such_user', message: 'No user has that uid.' });
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, enrolled_at, status, updated_at) VALUES (?, ?, ?, ?, 'active', ?)
     ON CONFLICT (program_id, user_id) DO UPDATE SET
       status = 'active',
       enrolled_by = CASE WHEN learning_enrollments.status = 'active' THEN learning_enrollments.enrolled_by ELSE excluded.enrolled_by END,
       enrolled_at = CASE WHEN learning_enrollments.status = 'active' THEN learning_enrollments.enrolled_at ELSE excluded.enrolled_at END,
       updated_at = excluded.updated_at`,
  ).bind(p.id, target.id, admin.id, t, t).run();
  await record(c, admin, 'learning.program.enrol', { uid: p.uid, user_uid: target.uid });
  return c.json(await detail(c.env, p));
});

r.delete('/programs/:uid/enrollments/:userUid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const p = await programOr404(c); if (p instanceof Response) return p;
  const target = await userByUid(c.env, c.req.param('userUid'));
  const res = target
    ? await c.env.DB.prepare(
      `UPDATE learning_enrollments SET status = 'removed', updated_at = ? WHERE program_id = ? AND user_id = ? AND status = 'active'`,
    ).bind(now(), p.id, target.id).run()
    : null;
  if (!target || !Number((res as any)?.meta?.changes ?? 0)) {
    return refuse(c, 404, { code: 'not_enrolled', message: 'That user is not enrolled in this program.' });
  }
  await record(c, admin, 'learning.program.unenrol', { uid: p.uid, user_uid: target.uid });
  return c.json(await detail(c.env, p));
});

export default r;
