/**
 * D7674 part 2 (#7674): the organisation-only controlled apply of a reviewed #7672 directory manifest.
 *
 * A Super Admin uploads the reviewed organisation records, the review manifest and the digests and run id the
 * offline planner printed. This file checks the envelope (contract, target environment, schema, mapping version,
 * snapshot digest), refuses anything about a person or a contact channel (#7739 Q3 B), re-plans on the server with
 * the landed planner (`scripts/lib/networkDirectoryPlan.mjs`, unchanged), refuses a plan that differs from the
 * reviewed one or that an already-stored newer observation has overtaken, and applies the plan's own parameterized
 * batches. No SQL is accepted from the request: every statement run here is the planner's or this file's.
 *
 * Resumable from durable state: a record batch is done when its `network_directory_import_rows` checkpoint exists,
 * so a retry (or a resume after a failed batch) applies only what is missing and an applied batch is never run twice.
 * The run is marked complete only after the read-back counts reconcile with the plan, and protected entries
 * (published, suppressed, archived, reviewed, verified, withdrawn or account/company-linked) are fingerprinted before
 * and after, so a change to one is a mismatch, not a completion. Entries stay `staged`; nothing here publishes.
 *
 * This file counts rows of `network_directory_private_sources` and never selects a cell from it. It creates no
 * account, membership, relationship, notice or outreach, and it writes no Research row.
 */
import type { Env } from '../types';
import { DirectoryRefusal } from './networkDirectory';
import { VERSION, buildDirectoryPlan, canonical, type DirectoryPlan, type PlanBatch } from '../../../scripts/lib/networkDirectoryPlan.mjs';

export const APPLY_CONTRACT = 'network-directory-organisation-apply-v1';
/** The #7672 migration whose tables the plan writes. An upload names it; the database must hold its tables. */
export const APPLY_SCHEMA = '202611191414_7672_network_directory';
export const APPLY_LIMITS = Object.freeze({ MAX_BODY_BYTES: 4 * 1024 * 1024, MAX_RECORDS: 5000, MAX_BATCHES_PER_CALL: 200, DEFAULT_BATCHES_PER_CALL: 100 });
/**
 * #7739 Q4 A: no real production apply while the queue alert is open (#8232, formerly #5719). Lifting this is a
 * reviewed one-line change, never a request field.
 */
export const PRODUCTION_APPLY_HELD = true;

/**
 * The organisation fields each source may upload, from D7672's mapping table. A source with no entry has no
 * organisation-only mapping: Folk's organisations are derived from its person rows, so they cannot be uploaded
 * without people records. #7681 adds NFX here once its field names are posted.
 */
export const ORGANISATION_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  airtable_angels: Object.freeze(['Name', 'Type', 'Headquarters', 'Sector Focus', 'Investment Stage', 'Currently investing?', 'Previous Investments', 'LinkedIn']),
});

const UPLOAD_KEYS = new Set(['contract', 'target_environment', 'schema', 'planner_version', 'snapshot', 'plan', 'manifest', 'records', 'max_batches']);
/** A plan's executable parts. The server builds its own; an upload that carries them is refused, not ignored. */
const SQL_KEYS = new Set(['batches', 'statements', 'sql', 'params']);
const RECORD_KEYS = new Set(['source', 'source_record_id', 'observed_at', 'raw_fields']);
const MANIFEST_KEYS = new Set(['version', 'rows', 'duplicate_channel_groups', 'source_snapshot_sha256', 'organizations']);
const ROW_KEYS = new Set(['source', 'source_record_id', 'entity_kind', 'disposition', 'reasons', 'linkedin_disposition']);
/** Manifest keys that only a person's row carries (affiliation and title review). */
const PERSON_ROW_KEYS = new Set(['affiliation_disposition', 'title', 'title_disposition']);
const CONTACT_FIELD = /e-?mail|phone|mobile|\btel\b|whats\s?app|telegram|twitter|contact|address|\bcell\b/i;
const EMAIL_VALUE = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/i;
const PERSONAL_PROFILE = /linkedin\.com\/in\//i;
/** The eight #7672 tables the plan writes, spelled out so the schema probe binds nothing. */
const SCHEMA_PROBE = `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN (
  'network_directory_sources', 'network_directory_import_runs', 'network_directory_entries', 'network_directory_source_records',
  'network_directory_private_sources', 'network_directory_import_rows', 'network_directory_affiliations', 'network_directory_reviews')`;
