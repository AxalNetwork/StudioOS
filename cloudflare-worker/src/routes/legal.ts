import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireApprovedKyc, canAccessFounderResource } from '../auth';
import { seedStandardEventsForJurisdiction } from './compliance';
import { CONTRACT_DOC_TYPES } from './admin_contracts';
import { getActiveTemplateBody } from '../services/legalTemplateStore';
import { applyMergeFields } from '../services/mergeFields';
import { checkCompanyName } from '../services/nameCheck';
import { stripeCall } from './billing';
import { ensurePaymentsCustomer } from './payments';
import { findCatalogPriceById, getCatalog, priceForPlanMetadata } from '../services/catalog';
import { automaticTaxParams, stripeTaxEnabled } from '../util/stripeTax';
import { devPaymentFallbackAllowed, isProductionEnv } from '../util/paymentMode';
import {
  ensureIncorporationsSchema,
  createPendingIncorporation,
  createPendingIncorporationOrder,
  attachIncorporationPaymentIntent,
  recordPaidIncorporationFromPaymentIntent,
  getIncorporationForUser,
} from '../services/incorporations';
import legal83b from './legal_83b';
import legalEngine from './legal_engine';
import { JURISDICTIONS, JURISDICTION_TEMPLATE_TITLES } from '../services/jurisdictionCatalog';

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
// Task #2 (Legal Engine v1) — the catalog now lives in
// services/jurisdictionCatalog.ts (imported above) so the lightweight
// legal_engine sub-app can share it without this file's heavy import graph.

legal.get('/jurisdictions', async (c) => {
  await requireAuth(c);
  return c.json({ jurisdictions: JURISDICTIONS });
});

// Task #10 — live company-name availability check for the Incorporate wizard's
// Confirm step. Queries the selected jurisdiction's official register (or a
// documented JSON API) and caches definitive results ~1h in RATE_LIMITS KV.
// Every failure mode degrades to `status: 'unavailable'` ("verify manually").
legal.get('/name-check', async (c) => {
  const user = await requireAuth(c);

  const jurisdictionId = (c.req.query('jurisdiction_id') || '').trim();
  const name = (c.req.query('name') || '').trim();
  if (name.length < 2) return c.json({ error: 'A company name of at least 2 characters is required.' }, 400);
  if (!JURISDICTIONS.some((j) => j.id === jurisdictionId)) {
    return c.json({ error: `Unknown jurisdiction: ${jurisdictionId}` }, 400);
  }

  // Per-user rate limit — this endpoint can trigger billable outbound
  // Browser-Rendering navigations, so requireAuth alone isn't enough.
  // 30 checks / 10-minute window, counted against a fixed-window key.
  const windowMs = 10 * 60 * 1000;
  const rlKey = `namecheck:rl:${user.id}:${Math.floor(Date.now() / windowMs)}`;
  try {
    const current = parseInt((await c.env.RATE_LIMITS.get(rlKey)) || '0', 10) || 0;
    if (current >= 30) {
      return c.json({ error: 'Too many name checks. Please wait a few minutes and try again.' }, 429);
    }
    await c.env.RATE_LIMITS.put(rlKey, String(current + 1), { expirationTtl: 11 * 60 });
  } catch {
    /* best-effort limiter — never block the check on a KV hiccup */
  }

  const result = await checkCompanyName(c.env, jurisdictionId, name);
  return c.json(result);
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
  // Task #11 — the free wizard is now admin-only; the paid Stripe Checkout flow
  // replaces the founder-facing submit. This endpoint is retained for doc-gen
  // reuse by the downstream packet pipeline and for admin back-compat.
  const user = await requireAuth(c);
  if (user.role !== 'admin') {
    return c.json({ error: 'This endpoint is now admin-only. Founders must use the paid checkout flow.' }, 403);
  }
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
  // Task #2 — Contract doc_types are tracked separately so the wizard
  // response can tell the founder which kit items now require an e-sign
  // envelope instead of being inserted as 'generated' rows in `documents`.
  // (esign_envelopes is the single source of truth for active contracts.)
  const pendingEsign: Array<{ template_key: string; title: string; doc_type: string; reason: string }> = [];
  for (const tkey of j.templates) {
    const meta = JURISDICTION_TEMPLATES[tkey] || (TEMPLATES as any)[tkey];
    if (!meta) continue;
    // Task #2 — Skip contract doc_types entirely. We surface them in the
    // response under `pending_esign` so the frontend can prompt the
    // founder to issue them through POST /api/legal/esign/send.
    if (CONTRACT_DOC_TYPES.has(String(tkey).toLowerCase())) {
      pendingEsign.push({
        template_key: tkey,
        title: meta.title,
        doc_type: tkey,
        reason: 'use_esign_envelope',
      });
      continue;
    }
    const existing = await sql`SELECT id, title FROM documents WHERE project_id = ${project.id} AND template_name = ${tkey} LIMIT 1`;
    if (existing.length) {
      generated.push({ id: (existing[0] as any).id, title: meta.title, doc_type: tkey, reused: true });
      continue;
    }
    const docType = _ALLOWED_DOC_TYPES.has(tkey) ? tkey : 'other';
    // Task #8 — prefer the canonical D1 store body (with {{merge}} tokens)
    // over the inline stub; fall back to fillContent for the legacy
    // single-brace inline bodies.
    const d1Body = await getActiveTemplateBody(c.env, tkey);
    const content = d1Body
      ? applyMergeFields(d1Body, fill)
      : fillContent((TEMPLATES as any)[tkey]?.content || `${meta.title}\n\nCompany: ${fill.company_name}\nJurisdiction: ${fill.jurisdiction}\nDate: ${fill.incorporation_date}\n\n[Counsel-reviewed body managed in the FastAPI backend.]`);
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
    pending_esign: pendingEsign,
    seeded_compliance: seededCompliance,
    handoff,
  });
});

