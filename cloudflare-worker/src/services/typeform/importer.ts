/**
 * D5828 (#5828) — Typeform's incremental response importer for one
 * connection, venture and form (`typeform_form_syncs`). Polling over the
 * Responses API; no webhook.
 *
 * ONCE. A response is one `typeform_responses` row (unique per sync row, which
 * is unique per connection/venture/form). A qualifying mapped answer is one
 * `typeform_answers` row and one `connector_fed_items` row keyed
 * `typeform:<form>:<venture>:<response>:<field>` under the connection's
 * `integration_id`; both are written in ONE D1 batch, and the answer is only
 * inserted while no ledger row holds its key. So a re-run, a duplicate on a
 * later page and two runs at once all land it once, and a withdrawn answer
 * (ledger row kept, `local_id` NULL) is never landed again.
 *
 * CHECKPOINTS. Pages are read oldest first. After every write of a page has
 * resolved, the checkpoint moves to that page's latest completed
 * `submitted_at`, never backwards, and only while this run holds the lease.
 * The next run starts `OVERLAP_MS` before it, so a response Typeform makes
 * visible late still arrives; dedupe absorbs the re-read. A response delayed
 * longer than the overlap is recovered by an intentional backfill.
 *
 * FAILURE. 429 stores `retry_after` and stops; 401/403 is `access_revoked`;
 * 404/410 is `form_unavailable` (deleted, moved or no longer shared). None of
 * these deletes anything. A write that fails mid-page leaves the checkpoint
 * where the last whole page put it, so the retry re-reads the page and lands
 * only what is missing.
 *
 * DELETION. One page's absence never means deletion. Only
 * `reconcileTypeformDeletions` concludes a provider deletion: an explicit
 * `included_response_ids` lookup of the held ids must miss an id twice, at
 * least `RECONCILE_CONFIRM_MS` apart.
 *
 * SELECTION (D5828 part 2). The venture's `typeform_form_bindings` row
 * (#5827) is the only selection. A sync row runs only while that binding
 * names its connection, venture and form (`not_selected` otherwise, nothing
 * stored); `selection.ts` keeps the sync rows' `status` in step with it.
 *
 * GRANT AND REGION (D5828 part 2). `ImportDeps.session` hands over #5827's
 * decrypted access token and the data center recorded with it. Only `us`
 * or `eu` is read; anything else is `region_unknown` and no request is
 * built. The region is copied onto the sync row (no token ever is) so the
 * responses link needs no decryption.
 *
 * NO IDENTITY. Only ids, dates, the response type and the mapped answers'
 * qualifying text are stored; logs carry error names and codes only.
 */
import type { Env } from '../../types';
import { mappingSignature } from './signature';
import { retractTypeformReviews } from './reviewCleanup';
import { TypeformReadError, answerFor, formFields, responseHead, responsesLink, typeformRead, RESPONSE_ID, type FetchLike, type FormField, type ReadTarget, type TypeformErrorCode, type TypeformRegion } from './api';
import { qualifyingAnswer, typeformMapping, MAX_MAPPINGS, type MappingRule } from './mappings';

export const SYNC_LIMITS = Object.freeze({ pageSize: 200, pagesPerRun: 10, reconcileBatch: 25, reconcileMax: 1000 });
export const LEASE_MS = 5 * 60_000;
export const OVERLAP_MS = 24 * 3600_000;
export const RECONCILE_CONFIRM_MS = 3600_000;
export const LEDGER_MODULE = 'demand_signals';
export const LEDGER_KIND = 'typeform_answer';

/** What #5827's encrypted grant gives one run: the access token and the data center recorded at sign-in. */
export interface ImportSession { accessToken: string; region: unknown }
/** Thrown by `ImportDeps.session` while another caller refreshes the grant: the run is `busy`, and nothing is stored. */
export class TypeformSessionBusy extends Error { constructor() { super('session_busy'); this.name = 'TypeformSessionBusy'; } }