const SCHEMA_TABLES = 8;

const refuse = (status: number, code: string, sentence: string, extra: Record<string, unknown> = {}) =>
  new DirectoryRefusal(status, code, sentence, extra);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export type ApplyEnvelope = {
  target_environment: string;
  records: Record<string, any>[];
  manifest: Record<string, any>;
  snapshot: { records_sha256: string; record_count: number };
  plan: { run_uid: string; review_manifest_hash: string };
  max_batches: number;
};

/** Every string anywhere in a value, for the contact and personal-profile scan. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) { out.push(k); strings(v, out); }
  return out;
}

function contactScan(where: unknown) {
  for (const s of strings(where)) {
    if (EMAIL_VALUE.test(s)) throw refuse(422, 'contact_field_refused', 'The upload carries an email address. Contact values are never uploaded (owner decision #7739 Q3 B). Nothing was written.');
    if (PERSONAL_PROFILE.test(s)) throw refuse(422, 'personal_profile_refused', 'The upload carries a personal LinkedIn profile link. Links to people are never uploaded (#7739 Q3 B). Nothing was written.');
  }
}

/** The envelope, the organisation-only rule and the contact rule. Pure: reads no database. */
export function applyEnvelope(body: Record<string, unknown>, env: Pick<Env, 'ENVIRONMENT'>): ApplyEnvelope {
  if (Object.keys(body).some(k => SQL_KEYS.has(k))) throw refuse(400, 'submitted_sql_refused', 'An upload carries records and a review manifest only; the server builds every statement. Nothing was written.');
  if (Object.keys(body).some(k => !UPLOAD_KEYS.has(k))) throw refuse(400, 'upload_field_unknown', 'The upload carries a field this contract does not take. Nothing was written.');
  if (body.contract !== APPLY_CONTRACT) throw refuse(400, 'contract_unknown', `Send an upload under the ${APPLY_CONTRACT} contract.`);
  const target = typeof body.target_environment === 'string' ? body.target_environment : '';
  if (!env.ENVIRONMENT || target !== env.ENVIRONMENT) {
    throw refuse(409, 'wrong_target_environment', 'This upload was reviewed for another environment than the one it was sent to. Nothing was written.');
  }
  if (env.ENVIRONMENT === 'production' && PRODUCTION_APPLY_HELD) {
    throw refuse(409, 'production_apply_held', 'A production apply is held while the queue alert is open (owner decision #7739 Q4 A). Nothing was written.');
  }
  if (body.schema !== APPLY_SCHEMA) throw refuse(409, 'schema_version_mismatch', `This route applies plans for schema ${APPLY_SCHEMA}. Re-plan against it.`);
  if (body.planner_version !== VERSION) throw refuse(409, 'mapping_version_mismatch', `This route re-plans with mapping ${VERSION}. Re-plan and review with it.`);
  const snapshot = body.snapshot, plan = body.plan, manifest = body.manifest, records = body.records;
  if (!isObject(snapshot) || typeof snapshot.records_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.records_sha256) || !Number.isInteger(snapshot.record_count)) {
    throw refuse(400, 'snapshot_invalid', 'Give the snapshot as its record count and the 64-character SHA-256 of its records.');
  }
  if (isObject(plan) && Object.keys(plan).some(k => SQL_KEYS.has(k))) throw refuse(400, 'submitted_sql_refused', 'An upload carries records and a review manifest only; the server builds every statement. Nothing was written.');
  if (!isObject(plan) || typeof plan.run_uid !== 'string' || typeof plan.review_manifest_hash !== 'string') {
    throw refuse(400, 'plan_invalid', 'Give the reviewed plan’s run id and review manifest hash, as the offline planner printed them.');
  }
  if (!Array.isArray(records) || !records.length || records.length > APPLY_LIMITS.MAX_RECORDS) {
    throw refuse(400, 'records_invalid', `Send 1 to ${APPLY_LIMITS.MAX_RECORDS} organisation records.`);
  }
  if (!isObject(manifest) || manifest.version !== 1 || !Array.isArray(manifest.rows) || Object.keys(manifest).some(k => !MANIFEST_KEYS.has(k))) {
    throw refuse(400, 'manifest_invalid', 'The review manifest is not a version 1 manifest in the expected shape. Nothing was written.');
  }
  let maxBatches: number = APPLY_LIMITS.DEFAULT_BATCHES_PER_CALL;
  if (body.max_batches !== undefined) {
    if (!Number.isInteger(body.max_batches) || (body.max_batches as number) < 1 || (body.max_batches as number) > APPLY_LIMITS.MAX_BATCHES_PER_CALL) {
      throw refuse(400, 'max_batches_invalid', `A call applies 1 to ${APPLY_LIMITS.MAX_BATCHES_PER_CALL} batches.`);
    }
    maxBatches = body.max_batches as number;
  }
  contactScan(records);
  contactScan(manifest);
  if (Array.isArray(manifest.organizations) ? manifest.organizations.length : manifest.organizations !== undefined) {
    throw refuse(422, 'derived_organizations_refused', 'Derived organisations come from person rows, which are not uploaded (#7739 Q3 B). Upload organisation records instead.');
  }
  for (const g of Array.isArray(manifest.duplicate_channel_groups) ? manifest.duplicate_channel_groups : []) {
    if (!isObject(g) || g.channel_type !== 'linkedin') throw refuse(422, 'contact_field_refused', 'Only a LinkedIn channel review is accepted for organisations; contact channels are never uploaded (#7739 Q3 B).');
  }
  const decisions = new Map<string, Record<string, unknown>>();
  for (const row of manifest.rows as unknown[]) {
    if (!isObject(row)) throw refuse(400, 'manifest_invalid', 'The review manifest is not a version 1 manifest in the expected shape. Nothing was written.');
    if (Object.keys(row).some(k => PERSON_ROW_KEYS.has(k)) || row.entity_kind !== 'organization') {
      throw refuse(422, 'people_records_refused', 'Only organisation records are applied here. A row about a person, or one not reviewed as an organisation, is never uploaded (#7739 Q3 B).');
    }
    if (Object.keys(row).some(k => !ROW_KEYS.has(k))) throw refuse(400, 'manifest_invalid', 'The review manifest is not a version 1 manifest in the expected shape. Nothing was written.');
    decisions.set(canonical([row.source, row.source_record_id]), row);
  }
  const identities = new Set<string>();
  for (const r of records as unknown[]) {
    if (!isObject(r) || Object.keys(r).some(k => !RECORD_KEYS.has(k)) || !isObject(r.raw_fields)) {
      throw refuse(400, 'records_invalid', `Send 1 to ${APPLY_LIMITS.MAX_RECORDS} organisation records.`);
    }
    const allowed = typeof r.source === 'string' && Object.hasOwn(ORGANISATION_FIELDS, r.source) ? ORGANISATION_FIELDS[r.source] : null;
    if (!allowed) {
      throw refuse(422, 'source_not_organisation_mapped', 'That source has no organisation-only mapping. Its organisations come from person rows, which are not uploaded.');
    }
    for (const field of Object.keys(r.raw_fields)) {
      if (allowed.includes(field)) continue;
      if (CONTACT_FIELD.test(field)) throw refuse(422, 'contact_field_refused', 'The upload carries a contact column. Contact values are never uploaded (owner decision #7739 Q3 B). Nothing was written.');
      throw refuse(422, 'field_not_permitted', 'The upload carries a column outside the source’s organisation mapping. Remove it before upload. Nothing was written.');
    }
    const k = canonical([r.source, r.source_record_id]);
    if (!decisions.has(k)) throw refuse(422, 'record_unreviewed', 'A record has no reviewed organisation row in the manifest. An unclassified record could be a person, so nothing was written.');
    identities.add(k);
  }
  for (const k of decisions.keys()) {
    if (!identities.has(k)) throw refuse(400, 'manifest_invalid', 'The review manifest is not a version 1 manifest in the expected shape. Nothing was written.');
  }
  return { target_environment: target, records: records as Record<string, any>[], manifest, snapshot: snapshot as ApplyEnvelope['snapshot'], plan: plan as ApplyEnvelope['plan'], max_batches: maxBatches };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The SHA-256 the uploader states for its records: of their canonical JSON, the planner's own canonical form. */
