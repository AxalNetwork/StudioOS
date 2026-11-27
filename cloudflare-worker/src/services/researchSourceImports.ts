/**
 * D7745 (#7745) — Research imports: the run, chunk, seal, reconcile and removal orchestration behind the Super Admin
 * routes in `routes/research_source_imports.ts`, built on #7742's staging store (`researchSourceRecords.ts`).
 *
 * What this file adds to the store, and nothing more:
 *   · bounds tighter than the store's: at most 50 records and `MAX_CHUNK_BYTES` a chunk, refused before any write;
 *   · one run open at a time (`running`, `uncertain` or `partial` blocks the next until it is sealed Complete or
 *     reconciled), checked inside the run's own INSERT so two opens cannot race past it;
 *   · a chunk is keyed by (run, chunk index): the same chunk again writes nothing, a different one under a used index
 *     is refused;
 *   · owner rule #7739 Q3 = B at the door: a cell under a contact column is refused, never dropped;
 *   · the body hash the client states is recomputed exactly as #7742 defines it (SHA-256 of `bodyJson(cells)`) and a
 *     mismatch refuses the chunk by code and record id;
 *   · a seal that names ids (missing, hash differs, unexpected, altered, refused) against the expected list the
 *     client sends, whose per-source digest must equal the manifest's;
 *   · one `admin_audit_log` row (`adminAuditStatement`) in the same `DB.batch` as each run open, seal, reconcile and
 *     removal. The store's writes come from its statement-returning variants (`openRunStatements`,
 *     `sealStatusStatement`, `removalStatements`, D7745-p3), so this file adds only the audit row, not a copy of them.
 *
 * No function here returns, logs or audits a field value. Refusals name codes, sources, columns, record ids and counts.
 * The package hash recipe is not registered (`HASH_RECIPES` is empty, D7742): every stated row hash is kept as declared
 * and not checked, and the file digest is stored as declared. The computed checks are the stored-body hashes and the
 * store's sorted per-source membership digest.
 */
import type { Env } from '../types';
import { adminAuditStatement } from './adminAudit';
import {
  HASH_RECIPES, SQL as STORE_SQL, bodyJson, membershipDigest, openRunStatements, removalStatements, sealStatusStatement,
  sha256Hex, validateManifest, writeChunk,
  type CellValue, type ColumnClass, type ColumnRule, type ColumnRuleInput, type ContactHandling, type Manifest, type SourceRecordInput,
} from './researchSourceRecords';

/** The import path's bounds (D7745). Tested constants; each is at or under the store's. */
export const IMPORT_LIMITS = Object.freeze({
  /** Records in one chunk. 2,191 records are 44 chunks: a chunk may mix sources. */
  MAX_CHUNK_RECORDS: 50,
  /** A chunk request's body, refused before it is parsed. Under the store's 700 KB bound value. */
  MAX_CHUNK_BYTES: 600_000,
  /** Entries (source key, record id, row hash) one preview request may carry, and one page's share. */
  MAX_PREVIEW_ENTRIES: 5_000,
  PREVIEW_PAGE: 500,
  MAX_PREVIEW_BYTES: 1_000_000,
  /** The expected list a seal carries. */
  MAX_SEAL_ENTRIES: 20_000,
  MAX_SEAL_BYTES: 2_000_000,
  /** Ids named per category in a seal answer; the counts are always whole. */
  NAMED_IDS: 100,
  /** Runs listed, newest first; members returned per read of one run. */
  RUN_LIST: 50,
  MEMBER_PAGE: 1_000,
  /** The store reads seal members in pages of this size. */
  SEAL_PAGE: 200,
});

/** Statuses that hold the import open: a new run is refused while one of these exists. */
export const OPEN_STATUSES = Object.freeze(['running', 'uncertain', 'partial'] as const);

/** The `admin_audit_log` actions this path writes. Details carry the run id, source keys, counts and digests only. */
export const AUDIT_ACTIONS = Object.freeze({
  opened: 'research_source_import_opened',
  sealed: 'research_source_import_sealed',
  reconciled: 'research_source_import_reconciled',
  removal: 'research_source_import_removal',
});

