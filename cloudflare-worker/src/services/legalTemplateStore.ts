// Task #8 — Worker-owned (D1) legal template store.
//
// Canonical store for legal template markdown bodies, categories, merge
// fields and version history. Backs the admin Templates CRUD surface and
// is the preferred body source for prod doc-generation (legal.ts) and
// e-sign envelope rendering (esign.ts), falling back to the legacy
// inline/.md sources when a slug has no active body here.
//
// Schema lives in migration 084_legal_templates.sql + 085 seed; the lazy
// `ensureLegalTemplatesSchema` below mirrors the esign.ts pattern so reads
// self-heal on a D1 that has not had the migration applied yet.
import type { Env } from '../types';

export const LEGAL_TEMPLATE_CATEGORIES = ['gp', 'fund', 'portfolio', 'compliance'] as const;
export type LegalTemplateCategory = (typeof LEGAL_TEMPLATE_CATEGORIES)[number];
const VALID_CATEGORIES = new Set<string>(LEGAL_TEMPLATE_CATEGORIES);

export interface LegalTemplate {
  id: number;
  slug: string;
  title: string;
  category: string;
  body_md: string;
  merge_fields: string[];
  version: number;
  is_active: number;
  is_stub: number;
  created_at: string | null;
  updated_at: string | null;
  created_by: number | null;
  updated_by: number | null;
}

export interface LegalTemplateVersion {
  version: number;
  title: string;
  category: string;
  body_md: string;
  merge_fields: string[];
  created_at: string | null;
  created_by: number | null;
}

interface RawRow {
  id: number;
  slug: string;
  title: string;
  category: string;
  body_md: string;
  merge_fields: string | null;
  version: number;
  is_active: number;
  is_stub: number;
  created_at: string | null;
  updated_at: string | null;
  created_by: number | null;
  updated_by: number | null;
}

