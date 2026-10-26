/**
 * D642, grown by D1169 (#3082) — the member's file metadata, across every
 * company, without reading file contents.
 *
 * WHOSE FILES. D1169 takes #2449 owner question 3, A: your own files count to
 * you, and company files count to the company owner's plan. A company file is
 * a row tied to a venture (`project_id`): it counts to the company's first
 * primary admin (`user_company_links.is_primary_admin`), or, for a venture
 * with no company or a company with no primary admin, to the venture's founder
 * (`projects.founder_id` → `users.founder_id`, the id-space bridge migration
 * 189 documents). Personal stores (research, messages, diligence uploads, deck
 * reviews, profile photos and logos, imports) count to their own owner column.
 * This replaces D642's uploader rule for the data room.
 *
 * WHAT NEVER COUNTS: identity documents, signed legal copies (including a data
 * room file filed as `source_kind = 'signed'`), 83(b) receipts, fund documents
 * and anything HQ publishes. None of their stores is read here.
 *
 * A failed area is unknown, never an invented empty store; the other areas
 * still resolve, and no total is shown. A missing size is unknown, never 0.
 */
import type { Env, User } from '../types';
import { storagePlan, storagePlanKey } from './storagePlans';

export type StorageAreaKey =
  | 'data_room' | 'diligence_files' | 'research_library' | 'message_attachments' | 'interview_recordings'
  | 'data_room_versions' | 'session_audio' | 'deck_reviews' | 'validate_evidence' | 'build_proofs'
  | 'grow_minutes' | 'brand_files' | 'csv_imports';
export type StorageKindKey = 'data_room' | 'documents' | 'recordings' | 'decks_exports' | 'brand' | 'other';
export type StorageState = 'ok' | 'near_80' | 'near_95' | 'full' | 'over' | 'no_allowance';
export type StorageArea = {
  key: StorageAreaKey;
  kind: StorageKindKey;
  files: number | null;
  bytes: number | null;
  measured_bytes: number | null;
  unknown_size_files: number | null;
  recorded: boolean;
};

/** The canvas's six kinds, in palette order. */
export const STORAGE_KINDS: ReadonlyArray<StorageKindKey> = ['data_room', 'documents', 'recordings', 'decks_exports', 'brand', 'other'];

type Scope = 'company' | 'personal' | 'deck';
type Def = { key: StorageAreaKey; kind: StorageKindKey; scope: Scope; groups: string; largest: string };

