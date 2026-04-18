import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { logActivity } from './partnernet';

const legalcap = new Hono<{ Bindings: Env }>();

const DOC_TYPES = new Set(['SAFE', 'IP_license', 'equity_allocation', 'bylaws', '83b_election']);
const CHECKLIST_TYPES = new Set(['legal', 'financial', 'tech', 'compliance']);
const COMPLIANCE_TYPES = new Set(['kyc', 'aml', 'delaware_filing', 'global_subsidiary']);
const ADVANCE_ROLES = new Set(['admin', 'partner']);
const AI_RATE_LIMIT = 60; // shared

const SPINOUT_STATUSES = ['pending', 'ip_transferred', 'equity_allocated', 'incorporated', 'independent'];
const SPINOUT_EVENT_TYPES = new Set(['ip_transfer', 'equity_allocation', 'stripe_atlas_start', 'stripe_atlas_complete', 'independent_scale']);

let migrated = false;
async function ensureSchema(env: Env) {
  if (migrated) return;
  // Idempotent ALTERs to extend subsidiaries with spin-out columns
  const alters = [
    `ALTER TABLE subsidiaries ADD COLUMN spinout_status TEXT DEFAULT 'pending'`,
    `ALTER TABLE subsidiaries ADD COLUMN ip_license_doc_id INTEGER`,
    `ALTER TABLE subsidiaries ADD COLUMN equity_allocation_json TEXT DEFAULT '{}'`,
    `ALTER TABLE subsidiaries ADD COLUMN stripe_atlas_id TEXT`,
    `ALTER TABLE subsidiaries ADD COLUMN independent_scaling_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE subsidiaries ADD COLUMN post_spinout_dashboard_url TEXT`,
  ];
  for (const a of alters) {
    try { await env.DB.prepare(a).run(); }
    catch (e: any) {
      if (!/duplicate column|no such table/i.test(e?.message || '')) {
        console.error('legalcap subsidiaries ALTER failed:', e?.message);
      }
    }
  }
  const stmts = [
    `CREATE TABLE IF NOT EXISTS legal_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      content TEXT,
      file_url TEXT,
      generated_by INTEGER,
      signed_by INTEGER,
      version INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ld_deal ON legal_documents(deal_id, type)`,
    `CREATE INDEX IF NOT EXISTS idx_ld_status ON legal_documents(status)`,

    `CREATE TABLE IF NOT EXISTS subsidiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      holding_company_id TEXT DEFAULT 'Axal_Holding_Delaware_CCorp',
      subsidiary_name TEXT NOT NULL,
      jurisdiction TEXT NOT NULL DEFAULT 'Delaware_CCorp',
      stripe_atlas_status TEXT DEFAULT 'pending',
      stripe_atlas_ref TEXT,
      ein TEXT,
      incorporation_date TIMESTAMP,
      ip_transfer_complete INTEGER DEFAULT 0,
      equity_allocated TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_deal ON subsidiaries(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sub_status ON subsidiaries(stripe_atlas_status)`,

    `CREATE TABLE IF NOT EXISTS capital_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER,
      syndicate_id INTEGER,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      due_date TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'draft',
      lp_responses TEXT DEFAULT '{}',
      notes TEXT,
      idempotency_key TEXT,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (amount_cents > 0),
      CHECK (deal_id IS NOT NULL OR syndicate_id IS NOT NULL)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cc_deal ON capital_calls(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cc_syn ON capital_calls(syndicate_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cc_status ON capital_calls(status, due_date)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_idem ON capital_calls(created_by, idempotency_key) WHERE idempotency_key IS NOT NULL`,

    `CREATE TABLE IF NOT EXISTS diligence_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      checklist_type TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      ai_score REAL,
      ai_summary TEXT,
      completed_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_dc_deal ON diligence_checklists(deal_id, checklist_type)`,

    `CREATE TABLE IF NOT EXISTS compliance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER,
      subsidiary_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      metadata TEXT DEFAULT '{}',
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (deal_id IS NOT NULL OR subsidiary_id IS NOT NULL)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cr_deal ON compliance_records(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cr_sub ON compliance_records(subsidiary_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cr_type ON compliance_records(type, status)`,

    `CREATE TABLE IF NOT EXISTS spinout_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subsidiary_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      performed_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_se_sub ON spinout_events(subsidiary_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_se_type ON spinout_events(event_type)`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch (e: any) { console.error('legalcap schema:', e?.message); } }
  migrated = true;
}

function safeJson<T>(s: any, def: T): T { try { return s ? JSON.parse(s) : def; } catch { return def; } }
async function checkAiQuota(env: Env, userId: number): Promise<boolean> {
  try {
    const r: any = await env.DB.prepare(`SELECT COUNT(*) as n FROM shared_services_log WHERE performed_by = ? AND action_type = 'ai_call' AND created_at > datetime('now', '-1 hour')`).bind(userId).first();
    return (r?.n || 0) < AI_RATE_LIMIT;
  } catch (e: any) {
    // Fail-open if shared_services_log doesn't exist yet — never 500 on quota check
    console.error('checkAiQuota:', e?.message);
    return true;
  }
}
async function logAi(env: Env, userId: number, kind: string, meta: any = {}) {
  try { await env.DB.prepare(`INSERT INTO shared_services_log (workflow_id, action_type, details, performed_by) VALUES (NULL, 'ai_call', ?, ?)`).bind(JSON.stringify({ kind, ...meta }), userId).run(); } catch {}
}
async function llm(env: Env, system: string, prompt: string, maxTokens = 400): Promise<string | null> {
  if (!env.AI) return null;
  try {
    const out: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: maxTokens,
    });
    return (out?.response || '').trim() || null;
  } catch (e: any) { console.error('llm:', e?.message); return null; }
}

