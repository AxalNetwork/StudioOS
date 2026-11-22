/**
 * D7742 (#7742) — Research imports: the private staging store, where a source record is kept whole and unchanged.
 *
 * The one staging store and run ledger for Research imports (fund-side, company and funding-round records alike).
 * No route calls it yet. It never merges two records (identity is #7746's and the Companies plan's), computes no
 * flags (#7747 does) and returns no private field's value (#7746 adds the one gated read).
 *
 *   · `planChunk` is the pure planner shared by preview and run: new, unchanged, new version, refused. It takes its
 *     clock as an argument and makes no database call.
 *   · `openRun` fixes each source's column rules on its first run and refuses a request that disagrees with them.
 *   · `writeChunk` writes one chunk in one `DB.batch` with its run-record rows and the run's counts, in a fixed
 *     number of statements (identities are read per chunk through one bound JSON value, never per record). A batch
 *     whose outcome is unknown leaves the run `uncertain`; sending the same chunk again (`reconcileChunk`) settles it.
 *   · `sealRun` reads back against the run's membership and only then says Complete.
 *   · `removePrivateFields`, `removeRecord`, `removeSource`: each recorded; an active removal refuses later runs.
 *
 * Owner rule #7739 Q3 = B: contact columns, personal profile links and whole person records are never uploaded.
 * A contact column is withheld by default (never written, only counted). The held (encrypted) path exists for a
 * later source and needs `allowHeld` at run open; no caller sets it for the four-source package.
 */
import { encryptColumn } from './columnCipher';
import type { Env } from '../types';

type CipherEnv = Pick<Env, 'KEK_PII' | 'JWT_SECRET' | 'ENVIRONMENT' | 'STUDIOOS_ENV'>;

/** Limits as tested constants (D7742). The test database does not enforce D1's, so the tests prove these. */
export const LIMITS = Object.freeze({
  /** D1: at most 100 bound parameters a statement. Every statement here binds three or fewer. */
  MAX_BOUND_PARAMS: 100,
  /** D1: statement text under 100 KB. Every statement here is a constant of a few hundred bytes. */
  MAX_STATEMENT_TEXT_BYTES: 100_000,
  /** One bound value (a chunk as JSON): far under D1's 2 MB row and value limit. */
  MAX_BOUND_VALUE_BYTES: 700_000,
  /** One record's stored body. */
  MAX_RECORD_BODY_BYTES: 256_000,
  MAX_CHUNK_RECORDS: 100,
  MAX_MANIFEST_BYTES: 64_000,
  MAX_SOURCES: 20,
  MAX_COLUMNS: 200,
  /** Four reads and a five-statement batch, whatever the chunk holds. */
  STATEMENTS_PER_CHUNK: 9,
});

export type CellValue = string | number | boolean | null | CellValue[];
export type ColumnClass = 'fact' | 'prose' | 'contact';
export type ContactHandling = 'withheld' | 'held';

export interface ManifestSource {
  source_key: string;
  /** Column names in source order. */
  columns: string[];
  expected_records: number;
  expected_cells: number;
  /** SHA-256 (hex) over the sorted `id:stated_hash` lines (`membershipDigest`). */
  digest: string;
}
export interface Manifest { sources: ManifestSource[] }

export interface ColumnRuleInput { class: ColumnClass; contact?: ContactHandling; role?: string | null }
export interface ColumnRule { class: ColumnClass; contact: ContactHandling | null; role: string | null }

export interface FlagInput { column?: string | null; code: string; detail?: string | null; rule_version: string }
export interface SourceRecordInput {
  source_key: string;
  provider_record_id: string;
  stated_row_hash: string;
  captured_at?: string | null;
  /** The record's cells as captured, in source order. An absent column is simply not listed. */
  cells: Array<[string, CellValue]>;
  flags?: FlagInput[];
}

/** A package hash recipe. None is registered: the four-source package's recipe has not been supplied (D7742). */
export interface HashRecipe { id: string; wholeRecordHash(cells: Array<[string, CellValue]>): Promise<string> }
export const HASH_RECIPES: Readonly<Record<string, HashRecipe>> = Object.freeze({});

/** A refusal. Its message and detail name codes, sources, columns and record ids, never a value. */
export class SourceStoreRefusal extends Error {
  code: string;
  detail: Record<string, string | number>;
  constructor(code: string, detail: Record<string, string | number> = {}) {
    const named = Object.entries(detail).map(([k, v]) => `${k}=${v}`).join(' ');
    super(named ? `${code}: ${named}` : code);
    this.name = 'SourceStoreRefusal';
    this.code = code;
    this.detail = detail;
  }
}