// Every statement is static and bound. A company area binds the caller's own
// ventures as one JSON array (`json_each(?)`); a personal area binds their id.
// Group rows are per venture (`project_id`, NULL for personal files).
const AREAS: ReadonlyArray<Def> = [
  { key: 'data_room', kind: 'data_room', scope: 'company',
    groups: `SELECT f.project_id AS project_id, COUNT(*) AS files, SUM(f.size_bytes) AS bytes,
      SUM(CASE WHEN f.size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM json_each(?) own JOIN data_room_files f ON f.project_id = own.value
      WHERE f.source_kind <> 'signed' GROUP BY f.project_id`,
    largest: `SELECT f.name AS name, NULL AS version, f.size_bytes AS bytes, f.created_at AS added_at, f.project_id AS project_id, f.uid AS ref
      FROM json_each(?) own JOIN data_room_files f ON f.project_id = own.value
      WHERE f.source_kind <> 'signed' AND f.size_bytes IS NOT NULL ORDER BY f.size_bytes DESC, f.id DESC LIMIT 10` },
  { key: 'diligence_files', kind: 'documents', scope: 'personal',
    groups: `SELECT NULL AS project_id, COUNT(*) AS files, SUM(size_bytes) AS bytes,
      SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM dd_attachments WHERE uploaded_by_user_id = ?`,
    largest: `SELECT filename AS name, NULL AS version, size_bytes AS bytes, created_at AS added_at, NULL AS project_id, NULL AS ref
      FROM dd_attachments WHERE uploaded_by_user_id = ? AND size_bytes IS NOT NULL ORDER BY size_bytes DESC, id DESC LIMIT 10` },
  { key: 'research_library', kind: 'documents', scope: 'personal',
    groups: `SELECT NULL AS project_id, COUNT(*) AS files, SUM(size_bytes) AS bytes,
      SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM research_documents WHERE owner_user_id = ?`,
    largest: `SELECT title AS name, NULL AS version, size_bytes AS bytes, created_at AS added_at, NULL AS project_id, uid AS ref
      FROM research_documents WHERE owner_user_id = ? AND size_bytes IS NOT NULL ORDER BY size_bytes DESC, id DESC LIMIT 10` },
  { key: 'message_attachments', kind: 'other', scope: 'personal',
    groups: `SELECT NULL AS project_id, COUNT(*) AS files, SUM(size_bytes) AS bytes,
      SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM message_attachments WHERE uploader_user_id = ?`,
    largest: `SELECT filename AS name, NULL AS version, size_bytes AS bytes, created_at AS added_at, NULL AS project_id, uid AS ref
      FROM message_attachments WHERE uploader_user_id = ? AND size_bytes IS NOT NULL ORDER BY size_bytes DESC, id DESC LIMIT 10` },
  { key: 'interview_recordings', kind: 'recordings', scope: 'company',
    groups: `SELECT i.project_id AS project_id, COUNT(*) AS files, SUM(i.recording_size_bytes) AS bytes,
      SUM(CASE WHEN i.recording_size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM json_each(?) own JOIN discovery_interviews i ON i.project_id = own.value
      WHERE i.recording_r2_key IS NOT NULL AND TRIM(i.recording_r2_key) <> '' GROUP BY i.project_id`,
    largest: `SELECT i.interviewee_name AS name, NULL AS version, i.recording_size_bytes AS bytes,
      COALESCE(i.recording_uploaded_at, i.created_at) AS added_at, i.project_id AS project_id, CAST(i.id AS TEXT) AS ref
      FROM json_each(?) own JOIN discovery_interviews i ON i.project_id = own.value
      WHERE i.recording_r2_key IS NOT NULL AND TRIM(i.recording_r2_key) <> '' AND i.recording_size_bytes IS NOT NULL
      ORDER BY i.recording_size_bytes DESC, i.id DESC LIMIT 10` },
  // An earlier version is the object Replace kept (data_room.ts); the current
  // one is the file's own row, so nothing is counted twice.
  { key: 'data_room_versions', kind: 'data_room', scope: 'company',
    groups: `SELECT f.project_id AS project_id, COUNT(*) AS files, SUM(v.size_bytes) AS bytes,
      SUM(CASE WHEN v.size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM json_each(?) own JOIN data_room_files f ON f.project_id = own.value JOIN data_room_file_versions v ON v.file_id = f.id
      WHERE f.source_kind <> 'signed' GROUP BY f.project_id`,
    largest: `SELECT f.name AS name, v.version AS version, v.size_bytes AS bytes, v.created_at AS added_at, f.project_id AS project_id, f.uid AS ref
      FROM json_each(?) own JOIN data_room_files f ON f.project_id = own.value JOIN data_room_file_versions v ON v.file_id = f.id
      WHERE f.source_kind <> 'signed' AND v.size_bytes IS NOT NULL ORDER BY v.size_bytes DESC, v.id DESC LIMIT 10` },
  // One Record a Session recording is one file: the sum of its stored chunks.
  { key: 'session_audio', kind: 'recordings', scope: 'company',
    groups: `SELECT s.project_id AS project_id, COUNT(DISTINCT s.id) AS files, SUM(c.size_bytes) AS bytes,
      COUNT(DISTINCT CASE WHEN c.size_bytes IS NULL THEN s.id END) AS unknown_size_files
      FROM json_each(?) own JOIN interview_sessions s ON s.project_id = own.value
      JOIN interview_session_chunks c ON c.session_id = s.id GROUP BY s.project_id`,
    largest: `SELECT i.interviewee_name AS name, NULL AS version, SUM(c.size_bytes) AS bytes, MIN(c.created_at) AS added_at,
      s.project_id AS project_id, s.uid AS ref
      FROM json_each(?) own JOIN interview_sessions s ON s.project_id = own.value
      JOIN interview_session_chunks c ON c.session_id = s.id LEFT JOIN discovery_interviews i ON i.id = s.interview_id
      GROUP BY s.id HAVING COUNT(c.size_bytes) = COUNT(*) ORDER BY bytes DESC, s.id DESC LIMIT 10` },
  // A deck review counts while its upload is kept (`raw_retained`). Its
  // `project_id` comes from the uploader's form, unchecked, so it never moves
  // the file to another member's plan: it only names the caller's own venture.
  { key: 'deck_reviews', kind: 'decks_exports', scope: 'deck',
    groups: `SELECT CASE WHEN d.project_id IN (SELECT value FROM json_each(?)) THEN d.project_id END AS project_id,
      COUNT(*) AS files, SUM(d.size) AS bytes, SUM(CASE WHEN d.size IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM deck_reviews d WHERE d.user_id = ? AND d.raw_retained = 1 AND d.r2_key IS NOT NULL AND TRIM(d.r2_key) <> ''
      GROUP BY 1`,
    largest: `SELECT COALESCE(d.filename, d.title) AS name, NULL AS version, d.size AS bytes, d.created_at AS added_at,
      CASE WHEN d.project_id IN (SELECT value FROM json_each(?)) THEN d.project_id END AS project_id, d.id AS ref
      FROM deck_reviews d WHERE d.user_id = ? AND d.raw_retained = 1 AND d.r2_key IS NOT NULL AND TRIM(d.r2_key) <> ''
      AND d.size IS NOT NULL ORDER BY d.size DESC, d.created_at DESC LIMIT 10` },
  // D1168's stores: a row marked missing holds no object and is not a file.
  { key: 'validate_evidence', kind: 'documents', scope: 'company',
    groups: `SELECT d.project_id AS project_id, COUNT(*) AS files, SUM(d.size_bytes) AS bytes,
      SUM(CASE WHEN d.size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM json_each(?) own JOIN demand_signals d ON d.project_id = own.value
      WHERE d.evidence_file_key IS NOT NULL AND TRIM(d.evidence_file_key) <> '' AND d.size_missing_at IS NULL
      GROUP BY d.project_id`,
    largest: `SELECT d.evidence_file_name AS name, NULL AS version, d.size_bytes AS bytes, d.created_at AS added_at,
      d.project_id AS project_id, CAST(d.id AS TEXT) AS ref
      FROM json_each(?) own JOIN demand_signals d ON d.project_id = own.value
      WHERE d.evidence_file_key IS NOT NULL AND TRIM(d.evidence_file_key) <> '' AND d.size_missing_at IS NULL
      AND d.size_bytes IS NOT NULL ORDER BY d.size_bytes DESC, d.id DESC LIMIT 10` },
  // A formation step names its venture; an entity's proof names it in its key,
  // checked against that entity's venture as D1168's backfill checks it.
  { key: 'build_proofs', kind: 'documents', scope: 'company',
    groups: `SELECT project_id, COUNT(*) AS files, SUM(size_bytes) AS bytes,
      SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files FROM (
        SELECT s.project_id AS project_id, s.size_bytes AS size_bytes
          FROM json_each(?) own JOIN formation_steps s ON s.project_id = own.value
         WHERE s.proof_file_key IS NOT NULL AND TRIM(s.proof_file_key) <> '' AND s.size_missing_at IS NULL
        UNION ALL
        SELECT p.id AS project_id, o.size_bytes AS size_bytes
          FROM json_each(?) own JOIN projects p ON p.id = own.value JOIN entity_obligations o ON o.entity_id = p.entity_id
         WHERE o.proof_file_key GLOB ('build-proof/' || p.id || '/*') AND o.size_missing_at IS NULL)
      GROUP BY project_id`,
    largest: `SELECT name, NULL AS version, bytes, added_at, project_id, ref FROM (
        SELECT s.title AS name, s.size_bytes AS bytes, s.created_at AS added_at, s.project_id AS project_id, CAST(s.id AS TEXT) AS ref
          FROM json_each(?) own JOIN formation_steps s ON s.project_id = own.value
         WHERE s.proof_file_key IS NOT NULL AND TRIM(s.proof_file_key) <> '' AND s.size_missing_at IS NULL AND s.size_bytes IS NOT NULL
        UNION ALL
        SELECT o.title AS name, o.size_bytes AS bytes, o.created_at AS added_at, p.id AS project_id, o.uid AS ref
          FROM json_each(?) own JOIN projects p ON p.id = own.value JOIN entity_obligations o ON o.entity_id = p.entity_id
         WHERE o.proof_file_key GLOB ('build-proof/' || p.id || '/*') AND o.size_missing_at IS NULL AND o.size_bytes IS NOT NULL)
      ORDER BY bytes DESC, added_at DESC LIMIT 10` },
  { key: 'grow_minutes', kind: 'documents', scope: 'company',
    groups: `SELECT e.project_id AS project_id, COUNT(*) AS files, SUM(o.size_bytes) AS bytes,
      SUM(CASE WHEN o.size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM json_each(?) own JOIN compliance_events e ON e.project_id = own.value JOIN obligation_occurrences o ON o.event_id = e.id
      WHERE o.minutes_file_key IS NOT NULL AND TRIM(o.minutes_file_key) <> '' AND o.size_missing_at IS NULL
      GROUP BY e.project_id`,
    largest: `SELECT e.title AS name, NULL AS version, o.size_bytes AS bytes, o.created_at AS added_at, e.project_id AS project_id, o.uid AS ref
      FROM json_each(?) own JOIN compliance_events e ON e.project_id = own.value JOIN obligation_occurrences o ON o.event_id = e.id
      WHERE o.minutes_file_key IS NOT NULL AND TRIM(o.minutes_file_key) <> '' AND o.size_missing_at IS NULL
      AND o.size_bytes IS NOT NULL ORDER BY o.size_bytes DESC, o.id DESC LIMIT 10` },
  // Superseded photos and logos D1168 keeps are still stored, so they count.
  { key: 'brand_files', kind: 'brand', scope: 'personal',
    groups: `SELECT NULL AS project_id, COUNT(*) AS files, SUM(size_bytes) AS bytes,
      SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM member_files WHERE owner_user_id = ? AND size_missing_at IS NULL`,
    largest: `SELECT kind AS name, NULL AS version, size_bytes AS bytes, created_at AS added_at, NULL AS project_id, uid AS ref
      FROM member_files WHERE owner_user_id = ? AND size_missing_at IS NULL AND size_bytes IS NOT NULL
      ORDER BY size_bytes DESC, id DESC LIMIT 10` },
  { key: 'csv_imports', kind: 'other', scope: 'personal',
    groups: `SELECT NULL AS project_id, COUNT(*) AS files, SUM(size_bytes) AS bytes,
      SUM(CASE WHEN size_bytes IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM data_imports WHERE user_id = ? AND raw_file_r2_key IS NOT NULL AND TRIM(raw_file_r2_key) <> '' AND size_missing_at IS NULL`,
    largest: `SELECT source AS name, NULL AS version, size_bytes AS bytes, started_at AS added_at, NULL AS project_id, CAST(id AS TEXT) AS ref
      FROM data_imports WHERE user_id = ? AND raw_file_r2_key IS NOT NULL AND TRIM(raw_file_r2_key) <> '' AND size_missing_at IS NULL
      AND size_bytes IS NOT NULL ORDER BY size_bytes DESC, id DESC LIMIT 10` },
];