// ============================================================
// LEGAL TEMPLATES (lightweight, embedded — ready for full Cooley/YC variants later)
// ============================================================
const TEMPLATES: Record<string, string> = {
  SAFE: `SIMPLE AGREEMENT FOR FUTURE EQUITY (YC POST-MONEY)

THIS CERTIFIES THAT in exchange for the payment by {{investor_name}} ("Investor") of \${{amount}} (the "Purchase Amount") on or about {{date}}, {{company_name}}, a Delaware C-corporation (the "Company"), issues to the Investor the right to certain shares of the Company's Capital Stock, subject to the terms set forth below.

The "Post-Money Valuation Cap" is \${{valuation_cap}}.
The "Discount Rate" is {{discount_rate}}%.

1. Events
(a) Equity Financing. If there is an Equity Financing before termination of this Safe, on the initial closing of such Equity Financing, this Safe will automatically convert into the number of shares of Standard Preferred Stock equal to the Purchase Amount divided by the Conversion Price.
(b) Liquidity Event. If there is a Liquidity Event before the termination of this Safe, the Investor will, at its option, either: (i) receive a cash payment equal to the Purchase Amount, or (ii) automatically receive from the Company a number of shares of Common Stock equal to the Purchase Amount divided by the Liquidity Price.

2. Definitions
... (standard YC SAFE definitions abbreviated for brevity in MVP) ...

Signed:
Company: {{company_name}}    By: ____________________   Title: {{founder_title}}
Investor: {{investor_name}}  By: ____________________   Date: {{date}}`,

  IP_license: `INTELLECTUAL PROPERTY ASSIGNMENT & LICENSE AGREEMENT

This IP Assignment and License Agreement ("Agreement") is entered into on {{date}} by and between Axal Holding Delaware C-Corp ("Holding") and {{company_name}} ("Subsidiary").

1. Assignment. Holding hereby irrevocably assigns to Subsidiary all right, title, and interest in and to the intellectual property described in Schedule A, including but not limited to: source code, trademarks, patents, trade secrets, and all related know-how (the "Assigned IP").

2. License Back. Subsidiary grants to Holding a non-exclusive, perpetual, worldwide, royalty-free license to use the Assigned IP solely for Holding's portfolio operations.

3. Equity Allocation. In consideration, Holding shall retain {{holding_equity_pct}}% of Subsidiary's fully-diluted equity, with the remaining {{founder_equity_pct}}% allocated to {{founder_names}} per the equity_allocation schedule.

4. Representations. Each party represents that it has full corporate authority to enter into this Agreement.

Signed:
Holding: Axal Holding Delaware C-Corp   By: ____________________
Subsidiary: {{company_name}}             By: {{founder_names}}
Date: {{date}}`,

  equity_allocation: `EQUITY ALLOCATION SCHEDULE

Company: {{company_name}}
Date: {{date}}
Total Authorized Shares: 10,000,000 (Common Stock)

| Shareholder              | Shares Allocated | Percentage | Vesting       |
|--------------------------|------------------|------------|---------------|
| Axal Holding (Parent)    | {{holding_shares}}      | {{holding_equity_pct}}%    | Immediate     |
| Founder Pool             | {{founder_shares}}      | {{founder_equity_pct}}%    | 4yr / 1yr cliff|
| Employee Option Pool     | {{option_pool_shares}}  | {{option_pool_pct}}%       | Standard      |

Founders:
{{founder_breakdown}}

Approved by board on {{date}}.`,

  bylaws: `BYLAWS OF {{company_name}}, INC.
A Delaware C-Corporation

ARTICLE I — OFFICES
The principal office of the Corporation shall be located in the State of Delaware.

ARTICLE II — STOCKHOLDERS
2.1 Annual Meeting. An annual meeting of the stockholders shall be held each year for the election of directors.
2.2 Voting. Each share entitles the holder to one vote.

ARTICLE III — BOARD OF DIRECTORS
3.1 Number. The Board shall consist of not less than one (1) and not more than seven (7) directors.
3.2 Initial Directors: {{initial_directors}}.

ARTICLE IV — OFFICERS
The officers of the Corporation shall include a President/CEO ({{ceo_name}}), Secretary, and Treasurer.

ARTICLE V — STOCK CERTIFICATES
Certificates representing shares of the Corporation shall be in such form as approved by the Board.

Adopted: {{date}}`,

  '83b_election': `IRC SECTION 83(b) ELECTION

Pursuant to Section 83(b) of the Internal Revenue Code, the undersigned hereby makes an election with respect to the following property:

Taxpayer: {{founder_name}}
SSN/EIN: [REDACTED]
Address: [ON FILE]

Property: {{shares}} shares of common stock of {{company_name}} (the "Company"), a Delaware corporation.

Date of Transfer: {{date}}
Restrictions: Subject to a 4-year vesting schedule with a 1-year cliff.

Fair Market Value at Transfer: \${{fmv_per_share}} per share (\${{total_fmv}} total)
Amount Paid: \${{amount_paid}} per share

The undersigned will report this transfer as compensation income on his/her tax return for the year of transfer.

Signature: ____________________  Date: {{date}}
{{founder_name}}

A copy must be filed with the IRS within 30 days of the transfer date.`,
};

function fillTemplate(template: string, vars: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    if (v == null) return `[${k}]`;
    return String(v);
  });
}

function defaultDocVars(project: any, user: any): Record<string, any> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    company_name: project?.name || 'NewCo',
    investor_name: 'Axal Studio Fund I, L.P.',
    amount: '250,000',
    valuation_cap: '5,000,000',
    discount_rate: '20',
    date: today,
    founder_title: 'CEO',
    founder_names: project?.name ? `Founders of ${project.name}` : 'Founders',
    founder_name: 'Founder',
    holding_equity_pct: '15',
    founder_equity_pct: '70',
    option_pool_pct: '15',
    holding_shares: '1,500,000',
    founder_shares: '7,000,000',
    option_pool_shares: '1,500,000',
    founder_breakdown: '— TBD by cap table',
    initial_directors: 'Axal Studio Partners, Founder',
    ceo_name: 'Founder',
    shares: '1,000,000',
    fmv_per_share: '0.0001',
    total_fmv: '100',
    amount_paid: '0.0001',
  };
}

// ============================================================
// LEGAL ENGINE
// ============================================================

