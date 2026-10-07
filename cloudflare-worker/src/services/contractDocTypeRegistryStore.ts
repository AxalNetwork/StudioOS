import type { Env } from '../types';
import { getSQL } from '../db';

export type RegistryRowStatus = 'draft' | 'published';

/** A save against a published type. Null on a draft-only row, whose values live in the row itself. */
export interface RegistryPendingDraft {
  title: string;
  layer: string;
  party_roles: string[];
  required_fields: string[];
  updated_at: string | null;
  /** D622 — who saved the pending revision: the user id, and their name when the users row has one. */
  updated_by: number | null;
  updated_by_name: string | null;
}

export interface RegistryRow {
  doc_type: string;
  title: string;
  layer: string;
  party_roles: string[];
  required_fields: string[];
  status: RegistryRowStatus;
  overlap_note: string | null;
  published_at: string | null;
  published_by: number | null;
  publish_reason: string | null;
  updated_at: string | null;
  pending_draft: RegistryPendingDraft | null;
  source: 'code' | 'store';
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function pendingDraftOf(r: any): RegistryPendingDraft | null {
  if (
    r.draft_title == null
    && r.draft_layer == null
    && r.draft_party_roles_json == null
    && r.draft_required_fields_json == null
  ) return null;
  return {
    title: r.draft_title == null ? '' : String(r.draft_title),
    layer: r.draft_layer == null ? '' : String(r.draft_layer),
    party_roles: parseJsonArray(r.draft_party_roles_json),
    required_fields: parseJsonArray(r.draft_required_fields_json),
    updated_at: r.draft_updated_at ?? null,
    updated_by: r.draft_updated_by == null ? null : Number(r.draft_updated_by),
    updated_by_name: r.draft_updated_by_name == null || String(r.draft_updated_by_name).trim() === ''
      ? null : String(r.draft_updated_by_name),
  };
}

export async function listRegistryRows(env: Env): Promise<RegistryRow[]> {
  const sql = getSQL(env);
  try {
    const rows: any[] = await sql`
      SELECT r.doc_type, r.title, r.layer, r.party_roles_json, r.required_fields_json,
             r.status, r.overlap_note, r.published_at, r.published_by, r.publish_reason, r.updated_at,
             r.draft_title, r.draft_layer, r.draft_party_roles_json, r.draft_required_fields_json,
             r.draft_updated_at, r.draft_updated_by, u.name AS draft_updated_by_name
        FROM contract_doc_type_registry r
        LEFT JOIN users u ON u.id = r.draft_updated_by
       ORDER BY r.doc_type ASC
    `;
    return rows.map((r) => ({
      doc_type: String(r.doc_type),
      title: String(r.title),
      layer: String(r.layer),
      party_roles: parseJsonArray(r.party_roles_json),
      required_fields: parseJsonArray(r.required_fields_json),
      status: (String(r.status || 'draft') === 'published' ? 'published' : 'draft') as RegistryRowStatus,
      overlap_note: r.overlap_note ?? null,
      published_at: r.published_at ?? null,
      published_by: r.published_by ?? null,
      publish_reason: r.publish_reason ?? null,
      updated_at: r.updated_at ?? null,
      pending_draft: pendingDraftOf(r),
      source: 'store' as const,
    }));
  } catch {
    return [];
  } finally {
    await sql.end();
  }
}

export async function upsertDraft(
  env: Env,
  input: {
    doc_type: string;
    title: string;
    layer: string;
    party_roles: string[];
    required_fields: string[];
  },
  actorId: number,
): Promise<void> {
  const sql = getSQL(env);
  const docType = String(input.doc_type || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,80}$/.test(docType)) {
    throw Object.assign(new Error('doc_type must be a lowercase slug'), { status: 400, code: 'invalid_doc_type' });
  }
  try {
    await sql`
      INSERT INTO contract_doc_type_registry (
        doc_type, title, layer, party_roles_json, required_fields_json,
        status, created_by, updated_by
      ) VALUES (
        ${docType},
        ${String(input.title || '').trim()},
        ${String(input.layer || '').trim()},
        ${JSON.stringify(input.party_roles || [])},
        ${JSON.stringify(input.required_fields || [])},
        'draft',
        ${actorId},
        ${actorId}
      )
      ON CONFLICT(doc_type) DO UPDATE SET
        title = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN contract_doc_type_registry.title
          ELSE excluded.title
        END,
        layer = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN contract_doc_type_registry.layer
          ELSE excluded.layer
        END,
        party_roles_json = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN contract_doc_type_registry.party_roles_json
          ELSE excluded.party_roles_json
        END,
        required_fields_json = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN contract_doc_type_registry.required_fields_json
          ELSE excluded.required_fields_json
        END,
        status = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN contract_doc_type_registry.status
          ELSE 'draft'
        END,
        draft_title = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN excluded.title
          ELSE NULL
        END,
        draft_layer = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN excluded.layer
          ELSE NULL
        END,
        draft_party_roles_json = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN excluded.party_roles_json
          ELSE NULL
        END,
        draft_required_fields_json = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN excluded.required_fields_json
          ELSE NULL
        END,
        -- D622: millisecond resolution. Publish names the revision it
        -- reviewed by this stamp, so two saves in one second must not share it.
        draft_updated_at = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN strftime('%Y-%m-%d %H:%M:%f', 'now')
          ELSE NULL
        END,
        draft_updated_by = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN excluded.updated_by
          ELSE NULL
        END,
        updated_by = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN contract_doc_type_registry.updated_by
          ELSE excluded.updated_by
        END,
        updated_at = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN contract_doc_type_registry.updated_at
          ELSE CURRENT_TIMESTAMP
        END
    `;
  } finally {
    await sql.end();
  }
}