/**
 * The caller's own ventures: each counts to its company's first primary
 * admin, or to its founder when no primary admin exists. Exactly one member
 * owns a venture, so no file counts to two plans.
 */
const OWNED = `SELECT p.id AS id, p.uid AS uid, p.name AS name, p.company_id AS company_id,
    cp.uid AS company_uid, cp.company_name AS company_name
  FROM users me JOIN projects p
    ON (p.company_id IN (SELECT l.company_id FROM user_company_links l WHERE l.user_id = me.id AND l.is_primary_admin = 1)
        OR p.founder_id = me.founder_id)
  LEFT JOIN company_profiles cp ON cp.id = p.company_id
  WHERE me.id = ? AND me.id = COALESCE(
    (SELECT l2.user_id FROM user_company_links l2 WHERE l2.company_id = p.company_id AND l2.is_primary_admin = 1
      ORDER BY l2.created_at, l2.id LIMIT 1),
    (SELECT MIN(u.id) FROM users u WHERE u.founder_id = p.founder_id))
  ORDER BY p.id`;

type Venture = { id: number; uid: string | null; name: string | null; company_id: number | null; company_uid: string | null; company_name: string | null };
type Group = { project_id: number | null; files: number; bytes: number; unknown: number };
type Largest = { area: StorageAreaKey; kind: StorageKindKey; name: string | null; version: number | null; bytes: number; added_at: string | null; project_id: number | null; ref: string | null };
type AreaRead = { area: StorageArea; groups: Group[]; largest: Largest[] | null };
type Figures = { files: number | null; bytes: number | null; measured_bytes: number | null; unknown_size_files: number | null };