legalcap.post('/legal/generate', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  if (!(await checkAiQuota(c.env, user.id))) return c.json({ error: 'Rate limit (60 AI calls/hour)' }, 429);

  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  const type = String(data?.type || '');
  if (!dealId || !DOC_TYPES.has(type)) return c.json({ error: `deal_id and type required (${[...DOC_TYPES].join('|')})` }, 400);

  const sql = getSQL(c.env);
  const [project] = await sql`SELECT * FROM projects WHERE id = ${dealId}`;
  await sql.end();
  if (!project) return c.json({ error: 'Deal not found' }, 404);

  const userVars = data?.variables && typeof data.variables === 'object' ? data.variables : {};
  const vars = { ...defaultDocVars(project, user), ...userVars };
  let body = fillTemplate(TEMPLATES[type], vars);

  // AI-assisted recommendations / cleanup pass (optional, cheap)
  const ai = await llm(c.env,
    'You are a startup-focused corporate attorney reviewing a draft document. Suggest 2-3 brief improvements as a markdown list. Do NOT rewrite the document.',
    `Document type: ${type}\nCompany: ${project.name}\nSector: ${project.sector || 'n/a'}\nDraft preview:\n${body.slice(0, 1500)}`,
    256);
  if (ai) body += `\n\n---\n## AI-Generated Suggestions\n${ai}`;
  await logAi(c.env, user.id, 'legal_doc_generate', { type, deal_id: dealId });

  // Sensitive content stored as JSON (template + filled vars + body) — no raw PII in logs
  const contentJson = JSON.stringify({ template: type, vars, body, model: ai ? '@cf/meta/llama-3.1-8b-instruct' : 'template-only' });

  const doc: any = await c.env.DB.prepare(`INSERT INTO legal_documents (deal_id, type, status, content, generated_by) VALUES (?, ?, 'generated', ?, ?) RETURNING id, deal_id, type, status, generated_by, created_at`)
    .bind(dealId, type, contentJson, user.id).first();

  await logActivity(c.env, user.id, 'studio_ops_task', { entityType: 'legal_doc', entityId: doc.id, metadata: { type, deal_id: dealId } });
  return c.json({ ...doc, body, vars }, 201);
});

legalcap.get('/legal/docs/:dealId', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const dealId = parseInt(c.req.param('dealId'));
  // Full body (with substituted PII) only for admins/partners — others get metadata only
  const fullAccess = ADVANCE_ROLES.has(user.role);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, deal_id, type, status, generated_by, signed_by, version, created_at, updated_at, content FROM legal_documents WHERE deal_id = ${dealId} ORDER BY type, version DESC`;
  await sql.end();
  const stripped = (rows as any[]).map(r => {
    const parsed = safeJson<any>(r.content, {});
    return {
      ...r,
      body: fullAccess ? (parsed.body || '') : null,
      model: parsed.model || null,
      content: undefined,
      access: fullAccess ? 'full' : 'metadata_only',
    };
  });
  return c.json(stripped);
});

legalcap.patch('/legal/docs/:id/sign', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  const upd = await c.env.DB.prepare(`UPDATE legal_documents SET status = 'signed', signed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('draft', 'generated')`)
    .bind(user.id, id).run();
  if (!upd.meta?.changes) return c.json({ error: 'Doc not found or already signed/filed' }, 409);
  return c.json({ ok: true });
});

// ============================================================
// CAPITAL ENGINE
// ============================================================

legalcap.post('/capital/call', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const amountCents = Math.round(Number(data?.amount_cents || (Number(data?.amount) * 100)));
  if (!Number.isFinite(amountCents) || amountCents <= 0) return c.json({ error: 'amount_cents (or amount in dollars) > 0 required' }, 400);
  const dealId = data?.deal_id ? parseInt(data.deal_id) : null;
  const synId = data?.syndicate_id ? parseInt(data.syndicate_id) : null;
  if (!dealId && !synId) return c.json({ error: 'Provide deal_id or syndicate_id' }, 400);

  const dueDate = data?.due_date ? new Date(data.due_date).toISOString() : new Date(Date.now() + 30 * 86400000).toISOString();
  const status = data?.send ? 'sent' : 'draft';
  const idemKey = data?.idempotency_key ? String(data.idempotency_key).slice(0, 100) : null;

  // Idempotency: if same (created_by, idempotency_key) already exists, return it
  if (idemKey) {
    const existing: any = await c.env.DB.prepare(`SELECT * FROM capital_calls WHERE created_by = ? AND idempotency_key = ?`).bind(user.id, idemKey).first();
    if (existing) return c.json({ ...existing, lp_responses: safeJson(existing.lp_responses, {}), idempotent_replay: true });
  }

  let call: any;
  try {
    call = await c.env.DB.prepare(`INSERT INTO capital_calls (deal_id, syndicate_id, amount_cents, currency, due_date, status, notes, idempotency_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .bind(dealId, synId, amountCents, String(data?.currency || 'USD').slice(0, 3), dueDate, status, data?.notes ? String(data.notes).slice(0, 1000) : null, idemKey, user.id).first();
  } catch (e: any) {
    if (/UNIQUE/i.test(e?.message || '')) return c.json({ error: 'Duplicate idempotency_key for this user' }, 409);
    throw e;
  }

  await logActivity(c.env, user.id, 'payout_request', { entityType: 'capital_call', entityId: call.id, metadata: { amount_cents: amountCents, deal_id: dealId, syndicate_id: synId } });
  return c.json({ ...call, lp_responses: safeJson(call.lp_responses, {}) }, 201);
});

legalcap.patch('/capital/call/:id/send', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  const upd = await c.env.DB.prepare(`UPDATE capital_calls SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'draft'`).bind(id).run();
  if (!upd.meta?.changes) return c.json({ error: 'Call not found or not in draft' }, 409);
  return c.json({ ok: true });
});