/** A refusal from this file: an HTTP status, a code and names (never a value). */
export class ImportRefusal extends Error {
  status: number;
  code: string;
  detail: Record<string, unknown>;
  constructor(status: number, code: string, detail: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ImportRefusal';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const SEP = '\u001f';
const keyOf = (s: string, i: string) => `${s}${SEP}${i}`;
const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;
const named = (ids: Array<{ source_key: string; provider_record_id: string }>) => ids.slice(0, IMPORT_LIMITS.NAMED_IDS)
  .map((r) => ({ source_key: r.source_key, provider_record_id: r.provider_record_id }));

/* ------------------------------------------------------------------ SQL owned here (constants) */

export const SQL = Object.freeze({
  openRunsCount: `SELECT uid, status FROM research_source_runs WHERE status IN ('running', 'uncertain', 'partial') ORDER BY started_at LIMIT 1`,
  runByKey: `SELECT uid, payload_sha256, status FROM research_source_runs WHERE idempotency_key = ?1`,
  runRow: `SELECT uid, idempotency_key, acted_by_user_id, worker_version, payload_sha256, hash_recipe_id, manifest_json, status,
    counts_json, uncertain_chunks_json, started_at, verified_at FROM research_source_runs WHERE uid = ?1`,
  listRuns: `SELECT uid, acted_by_user_id, worker_version, payload_sha256, status, counts_json, uncertain_chunks_json, started_at,
    verified_at FROM research_source_runs ORDER BY started_at DESC, uid LIMIT ?1`,
  // This chunk's rows, and any row of this run for a record the chunk carries: one read through one bound JSON value.
  chunkHeld: `SELECT source_key, provider_record_id, stated_row_hash, chunk_index FROM research_source_run_records
    WHERE run_uid = ?1 AND (chunk_index = ?2 OR (source_key || char(31) || provider_record_id) IN (SELECT value FROM json_each(?3)))`,
  runMembers: `SELECT source_key, provider_record_id, stated_row_hash, outcome, refusal_code, chunk_index
    FROM research_source_run_records WHERE run_uid = ?1 ORDER BY source_key, provider_record_id`,
  // One statement per preview page: each entry's standing in the store, read through one bound JSON value.
  previewPage: `SELECT json_extract(p.value, '$[0]') AS s, json_extract(p.value, '$[1]') AS i, json_extract(p.value, '$[2]') AS h,
    (SELECT m.scope FROM research_source_removals m WHERE m.lifted_at IS NULL AND m.source_key = json_extract(p.value, '$[0]')
      AND (m.provider_record_id IS NULL OR m.provider_record_id = json_extract(p.value, '$[1]'))
      ORDER BY CASE m.scope WHEN 'source' THEN 0 WHEN 'record' THEN 1 ELSE 2 END LIMIT 1) AS removed_scope,
    EXISTS (SELECT 1 FROM research_source_records r WHERE r.source_key = json_extract(p.value, '$[0]')
      AND r.provider_record_id = json_extract(p.value, '$[1]') AND r.stated_row_hash = json_extract(p.value, '$[2]')) AS same,
    EXISTS (SELECT 1 FROM research_source_records r WHERE r.source_key = json_extract(p.value, '$[0]')
      AND r.provider_record_id = json_extract(p.value, '$[1]')) AS known
    FROM json_each(?1) p`,
  // The store's seal read with each refusal's code, so a seal can name it.
  sealMembers: `SELECT rr.source_key, rr.provider_record_id, rr.stated_row_hash, rr.outcome, rr.refusal_code, r.body_json, r.body_sha256
    FROM research_source_run_records rr LEFT JOIN research_source_records r ON r.source_key = rr.source_key
      AND r.provider_record_id = rr.provider_record_id AND r.stated_row_hash = rr.stated_row_hash
    WHERE rr.run_uid = ?1 ORDER BY rr.source_key, rr.provider_record_id LIMIT ?2 OFFSET ?3`,
  setStatusFrom: `UPDATE research_source_runs SET status = ?2 WHERE uid = ?1 AND status = ?3`,
});

/* ------------------------------------------------------------------ shared reads */

type RuleRow = { source_key: string; column_name: string; class: ColumnClass; contact_handling: ContactHandling | null; role: string | null };
type RunRow = {
  uid: string; idempotency_key: string; acted_by_user_id: number | null; worker_version: string | null; payload_sha256: string;
  hash_recipe_id: string | null; manifest_json: string; status: string; counts_json: string; uncertain_chunks_json: string;
  started_at: string; verified_at: string | null;
};

async function readRules(db: D1Database, sourceKeys: string[]): Promise<Map<string, Map<string, ColumnRule>>> {
  const rows = (await db.prepare(STORE_SQL.rulesFor).bind(JSON.stringify(sourceKeys)).all<RuleRow>()).results ?? [];
  const out = new Map<string, Map<string, ColumnRule>>();
  for (const r of rows) {
    if (!out.has(r.source_key)) out.set(r.source_key, new Map());
    out.get(r.source_key)!.set(r.column_name, { class: r.class, contact: r.contact_handling, role: r.role });
  }
  return out;
}

async function runOrRefuse(db: D1Database, runUid: string): Promise<RunRow> {
  if (typeof runUid !== 'string' || runUid.length === 0 || runUid.length > 80) throw new ImportRefusal(404, 'run_not_found');
  const run = await db.prepare(SQL.runRow).bind(runUid).first<RunRow>();
  if (!run) throw new ImportRefusal(404, 'run_not_found');
  return run;
}

const parseJson = <T>(text: string | null | undefined, fallback: T): T => {
  try { return text ? JSON.parse(text) as T : fallback; } catch { return fallback; }
};
const uncertainChunks = (run: Pick<RunRow, 'uncertain_chunks_json'>) =>
  parseJson<unknown[]>(run.uncertain_chunks_json, []).map(Number).filter(Number.isSafeInteger);

/** A source's declared exclusions (#7739 Q3 = B): whole person records left out before upload. Declared, not checked. */
function checkDeclaredExclusions(manifest: Manifest) {
  for (const s of manifest.sources as Array<Manifest['sources'][0] & { excluded_person_records?: unknown }>) {
    const v = s.excluded_person_records;
    if (v !== undefined && (!Number.isSafeInteger(v) || (v as number) < 0)) {
      throw new ImportRefusal(400, 'manifest_invalid', { source: s.source_key, field: 'excluded_person_records' });
    }
  }
}

/** The run as the routes show it: counts, digests labelled by what proves them, and no value. */
export function runSummary(run: RunRow | Omit<RunRow, 'idempotency_key' | 'hash_recipe_id' | 'manifest_json'>) {
  const manifest = 'manifest_json' in run ? parseJson<Manifest | null>(run.manifest_json, null) : null;
  return {
    uid: run.uid,
    status: run.status,
    acted_by_user_id: run.acted_by_user_id ?? null,
    worker_version: run.worker_version ?? null,
    started_at: run.started_at,
    verified_at: run.verified_at ?? null,
    counts: parseJson<Record<string, unknown>>(run.counts_json, {}),
    uncertain_chunks: uncertainChunks(run),
    file_digest: { sha256: run.payload_sha256, status: 'declared_not_checked' },
    row_hashes: 'declared_not_checked',
    ...(manifest ? {
      sources: manifest.sources.map((s) => ({
        source_key: s.source_key, columns: s.columns.length, expected_records: s.expected_records, expected_cells: s.expected_cells,
        list_digest: { sha256: s.digest, status: 'declared_checked_at_seal' },
        excluded_person_records: (s as { excluded_person_records?: number }).excluded_person_records ?? null,
      })),
    } : {}),
  };
}

/* ------------------------------------------------------------------ preview (writes nothing) */

export type ListEntry = [string, string, string];

function checkEntries(entries: unknown, manifest: Manifest, max: number): ListEntry[] {
  if (!Array.isArray(entries)) throw new ImportRefusal(400, 'entries_invalid');
  if (entries.length > max) throw new ImportRefusal(413, 'too_many_entries', { entries: entries.length, max });
  const sources = new Set(manifest.sources.map((s) => s.source_key));
  const seen = new Set<string>();
  entries.forEach((e, index) => {
    if (!Array.isArray(e) || e.length !== 3 || e.some((x) => typeof x !== 'string' || x.length === 0 || x.length > 200)) {
      throw new ImportRefusal(400, 'entries_invalid', { index });
    }
    if (!sources.has(e[0])) throw new ImportRefusal(400, 'unknown_source', { index, source: e[0] });
    const k = keyOf(e[0], e[1]);
    if (seen.has(k)) throw new ImportRefusal(400, 'duplicate_entry', { source: e[0], provider_record_id: e[1] });
    seen.add(k);
  });
  return entries as ListEntry[];
}

/** Each list's per-source digest, the store's recipe: sorted `id:stated_hash` lines. */
async function listDigests(entries: ListEntry[]): Promise<Map<string, { n: number; digest: string }>> {
  const bySource = new Map<string, Array<{ provider_record_id: string; stated_row_hash: string }>>();
  for (const [s, i, h] of entries) {
    if (!bySource.has(s)) bySource.set(s, []);
    bySource.get(s)!.push({ provider_record_id: i, stated_row_hash: h });
  }
  const out = new Map<string, { n: number; digest: string }>();
  for (const [s, list] of bySource) out.set(s, { n: list.length, digest: await membershipDigest(list) });
  return out;
}

export async function previewImport(db: D1Database, body: { manifest?: unknown; pages?: unknown }) {
  const manifest = validateManifest(body?.manifest as Manifest);
  checkDeclaredExclusions(manifest);
  const pages = body?.pages;
  if (!Array.isArray(pages) || pages.length === 0) throw new ImportRefusal(400, 'pages_required');
  if (pages.some((p) => !Array.isArray(p) || p.length === 0 || p.length > IMPORT_LIMITS.PREVIEW_PAGE)) {
    throw new ImportRefusal(400, 'page_invalid', { max_page: IMPORT_LIMITS.PREVIEW_PAGE });
  }
  const entries = checkEntries((pages as unknown[][]).flat(), manifest, IMPORT_LIMITS.MAX_PREVIEW_ENTRIES);

  const tally = new Map(manifest.sources.map((s) => [s.source_key, { sent: 0, new: 0, unchanged: 0, changed: 0, removed: 0, private_fields_removed: 0 }]));
  for (const page of pages as ListEntry[][]) {
    const rows = (await db.prepare(SQL.previewPage).bind(JSON.stringify(page)).all<{ s: string; i: string; h: string; removed_scope: string | null; same: number; known: number }>()).results ?? [];
    for (const r of rows) {
      const t = tally.get(r.s)!;
      t.sent++;
      if (r.removed_scope === 'source' || r.removed_scope === 'record') t.removed++;
      else {
        if (r.removed_scope === 'private_fields') t.private_fields_removed++;
        if (Number(r.same)) t.unchanged++;
        else if (Number(r.known)) t.changed++;
        else t.new++;
      }
    }
  }
  const digests = await listDigests(entries);
  const emptyDigest = await membershipDigest([]);
  return {
    writes: 'none',
    sources: manifest.sources.map((s) => {
      const t = tally.get(s.source_key)!;
      const d = digests.get(s.source_key);
      return {
        source_key: s.source_key, expected_records: s.expected_records, ...t,
        // Only a whole list can be checked against the manifest's digest; a part of one is not checked.
        list_digest_matches: t.sent === s.expected_records ? (d?.digest ?? emptyDigest) === s.digest : null,
      };
    }),
  };
}

/* ------------------------------------------------------------------ open a run */

export interface OpenImportInput {
  idempotency_key?: unknown;
  manifest?: unknown;
  column_classes?: unknown;
  file_sha256?: unknown;
  hash_recipe_id?: unknown;
}

export async function openImportRun(db: D1Database, env: Env, actorId: number, input: OpenImportInput, now: Date) {
  const key = input?.idempotency_key;
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) throw new ImportRefusal(400, 'idempotency_key_required');
  const fileSha = input?.file_sha256;
  if (typeof fileSha !== 'string' || !HEX64.test(fileSha)) throw new ImportRefusal(400, 'file_digest_invalid');
  // No package recipe is registered (D7742): a run that names one cannot have it applied, so it is refused.
  if (input?.hash_recipe_id !== undefined && input.hash_recipe_id !== null &&
      !(typeof input.hash_recipe_id === 'string' && Object.hasOwn(HASH_RECIPES, input.hash_recipe_id))) {
    throw new ImportRefusal(400, 'hash_recipe_unknown');
  }
  const manifest = validateManifest(input?.manifest as Manifest);
  checkDeclaredExclusions(manifest);

  // The store's open, its writes returned (D7745-p3): the key replay, the removed-source and column-rule checks, and
  // allowHeld never set (#7739 Q3 = B: a `held` contact column is refused, `held_not_enabled`). `exclusive` makes the
  // run insert itself refuse while another run is open, so two opens cannot race past the check below.
  const planned = await openRunStatements(db, {
    idempotencyKey: key, actorUserId: actorId, payloadSha256: fileSha,
    hashRecipeId: typeof input.hash_recipe_id === 'string' ? input.hash_recipe_id : null, manifest,
    columnClasses: input?.column_classes as Record<string, Record<string, ColumnRuleInput>>,
    workerVersion: env.WORKER_DEPLOY_VERSION ?? null, allowHeld: false, now,
  }, { exclusive: true });
  if (planned.replayed) return { run: runSummary(await runOrRefuse(db, planned.run_uid)), replayed: true };
  const open = await db.prepare(SQL.openRunsCount).first<{ uid: string; status: string }>();
  if (open) throw new ImportRefusal(409, 'run_open', { run_uid: open.uid, status: open.status });

  const sourceKeys = manifest.sources.map((s) => s.source_key);
  const runUid = planned.run_uid;
  const [insertRun, ...rest] = planned.statements;
  try {
    await db.batch([
      insertRun,
      // Right after the run insert: `onlyIfChanged` writes the row only if that insert wrote.
      adminAuditStatement(env, actorId, AUDIT_ACTIONS.opened, {
        run_uid: runUid, source_keys: sourceKeys, file_sha256_declared: fileSha,
        list_digests_declared: Object.fromEntries(manifest.sources.map((s) => [s.source_key, s.digest])),
        expected_records: Object.fromEntries(manifest.sources.map((s) => [s.source_key, s.expected_records])),
      }, { onlyIfChanged: true }),
      ...rest,
    ]);
  } catch (e) {
    // The same key sent twice at once: the second insert meets the unique key; answer the first run.
    const again = await db.prepare(SQL.runByKey).bind(key).first<{ uid: string; payload_sha256: string }>();
    if (again && again.payload_sha256 === fileSha) return { run: runSummary(await runOrRefuse(db, again.uid)), replayed: true };
    throw e;
  }
  const mine = await db.prepare(SQL.runRow).bind(runUid).first<RunRow>();
  if (!mine) {
    const other = await db.prepare(SQL.openRunsCount).first<{ uid: string; status: string }>();
    throw new ImportRefusal(409, 'run_open', other ? { run_uid: other.uid, status: other.status } : {});
  }
  return { run: runSummary(mine), replayed: false, chunk_bound: { records: IMPORT_LIMITS.MAX_CHUNK_RECORDS, bytes: IMPORT_LIMITS.MAX_CHUNK_BYTES } };
}

/* ------------------------------------------------------------------ send one chunk */

interface ChunkRecord extends SourceRecordInput { body_sha256?: unknown }

export async function sendChunk(db: D1Database, env: Env, runUid: string, rawBody: string, now: Date) {
  // Bounded before anything is parsed or read.
  const bytes = utf8Bytes(rawBody);
  if (bytes > IMPORT_LIMITS.MAX_CHUNK_BYTES) throw new ImportRefusal(413, 'chunk_too_large', { bytes, max_bytes: IMPORT_LIMITS.MAX_CHUNK_BYTES });
  let body: { chunk_index?: unknown; records?: unknown };
  try { body = JSON.parse(rawBody); } catch { throw new ImportRefusal(400, 'invalid_json'); }
  const chunkIndex = body?.chunk_index;
  if (!Number.isSafeInteger(chunkIndex) || (chunkIndex as number) < 0) throw new ImportRefusal(400, 'chunk_index_invalid');
  const records = body?.records;
  if (!Array.isArray(records) || records.length === 0) throw new ImportRefusal(400, 'chunk_empty');
  if (records.length > IMPORT_LIMITS.MAX_CHUNK_RECORDS) {
    throw new ImportRefusal(413, 'chunk_too_large', { records: records.length, max_records: IMPORT_LIMITS.MAX_CHUNK_RECORDS });
  }

  const run = await runOrRefuse(db, runUid);
  if (run.status !== 'running' && run.status !== 'uncertain') throw new ImportRefusal(409, 'run_not_open', { status: run.status });
  const manifest = JSON.parse(run.manifest_json) as Manifest;
  const rules = await readRules(db, manifest.sources.map((s) => s.source_key));

  // Shape, contact columns and body hashes: every record is checked before anything is written.
  const seen = new Set<string>();
  const mismatched: Array<{ source_key: string; provider_record_id: string }> = [];
  const contact: Array<{ source_key: string; provider_record_id: string; column: string }> = [];
  for (const [index, r] of (records as ChunkRecord[]).entries()) {
    if (!r || typeof r !== 'object' || typeof r.source_key !== 'string' || typeof r.provider_record_id !== 'string' ||
        r.provider_record_id.length === 0 || r.provider_record_id.length > 200 ||
        typeof r.stated_row_hash !== 'string' || r.stated_row_hash.length === 0 || r.stated_row_hash.length > 200 ||
        !Array.isArray(r.cells) || r.cells.some((c) => !Array.isArray(c) || c.length !== 2 || typeof c[0] !== 'string')) {
      throw new ImportRefusal(400, 'record_invalid', { index });
    }
    if (typeof r.body_sha256 !== 'string' || !HEX64.test(r.body_sha256)) {
      throw new ImportRefusal(400, 'body_hash_required', { source: r.source_key, provider_record_id: r.provider_record_id });
    }
    const k = keyOf(r.source_key, r.provider_record_id);
    if (seen.has(k)) throw new ImportRefusal(400, 'duplicate_in_chunk', { source: r.source_key, provider_record_id: r.provider_record_id });
    seen.add(k);
    const sourceRules = rules.get(r.source_key);
    for (const [column] of r.cells) {
      if (sourceRules?.get(column)?.class === 'contact') contact.push({ source_key: r.source_key, provider_record_id: r.provider_record_id, column });
    }
    if (await sha256Hex(bodyJson(r.cells as Array<[string, CellValue]>)) !== r.body_sha256) {
      mismatched.push({ source_key: r.source_key, provider_record_id: r.provider_record_id });
    }
  }
  if (contact.length) throw new ImportRefusal(422, 'contact_column_refused', { records: contact.slice(0, IMPORT_LIMITS.NAMED_IDS) });
  if (mismatched.length) throw new ImportRefusal(422, 'body_hash_mismatch', { records: named(mismatched) });

  // Keyed by (run, chunk index): the same chunk again is a no-op; a used index with other records is refused.
  const sent = (records as ChunkRecord[]).map((r) => keyOf(r.source_key, r.provider_record_id));
  const held = (await db.prepare(SQL.chunkHeld).bind(run.uid, chunkIndex, JSON.stringify(sent))
    .all<{ source_key: string; provider_record_id: string; stated_row_hash: string; chunk_index: number }>()).results ?? [];
  const elsewhere = held.filter((h) => Number(h.chunk_index) !== chunkIndex);
  if (elsewhere.length) {
    throw new ImportRefusal(409, 'record_in_other_chunk', { records: named(elsewhere) });
  }
  const pending = uncertainChunks(run).includes(chunkIndex as number);
  if (held.length && !pending) {
    const mine = new Set(held.map((h) => `${keyOf(h.source_key, h.provider_record_id)}${SEP}${h.stated_row_hash}`));
    const same = mine.size === records.length &&
      (records as ChunkRecord[]).every((r) => mine.has(`${keyOf(r.source_key, r.provider_record_id)}${SEP}${r.stated_row_hash}`));
    if (!same) throw new ImportRefusal(409, 'chunk_index_reused', { chunk_index: chunkIndex as number });
    return { run_uid: run.uid, chunk_index: chunkIndex, status: 'replayed', written: false, counts: null, refused: [] };
  }

  const clean: SourceRecordInput[] = (records as ChunkRecord[]).map((r) => ({
    source_key: r.source_key, provider_record_id: r.provider_record_id, stated_row_hash: r.stated_row_hash,
    captured_at: typeof r.captured_at === 'string' ? r.captured_at : null, cells: r.cells,
    ...(Array.isArray(r.flags) ? { flags: r.flags } : {}),
  }));
  // The store's chunk: four reads and one five-statement batch whose last statement is the run update.
  const result = await writeChunk(db, env, { runUid: run.uid, chunkIndex: chunkIndex as number, records: clean, now, recipes: HASH_RECIPES });
  return {
    run_uid: run.uid, chunk_index: chunkIndex, status: result.status, written: result.status === 'written',
    counts: result.counts, refused: result.refused.slice(0, IMPORT_LIMITS.NAMED_IDS), refused_count: result.refused.length,
  };
}

/* ------------------------------------------------------------------ seal (read-back) */

type Member = { source_key: string; provider_record_id: string; stated_row_hash: string; outcome: string; refusal_code: string | null; body_json: string | null; body_sha256: string | null };

export async function sealImportRun(db: D1Database, env: Env, actorId: number, runUid: string, body: { expected?: unknown }, now: Date) {
  const run = await runOrRefuse(db, runUid);
  if (!(OPEN_STATUSES as readonly string[]).includes(run.status)) throw new ImportRefusal(409, 'run_not_open', { status: run.status });
  const manifest = JSON.parse(run.manifest_json) as Manifest;
  const expected = checkEntries(body?.expected, manifest, IMPORT_LIMITS.MAX_SEAL_ENTRIES);
  // The expected list must be the one the manifest declared: its per-source digest is recomputed and compared.
  const expectedDigests = await listDigests(expected);
  for (const s of manifest.sources) {
    const d = expectedDigests.get(s.source_key);
    const digest = d?.digest ?? await membershipDigest([]);
    if (digest !== s.digest || (d?.n ?? 0) !== s.expected_records) throw new ImportRefusal(400, 'expected_list_mismatch', { source: s.source_key });
  }

  const counts = parseJson<{ cells?: Record<string, Record<string, { stored: number; withheld: number; blank: number }>> }>(run.counts_json, {});
  const members: Member[] = [];
  for (let offset = 0; ; offset += IMPORT_LIMITS.SEAL_PAGE) {
    const page = (await db.prepare(SQL.sealMembers).bind(run.uid, IMPORT_LIMITS.SEAL_PAGE, offset).all<Member>()).results ?? [];
    members.push(...page);
    if (page.length < IMPORT_LIMITS.SEAL_PAGE) break;
  }
  const expectedByKey = new Map(expected.map(([s, i, h]) => [keyOf(s, i), h]));
  const memberKeys = new Set(members.map((m) => keyOf(m.source_key, m.provider_record_id)));
  type Named = { source_key: string; provider_record_id: string };
  const missing: Named[] = []; const hashDiffers: Named[] = []; const unexpected: Named[] = []; const altered: Named[] = [];
  const refused: Array<Named & { code: string }> = [];
  const present = new Map(manifest.sources.map((s) => [s.source_key, 0]));
  const kept = new Map<string, Array<{ provider_record_id: string; stated_row_hash: string }>>(manifest.sources.map((s) => [s.source_key, []]));

  for (const m of members) {
    if (!present.has(m.source_key)) continue;
    const ref = { source_key: m.source_key, provider_record_id: m.provider_record_id };
    if (m.outcome === 'refused') { refused.push({ ...ref, code: m.refusal_code ?? 'refused' }); continue; }
    kept.get(m.source_key)!.push(m);
    const want = expectedByKey.get(keyOf(m.source_key, m.provider_record_id));
    if (want === undefined) unexpected.push(ref);
    else if (want !== m.stated_row_hash) hashDiffers.push(ref);
    if (m.body_json === null || m.body_sha256 === null) missing.push(ref);
    else if (await sha256Hex(m.body_json) !== m.body_sha256) altered.push(ref);
    else present.set(m.source_key, present.get(m.source_key)! + 1);
  }
  for (const [s, i] of expected) if (!memberKeys.has(keyOf(s, i))) missing.push({ source_key: s, provider_record_id: i });

  const sources: Record<string, unknown> = {};
  let complete = true;
  for (const s of manifest.sources) {
    const recomputed = await membershipDigest(kept.get(s.source_key)!);
    const cells = Object.values(counts.cells?.[s.source_key] ?? {}).reduce((sum, c) => sum + c.stored + c.withheld + c.blank, 0);
    const withheld = Object.values(counts.cells?.[s.source_key] ?? {}).reduce((sum, c) => sum + c.withheld, 0);
    const of = <T extends Named>(list: T[]) => list.filter((r) => r.source_key === s.source_key).length;
    const tally = {
      expected: s.expected_records, present: present.get(s.source_key)!, missing: of(missing), hash_differs: of(hashDiffers),
      unexpected: of(unexpected), altered: of(altered), refused: of(refused),
      list_digest: { declared: s.digest, recomputed, matches: recomputed === s.digest },
      cells: { expected: s.expected_cells, counted: cells, withheld, matches: cells === s.expected_cells },
    };
    if (tally.present !== s.expected_records || tally.missing || tally.hash_differs || tally.unexpected || tally.altered ||
        tally.refused || !tally.list_digest.matches || !tally.cells.matches) complete = false;
    sources[s.source_key] = tally;
  }
  const pendingChunks = uncertainChunks(run);
  const status = pendingChunks.length || run.status === 'uncertain' ? 'uncertain' : complete ? 'complete' : 'partial';
  const verifiedAt = status === 'uncertain' ? null : now.toISOString();
  const digests = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, (v as { list_digest: unknown }).list_digest]));
  await db.batch([
    sealStatusStatement(db, run.uid, status, now),
    adminAuditStatement(env, actorId, AUDIT_ACTIONS.sealed, {
      run_uid: run.uid, status, source_keys: manifest.sources.map((s) => s.source_key), list_digests: digests,
      counts: { missing: missing.length, hash_differs: hashDiffers.length, unexpected: unexpected.length, altered: altered.length, refused: refused.length },
      uncertain_chunks: pendingChunks,
    }),
  ]);
  return {
    run_uid: run.uid, status, verified_at: verifiedAt, sources, uncertain_chunks: pendingChunks,
    file_digest: { sha256: run.payload_sha256, status: 'declared_not_checked' },
    named: {
      missing: named(missing), hash_differs: named(hashDiffers), unexpected: named(unexpected), altered: named(altered),
      refused: refused.slice(0, IMPORT_LIMITS.NAMED_IDS),
    },
  };
}