const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const id = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const text = (s: unknown): s is string | null => s === null || typeof s === 'string';
const UNREADABLE = 'Unreadable storage aggregate';

function group(row: any, owned: Set<number>): Group {
  const unknown = row?.files === 0 && row?.unknown_size_files === null ? 0 : row?.unknown_size_files;
  if (!count(row?.files) || !count(unknown) || unknown > row.files) throw new Error(UNREADABLE);
  if (row.bytes !== null && !count(row.bytes)) throw new Error(UNREADABLE);
  if (row.files > unknown && row.bytes === null) throw new Error(UNREADABLE);
  const project = row.project_id ?? null;
  if (project !== null && !owned.has(project)) throw new Error(UNREADABLE);
  return { project_id: project, files: row.files, bytes: row.bytes ?? 0, unknown };
}

function largestRow(def: Def, row: any): Largest {
  if (!count(row?.bytes) || !text(row.name) || !text(row.added_at) || !text(row.ref)) throw new Error(UNREADABLE);
  if (row.project_id !== null && !id(row.project_id)) throw new Error(UNREADABLE);
  if (row.version !== null && !id(row.version)) throw new Error(UNREADABLE);
  return { area: def.key, kind: def.kind, name: row.name, version: row.version, bytes: row.bytes,
    added_at: row.added_at, project_id: row.project_id, ref: row.ref };
}