export const recordsDigest = (records: unknown) => sha256Hex(canonical(records));

/** Re-plan on the server, then hold the result to what was reviewed. */
export async function replan(input: ApplyEnvelope): Promise<DirectoryPlan> {
  if (input.snapshot.record_count !== input.records.length || (await recordsDigest(input.records)) !== input.snapshot.records_sha256) {
    throw refuse(409, 'snapshot_mismatch', 'These records are not the reviewed snapshot: the count or digest differs. Nothing was written.');
  }
  let plan: DirectoryPlan;
  // The planner's own error text can quote a source value, so only our sentence leaves.
  try { plan = buildDirectoryPlan({ records: input.records, manifest: input.manifest }); }
  catch { throw refuse(400, 'manifest_invalid', 'The review manifest is not a version 1 manifest in the expected shape. Nothing was written.'); }
  if (plan.summary.run_uid !== input.plan.run_uid || plan.summary.review_manifest_hash !== input.plan.review_manifest_hash) {
    throw refuse(409, 'plan_stale', 'The server’s plan for this upload differs from the reviewed plan. Re-plan and review again; nothing was written.');
  }
  if (plan.summary.people !== 0 || plan.summary.affiliations !== 0 || plan.summary.derived_organizations.input !== 0) {
    throw refuse(422, 'people_records_refused', 'Only organisation records are applied here. A row about a person, or one not reviewed as an organisation, is never uploaded (#7739 Q3 B).');
  }
  return plan;
}

