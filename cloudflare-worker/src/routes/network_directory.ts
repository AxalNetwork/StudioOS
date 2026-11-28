/**
 * D7674 (#7674): the shared Network directory (#7672's tables), mounted at `/api/network/directory`.
 *
 * Member reads (signed in):
 *   GET    /entries?q=&kind=person|organization&cursor=&limit=   published entries, true total, cursor pages
 *   GET    /entries/:uid                                         one published entry and its sourced associations;
 *                                                                a merged-away uid answers its canonical entry
 * The member's own private overlay on a published person (signed in, not a support session; a merged-away uid
 * follows its redirect, and overlays written on entries merged into this one are listed, never moved):
 *   GET    /entries/:uid/overlay        → { overlay: { saved, private_note, updated_at } | null }
 *   PUT    /entries/:uid/overlay        { saved?, private_note? }  only the caller's own row is written
 *   DELETE /entries/:uid/overlay
 * Operator review (Super Admin reads; writes behind the write bar):
 *   GET    /admin/entries?status=staged|published|suppressed|archived|all&kind=&cursor=&limit=  with readiness
 *   GET    /admin/reviews?status=pending|kept_separate|resolved|dismissed|all&after=&limit=
 *   POST   /admin/entries/:uid/publish   { idempotency_key, reason }  an organisation, or a person (professional
 *                                         projection only; owner answer B, D7674 part 4)
 *   POST   /admin/entries/:uid/suppress  { idempotency_key, reason }
 * Organisation-only controlled apply (D7674 part 2; Super Admin behind the write bar, not a support session):
 *   POST   /admin/organisation-apply     a reviewed organisation upload; re-planned on the server, applied in
 *                                         resumable batches, read back (`services/networkDirectoryApply.ts`)
 * People-only controlled apply (D7674 part 4; the same gate; `services/networkDirectoryPeopleApply.ts`):
 *   POST   /admin/people-apply           a reviewed people upload of professional fields only (name, LinkedIn
 *                                         profile, geography, sectors, affiliations); contact fields are refused
 * Reviewed merge, redirects, aliases and review decisions (D7674 part 3; Super Admin read, writes behind the write
 * bar and not a support session; `services/networkDirectoryMerge.ts`):
 *   GET    /admin/entries/:uid                  one entry's state, readiness, merges, observations, reviews, aliases
 *   POST   /admin/entries/:uid/merge            { into_uid, idempotency_key, reason, review_uid? }  same kind only
 *   POST   /admin/reviews/:reviewUid/decision   { decision: kept_separate|dismissed, idempotency_key, reason }
 *   POST   /admin/entries/:uid/aliases          { alias, idempotency_key, reason }  organisations only
 *   POST   /admin/aliases/:aliasUid/withdraw    { idempotency_key, reason }
 *
 * No route here reads `network_directory_private_sources`, creates an account, a membership, a relationship,
 * a notification or an outreach, or accepts SQL. The rules are `services/networkDirectory.ts`.
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
import { APPLY_LIMITS, applyEnvelope, applyOrganisationManifest, type ApplyResult } from '../services/networkDirectoryApply';
import { applyPeopleManifest, peopleEnvelope } from '../services/networkDirectoryPeopleApply';
import {
  addAlias, aliasInput, decideReview, decisionInput, mergeEntries, mergeInput, operatorEntry, withdrawAlias,
} from '../services/networkDirectoryMerge';

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

/* Reviewed merge, redirects, aliases and review decisions (D7674 part 3; `services/networkDirectoryMerge.ts`). */

directory.get('/admin/entries/:uid', async (c) => {
  await requireSuperAdmin(c);
  try { return c.json(await operatorEntry(c.env, uidParam(c))); } catch (e) { return answer(c, e); }
});

/** The write bar, then no support session: these change shared identity, so they are the operator's own act. */
async function identityOperator(c: Ctx): Promise<User | Response> {
  const admin = (await requireSuperAdminWriteBar(c)) as User;
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot change directory identities or review decisions.' });
  }
  return admin;
}

function aliasParam(c: Ctx): string {
  const uid = c.req.param('aliasUid') ?? '';
  if (!UID.test(uid)) throw new DirectoryRefusal(400, 'invalid_uid', 'That is not an alias reference.');
  return uid;
}

function reviewParam(c: Ctx): string {
  const uid = c.req.param('reviewUid') ?? '';
  if (!UID.test(uid)) throw new DirectoryRefusal(400, 'invalid_uid', 'That is not a review reference.');
  return uid;
}

