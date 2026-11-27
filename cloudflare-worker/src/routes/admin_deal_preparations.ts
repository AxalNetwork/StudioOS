/**
 * D5456 (#5456, ADP-02 of #5453) — private deal preparations for platform admins, mounted at `/api/admin/deals`.
 * Every handler takes `requireAdmin`, then D5454's `preparationCapabilities`; the work is `services/dealDraftStore.ts`.
 *
 *   GET   /                     the deployment's preparation queue (D5454 `readPreparationQueue`): metadata only,
 *                               keyset-paged (`cursor`, `limit` ≤ 100), filtered by `state`
 *   GET   /:uid                 the authoring view of one preparation: its working revision, revision token,
 *                               readiness warnings and both issuer contexts
 *   GET   /:uid/revisions       revision metadata, newest first (`before`, `limit` ≤ 100), no content
 *   POST  /                     { company_id, project_id, operation_key, new_round?, content? }  create a private draft
 *   PATCH /:uid                 { expected_revision (or If-Match), operation_key, changes }       save a new revision
 *
 * WRITES ARE ENABLED (D5456-p2). `PREPARATION_MUTATIONS_ENABLED` (D5454) is true for `create` and `edit`, so a
 * platform admin creates and saves private drafts here. A draft owns no `deals` row and cannot go live until ADP-04's
 * reviewed release (#5458); a capability that is switched off still answers 403 `preparation_mutations_disabled`.
 *
 * NO LEGACY PATH CHANGES HERE. `POST /api/deals`, `POST /api/deals/draft` and `PUT /api/deals/:id` are unchanged
 * (D5454 Q4 = A): `/draft` stays the way to put a deal live today and retires with ADP-04's release. A deal a
 * preparation manages already refuses editorial terms on `PUT`.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { adminWritesFrozen, requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import {
  PREPARATION_MUTATIONS_ENABLED, preparationCapabilities, readPreparationQueue, type PreparationCapability,
} from '../services/dealPreparation';
import {
  createPreparationDraft, readPreparationDetail, readPreparationRevisions, savePreparationDraft, type Refusal,
} from '../services/dealDraftStore';

const r = new Hono<{ Bindings: Env }>();

const UID = /^[A-Za-z0-9-]{8,64}$/;

/** One sentence per code this router sends. */
export const MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  not_permitted: 'Only a platform admin on this deployment can read deal preparations.',
  preparation_mutations_disabled: 'Creating and editing private deal drafts is not switched on yet. Nothing was saved.',
  preparation_create_not_permitted: 'You cannot create a private deal draft. Nothing was saved.',
  preparation_edit_not_permitted: 'You cannot edit this private deal draft. Nothing was saved.',
  preparation_not_found: 'No deal preparation has that id on this deployment.',
  invalid_id: 'That is not a deal preparation id.',
  invalid_body: 'The request body is not a JSON object. Nothing was saved.',
  invalid_operation_key: 'Send an operation key of 8 to 128 letters, digits, dots, colons, dashes or underscores. Nothing was saved.',
  invalid_new_round: 'new_round is true or false. Nothing was saved.',
  invalid_fields: 'Some fields are not valid. Nothing was saved; correct the fields named and save again.',
  content_too_large: 'The draft is larger than 64 KiB. Nothing was saved.',
  invalid_pair: 'Choose a company and one of its projects. Nothing was saved.',
  project_not_found: 'That project does not exist or was deleted. Nothing was saved.',
  project_has_no_company: 'Link the project’s company before creating a deal. Nothing was saved.',
  company_mismatch: 'That project belongs to a different company. Choose the project’s own company. Nothing was saved.',
  company_not_found: 'That company does not exist. Nothing was saved.',
  company_archived: 'That company is archived. Nothing was saved.',
  open_preparation_exists: 'This project already has an unreleased deal draft. Open it, or say this is a new round. Nothing was saved.',
  operation_key_reused: 'That operation key was already used for a different change. Nothing was saved; send a new key.',
  create_outcome_unknown: 'We could not confirm whether the draft was created. Retry with the same operation key to find out.',
  expected_revision_required: 'Send the revision you started from (expected_revision or If-Match). Nothing was saved.',
  revision_mismatch: 'expected_revision and If-Match name different revisions. Nothing was saved.',
  changes_required: 'Send the fields to change. Nothing was saved.',
  preparation_not_editable: 'This draft is in review or approved and cannot be edited here. Nothing was saved.',
  revision_conflict: 'Someone saved this draft after you opened it. Nothing was saved; reload it and reapply your changes.',
  issuer_reconciliation_required: 'The project is no longer linked to this draft’s company. Nothing was saved; the issuer must be reconciled first.',
  save_outcome_unknown: 'We could not confirm whether your change was saved. Retry with the same operation key to find out.',
});