/** Planned entries, read from the plan's own entry statements (uid, kind, source, source row id are its first four parameters). */
function plannedEntries(plan: DirectoryPlan) {
  const out = new Map<string, { kind: string; source: string }>();
  for (const b of plan.batches) for (const s of b.statements) {
    if (/^INSERT INTO network_directory_entries\b/.test(s.sql)) out.set(String(s.params[0]), { kind: String(s.params[1]), source: String(s.params[2]) });
  }
  return out;
}

type EntryState = { uid: string; kind: string; display_name: string; website: string | null; profile_url: string | null; publication_status: string;
  verification_status: string; linked_user_id: number | null; linked_company_id: number | null; observed_at: string };

const isProtected = (e: EntryState) => e.publication_status !== 'staged' || e.verification_status !== 'unverified_source_claim'
  || e.linked_user_id !== null || e.linked_company_id !== null;

async function existingEntries(env: Env, sources: string[], planned: Map<string, unknown>) {
  const out = new Map<string, EntryState>();
  for (const source of sources) {
    const rows = (await env.DB.prepare(
      `SELECT uid, kind, display_name, website, profile_url, publication_status, verification_status, linked_user_id, linked_company_id, observed_at
         FROM network_directory_entries WHERE source_uid = ?`,
    ).bind(source).all<EntryState>()).results ?? [];
    for (const r of rows) if (planned.has(r.uid)) out.set(r.uid, r);
  }
  return out;
}

/** Protected entries' facts, so a change to one between the start and the end of a call is caught. */
const fingerprint = (m: Map<string, EntryState>) => canonical([...m.values()].filter(isProtected).sort((a, b) => a.uid < b.uid ? -1 : 1));

/**
 * Latest applicable source wins: when the database already holds a newer observation of a source row than this
 * upload carries, the upload's review is stale (an older acceptance must not land behind a later hold).
 */
async function staleRows(env: Env, records: Record<string, any>[]) {
  const latest = new Map<string, number>();
  for (const r of records) {
    const k = canonical([r.source, r.source_record_id]);
    const t = Date.parse(r.observed_at);
    if (!latest.has(k) || t > latest.get(k)!) latest.set(k, t);
  }
  let stale = 0;
  for (const source of [...new Set(records.map(r => String(r.source)))].sort()) {
    const rows = (await env.DB.prepare(
      'SELECT external_record_id, MAX(observed_at) AS latest FROM network_directory_source_records WHERE source_uid = ? GROUP BY external_record_id',
    ).bind(source).all<{ external_record_id: string; latest: string }>()).results ?? [];
    for (const row of rows) {
      const mine = latest.get(canonical([source, row.external_record_id]));
      if (mine !== undefined && Date.parse(row.latest) > mine) stale++;
    }
  }
  return stale;
}