directory.post('/admin/entries/:uid/merge', async (c) => {
  const admin = await identityOperator(c);
  if (admin instanceof Response) return admin;
  try {
    const uid = uidParam(c);
    const out = await mergeEntries(c.env, admin.id, uid, mergeInput(await body(c)));
    if (!out.replayed) {
      await logAdminAction(c.env, admin.id, (admin as any).email ?? '', 'network_directory_merge',
        { merge_uid: out.merge.uid, from_uid: out.merge.from_uid, to_uid: out.merge.to_uid, review_uid: out.merge.review_uid ?? null });
    }
    return c.json(out, out.replayed ? 200 : 201);
  } catch (e) { return answer(c, e); }
});

directory.post('/admin/reviews/:reviewUid/decision', async (c) => {
  const admin = await identityOperator(c);
  if (admin instanceof Response) return admin;
  try {
    const out = await decideReview(c.env, admin.id, reviewParam(c), decisionInput(await body(c)));
    if (!out.replayed) {
      await logAdminAction(c.env, admin.id, (admin as any).email ?? '', 'network_directory_review_decision',
        { review_uid: out.decision.review_uid, decision: out.decision.decision, decision_uid: out.decision.uid });
    }
    return c.json(out, out.replayed ? 200 : 201);
  } catch (e) { return answer(c, e); }
});

directory.post('/admin/entries/:uid/aliases', async (c) => {
  const admin = await identityOperator(c);
  if (admin instanceof Response) return admin;
  try {
    const uid = uidParam(c);
    const out = await addAlias(c.env, admin.id, uid, aliasInput(await body(c)));
    if (!out.replayed) {
      await logAdminAction(c.env, admin.id, (admin as any).email ?? '', 'network_directory_alias_add', { entry_uid: uid, alias_uid: out.alias.uid });
    }
    return c.json(out, out.replayed ? 200 : 201);
  } catch (e) { return answer(c, e); }
});

directory.post('/admin/aliases/:aliasUid/withdraw', async (c) => {
  const admin = await identityOperator(c);
  if (admin instanceof Response) return admin;
  try {
    const out = await withdrawAlias(c.env, admin.id, aliasParam(c), changeInput(await body(c)));
    if (!out.replayed) {
      await logAdminAction(c.env, admin.id, (admin as any).email ?? '', 'network_directory_alias_withdraw', { entry_uid: out.alias.entry_uid, alias_uid: out.alias.uid });
    }
    return c.json(out, out.replayed ? 200 : 201);
  } catch (e) { return answer(c, e); }
});

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
async function auditApply(c: Ctx, admin: User, action: string, details: Record<string, unknown>) {
  try {
    await logAdminAction(c.env, admin.id, (admin as any).email ?? '', action, details);
  } catch (e) {
    console.warn('[network_directory] apply audit failed', (e as Error)?.name ?? 'unknown');
  }
}

/**
 * One controlled apply (organisation or people contract): the write bar, then no support session, then the
 * byte-capped upload, the contract's envelope and its apply. The two contracts never share a route (D7674 part 4).
 */
async function controlledApply(c: Ctx, action: string, run: (env: Env, body: Record<string, unknown>) => Promise<ApplyResult>) {
  const admin = (await requireSuperAdminWriteBar(c)) as User;
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot apply a directory import.' });
  }
  try {
    const out = await run(c.env, await uploadBody(c));
    if (out.wrote) {
      await auditApply(c, admin, action, { run_uid: out.run_uid, status: out.status, applied_batches: out.applied_batches, pending_batches: out.pending_batches });
    }
    return c.json(out, out.status === 'complete' ? 200 : 202);
  } catch (e) {
    // A failed or unreconciled call that may have written is audited too.
    if (e instanceof DirectoryRefusal && e.extra.wrote === true) {
      await auditApply(c, admin, action, { run_uid: e.extra.run_uid, status: e.code, applied_batches: e.extra.applied_batches });
    }
    return answer(c, e);
  }
}

directory.post('/admin/organisation-apply', (c) => controlledApply(c, 'network_directory_organisation_apply',
  (env, b) => applyOrganisationManifest(env, applyEnvelope(b, env))));

/* People-only controlled apply (D7674 part 4; `services/networkDirectoryPeopleApply.ts`): professional fields only. */
directory.post('/admin/people-apply', (c) => controlledApply(c, 'network_directory_people_apply',
  (env, b) => applyPeopleManifest(env, peopleEnvelope(b, env))));

export default directory;
export const mount: RouteMount = { path: '/api/network/directory', router: directory, before: [network] };