/* ------------------------------------------------------------------ reconcile */

/**
 * A partial or uncertain run blocks the next until it is reconciled:
 *   `resume` puts a partial run back to running, so the missing chunks can be sent and the run sealed again;
 *   `close` ends a partial or uncertain run as `failed`. Its stored records stay; it no longer blocks.
 * An uncertain run is resumed by sending its uncertain chunks again (the chunk route), never by `resume`.
 */
export async function reconcileImportRun(db: D1Database, env: Env, actorId: number, runUid: string, body: { action?: unknown }, now: Date) {
  const action = body?.action;
  if (action !== 'resume' && action !== 'close') throw new ImportRefusal(400, 'reconcile_action_invalid');
  const run = await runOrRefuse(db, runUid);
  const from = run.status;
  if (action === 'resume' && from === 'uncertain') throw new ImportRefusal(409, 'resend_uncertain_chunks', { chunks: uncertainChunks(run).join(',') });
  if (action === 'resume' && from !== 'partial') throw new ImportRefusal(409, 'run_not_partial', { status: from });
  if (action === 'close' && from !== 'partial' && from !== 'uncertain') throw new ImportRefusal(409, 'run_not_reconcilable', { status: from });
  const to = action === 'resume' ? 'running' : 'failed';
  const res = await db.batch([
    db.prepare(SQL.setStatusFrom).bind(run.uid, to, from),
    adminAuditStatement(env, actorId, AUDIT_ACTIONS.reconciled, {
      run_uid: run.uid, action, from, to, at: now.toISOString(), counts: parseJson<Record<string, unknown>>(run.counts_json, {}).outcomes ?? {},
    }, { onlyIfChanged: true }),
  ]);
  if (!Number(res?.[0]?.meta?.changes ?? 0)) throw new ImportRefusal(409, 'run_changed', { status: from });
  return { run: runSummary(await runOrRefuse(db, run.uid)), action };
}

