import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const legal = new Hono<{ Bindings: Env }>();

const TEMPLATE_LAYERS: Record<string, { label: string; description: string }> = {
  gp: { label: 'Internal Management (GP Level)', description: 'Governance, partner economics, and decision-making framework' },
  fund: { label: 'Fund Formation (LP Level)', description: 'Capital raising, investor agreements, and fund structure' },
  portfolio: { label: 'Investment Execution (Portfolio Level)', description: 'Templates used when investing into startups' },
  compliance: { label: 'Compliance & Regulatory', description: 'SEC filings, AML/KYC, and tax elections' },
};

const TEMPLATES: Record<string, { title: string; layer: string; content: string }> = {
  operating_agreement: { title: 'Operating Agreement (LLC)', layer: 'gp', content: 'OPERATING AGREEMENT OF {company_name} LLC...' },
  carried_interest: { title: 'Carried Interest / Partnership Agreement', layer: 'gp', content: 'CARRIED INTEREST VESTING AGREEMENT...' },
  ic_charter: { title: 'Investment Committee Charter', layer: 'gp', content: 'INVESTMENT COMMITTEE CHARTER...' },
  service_agreement: { title: 'Partner Service Agreement', layer: 'gp', content: 'PARTNER SERVICE AGREEMENT...' },
  lpa: { title: 'Limited Partnership Agreement (LPA)', layer: 'fund', content: 'LIMITED PARTNERSHIP AGREEMENT...' },
  ppm: { title: 'Private Placement Memorandum (PPM)', layer: 'fund', content: 'CONFIDENTIAL PRIVATE PLACEMENT MEMORANDUM...' },
  subscription: { title: 'Subscription Agreement', layer: 'fund', content: 'SUBSCRIPTION AGREEMENT...' },
  mgmt_company: { title: 'Management Company Agreement', layer: 'fund', content: 'MANAGEMENT COMPANY AGREEMENT...' },
  safe: { title: 'SAFE Agreement', layer: 'portfolio', content: 'SIMPLE AGREEMENT FOR FUTURE EQUITY (SAFE)...' },
  term_sheet: { title: 'Term Sheet', layer: 'portfolio', content: 'TERM SHEET — NON-BINDING...' },
  bylaws: { title: 'Corporate Bylaws', layer: 'portfolio', content: 'BYLAWS OF {company_name}...' },
  equity_split: { title: 'Equity Split Agreement', layer: 'portfolio', content: 'EQUITY ALLOCATION AGREEMENT...' },
  ip_license: { title: 'IP License Agreement', layer: 'portfolio', content: 'INTELLECTUAL PROPERTY LICENSE AGREEMENT...' },
  spa: { title: 'Stock Purchase Agreement (SPA)', layer: 'portfolio', content: 'STOCK PURCHASE AGREEMENT...' },
  voting_rights: { title: "Voting & Investors' Rights Agreement", layer: 'portfolio', content: "INVESTORS' RIGHTS AGREEMENT..." },
  form_adv: { title: 'Form ADV / Investment Adviser Registration', layer: 'compliance', content: 'FORM ADV — INVESTMENT ADVISER REGISTRATION...' },
  aml_kyc: { title: 'AML/KYC Policy', layer: 'compliance', content: 'ANTI-MONEY LAUNDERING AND KNOW YOUR CUSTOMER POLICY...' },
  section_83b: { title: 'Section 83(b) Election', layer: 'compliance', content: 'SECTION 83(b) ELECTION...' },
};

legal.get('/templates', async (c) => {
  await requireAuth(c);
  const layers = Object.entries(TEMPLATE_LAYERS).map(([key, val]) => ({
    layer_key: key, ...val,
    templates: Object.entries(TEMPLATES).filter(([, t]) => t.layer === key).map(([k, t]) => ({ key: k, title: t.title })),
  }));
  return c.json({ layers, total_templates: Object.keys(TEMPLATES).length });
});

legal.get('/templates/:key', async (c) => {
  await requireAuth(c);
  const key = c.req.param('key');
  const template = TEMPLATES[key];
  if (!template) return c.json({ error: 'Template not found' }, 404);
  return c.json({ key, ...template, layer_info: TEMPLATE_LAYERS[template.layer] });
});

legal.post('/templates/:key/generate', async (c) => {
  await requireAuth(c);
  const key = c.req.param('key');
  const template = TEMPLATES[key];
  if (!template) return c.json({ error: 'Template not found' }, 404);

  const body = await c.req.json();
  let content = template.content;
  if (body.company_name) content = content.replace(/\{company_name\}/g, body.company_name);
  if (body.project_id) content = content.replace(/\{project_id\}/g, body.project_id);

  const sql = getSQL(c.env);
  const [doc] = await sql`INSERT INTO documents (project_id, title, doc_type, status, content, template_name) VALUES (${body.project_id || null}, ${template.title}, ${key}, 'generated', ${content}, ${key}) RETURNING *`;
  await sql.end();
  return c.json(doc, 201);
});

legal.get('/documents', async (c) => {
  await requireAuth(c);
  const projectId = c.req.query('project_id');
  const sql = getSQL(c.env);
  const docs = projectId
    ? await sql`SELECT * FROM documents WHERE project_id = ${parseInt(projectId)} ORDER BY created_at DESC`
    : await sql`SELECT * FROM documents ORDER BY created_at DESC`;
  await sql.end();
  return c.json(docs);
});

legal.get('/documents/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM documents WHERE id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Document not found' }, 404);
  return c.json(rows[0]);
});

legal.post('/documents', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const [doc] = await sql`INSERT INTO documents (project_id, title, doc_type, content, template_name) VALUES (${data.project_id || null}, ${data.title}, ${data.doc_type || 'other'}, ${data.content || null}, ${data.template_name || null}) RETURNING *`;
  await sql.end();
  return c.json(doc, 201);
});

legal.put('/documents/:id/sign', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const { signed_by } = await c.req.json();
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM documents WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Document not found' }, 404); }
  await sql`UPDATE documents SET status = 'signed', signed_by = ${signed_by || 'Unknown'}, signed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  const [updated] = await sql`SELECT * FROM documents WHERE id = ${id}`;
  await sql.end();
  return c.json(updated);
});

legal.get('/entities', async (c) => {
  await requireAuth(c);
  const sql = getSQL(c.env);
  const entities = await sql`SELECT * FROM entities ORDER BY created_at DESC`;
  await sql.end();
  return c.json(entities);
});

legal.post('/entities', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const [entity] = await sql`INSERT INTO entities (name, entity_type, parent_id, jurisdiction) VALUES (${data.name}, ${data.entity_type}, ${data.parent_id || null}, ${data.jurisdiction || null}) RETURNING *`;
  await sql.end();
  return c.json(entity, 201);
});

export default legal;