const SOURCE_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const keyOf = (source: string, id: string) => `${source}\u001f${id}`;
const utf8 = (s: string) => new TextEncoder().encode(s);

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The per-source digest: SHA-256 over `id:stated_hash` lines, sorted by code unit, joined by `\n`, no final newline. */
export function membershipDigest(members: Array<{ provider_record_id: string; stated_row_hash: string }>): Promise<string> {
  const lines = members.map((m) => `${m.provider_record_id}:${m.stated_row_hash}`).sort();
  return sha256Hex(lines.join('\n'));
}

/** The body as stored: the non-contact cells, `[[column, value], …]` in source order, with no reformatting. */
export function bodyJson(cells: Array<[string, CellValue]>): string { return JSON.stringify(cells); }

/** No lone surrogate: text must survive the round trip through SQLite's JSON functions byte for byte. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const wellFormedText = (s: string) => !LONE_SURROGATE.test(s);
function wellFormed(value: CellValue): boolean {
  if (typeof value === 'string') return wellFormedText(value);
  if (Array.isArray(value)) return value.every(wellFormed);
  return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}
const isBlank = (present: boolean, value: CellValue) => !present || value === null || value === '';

/* ------------------------------------------------------------------ manifest and rules */

export function validateManifest(manifest: Manifest): Manifest {
  const text = JSON.stringify(manifest ?? null);
  if (utf8(text).byteLength > LIMITS.MAX_MANIFEST_BYTES) throw new SourceStoreRefusal('manifest_too_large', { bytes: utf8(text).byteLength });
  const sources = manifest?.sources;
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > LIMITS.MAX_SOURCES) throw new SourceStoreRefusal('manifest_invalid', { field: 'sources' });
  const seen = new Set<string>();
  for (const s of sources) {
    if (typeof s?.source_key !== 'string' || !SOURCE_KEY.test(s.source_key) || seen.has(s.source_key)) throw new SourceStoreRefusal('manifest_invalid', { field: 'source_key' });
    seen.add(s.source_key);
    const cols = s.columns;
    if (!Array.isArray(cols) || cols.length === 0 || cols.length > LIMITS.MAX_COLUMNS ||
        cols.some((c) => typeof c !== 'string' || c.length === 0 || c.length > 200 || !wellFormedText(c)) || new Set(cols).size !== cols.length) {
      throw new SourceStoreRefusal('manifest_invalid', { source: s.source_key, field: 'columns' });
    }
    for (const field of ['expected_records', 'expected_cells'] as const) {
      if (!Number.isSafeInteger(s[field]) || s[field] < 0) throw new SourceStoreRefusal('manifest_invalid', { source: s.source_key, field });
    }
    if (typeof s.digest !== 'string' || !HEX64.test(s.digest)) throw new SourceStoreRefusal('manifest_invalid', { source: s.source_key, field: 'digest' });
  }
  return manifest;
}

/** The rules a request states, checked against the manifest: every column needs a class; none may be extra. */
export function rulesFromRequest(manifest: Manifest, classes: Record<string, Record<string, ColumnRuleInput>>, allowHeld = false): Map<string, Map<string, ColumnRule>> {
  const out = new Map<string, Map<string, ColumnRule>>();
  for (const s of manifest.sources) {
    const given = classes?.[s.source_key] ?? {};
    for (const column of Object.keys(given)) {
      if (!s.columns.includes(column)) throw new SourceStoreRefusal('column_not_in_manifest', { source: s.source_key, column });
    }
    const rules = new Map<string, ColumnRule>();
    for (const column of s.columns) {
      const r = given[column];
      if (!r || !['fact', 'prose', 'contact'].includes(r.class)) throw new SourceStoreRefusal('column_class_missing', { source: s.source_key, column });
      let contact: ContactHandling | null = null;
      if (r.class === 'contact') {
        contact = r.contact ?? 'withheld';
        if (contact !== 'withheld' && contact !== 'held') throw new SourceStoreRefusal('contact_handling_invalid', { source: s.source_key, column });
        if (contact === 'held' && !allowHeld) throw new SourceStoreRefusal('held_not_enabled', { source: s.source_key, column });
      } else if (r.contact) {
        throw new SourceStoreRefusal('contact_handling_invalid', { source: s.source_key, column });
      }
      const role = r.role ?? null;
      if (role !== null && (typeof role !== 'string' || role.length === 0 || role.length > 40)) throw new SourceStoreRefusal('role_invalid', { source: s.source_key, column });
      rules.set(column, { class: r.class, contact, role });
    }
    out.set(s.source_key, rules);
  }
  return out;
}

/* ------------------------------------------------------------------ the planner */

export interface PlannedRecord {
  source_key: string;
  provider_record_id: string;
  stated_row_hash: string;
  outcome: 'new' | 'unchanged' | 'new_version' | 'refused';
  refusal_code: string | null;
  body_sha256: string | null;
  hash_checked: 0 | 1;
  columns_json: string | null;
  body_json: string | null;
  captured_at: string | null;
  /** Per manifest column: s stored, w withheld, b blank. Names only. */
  cells: Record<string, 's' | 'w' | 'b'>;
  /** Held contact columns to encrypt from the input (their values are never copied into the plan). */
  held_columns: string[];
  flags: FlagInput[];
}
export interface ChunkPlan { planned_at: string; records: PlannedRecord[]; counts: Record<string, number> }