const send = (c: Context<{ Bindings: Env }>, out: Refusal) =>
  refuse(c, out.status, { code: out.code, message: MESSAGES[out.code] ?? 'The request was refused. Nothing was saved.', extra: out.extra });

async function capabilitiesOf(c: Context<{ Bindings: Env }>, user: User) {
  return preparationCapabilities(c.env, user, null, { writesFrozen: await adminWritesFrozen(c.env, user) });
}

/** Why a write is refused before the store is reached, or null when the caller holds `cap`. */
function writeRefusal(caps: Set<PreparationCapability>, cap: 'create' | 'edit'): Refusal | null {
  if (caps.has(cap)) return null;
  if (!caps.has('read')) return { ok: false, status: 403, code: 'not_permitted' };
  if (!PREPARATION_MUTATIONS_ENABLED[cap]) return { ok: false, status: 403, code: 'preparation_mutations_disabled' };
  return { ok: false, status: 403, code: cap === 'create' ? 'preparation_create_not_permitted' : 'preparation_edit_not_permitted' };
}

const clock = () => new Date();

r.get('/', async (c) => {
  const user = await requireAdmin(c);
  const q = c.req.query();
  const page = await readPreparationQueue(c.env, user, { writesFrozen: await adminWritesFrozen(c.env, user) }, {
    preparation_state: q.state, limit: q.limit, cursor: q.cursor,
  });
  if (!page) return send(c, { ok: false, status: 403, code: 'not_permitted' });
  return c.json(page);
});

r.get('/:uid', async (c) => {
  const user = await requireAdmin(c);
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return send(c, { ok: false, status: 400, code: 'invalid_id' });
  const caps = await capabilitiesOf(c, user);
  if (!caps.has('read')) return send(c, { ok: false, status: 403, code: 'not_permitted' });
  const detail = await readPreparationDetail(c.env, uid, { capabilities: caps, now: clock });
  if (!detail) return send(c, { ok: false, status: 404, code: 'preparation_not_found' });
  return c.json({ ...detail, capabilities: [...caps].sort() });
});

r.get('/:uid/revisions', async (c) => {
  const user = await requireAdmin(c);
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return send(c, { ok: false, status: 400, code: 'invalid_id' });
  const caps = await capabilitiesOf(c, user);
  if (!caps.has('read')) return send(c, { ok: false, status: 403, code: 'not_permitted' });
  const q = c.req.query();
  const page = await readPreparationRevisions(c.env, uid, { before: q.before, limit: q.limit }, { capabilities: caps });
  if (!page) return send(c, { ok: false, status: 404, code: 'preparation_not_found' });
  return c.json(page);
});

r.post('/', async (c) => {
  const user = await requireAdmin(c);
  const caps = await capabilitiesOf(c, user);
  const blocked = writeRefusal(caps, 'create');
  if (blocked) return send(c, blocked);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(c, { ok: false, status: 400, code: 'invalid_body' });
  const out = await createPreparationDraft(c.env, user, {
    company_id: body.company_id, project_id: body.project_id, new_round: body.new_round, content: body.content, operation_key: body.operation_key,
  }, { capabilities: caps, now: clock });
  if (!out.ok) return send(c, out);
  return c.json(out, out.replayed ? 200 : 201);
});

/** `If-Match: "3"`, `W/"3"` or `3`, as a revision token. */
function ifMatchRevision(raw: string | undefined): number | null | 'bad' {
  if (raw == null || raw === '') return null;
  const m = /^(?:W\/)?"?(\d{1,15})"?$/.exec(raw.trim());
  return m ? Number(m[1]) : 'bad';
}

r.patch('/:uid', async (c) => {
  const user = await requireAdmin(c);
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return send(c, { ok: false, status: 400, code: 'invalid_id' });
  const caps = await capabilitiesOf(c, user);
  const blocked = writeRefusal(caps, 'edit');
  if (blocked) return send(c, blocked);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(c, { ok: false, status: 400, code: 'invalid_body' });
  const header = ifMatchRevision(c.req.header('If-Match'));
  if (header === 'bad') return send(c, { ok: false, status: 428, code: 'expected_revision_required' });
  if (header != null && body.expected_revision != null && Number(body.expected_revision) !== header) {
    return send(c, { ok: false, status: 400, code: 'revision_mismatch' });
  }
  const out = await savePreparationDraft(c.env, user, uid, {
    expected_revision: body.expected_revision ?? header, operation_key: body.operation_key, changes: body.changes,
  }, { capabilities: caps, now: clock });
  if (!out.ok) return send(c, out);
  c.header('ETag', `"${out.revision}"`);
  return c.json(out);
});

export const mount: RouteMount = { path: '/api/admin/deals', router: r };
export default r;
