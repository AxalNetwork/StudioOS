/**
 * D5456 (#5456, ADP-02 of #5453) — durable private deal preparation drafts: create, versioned save, the detail and
 * revision reads, with optimistic concurrency, operation keys and the audit row in one D1 batch. Built on D5454's
 * boundary (services/dealPreparation.ts): its tables, capability check, issuer pair and authoring projection.
 *
 * STILL DISABLED. Every write takes the caller's capabilities as computed by `preparationCapabilities`, and refuses
 * without `create` / `edit`. `PREPARATION_MUTATIONS_ENABLED` keeps both false, so in production no route here writes.
 * Tests pass a capability set to prove the store; enabling it is a reviewed change to D5454's flag, never a setting.
 *
 * NO DEAL ROW. A created preparation has origin `preparation` and no `deal_id` (CHECK `dp_private_owns_no_deal`,
 * owner question Q2 of D5454): nothing here inserts into or updates `deals`, so no deal reader can see a draft.
 *
 * ONE BATCH PER WRITE. The revision insert, the preparation pointer and lock move, the operation row and the
 * `admin_audit_log` row are one `DB.batch` (one transaction). Each statement after the first runs only if the one
 * before it changed a row, so a stale or refused write leaves nothing, and an audit or ledger failure undoes the
 * content change. A batch that throws is reconciled by reading what committed, never reported as "nothing changed"
 * when the outcome is unknown.
 *
 * CONCURRENCY. `deal_preparations.lock_version` is the revision token a save names (`expected_revision`). The write
 * is conditional on it; a stale save is a structured conflict carrying the current revision and, for each key the
 * save tried to change, its value now. Nothing is merged: the editor reloads and reapplies.
 *
 * IDEMPOTENCY. An operation key is scoped to the deployment, the admin, the action and the target (the preparation
 * uid for a save, '' for a create). The payload digest covers the issuer pair, the expected revision and the
 * validated changes. Same key and digest: the stored outcome. Same key, other digest: `operation_key_reused`.
 */
import type { Env, User } from '../types';
import { adminAuditStatement } from './adminAudit';
import { ensureAdminAuditLogTable } from '../routes/admin';
import {
  deploymentScope, issuerDrift, project, resolveIssuerPair, type IssuerRefusal, type PreparationCapability,
} from './dealPreparation';
import {
  canonicalJson, crossFieldErrors, mergeContent, readinessWarnings, sha256Hex, validateChanges,
  type Content, type FieldErrors,
} from './dealDraftValidation';

export type StoreDeps = {
  /** The caller's capabilities on this preparation, from `preparationCapabilities`. */
  capabilities: ReadonlySet<PreparationCapability>;
  now: () => Date;
  newUid?: () => string;
};

export type Refusal = { ok: false; status: number; code: string; extra?: Record<string, unknown> };
export type CreateOutcome = { ok: true; replayed: boolean; preparation_uid: string; revision_uid: string; revision_no: number; revision: number; saved_at: string };
export type SaveOutcome = CreateOutcome & { unchanged?: boolean };

export const OPERATION_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
/** Mirrors the revision table's CHECK (`length(content_json) <= 65536`), measured the way SQLite measures text. */
export const CONTENT_MAX = 65536;
/** States whose working revision may be edited. `in_review`/`approved` wait for ADP-04's invalidation rule. */
export const EDITABLE_STATES = ['draft', 'changes_requested'] as const;
export const REVISIONS_PAGE_MAX = 100;

const refuse = (status: number, code: string, extra?: Record<string, unknown>): Refusal => ({ ok: false, status, code, ...(extra ? { extra } : {}) });

/** `YYYY-MM-DD HH:MM:SS`, the shape `datetime('now')` writes, so stored times compare as the columns' defaults do. */
export const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

async function readPreparation(env: Env, uid: string) {
  return env.DB.prepare(`SELECT id, uid, scope_code, company_id, project_id, deal_id, origin, preparation_state, publication_state,
  working_revision_id, submitted_revision_id, approved_revision_id, released_revision_id, lock_version,
  created_by_user_id, updated_by_user_id, created_at, updated_at
    FROM deal_preparations WHERE uid = ? AND scope_code = ?`)
    .bind(uid, deploymentScope(env)).first<any>();
}

