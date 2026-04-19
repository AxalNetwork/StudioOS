import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireRole, canAccessFounderResource } from '../auth';

const legal = new Hono<{ Bindings: Env }>();

// Security #8 — storage cleanup:
// Centralised serializer for document rows. The contract body
// (`content`) is **never** returned in JSON, regardless of viewer role.
// This keeps the worker on the same policy as the FastAPI backend.
// When a signed-URL minting flow is added to the worker, this helper
// will be the single place to attach `content_url`.
function safeDoc<T extends Record<string, any>>(row: T): Omit<T, 'content' | 'project_founder_id'> & { content_url: null; redacted: true } {
  const { content: _content, project_founder_id: _pfid, ...rest } = row as any;
  return { ...rest, content_url: null, redacted: true };
}

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
  const user = await requireAuth(c);
  const key = c.req.param('key');
  const template = TEMPLATES[key];
  if (!template) return c.json({ error: 'Template not found' }, 404);

  const body = await c.req.json();
  const sql = getSQL(c.env);
  // IDOR guard: when generating against a project, founders may only do so for their own.
  // Founders may NOT generate unattached documents (no project_id).
  const isPrivileged = user.role === 'admin' || user.role === 'partner';
  if (body.project_id) {
    const p = await sql`SELECT founder_id FROM projects WHERE id = ${body.project_id}`;
    if (p.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
    if (!canAccessFounderResource(user, (p[0] as any).founder_id)) {
      await sql.end();
      return c.json({ error: 'Forbidden' }, 403);
    }
  } else if (!isPrivileged) {
    await sql.end();
    return c.json({ error: 'Forbidden' }, 403);
  }
  let content = template.content;
  if (body.company_name) content = content.replace(/\{company_name\}/g, body.company_name);
  if (body.project_id) content = content.replace(/\{project_id\}/g, body.project_id);

  const [doc] = await sql`INSERT INTO documents (project_id, title, doc_type, status, content, template_name) VALUES (${body.project_id || null}, ${template.title}, ${key}, 'generated', ${content}, ${key}) RETURNING *`;
  await sql.end();
  return c.json(safeDoc(doc), 201);
});

legal.get('/documents', async (c) => {
  const user = await requireAuth(c);
  const projectId = c.req.query('project_id');
  const sql = getSQL(c.env);
  const isPrivileged = user.role === 'admin' || user.role === 'partner';
  let docs: any;
  if (isPrivileged) {
    // Admins/partners see everything (optionally filtered by project_id).
    docs = projectId
      ? await sql`SELECT d.* FROM documents d WHERE d.project_id = ${parseInt(projectId)} ORDER BY d.created_at DESC`
      : await sql`SELECT d.* FROM documents d ORDER BY d.created_at DESC`;
  } else {
    // Founders only see documents tied to their own projects.
    if (!user.founder_id) { await sql.end(); return c.json([]); }
    if (projectId) {
      const p = await sql`SELECT founder_id FROM projects WHERE id = ${parseInt(projectId)}`;
      if (p.length === 0 || (p[0] as any).founder_id !== user.founder_id) {
        await sql.end();
        return c.json([]);
      }
      docs = await sql`SELECT d.* FROM documents d WHERE d.project_id = ${parseInt(projectId)} ORDER BY d.created_at DESC`;
    } else {
      docs = await sql`SELECT d.* FROM documents d JOIN projects p ON d.project_id = p.id WHERE p.founder_id = ${user.founder_id} ORDER BY d.created_at DESC`;
    }
  }
  await sql.end();
  return c.json((docs as any[]).map(safeDoc));
});

legal.get('/documents/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.*, p.founder_id as project_founder_id FROM documents d LEFT JOIN projects p ON d.project_id = p.id WHERE d.id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Document not found' }, 404);
  // IDOR guard: founders may only read documents tied to their own project.
  if (!canAccessFounderResource(user, (rows[0] as any).project_founder_id)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return c.json(safeDoc(rows[0] as any));
});

legal.post('/documents', async (c) => {
  const user = await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  // IDOR guard: founders can only create documents under their own project.
  if (data.project_id) {
    const p = await sql`SELECT founder_id FROM projects WHERE id = ${data.project_id}`;
    if (p.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
    if (!canAccessFounderResource(user, (p[0] as any).founder_id)) {
      await sql.end();
      return c.json({ error: 'Forbidden' }, 403);
    }
  } else if (user.role === 'founder') {
    // Founders may not create unattached documents.
    await sql.end();
    return c.json({ error: 'Forbidden' }, 403);
  }
  const [doc] = await sql`INSERT INTO documents (project_id, title, doc_type, content, template_name) VALUES (${data.project_id || null}, ${data.title}, ${data.doc_type || 'other'}, ${data.content || null}, ${data.template_name || null}) RETURNING *`;
  await sql.end();
  return c.json(safeDoc(doc), 201);
});

legal.put('/documents/:id/sign', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const { signed_by } = await c.req.json();
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.*, p.founder_id as project_founder_id FROM documents d LEFT JOIN projects p ON d.project_id = p.id WHERE d.id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Document not found' }, 404); }
  // IDOR guard: founders may only sign documents on their own project.
  if (!canAccessFounderResource(user, (rows[0] as any).project_founder_id)) {
    await sql.end();
    return c.json({ error: 'Forbidden' }, 403);
  }
  await sql`UPDATE documents SET status = 'signed', signed_by = ${signed_by || 'Unknown'}, signed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  const [updated] = await sql`SELECT * FROM documents WHERE id = ${id}`;
  await sql.end();
  return c.json(safeDoc(updated));
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
