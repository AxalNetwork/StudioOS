/**
 * D558 (#1159) — Learning programs, member and assigned-admin side. Mounted at
 * /api/learning beside `learning.ts`.
 *
 *   GET  /programs                       published programs open to self-enrolment, and whether the caller is in each
 *   GET  /programs/enrolled              the caller's own programs, each with its contents and the caller's completion
 *   GET  /programs/mine                  the programs the caller is assigned to follow (the Super Admin: every program)
 *   GET  /programs/mine/enrolments?weeks=4|12|52   enrolments per program and per week, in the same scope (D954 §6)
 *   POST /programs/:uid/enrol            self-enrol, into a published open program only
 *   GET  /programs/:uid                  a program and its contents, with the caller's own completion when enrolled
 *   GET  /programs/mine/completion       D4810: per published program in that scope, learners and finished (one read, capped)
 *   GET  /programs/:uid/learners?limit=&offset=  read-only: each enrolled learner's completion of each content item, a page at a time
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
import { checkMemberProgramEntry } from '../services/programEntitlements';
import { isAssignedAdmin } from '../services/learningAccess';
import { weekAxis } from '../services/activeAccounts';
import { learningEnrolmentWeeks, parseProgramWeeks } from '../services/programCatalogue';
import {
  PROGRAM_COLS, P_COLS, programView, programContents, describeContents, programLearners, programLearnerCount, completionFor, enrolledContents,
  hasFinishedCells, type ProgramRow,
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
    .bind(programId, userId).first<{ status: string; enrolled_at: string | null }>();

/** D4480: recorded UTC/ISO instants only; a missing stamp is never today's date. */
function enrolmentIso(value: string | null): string | null {
  if (!value?.trim()) return null;
  let stamp = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(stamp)) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(stamp)) stamp = `${stamp.replace(' ', 'T')}Z`;
  const time = Date.parse(stamp);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

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

/**
 * #1251 — each program carries the `contents` and `my_completion` that
 * `GET /programs/:uid` gives an enrolled member, so "My programs" reads once.
 * Every program is described in the same round: the programs, their contents,
 * one query per kind of content and four for completion, however many
 * programs the caller is in. If that round fails, each program is still
 * listed, with `contents: null` and `contents_error`, so the failure says so
 * on each row and blanks nothing else.
 */
r.get('/programs/enrolled', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const res = await c.env.DB.prepare(
    `SELECT ${P_COLS}, e.enrolled_at
       FROM learning_enrollments e JOIN learning_programs p ON p.id = e.program_id
      WHERE e.user_id = ? AND e.status = 'active' AND p.status = 'published'
      ORDER BY p.name COLLATE NOCASE, p.id`,
  ).bind(user.id).all<any>();
  const rows = res.results || [];
  const byProgram = new Map<number, { contents: any[]; my_completion: any[] }>();
  let failed = false;
  try {
    const contents = await enrolledContents(c.env, user.id);
    const self = { user_id: user.id, uid: String(user.uid ?? ''), name: null, enrolled_at: '' };
    const [described, mine] = await Promise.all([
      describeContents(c.env, contents),
      completionFor(c.env, contents, [self]).then((x) => x[0].completion),
    ]);
    for (const p of rows) byProgram.set(Number(p.id), { contents: [], my_completion: [] });
    contents.forEach((x, i) => {
      const slot = byProgram.get(Number(x.program_id));
      if (!slot) return;
      slot.contents.push(described[i]);
      slot.my_completion.push(mine[i]);
    });
  } catch (e) {
    console.error('[learning] enrolled programs contents', e);
    failed = true;
  }
  return c.json({
    programs: rows.map((p) => ({
      ...programView(p), enrolled_at: p.enrolled_at,
      ...(failed
        ? { contents: null, my_completion: null, contents_error: 'unavailable' }
        : byProgram.get(Number(p.id))),
    })),
  });
});

/** The gate of `/programs/mine` and its weekly read: the Super Admin, or an admin. */
function mineGate(c: C, user: any): Response | { sa: boolean } {
  const sa = isSuperAdmin(user);
  if (!sa && String(user.role ?? '').toLowerCase() !== 'admin') {
    return refuse(c, 403, { code: 'admins_only', message: 'Programs are assigned to admins.' });
  }
  return { sa };
}

/**
 * D954 §8: each program also carries `admins`, its count of assigned admins,
 * as the Super Admin's list counts them. A count, never names.
 */
