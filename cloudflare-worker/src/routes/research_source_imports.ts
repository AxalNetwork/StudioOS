/**
 * D7745 (#7745) — Research imports: the Super Admin routes that preview, apply in bounded chunks, read back,
 * reconcile and remove a private research payload, at /api/research-source-imports.
 *
 * Owner answer #7739: Q1 A (the Super Admin's browser sends the file in chunks to these routes; nothing else touches
 * it), Q2 A (Super Admins only), Q3 B (contact columns, personal profile links and whole person records are left out
 * before upload; a contact cell is refused here), Q4 A (the production apply waits for #5719; #7760 runs it).
 *
 * Gates: reads `requireSuperAdmin`, writes `requireSuperAdminWriteBar` (a TOTP session and a fresh step-up, so a
 * step-up that lapses mid-run refuses the next chunk and writes nothing). Every route also refuses a support session
 * with 403 `support_session_refused`. No rate-limit exemption: the client paces itself under the default limit.
 *
 * No field value leaves: no response, refusal, log line or audit row carries one. Refusals are built without `raw`
 * and without `audience`; a failure is logged by its error name only. Ids and hashes travel in bodies, never in a
 * path or a query. Orchestration is `services/researchSourceImports.ts`; the store is #7742's.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireSuperAdmin, requireSuperAdminWriteBar, selectJwt } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { ensureAdminAuditLogTable } from './admin';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { SourceStoreRefusal } from '../services/researchSourceRecords';
import {
  IMPORT_LIMITS, ImportRefusal, listImportRuns, openImportRun, previewImport, readImportRun, reconcileImportRun,
  removeImported, sealImportRun, sendChunk,
} from '../services/researchSourceImports';

type C = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

/** Our sentence for each code this router sends. A code not listed reads the generic sentence. */
export const REFUSAL_SENTENCES: Readonly<Record<string, string>> = Object.freeze({
  support_session_refused: 'A support session cannot read or change Research imports.',
  invalid_json: 'The request was not valid JSON, so nothing was read or written.',
  body_too_large: 'The request is larger than this route accepts, so nothing was read or written.',
  idempotency_key_required: 'Give the run an idempotency key of 8 to 200 characters.',
  idempotency_key_reused: 'That idempotency key belongs to a run with a different file digest. Use a new key for a new file.',
  file_digest_invalid: 'Give the file digest as 64 lower-case hex characters.',
  hash_recipe_unknown: 'No package hash recipe is registered, so a run cannot name one. Row hashes are kept as declared.',
  manifest_invalid: 'The manifest is not in the expected shape. Nothing was written.',
  manifest_too_large: 'The manifest is larger than the store accepts. Nothing was written.',
  column_not_in_manifest: 'A column class names a column the manifest does not list.',
  column_class_missing: 'Every manifest column needs a class (fact, prose or contact).',
  contact_handling_invalid: 'A contact column can only be withheld.',
  held_not_enabled: 'Contact values are never uploaded (owner decision #7739 Q3 B), so a column cannot be held.',
  role_invalid: 'A column role must be 1 to 40 characters.',
  column_rules_disagree: 'This source\'s column rules were fixed by its first run and this request differs. Nothing was written.',
  source_removed: 'This source was removed, so no run may bring it back.',
  run_open: 'Another run is open or not yet reconciled. Seal or reconcile it first.',
  run_not_found: 'There is no such run.',
  run_not_open: 'This run no longer takes chunks or a seal.',
  run_closed: 'This run no longer takes chunks.',
  run_not_partial: 'Only a partial run can be resumed.',
  run_not_reconcilable: 'Only a partial or uncertain run can be closed.',
  run_changed: 'The run changed while this was being done. Read it again.',
  resend_uncertain_chunks: 'Send this run\'s uncertain chunks again to settle it, then seal.',
  reconcile_action_invalid: 'Say resume or close.',
  chunk_index_invalid: 'Give the chunk index as a whole number from 0.',
  chunk_empty: 'A chunk needs at least one record.',
  chunk_too_large: `A chunk may carry at most ${IMPORT_LIMITS.MAX_CHUNK_RECORDS} records and ${IMPORT_LIMITS.MAX_CHUNK_BYTES} bytes. Nothing was written.`,
  chunk_index_reused: 'That chunk index already holds other records. Nothing was written.',
  record_in_other_chunk: 'A record in this chunk was already sent in another chunk of this run. Nothing was written.',
  record_invalid: 'A record is not in the expected shape. Nothing was written.',
  body_hash_required: 'Every record needs the body hash of its permitted columns.',
  body_hash_mismatch: 'A record\'s body hash, recomputed here, differs from the one sent. Nothing was written.',
  contact_column_refused: 'A contact column was sent. Contact values are never uploaded (owner decision #7739 Q3 B). Nothing was written.',
  duplicate_in_chunk: 'A record appears twice in this chunk. Nothing was written.',
  pages_required: 'Send the record list as pages.',
  page_invalid: `A preview page holds 1 to ${IMPORT_LIMITS.PREVIEW_PAGE} entries.`,
  entries_invalid: 'Each entry is [source key, record id, row hash].',
  too_many_entries: 'The list is longer than this route accepts.',
  unknown_source: 'An entry names a source the manifest does not list.',
  duplicate_entry: 'A record appears twice in the list.',
  expected_list_mismatch: 'The expected list does not match the manifest\'s count and list digest, so nothing was sealed.',
  removal_scope_invalid: 'Say private_fields, record or source.',
  source_key_invalid: 'Give a valid source key.',
  provider_record_id_required: 'Name the record to remove.',
  provider_record_id_not_allowed: 'A source removal names no record.',
  storage_unavailable: 'The store could not be reached, so nothing was changed. Try again.',
});
const GENERIC = 'This request was refused and nothing was written.';

