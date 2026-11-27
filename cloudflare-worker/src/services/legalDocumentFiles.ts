// D711 (#1776) — the legal file registry (migration 475).
//
// One append-only `legal_document_files` row per file the platform keeps or
// hands out. Ids, hashes, sizes and codes only: no name, email, IP or document
// text ever goes in a row. Previews are never stored and get no row.
//
// `fileRowStatement` returns a prepared INSERT the caller batches with the
// write it belongs to, so the file's row and its state change land together:
//   - a signed copy is inserted only while its recipient reads `signed`
//     (`whenRecipientSigned`), in the same batch as the UPDATE that signs;
//   - a DocuSign file ends `ON CONFLICT … DO NOTHING`, because the webhook and
//     the cron poller can both reconcile one envelope. Not `INSERT OR IGNORE`,
//     which would also drop a row that fails a CHECK.

import type { Env } from '../types';

export type LegalFileKind = 'signed_copy' | 'docusign_source' | 'docusign_signed' | 'docx_export';
export type LegalFileRenderer = 'browser_run' | 'pdf_lib' | 'docusign' | 'docx';

export interface LegalFileRow {
  uid: string;
  kind: LegalFileKind;
  envelopeId?: number | null;
  recipientId?: number | null;
  templateSlug?: string | null;
  templateVersion?: number | null;
  bodySha256?: string | null;
  fileSha256: string;
  fileBytes: number;
  contentType: string;
  pageSize?: 'letter' | 'a4' | null;
  renderer: LegalFileRenderer;
  paperSha256?: string | null;
  r2Key?: string | null;
  actorUserId?: number | null;
}

export interface FileRowOptions {
  /** Insert only while this recipient's status is `signed` (the signing batch). */
  whenRecipientSigned?: number;
}

export function newFileUid(): string {
  return crypto.randomUUID();
}

function values(row: LegalFileRow): unknown[] {
  return [
    row.uid, row.kind, row.envelopeId ?? null, row.recipientId ?? null, row.templateSlug ?? null,
    row.templateVersion ?? null, row.bodySha256 ?? null, row.fileSha256, row.fileBytes, row.contentType,
    row.pageSize ?? null, row.renderer, row.paperSha256 ?? null, row.r2Key ?? null, row.actorUserId ?? null,
  ];
}

export function fileRowStatement(env: Env, row: LegalFileRow, opts: FileRowOptions = {}): D1PreparedStatement {
  const vals = values(row);
  if (opts.whenRecipientSigned != null) {
    return env.DB.prepare(
      `INSERT INTO legal_document_files (
         uid, kind, envelope_id, recipient_id, template_slug, template_version, body_sha256,
         file_sha256, file_bytes, content_type, page_size, renderer, paper_sha256, r2_key, actor_user_id)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM esign_recipients WHERE id = ? AND status = 'signed')`,
    ).bind(...vals, opts.whenRecipientSigned);
  }
  if (row.kind === 'docusign_source' || row.kind === 'docusign_signed') {
    return env.DB.prepare(
      `INSERT INTO legal_document_files (
         uid, kind, envelope_id, recipient_id, template_slug, template_version, body_sha256,
         file_sha256, file_bytes, content_type, page_size, renderer, paper_sha256, r2_key, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (envelope_id, kind, file_sha256) WHERE kind IN ('docusign_source','docusign_signed') DO NOTHING`,
    ).bind(...vals);
  }
  return env.DB.prepare(
    `INSERT INTO legal_document_files (
         uid, kind, envelope_id, recipient_id, template_slug, template_version, body_sha256,
         file_sha256, file_bytes, content_type, page_size, renderer, paper_sha256, r2_key, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(...vals);
}