export interface ImportDeps {
  fetch: FetchLike;
  /**
   * The connection's grant (#5827 owns it and its refresh; `live.ts` is the
   * production one). A `TypeformReadError` is stored as its code, a
   * `TypeformSessionBusy` is `busy`, and any other throw reads as access revoked.
   */
  session: (integrationId: number) => Promise<ImportSession>;
  now: () => number;
  /** This run's lease owner. */
  runId: string;
  /** Smaller pages for fixtures; production uses `SYNC_LIMITS`. */
  limits?: Partial<{ pageSize: number; pagesPerRun: number }>;
}
export interface SyncKey { integrationId: number; projectId: number; formId: string }
export type SyncOutcome = 'ok' | 'partly' | 'busy' | 'stopped' | 'not_found' | 'not_selected' | 'not_stored' | TypeformErrorCode;
export interface SyncResult {
  outcome: SyncOutcome; pages: number; read: number;
  new_completed: number; new_partial: number; upgraded: number; duplicates: number;
  new_answers: number; skipped_withdrawn: number; needs_remap: string[]; retry_after: string | null;
}

interface SyncRow {
  id: number; integration_id: number; project_id: number; form_id: string; status: string; sync_state: string;
  checkpoint_submitted_at: string | null; retry_after: string | null; region: string | null;
  provider_key: string; integration_status: string; selected: number;
}
interface ActiveMapping { id: number; field_id: string; field_type: string; rule: MappingRule; keep_text: boolean; signature: string }

const iso = (ms: number) => new Date(ms).toISOString();
const changes = (r: any) => Number(r?.meta?.changes ?? 0);
export const ledgerKey = (formId: string, projectId: number, responseId: string, fieldId: string) => `typeform:${formId}:${projectId}:${responseId}:${fieldId}`;

async function loadSync(env: Env, key: SyncKey): Promise<SyncRow | null> {
  return env.DB.prepare(
    `SELECT s.id, s.integration_id, s.project_id, s.form_id, s.status, s.sync_state, s.checkpoint_submitted_at, s.retry_after,
            s.region, i.provider_key, i.status AS integration_status,
            EXISTS (SELECT 1 FROM typeform_form_bindings b
                     WHERE b.project_id = s.project_id AND b.integration_id = s.integration_id AND b.form_id = s.form_id) AS selected
       FROM typeform_form_syncs s JOIN integrations i ON i.id = s.integration_id
      WHERE s.integration_id = ? AND s.project_id = ? AND s.form_id = ?`,
  ).bind(key.integrationId, key.projectId, key.formId).first<SyncRow>();
}

const setState = (env: Env, id: number, state: string, nowIso: string, extra: { retryAfter?: string | null } = {}) => env.DB.prepare(
  `UPDATE typeform_form_syncs SET sync_state = ?, last_error = ?, retry_after = ?, updated_at = ? WHERE id = ?`,
).bind(state, state === 'ok' || state === 'partly' ? null : state, extra.retryAfter ?? null, nowIso, id).run();

