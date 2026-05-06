import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireRole, requireApprovedKyc, canAccessFounderResource } from '../auth';
import { seedStandardEventsForJurisdiction } from './compliance';

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

// Task #30 — Jurisdiction wizard (worker parity).
// Read-only catalogue endpoint. Doc generation + entity creation stays
// on the FastAPI backend, which is the source of truth for both DBs.
const JURISDICTIONS = [
  { id: 'us_de_ccorp', label: 'Delaware C-Corp', country: 'United States', country_code: 'US', entity_type: 'C Corporation', summary: 'The default for VC-backed startups.', est_cost_usd: [500, 1500], time_to_form_days: [1, 7], fundraising_friendly: true, atlas_supported: true, pros: ['Stripe Atlas one-click', 'Universally accepted by US VCs'], cons: ['21% federal corporate tax', 'Annual filings + agent'], tax_summary: '21% federal corporate income tax. DE franchise tax $400–$1,750.', templates: ['certificate_of_incorporation_de', 'bylaws', 'stock_purchase_agreement', 'section_83b'] },
  { id: 'us_de_llc', label: 'Delaware LLC', country: 'United States', country_code: 'US', entity_type: 'Limited Liability Company', summary: 'Pass-through taxation. Hard to take VC.', est_cost_usd: [300, 800], time_to_form_days: [1, 5], fundraising_friendly: false, atlas_supported: false, pros: ['Pass-through tax', 'Flexible operating agreement'], cons: ['Most VCs cannot invest in LLCs', 'Self-employment tax'], tax_summary: 'Pass-through. DE franchise tax flat $300/yr.', templates: ['operating_agreement', 'ein_application_kit', 'member_consent'] },
  { id: 'uk_ltd', label: 'UK Private Limited (Ltd)', country: 'United Kingdom', country_code: 'GB', entity_type: 'Private Limited Company', summary: 'Fast and credible for European VCs.', est_cost_usd: [50, 250], time_to_form_days: [1, 3], fundraising_friendly: true, atlas_supported: false, pros: ['£50 same-day filing', 'SEIS/EIS angel tax relief'], cons: ['US VCs may want a flip', 'Public PSC register'], tax_summary: 'Corporation tax 25% (19% small-profits up to £50k).', templates: ['uk_memorandum_of_association', 'uk_articles_of_association', 'uk_form_in01_kit'] },
  { id: 'sg_pte', label: 'Singapore Pte Ltd', country: 'Singapore', country_code: 'SG', entity_type: 'Private Limited (Pte. Ltd.)', summary: 'Asia hub. Strong rule of law, English-language filings.', est_cost_usd: [600, 1500], time_to_form_days: [1, 5], fundraising_friendly: true, atlas_supported: false, pros: ['Startup tax exemption ~75% on first S$100k', '17% headline corporate tax'], cons: ['Need SG-resident director', 'Bank account 2–4 weeks'], tax_summary: '17% corporate tax; effective ~4–8% in years 1–3.', templates: ['sg_constitution', 'sg_acra_form_45_kit', 'sg_first_directors_resolution'] },
  { id: 'ee_oy', label: 'Estonia OÜ (e-Residency)', country: 'Estonia', country_code: 'EE', entity_type: 'Osaühing (Private Limited)', summary: 'Fully remote, 0% tax on retained earnings.', est_cost_usd: [200, 500], time_to_form_days: [3, 14], fundraising_friendly: false, atlas_supported: false, pros: ['0% tax on retained earnings', '100% online incorporation'], cons: ['20% distribution tax on dividends', 'Need e-Residency first (~6–8 weeks)'], tax_summary: '0% on retained earnings. 20% distribution tax on dividends.', templates: ['ee_articles_of_association', 'ee_e_residency_application_kit', 'ee_founding_resolution'] },
];

legal.get('/jurisdictions', async (c) => {
  await requireAuth(c);
  return c.json({ jurisdictions: JURISDICTIONS });
});