// Task #11 — per-jurisdiction Stripe Checkout for incorporation.
//   POST /incorporate/checkout → creates Stripe Checkout session + pending row
//   GET  /incorporate/status   → owner-scoped poll
//   POST /incorporate/dev-complete → dev/test-only simulate paid + enqueue

const JURISDICTION_PRICE_ENV: Record<string, keyof Env> = {
  us_de_ccorp: 'STRIPE_PRICE_INCORP_US_DE_CCORP' as keyof Env,
  us_de_llc: 'STRIPE_PRICE_INCORP_US_DE_LLC' as keyof Env,
  uk_ltd: 'STRIPE_PRICE_INCORP_UK_LTD' as keyof Env,
  sg_pte: 'STRIPE_PRICE_INCORP_SG_PTE' as keyof Env,
  ee_oy: 'STRIPE_PRICE_INCORP_EE_OY' as keyof Env,
};

const JURISDICTION_COSTS: Record<string, number> = {
  us_de_ccorp: 50000,
  us_de_llc: 30000,
  uk_ltd: 5000,
  sg_pte: 60000,
  ee_oy: 20000,
};

legal.post('/incorporate/checkout', async (c) => {
  const user = await requireAuth(c);
  await ensureIncorporationsSchema(c.env);
  const body = await c.req.json<{
    project_id: number;
    jurisdiction_id: string;
    company_name: string;
    registered_agent_name?: string | null;
    registered_agent_address?: string | null;
  }>();

  const j = JURISDICTIONS.find((x) => x.id === body.jurisdiction_id);
  if (!j) return c.json({ error: `Unknown jurisdiction: ${body.jurisdiction_id}` }, 400);
  if (!body.company_name?.trim()) return c.json({ error: 'company_name is required' }, 400);

  const sql = getSQL(c.env);
  const projRows = await sql`SELECT id, name, founder_id, entity_id FROM projects WHERE id = ${body.project_id}`;
  if (projRows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = projRows[0] as any;

  // Ownership: admin/partner OR founder-owns-project. Investors blocked.
  if (user.role !== 'admin' && user.role !== 'partner') {
    const ownsProject = project.founder_id != null && (user as any).founder_id === project.founder_id;
    if (!ownsProject) { await sql.end(); return c.json({ error: 'Forbidden: you do not own this project' }, 403); }
  }

  await sql.end();

  const appUrl = c.env.APP_URL || 'http://localhost:5000';
  const stripeKey = c.env.STRIPE_SECRET_KEY;
  // Resolve the incorporation SKU from the catalog (single source of truth): an
  // active product carrying `metadata.jurisdiction_id === j.id` with a one-time
  // price. Legacy STRIPE_PRICE_INCORP_* env vars are consulted only as a
  // non-production fallback during the catalog transition — never in prod.
  let priceId: string | undefined;
  if (stripeKey) {
    const price = await priceForPlanMetadata(c.env, 'jurisdiction_id', j.id, null);
    priceId = price?.id;
    if (!priceId && !isProductionEnv(c.env)) {
      priceId = (c.env as unknown as Record<string, unknown>)[JURISDICTION_PRICE_ENV[j.id]] as string | undefined;
    }
  }

  // No resolvable SKU. In a keyless dev env we simulate via dev-complete so the
  // UI flow stays testable; in production (or whenever a Stripe key is present)
  // we FAIL LOUDLY instead of granting a free incorporation.
  if (!priceId) {
    if (devPaymentFallbackAllowed(c.env)) {
      const devAmount = JURISDICTION_COSTS[j.id] ?? 0;
      const devSessionId = `dev_session_${user.id}_${Date.now()}`;
      const incId = await createPendingIncorporation(c.env, {
        user_id: user.id,
        project_id: project.id,
        jurisdiction_id: j.id,
        company_name: body.company_name.trim(),
        registered_agent_name: body.registered_agent_name ?? null,
        registered_agent_address: body.registered_agent_address ?? null,
        amount_cents: devAmount,
        currency: 'usd',
        stripe_session_id: devSessionId,
      });
      return c.json({
        url: `${appUrl}/api/legal/incorporate/dev-complete?id=${incId}`,
        incorporation_id: incId,
        dev: true,
      });
    }
    if (!stripeKey) return c.json({ error: 'stripe_not_configured' }, 503);
    return c.json(
      { error: 'catalog_price_missing', detail: `No active Stripe price for jurisdiction=${j.id}` },
      502,
    );
  }

  const params: Record<string, string> = {
    mode: 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${appUrl}/incorporate/success?incorporation_id=PENDING`,
    cancel_url: `${appUrl}/incorporate?cancelled=1`,
    'metadata[kind]': 'incorporation',
    'metadata[user_id]': String(user.id),
    'metadata[jurisdiction_id]': j.id,
    'metadata[company_name]': body.company_name.trim(),
    client_reference_id: `incorporation:${user.id}`,
  };
  if (user.email) params.customer_email = user.email;
  // Task #12 — Stripe Tax (flag-gated). Checkout collects the billing address;
  // this path uses customer_email so Checkout creates + addresses the customer.
  Object.assign(params, automaticTaxParams(stripeTaxEnabled(c.env), {
    checkout: true,
    hasExistingCustomer: !!params.customer,
  }));

  try {
    const session = await stripeCall<{ url: string; id: string; amount_total?: number }>(c.env, '/checkout/sessions', params);
    const incId = await createPendingIncorporation(c.env, {
      user_id: user.id,
      project_id: project.id,
      jurisdiction_id: j.id,
      company_name: body.company_name.trim(),
      registered_agent_name: body.registered_agent_name ?? null,
      registered_agent_address: body.registered_agent_address ?? null,
      amount_cents: session.amount_total ?? (JURISDICTION_COSTS[j.id] ?? 0),
      currency: 'usd',
      stripe_session_id: session.id,
    });
    // Patch success_url with the real incorporation_id so the success page can poll.
    const successUrl = `${appUrl}/incorporate/success?incorporation_id=${incId}`;
    await stripeCall<{ id: string }>(c.env, `/checkout/sessions/${session.id}`, {
      success_url: successUrl,
    }, { idempotencyKey: `incorp_update_url:${session.id}` });
    return c.json({ url: session.url, incorporation_id: incId, session_id: session.id });
  } catch (e) {
    return c.json({ error: 'checkout_failed', detail: (e as Error).message }, 502);
  }
});

// Task #6 — embedded-terminal incorporation order.
//   POST /incorporation/order → creates a one-time Stripe Invoice (so the fee
//   appears in the Billing dashboard) whose PaymentIntent is confirmed in-app
//   via Stripe Elements (no Checkout redirect), plus a pending order row. The
//   `payment_intent.succeeded` webhook marks the row paid + advances the filing
//   workflow. Also returns an optional annual "Registered Agent" subscription
//   offer the founder can opt into via the same embedded terminal.

interface IncorporationPrice { amountCents: number; currency: string; priceId?: string }

/**
 * Resolve the incorporation SKU for a jurisdiction from the Stripe catalog (the
 * single source of truth): an active product carrying
 * `metadata.jurisdiction_id === jurisdictionId` with a one-time price. Legacy
 * `STRIPE_PRICE_INCORP_*` env ids are consulted ONLY as a non-production
 * fallback during the catalog transition. Returns `null` when no catalog SKU is
 * configured so callers fail closed (production) or simulate (keyless dev) —
 * never charging the hardcoded `JURISDICTION_COSTS` amount against real Stripe.
 */
async function resolveIncorporationPrice(
  env: Env,
  jurisdictionId: string,
): Promise<IncorporationPrice | null> {
  // 1) Catalog incorporation SKU tagged with this jurisdiction — prod-allowed.
  const price = await priceForPlanMetadata(env, 'jurisdiction_id', jurisdictionId, null);
  if (price && typeof price.unit_amount === 'number' && price.unit_amount > 0) {
    return { amountCents: price.unit_amount, currency: price.currency || 'usd', priceId: price.id };
  }
  // 2) Legacy explicit env price id, resolved against the mirrored catalog —
  //    non-production fallback only.
  if (!isProductionEnv(env)) {
    const envPriceId = (env as unknown as Record<string, unknown>)[JURISDICTION_PRICE_ENV[jurisdictionId]] as string | undefined;
    if (envPriceId) {
      try {
        const p = await findCatalogPriceById(env, envPriceId);
        if (p && typeof p.unit_amount === 'number' && p.unit_amount > 0) {
          return { amountCents: p.unit_amount, currency: p.currency || 'usd', priceId: p.id };
        }
      } catch { /* fall through to null */ }
    }
  }
  return null;
}

interface RegisteredAgentOffer {
  price_id: string;
  amount_cents: number | null;
  currency: string;
  interval: string | null;
  product_name: string;
}

/**
 * Resolve the annual Registered Agent subscription offer from the catalog: a
 * `subscription` product whose metadata flags it as the registered-agent SKU
 * (`metadata.category === 'registered_agent'` or `metadata.plan === 'registered_agent'`).
 * Returns `null` when not configured so the wizard simply omits the opt-in.
 */
async function resolveRegisteredAgentOffer(env: Env): Promise<RegisteredAgentOffer | null> {
  try {
    const products = await getCatalog(env, 'subscription');
    const prod = products.find(
      (pp) => pp.active && (pp.metadata.category === 'registered_agent' || pp.metadata.plan === 'registered_agent'),
    );
    if (!prod) return null;
    const recurring = prod.prices.filter((pr) => pr.active && pr.type === 'recurring');
    const price = recurring.find((pr) => pr.interval === 'year') ?? recurring[0];
    if (!price) return null;
    return {
      price_id: price.id,
      amount_cents: price.unit_amount,
      currency: price.currency || 'usd',
      interval: price.interval,
      product_name: prod.name,
    };
  } catch {
    return null;
  }
}

legal.post('/incorporation/order', async (c) => {
  const user = await requireAuth(c);
  await ensureIncorporationsSchema(c.env);
  const body = await c.req.json<{
    project_id: number;
    jurisdiction_id: string;
    company_name: string;
    registered_agent_name?: string | null;
    registered_agent_address?: string | null;
  }>().catch(() => ({} as any));

  const j = JURISDICTIONS.find((x) => x.id === body.jurisdiction_id);
  if (!j) return c.json({ error: `Unknown jurisdiction: ${body.jurisdiction_id}` }, 400);
  const companyName = body.company_name?.trim();
  if (!companyName) return c.json({ error: 'company_name is required' }, 400);

  const sql = getSQL(c.env);
  const projRows = await sql`SELECT id, name, founder_id FROM projects WHERE id = ${body.project_id}`;
  if (projRows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = projRows[0] as any;
  // Ownership: admin/partner OR founder-owns-project. Investors blocked.
  if (user.role !== 'admin' && user.role !== 'partner') {
    const ownsProject = project.founder_id != null && (user as any).founder_id === project.founder_id;
    if (!ownsProject) { await sql.end(); return c.json({ error: 'Forbidden: you do not own this project' }, 403); }
  }
  await sql.end();

  const resolved = await resolveIncorporationPrice(c.env, j.id);
  const raOffer = await resolveRegisteredAgentOffer(c.env);

  const buildOrderArgs = (amount_cents: number, currency: string) => ({
    user_id: user.id,
    project_id: project.id,
    jurisdiction_id: j.id,
    company_name: companyName,
    registered_agent_name: body.registered_agent_name ?? null,
    registered_agent_address: body.registered_agent_address ?? null,
    amount_cents,
    currency,
  });

  // Dev fallback — keyless non-production env only: persist the order and mark
  // it paid so the wizard's embedded flow is testable without real payment. The
  // hardcoded JURISDICTION_COSTS amount is used ONLY here (when no catalog SKU is
  // configured); production never reaches this branch.
  if (devPaymentFallbackAllowed(c.env)) {
    const amountCents = resolved?.amountCents ?? (JURISDICTION_COSTS[j.id] ?? 0);
    const currency = resolved?.currency ?? 'usd';
    const incId = await createPendingIncorporationOrder(c.env, buildOrderArgs(amountCents, currency));
    await recordPaidIncorporationFromPaymentIntent(c.env, {
      id: `dev_pi_${incId}`,
      metadata: { incorporation_id: String(incId), user_id: String(user.id) },
      amount: amountCents,
      currency,
    });
    return c.json({
      dev: true,
      incorporation_id: incId,
      status: 'paid',
      amount_cents: amountCents,
      currency,
      registered_agent: raOffer,
    });
  }

  // Real Stripe path — REQUIRE a catalog-resolved SKU so a missing price fails
  // closed instead of silently charging the hardcoded JURISDICTION_COSTS amount.
  if (!resolved) {
    if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
    return c.json(
      { error: 'catalog_price_missing', detail: `No active Stripe price for jurisdiction=${j.id}` },
      502,
    );
  }
  const { amountCents, currency } = resolved;

  const incId = await createPendingIncorporationOrder(c.env, buildOrderArgs(amountCents, currency));
  try {
    const customer = await ensurePaymentsCustomer(c.env, user as any);
    // 1) Create the invoice WITHOUT pulling other pending items.
    const inv = await stripeCall<{ id: string }>(c.env, '/invoices', {
      customer,
      collection_method: 'charge_automatically',
      auto_advance: 'false',
      pending_invoice_items_behavior: 'exclude',
      'payment_settings[payment_method_types][0]': 'card',
      'metadata[kind]': 'incorporation',
      'metadata[incorporation_id]': String(incId),
      'metadata[user_id]': String(user.id),
      'metadata[jurisdiction_id]': j.id,
      // Task #12 — Stripe Tax (flag-gated). Valid on Invoices; the finalized
      // invoice's PaymentIntent then carries the computed tax in its amount.
      // Requires the customer to have a tax-determinable address once enabled.
      ...automaticTaxParams(stripeTaxEnabled(c.env)),
    });
    // 2) Add the incorporation fee as the sole line item on this invoice.
    await stripeCall(c.env, '/invoiceitems', {
      customer,
      invoice: inv.id,
      amount: String(amountCents),
      currency,
      description: `Incorporation — ${j.label} — ${companyName}`,
    });
    // 3) Finalize → Stripe mints the PaymentIntent we confirm in-app.
    const finalized = await stripeCall<{
      id: string;
      payment_intent: { id: string; client_secret: string } | string;
    }>(c.env, `/invoices/${inv.id}/finalize`, { 'expand[0]': 'payment_intent' });

    let piId: string;
    let clientSecret: string;
    if (typeof finalized.payment_intent === 'string') {
      const piObj = await stripeCall<{ id: string; client_secret: string }>(
        c.env, `/payment_intents/${finalized.payment_intent}`, {}, { method: 'GET' },
      );
      piId = piObj.id; clientSecret = piObj.client_secret;
    } else {
      piId = finalized.payment_intent.id;
      clientSecret = finalized.payment_intent.client_secret;
    }

    // 4) Stamp metadata so `payment_intent.succeeded` dispatches to the
    //    incorporation fulfilment branch (the invoice's PI doesn't inherit it).
    await stripeCall(c.env, `/payment_intents/${piId}`, {
      'metadata[kind]': 'incorporation',
      'metadata[incorporation_id]': String(incId),
      'metadata[user_id]': String(user.id),
      'metadata[jurisdiction_id]': j.id,
    });
    await attachIncorporationPaymentIntent(c.env, incId, piId);

    return c.json({
      incorporation_id: incId,
      client_secret: clientSecret,
      payment_intent_id: piId,
      invoice_id: inv.id,
      amount_cents: amountCents,
      currency,
      registered_agent: raOffer,
    });
  } catch (e) {
    return c.json({ error: 'order_failed', detail: (e as Error).message }, 502);
  }
});

legal.get('/incorporate/status', async (c) => {
  const user = await requireAuth(c);
  await ensureIncorporationsSchema(c.env);
  const id = Number(c.req.query('id') ?? 0);
  if (!id) return c.json({ error: 'id is required' }, 400);
  const row = await getIncorporationForUser(c.env, id, user.id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({
    id: row.id,
    status: row.status,
    jurisdiction_id: row.jurisdiction_id,
    company_name: row.company_name,
    amount_cents: row.amount_cents,
    currency: row.currency,
    stripe_session_id: row.stripe_session_id,
    paid_at: row.paid_at,
    created_at: row.created_at,
  });
});

// Task #1 — list all incorporation orders for the current user that have
// advanced past pending_payment (i.e. paid, processing, ready, failed).
// Used by the Legal page to surface in-flight or failed orders even when
// the user navigates away from the wizard DoneStep.
legal.get('/incorporate/orders', async (c) => {
  const user = await requireAuth(c);
  await ensureIncorporationsSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT id, status, jurisdiction_id, company_name, amount_cents, currency, paid_at, created_at
     FROM incorporations
     WHERE user_id = ? AND status != 'pending_payment'
     ORDER BY created_at DESC
     LIMIT 20`,
  ).bind(user.id).all<Record<string, unknown>>();
  return c.json({ orders: rows.results ?? [] });
});

legal.post('/incorporate/dev-complete', async (c) => {
  // Fail-closed: only run in a keyless non-production env. With a Stripe key
  // present (or in production) this simulated-payment endpoint is disabled so it
  // can never mark an incorporation paid for free. The `/incorporate/checkout`
  // dev branch only emits a link here under the same predicate.
  if (!devPaymentFallbackAllowed(c.env)) {
    return c.json({ error: 'not_found' }, 404);
  }

  const user = await requireAuth(c);
  await ensureIncorporationsSchema(c.env);
  const id = Number(c.req.query('id') ?? 0);
  if (!id) return c.json({ error: 'id is required' }, 400);

  const row = await getIncorporationForUser(c.env, id, user.id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status !== 'pending_payment') return c.json({ error: 'not_pending' }, 409);

  const { recordPaidIncorporation } = await import('../services/incorporations');
  await recordPaidIncorporation(c.env, {
    id: 'dev_session',
    metadata: { incorporation_id: String(id), user_id: String(user.id) },
    payment_status: 'paid',
    amount_total: Number(row.amount_cents) || 0,
    currency: String(row.currency) || 'usd',
  });

  return c.json({ ok: true, incorporation_id: id, status: 'paid' });
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
  // Task #2 — esign_envelopes is the single source of truth for actual
  // contracts. Refuse to mint a NEW contract-type row in `documents`;
  // callers must use POST /api/legal/esign/send to issue an envelope.
  // Non-contract templates (memos, internal docs) are still generatable.
  if (CONTRACT_DOC_TYPES.has(String(key).toLowerCase())) {
    await sql.end();
    return c.json({
      error: 'This template is a contract doc_type — use the e-sign envelope flow (POST /api/legal/esign/send) instead.',
      code: 'use_esign_envelope',
    }, 409);
  }
  // Task #8 — prefer the canonical D1 store body over the inline stub. D1
  // bodies carry {{merge}} tokens (applyMergeFields); the legacy inline
  // stubs use {single} braces and remain the fallback path.
  const d1Body = await getActiveTemplateBody(c.env, key);
  let content: string;
  if (d1Body) {
    content = applyMergeFields(d1Body, { ...body, company_name: body.company_name, project_id: body.project_id });
  } else {
    content = template.content;
    if (body.company_name) content = content.replace(/\{company_name\}/g, body.company_name);
    if (body.project_id) content = content.replace(/\{project_id\}/g, body.project_id);
  }

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
  // Task #2 — Hard guard: refuse to insert any contract doc_type into
  // `documents`. esign_envelopes is the single source of truth for active
  // contracts going forward. Non-contract docs (memos, drafts, 'other')
  // remain allowed.
  const requestedType = String(data.doc_type || 'other').toLowerCase();
  if (CONTRACT_DOC_TYPES.has(requestedType)) {
    await sql.end();
    return c.json({
      error: `doc_type '${requestedType}' is a contract type — create it via POST /api/legal/esign/send so it lives in esign_envelopes.`,
      code: 'use_esign_envelope',
    }, 409);
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
  // Task #2 — esign_envelopes is the single source of truth for active
  // contracts. Reject the legacy in-place sign for any contract doc_type;
  // callers must use POST /api/legal/esign/send to issue a real e-sign
  // envelope. Non-contract docs (memos, drafts, internal notes) are still
  // signable here for backward compatibility.
  const docType = String((rows[0] as any).doc_type || '').toLowerCase();
  if (CONTRACT_DOC_TYPES.has(docType)) {
    await sql.end();
    return c.json({
      error: 'This is a contract doc_type — use the e-sign envelope flow (POST /api/legal/esign/send) instead.',
      code: 'use_esign_envelope',
    }, 409);
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

// Task #13 — Section 83(b) tracker routes (GET/POST /83b/trackers,
// PATCH /83b/trackers/:id, POST /83b/trackers/:id/receipt). Defined in a
// standalone sub-app so the route logic stays loadable by the strip-types
// test gate without legal.ts's heavy import graph.
legal.route('/', legal83b);

export default legal;
