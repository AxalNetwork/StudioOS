import type { Env } from '../types';
import { getSQL } from '../db';

export type RegistryRowStatus = 'draft' | 'published';

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

export async function listRegistryRows(env: Env): Promise<RegistryRow[]> {
  const sql = getSQL(env);
  try {
    const rows: any[] = await sql`
      SELECT doc_type, title, layer, party_roles_json, required_fields_json,
             status, overlap_note, published_at, published_by, publish_reason, updated_at
        FROM contract_doc_type_registry
       ORDER BY doc_type ASC
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
        title = excluded.title,
        layer = excluded.layer,
        party_roles_json = excluded.party_roles_json,
        required_fields_json = excluded.required_fields_json,
        status = CASE
          WHEN contract_doc_type_registry.status = 'published' THEN contract_doc_type_registry.status
          ELSE 'draft'
        END,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `;
  } finally {
    await sql.end();
  }
}

export async function publishType(
  env: Env,
  docType: string,
  reason: string,
  actorId: number,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const sql = getSQL(env);
  try {
    const row: any = await sql`
      SELECT doc_type, status FROM contract_doc_type_registry WHERE doc_type = ${docType} LIMIT 1
    `;
    if (!row[0]) {
      return { ok: false, code: 'not_found', message: 'No draft exists for this doc type.' };
    }
    await sql`
      UPDATE contract_doc_type_registry
         SET status = 'published',
             published_at = CURRENT_TIMESTAMP,
             published_by = ${actorId},
             publish_reason = ${reason},
             updated_by = ${actorId},
             updated_at = CURRENT_TIMESTAMP
       WHERE doc_type = ${docType}
    `;
    return { ok: true };
  } finally {
    await sql.end();
  }
}
