/**
 * D4563 (#4563) — HQ Contracts › Corporate Governance: the governance
 * documents of Axal VC Holdings LLC, Axal VC Management LLC and Axal VC GP
 * LLC, their versions, and each entity's restricted ownership metadata
 * (migration 202611062154). The route is `routes/admin_governance.ts`.
 *
 * WHAT IS KEPT. A document (entity, category, title, status, effective date,
 * confidential) and its files as numbered, append-only versions in R2. A link
 * to the template library or to a signed envelope is a reference to that row,
 * never a copy of it.
 *
 * THE STATUS RULE. draft → review → approved → executed, and any status →
 * archived; an archived document returns to draft only. `executed` needs
 * evidence of signature: a version uploaded as the signed copy, or a linked
 * envelope that completed. Without one the move is refused, so an unsigned
 * draft is never marked executed.
 *
 * WHO. Every route is HQ's (`requireHqAuthoring`). A confidential document
 * is the Super Admin's alone: another admin's list counts it as withheld and
 * every read, file and write of it answers 404, as if it did not exist. The
 * ownership metadata is the Super Admin's alone too.
 *
 * FILES. PDF or Word (.docx), sniffed from their bytes (a declared type is
 * not trusted), at most 25 MB. Nothing about a file's contents is logged.
 */
import type { Env } from '../types';
import { AXAL_ENTITIES } from './legalDocFormat';

export const GOVERNANCE_ENTITIES = ['holdings', 'management', 'gp'] as const;
export type GovernanceEntity = typeof GOVERNANCE_ENTITIES[number];
export const GOVERNANCE_CATEGORIES = Object.freeze([
  { key: 'operating_agreement', label: 'Operating agreements' },
  { key: 'formation_certificate', label: 'Formation certificates' },
  { key: 'member_register', label: 'Member registers' },
  { key: 'resolution', label: 'Resolutions' },
  { key: 'signing_authority', label: 'Signing authority records' },
] as const);
export type GovernanceCategory = typeof GOVERNANCE_CATEGORIES[number]['key'];
export const GOVERNANCE_STATUSES = ['draft', 'review', 'approved', 'executed', 'archived'] as const;
export type GovernanceStatus = typeof GOVERNANCE_STATUSES[number];

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PDF = 'application/pdf';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const isEntity = (v: unknown): v is GovernanceEntity => typeof v === 'string' && (GOVERNANCE_ENTITIES as readonly string[]).includes(v);
export const isCategory = (v: unknown): v is GovernanceCategory => typeof v === 'string' && GOVERNANCE_CATEGORIES.some((c) => c.key === v);
export const isStatus = (v: unknown): v is GovernanceStatus => typeof v === 'string' && (GOVERNANCE_STATUSES as readonly string[]).includes(v);
export const entityName = (key: GovernanceEntity) => AXAL_ENTITIES[key].name;

/** The moves a status may make; `executed` additionally needs evidence of signature (`executedEvidence`). */
const NEXT: Readonly<Record<GovernanceStatus, readonly GovernanceStatus[]>> = Object.freeze({
  draft: ['review', 'archived'],
  review: ['draft', 'approved', 'archived'],
  approved: ['review', 'executed', 'archived'],
  executed: ['archived'],
  archived: ['draft'],
});
export const canMove = (from: GovernanceStatus, to: GovernanceStatus) => from === to || NEXT[from].includes(to);
export const nextStatuses = (from: GovernanceStatus): readonly GovernanceStatus[] => NEXT[from];