export interface PlanInput {
  manifest: Manifest;
  rules: Map<string, Map<string, ColumnRule>>;
  /** Stored identities: (source, id) → stated hashes already kept. */
  existing: Map<string, Set<string>>;
  removals: { sources: Set<string>; records: Set<string>; privateFields: Set<string> };
  records: SourceRecordInput[];
  recipe: HashRecipe | null;
  now: Date;
}

export async function planChunk(input: PlanInput): Promise<ChunkPlan> {
  const bySource = new Map(input.manifest.sources.map((s) => [s.source_key, s]));
  const seen = new Set<string>();
  const planned: PlannedRecord[] = [];
  const counts: Record<string, number> = { new: 0, unchanged: 0, new_version: 0, refused: 0, hash_checked: 0 };
  for (const rec of input.records) {
    const source = bySource.get(rec?.source_key);
    const base: PlannedRecord = {
      source_key: String(rec?.source_key ?? ''), provider_record_id: String(rec?.provider_record_id ?? ''),
      stated_row_hash: String(rec?.stated_row_hash ?? ''), outcome: 'refused', refusal_code: null, body_sha256: null,
      hash_checked: 0, columns_json: null, body_json: null, captured_at: null, cells: {}, held_columns: [], flags: [],
    };
    const refuse = (code: string) => { planned.push({ ...base, refusal_code: code }); counts.refused++; };
    if (!source) { refuse('unknown_source'); continue; }
    if (typeof rec.provider_record_id !== 'string' || rec.provider_record_id.length === 0 || rec.provider_record_id.length > 200 ||
        typeof rec.stated_row_hash !== 'string' || rec.stated_row_hash.length === 0 || rec.stated_row_hash.length > 200 || !Array.isArray(rec.cells)) {
      refuse('invalid_record'); continue;
    }
    const key = keyOf(rec.source_key, rec.provider_record_id);
    if (seen.has(key)) { refuse('duplicate_in_chunk'); continue; }
    seen.add(key);
    if (input.removals.sources.has(rec.source_key)) { refuse('source_removed'); continue; }
    if (input.removals.records.has(key)) { refuse('record_removed'); continue; }
    const rules = input.rules.get(rec.source_key)!;
    const names = rec.cells.map((c) => (Array.isArray(c) ? c[0] : undefined));
    if (names.some((n) => typeof n !== 'string' || !rules.has(n))) { refuse('unknown_column'); continue; }
    if (new Set(names).size !== names.length) { refuse('duplicate_column'); continue; }
    if (!rec.cells.every((c) => c.length === 2 && wellFormed(c[1]))) { refuse('invalid_value'); continue; }

    const values = new Map(rec.cells.map(([n, v]) => [n, v]));
    const kept: Array<[string, CellValue]> = [];
    const held: string[] = [];
    const cells: Record<string, 's' | 'w' | 'b'> = {};
    for (const column of source.columns) {
      const rule = rules.get(column)!;
      const present = values.has(column);
      const value = values.get(column) ?? null;
      if (rule.class === 'contact') {
        // Withheld: dropped here, before any write, and only counted. Held: encrypted later from the input.
        if (rule.contact === 'held' && present && !isBlank(present, value) && !input.removals.privateFields.has(key)) {
          held.push(column); cells[column] = 's';
        } else cells[column] = rule.contact === 'held' && isBlank(present, value) ? 'b' : 'w';
        continue;
      }
      cells[column] = isBlank(present, value) ? 'b' : 's';
    }
    for (const [n, v] of rec.cells) if (rules.get(n)!.class !== 'contact') kept.push([n, v]);
    const body = bodyJson(kept);
    if (utf8(body).byteLength > LIMITS.MAX_RECORD_BODY_BYTES) { refuse('record_too_large'); continue; }

    let checked: 0 | 1 = 0;
    const whole = source.columns.every((c) => values.has(c));
    if (input.recipe && whole) {
      if (await input.recipe.wholeRecordHash(rec.cells) !== rec.stated_row_hash) { refuse('hash_mismatch'); continue; }
      checked = 1;
    }
    const hashes = input.existing.get(key);
    const outcome = hashes?.has(rec.stated_row_hash) ? 'unchanged' : hashes?.size ? 'new_version' : 'new';
    planned.push({
      ...base, outcome, body_sha256: await sha256Hex(body), hash_checked: checked,
      columns_json: JSON.stringify(names), body_json: body,
      captured_at: typeof rec.captured_at === 'string' ? rec.captured_at : null,
      cells, held_columns: outcome === 'unchanged' ? [] : held,
      flags: outcome === 'unchanged' ? [] : (rec.flags ?? []),
    });
    counts[outcome]++;
    counts.hash_checked += checked;
  }
  return { planned_at: input.now.toISOString(), records: planned, counts };
}

