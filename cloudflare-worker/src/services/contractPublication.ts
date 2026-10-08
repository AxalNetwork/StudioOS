import type { Env } from '../types';
import { extractMergeFields } from './legalTemplateStore';

export class ContractPreparationError extends Error {
  code: string;
  status: 400 | 403 | 404 | 409 | 422;
  fields: string[];
  constructor(code: string, status: 400 | 403 | 404 | 409 | 422, fields: string[] = []) {
    super(code); this.code = code; this.status = status; this.fields = fields;
  }
}

export async function preparePublishedContract(env: Env, input: Record<string, unknown>, actorId: number, superAdmin: boolean) {
  const slug = input.template_slug;
  const version = input.template_version;
  const email = typeof input.recipient_email === 'string' ? input.recipient_email.trim().toLowerCase() : '';
  const name = typeof input.recipient_name === 'string' ? input.recipient_name.trim() : '';
  if (typeof slug !== 'string' || slug.length > 200 || !Number.isSafeInteger(version)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254 || !name || name.length > 200) {
    throw new ContractPreparationError('recipient_or_template_invalid', 400);
  }
  const template = (await publishedContractTemplates(env)).find(t => t.slug === slug);
  if (!template) throw new ContractPreparationError('template_not_published', 404);
  if (template.version !== version) throw new ContractPreparationError('published_version_changed', 409);
  const recipient = await env.DB.prepare(`SELECT id, role, is_active, founder_public_id, partner_public_id FROM users
    WHERE LOWER(email) = ? ORDER BY id LIMIT 1`).bind(email).first<{ id: number; role: string; is_active: number; founder_public_id: string | null; partner_public_id: string | null }>();
  if (recipient && (!recipient.is_active || (recipient.role === 'admin' && recipient.id !== actorId && !superAdmin))) {
    throw new ContractPreparationError('recipient_unavailable', 403);
  }
  const dealId = input.deal_id == null ? null : input.deal_id;
  if (dealId !== null && (!Number.isSafeInteger(dealId) || Number(dealId) <= 0)) throw new ContractPreparationError('deal_invalid', 400);
  if (dealId !== null && !await env.DB.prepare('SELECT id FROM deals WHERE id = ?').bind(dealId).first()) {
    throw new ContractPreparationError('deal_not_found', 404);
  }
  const fields = input.fields ?? {};
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new ContractPreparationError('fields_invalid', 400);
  const allowed = new Set(publicationFields(template).filter(f => f.required).map(f => f.key));
  const merge: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key) || typeof value !== 'string' || value.length > 1000) throw new ContractPreparationError('fields_invalid', 400);
    merge[key] = value.trim();
  }
  const missing = [...allowed].filter(key => !merge[key]);
  if (missing.length) throw new ContractPreparationError('required_fields_missing', 422, missing);
  Object.assign(merge, { recipient_name: name, recipient_email: email, counterparty_name: name,
    effective_date: new Date().toISOString().slice(0, 10), 'counterparty.name': name,
    'counterparty.user_id': recipient?.id != null ? String(recipient.id) : null,
    'counterparty.founder_id': recipient?.founder_public_id ?? null,
    'counterparty.partner_id': recipient?.partner_public_id ?? null });
  // Field keys are literal tokens, including dotted keys. No object-path
  // writes and no dynamic regex are needed to resolve them.
  const body = template.body_md.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    (token, key: string) => typeof merge[key] === 'string' ? String(merge[key]) : token);
  const unresolved = extractMergeFields(body);
  if (unresolved.length) throw new ContractPreparationError('required_fields_missing', 422, unresolved);
  return { template, body, recipientEmail: email, recipientName: name, recipientUserId: recipient?.id ?? null, dealId: dealId as number | null };
}

export interface PublishedContractTemplate {
  template_id: number;
  slug: string;
  version: number;
  title: string;
  category: string;
  body_md: string;
  published_at: string;
  published_by: number;
}

// Draft edits do not change this body. Archiving withdraws it from new sends;
// existing envelopes retain their own immutable document copy.
export async function publishedContractTemplates(env: Env): Promise<PublishedContractTemplate[]> {
  const rows = await env.DB.prepare(`SELECT p.* FROM legal_template_publications p
    JOIN legal_templates t ON t.id = p.template_id
    WHERE t.is_active = 1
    ORDER BY p.title COLLATE NOCASE, p.slug`).all<PublishedContractTemplate>();
  return rows.results || [];
}

export function publicationFields(template: PublishedContractTemplate) {
  // Every body token must resolve for preview and send. Automatic recipient
  // and effective-date fields are supplied by the server, never by a client.
  const automatic = new Set(['recipient_name', 'recipient_email', 'counterparty_name', 'effective_date',
    'counterparty.name', 'counterparty.user_id', 'counterparty.founder_id', 'counterparty.partner_id']);
  return extractMergeFields(template.body_md).map(key => ({
    key, label: key.replace(/[._]+/g, ' '), required: !automatic.has(key),
    filled_by: automatic.has(key) ? 'send' : 'sender',
  }));
}

export async function publishContractTemplates(env: Env, actorId: number, actor: string) {
  const at = new Date().toISOString();
  // The snapshot and actor audit commit together. The select executes inside
  // the batch, so an edit between a preliminary read and publication cannot
  // publish a body under the wrong version.
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO legal_template_publications
      (template_id, slug, version, title, category, body_md, published_at, published_by)
      SELECT id, slug, version, title, category, body_md, ?, ? FROM legal_templates
      WHERE is_active = 1 AND is_stub = 0 AND LENGTH(TRIM(body_md)) > 0`).bind(at, actorId),
    env.DB.prepare(`DELETE FROM legal_template_publications WHERE template_id IN
      (SELECT id FROM legal_templates WHERE is_active <> 1 OR is_stub <> 0 OR LENGTH(TRIM(body_md)) = 0)`),
    env.DB.prepare(`INSERT INTO activity_logs (action, details, actor, user_id)
      VALUES ('contract_templates_published', ?, ?, ?)`)
      .bind(JSON.stringify({ published_at: at }), actor, actorId),
  ]);
  return publishedContractTemplates(env);
}