function binds(def: Def, userId: number, owned: string): unknown[] {
  if (def.scope === 'personal') return [userId];
  if (def.scope === 'deck') return [owned, userId];
  return def.key === 'build_proofs' ? [owned, owned] : [owned];
}

async function readArea(db: D1Database, def: Def, userId: number, ventures: Venture[] | null): Promise<AreaRead> {
  const blank: StorageArea = { key: def.key, kind: def.kind, files: null, bytes: null, measured_bytes: null, unknown_size_files: null, recorded: false };
  // A company area cannot be read without knowing whose ventures they are.
  if (ventures === null && def.scope === 'company') return { area: blank, groups: [], largest: null };
  const owned = new Set((ventures ?? []).map((v) => v.id));
  const list = JSON.stringify([...owned]);
  try {
    const rows = await db.prepare(def.groups).bind(...binds(def, userId, list)).all();
    if (rows.success !== true || !Array.isArray(rows.results)) throw new Error(UNREADABLE);
    const groups = rows.results.map((row) => group(row, owned));
    let files = 0, measured = 0, unknown = 0;
    for (const g of groups) {
      files += g.files; measured += g.bytes; unknown += g.unknown;
      if (!count(files) || !count(measured) || !count(unknown)) throw new Error(UNREADABLE);
    }
    const area: StorageArea = { key: def.key, kind: def.kind, files, bytes: unknown > 0 ? null : measured,
      measured_bytes: measured, unknown_size_files: unknown, recorded: true };
    let largest: Largest[] | null = null;
    try {
      const top = await db.prepare(def.largest).bind(...binds(def, userId, list)).all();
      if (top.success !== true || !Array.isArray(top.results)) throw new Error(UNREADABLE);
      largest = top.results.map((row) => largestRow(def, row));
    } catch {
      largest = null; // The list says it is incomplete; the area's figures stand.
    }
    return { area, groups, largest };
  } catch {
    // A failed area is unknown, never an invented empty store. Other areas still resolve.
    return { area: blank, groups: [], largest: null };
  }
}