/** The live values a publish left in place, which the audit records (D622). */
export interface RegistryAppliedValues {
  title: string;
  layer: string;
  party_roles: string[];
  required_fields: string[];
}

export type PublishResult =
  | { ok: true; applied: RegistryAppliedValues }
  | { ok: false; code: 'not_found' | 'reviewed_draft_required' | 'draft_changed'; message: string };

/**
 * Publish a type. D622: when a revision is pending, the Super Admin names the
 * `draft_updated_at` they reviewed, and the publish applies that revision or
 * nothing. A save that lands after the review changes `draft_updated_at`, so
 * the guarded UPDATE matches no row and the publish is refused rather than
 * putting a copy nobody reviewed live under a reason written for another.
 * With nothing pending it publishes as before.
 */
export async function publishType(
  env: Env,
  docType: string,
  reason: string,
  actorId: number,
  reviewedDraftAt?: string | null,
): Promise<PublishResult> {
  const sql = getSQL(env);
  try {
    const row: any = await sql`
      SELECT doc_type, status, draft_updated_at FROM contract_doc_type_registry WHERE doc_type = ${docType} LIMIT 1
    `;
    if (!row[0]) {
      return { ok: false, code: 'not_found', message: 'No draft exists for this doc type.' };
    }
    const pending: string | null = row[0].draft_updated_at ?? null;
    const reviewed = reviewedDraftAt == null || String(reviewedDraftAt).trim() === '' ? null : String(reviewedDraftAt);
    if (pending !== null && reviewed === null) {
      return {
        ok: false,
        code: 'reviewed_draft_required',
        message: 'This type has a pending revision. Publish names the revision you reviewed, so nothing was published.',
      };
    }
    if (pending !== null && reviewed !== pending) {
      return {
        ok: false,
        code: 'draft_changed',
        message: 'The pending revision was saved again after you reviewed it. Nothing was published: review the new copy, then publish.',
      };
    }
    const updated: any[] = await sql`
      UPDATE contract_doc_type_registry
         SET title = CASE WHEN draft_title IS NOT NULL THEN draft_title ELSE title END,
             layer = CASE WHEN draft_layer IS NOT NULL THEN draft_layer ELSE layer END,
             party_roles_json = CASE WHEN draft_party_roles_json IS NOT NULL THEN draft_party_roles_json ELSE party_roles_json END,
             required_fields_json = CASE WHEN draft_required_fields_json IS NOT NULL THEN draft_required_fields_json ELSE required_fields_json END,
             status = 'published',
             published_at = CURRENT_TIMESTAMP,
             published_by = ${actorId},
             publish_reason = ${reason},
             updated_by = ${actorId},
             updated_at = CURRENT_TIMESTAMP,
             draft_title = NULL,
             draft_layer = NULL,
             draft_party_roles_json = NULL,
             draft_required_fields_json = NULL,
             draft_updated_at = NULL,
             draft_updated_by = NULL
       WHERE doc_type = ${docType}
         AND draft_updated_at IS ${pending}
       RETURNING title, layer, party_roles_json, required_fields_json
    `;
    if (!updated[0]) {
      // A save landed between the read above and this write.
      return {
        ok: false,
        code: 'draft_changed',
        message: 'The pending revision was saved again after you reviewed it. Nothing was published: review the new copy, then publish.',
      };
    }
    return {
      ok: true,
      applied: {
        title: String(updated[0].title),
        layer: String(updated[0].layer),
        party_roles: parseJsonArray(updated[0].party_roles_json),
        required_fields: parseJsonArray(updated[0].required_fields_json),
      },
    };
  } finally {
    await sql.end();
  }
}