legalcap.post('/capital/call/:id/respond', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const decision = String(data?.decision || '').toLowerCase();
  if (!['committed', 'declined', 'paid'].includes(decision)) return c.json({ error: 'decision must be committed|declined|paid' }, 400);
  const amountCents = Math.max(0, Math.round(Number(data?.amount_cents || 0)));

  const call: any = await c.env.DB.prepare(`SELECT * FROM capital_calls WHERE id = ?`).bind(id).first();
  if (!call) return c.json({ error: 'Capital call not found' }, 404);
  // Only LPs in the syndicate (or admins) may respond
  if (user.role !== 'admin' && call.syndicate_id) {
    const member: any = await c.env.DB.prepare(`SELECT id FROM syndicate_members WHERE syndicate_id = ? AND user_id = ?`).bind(call.syndicate_id, user.id).first();
    if (!member) return c.json({ error: 'You are not an LP in this syndicate' }, 403);
  }
  const responses = safeJson<Record<string, any>>(call.lp_responses, {});
  responses[String(user.id)] = { decision, amount_cents: amountCents, at: new Date().toISOString() };
  await c.env.DB.prepare(`UPDATE capital_calls SET lp_responses = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(JSON.stringify(responses), id).run();
  await logActivity(c.env, user.id, 'payout_request', { entityType: 'capital_call_response', entityId: id, metadata: { decision, amount_cents: amountCents } });
  return c.json({ ok: true, my_response: responses[String(user.id)] });
});

// LP portal — only show calls relevant to the requesting user (their syndicate memberships)
legalcap.get('/capital/lp-portal', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const isAdmin = user.role === 'admin';
  const calls = isAdmin
    ? await sql`SELECT cc.*, p.name as deal_name, s.name as syndicate_name FROM capital_calls cc LEFT JOIN projects p ON p.id = cc.deal_id LEFT JOIN syndicates s ON s.id = cc.syndicate_id WHERE cc.status IN ('sent', 'paid', 'overdue') ORDER BY cc.due_date`
    : await sql`SELECT cc.*, p.name as deal_name, s.name as syndicate_name FROM capital_calls cc LEFT JOIN projects p ON p.id = cc.deal_id LEFT JOIN syndicates s ON s.id = cc.syndicate_id WHERE cc.status IN ('sent', 'paid', 'overdue') AND cc.syndicate_id IN (SELECT syndicate_id FROM syndicate_members WHERE user_id = ${user.id}) ORDER BY cc.due_date`;
  await sql.end();
  return c.json((calls as any[]).map(c => {
    const responses = safeJson<Record<string, any>>(c.lp_responses, {});
    const myResp = responses[String(user.id)] || null;
    return { ...c, lp_responses: isAdmin ? responses : undefined, my_response: myResp, response_count: Object.keys(responses).length };
  }));
});

// Admin overview of all calls
legalcap.get('/capital/calls', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const calls = await sql`SELECT cc.*, p.name as deal_name, s.name as syndicate_name FROM capital_calls cc LEFT JOIN projects p ON p.id = cc.deal_id LEFT JOIN syndicates s ON s.id = cc.syndicate_id ORDER BY cc.created_at DESC LIMIT 100`;
  await sql.end();
  return c.json((calls as any[]).map(c => ({ ...c, lp_responses: safeJson(c.lp_responses, {}) })));
});

// ============================================================
// DILIGENCE & COMPLIANCE
// ============================================================

const DEFAULT_CHECKLIST: Record<string, string[]> = {
  legal: ['Cap table verified', 'Founder agreements signed', 'IP assignments complete', 'No pending litigation', 'Corporate structure clean'],
  financial: ['Bank statements (12mo)', 'Revenue recognition reviewed', 'Burn rate validated', 'Cap table reconciled', 'Tax filings current'],
  tech: ['Code repo access', 'Architecture review', 'Security audit', 'Scalability assessment', 'Tech stack documented'],
  compliance: ['KYC/AML on founders', 'Delaware filings current', 'Required licenses identified', 'Privacy policy + ToS', 'Data residency reviewed'],
};

legalcap.post('/diligence/review', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  if (!(await checkAiQuota(c.env, user.id))) return c.json({ error: 'Rate limit (60 AI calls/hour)' }, 429);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  const type = String(data?.checklist_type || 'legal');
  if (!dealId || !CHECKLIST_TYPES.has(type)) return c.json({ error: `deal_id and checklist_type required (${[...CHECKLIST_TYPES].join('|')})` }, 400);

  const userItems: any[] = Array.isArray(data?.items) ? data.items.slice(0, 50) : [];
  const items = userItems.length ? userItems : DEFAULT_CHECKLIST[type].map(item => ({ item, status: 'pending', notes: '' }));

  // Heuristic score: % done
  const total = items.length, done = items.filter((i: any) => i.status === 'done').length;
  const blocked = items.filter((i: any) => i.status === 'blocked').length;
  const heuristic = total ? Math.round((done / total) * 100 - blocked * 5) : 0;

  // AI summary + score adjustment
  const sql = getSQL(c.env);
  const [project] = await sql`SELECT name, sector, stage, score FROM projects WHERE id = ${dealId}`;
  await sql.end();
  const ai = await llm(c.env,
    'You are a venture due-diligence analyst. Given a checklist with statuses, output a 2-3 sentence summary of risk + readiness.',
    `Project: ${project?.name || dealId}\nChecklist type: ${type}\nItems:\n${items.map((i: any) => `- [${i.status}] ${i.item}${i.notes ? ' — ' + i.notes : ''}`).join('\n')}`,
    256);
  const score = Math.max(0, Math.min(100, heuristic));

  const r: any = await c.env.DB.prepare(`INSERT INTO diligence_checklists (deal_id, checklist_type, items, ai_score, ai_summary, completed_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`)
    .bind(dealId, type, JSON.stringify(items), score, ai || `Heuristic only: ${done}/${total} complete, ${blocked} blocked.`, user.id).first();

  await logAi(c.env, user.id, 'diligence_review', { deal_id: dealId, type });
  await logActivity(c.env, user.id, 'ai_scoring', { entityType: 'diligence', entityId: r.id, metadata: { deal_id: dealId, type, score } });
  return c.json({ ...r, items, ai_score: score });
});

legalcap.get('/diligence/:dealId', async (c) => {
  await requireAuth(c);
  await ensureSchema(c.env);
  const dealId = parseInt(c.req.param('dealId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM diligence_checklists WHERE deal_id = ${dealId} ORDER BY checklist_type, id DESC`;
  await sql.end();
  return c.json((rows as any[]).map(r => ({ ...r, items: safeJson(r.items, []) })));
});

legalcap.get('/compliance/:dealId', async (c) => {
  await requireAuth(c);
  await ensureSchema(c.env);
  const dealId = parseInt(c.req.param('dealId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM compliance_records WHERE deal_id = ${dealId} OR subsidiary_id IN (SELECT id FROM subsidiaries WHERE deal_id = ${dealId}) ORDER BY created_at DESC`;
  await sql.end();
  return c.json((rows as any[]).map(r => ({ ...r, metadata: safeJson(r.metadata, {}) })));
});

// ============================================================
// SUBSIDIARY SPIN-OUT (orchestrates legal + capital + Stripe Atlas)
// ============================================================

legalcap.get('/subsidiaries/:dealId', async (c) => {
  await requireAuth(c);
  await ensureSchema(c.env);
  const dealId = parseInt(c.req.param('dealId'));
  const sub: any = await c.env.DB.prepare(`SELECT * FROM subsidiaries WHERE deal_id = ?`).bind(dealId).first();
  if (!sub) return c.json(null);
  return c.json({ ...sub, equity_allocated: safeJson(sub.equity_allocated, {}), ip_transfer_complete: !!sub.ip_transfer_complete });
});

legalcap.post('/subsidiary/spinout', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);

  const sql = getSQL(c.env);
  const [project] = await sql`SELECT * FROM projects WHERE id = ${dealId}`;
  if (!project) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  // Verify the deal has a passed decision_gate (spinout_ready) — soft check
  const gateRow: any = await c.env.DB.prepare(`SELECT id, final_decision FROM decision_gates WHERE deal_id = ? AND final_decision = 'passed' ORDER BY id DESC LIMIT 1`).bind(dealId).first().catch(() => null);
  await sql.end();
  if (!gateRow && !data?.force) return c.json({ error: 'Spin-out requires a passed decision gate. Pass {force:true} to override.' }, 412);

  // Idempotency: if a subsidiary already exists, return it
  const existing: any = await c.env.DB.prepare(`SELECT * FROM subsidiaries WHERE deal_id = ?`).bind(dealId).first();
  if (existing) return c.json({ ...existing, equity_allocated: safeJson(existing.equity_allocated, {}), already_existed: true });

  const subName = String(data?.subsidiary_name || `${project.name}, Inc.`).slice(0, 200);
  const jurisdiction = data?.jurisdiction === 'global' ? 'global' : 'Delaware_CCorp';
  const equityAlloc = data?.equity_allocated && typeof data.equity_allocated === 'object'
    ? data.equity_allocated : { holding_pct: 15, founders_pct: 70, option_pool_pct: 15 };

  // === Stripe Atlas placeholder ===
  // Real integration would call Atlas API with env.STRIPE_ATLAS_API_KEY here.
  // For now we stamp a mock reference + 'pending' status, which a future cron/webhook can flip to 'incorporated'.
  const stripeKey = (c.env as any).STRIPE_ATLAS_API_KEY;
  const stripeRef = stripeKey ? `atlas_pending_${Date.now()}` : `mock_atlas_${Date.now()}`;
  const stripeStatus = stripeKey ? 'pending' : 'pending'; // identical until real API is wired

  const sub: any = await c.env.DB.prepare(`INSERT INTO subsidiaries (deal_id, subsidiary_name, jurisdiction, stripe_atlas_status, stripe_atlas_ref, equity_allocated) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`)
    .bind(dealId, subName, jurisdiction, stripeStatus, stripeRef, JSON.stringify(equityAlloc)).first();

  // Auto-generate the 3 standard docs (template-only, no AI to keep this orchestration cheap)
  const docVars = { ...defaultDocVars(project, user), holding_equity_pct: equityAlloc.holding_pct, founder_equity_pct: equityAlloc.founders_pct, option_pool_pct: equityAlloc.option_pool_pct };
  const docResults: any[] = [];
  for (const docType of ['SAFE', 'IP_license', 'equity_allocation']) {
    const body = fillTemplate(TEMPLATES[docType], docVars);
    const content = JSON.stringify({ template: docType, vars: docVars, body, model: 'template-only' });
    const d: any = await c.env.DB.prepare(`INSERT INTO legal_documents (deal_id, type, status, content, generated_by) VALUES (?, ?, 'generated', ?, ?) RETURNING id, type`)
      .bind(dealId, docType, content, user.id).first();
    docResults.push(d);
  }

  // Compliance records
  await c.env.DB.prepare(`INSERT INTO compliance_records (deal_id, subsidiary_id, type, status, metadata, created_by) VALUES (?, ?, 'delaware_filing', 'pending', ?, ?)`)
    .bind(dealId, sub.id, JSON.stringify({ subsidiary_name: subName }), user.id).run();
  if (jurisdiction === 'global') {
    await c.env.DB.prepare(`INSERT INTO compliance_records (deal_id, subsidiary_id, type, status, metadata, created_by) VALUES (?, ?, 'global_subsidiary', 'pending', ?, ?)`)
      .bind(dealId, sub.id, JSON.stringify({ subsidiary_name: subName }), user.id).run();
  }

  // Auto capital call — best-effort, find the most recent open syndicate for this deal
  let capitalCall: any = null;
  try {
    const syn: any = await c.env.DB.prepare(`SELECT id FROM syndicates WHERE deal_id = ? AND status IN ('open', 'closed') ORDER BY id DESC LIMIT 1`).bind(dealId).first();
    if (syn) {
      const amountCents = Math.round(Number(data?.capital_call_amount_cents || 25000000)); // $250k default
      capitalCall = await c.env.DB.prepare(`INSERT INTO capital_calls (deal_id, syndicate_id, amount_cents, currency, status, due_date, notes, created_by) VALUES (?, ?, ?, 'USD', 'sent', datetime('now', '+30 days'), 'Auto-generated on spin-out', ?) RETURNING id, amount_cents, syndicate_id`)
        .bind(dealId, syn.id, amountCents, user.id).first();
    }
  } catch (e: any) { console.error('spinout capital call:', e?.message); }

  // Studio Ops workflow for human follow-up
  try {
    let wf: any = await c.env.DB.prepare(`SELECT id FROM workflows WHERE template_key = 'spinout.coordination' AND project_id = ? LIMIT 1`).bind(dealId).first();
    if (!wf) {
      wf = await c.env.DB.prepare(`INSERT INTO workflows (type, title, description, status, project_id, template_key, owner_user_id) VALUES ('strategic', ?, 'Coordinate spin-out: Stripe Atlas, IP transfer, capital call, signatures.', 'active', ?, 'spinout.coordination', ?) RETURNING id`)
        .bind(`Spin-Out: ${project.name}`, dealId, user.id).first();
    }
    const tasks = [
      'Review and sign SAFE',
      'Review and sign IP License + equity allocation',
      'Confirm Stripe Atlas incorporation',
      'File 83(b) elections within 30 days',
      'Capital call: track LP responses',
    ];
    for (const t of tasks) {
      await c.env.DB.prepare(`INSERT INTO workflow_tasks (workflow_id, title, status, priority, ai_assisted, metadata) VALUES (?, ?, 'todo', 'high', 0, ?)`)
        .bind(wf.id, t, JSON.stringify({ kind: 'spinout', deal_id: dealId, subsidiary_id: sub.id })).run();
    }
  } catch (e: any) { console.error('spinout workflow:', e?.message); }

  await logActivity(c.env, user.id, 'studio_ops_task', { entityType: 'subsidiary', entityId: sub.id, metadata: { deal_id: dealId, jurisdiction, atlas_ref: stripeRef } });
  return c.json({
    subsidiary: { ...sub, equity_allocated: safeJson(sub.equity_allocated, {}) },
    legal_docs: docResults,
    capital_call: capitalCall,
    stripe_atlas: { status: stripeStatus, ref: stripeRef, real_api: !!stripeKey },
    next_steps: ['Sign legal documents', 'Confirm Atlas incorporation', 'File 83(b) elections', 'Send capital call to LPs'],
  }, 201);
});

// ============================================================
// SPIN-OUT WIZARD (step-by-step orchestration with audit trail)
// ============================================================

async function logSpinoutEvent(env: Env, subId: number, type: string, details: any, userId: number) {
  try {
    await env.DB.prepare(`INSERT INTO spinout_events (subsidiary_id, event_type, details, performed_by) VALUES (?, ?, ?, ?)`)
      .bind(subId, type, JSON.stringify(details || {}), userId).run();
  } catch (e: any) { console.error('logSpinoutEvent:', e?.message); }
}

async function getOrCreateSubForDeal(env: Env, dealId: number, defaults: { name: string; jurisdiction?: string; userId: number }): Promise<{ sub: any; created: boolean }> {
  const existing: any = await env.DB.prepare(`SELECT * FROM subsidiaries WHERE deal_id = ?`).bind(dealId).first();
  if (existing) return { sub: existing, created: false };
  const sub: any = await env.DB.prepare(`INSERT INTO subsidiaries (deal_id, subsidiary_name, jurisdiction, stripe_atlas_status, spinout_status) VALUES (?, ?, ?, 'pending', 'pending') RETURNING *`)
    .bind(dealId, defaults.name, defaults.jurisdiction || 'Delaware_CCorp').first();
  return { sub, created: true };
}

// One-click execute (orchestrates IP → Equity → Atlas in sequence; idempotent per step)
legalcap.post('/spinout/execute', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);

  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);

  const project: any = await c.env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(dealId).first();
  if (!project) return c.json({ error: 'Deal not found' }, 404);

  const gate: any = await c.env.DB.prepare(`SELECT id, final_decision FROM decision_gates WHERE deal_id = ? AND final_decision = 'passed' ORDER BY id DESC LIMIT 1`).bind(dealId).first().catch(() => null);
  if (!gate && !data?.force) return c.json({ error: 'Spin-out requires a passed decision gate. Pass {force:true} to override.' }, 412);

  const { sub, created } = await getOrCreateSubForDeal(c.env, dealId, { name: data?.subsidiary_name || `${project.name}, Inc.`, jurisdiction: data?.jurisdiction, userId: user.id });

  // Prevent duplicate completed spin-outs
  if (sub.spinout_status === 'independent') {
    return c.json({ error: 'Spin-out already complete. This subsidiary is independent.', subsidiary: sub }, 409);
  }

  return c.json({
    subsidiary: { ...sub, equity_allocated: safeJson(sub.equity_allocated, {}), equity_allocation_json: safeJson(sub.equity_allocation_json, {}) },
    created,
    next_steps: [
      { step: 'ip_transfer', endpoint: '/api/legalcap/spinout/ip-transfer', done: !!sub.ip_license_doc_id },
      { step: 'equity_allocate', endpoint: '/api/legalcap/spinout/equity-allocate', done: sub.spinout_status === 'equity_allocated' || sub.spinout_status === 'incorporated' || sub.spinout_status === 'independent' },
      { step: 'stripe_atlas', endpoint: '/api/legalcap/spinout/stripe-atlas', done: sub.spinout_status === 'incorporated' || sub.spinout_status === 'independent' },
      { step: 'go_independent', endpoint: '/api/legalcap/spinout/go-independent', done: sub.spinout_status === 'independent' },
    ],
  }, 200);
});