async function readVentures(db: D1Database, userId: number): Promise<Venture[] | null> {
  try {
    const rows = await db.prepare(OWNED).bind(userId).all<Venture>();
    if (rows.success !== true || !Array.isArray(rows.results)) return null;
    for (const v of rows.results) {
      if (!id(v.id) || !text(v.uid) || !text(v.name) || !text(v.company_uid) || !text(v.company_name)) return null;
      if (v.company_id !== null && !id(v.company_id)) return null;
    }
    return rows.results;
  } catch {
    return null;
  }
}

/** Sums that stay exact or become unknown; an unreadable part makes them all unknown. */
function sum(parts: ReadonlyArray<StorageArea | Figures & { recorded?: boolean }>): Figures {
  let files = 0, measured: number | null = 0, unknown = 0;
  for (const p of parts) {
    if (('recorded' in p && p.recorded === false) || p.files === null || p.measured_bytes === null || p.unknown_size_files === null) {
      return { files: null, bytes: null, measured_bytes: null, unknown_size_files: null };
    }
    files += p.files; unknown += p.unknown_size_files;
    if (!count(files) || !count(unknown)) return { files: null, bytes: null, measured_bytes: null, unknown_size_files: null };
    // An unsafe byte sum is unknown rather than rounded; the counts stay exact.
    measured = measured === null || !count(measured + p.measured_bytes) ? null : measured + p.measured_bytes;
  }
  return { files, bytes: unknown > 0 ? null : measured, measured_bytes: measured, unknown_size_files: unknown };
}

/**
 * The plan's state from the bytes measured so far. Files whose size is not
 * recorded can only add to it, so with any of them it is a floor, and the read
 * says how many (`unknown_size_files`). `over` is above the allowance, after a
 * plan change or two uploads at once; nothing is deleted or hidden either way.
 */
export function storageState(used: number | null, allowance: number | null, planKey: string | null): StorageState | null {
  if (planKey === 'admin') return 'no_allowance';
  if (used === null || !count(allowance) || allowance === 0 || !count(used)) return null;
  if (used > allowance) return 'over';
  if (used === allowance) return 'full';
  if (used * 100 >= allowance * 95) return 'near_95';
  if (used * 100 >= allowance * 80) return 'near_80';
  return 'ok';
}

async function readPlan(env: Env, user: User) {
  try {
    const key = await storagePlanKey(env, user);
    const plan = storagePlan(key)!;
    return { plan_key: key as string | null, allowance_bytes: plan.allowance_bytes, allowance_reason: plan.allowance_reason, plan_recorded: true };
  } catch {
    return { plan_key: null, allowance_bytes: null, allowance_reason: 'Storage plan unreadable', plan_recorded: false };
  }
}