async function takeLease(env: Env, id: number, owner: string, now: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE typeform_form_syncs SET lease_owner = ?, lease_until = ?
      WHERE id = ? AND status = 'active' AND (lease_owner IS NULL OR lease_until IS NULL OR datetime(lease_until) <= datetime(?))`,
  ).bind(owner, iso(now + LEASE_MS), id, iso(now)).run();
  return changes(res) === 1;
}
const releaseLease = (env: Env, id: number, owner: string) => env.DB.prepare(
  'UPDATE typeform_form_syncs SET lease_owner = NULL, lease_until = NULL WHERE id = ? AND lease_owner = ?',
).bind(id, owner).run();

/** Hold each mapping to the form as it is now: a rename keeps the field id; a deleted or retyped field is flagged. */
async function reviewMappings(env: Env, syncId: number, fields: FormField[], nowIso: string): Promise<{ active: ActiveMapping[]; flagged: string[] }> {
  const rows = (await env.DB.prepare(
    'SELECT id, field_id, field_type, field_title, kind, rule_json, keep_text, status FROM typeform_field_mappings WHERE sync_id = ? ORDER BY id',
  ).bind(syncId).all<any>()).results || [];
  const active: ActiveMapping[] = []; const flagged: string[] = [];
  for (const row of rows) {
    const field = fields.find((f) => f.id === row.field_id);
    const status = !field ? 'field_deleted' : field.type !== row.field_type ? 'type_changed' : 'active';
    const title = field ? field.title : row.field_title;
    if (status !== row.status || title !== row.field_title) {
      await env.DB.prepare('UPDATE typeform_field_mappings SET status = ?, field_title = ?, updated_at = ? WHERE id = ?').bind(status, title, nowIso, row.id).run();
    }
    if (status !== 'active') { flagged.push(String(row.field_id)); continue; }
    let rule: MappingRule = {};
    try { rule = JSON.parse(row.rule_json || '{}'); } catch { flagged.push(String(row.field_id)); continue; }
    active.push({ id: Number(row.id), field_id: String(row.field_id), field_type: String(row.field_type), rule, keep_text: Number(row.keep_text) === 1, signature: mappingSignature(row) });
  }
  return { active, flagged };
}

type Landed = 'new_completed' | 'new_partial' | 'upgraded' | 'duplicates' | 'skipped_withdrawn';

/** One response and its qualifying mapped answers, in one D1 batch. */
async function writeResponse(env: Env, row: SyncRow, item: any, head: NonNullable<ReturnType<typeof responseHead>>, mappings: ActiveMapping[], nowIso: string): Promise<{ landed: Landed; answers: number }> {
  const held = await env.DB.prepare('SELECT response_type, status FROM typeform_responses WHERE sync_id = ? AND response_id = ?')
    .bind(row.id, head.response_id).first<{ response_type: string; status: string }>();
  if (held && held.status !== 'active') return { landed: 'skipped_withdrawn', answers: 0 };
  const landed: Landed = !held ? (head.response_type === 'completed' ? 'new_completed' : 'new_partial')
    : held.response_type === 'partial' && head.response_type === 'completed' ? 'upgraded' : 'duplicates';
  const statements = [env.DB.prepare(
    `INSERT INTO typeform_responses (sync_id, response_id, response_type, submitted_at, landed_at, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (sync_id, response_id) DO UPDATE SET
       response_type = CASE WHEN excluded.response_type = 'completed' THEN 'completed' ELSE typeform_responses.response_type END,
       submitted_at = COALESCE(excluded.submitted_at, typeform_responses.submitted_at),
       landed_at = COALESCE(typeform_responses.landed_at, excluded.landed_at),
       upstream_missing_at = NULL, last_seen_at = excluded.last_seen_at
     WHERE typeform_responses.status = 'active'`,
  ).bind(row.id, head.response_id, head.response_type, head.submitted_at, head.landed_at, nowIso, nowIso)];
  const answerAt: number[] = [];
  if (head.response_type === 'completed') {
    for (const m of mappings) {
      const hit = qualifyingAnswer(answerFor(item, m.field_id), m);
      if (!hit) continue;
      const key = ledgerKey(row.form_id, row.project_id, head.response_id, m.field_id);
      answerAt.push(statements.length);
      statements.push(env.DB.prepare(
        `INSERT INTO typeform_answers (response_row_id, mapping_id, field_id, answer_text, created_at, mapping_signature)
         SELECT r.id, ?, ?, ?, ?, ? FROM typeform_responses r
          WHERE r.sync_id = ? AND r.response_id = ? AND r.status = 'active' AND r.response_type = 'completed'
            AND NOT EXISTS (SELECT 1 FROM connector_fed_items f WHERE f.integration_id = ? AND f.external_id = ?)
         ON CONFLICT (response_row_id, mapping_id) DO NOTHING`,
      ).bind(m.id, m.field_id, hit.text, nowIso, m.signature, row.id, head.response_id, row.integration_id, key));
      statements.push(env.DB.prepare(
        `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id, first_seen_at, last_seen_at)
         SELECT ?, ?, ?, ?, ?, 'typeform_answers', a.id, ?, ? FROM typeform_answers a JOIN typeform_responses r ON r.id = a.response_row_id
          WHERE r.sync_id = ? AND r.response_id = ? AND a.mapping_id = ?
         ON CONFLICT (integration_id, external_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      ).bind(row.integration_id, row.project_id, LEDGER_MODULE, LEDGER_KIND, key, nowIso, nowIso, row.id, head.response_id, m.id));
    }
  }
  const results = await env.DB.batch(statements);
  return { landed, answers: answerAt.reduce((n, i) => n + changes(results[i]), 0) };
}