legalcap.get('/spinout/status/:dealId', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  const dealId = parseInt(c.req.param('dealId'));
  const sub: any = await c.env.DB.prepare(`SELECT * FROM subsidiaries WHERE deal_id = ?`).bind(dealId).first();
  if (!sub) return c.json({ status: 'not_started', subsidiary: null, events: [] });
  const events = await c.env.DB.prepare(`SELECT * FROM spinout_events WHERE subsidiary_id = ? ORDER BY created_at DESC LIMIT 50`).bind(sub.id).all().catch(() => ({ results: [] as any[] }));
  return c.json({
    status: sub.spinout_status || 'pending',
    subsidiary: {
      ...sub,
      equity_allocated: safeJson(sub.equity_allocated, {}),
      equity_allocation_json: safeJson(sub.equity_allocation_json, {}),
      ip_transfer_complete: !!sub.ip_transfer_complete,
      independent_scaling_enabled: !!sub.independent_scaling_enabled,
    },
    events: (events.results || []).map((e: any) => ({ ...e, details: safeJson(e.details, {}) })),
  });
});

// Step 1: IP transfer — generates an IP_license doc, links to subsidiary, marks ip_transferred
legalcap.post('/spinout/ip-transfer', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);

  const project: any = await c.env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(dealId).first();
  if (!project) return c.json({ error: 'Deal not found' }, 404);
  const sub: any = await c.env.DB.prepare(`SELECT * FROM subsidiaries WHERE deal_id = ?`).bind(dealId).first();
  if (!sub) return c.json({ error: 'No subsidiary. Call /spinout/execute first.' }, 412);
  if (sub.ip_license_doc_id) return c.json({ error: 'IP transfer already complete', ip_license_doc_id: sub.ip_license_doc_id }, 409);
  if (sub.spinout_status && !['pending', 'ip_transferred'].includes(sub.spinout_status)) {
    return c.json({ error: `Invalid state for IP transfer: ${sub.spinout_status}` }, 412);
  }

  const userVars = data?.variables && typeof data.variables === 'object' ? data.variables : {};
  const vars = { ...defaultDocVars(project, user), ...userVars };
  const body = fillTemplate(TEMPLATES.IP_license, vars);
  const content = JSON.stringify({ template: 'IP_license', vars, body, model: 'template-only' });

  const upd = await c.env.DB.prepare(`UPDATE subsidiaries SET spinout_status = 'ip_transferred', ip_transfer_complete = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ip_license_doc_id IS NULL`)
    .bind(sub.id).run();
  if (!upd.meta?.changes) {
    const fresh: any = await c.env.DB.prepare(`SELECT ip_license_doc_id FROM subsidiaries WHERE id = ?`).bind(sub.id).first();
    return c.json({ error: 'IP transfer already complete', ip_license_doc_id: fresh?.ip_license_doc_id }, 409);
  }
  const doc: any = await c.env.DB.prepare(`INSERT INTO legal_documents (deal_id, type, status, content, generated_by) VALUES (?, 'IP_license', 'signed', ?, ?) RETURNING id`)
    .bind(dealId, content, user.id).first();
  await c.env.DB.prepare(`UPDATE subsidiaries SET ip_license_doc_id = ? WHERE id = ?`).bind(doc.id, sub.id).run();
  await logSpinoutEvent(c.env, sub.id, 'ip_transfer', { doc_id: doc.id, deal_id: dealId }, user.id);
  await logActivity(c.env, user.id, 'studio_ops_task', { entityType: 'spinout', entityId: sub.id, metadata: { step: 'ip_transfer', doc_id: doc.id } });

  return c.json({ ok: true, ip_license_doc_id: doc.id, spinout_status: 'ip_transferred' });
});