r.get('/programs/mine', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const g = mineGate(c, user); if (g instanceof Response) return g;
  const res = await c.env.DB.prepare(
    `SELECT ${P_COLS},
            (SELECT COUNT(*) FROM learning_enrollments e WHERE e.program_id = p.id AND e.status = 'active') AS learners,
            (SELECT COUNT(*) FROM learning_program_contents pc WHERE pc.program_id = p.id) AS contents,
            (SELECT COUNT(*) FROM learning_program_admins a WHERE a.program_id = p.id) AS admins
       FROM learning_programs p
      WHERE ? = 1 OR p.id IN (SELECT program_id FROM learning_program_admins WHERE user_id = ?)
      ORDER BY p.name COLLATE NOCASE, p.id LIMIT 500`,
  ).bind(g.sa ? 1 : 0, user.id).all<any>();
  return c.json({
    programs: (res.results || []).map((p) => ({ ...programView(p), learners: Number(p.learners), contents: Number(p.contents), admins: Number(p.admins) })),
  });
});

/**
 * D4810 — Completion by program for the Programs overview, in one read. It
 * replaces one learners read per published program. Each program in the
 * caller's `/programs/mine` scope that is published, first COMPLETION_MAX by
 * name, gives its active learners and how many finished (OD9, `hasFinishedCells`).
 * A program whose completion could not be read is listed in `unreadable`, never
 * counted as 0. `capped` says programs past the cap were left out.
 */
export const COMPLETION_MAX = 50;
r.get('/programs/mine/completion', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const g = mineGate(c, user); if (g instanceof Response) return g;
  const res = await c.env.DB.prepare(
    'SELECT ' + P_COLS + ` FROM learning_programs p
      WHERE p.status = 'published' AND (? = 1 OR p.id IN (SELECT program_id FROM learning_program_admins WHERE user_id = ?))
      ORDER BY p.name COLLATE NOCASE, p.id LIMIT ?`,
  ).bind(g.sa ? 1 : 0, user.id, COMPLETION_MAX + 1).all<any>();
  const rows = res.results || [];
  const programs: Array<{ uid: string; learners: number; finished: number }> = [];
  const unreadable: string[] = [];
  for (const p of rows.slice(0, COMPLETION_MAX)) {
    try {
      const contents = await programContents(c.env, p.id);
      const done = await completionFor(c.env, contents, await programLearners(c.env, p.id));
      programs.push({ uid: p.uid, learners: done.length, finished: done.filter((l) => hasFinishedCells(l.completion)).length });
    } catch (e) {
      console.warn('[learning-programs] completion unreadable', (e as Error)?.name);
      unreadable.push(p.uid);
    }
  }
  return c.json({ programs, unreadable, capped: rows.length > COMPLETION_MAX, max: COMPLETION_MAX });
});

/**
 * D954 §6 — enrolments per week, from the enrolment events (migration 560), in
 * `/programs/mine`'s scope. Every `enrolled` event counts in the Monday week
 * (UTC) it happened: a learner removed later still counts in the week they
 * enrolled, and a re-enrolment counts again. A re-enrolment made before 560
 * overwrote its first date, so it counts once, at its later date.
 */
