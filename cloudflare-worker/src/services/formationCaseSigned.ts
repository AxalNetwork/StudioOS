/**
 * D6706 (#6706): what happens to a formation case when an envelope it sent
 * comes back signed. Run as the owed `formation_case_signed` effect
 * (services/esignEffects.ts, D8516): the signed copy goes on the case with the
 * SHA-256 of its file and, for a consent to act, the person's
 * consent_to_act_at is set, unless the person was edited after the envelope
 * was sent.
 *
 * Kept apart from formationDocuments.ts on purpose: the e-sign path loads this
 * module, and formationDocuments.ts reaches the legacy wizard (routes/legal.ts)
 * and through it billing. The fund flow's INV3 guard (D8534) forbids any
 * Stripe path in the e-sign module graph, so this file imports only what the
 * write needs.
 */
import type { Env } from '../types';
import { newUid } from '../routes/_t13t14t15_helpers';

const SHA256 = /^[0-9a-f]{64}$/;

export async function onCaseEnvelopeCompleted(env: Env, envelopeUuid: string) {
  const row = await env.DB.prepare(
    `SELECT l.id AS link_id, l.case_id, l.purpose, l.template_key, l.person_id, l.person_revision, l.signed_case_document_id,
            e.id AS envelope_id, e.status, e.signed_r2_key, e.completed_at, e.document_title, c.project_id, c.company_id
       FROM esign_envelopes e JOIN formation_case_envelopes l ON l.envelope_id = e.id JOIN formation_cases c ON c.id = l.case_id
      WHERE e.envelope_uuid = ?`,
  ).bind(envelopeUuid).first<any>();
  if (!row) return 'not_a_case_envelope' as const;
  if (row.signed_case_document_id != null) return 'already_recorded' as const;
  if (row.status !== 'completed') throw Object.assign(new Error('envelope_not_completed'), { code: 'envelope_not_completed' });
  const file = await env.DB.prepare(
    `SELECT uid, file_sha256, r2_key FROM legal_document_files WHERE envelope_id = ? AND kind = 'signed_copy' AND r2_key = ? ORDER BY id DESC LIMIT 1`,
  ).bind(row.envelope_id, row.signed_r2_key).first<{ uid: string; file_sha256: string; r2_key: string }>();
  if (!file || !SHA256.test(String(file.file_sha256))) throw Object.assign(new Error('signed_copy_missing'), { code: 'signed_copy_missing' });
  const docUid = `fcsigned${envelopeUuid.replace(/[^0-9a-f]/gi, '').toLowerCase()}`;
  const signedAt = row.completed_at ?? null;
  const pointer = JSON.stringify({ kind: 'esign_signed_copy', r2_key: file.r2_key, content_type: 'application/pdf', sha256: file.file_sha256,
    envelope_uuid: envelopeUuid, file_uid: file.uid });
  const consent = row.purpose === 'consent_to_act' && row.person_id != null;
  const statements = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO documents (uid, project_id, company_id, title, doc_type, status, content, template_name, signed_at)
       VALUES (?, ?, ?, ?, 'other', 'signed', ?, ?, ?)`,
    ).bind(docUid, row.project_id, row.project_id == null ? row.company_id : null, `${row.document_title} (signed)`, pointer,
      row.template_key, signedAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO formation_case_documents (uid, case_id, document_id, class, visible_to, added_by, origin, template_key, person_id, sha256)
       SELECT ?, ?, d.id, 'evidence', 'all', NULL, 'signed_copy', ?, ?, ? FROM documents d WHERE d.uid = ?`,
    ).bind(newUid(), row.case_id, row.template_key, row.person_id, file.file_sha256, docUid),
    env.DB.prepare(
      `UPDATE formation_case_envelopes SET signed_case_document_id = (SELECT cd.id FROM formation_case_documents cd JOIN documents d ON d.id = cd.document_id
         WHERE d.uid = ? AND cd.case_id = ? AND cd.class = 'evidence') WHERE id = ? AND signed_case_document_id IS NULL`,
    ).bind(docUid, row.case_id, row.link_id),
  ];
  if (consent) {
    statements.push(env.DB.prepare(
      `UPDATE formation_case_people SET consent_to_act_at = COALESCE(?, datetime('now'))
        WHERE id = ? AND case_id = ? AND revision = ? AND removed_at IS NULL AND consent_to_act_at IS NULL`,
    ).bind(signedAt, row.person_id, row.case_id, row.person_revision));
  }
  const results = await env.DB.batch(statements);
  const consentRecorded = consent && Number(results[3]?.meta?.changes ?? 0) > 0;
  await env.DB.prepare(
    `INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json) VALUES (?, NULL, 'system', 'document_signed', 'all', ?)`,
  ).bind(row.case_id, JSON.stringify({ envelope_uuid: envelopeUuid, template_key: row.template_key, sha256: file.file_sha256,
    purpose: row.purpose, ...(consent ? { consent_recorded: consentRecorded } : {}) })).run();
  return consent ? (consentRecorded ? 'consent_recorded' as const : 'consent_stale' as const) : 'recorded' as const;
}