const STORE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  idempotency_key_reused: 409, column_rules_disagree: 409, source_removed: 409, run_not_found: 404, run_closed: 409, manifest_too_large: 413, chunk_too_large: 413,
});

/** A refusal from either layer, by code and names only: no `raw`, no `audience`. */
function refused(c: C, e: unknown): Response {
  if (e instanceof ImportRefusal) {
    return refuse(c, e.status, { code: e.code, message: REFUSAL_SENTENCES[e.code] ?? GENERIC, extra: { names: e.detail } });
  }
  if (e instanceof SourceStoreRefusal) {
    return refuse(c, STORE_STATUS[e.code] ?? 400, { code: e.code, message: REFUSAL_SENTENCES[e.code] ?? GENERIC, extra: { names: e.detail } });
  }
  console.warn('[research_source_imports] failed', (e as Error)?.name ?? 'unknown');
  return refuse(c, 503, { code: 'storage_unavailable', message: REFUSAL_SENTENCES.storage_unavailable });
}

const supportSession = async (c: C) => !!(await selectJwt(c))?.payload?.impersonated_by;

/** Signed in, not a support session, then the gate handed in: `requireSuperAdmin` or `requireSuperAdminWriteBar`. */
async function gate(c: C, check: (c: C) => Promise<User>): Promise<User | Response> {
  try {
    await requireAuth(c);
    if (await supportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: REFUSAL_SENTENCES.support_session_refused });
    return await check(c);
  } catch (e) {
    return mapError(c, e);
  }
}

/** The body as text under a byte ceiling, then parsed. Nothing is read past the ceiling's refusal. */
async function jsonBody(c: C, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new ImportRefusal(413, 'body_too_large', { max_bytes: maxBytes });
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch { throw new ImportRefusal(400, 'invalid_json'); }
}

const actorOf = (u: User) => Number((u as { id: number }).id);

// Preview: writes nothing. A read, so `requireSuperAdmin`; POST because the ids and hashes travel in the body.
r.post('/preview', async (c) => {
  const user = await gate(c, requireSuperAdmin);
  if (user instanceof Response) return user;
  try {
    return c.json(await previewImport(c.env.DB, await jsonBody(c, IMPORT_LIMITS.MAX_PREVIEW_BYTES)));
  } catch (e) { return refused(c, e); }
});

r.get('/runs', async (c) => {
  const user = await gate(c, requireSuperAdmin);
  if (user instanceof Response) return user;
  try { return c.json(await listImportRuns(c.env.DB)); } catch (e) { return refused(c, e); }
});

r.get('/runs/:uid', async (c) => {
  const user = await gate(c, requireSuperAdmin);
  if (user instanceof Response) return user;
  try {
    return c.json(await readImportRun(c.env.DB, c.req.param('uid'), Number(c.req.query('offset') ?? 0)));
  } catch (e) { return refused(c, e); }
});

r.post('/runs', async (c) => {
  const user = await gate(c, requireSuperAdminWriteBar);
  if (user instanceof Response) return user;
  try {
    await ensureAdminAuditLogTable(c.env);
    const out = await openImportRun(c.env.DB, c.env, actorOf(user), await jsonBody(c, IMPORT_LIMITS.MAX_PREVIEW_BYTES), new Date());
    return c.json(out, out.replayed ? 200 : 201);
  } catch (e) { return refused(c, e); }
});

r.post('/runs/:uid/chunks', async (c) => {
  const user = await gate(c, requireSuperAdminWriteBar);
  if (user instanceof Response) return user;
  try {
    return c.json(await sendChunk(c.env.DB, c.env, c.req.param('uid'), await c.req.text(), new Date()));
  } catch (e) { return refused(c, e); }
});

r.post('/runs/:uid/seal', async (c) => {
  const user = await gate(c, requireSuperAdminWriteBar);
  if (user instanceof Response) return user;
  try {
    await ensureAdminAuditLogTable(c.env);
    return c.json(await sealImportRun(c.env.DB, c.env, actorOf(user), c.req.param('uid'), await jsonBody(c, IMPORT_LIMITS.MAX_SEAL_BYTES), new Date()));
  } catch (e) { return refused(c, e); }
});

r.post('/runs/:uid/reconcile', async (c) => {
  const user = await gate(c, requireSuperAdminWriteBar);
  if (user instanceof Response) return user;
  try {
    await ensureAdminAuditLogTable(c.env);
    return c.json(await reconcileImportRun(c.env.DB, c.env, actorOf(user), c.req.param('uid'), await jsonBody(c, 4_000), new Date()));
  } catch (e) { return refused(c, e); }
});

r.post('/removals', async (c) => {
  const user = await gate(c, requireSuperAdminWriteBar);
  if (user instanceof Response) return user;
  try {
    await ensureAdminAuditLogTable(c.env);
    return c.json(await removeImported(c.env.DB, c.env, actorOf(user), await jsonBody(c, 4_000), new Date()), 201);
  } catch (e) { return refused(c, e); }
});

export default r;
export const mount: RouteMount = { path: '/api/research-source-imports', router: r };
