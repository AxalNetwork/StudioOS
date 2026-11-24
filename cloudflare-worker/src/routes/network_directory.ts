/**
 * D7674 (#7674): the shared Network directory (#7672's tables), mounted at `/api/network/directory`.
 *
 * Member reads (signed in):
 *   GET    /entries?q=&kind=person|organization&cursor=&limit=   published entries, true total, cursor pages
 *   GET    /entries/:uid                                         one published entry and its sourced associations
 * The member's own private overlay on a published person (signed in, not a support session):
 *   GET    /entries/:uid/overlay        → { overlay: { saved, private_note, updated_at } | null }
 *   PUT    /entries/:uid/overlay        { saved?, private_note? }  only the caller's own row is written
 *   DELETE /entries/:uid/overlay
 * Operator review (Super Admin reads; writes behind the write bar):
 *   GET    /admin/entries?status=staged|published|suppressed|archived|all&kind=&cursor=&limit=  with readiness
 *   GET    /admin/reviews?status=pending|kept_separate|resolved|dismissed|all&after=&limit=
 *   POST   /admin/entries/:uid/publish   { idempotency_key, reason }  an organisation only; people are held (#7739)
 *   POST   /admin/entries/:uid/suppress  { idempotency_key, reason }
 *
 * No route here reads `network_directory_private_sources`, creates an account, a membership, a relationship,
 * a notification or an outreach, or applies an import plan. The rules are `services/networkDirectory.ts`.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth, requireSuperAdmin, requireSuperAdminWriteBar, selectJwt } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import network from './network';
import {
  DirectoryRefusal, changeInput, deleteOverlay, operatorEntries, operatorReviews, overlayInput, publishEntry,
  readEntry, readOverlay, searchDirectory, suppressEntry, writeOverlay,
} from '../services/networkDirectory';

const directory = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

const UID = /^[A-Za-z0-9_.:-]{1,200}$/;

function answer(c: Ctx, e: unknown): Response {
  if (e instanceof DirectoryRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  throw e;
}

function uidParam(c: Ctx): string {
  const uid = c.req.param('uid') ?? '';
  if (!UID.test(uid)) throw new DirectoryRefusal(400, 'invalid_uid', 'That is not a directory reference.');
  return uid;
}

async function body(c: Ctx): Promise<Record<string, unknown>> {
  try { const b = await c.req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return {}; }
}

/** A member's overlay is theirs alone: a support session may neither read nor change it. */
async function overlayOwner(c: Ctx): Promise<User | Response> {
  const user = (await requireAuth(c)) as User;
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot read or change a member’s private notes.' });
  }
  return user;
}

directory.get('/entries', async (c) => {
  await requireAuth(c);
  try {
    return c.json(await searchDirectory(c.env, { q: c.req.query('q'), kind: c.req.query('kind'), cursor: c.req.query('cursor'), limit: c.req.query('limit') }));
  } catch (e) { return answer(c, e); }
});

directory.get('/entries/:uid', async (c) => {
  await requireAuth(c);
  try { return c.json(await readEntry(c.env, uidParam(c))); } catch (e) { return answer(c, e); }
});

directory.get('/entries/:uid/overlay', async (c) => {
  const user = await overlayOwner(c);
  if (user instanceof Response) return user;
  try { return c.json(await readOverlay(c.env, user.id, uidParam(c))); } catch (e) { return answer(c, e); }
});

directory.put('/entries/:uid/overlay', async (c) => {
  const user = await overlayOwner(c);
  if (user instanceof Response) return user;
  try { return c.json(await writeOverlay(c.env, user.id, uidParam(c), overlayInput(await body(c)))); } catch (e) { return answer(c, e); }
});

directory.delete('/entries/:uid/overlay', async (c) => {
  const user = await overlayOwner(c);
  if (user instanceof Response) return user;
  try { return c.json(await deleteOverlay(c.env, user.id, uidParam(c))); } catch (e) { return answer(c, e); }
});

directory.get('/admin/entries', async (c) => {
  await requireSuperAdmin(c);
  try {
    return c.json(await operatorEntries(c.env, { status: c.req.query('status'), kind: c.req.query('kind'), cursor: c.req.query('cursor'), limit: c.req.query('limit') }));
  } catch (e) { return answer(c, e); }
});

directory.get('/admin/reviews', async (c) => {
  await requireSuperAdmin(c);
  try { return c.json(await operatorReviews(c.env, { status: c.req.query('status'), limit: c.req.query('limit'), after: c.req.query('after') })); }
  catch (e) { return answer(c, e); }
});

async function change(c: Ctx, action: 'publish' | 'suppress') {
  const admin = (await requireSuperAdminWriteBar(c)) as User;
  try {
    const uid = uidParam(c);
    const input = changeInput(await body(c));
    const out = action === 'publish' ? await publishEntry(c.env, admin.id, uid, input) : await suppressEntry(c.env, admin.id, uid, input);
    if (!out.replayed) {
      await logAdminAction(c.env, admin.id, (admin as any).email ?? '', `network_directory_${action}`, { entry_uid: uid, event_uid: out.event.uid });
    }
    return c.json(out, out.replayed ? 200 : 201);
  } catch (e) { return answer(c, e); }
}

directory.post('/admin/entries/:uid/publish', (c) => change(c, 'publish'));
directory.post('/admin/entries/:uid/suppress', (c) => change(c, 'suppress'));

export default directory;
export const mount: RouteMount = { path: '/api/network/directory', router: directory, before: [network] };