const emptyResult = (outcome: SyncOutcome): SyncResult => ({
  outcome, pages: 0, read: 0, new_completed: 0, new_partial: 0, upgraded: 0, duplicates: 0, new_answers: 0, skipped_withdrawn: 0, needs_remap: [], retry_after: null,
});

/** Map a failure to its stored state. Never a provider body, never a token. */
function failure(e: unknown, now: number): { state: SyncOutcome; retryAfter: string | null } {
  if (e instanceof TypeformReadError) return { state: e.code, retryAfter: e.code === 'rate_limited' ? iso(now + (e.retryAfterSec ?? 60) * 1000) : null };
  console.warn('[typeform import] write failed:', (e as Error)?.name ?? 'error');
  return { state: 'not_stored', retryAfter: null };
}

/** Only the two data centers #5827 records; never a default. */
export const validatedRegion = (value: unknown): TypeformRegion | null => (value === 'us' || value === 'eu' ? value : null);

/** The grant for this run. The region goes onto the sync row (for the link); the token goes nowhere but the request. */
async function target(env: Env, deps: ImportDeps, row: SyncRow): Promise<ReadTarget> {
  let session: ImportSession;
  try { session = await deps.session(row.integration_id); } catch (e) {
    if (e instanceof TypeformReadError || e instanceof TypeformSessionBusy) throw e;
    throw new TypeformReadError('access_revoked');
  }
  const region = validatedRegion(session?.region);
  if (region !== row.region) await env.DB.prepare('UPDATE typeform_form_syncs SET region = ? WHERE id = ?').bind(region, row.id).run();
  if (!region) throw new TypeformReadError('region_unknown');
  return { region, token: typeof session.accessToken === 'string' ? session.accessToken : '', formId: row.form_id };
}

/** Preconditions every run checks before it reads: the row, the selection, the connection and the provider's wait. */
async function admit(env: Env, row: SyncRow | null, now: number): Promise<SyncOutcome | null> {
  if (!row || row.provider_key !== 'typeform') return 'not_found';
  if (row.status !== 'active') return 'stopped';
  if (Number(row.selected) !== 1) return 'not_selected';
  if (row.integration_status !== 'active') { await setState(env, row.id, 'access_revoked', iso(now)); return 'access_revoked'; }
  if (row.retry_after && Date.parse(row.retry_after) > now) return 'rate_limited';
  return null;
}

