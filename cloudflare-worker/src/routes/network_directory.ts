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
 * Organisation-only controlled apply (D7674 part 2; Super Admin behind the write bar, not a support session):
 *   POST   /admin/organisation-apply     a reviewed organisation upload; re-planned on the server, applied in
 *                                         resumable batches, read back (`services/networkDirectoryApply.ts`)
 *
 * No route here reads `network_directory_private_sources`, creates an account, a membership, a relationship,
 * a notification or an outreach, or accepts SQL. The rules are `services/networkDirectory.ts`.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { countUids, organizationPeopleCounts } from '../services/networkDirectoryOrgPeople';
import { requireAuth, requireSuperAdmin, requireSuperAdminWriteBar, selectJwt } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import network from './network';
import {
  DirectoryRefusal, changeInput, deleteOverlay, operatorEntries, operatorReviews, overlayInput, publishEntry,
  readEntry, readOverlay, searchDirectory, suppressEntry, writeOverlay,
} from '../services/networkDirectory';
import { APPLY_LIMITS, applyEnvelope, applyOrganisationManifest } from '../services/networkDirectoryApply';

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

/**
 * D9071 (#9071): distinct published people per published organization, by affiliation status, for up to 50
 * organizations (`?uids=a,b`). Counts only, never names; a uid that is not a visible organization is left out.
 */
directory.get('/organizations/people-counts', async (c) => {
  await requireAuth(c);
  try { return c.json(await organizationPeopleCounts(c.env, countUids(c.req.query('uids')))); } catch (e) { return answer(c, e); }
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

const tooLarge = () => new DirectoryRefusal(413, 'body_too_large', 'The upload is larger than this route accepts. Nothing was read or written.', { max_bytes: APPLY_LIMITS.MAX_BODY_BYTES });

/**
 * The upload under a byte ceiling, then parsed. A declared Content-Length over the ceiling is refused before a byte
 * is read; a body without one is read as a stream with a running count and cancelled at the ceiling.
 */
async function uploadBody(c: Ctx): Promise<Record<string, unknown>> {
  const declared = c.req.header('content-length');
  if (declared !== undefined && /^\d+$/.test(declared.trim()) && Number(declared) > APPLY_LIMITS.MAX_BODY_BYTES) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = c.req.raw.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > APPLY_LIMITS.MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); throw tooLarge(); }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const ch of chunks) { bytes.set(ch, at); at += ch.byteLength; }
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* fall through */ }
  throw new DirectoryRefusal(400, 'invalid_json', 'The upload was not a JSON object, so nothing was read or written.');
}

/**
 * One audit row for a call that wrote anything, with ids and counts only. The apply is already committed, so a
 * failed audit write is logged and the call still answers what happened (D7674 part 2).
 */
async function auditApply(c: Ctx, admin: User, details: Record<string, unknown>) {
  try {
    await logAdminAction(c.env, admin.id, (admin as any).email ?? '', 'network_directory_organisation_apply', details);
  } catch (e) {
    console.warn('[network_directory] apply audit failed', (e as Error)?.name ?? 'unknown');
  }
}

directory.post('/admin/organisation-apply', async (c) => {
  const admin = (await requireSuperAdminWriteBar(c)) as User;
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot apply a directory import.' });
  }
  try {
    const out = await applyOrganisationManifest(c.env, applyEnvelope(await uploadBody(c), c.env));
    if (out.wrote) {
      await auditApply(c, admin, { run_uid: out.run_uid, status: out.status, applied_batches: out.applied_batches, pending_batches: out.pending_batches });
    }
    return c.json(out, out.status === 'complete' ? 200 : 202);
  } catch (e) {
    // A failed or unreconciled call that may have written is audited too.
    if (e instanceof DirectoryRefusal && e.extra.wrote === true) {
      await auditApply(c, admin, { run_uid: e.extra.run_uid, status: e.code, applied_batches: e.extra.applied_batches });
    }
    return answer(c, e);
  }
});

export default directory;
export const mount: RouteMount = { path: '/api/network/directory', router: directory, before: [network] };