function companiesOf(ventures: Venture[] | null, reads: AreaRead[]) {
  if (ventures === null) return null;
  const complete = reads.every((r) => r.area.recorded);
  const byProject = new Map<number | null, { files: number; measured: number; unknown: number }>();
  for (const r of reads) for (const g of r.groups) {
    const t = byProject.get(g.project_id) ?? { files: 0, measured: 0, unknown: 0 };
    t.files += g.files; t.measured += g.bytes; t.unknown += g.unknown;
    byProject.set(g.project_id, t);
  }
  const figures = (parts: Array<number | null>): Figures => {
    if (!complete) return { files: null, bytes: null, measured_bytes: null, unknown_size_files: null };
    return sum(parts.map((p) => {
      const t = byProject.get(p) ?? { files: 0, measured: 0, unknown: 0 };
      return { files: t.files, bytes: null, measured_bytes: t.measured, unknown_size_files: t.unknown };
    }));
  };
  const order = (a: Figures & { name: string | null }, b: Figures & { name: string | null }) =>
    (b.measured_bytes ?? 0) - (a.measured_bytes ?? 0) || (b.files ?? 0) - (a.files ?? 0) || String(a.name ?? '').localeCompare(String(b.name ?? ''));
  const companies = new Map<number, Venture[]>();
  const unassigned: Venture[] = [];
  for (const v of ventures) {
    if (v.company_id === null) unassigned.push(v);
    else companies.set(v.company_id, [...(companies.get(v.company_id) ?? []), v]);
  }
  const venture = (v: Venture) => ({ uid: v.uid, name: v.name, ...figures([v.id]) });
  const rows = [...companies.values()].map((list) => ({
    uid: list[0].company_uid, name: list[0].company_name, personal: false, ...figures(list.map((v) => v.id)),
    ventures: list.map(venture).sort(order),
  })).sort(order);
  // Files tied to no company: personal files, and ventures not yet in a company.
  rows.push({ uid: null, name: null, personal: true, ...figures([null, ...unassigned.map((v) => v.id)]),
    ventures: unassigned.map(venture).sort(order) });
  return rows;
}

export async function readStorageUsage(env: Env, user: User) {
  const db = env.DB;
  const ventures = await readVentures(db, user.id);
  const [reads, plan] = await Promise.all([
    Promise.all(AREAS.map((def) => readArea(db, def, user.id, ventures))),
    readPlan(env, user),
  ]);
  const areas = reads.map((r) => r.area);
  const total = sum(areas);
  const kinds = STORAGE_KINDS.map((kind) => {
    const parts = areas.filter((a) => a.kind === kind);
    return { key: kind, ...sum(parts), recorded: parts.every((a) => a.recorded) };
  });
  const names = new Map((ventures ?? []).map((v) => [v.id, v]));
  const largest = reads.flatMap((r) => r.largest ?? [])
    .sort((a, b) => b.bytes - a.bytes || String(b.added_at ?? '').localeCompare(String(a.added_at ?? '')))
    .slice(0, 10)
    .map(({ project_id, ...row }) => {
      const v = project_id === null ? undefined : names.get(project_id);
      return { ...row, name: row.area === 'brand_files' ? null : row.name, brand: row.area === 'brand_files' ? row.name : null,
        venture_uid: v?.uid ?? null, venture_name: v?.name ?? null, company_uid: v?.company_uid ?? null, company_name: v?.company_name ?? null };
    });
  return {
    total_bytes: total.bytes,
    files: total.files,
    unknown_size_files: total.unknown_size_files,
    measured_bytes: total.measured_bytes,
    areas,
    ...plan,
    state: storageState(total.measured_bytes, plan.allowance_bytes, plan.plan_key),
    kinds,
    companies: companiesOf(ventures, reads),
    largest,
    largest_complete: reads.every((r) => r.area.recorded && r.largest !== null),
  };
}
