/**
 * D7746 (#7746) — Research imports: the Super Admin routes that say what each staged source record is and what is to
 * happen to it, and report the five-outcome reconciliation, at /api/research-source-imports/mappings.
 *
 * Gate: #7745's `researchImportGate`, imported, never retyped. Reads `requireSuperAdmin`; writes
 * `requireSuperAdminWriteBar` (a TOTP session and a fresh step-up). Every route refuses a support session with 403
 * `support_session_refused`. Owner answer #7739 Q2 A: only Super Admins read a full record.
 *
 * Private data: ids, notes and lists travel in request bodies, never in a path or a query; the list's query carries
 * codes and a source key only, and there is no free-text search parameter. Only `POST /mappings/record` returns field
 * values, and each such read writes one audit row naming the stored record id. Refusals carry codes and ids, never a
 * value or a note, and are built without `raw`; a failure is logged by its error name only. Logic is
 * `services/researchSourceMapping.ts`.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { ensureAdminAuditLogTable } from './admin';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { researchImportGate, REFUSAL_SENTENCES as IMPORT_SENTENCES } from './research_source_imports';
import {
  MAPPING_LIMITS, MappingRefusal, applyList, decideOne, filtersFrom, listRecords, previewList, readRecord, reconciliation,
} from '../services/researchSourceMapping';

type C = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

/** Our sentence for each code this router sends. A code not listed reads the generic sentence. */
export const REFUSAL_SENTENCES: Readonly<Record<string, string>> = Object.freeze({
  support_session_refused: IMPORT_SENTENCES.support_session_refused,
  invalid_json: 'The request was not valid JSON, so nothing was read or written.',
  body_too_large: 'The request is larger than this route accepts, so nothing was read or written.',
  filter_invalid: 'A filter is not one this list accepts. Filters are codes and a source key only.',
  source_key_invalid: 'Give a valid source key.',
  provider_record_id_required: 'Name the record by its provider record id.',
  unknown_record: 'No staged record has that source key and provider record id. Nothing was written.',
  kind_invalid: 'Say what the record is: manager, vehicle, accelerator, resource, company, funding_round or individual.',
  decision_invalid: 'Say create, link, retain_private or reject.',
  decision_not_allowed_for_kind: 'A company, a funding round or an individual can only be retained privately or rejected here.',
  ground_invalid: 'The ground is not one this list accepts.',
  ground_required: 'A link needs the ground it rests on.',
  ground_not_supported: 'That ground is not borne out by this record\'s candidates for that target.',
  reason_invalid: 'The reason is not one this list accepts.',
  reason_required: 'This decision needs a reason code.',
  note_invalid: `A note is text of at most ${MAPPING_LIMITS.NOTE_CHARS} characters.`,
  target_invalid: 'A target is a served catalogue uid, or a staged record named by source key and provider record id.',
  target_required: 'A link needs a target.',
  target_not_allowed: 'Only a link takes a target and a ground.',
  target_not_served: 'That uid is not a served catalogue row. Nothing was written.',
  target_uid_retired: 'That uid was retired; the refusal names the uid it moved to. Nothing was written.',
  target_unknown_record: 'The target names no staged record. Nothing was written.',
  self_link: 'A record cannot link to itself.',
  link_target_not_create: 'A link to a staged record needs that record to carry create. Links do not chain.',
  link_kind_mismatch: 'A record can only link to a staged record of its own kind.',
  record_is_link_target: 'Other records link to this one, so it must stay a create. Change those first.',
  record_promoted: 'This record was promoted, so its decision stands.',
  shared_website_ground: 'A shared website can never be the only ground for a link. Give another ground.',
  shared_website_in_list: 'The list names a record whose website is shared. Decide that one alone. Nothing was written.',
  entries_required: 'Send the list as entries.',
  list_too_long: `A list may carry at most ${MAPPING_LIMITS.MAX_LIST} entries. Nothing was written.`,
  duplicate_entry: 'A record appears twice in the list. Nothing was written.',
  preview_digest_required: 'Name the digest of the preview this list was checked in.',
  preview_stale: 'A named record changed since the preview. Preview again. Nothing was written.',
  state_changed: 'Decisions or records changed while this was being done. Read again. Nothing was written.',
  storage_unavailable: 'The store could not be reached, so nothing was changed. Try again.',
});
const GENERIC = 'This request was refused and nothing was written.';