export type ReadBack = { reconciled: boolean; mismatches: string[]; expected: Record<string, number>; actual: Record<string, number> };

/** Read the run back from the database and hold every count to the plan. */
export async function readBack(env: Env, plan: DirectoryPlan): Promise<ReadBack> {
  const s = plan.summary, run = s.run_uid;
  const expected = {
    checkpoints: s.all_staged_records.input, accepted: s.all_staged_records.accepted, review: s.all_staged_records.review,
    skipped: s.all_staged_records.skipped, private_sources: s.all_staged_records.input, organizations: s.organizations,
    people: 0, affiliations: 0, review_records_without_item: 0,
  };
  const byDisposition = (await env.DB.prepare(
    `SELECT r.disposition AS disposition, COUNT(*) AS n,
            SUM(CASE WHEN p.source_record_uid IS NULL THEN 0 ELSE 1 END) AS private_n,
            SUM(CASE WHEN r.entry_kind = 'person' THEN 1 ELSE 0 END) AS people_n
       FROM network_directory_import_rows i
       JOIN network_directory_source_records r ON r.uid = i.source_record_uid
       LEFT JOIN network_directory_private_sources p ON p.source_record_uid = r.uid
      WHERE i.run_uid = ? GROUP BY r.disposition`,
  ).bind(run).all<{ disposition: string; n: number; private_n: number; people_n: number }>()).results ?? [];
  const pick = (d: string) => Number(byDisposition.find(r => r.disposition === d)?.n ?? 0);
  const sum = (k: 'n' | 'private_n' | 'people_n') => byDisposition.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const orgs = await env.DB.prepare(
    `SELECT COUNT(DISTINCT e.uid) AS n FROM network_directory_import_rows i
       JOIN network_directory_source_records r ON r.uid = i.source_record_uid AND r.disposition = 'accept'
       JOIN network_directory_entries e ON e.uid = r.entry_uid AND e.kind = 'organization'
      WHERE i.run_uid = ?`,
  ).bind(run).first<{ n: number }>();
  const affiliations = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM network_directory_affiliations a
      WHERE a.source_record_uid IN (SELECT source_record_uid FROM network_directory_import_rows WHERE run_uid = ?)`,
  ).bind(run).first<{ n: number }>();
  const unreviewed = await env.DB.prepare(
    `SELECT COUNT(DISTINCT r.uid) AS n FROM network_directory_import_rows i
       JOIN network_directory_source_records r ON r.uid = i.source_record_uid AND r.disposition = 'review'
      WHERE i.run_uid = ? AND NOT EXISTS (SELECT 1 FROM network_directory_reviews v WHERE v.source_record_uid = r.uid)`,
  ).bind(run).first<{ n: number }>();
  const actual = {
    checkpoints: sum('n'), accepted: pick('accept'), review: pick('review'), skipped: pick('skip'), private_sources: sum('private_n'),
    organizations: Number(orgs?.n ?? 0), people: sum('people_n'), affiliations: Number(affiliations?.n ?? 0),
    review_records_without_item: Number(unreviewed?.n ?? 0),
  };
  const mismatches = (Object.keys(expected) as (keyof typeof expected)[]).filter(k => expected[k] !== actual[k]);
  return { reconciled: mismatches.length === 0, mismatches, expected, actual };
}

async function runRow(env: Env, uid: string) {
  return env.DB.prepare('SELECT status FROM network_directory_import_runs WHERE uid = ?').bind(uid).first<{ status: string }>();
}

const statements = (env: Env, b: PlanBatch) => b.statements.map(s => env.DB.prepare(s.sql).bind(...s.params));

export type ApplyResult = {
  status: 'complete' | 'in_progress';
  replayed: boolean;
  run_uid: string;
  applied_batches: number;
  pending_batches: number;
  total_batches: number;
  protected_entries: number;
  read_back: ReadBack | null;
  summary: Record<string, unknown>;
};

function summaryOut(plan: DirectoryPlan) {
  const s = plan.summary;
  return { planner_version: s.planner_version, run_uid: s.run_uid, review_manifest_hash: s.review_manifest_hash, records: s.all_staged_records,
    organizations: s.organizations, duplicate_identity_groups: s.duplicate_identity_groups, atomic_batches: s.atomic_batches, statements: s.statements };
}

const mismatch = (rb: ReadBack, extra: Record<string, unknown>) => refuse(409, 'read_back_mismatch',
  'The counts read back from the database do not match the plan, so the run was not marked complete. Nothing more was applied; inspect before retrying.',
  { read_back: rb, ...extra });

/**
 * Apply up to `max_batches` pending batches of the reviewed plan, in order, each atomically, then read back.
 * `complete` only when every checkpoint exists, the counts reconcile and no protected entry changed.
 */
export async function applyOrganisationManifest(env: Env, input: ApplyEnvelope): Promise<ApplyResult> {
  const plan = await replan(input);
  const runUid = plan.summary.run_uid;
  const tables = await env.DB.prepare(SCHEMA_PROBE).first<{ n: number }>();
  if (Number(tables?.n ?? 0) !== SCHEMA_TABLES) throw refuse(503, 'schema_not_ready', `The database does not hold the ${APPLY_SCHEMA} tables yet. Release the migration first.`);
  const planned = plannedEntries(plan);
  const sources = [...new Set([...planned.values()].map(p => p.source))].sort();
  const before = await existingEntries(env, sources, planned);
  const protectedCount = [...before.values()].filter(isProtected).length;
  const base = { run_uid: runUid, total_batches: plan.batches.length, protected_entries: protectedCount, summary: summaryOut(plan) };

  const run = await runRow(env, runUid);
  if (run?.status === 'complete') {
    const rb = await readBack(env, plan);
    if (!rb.reconciled) throw mismatch(rb, { run_uid: runUid });
    return { ...base, status: 'complete', replayed: true, applied_batches: 0, pending_batches: 0, read_back: rb };
  }
  for (const [uid, e] of before) {
    if (e.kind !== planned.get(uid)!.kind) throw refuse(409, 'entity_kind_conflict', 'A planned organisation already exists as a person entry. Review the identity; nothing was written.');
  }
  const stale = await staleRows(env, input.records);
  if (stale) throw refuse(409, 'manifest_stale', 'The directory already holds a newer observation of a row in this upload, so its review is stale. Re-plan from the newer source.', { stale_rows: stale });

  const done = new Set(((await env.DB.prepare('SELECT row_key FROM network_directory_import_rows WHERE run_uid = ?')
    .bind(runUid).all<{ row_key: string }>()).results ?? []).map(r => r.row_key));
  const tail = new Set(['duplicate-reviews', 'complete']);
  const pending = plan.batches.filter(b => b.key === 'prepare' ? !run : !tail.has(b.key) && !done.has(b.key));
  let applied = 0;
  for (const b of pending.slice(0, input.max_batches)) {
    try { await env.DB.batch(statements(env, b)); }
    catch (e) {
      console.warn('[network_directory_apply] batch failed', (e as Error)?.name ?? 'unknown');
      throw refuse(503, 'apply_batch_failed', 'A batch failed and was rolled back. Every earlier batch is kept; send the same upload again to resume.',
        { run_uid: runUid, applied_batches: applied, pending_batches: pending.length - applied });
    }
    applied++;
  }
  const after = await existingEntries(env, sources, planned);
  if (fingerprint(before) !== fingerprint(after)) {
    throw mismatch(await readBack(env, plan), { run_uid: runUid, applied_batches: applied, protected_entry_changed: true });
  }
  if (applied < pending.length) {
    return { ...base, status: 'in_progress', replayed: false, applied_batches: applied, pending_batches: pending.length - applied, read_back: null };
  }
  for (const b of plan.batches.filter(b => b.key === 'duplicate-reviews')) await env.DB.batch(statements(env, b));
  const rb = await readBack(env, plan);
  if (!rb.reconciled) throw mismatch(rb, { run_uid: runUid, applied_batches: applied });
  for (const b of plan.batches.filter(b => b.key === 'complete')) await env.DB.batch(statements(env, b));
  if ((await runRow(env, runUid))?.status !== 'complete') throw mismatch(rb, { run_uid: runUid, applied_batches: applied, run_not_complete: true });
  return { ...base, status: 'complete', replayed: false, applied_batches: applied, pending_batches: 0, read_back: rb };
}