async function readRevision(env: Env, id: unknown) {
  if (id == null) return null;
  return env.DB.prepare(`SELECT id, uid, preparation_id, revision_no, company_id, project_id, content_json, content_sha256,
      created_by_user_id, created_at FROM deal_preparation_revisions WHERE id = ?`).bind(Number(id)).first<any>();
}

const parseContent = (json: unknown): Content => {
  try { const v = JSON.parse(String(json ?? '{}')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

/** The stored outcome of an operation key, or null. */
async function readOperation(env: Env, actorId: number, action: 'create' | 'save', target: string, key: string) {
  return env.DB.prepare(
    `SELECT o.payload_sha256, o.lock_version, o.created_at, p.uid AS preparation_uid, r.uid AS revision_uid, r.revision_no
       FROM deal_preparation_operations o
       JOIN deal_preparations p ON p.id = o.preparation_id
       JOIN deal_preparation_revisions r ON r.id = o.revision_id
      WHERE o.scope_code = ? AND o.actor_user_id = ? AND o.action = ? AND o.target_uid = ? AND o.op_key = ?`,
  ).bind(deploymentScope(env), actorId, action, target, key).first<any>();
}

function replay(op: any, digest: string): CreateOutcome | Refusal {
  if (op.payload_sha256 !== digest) return refuse(409, 'operation_key_reused');
  return {
    ok: true, replayed: true, preparation_uid: String(op.preparation_uid), revision_uid: String(op.revision_uid),
    revision_no: Number(op.revision_no), revision: Number(op.lock_version), saved_at: String(op.created_at),
  };
}

const ISSUER_STATUS: Record<IssuerRefusal, number> = {
  invalid_pair: 400, project_not_found: 404, project_has_no_company: 422, company_mismatch: 422, company_not_found: 404, company_archived: 422,
};

function invalid(errors: FieldErrors): Refusal | null {
  return Object.keys(errors).length ? refuse(422, 'invalid_fields', { fields: errors }) : null;
}

function contentJson(content: Content): string | null {
  const json = canonicalJson(content);
  return new TextEncoder().encode(json).length > CONTENT_MAX ? null : json;
}

// ---------------------------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------------------------

export type CreateInput = { company_id: unknown; project_id: unknown; new_round?: unknown; content?: unknown; operation_key: unknown };

/**
 * Creates a private preparation for a company-backed project, with revision 1 as its working revision. An explicit
 * action only: nothing else creates one. While an unreleased preparation of the same issuer pair exists, a create is
 * refused with that preparation's uid (`open_preparation_exists`) unless the caller says `new_round: true`; nothing
 * is merged by name.
 */
export async function createPreparationDraft(env: Env, actor: User, input: CreateInput, deps: StoreDeps): Promise<CreateOutcome | Refusal> {
  if (!deps.capabilities.has('create')) return refuse(403, 'preparation_create_not_permitted');
  const key = typeof input.operation_key === 'string' ? input.operation_key : '';
  if (!OPERATION_KEY.test(key)) return refuse(400, 'invalid_operation_key');
  if (input.new_round !== undefined && typeof input.new_round !== 'boolean') return refuse(400, 'invalid_new_round');
  const newRound = input.new_round === true;
  const companyId = Number(input.company_id), projectId = Number(input.project_id);

  const { values, errors } = validateChanges(input.content);
  const bad = invalid({ ...errors, ...crossFieldErrors(values) });
  if (bad) return bad;
  const json = contentJson(values);
  if (json == null) return refuse(413, 'content_too_large');

  const actorId = Number(actor.id);
  const digest = await sha256Hex(canonicalJson({ action: 'create', company_id: companyId, project_id: projectId, new_round: newRound, content: values }));
  const prior = await readOperation(env, actorId, 'create', '', key);
  if (prior) return replay(prior, digest);

  const issuer = await resolveIssuerPair(env, { company_id: input.company_id, project_id: input.project_id });
  if (!issuer.ok) return refuse(ISSUER_STATUS[issuer.code], issuer.code);

  const scope = deploymentScope(env);
  const open = await env.DB.prepare(
    `SELECT uid FROM deal_preparations WHERE company_id = ? AND project_id = ? AND scope_code = ? AND origin = 'preparation'
       AND released_revision_id IS NULL ORDER BY id DESC LIMIT 1`,
  ).bind(issuer.company_id, issuer.project_id, scope).first<{ uid: string }>();
  if (open && !newRound) return refuse(409, 'open_preparation_exists', { preparation_uid: open.uid });

  const newUid = deps.newUid ?? (() => crypto.randomUUID());
  const prepUid = newUid(), revUid = newUid();
  const at = sqlTime(deps.now());
  const sha = await sha256Hex(json);
  await ensureAdminAuditLogTable(env);
  const stmts = [
    // The insert re-checks "no open preparation" inside the batch, so two concurrent creates with different keys
    // cannot both open one; the loser's revision insert then finds no preparation and the batch aborts.
    env.DB.prepare(
      `INSERT INTO deal_preparations (uid, scope_code, company_id, project_id, deal_id, origin, preparation_state, publication_state,
          lock_version, created_by_user_id, updated_by_user_id, created_at, updated_at)
       SELECT ?, ?, ?, ?, NULL, 'preparation', 'draft', 'unreleased', 1, ?, ?, ?, ?
        WHERE ? = 1 OR NOT EXISTS (SELECT 1 FROM deal_preparations WHERE company_id = ? AND project_id = ? AND scope_code = ?
          AND origin = 'preparation' AND released_revision_id IS NULL)`,
    ).bind(prepUid, scope, issuer.company_id, issuer.project_id, actorId, actorId, at, at, newRound ? 1 : 0, issuer.company_id, issuer.project_id, scope),
    env.DB.prepare(
      `INSERT INTO deal_preparation_revisions (uid, preparation_id, revision_no, company_id, project_id, content_json, content_sha256, created_by_user_id, created_at)
       VALUES (?, (SELECT id FROM deal_preparations WHERE uid = ?), 1, ?, ?, ?, ?, ?, ?)`,
    ).bind(revUid, prepUid, issuer.company_id, issuer.project_id, json, sha, actorId, at),
    env.DB.prepare(
      `UPDATE deal_preparations SET working_revision_id = (SELECT id FROM deal_preparation_revisions WHERE uid = ?) WHERE uid = ?`,
    ).bind(revUid, prepUid),
    env.DB.prepare(
      `INSERT INTO deal_preparation_operations (scope_code, actor_user_id, action, target_uid, op_key, payload_sha256, preparation_id, revision_id, lock_version, created_at)
       SELECT ?, ?, 'create', '', ?, ?, p.id, p.working_revision_id, p.lock_version, ?
         FROM deal_preparations p WHERE p.uid = ? AND p.working_revision_id IS NOT NULL AND changes() > 0`,
    ).bind(scope, actorId, key, digest, at, prepUid),
    adminAuditStatement(env, actorId, 'deal_preparation_created', {
      preparation_uid: prepUid, revision_no: 1, company_id: issuer.company_id, project_id: issuer.project_id, new_round: newRound,
    }, { onlyIfChanged: true }),
  ];
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    console.warn('[deal-draft] create batch failed', { code: 'batch_failed' });
    return reconcileCreate(env, actorId, key, digest, prepUid, revUid, issuer, newRound, err);
  }
  return reconcileCreate(env, actorId, key, digest, prepUid, revUid, issuer, newRound, null);
}

/** What committed: our own rows, a concurrent retry of the same key, an open preparation that won, or unknown. */
async function reconcileCreate(
  env: Env, actorId: number, key: string, digest: string, prepUid: string, revUid: string,
  issuer: { company_id: number; project_id: number }, newRound: boolean, err: unknown,
): Promise<CreateOutcome | Refusal> {
  const op = await readOperation(env, actorId, 'create', '', key);
  if (op) {
    if (String(op.preparation_uid) === prepUid) {
      return { ok: true, replayed: false, preparation_uid: prepUid, revision_uid: revUid, revision_no: 1, revision: Number(op.lock_version), saved_at: String(op.created_at) };
    }
    return replay(op, digest);
  }
  if (!newRound) {
    const open = await env.DB.prepare(
      `SELECT uid FROM deal_preparations WHERE company_id = ? AND project_id = ? AND scope_code = ? AND origin = 'preparation'
         AND released_revision_id IS NULL ORDER BY id DESC LIMIT 1`,
    ).bind(issuer.company_id, issuer.project_id, deploymentScope(env)).first<{ uid: string }>();
    if (open && open.uid !== prepUid) return refuse(409, 'open_preparation_exists', { preparation_uid: open.uid });
  }
  // Nothing of ours committed and nothing explains why: the client retries with the same key to learn the outcome.
  return refuse(err ? 503 : 500, 'create_outcome_unknown');
}

// ---------------------------------------------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------------------------------------------

export type SaveInput = { expected_revision: unknown; operation_key: unknown; changes: unknown };

function conflictBody(prep: any, rev: any, changes: Content) {
  const current = parseContent(rev?.content_json);
  const fields: Array<{ key: string; yours: unknown; current: unknown }> = [];
  for (const k of Object.keys(changes)) {
    const mine = (changes as any)[k] ?? null, now = (current as any)[k] ?? null;
    if (canonicalJson(mine) !== canonicalJson(now)) fields.push({ key: k, yours: mine, current: now });
  }
  return {
    current: {
      revision: Number(prep.lock_version), revision_no: rev ? Number(rev.revision_no) : null,
      preparation_state: prep.preparation_state, saved_at: prep.updated_at ?? null,
      saved_by_user_id: prep.updated_by_user_id == null ? null : Number(prep.updated_by_user_id),
    },
    fields,
  };
}

/**
 * Saves a new working revision: the current working content with `changes` applied, written only if the preparation
 * still holds `expected_revision`. Earlier revisions are never touched; a submitted or released revision stays as
 * it is (the pointers are separate). The issuer pinned on the preparation is re-checked: a project that has moved to
 * another company, or lost it, is refused for reconciliation instead of carrying the draft to a new issuer.
 */
export async function savePreparationDraft(env: Env, actor: User, uid: string, input: SaveInput, deps: StoreDeps): Promise<SaveOutcome | Refusal> {
  if (!deps.capabilities.has('edit')) return refuse(403, 'preparation_edit_not_permitted');
  const key = typeof input.operation_key === 'string' ? input.operation_key : '';
  if (!OPERATION_KEY.test(key)) return refuse(400, 'invalid_operation_key');
  const expected = Number(input.expected_revision);
  if (input.expected_revision == null || !Number.isSafeInteger(expected) || expected < 1) return refuse(428, 'expected_revision_required');
  if (input.changes == null || typeof input.changes !== 'object' || Array.isArray(input.changes) || !Object.keys(input.changes).length) {
    return refuse(400, 'changes_required');
  }
  const { values, errors } = validateChanges(input.changes);
  const bad = invalid(errors);
  if (bad) return bad;

  const prep = await readPreparation(env, uid);
  if (!prep) return refuse(404, 'preparation_not_found');
  const actorId = Number(actor.id);
  const digest = await sha256Hex(canonicalJson({
    action: 'save', preparation_uid: uid, company_id: Number(prep.company_id), project_id: Number(prep.project_id),
    expected_revision: expected, changes: values,
  }));
  const prior = await readOperation(env, actorId, 'save', uid, key);
  if (prior) return replay(prior, digest);

  const rev = await readRevision(env, prep.working_revision_id);
  if (!(EDITABLE_STATES as readonly string[]).includes(String(prep.preparation_state))) {
    return refuse(409, 'preparation_not_editable', { preparation_state: prep.preparation_state });
  }
  if (Number(prep.lock_version) !== expected) return refuse(409, 'revision_conflict', conflictBody(prep, rev, values));

  const issuer = await resolveIssuerPair(env, { company_id: prep.company_id, project_id: prep.project_id });
  if (!issuer.ok) return refuse(409, 'issuer_reconciliation_required', { reason: issuer.code });

  const merged = mergeContent(parseContent(rev?.content_json), values);
  const cross = invalid(crossFieldErrors(merged));
  if (cross) return cross;
  const json = contentJson(merged);
  if (json == null) return refuse(413, 'content_too_large');
  const sha = await sha256Hex(json);
  if (rev && rev.content_sha256 === sha) {
    return {
      ok: true, replayed: false, unchanged: true, preparation_uid: uid, revision_uid: String(rev.uid), revision_no: Number(rev.revision_no),
      revision: Number(prep.lock_version), saved_at: String(prep.updated_at),
    };
  }

  const maxNo = await env.DB.prepare('SELECT COALESCE(MAX(revision_no), 0) AS n FROM deal_preparation_revisions WHERE preparation_id = ?')
    .bind(Number(prep.id)).first<{ n: number }>();
  const revisionNo = Number(maxNo?.n ?? 0) + 1;
  const revUid = (deps.newUid ?? (() => crypto.randomUUID()))();
  const at = sqlTime(deps.now());
  const scope = deploymentScope(env);
  await ensureAdminAuditLogTable(env);
  const stmts = [
    // Conditional on the token, the editable state and the issuer pair the checks above read; a concurrent save that
    // committed first moved the token, so this inserts nothing and every statement after it is skipped.
    env.DB.prepare(
      `INSERT INTO deal_preparation_revisions (uid, preparation_id, revision_no, company_id, project_id, content_json, content_sha256, created_by_user_id, created_at)
       SELECT ?, id, ?, company_id, project_id, ?, ?, ?, ?
         FROM deal_preparations
        WHERE id = ? AND scope_code = ? AND lock_version = ? AND company_id = ? AND project_id = ?
          AND preparation_state IN ('draft', 'changes_requested')`,
    ).bind(revUid, revisionNo, json, sha, actorId, at, Number(prep.id), scope, expected, Number(prep.company_id), Number(prep.project_id)),
    env.DB.prepare(
      `UPDATE deal_preparations
          SET working_revision_id = (SELECT id FROM deal_preparation_revisions WHERE uid = ?),
              lock_version = lock_version + 1, updated_by_user_id = ?, updated_at = ?
        WHERE id = ? AND lock_version = ? AND EXISTS (SELECT 1 FROM deal_preparation_revisions WHERE uid = ?)`,
    ).bind(revUid, actorId, at, Number(prep.id), expected, revUid),
    env.DB.prepare(
      `INSERT INTO deal_preparation_operations (scope_code, actor_user_id, action, target_uid, op_key, payload_sha256, preparation_id, revision_id, lock_version, created_at)
       SELECT ?, ?, 'save', ?, ?, ?, p.id, r.id, p.lock_version, ?
         FROM deal_preparations p JOIN deal_preparation_revisions r ON r.uid = ? AND r.preparation_id = p.id
        WHERE p.id = ? AND p.working_revision_id = r.id AND changes() > 0`,
    ).bind(scope, actorId, uid, key, digest, at, revUid, Number(prep.id)),
    adminAuditStatement(env, actorId, 'deal_preparation_saved', {
      preparation_uid: uid, revision_no: revisionNo, from_revision: expected, fields: Object.keys(values).sort(),
    }, { onlyIfChanged: true }),
  ];
  let failed: unknown = null;
  try { await env.DB.batch(stmts); } catch (err) { failed = err; console.warn('[deal-draft] save batch failed', { code: 'batch_failed' }); }

  const op = await readOperation(env, actorId, 'save', uid, key);
  if (op) {
    if (String(op.revision_uid) === revUid) {
      return { ok: true, replayed: false, preparation_uid: uid, revision_uid: revUid, revision_no: revisionNo, revision: Number(op.lock_version), saved_at: String(op.created_at) };
    }
    return replay(op, digest);
  }
  const now = await readPreparation(env, uid);
  if (now && Number(now.lock_version) !== expected) {
    return refuse(409, 'revision_conflict', conflictBody(now, await readRevision(env, now.working_revision_id), values));
  }
  if (now && !(EDITABLE_STATES as readonly string[]).includes(String(now.preparation_state))) {
    return refuse(409, 'preparation_not_editable', { preparation_state: now.preparation_state });
  }
  return refuse(failed ? 503 : 500, 'save_outcome_unknown');
}

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------

/**
 * The authoring view of one preparation: D5454's `authoring` projection of the working revision, its revision
 * number, the readiness warnings, and both issuer contexts (the pinned pair and whether the project still belongs
 * to that company). Null when the caller lacks `read` or the preparation is not in this deployment.
 */
export async function readPreparationDetail(env: Env, uid: string, deps: Pick<StoreDeps, 'capabilities' | 'now'>) {
  if (!deps.capabilities.has('read')) return null;
  const prep = await readPreparation(env, uid);
  if (!prep) return null;
  const rev = await readRevision(env, prep.working_revision_id);
  const content = parseContent(rev?.content_json);
  const view = project('authoring', prep, rev ? { id: rev.id, content } : null);
  const issuer = await env.DB.prepare(
    `SELECT p.name AS project_name, p.company_id AS project_company_id, p.deleted_at AS project_deleted_at,
            c.company_name AS company_name
       FROM projects p LEFT JOIN company_profiles c ON c.id = ? WHERE p.id = ?`,
  ).bind(Number(prep.company_id), Number(prep.project_id)).first<any>();
  const current = issuer && !issuer.project_deleted_at ? { company_id: issuer.project_company_id } : null;
  return {
    preparation: view,
    revision: Number(prep.lock_version),
    revision_no: rev ? Number(rev.revision_no) : null,
    saved_at: prep.updated_at ?? null,
    warnings: readinessWarnings(content, deps.now()),
    issuer: {
      company_id: Number(prep.company_id), company_name: issuer?.company_name ?? null,
      project_id: Number(prep.project_id), project_name: issuer?.project_name ?? null,
      drift: issuerDrift({ company_id: prep.company_id, project_id: prep.project_id }, current),
    },
  };
}

/** Revision metadata, newest first, keyset-paged by revision number. No content: a list never carries terms. */
export async function readPreparationRevisions(env: Env, uid: string, opts: { before?: unknown; limit?: unknown }, deps: Pick<StoreDeps, 'capabilities'>) {
  if (!deps.capabilities.has('read')) return null;
  const prep = await readPreparation(env, uid);
  if (!prep) return null;
  const n = Number(opts.limit);
  const limit = Number.isSafeInteger(n) && n > 0 ? Math.min(n, REVISIONS_PAGE_MAX) : 25;
  const b = Number(opts.before);
  const before = Number.isSafeInteger(b) && b > 0 ? b : null;
  const res = await env.DB.prepare(
    `SELECT id, uid, revision_no, company_id, project_id, content_sha256, created_by_user_id, created_at
       FROM deal_preparation_revisions WHERE preparation_id = ? AND (? IS NULL OR revision_no < ?)
      ORDER BY revision_no DESC LIMIT ?`,
  ).bind(Number(prep.id), before, before, limit + 1).all<any>();
  const rows = res.results || [];
  const page = rows.slice(0, limit);
  const pointer = (id: unknown) => (k: string) => prep[k] != null && Number(prep[k]) === Number(id);
  return {
    items: page.map((r) => {
      const is = pointer(r.id);
      return {
        uid: r.uid, revision_no: Number(r.revision_no), company_id: Number(r.company_id), project_id: Number(r.project_id),
        content_sha256: r.content_sha256, created_by_user_id: Number(r.created_by_user_id), created_at: r.created_at,
        working: is('working_revision_id'), submitted: is('submitted_revision_id'), approved: is('approved_revision_id'), released: is('released_revision_id'),
      };
    }),
    next_before: rows.length > limit && page.length ? Number(page[page.length - 1].revision_no) : null,
  };
}