/** A date as YYYY-MM-DD that exists on the calendar, or null. */
export function dateOf(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** What a file's bytes are: a PDF, a Word document (an OOXML zip naming word/document.xml), or neither. */
export function sniffDocument(bytes: Uint8Array): typeof PDF | typeof DOCX | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') return PDF;
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    // A .docx names its main part in the zip's central directory; a plain zip or another Office file does not.
    const head = new TextDecoder('latin1').decode(bytes.length > 2_000_000 ? bytes.slice(bytes.length - 2_000_000) : bytes);
    if (head.includes('word/document.xml') && head.includes('[Content_Types].xml')) return DOCX;
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Where a version's file lives in R2. */
export const versionKey = (entity: GovernanceEntity, uid: string, version: number, type: string) =>
  `governance/${entity}/${uid}/v${version}.${type === PDF ? 'pdf' : 'docx'}`;

/** One ownership relationship: who holds what share of the entity, as the Super Admin records it. */
export type Ownership = { holder: string; interest: string | null; percent: number | null; note: string | null };

/** The ownership list a write may keep, or the reason it is refused. Nothing malformed is guessed. */
export function ownershipOf(raw: unknown): { ok: true; rows: Ownership[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'ownership must be a list' };
  if (raw.length > 50) return { ok: false, error: 'At most 50 ownership rows.' };
  const rows: Ownership[] = [];
  for (const r of raw) {
    const holder = typeof r?.holder === 'string' ? r.holder.trim().slice(0, 200) : '';
    if (!holder) return { ok: false, error: 'Every ownership row names its holder.' };
    const percent = r?.percent == null || r.percent === '' ? null : Number(r.percent);
    if (percent !== null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) return { ok: false, error: 'A percent is between 0 and 100.' };
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    rows.push({ holder, interest: text(r?.interest, 120), percent, note: text(r?.note, 300) });
  }
  const sum = rows.reduce((s, r) => s + (r.percent ?? 0), 0);
  if (sum > 100.0001) return { ok: false, error: 'The percents add up to more than 100.' };
  return { ok: true, rows };
}

export type DocRow = {
  id: number; uid: string; entity_key: GovernanceEntity; category: GovernanceCategory; title: string; status: GovernanceStatus;
  effective_date: string | null; confidential: number; template_slug: string | null; envelope_id: number | null;
  executed_version: number | null; created_by: number | null; updated_by: number | null; created_at: string; updated_at: string;
};
export type VersionRow = {
  id: number; document_uid: string; version: number; signed: number; r2_key: string; file_sha256: string; file_bytes: number;
  content_type: string; note: string | null; uploaded_by: number | null; created_at: string;
};

/** A document as the tab draws it. */
export const docView = (d: DocRow, latest: VersionRow | null, versions: number) => ({
  uid: d.uid, entity_key: d.entity_key, category: d.category, title: d.title, status: d.status, effective_date: d.effective_date,
  confidential: !!Number(d.confidential), template_slug: d.template_slug, envelope_id: d.envelope_id == null ? null : Number(d.envelope_id),
  executed_version: d.executed_version == null ? null : Number(d.executed_version), next_statuses: nextStatuses(d.status),
  versions, latest: latest ? versionView(latest) : null, updated_at: d.updated_at,
});
export const versionView = (v: VersionRow) => ({
  version: Number(v.version), signed: !!Number(v.signed), file_bytes: Number(v.file_bytes), content_type: v.content_type,
  file_sha256: v.file_sha256, note: v.note, created_at: v.created_at,
});

export async function readDoc(env: Env, uid: string): Promise<DocRow | null> {
  return (await env.DB.prepare('SELECT * FROM governance_documents WHERE uid = ?').bind(uid).first<DocRow>()) ?? null;
}
export async function readVersions(env: Env, uid: string): Promise<VersionRow[]> {
  const r = await env.DB.prepare('SELECT * FROM governance_document_versions WHERE document_uid = ? ORDER BY version DESC').bind(uid).all<VersionRow>();
  return (r.results || []) as VersionRow[];
}

/**
 * Whether a document may be marked executed, and what it names as signed: the
 * newest version uploaded as signed, else a linked envelope that completed.
 */
export async function executedEvidence(env: Env, doc: DocRow, versions: VersionRow[]): Promise<{ version: number | null; envelope: number | null } | null> {
  const signed = versions.find((v) => Number(v.signed) === 1);
  if (signed) return { version: Number(signed.version), envelope: null };
  if (doc.envelope_id != null) {
    const e = await env.DB.prepare("SELECT id FROM esign_envelopes WHERE id = ? AND status = 'completed'").bind(doc.envelope_id).first<{ id: number }>().catch(() => null);
    if (e) return { version: null, envelope: Number(e.id) };
  }
  return null;
}

/** Whether a template link names an active template of the library; an envelope link, an envelope that exists. */
export async function templateExists(env: Env, slug: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS ok FROM legal_templates WHERE slug = ? AND is_active = 1').bind(slug).first().catch(() => null));
}
export async function envelopeExists(env: Env, id: number): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS ok FROM esign_envelopes WHERE id = ?').bind(id).first().catch(() => null));
}