/* ------------------------------------------------------------------ reads */

export async function listImportRuns(db: D1Database) {
  const rows = (await db.prepare(SQL.listRuns).bind(IMPORT_LIMITS.RUN_LIST).all<RunRow>()).results ?? [];
  return { runs: rows.map((r) => runSummary(r)), limit: IMPORT_LIMITS.RUN_LIST };
}

/** One run: counts, ids and hashes (never a body), the digests recomputed from the store, and the chunks it holds. */
export async function readImportRun(db: D1Database, runUid: string, offset: number) {
  const run = await runOrRefuse(db, runUid);
  const manifest = JSON.parse(run.manifest_json) as Manifest;
  const rows = (await db.prepare(SQL.runMembers).bind(run.uid).all<{ source_key: string; provider_record_id: string; stated_row_hash: string; outcome: string; refusal_code: string | null; chunk_index: number }>()).results ?? [];
  const digests: Record<string, unknown> = {};
  for (const s of manifest.sources) {
    const kept = rows.filter((r) => r.source_key === s.source_key && r.outcome !== 'refused');
    const recomputed = await membershipDigest(kept);
    digests[s.source_key] = { declared: s.digest, recomputed, matches: recomputed === s.digest, members: kept.length };
  }
  const chunks = [...new Set(rows.map((r) => Number(r.chunk_index)))].sort((a, b) => a - b);
  const start = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
  return {
    run: runSummary(run),
    held_chunks: chunks,
    list_digests: digests,
    members: rows.slice(start, start + IMPORT_LIMITS.MEMBER_PAGE).map((r) => ({
      source_key: r.source_key, provider_record_id: r.provider_record_id, stated_row_hash: r.stated_row_hash,
      outcome: r.outcome, refusal_code: r.refusal_code, chunk_index: Number(r.chunk_index),
    })),
    members_total: rows.length,
    offset: start,
    next_offset: start + IMPORT_LIMITS.MEMBER_PAGE < rows.length ? start + IMPORT_LIMITS.MEMBER_PAGE : null,
  };
}