// Concise stub bodies for jurisdiction-specific docs. The richer drafts
// live in the FastAPI backend; this worker variant keeps prod parity so
// the wizard never silently fails for the user.
const JURISDICTION_TEMPLATES: Record<string, { title: string }> = {
  certificate_of_incorporation_de: { title: 'Certificate of Incorporation (Delaware C-Corp)' },
  bylaws: { title: 'Corporate Bylaws' },
  stock_purchase_agreement: { title: "Founders' Restricted Stock Purchase Agreement" },
  section_83b: { title: 'Section 83(b) Election' },
  operating_agreement: { title: 'Operating Agreement (LLC)' },
  ein_application_kit: { title: 'IRS EIN Application Kit (Form SS-4)' },
  member_consent: { title: 'Initial Member Written Consent' },
  uk_memorandum_of_association: { title: 'Memorandum of Association (UK Ltd)' },
  uk_articles_of_association: { title: 'Articles of Association (UK Ltd) — Model Articles' },
  uk_form_in01_kit: { title: 'UK IN01 Filing Kit (Companies House)' },
  sg_constitution: { title: 'Company Constitution (Singapore Pte Ltd)' },
  sg_acra_form_45_kit: { title: 'ACRA Filing Kit — BizFile Incorporation Pack' },
  sg_first_directors_resolution: { title: "First Directors' Resolution (Singapore)" },
  ee_articles_of_association: { title: 'Articles of Association (Estonia OÜ)' },
  ee_e_residency_application_kit: { title: 'Estonia e-Residency Application Kit' },
  ee_founding_resolution: { title: 'Founding Resolution (Estonia OÜ)' },
};

// Map our template keys → existing documenttype enum values (anything
// not in the enum is stored as 'other' with the real key in
// template_name, mirroring the FastAPI backend behaviour).
const _ALLOWED_DOC_TYPES = new Set([
  'safe', 'bylaws', 'equity_split', 'ip_license', 'pitch_deck', 'deal_memo',
  'diligence_report', 'financial_model', 'other', 'operating_agreement',
  'carried_interest', 'ic_charter', 'service_agreement', 'lpa', 'ppm',
  'subscription', 'mgmt_company', 'term_sheet', 'spa', 'voting_rights',
  'form_adv', 'aml_kyc', 'section_83b',
]);