/** One import run for one connection, venture and form. */
export async function syncTypeformForm(env: Env, deps: ImportDeps, key: SyncKey): Promise<SyncResult> {
  const now = deps.now(); const nowIso = iso(now);
  const row = await loadSync(env, key);
  const refused = await admit(env, row, now);
  if (refused) return { ...emptyResult(refused), retry_after: refused === 'rate_limited' ? row?.retry_after ?? null : null };
  const sync = row as SyncRow;
  if (!(await takeLease(env, sync.id, deps.runId, now))) return emptyResult('busy');
  const out = emptyResult('ok');
  const pageSize = Math.min(SYNC_LIMITS.pageSize, Math.max(1, deps.limits?.pageSize ?? SYNC_LIMITS.pageSize));
  const pagesPerRun = Math.min(SYNC_LIMITS.pagesPerRun, Math.max(1, deps.limits?.pagesPerRun ?? SYNC_LIMITS.pagesPerRun));
  try {
    const t = await target(env, deps, sync);
    const form = await typeformRead(deps.fetch, t, 'forms.get');
    const { active, flagged } = await reviewMappings(env, sync.id, formFields(form), nowIso);
    out.needs_remap = flagged;
    const title = typeof form?.title === 'string' ? form.title.slice(0, 300) : null;
    await env.DB.prepare('UPDATE typeform_form_syncs SET form_title = COALESCE(?, form_title) WHERE id = ?').bind(title, sync.id).run();
    // A walk the page cap cut short resumes exactly where it stopped; a finished one re-reads the overlap.
    const overlap = sync.sync_state === 'partly' ? 0 : OVERLAP_MS;
    const since = sync.checkpoint_submitted_at ? iso(Date.parse(sync.checkpoint_submitted_at) - overlap) : null;
    let after: string | null = null; let done = false;
    while (out.pages < pagesPerRun) {
      const query: Record<string, string> = { page_size: String(pageSize), response_type: 'completed,partial' };
      if (active.length) query.fields = active.map((m) => m.field_id).join(',');
      if (since) query.since = since;
      if (after) query.after = after; else query.sort = 'submitted_at,asc';
      const page = await typeformRead(deps.fetch, t, 'responses.list', query);
      out.pages += 1;
      if (!Array.isArray(page?.items)) throw new TypeformReadError('unreadable');
      let pageMax: string | null = null; let last: string | null = null;
      for (const item of page.items) {
        if (typeof item?.token === 'string' && RESPONSE_ID.test(item.token)) last = item.token;
        const head = responseHead(item);
        if (!head) continue;
        out.read += 1;
        last = head.token;
        const w = await writeResponse(env, sync, item, head, active, nowIso);
        out[w.landed] += 1; out.new_answers += w.answers;
        if (head.response_type === 'completed' && head.submitted_at && (!pageMax || Date.parse(head.submitted_at) > Date.parse(pageMax))) pageMax = head.submitted_at;
      }
      // Every write of this page has resolved: only now may the checkpoint move.
      if (pageMax) {
        await env.DB.prepare(
          `UPDATE typeform_form_syncs SET checkpoint_submitted_at = ?
            WHERE id = ? AND lease_owner = ? AND (checkpoint_submitted_at IS NULL OR datetime(checkpoint_submitted_at) < datetime(?))`,
        ).bind(pageMax, sync.id, deps.runId, pageMax).run();
      }
      if (page.items.length < pageSize || !last) { done = true; break; }
      after = last;
    }
    out.outcome = done ? 'ok' : 'partly';
    await env.DB.prepare(
      `UPDATE typeform_form_syncs SET sync_state = ?, last_error = NULL, retry_after = NULL, last_synced_at = ?, updated_at = ?,
              backfill_requested_at = CASE WHEN ? = 1 THEN NULL ELSE backfill_requested_at END
        WHERE id = ?`,
    ).bind(out.outcome, nowIso, nowIso, done ? 1 : 0, sync.id).run();
  } catch (e) {
    if (e instanceof TypeformSessionBusy) { out.outcome = 'busy'; return out; }
    const f = failure(e, now);
    out.outcome = f.state; out.retry_after = f.retryAfter;
    await setState(env, sync.id, f.state, nowIso, { retryAfter: f.retryAfter }).catch(() => {});
  } finally {
    await releaseLease(env, sync.id, deps.runId).catch(() => {});
  }
  return out;
}

// ---------------------------------------------------------------------------
// Provider deletion, backfill, withdrawal, mappings, counts
// ---------------------------------------------------------------------------

/** The batch that removes a response's local answers and keeps their ledger rows, unlinked, so no re-sync lands them. */
async function unlinkAnswers(env: Env, integrationId: number, responseRowId: number) {
  const ids = (await env.DB.prepare('SELECT id FROM typeform_answers WHERE response_row_id = ?').bind(responseRowId).all<{ id: number }>()).results || [];
  return [
    ...retractTypeformReviews(env, ids.map(r => r.id)),
    env.DB.prepare(`UPDATE connector_fed_items SET local_id = NULL
                     WHERE integration_id = ? AND local_table = 'typeform_answers' AND local_id IN (SELECT id FROM typeform_answers WHERE response_row_id = ?)`)
      .bind(integrationId, responseRowId),
    env.DB.prepare('DELETE FROM typeform_answers WHERE response_row_id = ?').bind(responseRowId),
  ];
}