/* ------------------------------------------------------------------ removals */

const SOURCE_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;

export async function removeImported(db: D1Database, env: Env, actorId: number, body: { scope?: unknown; source_key?: unknown; provider_record_id?: unknown }, now: Date) {
  const scope = body?.scope;
  if (scope !== 'private_fields' && scope !== 'record' && scope !== 'source') throw new ImportRefusal(400, 'removal_scope_invalid');
  const sourceKey = body?.source_key;
  if (typeof sourceKey !== 'string' || !SOURCE_KEY.test(sourceKey)) throw new ImportRefusal(400, 'source_key_invalid');
  const given = body?.provider_record_id;
  if (scope !== 'source' && (typeof given !== 'string' || given.length === 0 || given.length > 200)) throw new ImportRefusal(400, 'provider_record_id_required');
  const id = scope === 'source' ? null : given as string;
  if (scope === 'source' && body?.provider_record_id !== undefined && body.provider_record_id !== null) throw new ImportRefusal(400, 'provider_record_id_not_allowed');
  // A chunk planned before the removal could land after it: no removal while a run is open.
  const open = await db.prepare(SQL.openRunsCount).first<{ uid: string; status: string }>();
  if (open) throw new ImportRefusal(409, 'run_open', { run_uid: open.uid, status: open.status });

  // The store's removal, its writes returned (D7745-p3), with the audit row added to the same batch.
  const { counts, statements } = await removalStatements(db, scope, { sourceKey, providerRecordId: id ?? undefined, actorUserId: actorId, now });
  await db.batch([...statements,
    adminAuditStatement(env, actorId, AUDIT_ACTIONS.removal, { scope, source_key: sourceKey, provider_record_id: id, counts })]);
  return { scope, source_key: sourceKey, provider_record_id: id, counts };
}