let schemaReady = false;
export async function ensureLegalTemplatesSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS legal_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'gp',
      body_md TEXT NOT NULL DEFAULT '',
      merge_fields TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_stub INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      updated_by INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_legal_templates_category ON legal_templates(category)`,
    `CREATE INDEX IF NOT EXISTS idx_legal_templates_active ON legal_templates(is_active)`,
    `CREATE TABLE IF NOT EXISTS legal_template_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      body_md TEXT NOT NULL,
      merge_fields TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      UNIQUE(template_id, version)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_legal_template_versions_tpl ON legal_template_versions(template_id)`,
  ];
  for (const s of stmts) {
    try {
      await env.DB.prepare(s).run();
    } catch (e) {
      // Idempotent bootstrap — duplicate-object errors are expected on re-run.
      console.warn('[legalTemplateStore] ensureSchema stmt skipped:', (e as Error)?.message);
    }
  }
  schemaReady = true;
}

const MERGE_TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

// Merge fields are the single source of truth = the {{tokens}} actually
// present in the body. Derived on every write so the stored list never
// drifts from the markdown (explicit over silent — a field the body does
// not reference is never persisted).
export function extractMergeFields(body: string): string[] {
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  MERGE_TOKEN.lastIndex = 0;
  while ((m = MERGE_TOKEN.exec(body || '')) !== null) seen.add(m[1]);
  return Array.from(seen).sort();
}

function parseMergeFields(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function mapRow(r: RawRow): LegalTemplate {
  return { ...r, merge_fields: parseMergeFields(r.merge_fields) };
}

export function normalizeCategory(category: string | undefined | null): LegalTemplateCategory | null {
  const c = String(category || '').trim();
  return VALID_CATEGORIES.has(c) ? (c as LegalTemplateCategory) : null;
}

export async function listTemplates(env: Env, category?: string): Promise<LegalTemplate[]> {
  await ensureLegalTemplatesSchema(env);
  const where = ['is_active = 1'];
  const binds: any[] = [];
  const cat = normalizeCategory(category);
  if (category && cat) {
    where.push('category = ?');
    binds.push(cat);
  }
  const res = await env.DB.prepare(
    `SELECT * FROM legal_templates WHERE ${where.join(' AND ')} ORDER BY category, title`,
  )
    .bind(...binds)
    .all<RawRow>();
  return (res.results ?? []).map(mapRow);
}

export async function getTemplate(env: Env, slug: string): Promise<LegalTemplate | null> {
  await ensureLegalTemplatesSchema(env);
  const r = await env.DB.prepare(`SELECT * FROM legal_templates WHERE slug = ? AND is_active = 1`)
    .bind(slug)
    .first<RawRow>();
  return r ? mapRow(r) : null;
}

// Active, non-stub markdown body for a slug — the preferred render source
// for prod doc-generation and e-sign. Returns null when there is no usable
// body so callers fall back to their legacy source.
export async function getActiveTemplateBody(env: Env, slug: string): Promise<string | null> {
  try {
    await ensureLegalTemplatesSchema(env);
    const r = await env.DB.prepare(
      `SELECT body_md FROM legal_templates
        WHERE slug = ? AND is_active = 1 AND is_stub = 0 AND length(trim(body_md)) > 0`,
    )
      .bind(slug)
      .first<{ body_md: string }>();
    return r?.body_md ?? null;
  } catch (e) {
    console.warn('[legalTemplateStore] getActiveTemplateBody failed:', (e as Error)?.message);
    return null;
  }
}

export async function listVersions(
  env: Env,
  slug: string,
): Promise<{ current: LegalTemplate; versions: LegalTemplateVersion[] } | null> {
  const current = await getTemplate(env, slug);
  if (!current) return null;
  const res = await env.DB.prepare(
    `SELECT version, title, category, body_md, merge_fields, created_at, created_by
       FROM legal_template_versions WHERE template_id = ? ORDER BY version DESC`,
  )
    .bind(current.id)
    .all<{ version: number; title: string; category: string; body_md: string; merge_fields: string | null; created_at: string | null; created_by: number | null }>();
  const versions = (res.results ?? []).map((v) => ({ ...v, merge_fields: parseMergeFields(v.merge_fields) }));
  return { current, versions };
}

export class TemplateError extends Error {
  constructor(public code: string, public status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

export async function createTemplate(
  env: Env,
  input: { slug: string; title: string; category: string; body_md?: string },
  userId: number,
): Promise<LegalTemplate> {
  await ensureLegalTemplatesSchema(env);
  const slug = String(input.slug || '').trim();
  const title = String(input.title || '').trim();
  const cat = normalizeCategory(input.category);
  const body = String(input.body_md || '');
  if (!slug) throw new TemplateError('slug_required', 400, 'slug is required');
  if (!title) throw new TemplateError('title_required', 400, 'title is required');
  if (!cat) throw new TemplateError('invalid_category', 400, `category must be one of ${LEGAL_TEMPLATE_CATEGORIES.join(', ')}`);

  const exists = await env.DB.prepare(`SELECT id FROM legal_templates WHERE slug = ?`).bind(slug).first();
  if (exists) throw new TemplateError('slug_exists', 409, `A template with slug '${slug}' already exists`);

  const mf = JSON.stringify(extractMergeFields(body));
  const isStub = body.trim().length === 0 ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
  )
    .bind(slug, title, cat, body, mf, isStub, userId, userId)
    .run();
  const created = await getTemplate(env, slug);
  if (!created) throw new TemplateError('create_failed', 400, 'Template creation failed');
  return created;
}

export async function updateTemplate(
  env: Env,
  slug: string,
  patch: { title: string; category: string; body_md: string },
  userId: number,
): Promise<LegalTemplate> {
  await ensureLegalTemplatesSchema(env);
  const current = await getTemplate(env, slug);
  if (!current) throw new TemplateError('not_found', 404, `Template '${slug}' not found`);
  const title = String(patch.title || '').trim();
  const cat = normalizeCategory(patch.category);
  const body = String(patch.body_md ?? '');
  if (!title) throw new TemplateError('title_required', 400, 'title is required');
  if (!cat) throw new TemplateError('invalid_category', 400, `category must be one of ${LEGAL_TEMPLATE_CATEGORIES.join(', ')}`);

  const mf = JSON.stringify(extractMergeFields(body));
  const isStub = body.trim().length === 0 ? 1 : 0;

  // Atomic: snapshot the PRE-update row into history, then bump the live row.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by)
       SELECT id, slug, version, title, category, body_md, merge_fields, ? FROM legal_templates WHERE id = ?`,
    ).bind(userId, current.id),
    env.DB.prepare(
      `UPDATE legal_templates
          SET title = ?, category = ?, body_md = ?, merge_fields = ?,
              version = version + 1, is_stub = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
        WHERE id = ?`,
    ).bind(title, cat, body, mf, isStub, userId, current.id),
  ]);
  const updated = await getTemplate(env, slug);
  if (!updated) throw new TemplateError('update_failed', 400, 'Template update failed');
  return updated;
}

export async function softDeleteTemplate(env: Env, slug: string, userId: number): Promise<boolean> {
  await ensureLegalTemplatesSchema(env);
  const res = await env.DB.prepare(
    `UPDATE legal_templates SET is_active = 0, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE slug = ? AND is_active = 1`,
  )
    .bind(userId, slug)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