export interface ReconcileResult { outcome: SyncOutcome; checked: number; missing_once: number; provider_deleted: number; reappeared: number }

/**
 * Provider-deletion reconciliation, within what the Responses API documents:
 * an explicit `included_response_ids` lookup of the ids Axal holds. An id the
 * lookup misses is marked; a second miss at least `RECONCILE_CONFIRM_MS`
 * later marks it `provider_deleted` and removes its answers. A failed or
 * malformed lookup concludes nothing.
 */
export async function reconcileTypeformDeletions(env: Env, deps: ImportDeps, key: SyncKey): Promise<ReconcileResult> {
  const now = deps.now(); const nowIso = iso(now);
  const row = await loadSync(env, key);
  const out: ReconcileResult = { outcome: 'ok', checked: 0, missing_once: 0, provider_deleted: 0, reappeared: 0 };
  const refused = await admit(env, row, now);
  if (refused) return { ...out, outcome: refused };
  const sync = row as SyncRow;
  if (!(await takeLease(env, sync.id, deps.runId, now))) return { ...out, outcome: 'busy' };
  try {
    const t = await target(env, deps, sync);
    const held = (await env.DB.prepare(
      "SELECT id, response_id, upstream_missing_at FROM typeform_responses WHERE sync_id = ? AND status = 'active' ORDER BY id LIMIT ?",
    ).bind(sync.id, SYNC_LIMITS.reconcileMax).all<{ id: number; response_id: string; upstream_missing_at: string | null }>()).results || [];
    for (let i = 0; i < held.length; i += SYNC_LIMITS.reconcileBatch) {
      const batch = held.slice(i, i + SYNC_LIMITS.reconcileBatch);
      const page = await typeformRead(deps.fetch, t, 'responses.list', {
        included_response_ids: batch.map((r) => r.response_id).join(','), page_size: String(SYNC_LIMITS.reconcileBatch), response_type: 'completed,partial',
      });
      if (!Array.isArray(page?.items)) throw new TypeformReadError('unreadable');
      const present = new Set(page.items.map((it: any) => responseHead(it)?.response_id).filter(Boolean));
      for (const r of batch) {
        out.checked += 1;
        if (present.has(r.response_id)) {
          if (r.upstream_missing_at) {
            await env.DB.prepare('UPDATE typeform_responses SET upstream_missing_at = NULL, last_seen_at = ? WHERE id = ?').bind(nowIso, r.id).run();
            out.reappeared += 1;
          }
        } else if (!r.upstream_missing_at) {
          await env.DB.prepare('UPDATE typeform_responses SET upstream_missing_at = ? WHERE id = ?').bind(nowIso, r.id).run();
          out.missing_once += 1;
        } else if (now - Date.parse(r.upstream_missing_at) >= RECONCILE_CONFIRM_MS) {
          await env.DB.batch([
            ...await unlinkAnswers(env, sync.integration_id, r.id),
            env.DB.prepare("UPDATE typeform_responses SET status = 'provider_deleted' WHERE id = ? AND status = 'active'").bind(r.id),
          ]);
          out.provider_deleted += 1;
        }
      }
    }
    await env.DB.prepare('UPDATE typeform_form_syncs SET last_reconciled_at = ?, updated_at = ? WHERE id = ?').bind(nowIso, nowIso, sync.id).run();
  } catch (e) {
    if (e instanceof TypeformSessionBusy) { out.outcome = 'busy'; return out; }
    const f = failure(e, now);
    out.outcome = f.state;
    await setState(env, sync.id, f.state, nowIso, { retryAfter: f.retryAfter }).catch(() => {});
  } finally {
    await releaseLease(env, sync.id, deps.runId).catch(() => {});
  }
  return out;
}

interface Scope { integrationId: number; projectId: number }
const syncIdFor = async (env: Env, scope: Scope, formId: string) => (await env.DB.prepare(
  'SELECT id FROM typeform_form_syncs WHERE integration_id = ? AND project_id = ? AND form_id = ?',
).bind(scope.integrationId, scope.projectId, formId).first<{ id: number }>())?.id ?? null;