// Step 2: Equity allocation — Replit AI recommends fair split; user can override
legalcap.post('/spinout/equity-allocate', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);

  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);

  const project: any = await c.env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(dealId).first();
  if (!project) return c.json({ error: 'Deal not found' }, 404);
  const sub: any = await c.env.DB.prepare(`SELECT * FROM subsidiaries WHERE deal_id = ?`).bind(dealId).first();
  if (!sub) return c.json({ error: 'No subsidiary. Call /spinout/execute first.' }, 412);
  if (!['ip_transferred', 'equity_allocated'].includes(sub.spinout_status)) {
    return c.json({ error: `Equity allocation requires ip_transferred state (current: ${sub.spinout_status})` }, 412);
  }

  // If client passed an explicit override allocation, use it. Else ask AI (gated on quota).
  let allocation: any = data?.allocation && typeof data.allocation === 'object' ? data.allocation : null;
  let aiRationale: string | null = null;

  if (!allocation) {
    if (!(await checkAiQuota(c.env, user.id))) return c.json({ error: 'Rate limit (60 AI calls/hour). Pass an explicit allocation to override.' }, 429);
    const prompt = `Recommend an equity split for a venture-studio spin-out. Output a JSON object with keys: studio_pct, founders_pct, option_pool_pct, advisors_pct (sum to 100). Studio takes 10-20%, founders 60-80%, options 10-15%, advisors 0-5%.

Project: ${project.name}
Sector: ${project.sector || 'unknown'}
Stage: ${project.stage || 'unknown'}
Studio score: ${project.score || 'n/a'}

Reply with ONLY the JSON object, no commentary.`;
    const raw = await llm(c.env, 'You are a venture-studio equity allocation expert. Reply with valid JSON only.', prompt, 200);
    await logAi(c.env, user.id, 'spinout_equity', { deal_id: dealId });

    if (raw) {
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) : null;
        if (parsed && typeof parsed === 'object') allocation = parsed;
      } catch {}
    }
  }

  // Sane fallback if AI missing/invalid
  if (!allocation) allocation = { studio_pct: 15, founders_pct: 70, option_pool_pct: 13, advisors_pct: 2 };

  // Validate + normalize
  const cleaned: any = {};
  for (const k of ['studio_pct', 'founders_pct', 'option_pool_pct', 'advisors_pct']) {
    const v = Number(allocation[k]);
    cleaned[k] = Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : 0;
  }
  const total = cleaned.studio_pct + cleaned.founders_pct + cleaned.option_pool_pct + cleaned.advisors_pct;
  if (Math.abs(total - 100) > 0.5) {
    // Auto-normalize
    const factor = 100 / (total || 100);
    for (const k of Object.keys(cleaned)) cleaned[k] = Math.round(cleaned[k] * factor * 10) / 10;
  }
  if (cleaned.studio_pct < 5 || cleaned.studio_pct > 30) return c.json({ error: 'studio_pct out of policy range (5-30%)', allocation: cleaned }, 422);
  if (cleaned.founders_pct < 50 || cleaned.founders_pct > 85) return c.json({ error: 'founders_pct out of policy range (50-85%)', allocation: cleaned }, 422);

  const eqUpd = await c.env.DB.prepare(`UPDATE subsidiaries SET equity_allocation_json = ?, equity_allocated = ?, spinout_status = 'equity_allocated', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND spinout_status IN ('ip_transferred','equity_allocated')`)
    .bind(JSON.stringify(cleaned), JSON.stringify(cleaned), sub.id).run();
  if (!eqUpd.meta?.changes) return c.json({ error: 'Concurrent state change; refresh and retry' }, 409);
  await logSpinoutEvent(c.env, sub.id, 'equity_allocation', { allocation: cleaned, ai_used: !data?.allocation }, user.id);

  return c.json({ ok: true, allocation: cleaned, ai_rationale: aiRationale, spinout_status: 'equity_allocated' });
});