function refused(c: C, e: unknown): Response {
  if (e instanceof MappingRefusal) {
    return refuse(c, e.status, { code: e.code, message: REFUSAL_SENTENCES[e.code] ?? GENERIC, extra: { names: e.detail } });
  }
  console.warn('[research_source_mappings] failed', (e as Error)?.name ?? 'unknown');
  return refuse(c, 503, { code: 'storage_unavailable', message: REFUSAL_SENTENCES.storage_unavailable });
}

/** The body as text under a byte ceiling, then parsed. */
async function jsonBody(c: C, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new MappingRefusal(413, 'body_too_large', { max_bytes: maxBytes });
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch { throw new MappingRefusal(400, 'invalid_json'); }
}

const actorOf = (u: User) => Number((u as { id: number }).id);

// The staged records, paged, filtered by codes and a source key. Labels come only from the column whose role is name.
r.get('/mappings', async (c) => {
  const user = await researchImportGate(c, requireSuperAdmin);
  if (user instanceof Response) return user;
  try {
    const q = c.req.query();
    return c.json(await listRecords(c.env.DB, filtersFrom({ source: q.source, kind: q.kind, decision: q.decision, outcome: q.outcome, flag: q.flag, offset: q.offset })));
  } catch (e) { return refused(c, e); }
});

// The reconciliation report: a counts-only summary, then the per-record lines for this caller.
r.get('/mappings/report', async (c) => {
  const user = await researchImportGate(c, requireSuperAdmin);
  if (user instanceof Response) return user;
  try {
    const offset = c.req.query('offset');
    const n = offset === undefined ? 0 : Number(offset);
    if (!Number.isSafeInteger(n) || n < 0) throw new MappingRefusal(400, 'filter_invalid', { filter: 'offset' });
    return c.json(await reconciliation(c.env.DB, n));
  } catch (e) { return refused(c, e); }
});

// One record in full. A read, so `requireSuperAdmin`; POST because the ids travel in the body. One audit row a read.
r.post('/mappings/record', async (c) => {
  const user = await researchImportGate(c, requireSuperAdmin);
  if (user instanceof Response) return user;
  try {
    await ensureAdminAuditLogTable(c.env);
    return c.json(await readRecord(c.env.DB, c.env, actorOf(user), await jsonBody(c, MAPPING_LIMITS.MAX_DECIDE_BYTES)));
  } catch (e) { return refused(c, e); }
});

r.post('/mappings/decide', async (c) => {
  const user = await researchImportGate(c, requireSuperAdminWriteBar);
  if (user instanceof Response) return user;
  try {
    await ensureAdminAuditLogTable(c.env);
    return c.json(await decideOne(c.env.DB, c.env, actorOf(user), await jsonBody(c, MAPPING_LIMITS.MAX_DECIDE_BYTES), new Date()));
  } catch (e) { return refused(c, e); }
});

// Preview a list: writes nothing. A read, so `requireSuperAdmin`.
r.post('/mappings/bulk/preview', async (c) => {
  const user = await researchImportGate(c, requireSuperAdmin);
  if (user instanceof Response) return user;
  try {
    return c.json(await previewList(c.env.DB, await jsonBody(c, MAPPING_LIMITS.MAX_LIST_BYTES)));
  } catch (e) { return refused(c, e); }
});

r.post('/mappings/bulk/apply', async (c) => {
  const user = await researchImportGate(c, requireSuperAdminWriteBar);
  if (user instanceof Response) return user;
  try {
    await ensureAdminAuditLogTable(c.env);
    return c.json(await applyList(c.env.DB, c.env, actorOf(user), await jsonBody(c, MAPPING_LIMITS.MAX_LIST_BYTES), new Date()));
  } catch (e) { return refused(c, e); }
});

export default r;
export const mount: RouteMount = { path: '/api/research-source-imports', router: r };