/** An intentional backfill: the next runs read the whole history again. Withdrawn and provider-deleted items stay so. */
export async function requestTypeformBackfill(env: Env, scope: Scope, formId: string, nowIso: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE typeform_form_syncs SET checkpoint_submitted_at = NULL, backfill_requested_at = ?, sync_state = 'never', updated_at = ?
      WHERE integration_id = ? AND project_id = ? AND form_id = ? AND status = 'active'`,
  ).bind(nowIso, nowIso, scope.integrationId, scope.projectId, formId).run();
  return changes(res) === 1;
}

/** A founder withdraws one imported answer: its text is deleted and its ledger row stays, unlinked. */
export async function withdrawTypeformAnswer(env: Env, scope: Scope, answerId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT a.id FROM typeform_answers a JOIN typeform_responses r ON r.id = a.response_row_id JOIN typeform_form_syncs s ON s.id = r.sync_id
      WHERE a.id = ? AND s.integration_id = ? AND s.project_id = ?`,
  ).bind(answerId, scope.integrationId, scope.projectId).first<{ id: number }>();
  if (!row) return false;
  await env.DB.batch([
    ...retractTypeformReviews(env, [answerId]),
    env.DB.prepare("UPDATE connector_fed_items SET local_id = NULL WHERE integration_id = ? AND local_table = 'typeform_answers' AND local_id = ?").bind(scope.integrationId, answerId),
    env.DB.prepare('DELETE FROM typeform_answers WHERE id = ?').bind(answerId),
  ]);
  return true;
}

