/**
 * D1002 (#2817) — Persona segments part 5, at /api/personas/admin (mounted
 * before routes/personas.ts). Every route is `requireAdmin`; moving an admin's
 * own account stays the Super Admin's, as on the single retag.
 *
 *   GET  /members?segment=<key>|none&q=&profile=&how_set=&band=&sub=&answered=&active=&differs=&why=&sort=&dir=&page=
 *        → { total, page, page_size, rows, why_counts, unreadable }
 *   POST /members/move           { user_ids (1–50), persona_id } → { segment, results, moved }
 *   POST /members/ask-to-finish  { user_ids (1–50) }             → { results, asked, every_days }
 *   GET  /activity?kind=&q=&page= → { total, page, page_size, sources, rows }
 *
 * A store the read needs that cannot be read is 5xx, never an empty list.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, isSuperAdmin } from '../auth';
import {
  MembersError, askToFinish, moveMembers, parseActivityQuery, parseMembersQuery, readActivity, readMembers,
} from '../services/personaMembers';

const app = new Hono<{ Bindings: Env }>();

async function answer(c: any, work: () => Promise<unknown>) {
  try {
    return c.json(await work());
  } catch (e) {
    if (e instanceof MembersError) return c.json({ code: e.code, detail: e.sentence }, e.status as any);
    if (e instanceof Response) throw e;
    console.error('[persona-members] unreadable:', (e as Error)?.message);
    return c.json({ code: 'members_unreadable', detail: 'Members could not be read just now. That is not the same as none. Try again.' }, 503);
  }
}

app.get('/members', async (c) => {
  await requireAdmin(c);
  const q = parseMembersQuery((k) => c.req.query(k));
  if ('error' in q) return c.json({ code: q.error, detail: 'A filter is not one this list knows.' }, 400);
  return answer(c, () => readMembers(c.env, q));
});

app.post('/members/move', async (c) => {
  const admin = await requireAdmin(c);
  const body = await c.req.json().catch(() => null) as { user_ids?: unknown; persona_id?: unknown } | null;
  if (!body || typeof body !== 'object') return c.json({ code: 'invalid_body', detail: 'The body must be a JSON object.' }, 400);
  return answer(c, () => moveMembers(c.env, admin as any, isSuperAdmin(admin as any), body.user_ids, body.persona_id));
});

app.post('/members/ask-to-finish', async (c) => {
  const admin = await requireAdmin(c);
  const body = await c.req.json().catch(() => null) as { user_ids?: unknown } | null;
  if (!body || typeof body !== 'object') return c.json({ code: 'invalid_body', detail: 'The body must be a JSON object.' }, 400);
  return answer(c, () => askToFinish(c.env, admin as any, body.user_ids));
});

app.get('/activity', async (c) => {
  await requireAdmin(c);
  const q = parseActivityQuery((k) => c.req.query(k));
  if ('error' in q) return c.json({ code: q.error, detail: 'A filter is not one this list knows.' }, 400);
  return answer(c, () => readActivity(c.env, q));
});

export default app;