legal.post('/incorporate/wizard', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json<{
    project_id: number;
    jurisdiction_id: string;
    company_name: string;
    registered_agent_name?: string;
    registered_agent_address?: string;
  }>();

  const j = JURISDICTIONS.find((x) => x.id === body.jurisdiction_id);
  if (!j) return c.json({ error: `Unknown jurisdiction: ${body.jurisdiction_id}` }, 400);
  if (!body.company_name?.trim()) return c.json({ error: 'company_name is required' }, 400);

  const sql = getSQL(c.env);
  const projRows = await sql`SELECT id, name, founder_id, entity_id FROM projects WHERE id = ${body.project_id}`;
  if (projRows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = projRows[0] as any;

  // Same access rule as backend: admin/partner OR the founder owning the
  // project. Investors are NOT permitted to mutate legal state on
  // projects they don't own.
  // Bypass `canAccessFounderResource` here — its phase 0.1 semantics still
  // treat investors as privileged for read-path back-compat, which would be a
  // cross-project IDOR on this write path. Require explicit founder ownership.
  if (user.role !== 'admin' && user.role !== 'partner') {
    const ownsProject =
      project.founder_id != null && (user as any).founder_id === project.founder_id;
    if (!ownsProject) {
      await sql.end();
      return c.json({ error: 'Forbidden: you do not own this project' }, 403);
    }
  }

  // Reuse existing entity if jurisdictions match (idempotency).
  let entityRow: any = null;
  if (project.entity_id) {
    const er = await sql`SELECT * FROM entities WHERE id = ${project.entity_id}`;
    if (er.length && (er[0] as any).jurisdiction?.toLowerCase() === j.label.toLowerCase()) {
      entityRow = er[0];
    }
  }
  const reusedEntity = !!entityRow;
  if (!entityRow) {
    const inserted = await sql`
      INSERT INTO entities (name, entity_type, jurisdiction, status, incorporation_date)
      VALUES (${body.company_name.trim()}, 'subsidiary', ${j.label}, 'forming', CURRENT_DATE)
      RETURNING *`;
    entityRow = inserted[0];
    await sql`UPDATE projects SET entity_id = ${entityRow.id}, updated_at = CURRENT_TIMESTAMP WHERE id = ${project.id}`;
  }

  const fill = {
    company_name: body.company_name.trim(),
    jurisdiction: j.label,
    incorporation_date: new Date().toISOString().slice(0, 10),
    registered_agent_name: body.registered_agent_name || '[Registered Agent]',
    registered_agent_address: body.registered_agent_address || '[Registered Agent Address]',
  };
  const fillContent = (s: string) =>
    s.replace(/\{(company_name|jurisdiction|incorporation_date|registered_agent_name|registered_agent_address)\}/g,
      (_m, k) => (fill as any)[k] ?? '');

  const generated: Array<{ id: number; title: string; doc_type: string; reused: boolean }> = [];
  for (const tkey of j.templates) {
    const meta = JURISDICTION_TEMPLATES[tkey] || (TEMPLATES as any)[tkey];
    if (!meta) continue;
    const existing = await sql`SELECT id, title FROM documents WHERE project_id = ${project.id} AND template_name = ${tkey} LIMIT 1`;
    if (existing.length) {
      generated.push({ id: (existing[0] as any).id, title: meta.title, doc_type: tkey, reused: true });
      continue;
    }
    const docType = _ALLOWED_DOC_TYPES.has(tkey) ? tkey : 'other';
    const baseContent = (TEMPLATES as any)[tkey]?.content || `${meta.title}\n\nCompany: ${fill.company_name}\nJurisdiction: ${fill.jurisdiction}\nDate: ${fill.incorporation_date}\n\n[Counsel-reviewed body managed in the FastAPI backend.]`;
    const content = fillContent(baseContent);
    const inserted = await sql`
      INSERT INTO documents (project_id, title, doc_type, status, content, template_name)
      VALUES (${project.id}, ${meta.title}, ${docType}, 'generated', ${content}, ${tkey})
      RETURNING id, title`;
    generated.push({ id: (inserted[0] as any).id, title: meta.title, doc_type: tkey, reused: false });
  }

  let handoff: any = { type: 'documents_only', next_steps: [] };
  if (j.atlas_supported) {
    const params = new URLSearchParams({ company: body.company_name.trim(), ref: `axal-studioos-p${project.id}` });
    handoff = {
      type: 'stripe_atlas',
      provider: 'Stripe Atlas',
      url: `https://atlas.stripe.com/start?${params.toString()}`,
      summary: 'Continue incorporation on Stripe Atlas — your company name is pre-filled.',
    };
  } else if (j.id === 'uk_ltd') {
    handoff.next_steps = [
      'File IN01 on Companies House (https://www.gov.uk/limited-company-formation)',
      'Register for Corporation Tax with HMRC within 3 months',
      'Open a UK business bank account',
    ];
  } else if (j.id === 'sg_pte') {
    handoff.next_steps = [
      'Submit incorporation via ACRA BizFile+ (https://www.bizfile.gov.sg)',
      'Engage a Singapore-resident director (or nominee director service)',
      'Appoint a company secretary within 6 months',
    ];
  } else if (j.id === 'ee_oy') {
    handoff.next_steps = [
      "Apply for e-Residency (https://e-resident.gov.ee) if you don't already have it",
      'Engage a Company Service Provider for the registered address',
      'File the OÜ via the Estonian Business Register e-portal',
    ];
  } else if (j.id === 'us_de_llc') {
    handoff.next_steps = [
      'File the Certificate of Formation with the Delaware Division of Corporations',
      'Apply for an EIN via IRS Form SS-4 (kit included)',
      'Open a US business bank account',
    ];
  }

  await sql.end();

  // T12 — Auto-seed the standard recurring compliance events for this
  // jurisdiction. Faithful port of the FastAPI flow in
  // `backend/app/api/routes/legal.py:1917` which calls
  // `seed_standard_events_for_jurisdiction`. Wrapped in try/catch because
  // a calendar problem must NEVER block the incorporation response.
  let seededCompliance: Array<{ id: number; event_type: string; title: string; due_date: string }> = [];
  try {
    seededCompliance = await seedStandardEventsForJurisdiction(c.env, {
      projectId: project.id,
      entityId: entityRow.id,
      jurisdictionId: j.id,
      jurisdictionLabel: j.label,
      userId: user.id,
      incorporationDate: entityRow.incorporation_date || null,
    });
  } catch (e) {
    console.warn('incorporate_wizard: compliance seed failed:', (e as Error)?.message);
  }

  return c.json({
    ok: true,
    jurisdiction: j,
    entity: {
      id: entityRow.id,
      name: entityRow.name,
      jurisdiction: entityRow.jurisdiction,
      status: entityRow.status,
      reused: reusedEntity,
    },
    documents: generated,
    seeded_compliance: seededCompliance,
    handoff,
  });
});

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
  const isPrivileged = user.role === 'admin' || user.role === 'partner' || user.role === 'investor';
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
  const isPrivileged = user.role === 'admin' || user.role === 'partner' || user.role === 'investor';
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
  // Binding signature → enforce KYC. Limited-access users (kyc !== 'approved')
  // are blocked; admins still pass through.
  const user = await requireApprovedKyc(c);
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