/** A founder withdraws a whole response: its answers go, and the response is kept only as a withdrawn id. */
export async function withdrawTypeformResponse(env: Env, scope: Scope, formId: string, responseId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT r.id FROM typeform_responses r JOIN typeform_form_syncs s ON s.id = r.sync_id
      WHERE s.integration_id = ? AND s.project_id = ? AND s.form_id = ? AND r.response_id = ? AND r.status = 'active'`,
  ).bind(scope.integrationId, scope.projectId, formId, responseId).first<{ id: number }>();
  if (!row) return false;
  await env.DB.batch([
    ...await unlinkAnswers(env, scope.integrationId, row.id),
    env.DB.prepare("UPDATE typeform_responses SET status = 'withdrawn' WHERE id = ?").bind(row.id),
  ]);
  return true;
}

/**
 * Replace the form's mappings with these, each checked against the form's
 * current fields. All or nothing: one invalid mapping stores none. A mapping
 * left out is removed with its answers, its ledger rows kept unlinked. The
 * caller (#5830's route) has already checked the member's write role.
 */
export async function setTypeformMappings(env: Env, syncId: number, fields: FormField[], raws: unknown[], nowIso: string): Promise<boolean> {
  if (!Array.isArray(raws) || raws.length > MAX_MAPPINGS) return false;
  const mappings = raws.map((r) => typeformMapping(r, fields));
  if (mappings.some((m) => !m) || new Set(mappings.map((m) => m!.field_id)).size !== mappings.length) return false;
  const sync = await env.DB.prepare('SELECT integration_id FROM typeform_form_syncs WHERE id = ?').bind(syncId).first<{ integration_id: number }>();
  if (!sync) return false;
  const gone = ((await env.DB.prepare('SELECT id, field_id, field_type, kind, rule_json, keep_text FROM typeform_field_mappings WHERE sync_id = ?').bind(syncId).all<any>()).results || [])
    .filter((r) => {
      const next = mappings.find(m => m!.field_id === r.field_id);
      return !next || mappingSignature(r) !== mappingSignature({ ...next, rule_json: JSON.stringify(next.rule) });
    });
  const ids: number[] = [];
  for (const g of gone) {
    const rows = (await env.DB.prepare('SELECT id FROM typeform_answers WHERE mapping_id = ?').bind(g.id).all<{ id: number }>()).results || [];
    ids.push(...rows.map(r => r.id));
  }
  const statements = [...retractTypeformReviews(env, ids), ...gone.flatMap((g) => [
    env.DB.prepare("UPDATE connector_fed_items SET local_id = NULL WHERE integration_id = ? AND local_table = 'typeform_answers' AND local_id IN (SELECT id FROM typeform_answers WHERE mapping_id = ?)")
      .bind(sync.integration_id, g.id),
    env.DB.prepare('DELETE FROM typeform_answers WHERE mapping_id = ?').bind(g.id),
    env.DB.prepare('DELETE FROM typeform_field_mappings WHERE id = ?').bind(g.id),
  ])];
  for (const m of mappings as NonNullable<typeof mappings[number]>[]) {
    const title = fields.find((f) => f.id === m.field_id)?.title ?? null;
    statements.push(env.DB.prepare(
      `INSERT INTO typeform_field_mappings (sync_id, field_id, field_type, field_title, kind, rule_json, keep_text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT (sync_id, field_id) DO UPDATE SET field_type = excluded.field_type, field_title = excluded.field_title, kind = excluded.kind,
         rule_json = excluded.rule_json, keep_text = excluded.keep_text, status = 'active', updated_at = excluded.updated_at`,
    ).bind(syncId, m.field_id, m.field_type, title, m.kind, JSON.stringify(m.rule), m.keep_text ? 1 : 0, nowIso, nowIso));
  }
  await env.DB.batch(statements);
  return true;
}

export interface TypeformFormStatus {
  state: string; active: boolean; last_synced_at: string | null; checkpoint: string | null; link: string | null;
  completed: number; partial: number; qualifying: number; withdrawn: number; provider_deleted: number;
  /** D5828 part 3: ids and status only; a field's title never leaves the Worker. */
  needs_remap: Array<{ field_id: string; status: string }>;
}

/**
 * The form's counts from what is stored. `completed` is the distinct completed
 * response ids Typeform still has (withdrawn ones included, provider-deleted
 * ones not), the figure a founder reconciles against Typeform.
 */
export async function typeformFormStatus(env: Env, scope: Scope, formId: string): Promise<TypeformFormStatus | null> {
  const id = await syncIdFor(env, scope, formId);
  if (id == null) return null;
  const s = await env.DB.prepare(
    'SELECT status, sync_state, last_synced_at, checkpoint_submitted_at, form_id, region FROM typeform_form_syncs WHERE id = ?',
  ).bind(id).first<any>();
  const c = await env.DB.prepare(
    `SELECT COUNT(DISTINCT CASE WHEN response_type = 'completed' AND status <> 'provider_deleted' THEN response_id END) AS completed,
            COUNT(DISTINCT CASE WHEN response_type = 'partial' AND status = 'active' THEN response_id END) AS partial,
            COUNT(DISTINCT CASE WHEN status = 'withdrawn' THEN response_id END) AS withdrawn,
            COUNT(DISTINCT CASE WHEN status = 'provider_deleted' THEN response_id END) AS provider_deleted
       FROM typeform_responses WHERE sync_id = ?`,
  ).bind(id).first<any>();
  const q = await env.DB.prepare(
    `SELECT COUNT(DISTINCT a.response_row_id) AS n FROM typeform_answers a JOIN typeform_responses r ON r.id = a.response_row_id
      WHERE r.sync_id = ? AND r.status = 'active' AND r.response_type = 'completed'`,
  ).bind(id).first<{ n: number }>();
  const remap = (await env.DB.prepare("SELECT field_id, status FROM typeform_field_mappings WHERE sync_id = ? AND status <> 'active' ORDER BY id")
    .bind(id).all<any>()).results || [];
  return {
    state: s.sync_state, active: s.status === 'active', last_synced_at: s.last_synced_at, checkpoint: s.checkpoint_submitted_at,
    link: responsesLink(validatedRegion(s.region), s.form_id),
    completed: Number(c?.completed ?? 0), partial: Number(c?.partial ?? 0), qualifying: Number(q?.n ?? 0),
    withdrawn: Number(c?.withdrawn ?? 0), provider_deleted: Number(c?.provider_deleted ?? 0),
    needs_remap: remap.map((r: any) => ({ field_id: r.field_id, status: r.status })),
  };
}