/* ------------------------------------------------------------------ SQL (constants; tested for size and binds) */

export const SQL = Object.freeze({
  runByKey: `SELECT uid, payload_sha256 FROM research_source_runs WHERE idempotency_key = ?1`,
  rulesFor: `SELECT source_key, column_name, class, contact_handling, role FROM research_source_column_rules
    WHERE source_key IN (SELECT value FROM json_each(?1)) ORDER BY source_key, column_order`,
  activeRemovals: `SELECT scope, source_key, provider_record_id FROM research_source_removals
    WHERE lifted_at IS NULL AND source_key IN (SELECT value FROM json_each(?1))`,
  insertRun: `INSERT INTO research_source_runs (uid, idempotency_key, acted_by_user_id, worker_version, payload_sha256,
    hash_recipe_id, manifest_json, status, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8)`,
  insertRules: `INSERT INTO research_source_column_rules (source_key, column_name, column_order, class, contact_handling, role,
    fixed_at, fixed_by_run_uid)
    SELECT json_extract(value, '$.s'), json_extract(value, '$.c'), json_extract(value, '$.o'), json_extract(value, '$.k'),
      json_extract(value, '$.h'), json_extract(value, '$.r'), ?2, ?3 FROM json_each(?1)`,
  runForChunk: `SELECT uid, status, manifest_json, hash_recipe_id FROM research_source_runs WHERE uid = ?1`,
  identities: `SELECT source_key, provider_record_id, stated_row_hash FROM research_source_records
    WHERE (source_key || char(31) || provider_record_id) IN (SELECT value FROM json_each(?1))`,
  insertRecords: `INSERT OR IGNORE INTO research_source_records (source_key, provider_record_id, stated_row_hash, body_sha256,
    hash_checked, columns_json, body_json, captured_at, first_run_uid)
    SELECT json_extract(value, '$.s'), json_extract(value, '$.i'), json_extract(value, '$.h'), json_extract(value, '$.b'),
      json_extract(value, '$.k'), json_extract(value, '$.cols'), json_extract(value, '$.body'), json_extract(value, '$.at'), ?2
    FROM json_each(?1) WHERE json_extract(value, '$.o') IN ('new', 'new_version')`,
  insertRunRecords: `INSERT OR IGNORE INTO research_source_run_records (run_uid, source_key, provider_record_id, stated_row_hash,
    body_sha256, hash_checked, outcome, refusal_code, cells_json, chunk_index)
    SELECT ?2, json_extract(value, '$.s'), json_extract(value, '$.i'), json_extract(value, '$.h'), json_extract(value, '$.b'),
      json_extract(value, '$.k'), json_extract(value, '$.o'), json_extract(value, '$.r'), json_extract(value, '$.cells'), ?3
    FROM json_each(?1)`,
  insertPrivate: `INSERT OR IGNORE INTO research_source_private_fields (record_id, column_name, ciphertext)
    SELECT r.id, json_extract(p.value, '$.c'), json_extract(p.value, '$.ct') FROM json_each(?1) p
    JOIN research_source_records r ON r.source_key = json_extract(p.value, '$.s')
      AND r.provider_record_id = json_extract(p.value, '$.i') AND r.stated_row_hash = json_extract(p.value, '$.h')`,
  insertFlags: `INSERT OR IGNORE INTO research_source_flags (record_id, column_name, flag_code, detail, rule_version)
    SELECT r.id, json_extract(f.value, '$.c'), json_extract(f.value, '$.code'), json_extract(f.value, '$.d'), json_extract(f.value, '$.v')
    FROM json_each(?1) f JOIN research_source_records r ON r.source_key = json_extract(f.value, '$.s')
      AND r.provider_record_id = json_extract(f.value, '$.i') AND r.stated_row_hash = json_extract(f.value, '$.h')`,
  // Counts are recomputed from the run's own rows, so a replayed chunk never counts twice.
  updateCounts: `UPDATE research_source_runs SET
    counts_json = json_object(
      'outcomes', COALESCE((SELECT json_group_object(outcome, n) FROM (SELECT outcome, COUNT(*) AS n
        FROM research_source_run_records WHERE run_uid = ?1 GROUP BY outcome)), json('{}')),
      'hash_checked', (SELECT COUNT(*) FROM research_source_run_records WHERE run_uid = ?1 AND hash_checked = 1),
      'cells', COALESCE((SELECT json_group_object(source_key, json(cols)) FROM (
        SELECT source_key, json_group_object(col, json(kinds)) AS cols FROM (
          SELECT source_key, col, json_object('stored', SUM(kind = 's'), 'withheld', SUM(kind = 'w'), 'blank', SUM(kind = 'b')) AS kinds
          FROM (SELECT rr.source_key AS source_key, je.key AS col, je.value AS kind
            FROM research_source_run_records rr, json_each(rr.cells_json) je WHERE rr.run_uid = ?1)
          GROUP BY source_key, col)
        GROUP BY source_key)), json('{}'))),
    status = CASE WHEN status = 'uncertain' AND NOT EXISTS
      (SELECT 1 FROM json_each(uncertain_chunks_json) WHERE value != ?2) THEN 'running' ELSE status END,
    uncertain_chunks_json = COALESCE((SELECT json_group_array(value) FROM json_each(uncertain_chunks_json) WHERE value != ?2), '[]')
    WHERE uid = ?1`,
  markUncertain: `UPDATE research_source_runs SET status = 'uncertain',
    uncertain_chunks_json = CASE WHEN EXISTS (SELECT 1 FROM json_each(uncertain_chunks_json) WHERE value = ?2)
      THEN uncertain_chunks_json ELSE json_insert(uncertain_chunks_json, '$[#]', ?2) END
    WHERE uid = ?1`,
  sealRun: `SELECT uid, status, manifest_json, counts_json, uncertain_chunks_json FROM research_source_runs WHERE uid = ?1`,
  sealMembers: `SELECT rr.source_key, rr.provider_record_id, rr.stated_row_hash, rr.outcome, r.body_json, r.body_sha256
    FROM research_source_run_records rr LEFT JOIN research_source_records r ON r.source_key = rr.source_key
      AND r.provider_record_id = rr.provider_record_id AND r.stated_row_hash = rr.stated_row_hash
    WHERE rr.run_uid = ?1 ORDER BY rr.source_key, rr.provider_record_id LIMIT ?2 OFFSET ?3`,
  setStatus: `UPDATE research_source_runs SET status = ?2, verified_at = ?3 WHERE uid = ?1`,
  countRecordPrivate: `SELECT COUNT(*) AS n FROM research_source_private_fields WHERE record_id IN
    (SELECT id FROM research_source_records WHERE source_key = ?1 AND provider_record_id = ?2)`,
  countRecord: `SELECT
      (SELECT COUNT(*) FROM research_source_records WHERE source_key = ?1 AND (?2 IS NULL OR provider_record_id = ?2)) AS records,
      (SELECT COUNT(*) FROM research_source_private_fields WHERE record_id IN (SELECT id FROM research_source_records
        WHERE source_key = ?1 AND (?2 IS NULL OR provider_record_id = ?2))) AS private_fields,
      (SELECT COUNT(*) FROM research_source_flags WHERE record_id IN (SELECT id FROM research_source_records
        WHERE source_key = ?1 AND (?2 IS NULL OR provider_record_id = ?2))) AS flags`,
  deletePrivate: `DELETE FROM research_source_private_fields WHERE record_id IN
    (SELECT id FROM research_source_records WHERE source_key = ?1 AND (?2 IS NULL OR provider_record_id = ?2))`,
  deleteFlags: `DELETE FROM research_source_flags WHERE record_id IN
    (SELECT id FROM research_source_records WHERE source_key = ?1 AND (?2 IS NULL OR provider_record_id = ?2))`,
  deleteRecords: `DELETE FROM research_source_records WHERE source_key = ?1 AND (?2 IS NULL OR provider_record_id = ?2)`,
  insertRemoval: `INSERT INTO research_source_removals (actor_user_id, removed_at, scope, source_key, provider_record_id, counts_json)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  liftRemoval: `UPDATE research_source_removals SET lifted_at = ?2, lifted_by_user_id = ?3 WHERE id = ?1 AND lifted_at IS NULL`,
});

/* ------------------------------------------------------------------ open a run */

export interface OpenRunInput {
  idempotencyKey: string;
  actorUserId: number | null;
  payloadSha256: string;
  hashRecipeId: string | null;
  manifest: Manifest;
  columnClasses: Record<string, Record<string, ColumnRuleInput>>;
  workerVersion?: string | null;
  /** Off for the four-source package (#7739 Q3 = B). */
  allowHeld?: boolean;
  now: Date;
}

export async function openRun(db: D1Database, input: OpenRunInput): Promise<{ run_uid: string; replayed: boolean }> {
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) throw new SourceStoreRefusal('idempotency_key_required');
  if (typeof input.payloadSha256 !== 'string' || !HEX64.test(input.payloadSha256)) throw new SourceStoreRefusal('payload_sha256_invalid');
  const manifest = validateManifest(input.manifest);
  const requested = rulesFromRequest(manifest, input.columnClasses, input.allowHeld === true);
  const sourceKeys = JSON.stringify(manifest.sources.map((s) => s.source_key));

  const prior = await db.prepare(SQL.runByKey).bind(input.idempotencyKey).first<{ uid: string; payload_sha256: string }>();
  if (prior) {
    if (prior.payload_sha256 !== input.payloadSha256) throw new SourceStoreRefusal('idempotency_key_reused');
    return { run_uid: prior.uid, replayed: true };
  }
  const removals = (await db.prepare(SQL.activeRemovals).bind(sourceKeys).all<{ scope: string; source_key: string }>()).results ?? [];
  const removedSource = removals.find((r) => r.scope === 'source');
  if (removedSource) throw new SourceStoreRefusal('source_removed', { source: removedSource.source_key });

  const stored = (await db.prepare(SQL.rulesFor).bind(sourceKeys).all<{ source_key: string; column_name: string; class: ColumnClass; contact_handling: ContactHandling | null; role: string | null }>()).results ?? [];
  const storedBySource = new Map<string, Map<string, ColumnRule>>();
  for (const r of stored) {
    if (!storedBySource.has(r.source_key)) storedBySource.set(r.source_key, new Map());
    storedBySource.get(r.source_key)!.set(r.column_name, { class: r.class, contact: r.contact_handling, role: r.role });
  }
  const runUid = crypto.randomUUID();
  const newRules: Array<Record<string, unknown>> = [];
  for (const s of manifest.sources) {
    const have = storedBySource.get(s.source_key);
    const want = requested.get(s.source_key)!;
    if (have) {
      for (const [column, rule] of want) {
        const fixed = have.get(column);
        if (!fixed || fixed.class !== rule.class || fixed.contact !== rule.contact || fixed.role !== rule.role) {
          throw new SourceStoreRefusal('column_rules_disagree', { source: s.source_key, column });
        }
      }
      continue;
    }
    s.columns.forEach((column, order) => {
      const rule = want.get(column)!;
      newRules.push({ s: s.source_key, c: column, o: order, k: rule.class, h: rule.contact, r: rule.role });
    });
  }
  const now = input.now.toISOString();
  await db.batch([
    db.prepare(SQL.insertRun).bind(runUid, input.idempotencyKey, input.actorUserId ?? null, input.workerVersion ?? null,
      input.payloadSha256, input.hashRecipeId ?? null, JSON.stringify(manifest), now),
    db.prepare(SQL.insertRules).bind(JSON.stringify(newRules), now, runUid),
  ]);
  return { run_uid: runUid, replayed: false };
}

/* ------------------------------------------------------------------ write one chunk */

export interface WriteChunkInput {
  runUid: string;
  chunkIndex: number;
  records: SourceRecordInput[];
  now: Date;
  /** The registered package recipes. Empty in production (D7742); a test passes its own invented recipe. */
  recipes?: Readonly<Record<string, HashRecipe>>;
}
export interface WriteChunkResult { status: 'written' | 'uncertain'; counts: Record<string, number>; refused: Array<{ source_key: string; provider_record_id: string; code: string }> }

/** Refused before any statement when the chunk, a record or the bound value is over its limit: an oversized chunk writes nothing. */
function checkChunkSize(records: SourceRecordInput[]): void {
  if (!Array.isArray(records) || records.length === 0) throw new SourceStoreRefusal('chunk_empty');
  if (records.length > LIMITS.MAX_CHUNK_RECORDS) throw new SourceStoreRefusal('chunk_too_large', { records: records.length });
  const bytes = utf8(JSON.stringify(records)).byteLength;
  if (bytes > LIMITS.MAX_BOUND_VALUE_BYTES) throw new SourceStoreRefusal('chunk_too_large', { bytes });
}

export async function writeChunk(db: D1Database, env: CipherEnv, input: WriteChunkInput): Promise<WriteChunkResult> {
  if (!Number.isSafeInteger(input.chunkIndex) || input.chunkIndex < 0) throw new SourceStoreRefusal('chunk_index_invalid');
  checkChunkSize(input.records);
  const run = await db.prepare(SQL.runForChunk).bind(input.runUid).first<{ uid: string; status: string; manifest_json: string; hash_recipe_id: string | null }>();
  if (!run) throw new SourceStoreRefusal('run_not_found');
  if (run.status !== 'running' && run.status !== 'uncertain') throw new SourceStoreRefusal('run_closed', { status: run.status });
  const manifest = JSON.parse(run.manifest_json) as Manifest;
  const sourceKeys = JSON.stringify(manifest.sources.map((s) => s.source_key));
  const idKeys = JSON.stringify(input.records.map((r) => keyOf(String(r?.source_key), String(r?.provider_record_id))));

  const ruleRows = (await db.prepare(SQL.rulesFor).bind(sourceKeys).all<{ source_key: string; column_name: string; class: ColumnClass; contact_handling: ContactHandling | null; role: string | null }>()).results ?? [];
  const idRows = (await db.prepare(SQL.identities).bind(idKeys).all<{ source_key: string; provider_record_id: string; stated_row_hash: string }>()).results ?? [];
  const removalRows = (await db.prepare(SQL.activeRemovals).bind(sourceKeys).all<{ scope: string; source_key: string; provider_record_id: string | null }>()).results ?? [];

  const rules = new Map<string, Map<string, ColumnRule>>();
  for (const r of ruleRows) {
    if (!rules.has(r.source_key)) rules.set(r.source_key, new Map());
    rules.get(r.source_key)!.set(r.column_name, { class: r.class, contact: r.contact_handling, role: r.role });
  }
  const existing = new Map<string, Set<string>>();
  for (const r of idRows) {
    const k = keyOf(r.source_key, r.provider_record_id);
    if (!existing.has(k)) existing.set(k, new Set());
    existing.get(k)!.add(r.stated_row_hash);
  }
  const removals = { sources: new Set<string>(), records: new Set<string>(), privateFields: new Set<string>() };
  for (const r of removalRows) {
    if (r.scope === 'source') removals.sources.add(r.source_key);
    else if (r.scope === 'record') removals.records.add(keyOf(r.source_key, r.provider_record_id!));
    else removals.privateFields.add(keyOf(r.source_key, r.provider_record_id!));
  }
  const recipes = input.recipes ?? HASH_RECIPES;
  const recipe = run.hash_recipe_id && Object.hasOwn(recipes, run.hash_recipe_id) ? recipes[run.hash_recipe_id] : null;
  const plan = await planChunk({ manifest, rules, existing, removals, records: input.records, recipe, now: input.now });

  const inputByKey = new Map(input.records.map((r) => [keyOf(r.source_key, r.provider_record_id), r]));
  const rows = plan.records.map((p) => ({
    s: p.source_key, i: p.provider_record_id, h: p.stated_row_hash, b: p.body_sha256, k: p.hash_checked, o: p.outcome,
    r: p.refusal_code, cols: p.columns_json, body: p.body_json, at: p.captured_at, cells: JSON.stringify(p.cells),
  }));
  const privateRows: Array<Record<string, string>> = [];
  const flagRows: Array<Record<string, unknown>> = [];
  for (const p of plan.records) {
    if (p.outcome === 'refused' || p.outcome === 'unchanged') continue;
    const source = inputByKey.get(keyOf(p.source_key, p.provider_record_id))!;
    const rowId = JSON.stringify([p.source_key, p.provider_record_id, p.stated_row_hash]);
    for (const column of p.held_columns) {
      const value = source.cells.find(([n]) => n === column)![1];
      privateRows.push({ s: p.source_key, i: p.provider_record_id, h: p.stated_row_hash, c: column,
        ct: await encryptColumn(env, 'research_source_private_fields', column, rowId, JSON.stringify(value)) });
    }
    for (const f of p.flags) {
      flagRows.push({ s: p.source_key, i: p.provider_record_id, h: p.stated_row_hash, c: f.column ?? null, code: f.code, d: f.detail ?? null, v: f.rule_version });
    }
  }
  const recordsValue = JSON.stringify(rows);
  for (const value of [recordsValue, JSON.stringify(privateRows), JSON.stringify(flagRows)]) {
    if (utf8(value).byteLength > LIMITS.MAX_BOUND_VALUE_BYTES) throw new SourceStoreRefusal('chunk_too_large', { bytes: utf8(value).byteLength });
  }
  const refused = plan.records.filter((p) => p.outcome === 'refused').map((p) => ({ source_key: p.source_key, provider_record_id: p.provider_record_id, code: p.refusal_code! }));
  try {
    await db.batch([
      db.prepare(SQL.insertRecords).bind(recordsValue, run.uid),
      db.prepare(SQL.insertRunRecords).bind(recordsValue, run.uid, input.chunkIndex),
      db.prepare(SQL.insertPrivate).bind(JSON.stringify(privateRows)),
      db.prepare(SQL.insertFlags).bind(JSON.stringify(flagRows)),
      db.prepare(SQL.updateCounts).bind(run.uid, input.chunkIndex),
    ]);
  } catch {
    // The batch's outcome is unknown: the run stays uncertain until the same chunk is sent again and settles it.
    await db.prepare(SQL.markUncertain).bind(run.uid, input.chunkIndex).run();
    return { status: 'uncertain', counts: plan.counts, refused };
  }
  return { status: 'written', counts: plan.counts, refused };
}

/** Reconcile a chunk of unknown outcome: send it again. Every write is idempotent; success clears it from the run. */
export const reconcileChunk = writeChunk;

/* ------------------------------------------------------------------ seal */

export interface SealResult {
  status: 'complete' | 'partial' | 'uncertain';
  sources: Record<string, { expected: number; present: number; missing: number; altered: number; refused: number; digest_ok: boolean; cells_ok: boolean }>;
}
const SEAL_PAGE = 200;

export async function sealRun(db: D1Database, runUid: string, now: Date): Promise<SealResult> {
  const run = await db.prepare(SQL.sealRun).bind(runUid).first<{ uid: string; status: string; manifest_json: string; counts_json: string; uncertain_chunks_json: string }>();
  if (!run) throw new SourceStoreRefusal('run_not_found');
  const manifest = JSON.parse(run.manifest_json) as Manifest;
  const counts = JSON.parse(run.counts_json) as { cells?: Record<string, Record<string, { stored: number; withheld: number; blank: number }>> };
  const sources: SealResult['sources'] = {};
  const members = new Map<string, Array<{ provider_record_id: string; stated_row_hash: string }>>();
  for (const s of manifest.sources) {
    sources[s.source_key] = { expected: s.expected_records, present: 0, missing: 0, altered: 0, refused: 0, digest_ok: false, cells_ok: false };
    members.set(s.source_key, []);
  }
  for (let offset = 0; ; offset += SEAL_PAGE) {
    const page = (await db.prepare(SQL.sealMembers).bind(runUid, SEAL_PAGE, offset).all<{ source_key: string; provider_record_id: string; stated_row_hash: string; outcome: string; body_json: string | null; body_sha256: string | null }>()).results ?? [];
    for (const m of page) {
      const tally = sources[m.source_key];
      if (!tally) continue;
      if (m.outcome === 'refused') { tally.refused++; continue; }
      members.get(m.source_key)!.push(m);
      if (m.body_json === null || m.body_sha256 === null) tally.missing++;
      else if (await sha256Hex(m.body_json) !== m.body_sha256) tally.altered++;
      else tally.present++;
    }
    if (page.length < SEAL_PAGE) break;
  }
  let complete = true;
  for (const s of manifest.sources) {
    const tally = sources[s.source_key];
    tally.digest_ok = (await membershipDigest(members.get(s.source_key)!)) === s.digest;
    const cells = Object.values(counts.cells?.[s.source_key] ?? {}).reduce((sum, c) => sum + c.stored + c.withheld + c.blank, 0);
    tally.cells_ok = cells === s.expected_cells;
    if (tally.present !== s.expected_records || tally.missing || tally.altered || tally.refused || !tally.digest_ok || !tally.cells_ok) complete = false;
  }
  const pending = (JSON.parse(run.uncertain_chunks_json) as unknown[]).length > 0;
  const status: SealResult['status'] = pending || run.status === 'uncertain' ? 'uncertain' : complete ? 'complete' : 'partial';
  await db.prepare(SQL.setStatus).bind(runUid, status, status === 'uncertain' ? null : now.toISOString()).run();
  return { status, sources };
}

/* ------------------------------------------------------------------ removals */

export interface RemovalInput { sourceKey: string; providerRecordId?: string; actorUserId: number | null; now: Date }

async function removal(db: D1Database, scope: 'private_fields' | 'record' | 'source', input: RemovalInput) {
  if (typeof input.sourceKey !== 'string' || !SOURCE_KEY.test(input.sourceKey)) throw new SourceStoreRefusal('source_key_invalid');
  const id = scope === 'source' ? null : input.providerRecordId;
  if (scope !== 'source' && (typeof id !== 'string' || id.length === 0)) throw new SourceStoreRefusal('provider_record_id_required');
  const before = await db.prepare(SQL.countRecord).bind(input.sourceKey, id ?? null).first<{ records: number; private_fields: number; flags: number }>();
  const counts = scope === 'private_fields' ? { private_fields: Number(before?.private_fields ?? 0) }
    : { records: Number(before?.records ?? 0), private_fields: Number(before?.private_fields ?? 0), flags: Number(before?.flags ?? 0) };
  const statements = [db.prepare(SQL.deletePrivate).bind(input.sourceKey, id ?? null)];
  if (scope !== 'private_fields') {
    statements.push(db.prepare(SQL.deleteFlags).bind(input.sourceKey, id ?? null));
    statements.push(db.prepare(SQL.deleteRecords).bind(input.sourceKey, id ?? null));
  }
  statements.push(db.prepare(SQL.insertRemoval).bind(input.actorUserId ?? null, input.now.toISOString(), scope, input.sourceKey, id ?? null, JSON.stringify(counts)));
  await db.batch(statements);
  return { scope, counts };
}

/** A record's private fields. Its id and both hashes stay; a replay does not restore them while the removal stands. */
export const removePrivateFields = (db: D1Database, input: RemovalInput) => removal(db, 'private_fields', input);
/** One whole record, every version (for a person who asks). Ids and hashes stay in the run records. */
export const removeRecord = (db: D1Database, input: RemovalInput) => removal(db, 'record', input);
/** One source: no record, private field or flag row is left. Run ids, hashes and counts stay. */
export const removeSource = (db: D1Database, input: Omit<RemovalInput, 'providerRecordId'>) => removal(db, 'source', input);

export async function liftRemoval(db: D1Database, removalId: number, actorUserId: number | null, now: Date): Promise<boolean> {
  const res = await db.prepare(SQL.liftRemoval).bind(removalId, now.toISOString(), actorUserId ?? null).run();
  return (res.meta?.changes ?? 0) > 0;
}