r.get('/programs/mine/enrolments', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const g = mineGate(c, user); if (g instanceof Response) return g;
  const weeks = parseProgramWeeks(c.req.query('weeks'));
  if (!weeks) return refuse(c, 400, { code: 'bad_weeks', message: 'weeks must be 4, 12 or 52.' });
  const axis = weekAxis(new Date().toISOString(), weeks);
  const [counts, scoped] = await Promise.all([
    learningEnrolmentWeeks(c.env, { id: Number(user.id), superAdmin: g.sa }, axis),
    c.env.DB.prepare(
      `SELECT p.uid, p.name FROM learning_programs p
        WHERE ? = 1 OR p.id IN (SELECT program_id FROM learning_program_admins WHERE user_id = ?)
        ORDER BY p.name COLLATE NOCASE, p.id LIMIT 500`,
    ).bind(g.sa ? 1 : 0, user.id).all<{ uid: string; name: string }>(),
  ]);
  const by = new Map(counts.programs.map((x) => [x.uid, x]));
  const empty = axis.weeks.map((w) => ({ week: w, count: 0, to_date: w === axis.current }));
  return c.json({
    weeks,
    week_axis: axis.weeks,
    current_week: axis.current,
    total: counts.total,
    by_week: counts.weeks,
    programs: (scoped.results || []).map((p) => ({
      uid: p.uid, name: p.name, weeks: by.get(p.uid)?.weeks ?? empty, total: by.get(p.uid)?.total ?? 0,
    })),
    rule: 'Every enrolment counts in the week it happened, including learners removed later; a re-enrolment counts again from migration 560 on.',
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
  const entitlement = await checkMemberProgramEntry(c.env, user.id, 'learning');
  if (entitlement === 'unavailable') return refuse(c, 503, {
    code: 'program_entitlement_unavailable', message: 'Your Learning access could not be checked. Try again.',
  });
  if (entitlement === 'blocked') return refuse(c, 403, {
    code: 'program_entitlement_required', message: 'Learning access is not in force. Check Program access in your Account.',
  });
  const t = new Date().toISOString();
  // The member's own row only: the user id is the session's. The enrolment
  // event (D954 §6) lands in the same batch, so neither lands without the other.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, enrolled_at, status, updated_at) VALUES (?, ?, ?, ?, 'active', ?)`,
    ).bind(p.id, user.id, user.id, t, t),
    c.env.DB.prepare(
      `INSERT INTO learning_enrolment_events (program_id, user_id, kind, by_user_id, at) VALUES (?, ?, 'enrolled', ?, ?)`,
    ).bind(p.id, user.id, user.id, t),
  ]);
  return c.json({ enrolment: { program_uid: p.uid, status: 'active', enrolled_at: t } }, 201);
});

/** What the caller is to this program: the Super Admin, an assigned admin, an enrolled member, or none. */
async function standing(c: C, user: any, p: ProgramRow) {
  const reader = isSuperAdmin(user) || await isAssignedAdmin(c.env, user, p.id);
  const e = await enrolmentOf(c.env, p.id, user.id);
  return { reader, enrolled: e?.status === 'active', enrolled_at: e?.status === 'active' ? enrolmentIso(e.enrolled_at) : null };
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
    const self = { user_id: user.id, uid: String(user.uid ?? ''), name: null, enrolled_at: s.enrolled_at || '' };
    mine = (await completionFor(c.env, contents, [self]))[0].completion;
  }
  return c.json({ program: programView(p), contents: described, enrolled: s.enrolled,
    ...(s.enrolled ? { enrolled_at: s.enrolled_at } : {}), my_completion: mine });
});

async function readerOf(c: C, user: any): Promise<ProgramRow | Response> {
  const p = await byUid(c.env, c.req.param('uid') ?? '');
  if (!p) return refuse(c, 404, { code: 'not_found', message: 'No such program.' });
  if (!isSuperAdmin(user) && !(await isAssignedAdmin(c.env, user, p.id))) {
    return refuse(c, 403, { code: 'not_assigned', message: 'You can follow the learners of programs assigned to you.' });
  }
  return p;
}

/**
 * D4810: with `limit`, a page of at most LEARNERS_PAGE_MAX learners, and
 * `total` says how many there are. With no `limit`, every learner, as before:
 * the learning studio's program page reads the whole table (it says so).
 */
export const LEARNERS_PAGE_MAX = 200;
r.get('/programs/:uid/learners', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const rawLimit = c.req.query('limit'); const rawOffset = c.req.query('offset');
  const paged = rawLimit !== undefined && rawLimit !== '';
  const limit = paged ? Number(rawLimit) : -1;
  const offset = rawOffset === undefined || rawOffset === '' ? 0 : Number(rawOffset);
  if ((paged && (!Number.isInteger(limit) || limit < 1 || limit > LEARNERS_PAGE_MAX)) || !Number.isInteger(offset) || offset < 0) {
    return refuse(c, 400, { code: 'bad_page', message: `limit is a whole number from 1 to ${LEARNERS_PAGE_MAX}, and offset a whole number from 0.` });
  }
  const p = await readerOf(c, user); if (p instanceof Response) return p;
  const contents = await programContents(c.env, p.id);
  const [learners, total] = await Promise.all([programLearners(c.env, p.id, undefined, { limit, offset }), programLearnerCount(c.env, p.id)]);
  return c.json({
    program: programView(p),
    contents: await describeContents(c.env, contents),
    learners: await completionFor(c.env, contents, learners),
    total, limit: paged ? limit : null, offset,
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
    learner: (await completionFor(c.env, contents, learners))[0],
  });
});

export default r;