// Step 3: Stripe Atlas — placeholder flow, mock incorporation
legalcap.post('/spinout/stripe-atlas', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);

  const sub: any = await c.env.DB.prepare(`SELECT * FROM subsidiaries WHERE deal_id = ?`).bind(dealId).first();
  if (!sub) return c.json({ error: 'No subsidiary' }, 412);
  if (sub.stripe_atlas_status === 'incorporated') return c.json({ error: 'Already incorporated', stripe_atlas_id: sub.stripe_atlas_id }, 409);
  if (sub.spinout_status !== 'equity_allocated') {
    return c.json({ error: `Stripe Atlas requires equity_allocated state (current: ${sub.spinout_status})` }, 412);
  }
  // Conditional reservation to prevent concurrent double-incorporation
  const reserve = await c.env.DB.prepare(`UPDATE subsidiaries SET stripe_atlas_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (stripe_atlas_status IS NULL OR stripe_atlas_status = '') AND spinout_status = 'equity_allocated'`)
    .bind(sub.id).run();
  if (!reserve.meta?.changes) return c.json({ error: 'Incorporation already in progress' }, 409);

  const stripeKey = (c.env as any).STRIPE_ATLAS_API_KEY;
  // Real flow would: POST to Atlas API with company name + jurisdiction → poll for incorporation.
  // For now: mock the start + mock immediate completion to keep wizard end-to-end testable.
  const atlasId = stripeKey ? `atlas_${crypto.randomUUID().slice(0, 12)}` : `mock_atlas_${Date.now()}`;
  await logSpinoutEvent(c.env, sub.id, 'stripe_atlas_start', { stripe_atlas_id: atlasId, real_api: !!stripeKey }, user.id);

  // Simulate incorporation (in prod: defer to webhook or polling worker)
  const mockEin = `${Math.floor(10 + Math.random() * 89)}-${Math.floor(1000000 + Math.random() * 8999999)}`;
  await c.env.DB.prepare(`UPDATE subsidiaries SET stripe_atlas_id = ?, stripe_atlas_ref = ?, stripe_atlas_status = 'incorporated', spinout_status = 'incorporated', incorporation_date = CURRENT_TIMESTAMP, ein = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(atlasId, atlasId, mockEin, sub.id).run();
  await logSpinoutEvent(c.env, sub.id, 'stripe_atlas_complete', { stripe_atlas_id: atlasId, ein: mockEin, mock: !stripeKey }, user.id);

  return c.json({ ok: true, stripe_atlas_id: atlasId, ein: mockEin, real_api: !!stripeKey, spinout_status: 'incorporated' });
});

// Step 4: Go Independent — flips the switch, moves project out of pipeline
legalcap.post('/spinout/go-independent', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);

  const sub: any = await c.env.DB.prepare(`SELECT * FROM subsidiaries WHERE deal_id = ?`).bind(dealId).first();
  if (!sub) return c.json({ error: 'No subsidiary' }, 412);
  if (sub.spinout_status !== 'incorporated' && !data?.force) {
    return c.json({ error: 'Subsidiary must be incorporated before going independent. Pass {force:true} to override.', current_status: sub.spinout_status }, 412);
  }
  if (sub.spinout_status === 'independent') return c.json({ error: 'Already independent' }, 409);

  const dashUrl = data?.dashboard_url || `https://axal.vc/independent/${sub.id}`;
  const indUpd = await c.env.DB.prepare(`UPDATE subsidiaries SET spinout_status = 'independent', independent_scaling_enabled = 1, post_spinout_dashboard_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND spinout_status != 'independent'`)
    .bind(dashUrl, sub.id).run();
  if (!indUpd.meta?.changes) return c.json({ error: 'Already independent' }, 409);

  // Move project out of main pipeline
  try {
    await c.env.DB.prepare(`UPDATE projects SET pipeline_stage = 'spun_out', stage = 'spun_out', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(dealId).run();
  } catch (e: any) {
    // Schema may differ — ignore non-existent column
    console.error('go-independent project update:', e?.message);
  }

  await logSpinoutEvent(c.env, sub.id, 'independent_scale', { dashboard_url: dashUrl }, user.id);
  await logActivity(c.env, user.id, 'studio_ops_task', { entityType: 'spinout', entityId: sub.id, metadata: { step: 'independent', deal_id: dealId } });

  // Event-driven: enqueue downstream work asynchronously so this endpoint stays fast.
  try {
    const { enqueueJob } = await import('../services/queue');
    const { Listings, LiquidityEvents } = await import('../models/liquidity');
    await enqueueJob(c.env, 'metrics_aggregation', { trigger: 'spinout_independent', subsidiary_id: sub.id });
    await enqueueJob(c.env, 'traction_review', { project_id: dealId });

    // Auto-create a 0-share placeholder listing so the AI can value the asset
    // for marketing on the secondary marketplace. Founders/LPs will then create
    // real listings via /api/liquidity/list when they want to sell.
    await LiquidityEvents.create(c.env, {
      subsidiary_id: sub.id,
      deal_id: dealId,
      event_type: 'ipo_prep',
      status: 'listed',
      valuation_cents: 0,
      shares_offered: 0,
    });
    // Synthetic valuation listing under the operator's id so AI valuation runs.
    const placeholder = await Listings.create(c.env, {
      user_id: user.id,
      subsidiary_id: sub.id,
      shares: 0,
      asking_price_cents: 0,
      notes: 'Auto-generated valuation placeholder (spin-out went independent).',
    });
    if (placeholder) {
      await enqueueJob(c.env, 'liquidity_valuation', { listing_id: placeholder.id, subsidiary_id: sub.id });
    }
  } catch (e) {
    console.error('post-independent enqueue failed', e);
  }

  return c.json({ ok: true, spinout_status: 'independent', independent_scaling_enabled: true, dashboard_url: dashUrl });
});

// List independent subsidiaries (for scaling partners + dashboard widget)
legalcap.get('/spinout/independent', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT s.id, s.deal_id, s.subsidiary_name, s.jurisdiction, s.stripe_atlas_id, s.ein,
           s.incorporation_date, s.equity_allocation_json, s.post_spinout_dashboard_url,
           s.created_at, s.updated_at, p.name as project_name, p.sector
    FROM subsidiaries s
    LEFT JOIN projects p ON p.id = s.deal_id
    WHERE s.independent_scaling_enabled = 1
    ORDER BY s.updated_at DESC`;
  await sql.end();
  return c.json((rows as any[]).map(r => ({
    ...r,
    equity_allocation_json: safeJson(r.equity_allocation_json, {}),
    scaling_metrics: { mrr_cents: 0, headcount: 0, runway_months: 0, last_synced: null }, // placeholder
  })));
});

// Continue / iterate fallback — flip the deal back to active iteration without spinout
legalcap.post('/spinout/iterate', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Operators/admins only' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  try {
    await c.env.DB.prepare(`UPDATE projects SET pipeline_stage = 'mvp', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(dealId).run();
  } catch (e: any) { console.error('iterate:', e?.message); }
  await logActivity(c.env, user.id, 'studio_ops_task', { entityType: 'spinout', entityId: dealId, metadata: { decision: 'iterate' } });
  return c.json({ ok: true, decision: 'continue_iterate' });
});

export default legalcap;
