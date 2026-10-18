import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAdmin, requireFactor, requireStepUp, requireHqAuthoring } from '../auth';
import { ContractQueryError, contractPage, contractOrder, orderContracts, contractLike } from '../services/contractListQuery';
import { isSuperAdmin } from '../auth';
import { extractMergeFields } from '../services/legalTemplateStore';
import { isAutoMergeKey } from './esign';
import { hashEmail } from '../util/hashEmail';
import { mintDownloadToken } from '../services/signedDownload';
import { sendAgreementAssignedEmail } from '../services/email';
import { fanOut } from '../services/branches';
import { usageFromContractRows } from '../services/contractTemplateUsage';
import { publishedContractTemplates, publicationFields, publishContractTemplates, preparePublishedContract, ContractPreparationError,
  publishOneTemplate, withdrawTemplatePublication, PublicationError } from '../services/contractPublication';
import { formatView, formatOptions, renderFormat, effectiveFormat } from '../services/templateFormat';
import { renderLegalPng } from '../services/browserRun';
import { structureForPaper } from '../services/fundStructure';
import { createAndSendEnvelope } from './esign';
import { userMeetsTier } from '../middleware/requireTier';
import { findActiveDocusignIntegrationForUser } from '../integrations/providers/docusign';
import { sha256Hex, sha256HexBytes } from '../services/pdf';
import { paperModel, paperHtml, paperSha256, paperStateFor, stateLabel, type PublicationRef } from '../services/legalPaper';
import { paperFontsCss, readPaperChoice, PAPER_CHOICE_MESSAGES } from '../services/legalPaperCss';
import { renderLegalPdf } from '../services/legalPaperRender';
import { buildLegalDocx, docxFilename, DOCX_CONTENT_TYPE } from '../services/legalDocx';
import { fileRowStatement, newFileUid } from '../services/legalDocumentFiles';
import { refuse } from '../util/refusal';
import {
  listTemplates as storeListTemplates,
  getTemplate as storeGetTemplate,
  listVersions as storeListVersions,
  createTemplate as storeCreateTemplate,
  updateTemplate as storeUpdateTemplate,
  softDeleteTemplate as storeSoftDeleteTemplate,
  TemplateError,
  resolveFormat,
  type FormatPatch,
} from '../services/legalTemplateStore';

type AppContext = Context<{ Bindings: Env }>;
type ContractDownloadResult =
  | { ok: { url: string; expires_at: string }; error?: undefined }
  | { ok?: undefined; error: Response };

const adminContracts = new Hono<{ Bindings: Env }>();

adminContracts.get('/published-templates', async (c) => {
  await requireAdmin(c);
  try {
    const templates = await publishedContractTemplates(c.env);
    return c.json({ items: templates.map(({ body_md: _body, ...template }) => ({
      ...template, fields: publicationFields({ ...template, body_md: _body }),
    })) });
  } catch {
    return c.json({ error: 'Published templates are unreadable. Try again.', code: 'publications_unreadable' }, 503);
  }
});

adminContracts.post('/published-templates/publish', async (c) => {
  const admin = await requireHqAuthoring(c);
  let templates;
  try {
    templates = await publishContractTemplates(c.env, admin.id, await hashEmail(admin.email));
  } catch {
    return c.json({ error: 'Publication could not be recorded. Try again.', code: 'publication_failed' }, 503);
  }
  const payload = { templates: templates.map(t => ({ slug: t.slug, title: t.title, category: t.category, version: t.version })), pushed_at: new Date().toISOString() };
  const branches = await fanOut<{ stored: number; withdrawn: number }>(c.env, 'publishTemplate', [payload]);
  return c.json({ ok: true, items: templates.map(({ body_md: _body, ...template }) => template),
    template_count: templates.length, answered: branches.filter(b => b.status === 'ok').length, total: branches.length,
    branches: branches.map(b => ({ code: b.code, status: b.status, ...b.data, reason: b.reason })),
    ...(branches.length ? {} : { branches_reason: 'No branch Worker is bound. Publication is recorded here; no branch received the catalogue.' }) });
});

// D717 decision 10: publish ONE template's saved version, withdraw one, and
// push the recorded publications to the branches as they stand. The library
// publish above keeps working with no screen caller (D717.md).
function publicationRefusal(c: AppContext, e: unknown) {
  if (!(e instanceof PublicationError)) return c.json({ error: 'Publication could not be recorded. Try again.', code: 'publication_failed' }, 503);
  const text: Record<PublicationError['code'], string> = {
    template_not_found: 'Template not found.',
    published_version_changed: 'This template changed since it was opened. Open it again to publish the saved version.',
    template_has_no_body: 'A stub has no body to publish.',
    not_published: 'This template has no recorded publication.',
  };
  return c.json({ error: text[e.code], code: e.code }, e.status);
}

adminContracts.post('/published-templates/:slug/publish', async (c) => {
  const admin = await requireHqAuthoring(c);
  let input: { version?: unknown };
  try { input = await c.req.json(); } catch { input = {}; }
  if (!input || !Number.isSafeInteger(input.version)) return c.json({ error: 'Send the version to publish.', code: 'version_required' }, 400);
  try {
    const published = await publishOneTemplate(c.env, c.req.param('slug'), input.version as number, admin.id, await hashEmail(admin.email));
    if (!published) return c.json({ error: 'Publication could not be recorded. Try again.', code: 'publication_failed' }, 503);
    const { body_md: _body, ...publication } = published;
    return c.json({ ok: true, publication });
  } catch (e) { return publicationRefusal(c, e); }
});

adminContracts.post('/published-templates/:slug/withdraw', async (c) => {
  const admin = await requireHqAuthoring(c);
  try {
    return c.json({ ok: true, withdrawn: await withdrawTemplatePublication(c.env, c.req.param('slug'), admin.id, await hashEmail(admin.email)) });
  } catch (e) { return publicationRefusal(c, e); }
});

adminContracts.post('/published-templates/push', async (c) => {
  await requireHqAuthoring(c);
  let templates;
  try { templates = await publishedContractTemplates(c.env); }
  catch { return c.json({ error: 'Published templates are unreadable. Try again.', code: 'publications_unreadable' }, 503); }
  const payload = { templates: templates.map(t => ({ slug: t.slug, title: t.title, category: t.category, version: t.version })), pushed_at: new Date().toISOString() };
  const branches = await fanOut<{ stored: number; withdrawn: number }>(c.env, 'publishTemplate', [payload]);
  return c.json({ ok: true, template_count: templates.length, answered: branches.filter(b => b.status === 'ok').length, total: branches.length,
    branches: branches.map(b => ({ code: b.code, status: b.status, ...(b.data ? { stored: b.data.stored, withdrawn: b.data.withdrawn } : {}),
      ...(b.reason ? { reason: b.reason } : {}) })),
    ...(branches.length ? {} : { branches_reason: 'No branch Worker is bound. No branch received the catalogue.' }) });
});

adminContracts.get('/envelope-providers', async (c) => {
  const admin = await requireAdmin(c);
  if (!userMeetsTier(admin, 'studio')) return c.json({ native: { available: true }, docusign: { available: false, code: 'tier_required', reason: 'DocuSign is not on this plan. It requires Studio.' } });
  try {
    const connected = !!await findActiveDocusignIntegrationForUser(c.env, admin.id);
    return c.json({ native: { available: true }, docusign: { available: connected,
      ...(connected ? {} : { code: 'docusign_not_connected', reason: 'Connect DocuSign before sending through it.' }) } });
  } catch {
    return c.json({ error: 'Signing providers are unreadable. Try again.', code: 'providers_unreadable' }, 503);
  }
});

// D711 — the published version and body hash of a template, the stored state
// a page's Specimen / Superseded / Draft label comes from (decision 11).
async function publicationRef(env: Env, slug: string): Promise<PublicationRef | null> {
  try {
    const row = await env.DB.prepare(
      'SELECT version, body_md FROM legal_template_publications WHERE slug = ?',
    ).bind(slug).first<{ version: number; body_md: string }>();
    return row ? { version: Number(row.version), bodySha256: await sha256Hex(row.body_md || '') } : null;
  } catch {
    return null;
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Preview and send derive their body from the same recorded snapshot. Neither
// accepts a caller-supplied document body or a caller-supplied signer identity.
function envelopeHandler(operation: 'preview' | 'send') {
  return async (c: AppContext, admin: Awaited<ReturnType<typeof requireAdmin>>) => {
    let input: Record<string, unknown>;
    try { input = await c.req.json(); }
    catch { return c.json({ error: 'invalid_request' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return c.json({ error: 'invalid_request' }, 400);
    let prepared;
    try { prepared = await preparePublishedContract(c.env, input, admin.id, isSuperAdmin(admin)); }
    catch (e) {
      if (e instanceof ContractPreparationError) return c.json({ error: e.code, code: e.code, fields: e.fields }, e.status);
      return c.json({ error: 'The document could not be prepared. Nothing was sent. Try again.', code: 'preparation_unreadable' }, 503);
    }
    // D711 — the paper every copy of this envelope prints on.
    const paper = readPaperChoice(input.page_size, input.cover);
    if (!paper.ok) return refuse(c, 400, { code: paper.code, message: PAPER_CHOICE_MESSAGES[paper.code] });
    if (operation === 'preview') {
      const bodySha = await sha256Hex(prepared.body);
      const model = paperModel({
        title: prepared.template.title, body: prepared.body, slug: prepared.template.slug,
        category: prepared.template.category, version: prepared.template.version, bodySha256: bodySha,
        counterpartyName: prepared.recipientName || null,
        ...renderFormat(effectiveFormat(prepared.template)),
        structure: await structureForPaper(c.env, prepared.template.slug, 'preview'),
        state: paperStateFor({
          version: prepared.template.version,
          bodySha256: await sha256Hex(prepared.template.body_md || ''),
          publication: await publicationRef(c.env, prepared.template.slug),
        }),
      });
      const rendered = await renderLegalPdf(c.env, model, { pageSize: paper.pageSize, cover: paper.cover });
      if (!rendered.ok) return refuse(c, 503, { code: 'preview_unrenderable', message: 'The preview could not be drawn. Nothing was sent. Try again.' });
      c.header('Cache-Control', 'no-store');
      return c.json({
        pdf_base64: bytesToB64(rendered.bytes), body_sha256: bodySha, template_version: prepared.template.version,
        renderer: rendered.renderer, page_size: paper.pageSize,
      });
    }
    if (input.preview_sha256 !== await sha256Hex(prepared.body)) return c.json({ error: 'Preview this document again before sending.', code: 'preview_changed' }, 409);
    if (input.provider !== 'native' && input.provider !== 'docusign') return c.json({ error: 'provider_invalid' }, 400);
    if (input.provider === 'docusign' && !userMeetsTier(admin, 'studio')) return c.json({ error: 'tier_required' }, 402);
    try {
      await c.env.DB.prepare(`INSERT INTO activity_logs (action, details, actor, user_id)
        VALUES ('contract_envelope_send_requested', ?, ?, ?)`).bind(JSON.stringify({
          template_slug: prepared.template.slug, template_version: prepared.template.version,
          body_sha256: input.preview_sha256, provider: input.provider,
        }), await hashEmail(admin.email), admin.id).run();
    } catch {
      return c.json({ error: 'The send could not be audited. Nothing was sent. Try again.', code: 'send_audit_unreadable' }, 503);
    }
    try {
      const result = await createAndSendEnvelope(c.env, {
        adminUserId: admin.id, adminName: admin.name || admin.email,
        recipientUserId: prepared.recipientUserId, recipientEmail: prepared.recipientEmail, recipientName: prepared.recipientName,
        documentType: prepared.template.slug, dealId: prepared.dealId, appUrl: c.env.APP_URL || 'https://axal.vc',
        viaProvider: input.provider, actorIp: c.req.header('CF-Connecting-IP') || undefined,
        renderedBody: { title: prepared.template.title, body: prepared.body }, refuseUnfilled: true,
        pageSize: paper.pageSize, cover: paper.cover, templateVersion: prepared.template.version,
        format: effectiveFormat(prepared.template),
      });
      // Signing URLs contain a bearer credential; this admin flow only needs
      // the envelope id and the delivery outcome.
      if (!result) return c.json({ error: 'The send could not be confirmed. Check Agreements before retrying.', code: 'send_unconfirmed' }, 503);
      const { signing_url: _signingUrl, ...outcome } = result;
      return c.json({ ...outcome, template_version: prepared.template.version });
    } catch (e) {
      const message = (e as Error).message || '';
      if (message.startsWith('docusign_not_connected')) return c.json({ error: 'docusign_not_connected' }, 412);
      if (message.startsWith('docusign_')) return c.json({ error: 'docusign_send_failed' }, 502);
      // A write or mail failure can be ambiguous. Do not claim nothing was
      // sent when the existing envelope helper may already have committed.
      return c.json({ error: 'The send could not be confirmed. Check Agreements before retrying.', code: 'send_unconfirmed' }, 503);
    }
  };
}
adminContracts.post('/envelopes/preview', async (c) => {
  const admin = await requireAdmin(c);
  return envelopeHandler('preview')(c, admin);
});
adminContracts.post('/envelopes/send', async (c) => {
  const admin = await requireAdmin(c);
  return envelopeHandler('send')(c, admin);
});

export const TEMPLATE_LAYERS: Record<string, { label: string; description: string }> = {
  gp: { label: 'Internal Management (GP Level)', description: 'Governance, partner economics, and decision-making framework' },
  fund: { label: 'Fund Formation (LP Level)', description: 'Capital raising, investor agreements, and fund structure' },
  portfolio: { label: 'Investment Execution (Portfolio Level)', description: 'Templates used when investing into startups' },
  compliance: { label: 'Compliance & Regulatory', description: 'SEC filings, AML/KYC, and tax elections' },
};

// Task #2 — Single source of truth for which `documents.doc_type` values
// represent ACTUAL contracts (vs. templates, memos, or other non-contract
// documents). Used by:
//   - migration 007_contracts_union.sql (backfill predicate)
//   - this file's stats helpers
//   - legal.ts to refuse new sign-path writes for these types so e-sign
//     becomes the single source of truth going forward.
// Keep in sync with the keys in TEMPLATES below — any new contract type
// added must also be added here.
export const CONTRACT_DOC_TYPES: ReadonlySet<string> = new Set([
  'operating_agreement', 'carried_interest', 'ic_charter', 'service_agreement',
  'lpa', 'ppm', 'subscription', 'mgmt_company',
  'safe', 'term_sheet', 'bylaws', 'equity_split', 'ip_license', 'spa', 'voting_rights',
  'form_adv', 'aml_kyc', 'section_83b',
  // Task #5 (Z) — surface every new envelope type from W (investor subs),
  // X (partner deals), and Y (NDAs/templates). Adding the doc_type here
  // makes Admin > Contracts pick the row up via the union view, render a
  // friendly label, and include it in stats / template usage counts.
  'investor_nda_axal', 'mentor_nda_axal', 'mentor_engagement_disclaimer',
  'partner_nda_nonsolicit', 'partner_equity', 'partner_services',
  'partner_revshare', 'partner_capital', 'partner_custom',
  'finders_fee_intro_agreement', 'nda_3way_founder_investor_axal',
  'ip_background_schedule', 'data_access_acknowledgment_admin',
  'investor_subscription_pro', 'investor_subscription_inst',
]);

// Task #5 (Z) — Party-role classification for filter chips. Drives the
// "by party role" filter in the Admin > Contracts list. A doc may belong
// to multiple roles (e.g. a 3-way NDA touches founder + investor + axal);
// the filter matches if the doc's role set CONTAINS the requested role.
type PartyRole = 'founder' | 'investor' | 'advisor' | 'partner' | 'axal';
export const DOC_TYPE_PARTY_ROLES: Record<string, ReadonlyArray<PartyRole>> = {
  // founder-only (incorporation, IP, equity)
  bylaws: ['founder', 'axal'],
  equity_split: ['founder'],
  ip_license: ['founder', 'axal'],
  ip_background_schedule: ['founder', 'axal'],
  spa: ['founder', 'investor', 'axal'],
  voting_rights: ['founder', 'investor'],
  section_83b: ['founder'],
  // investor-facing
  lpa: ['investor', 'axal'],
  ppm: ['investor', 'axal'],
  subscription: ['investor', 'axal'],
  investor_subscription_pro: ['investor', 'axal'],
  investor_subscription_inst: ['investor', 'axal'],
  investor_nda_axal: ['investor', 'axal'],
  // advisor
  mentor_nda_axal: ['advisor', 'axal'],
  mentor_engagement_disclaimer: ['advisor', 'axal'],
  // partner
  partner_nda_nonsolicit: ['partner', 'axal'],
  partner_equity: ['partner', 'axal'],
  partner_services: ['partner', 'axal'],
  partner_revshare: ['partner', 'axal'],
  partner_capital: ['partner', 'axal'],
  partner_custom: ['partner', 'axal'],
  // pairwise + intro
  nda_3way_founder_investor_axal: ['founder', 'investor', 'axal'],
  finders_fee_intro_agreement: ['investor', 'partner', 'axal'],
  // platform / governance / admin
  data_access_acknowledgment_admin: ['axal'],
  operating_agreement: ['axal'],
  carried_interest: ['axal'],
  ic_charter: ['axal'],
  service_agreement: ['axal'],
  mgmt_company: ['axal'],
  safe: ['founder', 'investor'],
  term_sheet: ['founder', 'investor'],
  form_adv: ['axal'],
  aml_kyc: ['axal'],
};

export function partyRolesFor(docType: string | null | undefined): ReadonlyArray<PartyRole> {
  if (!docType) return [];
  return DOC_TYPE_PARTY_ROLES[docType] || [];
}

export const TEMPLATES: Record<string, { title: string; layer: string }> = {
  operating_agreement: { title: 'Operating Agreement (LLC)', layer: 'gp' },
  carried_interest: { title: 'Carried Interest / Partnership Agreement', layer: 'gp' },
  ic_charter: { title: 'Investment Committee Charter', layer: 'gp' },
  service_agreement: { title: 'Partner Service Agreement', layer: 'gp' },
  lpa: { title: 'Limited Partnership Agreement (LPA)', layer: 'fund' },
  ppm: { title: 'Private Placement Memorandum (PPM)', layer: 'fund' },
  subscription: { title: 'Subscription Agreement', layer: 'fund' },
  mgmt_company: { title: 'Management Company Agreement', layer: 'fund' },
  safe: { title: 'SAFE Agreement', layer: 'portfolio' },
  term_sheet: { title: 'Term Sheet', layer: 'portfolio' },
  bylaws: { title: 'Corporate Bylaws', layer: 'portfolio' },
  equity_split: { title: 'Equity Split Agreement', layer: 'portfolio' },
  ip_license: { title: 'IP License Agreement', layer: 'portfolio' },
  spa: { title: 'Stock Purchase Agreement (SPA)', layer: 'portfolio' },
  voting_rights: { title: "Voting & Investors' Rights Agreement", layer: 'portfolio' },
  form_adv: { title: 'Form ADV / Investment Adviser Registration', layer: 'compliance' },
  aml_kyc: { title: 'AML/KYC Policy', layer: 'compliance' },
  section_83b: { title: 'Section 83(b) Election', layer: 'compliance' },
  // Task #5 (Z) — friendly labels for the 15 new doc types. Layer
  // mirrors the natural grouping in Admin > Contracts > Templates.
  investor_nda_axal: { title: 'Investor NDA (Axal)', layer: 'fund' },
  mentor_nda_axal: { title: 'Advisor NDA (Axal)', layer: 'gp' },
  mentor_engagement_disclaimer: { title: 'Advisor Engagement Disclaimer', layer: 'gp' },
  partner_nda_nonsolicit: { title: 'Partner NDA + Non-Solicit', layer: 'gp' },
  partner_equity: { title: 'Partner Equity Deal', layer: 'gp' },
  partner_services: { title: 'Partner Services Agreement', layer: 'gp' },
  partner_revshare: { title: 'Partner Revenue-Share Deal', layer: 'gp' },
  partner_capital: { title: 'Partner Capital Deal', layer: 'gp' },
  partner_custom: { title: 'Partner Custom Deal', layer: 'gp' },
  finders_fee_intro_agreement: { title: "Finder's Fee / Intro Agreement", layer: 'gp' },
  nda_3way_founder_investor_axal: { title: '3-Way NDA (Founder ↔ Investor ↔ Axal)', layer: 'portfolio' },
  ip_background_schedule: { title: 'IP Background Schedule', layer: 'portfolio' },
  data_access_acknowledgment_admin: { title: 'Data Access Acknowledgment (Admin)', layer: 'compliance' },
  investor_subscription_pro: { title: 'Investor Subscription — Pro Tier', layer: 'fund' },
  investor_subscription_inst: { title: 'Investor Subscription — Institutional Tier', layer: 'fund' },
};

function daysBetween(a: any, b: any): number | null {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 < t2) return null;
  return Math.floor((t1 - t2) / 86400000);
}

// ---------------------------------------------------------------------------
// Task #2 — Unified contract row.
//
// Admin "All Contracts" reads from BOTH the legacy `documents` table and the
// modern `esign_envelopes` table. Rows from each source are normalised into
// the same shape (`UnifiedContract`) so the frontend can render them
// uniformly. The `source` discriminator is preserved so write actions
// (resend / void / download) can dispatch back to the correct table.
// ---------------------------------------------------------------------------
interface UnifiedContract {
  id: number;
  uid: string;
  title: string;
  doc_type: string | null;
  status: string; // unified: draft|generated|sent|signed|void
  template_name: string | null;
  project_id: number | null;
  project_name: string | null;
  recipient_email: string | null;
  recipient_name?: string | null;
  signed_by: string | null;
  signed_at: string | null;
  signed_ip: string | null;
  days_to_sign: number | null;
  created_at: string | null;
  updated_at: string | null;
  file_key: string | null;
  file_size: number | null;
  file_content_type: string | null;
  file_sha256: string | null;
  source: 'documents' | 'esign' | 'pairwise_nda' | 'partner_deal';
  // Task #2 — e-sign provider for esign-source rows. 'native' = in-house
  // signing flow; 'docusign' = routed through DocuSign. Always 'native'
  // for documents-source rows.
  provider?: 'native' | 'docusign';
  // Task #5 (Z) — friendly label + party-role tags so the admin UI can
  // render `Investor NDA (Axal)` instead of `investor_nda_axal` and
  // chip-filter by who's on the contract.
  doc_type_label?: string;
  party_roles?: ReadonlyArray<PartyRole>;
  // Task #5 (Z) v2 — raw underlying status (for esign-source: the
  // un-collapsed envelope status, e.g. `partially_signed`). The UI
  // uses this together with `can_resend` to gate the resend button so
  // it never appears for envelopes the backend would 400 on.
  raw_status?: string;
  can_resend?: boolean;
  // Task #45 — void reason + timestamp surfaced directly on list rows
  // so admins scanning Admin > Contracts > Voided can see why each row
  // was voided without clicking through to the detail modal. Populated
  // by `loadVoidReasonsBatch` after pagination so the join cost is
  // bounded by the page size, not the table size.
  void_reason?: string;
  voided_at?: string | null;
  /** Pairwise NDAs only — null when the source records no end date. */
  valid_until?: string | null;
  /** Partner deals only — null when absent. */
  expires_at?: string | null;
}

function decorateDocType<T extends UnifiedContract>(row: T): T {
  const dt = row.doc_type || '';
  row.doc_type_label = TEMPLATES[dt]?.title || dt || 'Unknown';
  row.party_roles = partyRolesFor(dt);
  return row;
}

function enrichDocRow(d: any, projectName: string | null, founderEmail: string | null): UnifiedContract {
  const recipient = d.signed_by || founderEmail || null;
  return {
    id: d.id,
    uid: d.uid,
    title: d.title,
    doc_type: d.doc_type,
    status: String(d.status || '').toLowerCase(),
    template_name: d.template_name,
    project_id: d.project_id,
    project_name: projectName,
    recipient_email: recipient,
    signed_by: d.signed_by,
    signed_at: d.signed_at,
    signed_ip: d.signed_ip ?? null,
    days_to_sign: daysBetween(d.signed_at, d.created_at),
    created_at: d.created_at,
    updated_at: d.updated_at,
    file_key: d.file_key ?? null,
    file_size: d.file_size ?? null,
    file_content_type: d.file_content_type ?? null,
    file_sha256: d.file_sha256 ?? null,
    source: 'documents',
    raw_status: String(d.status || '').toLowerCase(),
    can_resend: String(d.status || '').toLowerCase() === 'sent',
  };
}

// Map esign envelope status → unified contract status.
//   sent / partially_signed → sent (still pending signature)
//   completed               → signed
//   rejected / void         → void
function mapEsignStatus(s: string): string {
  const x = String(s || '').toLowerCase();
  if (x === 'completed') return 'signed';
  if (x === 'rejected' || x === 'void') return 'void';
  return 'sent';
}

function enrichEsignRow(e: any): UnifiedContract {
  return {
    id: e.id,
    uid: e.envelope_uuid,
    title: e.document_title,
    doc_type: e.document_type,
    status: mapEsignStatus(e.status),
    template_name: e.document_type,
    project_id: e.project_id ?? null,
    project_name: e.project_name ?? null,
    recipient_email: e.recipient_email || null,
    recipient_name: e.recipient_name || null,
    signed_by: e.signer_name || e.recipient_name || e.recipient_email || null,
    signed_at: e.last_signed_at || e.completed_at || null,
    signed_ip: e.signer_ip || null,
    days_to_sign: daysBetween(e.last_signed_at || e.completed_at, e.created_at),
    created_at: e.created_at,
    updated_at: e.completed_at || e.created_at,
    file_key: e.signed_r2_key || null,
    file_size: null,
    file_content_type: e.signed_r2_key ? 'application/pdf' : null,
    file_sha256: null,
    source: 'esign',
    // Task #2 — surface the e-sign provider so the admin UI can render
    // a "DocuSign" badge alongside the existing "eSign" source pill.
    provider: e.provider || 'native',
    raw_status: String(e.status || '').toLowerCase(),
    can_resend: ['sent', 'viewed'].includes(String(e.status || '').toLowerCase()),
  };
}

// Pull every esign envelope joined with its first/most-recent recipient
// and the most-recent signature event. Returns rows in unified shape.
async function loadEsignContracts(sql: ReturnType<typeof getSQL>): Promise<UnifiedContract[]> {
  // SQLite/D1 doesn't have lateral joins; we use scalar subqueries to fold
  // recipient + signature info into a single row per envelope.
  const rows: any[] = await sql`
    SELECT
      e.id, e.envelope_uuid, e.user_id, e.deal_id, d.project_id, p.name AS project_name,
      e.document_type, e.document_title,
      e.status, e.created_at, e.completed_at, e.signed_r2_key,
      COALESCE(e.provider, 'native') AS provider,
      (SELECT recipient_email FROM esign_recipients WHERE envelope_id = e.id ORDER BY id ASC LIMIT 1) AS recipient_email,
      (SELECT recipient_name  FROM esign_recipients WHERE envelope_id = e.id ORDER BY id ASC LIMIT 1) AS recipient_name,
      (SELECT recipient_name  FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed' ORDER BY signed_at DESC LIMIT 1) AS signer_name,
      (SELECT signer_ip       FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed' ORDER BY signed_at DESC LIMIT 1) AS signer_ip,
      (SELECT MAX(signed_at)  FROM esign_recipients WHERE envelope_id = e.id) AS last_signed_at
    FROM esign_envelopes e
    LEFT JOIN deals d ON d.id = e.deal_id
    LEFT JOIN projects p ON p.id = d.project_id
    ORDER BY e.created_at DESC
  `;
  return rows.map(r => decorateDocType(enrichEsignRow(r)));
}

// Pull every legacy `documents` row that hasn't been ported to esign yet.
// Project + founder email is batch-resolved to avoid N+1.
async function loadDocumentsContracts(sql: ReturnType<typeof getSQL>): Promise<UnifiedContract[]> {
  // Restrict to actual contract doc_types so non-contract noise (memos,
  // 'other', NDAs, etc.) doesn't pollute Admin Contracts list/stats.
  const contractTypes = Array.from(CONTRACT_DOC_TYPES);
  const placeholders = contractTypes.map(() => '?').join(',');
  const docs: any[] = await sql.unsafe(
    `SELECT * FROM documents
      WHERE migrated_to_esign_id IS NULL
        AND LOWER(COALESCE(doc_type, '')) IN (${placeholders})
      ORDER BY created_at DESC`,
    contractTypes,
  );
  if (docs.length === 0) return [];

  const projectIds = Array.from(new Set(docs.map(d => d.project_id).filter(Boolean))) as number[];
  const projectMap = new Map<number, { name: string; founder_email: string | null }>();
  if (projectIds.length > 0) {
    // D1 doesn't support array binding; build an IN (?,?,?) clause manually.
    const placeholders = projectIds.map(() => '?').join(',');
    const projRows: any[] = await sql.unsafe(
      `SELECT p.id, p.name, f.email AS founder_email
         FROM projects p
         LEFT JOIN founders f ON f.id = p.founder_id
        WHERE p.id IN (${placeholders})`,
      projectIds,
    );
    for (const r of projRows) {
      projectMap.set(r.id, { name: r.name, founder_email: r.founder_email });
    }
  }

  return docs.map(d => {
    const p = d.project_id ? projectMap.get(d.project_id) : null;
    return decorateDocType(enrichDocRow(d, p?.name || null, p?.founder_email || null));
  });
}

// Task #3 — pairwise NDAs source. The Y-1 `pairwise_ndas` table holds
// founder ↔ investor / founder ↔ partner NDA pairs that aren't backed by
// a single `documents` row but logically ARE contracts. We surface each
// pair as a unified row so the main Contracts list / stats / status tabs
// see the full population, not just the legacy `documents` slice. The
// dedicated /pairwise-ndas endpoint stays for the Pairwise tab's
// pair-centric view (party_a/party_b/intermediary).
function mapPairwiseStatus(s: string): string {
  const x = String(s || '').toLowerCase();
  if (x === 'active' || x === 'completed' || x === 'signed') return 'signed';
  if (x === 'revoked' || x === 'expired' || x === 'void' || x === 'rejected') return 'void';
  return 'sent';
}

async function loadPairwiseNdaContracts(sql: ReturnType<typeof getSQL>, strict = false): Promise<UnifiedContract[]> {
  let rows: any[] = [];
  try {
    rows = await sql`
      SELECT p.id, p.party_a_user_id, p.party_b_user_id, p.intermediary,
             p.nda_envelope_uuid, p.status, p.valid_until,
             p.created_at, p.updated_at,
             ua.email AS party_a_email, ub.email AS party_b_email
        FROM pairwise_ndas p
        LEFT JOIN users ua ON ua.id = p.party_a_user_id
        LEFT JOIN users ub ON ub.id = p.party_b_user_id
       ORDER BY p.created_at DESC
    `;
  } catch (error) {
    if (strict) throw error;
    // table not present on this env (older D1) — surface empty.
    return [];
  }
  const docType = 'nda_3way_founder_investor_axal';
  return rows.map((r): UnifiedContract => decorateDocType({
    id: r.id,
    uid: r.nda_envelope_uuid || `pairwise:${r.id}`,
    title: `Pairwise NDA — ${r.party_a_email || '?'} ↔ ${r.party_b_email || '?'}`,
    doc_type: docType,
    status: mapPairwiseStatus(r.status),
    template_name: 'pairwise_nda',
    project_id: null,
    project_name: r.intermediary ? `intermediary: ${r.intermediary}` : null,
    recipient_email: r.party_b_email || r.party_a_email || null,
    signed_by: null,
    signed_at: mapPairwiseStatus(r.status) === 'signed' ? (r.updated_at || null) : null,
    signed_ip: null,
    days_to_sign: mapPairwiseStatus(r.status) === 'signed'
      ? daysBetween(r.updated_at, r.created_at)
      : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    file_key: null,
    file_size: null,
    file_content_type: null,
    file_sha256: null,
    source: 'pairwise_nda',
    raw_status: String(r.status || '').toLowerCase(),
    can_resend: false,
    valid_until: r.valid_until ?? null,
    expires_at: null,
  }));
}

// Task #3 — partner_deals source (X-1 table). Each partner deal IS a
// contract artefact (deal type, term, granted tiers). Surfacing them in
// the union means the main list/stats reflect every partner agreement,
// not just the founder-side `documents` rows.
function mapPartnerDealStatus(s: string): string {
  const x = String(s || '').toLowerCase();
  if (x === 'active' || x === 'signed' || x === 'completed') return 'signed';
  if (x === 'revoked' || x === 'expired' || x === 'void' || x === 'rejected') return 'void';
  if (x === 'draft' || x === 'pending') return 'sent';
  return 'sent';
}

async function loadPartnerDealContracts(sql: ReturnType<typeof getSQL>, strict = false): Promise<UnifiedContract[]> {
  let rows: any[] = [];
  try {
    // The same three wrong names corrected at the other partner_deals query
    // in this file: `user_id` not `partner_user_id`, the two granted_tier_*
    // columns not a `granted_tiers`, and no `updated_at` at all. Fixing one
    // copy of a broken query does not fix its duplicates.
    rows = await sql`
      SELECT d.id, d.user_id AS partner_user_id, d.deal_type, d.term_months,
             d.granted_tier_founder, d.granted_tier_investor,
             d.status, d.created_at, d.expires_at,
             u.email AS partner_email, u.name AS partner_name
        FROM partner_deals d
        LEFT JOIN users u ON u.id = d.user_id
       ORDER BY d.created_at DESC
    `;
  } catch (error) {
    if (strict) throw error;
    return [];
  }
  return rows.map((r): UnifiedContract => {
    const dt = `partner_${String(r.deal_type || 'custom').toLowerCase()}`;
    const docType = TEMPLATES[dt] ? dt : 'partner_custom';
    const unified = mapPartnerDealStatus(r.status);
    return decorateDocType({
      id: r.id,
      uid: `partner_deal:${r.id}`,
      title: `${TEMPLATES[docType]?.title || 'Partner Deal'} — ${r.partner_email || r.partner_name || 'unknown'}`,
      doc_type: docType,
      status: unified,
      template_name: docType,
      project_id: null,
      project_name: null,
      recipient_email: r.partner_email || null,
      signed_by: unified === 'signed' ? (r.partner_name || r.partner_email || null) : null,
      signed_at: unified === 'signed' ? (r.updated_at || null) : null,
      signed_ip: null,
      days_to_sign: unified === 'signed'
        ? daysBetween(r.updated_at, r.created_at)
        : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      file_key: null,
      file_size: null,
      file_content_type: null,
      file_sha256: null,
      source: 'partner_deal',
      raw_status: String(r.status || '').toLowerCase(),
      can_resend: false,
      valid_until: null,
      expires_at: r.expires_at ?? null,
    });
  });
}

export async function loadAllContracts(sql: ReturnType<typeof getSQL>, strict = false): Promise<UnifiedContract[]> {
  // Task #3 — true 4-source union: legacy documents + e-sign envelopes
  // (live signing) + pairwise NDAs (Y-1) + partner deals (X-1). Each
  // loader returns rows already normalised to UnifiedContract; failures
  // on the optional sources (table missing on older D1) collapse to []
  // inside the loader so the union is always best-effort.
  const [docRows, esignRows, pairwiseRows, partnerRows] = await Promise.all([
    loadDocumentsContracts(sql),
    loadEsignContracts(sql),
    loadPairwiseNdaContracts(sql, strict),
    loadPartnerDealContracts(sql, strict),
  ]);
  const merged = [...docRows, ...esignRows, ...pairwiseRows, ...partnerRows];
  merged.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
  return merged;
}

async function recordedSigningDates(c: AppContext, rows: UnifiedContract[]) {
  const events = await c.env.DB.prepare(`SELECT sent.envelope_uuid, MIN(sent.sent_at) AS sent_at FROM (
    SELECT e.envelope_uuid, CASE WHEN a.action = 'email_sent' OR
      (a.action = 'envelope_created' AND e.provider = 'docusign'
       AND CASE WHEN json_valid(a.meta) = 1 THEN json_extract(a.meta, '$.provider') END = 'docusign')
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', a.ts) END AS sent_at
    FROM esign_envelopes e LEFT JOIN esign_audit_events a ON a.envelope_id=e.id
    UNION ALL
    SELECT e.envelope_uuid, strftime('%Y-%m-%dT%H:%M:%fZ', l.created_at) AS sent_at
      FROM esign_envelopes e JOIN activity_logs l ON l.action='contract_resent'
        AND CASE WHEN json_valid(l.details)=1 THEN json_extract(l.details, '$.envelope_uuid') END = e.envelope_uuid
      WHERE CASE WHEN json_valid(l.details)=1 THEN json_extract(l.details, '$.email_sent') END = 1
    ) sent GROUP BY sent.envelope_uuid`).all<{ envelope_uuid: string; sent_at: string | null }>();
  const dates = new Map((events.results || []).map(e => [e.envelope_uuid, e.sent_at]));
  return rows.map(row => ({ ...row,
    // Synthetic NDA/deal updated_at is last activity, not a signature date.
    signed_at: ['pairwise_nda', 'partner_deal'].includes(row.source) ? null : row.signed_at,
    sent_at: row.source === 'esign' ? dates.get(row.uid) ?? null : null,
    days_to_sign: row.source === 'esign' ? daysBetween(row.signed_at, dates.get(row.uid)) : null,
  }));
}

// Task #45 — batch sibling of `loadVoidReason` used by the list endpoint.
// Single SQL pass over `activity_logs` for every void-state row in the
// returned page (keyed by either `details.uid` or `details.envelope_uuid`).
// `ORDER BY id DESC` + skip-if-already-seen keeps only the most recent
// `contract_voided` entry per contract, matching `loadVoidReason`'s
// behaviour. Best-effort — never throws.
async function loadVoidReasonsBatch(
  sql: ReturnType<typeof getSQL>,
  uids: string[],
): Promise<Map<string, { reason: string; voided_at: string | null }>> {
  const out = new Map<string, { reason: string; voided_at: string | null }>();
  if (uids.length === 0) return out;
  try {
    const placeholders = uids.map(() => '?').join(',');
    const rows: any[] = await sql.unsafe(
      `SELECT details, created_at FROM activity_logs
        WHERE action = 'contract_voided'
          AND json_valid(details) = 1
          AND COALESCE(json_extract(details, '$.uid'), json_extract(details, '$.envelope_uuid')) IN (${placeholders})
        ORDER BY id DESC`,
      uids,
    );
    for (const r of rows) {
      try {
        const d = JSON.parse(r.details || '{}');
        const k = d.uid || d.envelope_uuid;
        if (!k || out.has(k) || !d.reason) continue;
        out.set(String(k), { reason: String(d.reason), voided_at: r.created_at || null });
      } catch { /* skip malformed details */ }
    }
  } catch (e) {
    console.warn('[admin_contracts] batch void reason lookup skipped:', (e as Error).message);
  }
  return out;
}

// GET /api/admin/contracts — list with filters (UNION over documents + esign).
adminContracts.get('/', async (c) => {
  await requireAdmin(c);
  const status = (c.req.query('status') || '').toLowerCase();
  const docType = c.req.query('doc_type') || '';
  const projectId = c.req.query('project_id');
  // Task #2 — provider filter chip ("All / Native / DocuSign"). Only
  // applies to esign-source rows; legacy `documents` rows are always
  // 'native' so the filter naturally hides them when 'docusign' is
  // selected.
  const provider = (c.req.query('provider') || '').toLowerCase();
  // Task #5 (Z) — `party_role` filter chip
  // (founder|investor|advisor|partner|axal). Matches if the doc's
  // role set contains the requested role.
  const partyRole = (c.req.query('party_role') || '').toLowerCase() as PartyRole | '';
  let controls;
  try { controls = { ...contractPage(c.req.query()), ...contractOrder(c.req.query()) }; }
  catch (error) {
    if (error instanceof ContractQueryError) return c.json({ error: 'invalid_contract_query', message: 'Choose valid paging, search, sort and filter values.' }, 400);
    throw error;
  }
  const { limit, offset, sort, direction } = controls;
  const q = controls.q.toLowerCase();
  if (status && !['all', 'draft', 'generated', 'sent', 'signed', 'void', 'awaiting_signature'].includes(status)) return c.json({ error: 'Unknown contract status' }, 400);
  if (provider && !['native', 'docusign'].includes(provider)) return c.json({ error: 'Unknown provider' }, 400);
  if (partyRole && !['founder', 'investor', 'advisor', 'partner', 'axal'].includes(partyRole)) return c.json({ error: 'Unknown party role' }, 400);
  if (projectId && (!/^\d+$/.test(projectId) || !Number.isSafeInteger(Number(projectId)) || Number(projectId) < 1)) return c.json({ error: 'Invalid project id' }, 400);
  const template = c.req.query('template') || '';
  const signedRecent = c.req.query('signed_recent');
  if (signedRecent && signedRecent !== 'true') return c.json({ error: 'signed_recent must be true' }, 400);

  const sql = getSQL(c.env);
  try {
    let rows = await loadAllContracts(sql, true);
    if (c.req.query('recorded') === 'true') rows = await recordedSigningDates(c, rows);

    if (status && status !== 'all') rows = rows.filter(r => status === 'awaiting_signature'
      ? ['sent', 'generated'].includes(r.status) : r.status === status);
    if (template) rows = rows.filter(r => r.template_name === template || r.doc_type === template);
    if (signedRecent) {
      const now = Date.now(), cutoff = now - 30 * 86400000;
      rows = rows.filter(r => r.status === 'signed' && r.signed_at != null
        && Date.parse(r.signed_at) >= cutoff && Date.parse(r.signed_at) <= now);
    }
    if (docType)   rows = rows.filter(r => r.doc_type === docType);
    if (projectId) rows = rows.filter(r => r.project_id === parseInt(projectId));
    if (provider === 'native' || provider === 'docusign') {
      rows = rows.filter(r => (r.provider || 'native') === provider);
    }
    if (partyRole && ['founder', 'investor', 'advisor', 'partner', 'axal'].includes(partyRole)) {
      rows = rows.filter(r => (r.party_roles || []).includes(partyRole as PartyRole));
    }
    if (q) {
      rows = rows.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.recipient_email || '').toLowerCase().includes(q) ||
        (r.recipient_name || '').toLowerCase().includes(q) ||
        (r.template_name || '').toLowerCase().includes(q) ||
        (r.project_name || '').toLowerCase().includes(q)
      );
    }

    orderContracts(rows, sort, direction);
    const total = rows.length;
    const items = rows.slice(offset, offset + limit);
    // Task #45 — attach void_reason/voided_at to every void row in the
    // page so the Voided sub-tab can show a truncated reason inline
    // without N+1 detail-fetches.
    const voidUids = items.filter(r => r.status === 'void' && r.uid).map(r => r.uid);
    if (voidUids.length > 0) {
      const reasons = await loadVoidReasonsBatch(sql, voidUids);
      for (const r of items) {
        if (r.status !== 'void') continue;
        const v = reasons.get(r.uid);
        if (v) { r.void_reason = v.reason; r.voided_at = v.voided_at; }
      }
    }
    return c.json({
      total, limit, offset, sort, direction,
      items,
      meta: { sources: ['documents', 'esign_envelopes', 'pairwise_ndas', 'partner_deals'], unioned: true },
    });
  } catch {
    return c.json({ error: 'Contracts are unreadable. Try again.', code: 'contracts_unreadable' }, 503);
  } finally {
    await sql.end();
  }
});

// D647 — minimal member/deal choices for the guided envelope composer.
adminContracts.get('/recipients', async (c) => {
  const admin = await requireAdmin(c);
  let page;
  try { page = contractPage(c.req.query()); }
  catch (error) {
    if (error instanceof ContractQueryError) return c.json({ error: 'invalid_picker_query', message: 'Choose valid paging and search values.' }, 400);
    throw error;
  }
  const pattern = contractLike(page.q);
  const allowed = isSuperAdmin(admin) ? 1 : 0;
  try {
    const total = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM users
       WHERE is_active = 1 AND (? = 1 OR role <> 'admin' OR id = ?)
         AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`,
    ).bind(allowed, admin.id, pattern, pattern).first<{ total: number }>();
    const rows = await c.env.DB.prepare(
      `SELECT id, name, email, role FROM users
       WHERE is_active = 1 AND (? = 1 OR role <> 'admin' OR id = ?)
         AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
       ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
    ).bind(allowed, admin.id, pattern, pattern, page.limit, page.offset).all();
    return c.json({ items: rows.results || [], total: Number(total?.total ?? 0), limit: page.limit, offset: page.offset });
  } catch {
    return c.json({ error: 'Recipients are unreadable. Try again.', code: 'recipients_unreadable' }, 503);
  }
});

adminContracts.get('/deal-options', async (c) => {
  await requireAdmin(c);
  let page;
  try { page = contractPage(c.req.query()); }
  catch (error) {
    if (error instanceof ContractQueryError) return c.json({ error: 'invalid_picker_query', message: 'Choose valid paging and search values.' }, 400);
    throw error;
  }
  const pattern = contractLike(page.q);
  try {
    const total = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM deals d JOIN projects p ON p.id = d.project_id
       WHERE p.name LIKE ? ESCAPE '\\' OR d.uid LIKE ? ESCAPE '\\'`,
    ).bind(pattern, pattern).first<{ total: number }>();
    const rows = await c.env.DB.prepare(
      `SELECT d.id, d.uid, d.status, d.project_id, p.name AS project_name
       FROM deals d JOIN projects p ON p.id = d.project_id
       WHERE p.name LIKE ? ESCAPE '\\' OR d.uid LIKE ? ESCAPE '\\'
       ORDER BY p.name COLLATE NOCASE, d.id LIMIT ? OFFSET ?`,
    ).bind(pattern, pattern, page.limit, page.offset).all();
    return c.json({ items: rows.results || [], total: Number(total?.total ?? 0), limit: page.limit, offset: page.offset });
  } catch {
    return c.json({ error: 'Deals are unreadable. Try again.', code: 'deals_unreadable' }, 503);
  }
});

adminContracts.get('/templates/store/:slug/fields', async (c) => {
  await requireAdmin(c);
  const slug = c.req.param('slug');
  if (!/^[a-z0-9_-]{1,100}$/.test(slug)) return c.json({ error: 'Template not found' }, 404);
  try {
    const template = await storeGetTemplate(c.env, slug);
    if (!template || template.is_stub || !template.body_md.trim()) return c.json({ error: 'Template not found' }, 404);
    const fields = extractMergeFields(template.body_md).map((key) => ({
      key, label: key.replace(/[._]+/g, ' '),
      required: !isAutoMergeKey(key), filled_by: isAutoMergeKey(key) ? 'send' : 'sender',
    }));
    const publication = (await publishedContractTemplates(c.env)).find(row => row.slug === slug);
    return c.json({ slug: template.slug, title: template.title, version: template.version, fields,
      publication_state: publication ? 'published' : 'unpublished', published_version: publication?.version ?? null,
      publication_reason: publication ? 'The recorded published version is offered by New envelope; this field schema describes the current editable draft.'
        : 'No publication has been recorded for this template. Publish it before using New envelope.' });
  } catch {
    return c.json({ error: 'Template fields are unreadable. Try again.', code: 'template_fields_unreadable' }, 503);
  }
});

// GET /api/admin/contracts/stats — aggregate counters across the union.
adminContracts.get('/stats', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  try {
    const loaded = await loadAllContracts(sql, true);
    const recorded = c.req.query('recorded') === 'true';
    const rows = recorded ? await recordedSigningDates(c, loaded) : loaded;
    const byStatus: Record<string, number> = { draft: 0, generated: 0, sent: 0, signed: 0, void: 0 };
    const byTypeCount = new Map<string, number>();
    const signDays: number[] = [];
    let signedRecent = 0;
    const cutoff = Date.now() - 30 * 86400000;

    for (const r of rows) {
      if (r.status in byStatus) byStatus[r.status]++;
      if (r.doc_type) byTypeCount.set(r.doc_type, (byTypeCount.get(r.doc_type) || 0) + 1);
      const days = recorded ? r.days_to_sign : daysBetween(r.signed_at, r.created_at);
      if (r.status === 'signed' && days != null) signDays.push(days);
      if (r.status === 'signed' && r.signed_at) {
        const t = new Date(r.signed_at).getTime();
        if (Number.isFinite(t) && t >= cutoff && t <= Date.now()) signedRecent++;
      }
    }

    const byType = Array.from(byTypeCount.entries())
      .filter(([t]) => !!t)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));

    return c.json({
      total: rows.length,
      by_status: byStatus,
      by_type: byType,
      avg_days_to_sign: signDays.length
        ? Math.round((signDays.reduce((a, b) => a + b, 0) / signDays.length) * 10) / 10
        : null,
      signed_last_30d: signedRecent,
      pending_signature: byStatus.sent + byStatus.generated,
    });
  } catch {
    return c.json({ error: 'Contracts are unreadable. Try again.', code: 'contracts_unreadable' }, 503);
  } finally {
    await sql.end();
  }
});

export async function loadTemplateUsage(sql: ReturnType<typeof getSQL>, strict = false) {
  const catalogKeys = new Set(Object.keys(TEMPLATES));
  const rows = await loadAllContracts(sql, strict);
  return usageFromContractRows(rows, catalogKeys);
}

export function buildTemplateCatalog(usage: Map<string, number>, lastUsed: Map<string, string>) {
  return Object.entries(TEMPLATES).map(([k, v]) => ({
    key: k,
    title: v.title,
    doc_type: k,
    layer: v.layer,
    layer_label: TEMPLATE_LAYERS[v.layer]?.label || v.layer,
    layer_description: TEMPLATE_LAYERS[v.layer]?.description || '',
    party_roles: [...partyRolesFor(k)],
    usage_count: usage.get(k) || 0,
    last_used_at: lastUsed.get(k) || null,
  }));
}

// GET /api/admin/contracts/templates — catalog with usage counts.
// Counts come from BOTH `documents.template_name|doc_type` and
// `esign_envelopes.document_type` so usage isn't undercounted post-migration.
adminContracts.get('/templates', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  try {
    const { usage, lastUsed } = await loadTemplateUsage(sql);
    const out = buildTemplateCatalog(usage, lastUsed);
    out.sort((a, b) => (b.usage_count - a.usage_count) || a.title.localeCompare(b.title));
    return c.json(out);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// Per-row dispatch helpers — admin write actions look up `:uid` in BOTH
// tables and dispatch to the right backing store.
// ---------------------------------------------------------------------------
type ContractRowRef =
  | { source: 'documents'; row: any }
  | { source: 'esign'; row: any }
  | { source: 'pairwise_nda'; row: any }
  | { source: 'partner_deal'; row: any }
  | null;

async function findContractByUid(sql: ReturnType<typeof getSQL>, uid: string): Promise<ContractRowRef> {
  // documents.uid is 32-char hex; esign_envelopes.envelope_uuid is a 36-char
  // standard UUID with dashes. They can't collide, but we still try
  // documents first since legacy rows are more common during the
  // transition.
  const docs: any[] = await sql`SELECT * FROM documents WHERE uid = ${uid} LIMIT 1`;
  if (docs.length > 0) {
    const d = docs[0];
    if (!d.migrated_to_esign_id) return { source: 'documents', row: d };
    // Migrated — follow the back-pointer into esign_envelopes so callers
    // operate on the live row.
    const envs: any[] = await sql`SELECT * FROM esign_envelopes WHERE id = ${d.migrated_to_esign_id} LIMIT 1`;
    if (envs.length > 0) return { source: 'esign', row: envs[0] };
  }
  const envs: any[] = await sql`SELECT * FROM esign_envelopes WHERE envelope_uuid = ${uid} LIMIT 1`;
  if (envs.length > 0) return { source: 'esign', row: envs[0] };

  // Task #3 — synthetic uids for the union's two non-document sources.
  // Pairwise NDAs and partner deals don't have a natural per-row uid
  // (the table holds a relationship, not a stored agreement file), so
  // we synthesise `pairwise:<id>` / `partner_deal:<id>`. Detail/list
  // resolve these; download/resend/void return deterministic 4xx since
  // there's no signed PDF or single recipient to act on.
  const pwMatch = uid.match(/^pairwise:(\d+)$/);
  if (pwMatch) {
    try {
      const rows: any[] = await sql`
        SELECT p.*, ua.email AS party_a_email, ub.email AS party_b_email
          FROM pairwise_ndas p
          LEFT JOIN users ua ON ua.id = p.party_a_user_id
          LEFT JOIN users ub ON ub.id = p.party_b_user_id
         WHERE p.id = ${Number(pwMatch[1])} LIMIT 1
      `;
      if (rows.length > 0) return { source: 'pairwise_nda', row: rows[0] };
    } catch { /* table missing on older D1 */ }
  }
  const pdMatch = uid.match(/^partner_deal:(\d+)$/);
  if (pdMatch) {
    try {
      const rows: any[] = await sql`
        SELECT d.*, u.email AS partner_email, u.name AS partner_name
          FROM partner_deals d
          LEFT JOIN users u ON u.id = d.user_id
         WHERE d.id = ${Number(pdMatch[1])} LIMIT 1
      `;
      if (rows.length > 0) return { source: 'partner_deal', row: rows[0] };
    } catch { /* table missing on older D1 */ }
  }
  return null;
}

// Task #19 — Look up the most recent recorded void reason for a given
// contract uid by scanning activity_logs.details JSON. Returns null when
// no `contract_voided` event has been logged (or the row predates the
// reason field). Best-effort — never throws.
async function loadVoidReason(
  sql: ReturnType<typeof getSQL>,
  matchKey: 'uid' | 'envelope_uuid',
  matchVal: string,
): Promise<{ reason: string; voided_at: string | null } | null> {
  try {
    const rows: any[] = await sql.unsafe(
      `SELECT details, created_at FROM activity_logs
        WHERE action = 'contract_voided'
          AND json_valid(details) = 1
          AND json_extract(details, '$.${matchKey}') = ?
        ORDER BY id DESC LIMIT 1`,
      [matchVal],
    );
    if (!rows[0]) return null;
    const parsed = JSON.parse(rows[0].details || '{}');
    if (!parsed?.reason) return null;
    return { reason: String(parsed.reason), voided_at: rows[0].created_at || null };
  } catch (e) {
    console.warn('[admin_contracts] void reason lookup skipped:', (e as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Task #5 (Z) — Pairwise NDAs tab (literal path BEFORE /:uid).
// ---------------------------------------------------------------------------
adminContracts.get('/pairwise-ndas', async (c) => {
  await requireAdmin(c);
  let page;
  try { page = contractPage(c.req.query()); }
  catch { return c.json({ error: 'invalid_picker_query' }, 400); }
  const statusFilter = (c.req.query('status') || '').toLowerCase();
  const intermediaryFilter = (c.req.query('intermediary') || '').toLowerCase();
  const sql = getSQL(c.env);
  try {
    let rows: any[] = [];
    try {
      rows = await sql`
        SELECT p.id, p.party_a_user_id, p.party_b_user_id, p.intermediary,
               p.nda_envelope_uuid, p.status, p.valid_until,
               p.created_at, p.updated_at,
               ua.email AS party_a_email, ua.name AS party_a_name,
               ub.email AS party_b_email, ub.name AS party_b_name,
               e.envelope_uuid AS envelope_uuid, e.status AS envelope_status
          FROM pairwise_ndas p
          LEFT JOIN users ua ON ua.id = p.party_a_user_id
          LEFT JOIN users ub ON ub.id = p.party_b_user_id
          LEFT JOIN esign_envelopes e ON e.envelope_uuid = p.nda_envelope_uuid
         ORDER BY p.updated_at DESC, p.id DESC
      `;
    } catch (e) {
      console.warn('[admin_contracts] pairwise_ndas query failed', e);
      return c.json({ error: 'NDAs are unreadable. Try again.', code: 'ndas_unreadable' }, 503);
    }
    if (statusFilter) rows = rows.filter(r => String(r.status || '').toLowerCase() === statusFilter);
    if (intermediaryFilter) rows = rows.filter(r => String(r.intermediary || '').toLowerCase() === intermediaryFilter);
    if (page.q) rows = rows.filter(r => [r.party_a_name,r.party_b_name,r.party_a_email,r.party_b_email].some(v => String(v || '').toLowerCase().includes(page.q.toLowerCase())));
    return c.json({ items: rows.slice(page.offset, page.offset + page.limit), total: rows.length, ...page });
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// Task #5 (Z) — Partner Deals tab (literal path BEFORE /:uid).
// ---------------------------------------------------------------------------
adminContracts.get('/partner-deals', async (c) => {
  await requireAdmin(c);
  let page;
  try { page = contractPage(c.req.query()); }
  catch { return c.json({ error: 'invalid_picker_query' }, 400); }
  const dealType = (c.req.query('deal_type') || '').toLowerCase();
  const statusFilter = (c.req.query('status') || '').toLowerCase();
  const sql = getSQL(c.env);
  try {
    let rows: any[] = [];
    try {
      rows = await sql`
        SELECT d.id, d.user_id AS partner_user_id, d.deal_type, d.term_months,
               d.granted_tier_founder, d.granted_tier_investor,
               d.status, d.created_at, d.expires_at,
               u.email AS partner_email, u.name AS partner_name,
               (SELECT COUNT(*) FROM partner_referral_redemptions r
                 WHERE r.partner_deal_id = d.id) AS redemption_count
          FROM partner_deals d
          LEFT JOIN users u ON u.id = d.user_id
         ORDER BY u.name COLLATE NOCASE, d.id
      `;
    } catch (e: any) {
      console.error('admin partner-deals:', e?.message);
      return c.json({ error: 'Partner deals are unreadable. Try again.', code: 'partner_deals_unreadable' }, 503);
    }
    if (dealType) rows = rows.filter(r => String(r.deal_type || '').toLowerCase() === dealType);
    if (statusFilter) rows = rows.filter(r => String(r.status || '').toLowerCase() === statusFilter);
    if (page.q) rows = rows.filter(r => [r.partner_name,r.partner_email].some(v => String(v || '').toLowerCase().includes(page.q.toLowerCase())));
    const items = rows.map(r => ({
      ...r,
      granted_tiers: [r.granted_tier_founder, r.granted_tier_investor].filter(Boolean).join(', ') || null,
    }));
    return c.json({ items: items.slice(page.offset, page.offset + page.limit), total: items.length, ...page });
  } finally {
    await sql.end();
  }
});

// GET /api/admin/contracts/:uid — detail (UNION-aware).
adminContracts.get('/:uid/history', async (c) => {
  const admin = await requireAdmin(c);
  const sql = getSQL(c.env);
  try {
    const ref = await findContractByUid(sql, c.req.param('uid'));
    if (!ref) return c.json({ error: 'Contract not found' }, 404);
    if (ref.source !== 'esign') return c.json({ parties: [], timeline: [], reason: 'This store does not record an envelope signing timeline or its parties.' });
    if (!isSuperAdmin(admin) && ref.row.created_by !== admin.id) return c.json({ error: 'Super admin required' }, 403);
    const sender = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(ref.row.created_by).first();
    const parties = await c.env.DB.prepare(`SELECT recipient_name AS name, recipient_email AS email,
      status, signed_at, signer_ip FROM esign_recipients WHERE envelope_id = ? ORDER BY id`).bind(ref.row.id).all();
    // Project named audit fields; legacy metadata can contain signing links.
    const events = await c.env.DB.prepare(`SELECT ts,
      CASE WHEN action='envelope_created' AND CASE WHEN json_valid(meta)=1 THEN json_extract(meta, '$.provider') END = 'docusign'
        THEN 'provider_sent' ELSE action END AS action, signer_email, ip FROM esign_audit_events
      WHERE envelope_id = ? ORDER BY ts, id`).bind(ref.row.id).all();
    const voids = await c.env.DB.prepare(`SELECT created_at AS ts, json_extract(details, '$.reason') AS reason
      FROM activity_logs WHERE action='contract_voided' AND json_valid(details)=1
      AND json_extract(details, '$.envelope_uuid') = ? ORDER BY id`).bind(ref.row.envelope_uuid).all();
    const resends = await c.env.DB.prepare(`SELECT created_at AS ts, 'email_resent' AS action FROM activity_logs
      WHERE action='contract_resent' AND json_valid(details)=1
      AND json_extract(details, '$.email_sent')=1 AND json_extract(details, '$.envelope_uuid')=? ORDER BY id`).bind(ref.row.envelope_uuid).all();
    const timeline = [...(events.results || []), ...(resends.results || [])].sort((a, b) => Date.parse(String(a.ts)) - Date.parse(String(b.ts)));
    return c.json({ sender, parties: parties.results || [], timeline, voids: voids.results || [] });
  } catch {
    return c.json({ error: 'Signing history is unreadable. Try again.', code: 'history_unreadable' }, 503);
  } finally { await sql.end(); }
});

// GET /:uid/files — D711: every file the registry holds for an envelope.
// Gated like /:uid/signed-pdf. Ids, hashes, sizes and codes only: never the
// storage key, a name or an email. `signer` is the recipient's 1-based
// position in `ORDER BY id`, the order of /:uid/history.
adminContracts.get('/:uid/files', async (c) => {
  const admin = await requireAdmin(c);
  const sql = getSQL(c.env);
  try {
    const ref = await findContractByUid(sql, c.req.param('uid'));
    if (!ref) return c.json({ error: 'Contract not found' }, 404);
    if (ref.source !== 'esign') return c.json({ files: [], reason: 'This store does not record rendered files.' });
    if (!isSuperAdmin(admin) && ref.row.created_by !== admin.id) return c.json({ error: 'Super admin required' }, 403);
    const recipients = await c.env.DB.prepare('SELECT id FROM esign_recipients WHERE envelope_id = ? ORDER BY id').bind(ref.row.id).all<{ id: number }>();
    const position = new Map((recipients.results || []).map((r, i) => [r.id, i + 1]));
    const rows = await c.env.DB.prepare(`SELECT kind, recipient_id, renderer, page_size, file_sha256, file_bytes, created_at, r2_key
      FROM legal_document_files WHERE envelope_id = ? ORDER BY created_at, id`).bind(ref.row.id).all<{
      kind: string; recipient_id: number | null; renderer: string; page_size: string | null; file_sha256: string;
      file_bytes: number; created_at: string; r2_key: string | null }>();
    const files = [];
    for (const r of rows.results || []) {
      let stored = false;
      if (r.r2_key && c.env.FILES) {
        try { stored = !!(await c.env.FILES.head(r.r2_key)); } catch { stored = false; }
      }
      files.push({
        kind: r.kind, renderer: r.renderer, page_size: r.page_size, sha256: r.file_sha256, bytes: r.file_bytes,
        created_at: r.created_at, stored, signer: r.recipient_id != null ? position.get(r.recipient_id) ?? null : null,
      });
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ files });
  } catch (e) {
    return refuse(c, 503, { code: 'files_unreadable', message: 'The file list is unreadable. Try again.', raw: e });
  } finally { await sql.end(); }
});

adminContracts.get('/:uid/signed-pdf', async (c) => {
  const admin = await requireAdmin(c);
  const sql = getSQL(c.env);
  try {
    const ref = await findContractByUid(sql, c.req.param('uid'));
    if (!ref) return c.json({ error: 'Contract not found' }, 404);
    if (ref.source === 'esign' && !isSuperAdmin(admin) && ref.row.created_by !== admin.id) return c.json({ error: 'Super admin required' }, 403);
    const key = ref.source === 'esign' && ref.row.status === 'completed' ? ref.row.signed_r2_key
      : ref.source === 'documents' && ref.row.status === 'signed' && ref.row.file_content_type === 'application/pdf' ? ref.row.file_key : null;
    if (!key) return c.json({ available: false, reason: 'This contract has no recorded signed PDF.' });
    if (typeof key !== 'string' || !/^(contracts?|esign|documents)\//.test(key)) return c.json({ error: 'invalid_storage_key' }, 400);
    if (!c.env.FILES) return c.json({ error: 'Signed PDF is unreadable. Try again.' }, 503);
    const object = await c.env.FILES.get(key);
    if (!object || object.size > 10 * 1024 * 1024) return c.json({ error: 'Signed PDF is unreadable. Try again.' }, 503);
    let bytes: Uint8Array | null = new Uint8Array(await object.arrayBuffer());
    if (key.endsWith('.enc')) {
      const { decryptBytes } = await import('../services/cryptoBox');
      bytes = await decryptBytes(c.env, bytes);
    }
    if (!bytes || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') return c.json({ error: 'Signed PDF is unreadable. Try again.' }, 503);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    c.header('Cache-Control', 'no-store');
    return c.json({ available: true, pdf_base64: btoa(binary), sha256: await sha256HexBytes(bytes) });
  } catch {
    return c.json({ error: 'Signed PDF is unreadable. Try again.', code: 'signed_pdf_unreadable' }, 503);
  } finally { await sql.end(); }
});

adminContracts.get('/:uid', async (c) => {
  await requireAdmin(c);
  const uid = c.req.param('uid') ?? '';
  const sql = getSQL(c.env);
  try {
    const ref = await findContractByUid(sql, uid);
    if (!ref) return c.json({ error: 'Contract not found' }, 404);

    if (ref.source === 'documents') {
      const d = ref.row;
      let projName: string | null = null;
      let founderEmail: string | null = null;
      if (d.project_id) {
        const pr: any[] = await sql`
          SELECT p.name, f.email AS founder_email
            FROM projects p
            LEFT JOIN founders f ON f.id = p.founder_id
           WHERE p.id = ${d.project_id}
           LIMIT 1
        `;
        if (pr[0]) { projName = pr[0].name; founderEmail = pr[0].founder_email; }
      }
      const detail = decorateDocType(enrichDocRow(d, projName, founderEmail)) as any;
      if (String(d.status || '').toLowerCase() === 'void') {
        const vr = await loadVoidReason(sql, 'uid', d.uid);
        if (vr) { detail.void_reason = vr.reason; detail.voided_at = vr.voided_at; }
      }
      return c.json(detail);
    }

    // Task #3 — pairwise + partner_deal synthetic uids return the
    // already-enriched unified row directly (no second query needed
    // because findContractByUid already JOINed users).
    if (ref.source === 'pairwise_nda') {
      // Re-run the same loader path so the response shape matches list rows.
      const r = ref.row;
      const docType = 'nda_3way_founder_investor_axal';
      const detail = decorateDocType({
        id: r.id,
        uid: r.nda_envelope_uuid || `pairwise:${r.id}`,
        title: `Pairwise NDA — ${r.party_a_email || '?'} ↔ ${r.party_b_email || '?'}`,
        doc_type: docType,
        status: mapPairwiseStatus(r.status),
        template_name: 'pairwise_nda',
        project_id: null,
        project_name: r.intermediary ? `intermediary: ${r.intermediary}` : null,
        recipient_email: r.party_b_email || r.party_a_email || null,
        signed_by: null,
        signed_at: mapPairwiseStatus(r.status) === 'signed' ? (r.updated_at || null) : null,
        signed_ip: null,
        days_to_sign: null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        file_key: null, file_size: null, file_content_type: null, file_sha256: null,
        source: 'pairwise_nda',
        raw_status: String(r.status || '').toLowerCase(),
        can_resend: false,
      } as any);
      return c.json(detail);
    }
    if (ref.source === 'partner_deal') {
      const r = ref.row;
      const dt = `partner_${String(r.deal_type || 'custom').toLowerCase()}`;
      const docType = TEMPLATES[dt] ? dt : 'partner_custom';
      const unified = mapPartnerDealStatus(r.status);
      const detail = decorateDocType({
        id: r.id,
        uid: `partner_deal:${r.id}`,
        title: `${TEMPLATES[docType]?.title || 'Partner Deal'} — ${r.partner_email || r.partner_name || 'unknown'}`,
        doc_type: docType,
        status: unified,
        template_name: docType,
        project_id: null,
        project_name: null,
        recipient_email: r.partner_email || null,
        signed_by: unified === 'signed' ? (r.partner_name || r.partner_email || null) : null,
        signed_at: unified === 'signed' ? (r.updated_at || null) : null,
        signed_ip: null,
        days_to_sign: null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        file_key: null, file_size: null, file_content_type: null, file_sha256: null,
        source: 'partner_deal',
        raw_status: String(r.status || '').toLowerCase(),
        can_resend: false,
      } as any);
      return c.json(detail);
    }

    // esign source — re-query with the recipient subselects so the detail
    // payload matches list shape.
    const envRows: any[] = await sql`
      SELECT
        e.id, e.envelope_uuid, e.user_id, e.deal_id, d.project_id, p.name AS project_name,
        e.document_type, e.document_title,
        e.status, e.provider, e.created_at, e.completed_at, e.signed_r2_key,
        (SELECT recipient_email FROM esign_recipients WHERE envelope_id = e.id ORDER BY id ASC LIMIT 1) AS recipient_email,
        (SELECT recipient_name  FROM esign_recipients WHERE envelope_id = e.id ORDER BY id ASC LIMIT 1) AS recipient_name,
        (SELECT recipient_name  FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed' ORDER BY signed_at DESC LIMIT 1) AS signer_name,
        (SELECT signer_ip       FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed' ORDER BY signed_at DESC LIMIT 1) AS signer_ip,
        (SELECT MAX(signed_at)  FROM esign_recipients WHERE envelope_id = e.id) AS last_signed_at
      FROM esign_envelopes e
      LEFT JOIN deals d ON d.id = e.deal_id
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE e.id = ${ref.row.id} LIMIT 1
    `;
    if (!envRows[0]) return c.json({ error: 'Contract not found' }, 404);
    const detail = decorateDocType(enrichEsignRow(envRows[0])) as any;
    if (detail.status === 'void') {
      const vr = await loadVoidReason(sql, 'envelope_uuid', envRows[0].envelope_uuid || '');
      if (vr) { detail.void_reason = vr.reason; detail.voided_at = vr.voided_at; }
    }
    // Task #5 (Z) — surface DD linkage so the modal can render an
    // "Open in DD" button. Best-effort: empty if column not yet
    // present (migration 026 not applied).
    try {
      const f: any[] = await sql`
        SELECT f.case_id, c.uid AS case_uid, COUNT(*) AS findings_count
          FROM dd_findings f
          JOIN dd_cases c ON c.id = f.case_id
         WHERE f.esign_envelope_uuid = ${envRows[0].envelope_uuid || ''}
           AND f.resolved_at IS NULL
         GROUP BY f.case_id, c.uid
         ORDER BY findings_count DESC LIMIT 1
      `;
      if (f[0]) {
        (detail as any).dd_case_uid = f[0].case_uid;
        (detail as any).dd_case_id = f[0].case_id;
        (detail as any).dd_findings_count = Number(f[0].findings_count) || 0;
      }
    } catch (e) {
      console.warn('[admin_contracts] dd link lookup skipped:', (e as Error).message);
    }
    return c.json(detail);
  } finally {
    await sql.end();
  }
});

// POST /api/admin/contracts/:uid/resend — UNION dispatch.
adminContracts.post('/:uid/resend', async (c) => {
  const adminUser = await requireAdmin(c);
  const uid = c.req.param('uid') ?? '';
  const sql = getSQL(c.env);
  try {
    const ref = await findContractByUid(sql, uid);
    if (!ref) return c.json({ error: 'Contract not found' }, 404);

    // Task #3 — the union's pairwise + partner_deal sources have no
    // single recipient or signing token, so resend is not meaningful.
    // Return a deterministic 400 (action_not_supported) so the UI can
    // surface a clear toast instead of a 500.
    if (ref.source === 'pairwise_nda' || ref.source === 'partner_deal') {
      return c.json(
        { error: 'Resend is not supported for this contract source', source: ref.source },
        400,
      );
    }

    // Task #5 (Z) — tighten resend to "sent / viewed only" per spec.
    // For documents-source rows, only `sent` qualifies (legacy table
    // never tracked viewed). For esign-source, allow `sent` + `viewed`.
    if (ref.source === 'documents') {
      const d = ref.row;
      const dStatus = String(d.status).toLowerCase();
      if (dStatus !== 'sent') {
        return c.json({ error: `Resend only allowed for status='sent' (current: ${dStatus})` }, 400);
      }
      await sql`UPDATE documents SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE uid = ${d.uid}`;
      await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('contract_resent', ${`Admin ${adminUser.name} resent contract '${d.title}'`}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
      const updated: any[] = await sql`SELECT * FROM documents WHERE uid = ${d.uid} LIMIT 1`;
      return c.json({ ok: true, contract: enrichDocRow(updated[0], null, null) });
    }

    // esign source — re-email the pending recipient with their existing
    // signing URL. If their token has expired, mint a fresh 7-day token.
    const env = ref.row;
    const eStatus = String(env.status).toLowerCase();
    if (eStatus !== 'sent' && eStatus !== 'viewed') {
      return c.json({ error: `Resend only allowed for status in ('sent','viewed') (current: ${eStatus})` }, 400);
    }
    const recRows: any[] = await sql`
      SELECT id, recipient_email, recipient_name, signing_token, token_expires_at
        FROM esign_recipients
       WHERE envelope_id = ${env.id} AND status = 'pending'
       ORDER BY id ASC LIMIT 1
    `;
    if (!recRows[0]) return c.json({ error: 'No pending recipient to resend to' }, 400);
    const rec = recRows[0];
    let token = rec.signing_token;
    if (new Date(rec.token_expires_at).getTime() < Date.now()) {
      // Mint a fresh token + extend expiry.
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await sql`UPDATE esign_recipients SET signing_token = ${token}, token_expires_at = ${newExpiry} WHERE id = ${rec.id}`;
    }
    const appUrl = (c.env as any).APP_URL || 'https://axal.vc';
    const signingUrl = `${appUrl}/esign/${token}`;
    const emailSent = await sendAgreementAssignedEmail(
      c.env,
      rec.recipient_email,
      rec.recipient_name || rec.recipient_email,
      env.document_title,
      signingUrl,
      adminUser.name || adminUser.email,
    );
    await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('contract_resent', ${JSON.stringify({ envelope_id: env.id, envelope_uuid: env.envelope_uuid, email_sent: emailSent })}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
    return c.json({ ok: true, email_sent: emailSent });
  } finally {
    await sql.end();
  }
});

// POST /api/admin/contracts/:uid/void — UNION dispatch.
// Task #5 (Z): now requires a free-text `reason` (>=5 chars) and mirrors
// the void into `dd_audit_log` when the envelope is referenced by any
// open dd_findings row (so the diligence audit trail captures it).
adminContracts.post('/:uid/void', async (c) => {
  // Task #6 — voiding a contract is irreversible from the recipient's POV
  // (their magic link stops working). Gate on TOTP step-up.
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
  const adminUser = await requireAdmin(c);
  const uid = c.req.param('uid') ?? '';
  const body = await c.req.json().catch(() => ({} as any));
  const reason = String(body?.reason || '').trim();
  if (reason.length < 5) {
    return c.json({ error: 'A void reason of at least 5 characters is required.' }, 400);
  }
  const sql = getSQL(c.env);
  try {
    const ref = await findContractByUid(sql, uid);
    if (!ref) return c.json({ error: 'Contract not found' }, 404);

    // Task #3 — pairwise NDAs are voided through the pair-management
    // surface (admin_pairwise_ndas) and partner_deals through
    // admin_partner_deals, both of which have their own audit + side-
    // effect handling. Refuse here with a deterministic 400 so the
    // contracts UI never silently mis-routes a void.
    if (ref.source === 'pairwise_nda' || ref.source === 'partner_deal') {
      return c.json(
        { error: 'Void is not supported for this contract source from the contracts list', source: ref.source },
        400,
      );
    }

    let envelopeUuid: string | null = null;

    if (ref.source === 'documents') {
      const d = ref.row;
      if (String(d.status).toLowerCase() === 'signed') {
        return c.json({ error: 'Cannot void a signed contract' }, 400);
      }
      await sql`UPDATE documents SET status = 'void', updated_at = CURRENT_TIMESTAMP WHERE uid = ${d.uid}`;
      const detail = JSON.stringify({ uid: d.uid, title: d.title, reason });
      await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('contract_voided', ${detail}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
    } else {
      // esign — mark envelope void + cancel any pending recipients so their
      // magic links stop working. Audit row references envelope id, never
      // the recipient email (T22.1 hashed-actor convention).
      const env = ref.row;
      if (String(env.status).toLowerCase() === 'completed') {
        return c.json({ error: 'Cannot void a signed contract' }, 400);
      }
      envelopeUuid = env.envelope_uuid;
      await sql`UPDATE esign_envelopes SET status = 'void' WHERE id = ${env.id}`;
      await sql`UPDATE esign_recipients SET status = 'rejected' WHERE envelope_id = ${env.id} AND status = 'pending'`;
      const detail = JSON.stringify({
        envelope_id: env.id, envelope_uuid: env.envelope_uuid,
        title: env.document_title, reason,
      });
      await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('contract_voided', ${detail}, ${await hashEmail(adminUser.email)}, ${adminUser.id})`;
    }

    // Task #5 (Z) — mirror to dd_audit_log when this envelope is linked
    // to any due-diligence findings. The link is via the new
    // dd_findings.esign_envelope_uuid column (migration 026); when no
    // matching findings exist we silently skip — there's no DD context
    // to audit against.
    if (envelopeUuid) {
      try {
        // Task #5 (Z) v2 — only mirror to dd_audit_log for OPEN findings
        // (resolved_at IS NULL). Resolved findings are historical and
        // shouldn't be re-touched by a contract void event.
        const findings: any[] = await sql`
          SELECT DISTINCT case_id FROM dd_findings
           WHERE esign_envelope_uuid = ${envelopeUuid}
             AND resolved_at IS NULL
        `;
        for (const row of findings) {
          await c.env.DB.prepare(
            `INSERT INTO dd_audit_log (case_id, actor_user_id, actor_email_hash, action, target_type, target_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(
            row.case_id, adminUser.id, await hashEmail(adminUser.email),
            'contract_voided', 'envelope', null,
          ).run();
        }
      } catch (e) {
        // dd_findings may lack the column on environments where 026
        // hasn't been applied — log and continue rather than fail the
        // void.
        console.warn('[admin_contracts] dd_audit_log mirror skipped:', (e as Error).message);
      }
    }

    return c.json({ ok: true, reason });
  } finally {
    await sql.end();
  }
});

// Task #1 (security hardening) — Contract download is backed by the shared
// one-time signed-URL primitive (`services/signedDownload.ts` →
// `routes/files.ts:/api/files/dl/:token`). The R2 bucket itself is private;
// admins receive a 5-minute, single-use token that audits each download.
//
// Task #2 — `file_key` is sourced from documents.file_key OR
// esign_envelopes.signed_r2_key (which begins with `esign/signed/` and is
// already in the prefix allowlist).
async function mintContractDownload(c: AppContext): Promise<ContractDownloadResult> {
  const adminUser = await requireAdmin(c);
  const uid = c.req.param('uid') ?? '';
  const sql = getSQL(c.env);
  try {
    const ref = await findContractByUid(sql, uid);
    if (!ref) return { error: c.json({ error: 'Contract not found' }, 404) };

    let fileKey: string | null;
    let title: string;
    if (ref.source === 'documents') {
      fileKey = ref.row.file_key || null;
      title = ref.row.title;
    } else if (ref.source === 'esign') {
      fileKey = ref.row.signed_r2_key || null;
      title = ref.row.document_title;
    } else {
      // Task #3 — pairwise + partner_deal have no stored PDF artefact.
      // Return a deterministic 404 (no_file) so the UI's download
      // button can disable cleanly.
      return { error: c.json({ error: 'Contract has no stored file yet', source: ref.source }, 404) };
    }

    if (!fileKey) return { error: c.json({ error: 'Contract has no stored file yet' }, 404) };
    if (typeof fileKey !== 'string' || !/^contracts?\/|^esign\/|^documents\//.test(fileKey)) {
      // Defence-in-depth: refuse to mint a token for an unexpected R2 prefix
      // so a future bug that lets `file_key` be set arbitrarily can't be
      // pivoted into reading other buckets.
      return { error: c.json({ error: 'Invalid document storage key' }, 400) };
    }
    const minted = await mintDownloadToken(c.env, {
      key: fileKey,
      ttlSec: 300,
      audience: 'admin_contract',
      userId: adminUser.id,
    });
    try {
      await sql`INSERT INTO activity_logs (action, details, actor, user_id)
                VALUES ('contract_download_url_issued',
                        ${JSON.stringify({ uid, title, source: ref.source, expires_at: minted.expires_at })},
                        ${await hashEmail(adminUser.email)},
                        ${adminUser.id})`;
    } catch (e) { console.error('[admin_contracts] audit log failed', e); }
    return { ok: { url: `/api/files/dl/${minted.token}`, expires_at: minted.expires_at } };
  } finally {
    await sql.end();
  }
}

adminContracts.get('/:uid/download', async (c) => {
  const r = await mintContractDownload(c);
  if (r.error) return r.error;
  return c.redirect(r.ok.url, 302);
});

adminContracts.post('/:uid/download-url', async (c) => {
  const r = await mintContractDownload(c);
  if (r.error) return r.error;
  return c.json(r.ok);
});

// ---------------------------------------------------------------------------
// Task #5 (Z) — Legal templates catalog.
// Lists the static markdown templates shipped under
// `cloudflare-worker/src/templates/legal/*.md` so the admin
// "Create envelope" wizard can pick from them. Templates ARE NOT
// rendered server-side here (the wizard just needs key/title/doc_type
// to pre-fill the e-sign send form).
// ---------------------------------------------------------------------------
const LEGAL_TEMPLATE_CATALOG: ReadonlyArray<{
  key: string;
  doc_type: string;
  title: string;
}> = [
  { key: 'tos_v1',                            doc_type: 'tos_v1',                            title: 'Terms of Service v1' },
  { key: 'privacy_v1',                        doc_type: 'privacy_v1',                        title: 'Privacy Policy v1' },
  { key: 'founder_nda_v1',                    doc_type: 'founder_nda_v1',                    title: 'Founder Mutual NDA v1' },
  { key: 'investor_nda_v1',                   doc_type: 'investor_nda_axal',                 title: 'Investor NDA (Axal) v1' },
  { key: 'mentor_nda_v1',                     doc_type: 'mentor_nda_axal',                   title: 'Advisor NDA (Axal) v1' },
  { key: 'mentor_disclaimer_v1',              doc_type: 'mentor_engagement_disclaimer',     title: 'Advisor Engagement Disclaimer v1' },
  { key: 'accreditation_v1',                  doc_type: 'accreditation_v1',                  title: 'Accreditation Attestation v1' },
  { key: 'partner_msa_v1',                    doc_type: 'partner_services',                  title: 'Partner Services / MSA v1' },
  { key: 'nda_3way_founder_investor_axal_v1', doc_type: 'nda_3way_founder_investor_axal',   title: '3-Way NDA (Founder ↔ Investor ↔ Axal) v1' },
];

// D717 decision 6: the bundled keys whose text is not the store body of the
// row they count under. Read-only; the thumbnails come with PR 1b.
adminContracts.get('/templates/outside', async (c) => {
  await requireAdmin(c);
  const outside = LEGAL_TEMPLATE_CATALOG.filter(e => e.key !== e.doc_type);
  try {
    const items = await Promise.all(outside.map(async (e) => {
      const row = await storeGetTemplate(c.env, e.doc_type);
      return { key: e.key, title: e.title, doc_type: e.doc_type, counted_under: { slug: e.doc_type, title: row?.title ?? null } };
    }));
    return c.json({ items });
  } catch {
    return c.json({ error: 'Templates are unreadable. Try again.', code: 'templates_unreadable' }, 503);
  }
});

adminContracts.get('/templates/legal', async (c) => {
  await requireAdmin(c);
  return c.json({ items: LEGAL_TEMPLATE_CATALOG });
});

// ---------------------------------------------------------------------------
// Task #8 — Worker-owned (D1) legal template STORE (canonical, editable).
// Distinct from the legacy `/templates` (static catalog + usage grid) and
// `/templates/legal` (e-sign wizard picker), which stay intact. The store
// is the new source of truth for prod doc-generation + e-sign rendering.
// All routes require admin; soft-delete additionally requires a recent
// step-up factor. Sub-paths fall under the existing `/api/admin/contracts`
// mount, so no API-drift allowlist change is needed.
// ---------------------------------------------------------------------------

// GET /templates/store?category= — full catalog (active rows), decorated
// with usage_count + last_used_at from the same union the grid uses, so
// cards keep their usage badge and the TemplateUsageModal still works.
adminContracts.get('/templates/store', async (c) => {
  await requireAdmin(c);
  const category = c.req.query('category') || undefined;
  const items = await storeListTemplates(c.env, category);

  const sql = getSQL(c.env);
  try {
    const { usage, lastUsed } = await loadTemplateUsage(sql, c.req.query('recorded') === 'true');
    const publications = c.req.query('recorded') === 'true' ? new Map((await publishedContractTemplates(c.env)).map(t => [t.slug, t])) : null;

    const out = items.map((t) => ({
      ...t,
      layer: t.category,
      layer_label: TEMPLATE_LAYERS[t.category]?.label || t.category,
      usage_count: usage.get(t.slug) || 0,
      last_used_at: lastUsed.get(t.slug) || null,
      ...formatView(t),
      ...(publications ? { published_version: publications.get(t.slug)?.version ?? null,
        has_unpublished_changes: publications.has(t.slug) ? !!t.is_stub || !t.body_md.trim() || publications.get(t.slug)?.version !== t.version
          : !t.is_stub && !!t.body_md.trim() } : {}),
    }));
    return c.json({ items: out, total: out.length });
  } catch {
    return c.json({ error: 'Templates or their usage are unreadable. Try again.', code: 'templates_unreadable' }, 503);
  } finally {
    await sql.end();
  }
});

// POST /templates/store — create a new template (slug must be unique).
//
// D106 — HQ authors the master library; a branch reads the copy HQ pushed
// (D.9). `requireHqAuthoring` is `requireAdmin` plus that refusal, so nothing
// changes for an HQ admin.
adminContracts.post('/templates/store', async (c) => {
  const admin = await requireHqAuthoring(c);
  const body = await c.req.json<{ slug?: string; title?: string; category?: string; body_md?: string; doc_kind?: unknown; axal_party?: unknown }>();
  try {
    const tpl = await storeCreateTemplate(
      c.env,
      { slug: String(body.slug || ''), title: String(body.title || ''), category: String(body.category || ''), body_md: body.body_md,
        doc_kind: body.doc_kind, axal_party: body.axal_party },
      admin.id,
    );
    return c.json({ template: { ...tpl, ...formatView(tpl) } }, 201);
  } catch (e) {
    if (e instanceof TemplateError) return c.json({ error: e.message, code: e.code }, e.status);
    throw e;
  }
});

// POST /templates/publish — push the master library to every branch (D147).
//
// THE PUSH IS REPORTED, NEVER THROWN — D111's rule, and the same shape
// `admin_escalations.ts` uses for an answer and `admin_licences.ts` for a
// licence transition. HQ's library is HQ's whether or not a branch answered,
// and a 502 for one unreachable branch would tell an operator that a push to
// the other three did not happen.
//
// WHAT IT SENDS IS EXACTLY WHAT HQ'S OWN LIBRARY SHOWS. `storeListTemplates`
// filters `is_active = 1`, so an archived template is absent from the push and
// the branch withdraws it at the next one. No body travels: nothing on a branch
// renders or instantiates one (migration 268 says why), so this is a catalogue.
//
// ZERO BRANCHES IS A REAL ANSWER. `fanOut` over an env with no `BRANCH_*`
// binding returns `[]`, and this returns `branches: []` with `pushed: 0` — which
// is true, and is what an operator sees today.
adminContracts.post('/templates/publish', async (c) => {
  const admin = await requireHqAuthoring(c);
  const templates = await storeListTemplates(c.env);
  const pushed_at = new Date().toISOString();
  const payload = {
    templates: templates.map((t) => ({
      slug: t.slug, title: t.title, category: t.category, version: t.version,
    })),
    pushed_at,
  };

  const results = await fanOut<{ ok: true; stored: number; withdrawn: number }>(
    c.env, 'publishTemplate', [payload],
  );

  return c.json({
    ok: true,
    pushed_at,
    template_count: payload.templates.length,
    pushed_by: admin.id,
    // One row per branch in `services/branches.ts`'s THREE states, never two:
    // `unreadable` is not a claim that the branch is down, and `not_deployed`
    // must not share its colour.
    branches: results.map((r) => ({
      code: r.code,
      status: r.status,
      ...(r.data ? { stored: r.data.stored, withdrawn: r.data.withdrawn } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
    })),
    answered: results.filter((r) => r.status === 'ok').length,
    total: results.length,
    ...(results.length ? {} : {
      branches_reason:
        'No branch Worker is bound to HQ yet, so the library was not pushed anywhere. It will '
        + 'reach a branch the first time one is provisioned and this is run again.',
    }),
  });
});

// GET /templates/store/:slug — single template (full body + merge fields).
adminContracts.get('/templates/store/:slug', async (c) => {
  await requireAdmin(c);
  const slug = c.req.param('slug');
  const tpl = await storeGetTemplate(c.env, slug);
  if (!tpl) return c.json({ error: 'Template not found', code: 'not_found', slug }, 404);
  return c.json({
    template: { ...tpl, layer: tpl.category, layer_label: TEMPLATE_LAYERS[tpl.category]?.label || tpl.category,
      ...formatView(tpl), format_options: formatOptions(tpl.slug, tpl.category) },
  });
});

// GET /templates/store/:slug/versions — read-only version history (newest first).
adminContracts.get('/templates/store/:slug/versions', async (c) => {
  await requireAdmin(c);
  const slug = c.req.param('slug');
  const res = await storeListVersions(c.env, slug);
  if (!res) return c.json({ error: 'Template not found', code: 'not_found', slug }, 404);
  return c.json(res);
});

// PUT /templates/store/:slug — edit a template. The server snapshots the
// prior row into history and bumps the version atomically.
adminContracts.put('/templates/store/:slug', async (c) => {
  const admin = await requireHqAuthoring(c);
  const slug = c.req.param('slug');
  const body = await c.req.json<{ title?: string; category?: string; body_md?: string; doc_kind?: unknown; axal_party?: unknown }>();
  try {
    const tpl = await storeUpdateTemplate(
      c.env,
      slug,
      { title: String(body.title || ''), category: String(body.category || ''), body_md: String(body.body_md ?? ''),
        doc_kind: body.doc_kind, axal_party: body.axal_party },
      admin.id,
    );
    return c.json({ template: { ...tpl, ...formatView(tpl) } });
  } catch (e) {
    if (e instanceof TemplateError) return c.json({ error: e.message, code: e.code }, e.status);
    throw e;
  }
});

// DELETE /templates/store/:slug — soft-delete (is_active = 0). Requires a
// recent step-up factor, mirroring the other destructive contract actions.
adminContracts.delete('/templates/store/:slug', async (c) => {
  const admin = await requireHqAuthoring(c);
  await requireStepUp(c);
  const slug = c.req.param('slug');
  const ok = await storeSoftDeleteTemplate(c.env, slug, admin.id);
  if (!ok) return c.json({ error: 'Template not found', code: 'not_found', slug }, 404);
  return c.json({ ok: true });
});

// GET /templates/store/:slug/preview.pdf — the template on the legal paper
// (D711), at `?page=letter|a4` and `?cover=dark|light`, its state from the
// publication. Binary endpoint — kept OUT of the typed API drift surface.
adminContracts.get('/templates/store/:slug/preview.pdf', async (c) => {
  await requireAdmin(c);
  const slug = c.req.param('slug');
  const paper = readPaperChoice(c.req.query('page'), c.req.query('cover'));
  if (!paper.ok) return refuse(c, 400, { code: paper.code, message: PAPER_CHOICE_MESSAGES[paper.code] });
  const tpl = await storeGetTemplate(c.env, slug);
  if (!tpl) return c.json({ error: 'Template not found', code: 'not_found', slug }, 404);

  // The raw body and the resolve mode go to the model: `brackets` marks each
  // known merge token as a [LABEL] run.
  const body = tpl.body_md || '';
  const bodySha = await sha256Hex(body);
  const model = paperModel({
    title: tpl.title, body, slug, category: tpl.category, version: tpl.version, bodySha256: bodySha,
    merge: c.req.query('resolve') === 'raw' ? 'raw' : 'brackets',
    // #1865 — a stub's paper says it is one (L8 learn item 2).
    stub: !!tpl.is_stub || !body.trim(),
    ...renderFormat(effectiveFormat(tpl)),
    state: paperStateFor({ version: tpl.version, bodySha256: bodySha, publication: await publicationRef(c.env, slug) }),
    structure: await structureForPaper(c.env, slug, 'preview'),
  });
  const rendered = await renderLegalPdf(c.env, model, { pageSize: paper.pageSize, cover: paper.cover });
  if (!rendered.ok) return refuse(c, 503, { code: 'preview_unrenderable', message: 'The preview could not be drawn. Try again.' });

  const filename = `${docxFilename(slug, tpl.version).replace(/\.docx$/, '')}-preview.pdf`;
  return new Response(rendered.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Axal-Renderer': rendered.renderer,
    },
  });
});

// POST /templates/render — D711: the live preview's paper, as HTML. The faces
// are left out with `fonts: 'omit'`; the page fetches them once per
// `paper_sha256` from /templates/paper-fonts.
//
// D717 (#1782): the editor's unsaved `doc_kind` and `axal_party` go with the
// body. A key that is present wins (`null`: from the slug), an absent one
// keeps the stored row's, and the pair gets the checks a save gets. The answer
// lists the body's merge fields and who fills each, so the editor keeps no
// copy of that list. POST /templates/render.pdf draws the same draft as the
// real PDF, for the editor's "Pages" view.
const RENDER_BODY_MAX = 256 * 1024;
type DraftInput = Record<string, unknown>;
type DraftPaper =
  | { ok: true; model: ReturnType<typeof paperModel>; body: string; bodySha: string; state: ReturnType<typeof paperStateFor>;
      paper: { pageSize: 'letter' | 'a4'; cover: 'dark' | 'light' } }
  | { ok: false; status: 400 | 409 | 413; code: string; message: string };

async function draftPaper(env: Env, input: DraftInput): Promise<DraftPaper> {
  const body = typeof input.body === 'string' ? input.body : '';
  if (new TextEncoder().encode(body).length > RENDER_BODY_MAX) {
    return { ok: false, status: 413, code: 'body_too_large', message: 'The body is over 256 KB, so it cannot be previewed.' };
  }
  const paper = readPaperChoice(input.page_size, input.cover);
  if (!paper.ok) return { ok: false, status: 400, code: paper.code, message: PAPER_CHOICE_MESSAGES[paper.code] };
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 300) : 'Untitled';
  const slug = typeof input.slug === 'string' ? input.slug.slice(0, 200) : '';
  const version = Number.isInteger(input.version) ? input.version as number : null;
  const stored = slug ? await storeGetTemplate(env, slug) : null;
  const category = typeof input.category === 'string' ? input.category : stored?.category ?? null;
  let pair: { doc_kind: string | null; axal_party: string | null };
  try {
    pair = resolveFormat(slug || title, category || '', input as FormatPatch,
      { doc_kind: stored?.doc_kind ?? null, axal_party: stored?.axal_party ?? null });
  } catch (e) {
    if (e instanceof TemplateError) return { ok: false, status: e.status === 409 ? 409 : 400, code: e.code, message: e.message };
    throw e;
  }
  const bodySha = await sha256Hex(body);
  const state = paperStateFor({ version, bodySha256: bodySha, publication: slug ? await publicationRef(env, slug) : null });
  const model = paperModel({
    title, body, slug: slug || title, category,
    version, bodySha256: bodySha, merge: input.resolve === 'raw' ? 'raw' : 'brackets', state,
    stub: !body.trim(),
    ...renderFormat(effectiveFormat({ slug: slug || title, category, ...pair })),
    structure: await structureForPaper(env, slug, 'preview'),
  });
  return { ok: true, model, body, bodySha, state, paper: { pageSize: paper.pageSize, cover: paper.cover } };
}

async function readDraftInput(c: Context<{ Bindings: Env }>): Promise<DraftInput | null> {
  let input: unknown;
  try { input = await c.req.json(); } catch { return null; }
  return input && typeof input === 'object' && !Array.isArray(input) ? input as DraftInput : null;
}

adminContracts.post('/templates/render', async (c) => {
  await requireAdmin(c);
  const input = await readDraftInput(c);
  if (!input) return refuse(c, 400, { code: 'invalid_request', message: 'Send the template as JSON.' });
  const d = await draftPaper(c.env, input);
  if (!d.ok) return refuse(c, d.status, { code: d.code, message: d.message });
  const html = paperHtml(d.model, { pageSize: d.paper.pageSize, cover: d.paper.cover, medium: 'screen', fonts: input.fonts === 'inline' ? 'inline' : 'omit' });
  const fields = extractMergeFields(d.body).map((key) => ({ key, filled_by: isAutoMergeKey(key) ? 'send' : 'sender' }));
  c.header('Cache-Control', 'no-store');
  return c.json({ html, body_sha256: d.bodySha, page_size: d.paper.pageSize, paper_sha256: await paperSha256(), state: stateLabel(d.state), fields });
});

// POST /templates/render.pdf — D717 decision 8: the unsaved draft as the real
// PDF, so the editor shows where pages break. A preview: no file row, never
// stored, never cached. Binary endpoint — kept OUT of the typed API drift surface.
adminContracts.post('/templates/render.pdf', async (c) => {
  await requireAdmin(c);
  const input = await readDraftInput(c);
  if (!input) return refuse(c, 400, { code: 'invalid_request', message: 'Send the template as JSON.' });
  const d = await draftPaper(c.env, input);
  if (!d.ok) return refuse(c, d.status, { code: d.code, message: d.message });
  const rendered = await renderLegalPdf(c.env, d.model, { pageSize: d.paper.pageSize, cover: d.paper.cover });
  if (!rendered.ok) return refuse(c, 503, { code: 'preview_unrenderable', message: 'The preview could not be drawn. Try again.' });
  return new Response(rendered.bytes, {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'X-Axal-Renderer': rendered.renderer },
  });
});

// GET /templates/store/:slug/thumbnail.png and /templates/outside/:key/thumbnail.png
// — D717 decision 5: page 1 of the paper as an image, drawn once per version
// by Browser Run's screenshot and kept in FILES. A new version or a new paper
// style is a new key, so an image never goes stale. A thumbnail is not a legal
// file, so it gets no legal_document_files row. On a miss that cannot be drawn
// it answers 503 `thumbnail_unavailable` and writes nothing. Binary endpoints —
// kept OUT of the typed API drift surface.
const THUMB_VIEWPORT = { width: 816, height: 1056, deviceScaleFactor: 0.5 } as const; // Letter page 1, in CSS px

async function thumbnailResponse(c: Context<{ Bindings: Env }>, key: string, html: () => Promise<string>): Promise<Response> {
  const etag = `"${key}"`;
  const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', ETag: etag };
  if (c.req.header('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  const hit = await c.env.FILES?.get(key).catch(() => null);
  if (hit) return new Response(await hit.arrayBuffer(), { status: 200, headers });
  const shot = await renderLegalPng(c.env, await html(), THUMB_VIEWPORT);
  if (!shot.ok) {
    console.warn(JSON.stringify({ event: 'legal_thumbnail_unavailable', code: shot.code }));
    return refuse(c, 503, { code: 'thumbnail_unavailable', message: 'Thumbnail not drawn: the page renderer did not answer.' });
  }
  // A failed write still serves the image; the next request draws it again.
  await c.env.FILES?.put(key, shot.bytes, { httpMetadata: { contentType: 'image/png' } }).catch(() => {});
  return new Response(shot.bytes, { status: 200, headers });
}

function thumbnailHtml(model: ReturnType<typeof paperModel>): string {
  return paperHtml(model, { pageSize: 'letter', cover: 'dark', medium: 'screen', fonts: 'inline' });
}

adminContracts.get('/templates/store/:slug/thumbnail.png', async (c) => {
  await requireAdmin(c);
  const slug = c.req.param('slug');
  const tpl = await storeGetTemplate(c.env, slug);
  if (!tpl) return c.json({ error: 'Template not found', code: 'not_found', slug }, 404);
  // A stub draws its layout with the two stub marks (paperModel's `stub`), never legal text.
  const stub = !!tpl.is_stub || !(tpl.body_md || '').trim();
  const key = `legal/thumbnails/${await sha256Hex(slug)}/v${tpl.version ?? 0}-${(await paperSha256()).slice(0, 16)}.png`;
  const bodySha = await sha256Hex(tpl.body_md || '');
  const state = paperStateFor({ version: tpl.version, bodySha256: bodySha, publication: await publicationRef(c.env, slug) });
  return thumbnailResponse(c, key, async () => thumbnailHtml(paperModel({
    title: tpl.title, body: tpl.body_md || '', slug, category: tpl.category, version: tpl.version, bodySha256: bodySha,
    merge: 'brackets', state, stub, ...renderFormat(effectiveFormat(tpl)),
    structure: await structureForPaper(c.env, slug, 'preview'),
  })));
});

adminContracts.get('/templates/outside/:key/thumbnail.png', async (c) => {
  await requireAdmin(c);
  const entry = LEGAL_TEMPLATE_CATALOG.find(e => e.key === c.req.param('key') && e.key !== e.doc_type);
  if (!entry) return c.json({ error: 'Template not found', code: 'not_found' }, 404);
  const { getLegalTemplateBody } = await import('../services/legalTemplates');
  const body = getLegalTemplateBody(entry.key as Parameters<typeof getLegalTemplateBody>[0]);
  const bodySha = await sha256Hex(body);
  // No version: the bundled body's hash names the image, so a new text is a new key.
  const key = `legal/thumbnails/outside/${await sha256Hex(entry.key)}/${bodySha.slice(0, 16)}-${(await paperSha256()).slice(0, 16)}.png`;
  return thumbnailResponse(c, key, async () => thumbnailHtml(paperModel({
    title: entry.title, body, slug: entry.doc_type, version: null, bodySha256: bodySha, merge: 'brackets', state: { kind: 'draft' },
  })));
});

// GET /templates/paper-fonts — D711: the paper's @font-face rules, fetched
// once per `paper_sha256` by the live preview.
adminContracts.get('/templates/paper-fonts', async (c) => {
  await requireAdmin(c);
  c.header('Cache-Control', 'private, max-age=86400');
  return c.json({ css: paperFontsCss(), paper_sha256: await paperSha256() });
});

// GET /templates/store/:slug/export.docx — D711: a template as Word, with a
// `docx_export` registry row. No row, no file. Binary endpoint — kept OUT of
// the typed API drift surface.
adminContracts.get('/templates/store/:slug/export.docx', async (c) => {
  const admin = await requireAdmin(c);
  const slug = c.req.param('slug');
  const paper = readPaperChoice(c.req.query('page'), 'light');
  if (!paper.ok) return refuse(c, 400, { code: paper.code, message: PAPER_CHOICE_MESSAGES[paper.code] });
  const tpl = await storeGetTemplate(c.env, slug);
  if (!tpl) return c.json({ error: 'Template not found', code: 'not_found', slug }, 404);
  const body = tpl.body_md || '';
  const bodySha = await sha256Hex(body);
  const model = paperModel({
    title: tpl.title, body, slug, category: tpl.category, version: tpl.version, bodySha256: bodySha,
    merge: c.req.query('resolve') === 'raw' ? 'raw' : 'brackets',
    ...renderFormat(effectiveFormat(tpl)),
    state: paperStateFor({ version: tpl.version, bodySha256: bodySha, publication: await publicationRef(c.env, slug) }),
  });
  const bytes = buildLegalDocx(model, { pageSize: paper.pageSize });
  try {
    await fileRowStatement(c.env, {
      uid: newFileUid(), kind: 'docx_export', templateSlug: slug, templateVersion: tpl.version ?? null,
      bodySha256: bodySha, fileSha256: await sha256HexBytes(bytes), fileBytes: bytes.length,
      contentType: DOCX_CONTENT_TYPE, pageSize: paper.pageSize, renderer: 'docx', paperSha256: await paperSha256(),
      actorUserId: admin.id,
    }).run();
  } catch (e) {
    return refuse(c, 503, { code: 'export_unrecorded', message: 'The export could not be recorded, so no file was handed out. Try again.', raw: e });
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': DOCX_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${docxFilename(slug, tpl.version ?? null)}"`,
      'Cache-Control': 'no-store',
    },
  });
});

// GET /api/admin/contracts/templates/:doc_type/usage — drill-down for a
// single template card on Admin > Contracts > Templates. Returns the
// template metadata, aggregate counters across the 4-source union for
// that doc_type, and the list of envelopes/contracts using it (newest
// first), so admins can see who's been assigned, what was sent, what's
// signed, and when. Re-uses `loadAllContracts` so source coverage
// (documents + esign + pairwise + partner_deals) and field decoration
// stay in lock-step with the main list endpoint.
adminContracts.get('/templates/:doc_type/usage', async (c) => {
  await requireAdmin(c);
  const docType = c.req.param('doc_type');
  // Task #8 — the Templates grid now lists every store slug (esign bodies +
  // spaced AGREEMENT_OPTIONS stubs + admin-created rows), not just the static
  // TEMPLATES registry. Fall back to the D1 store so the "N uses" chip resolves
  // a header for those slugs too; the usage stats below are doc_type-driven and
  // need no other change.
  const tpl = TEMPLATES[docType];
  let templateMeta: { key: string; doc_type: string; title: string; layer: string; layer_label: string };
  if (tpl) {
    templateMeta = {
      key: docType,
      doc_type: docType,
      title: tpl.title,
      layer: tpl.layer,
      layer_label: TEMPLATE_LAYERS[tpl.layer]?.label || tpl.layer,
    };
  } else {
    const stored = await storeGetTemplate(c.env, docType);
    if (!stored) return c.json({ error: 'unknown_template', doc_type: docType }, 404);
    templateMeta = {
      key: stored.slug,
      doc_type: stored.slug,
      title: stored.title,
      layer: stored.category,
      layer_label: TEMPLATE_LAYERS[stored.category]?.label || stored.category,
    };
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500);
  const offset = parseInt(c.req.query('offset') || '0', 10) || 0;

  const sql = getSQL(c.env);
  try {
    const all = await loadAllContracts(sql);
    const rows = all.filter(r => r.doc_type === docType);

    const byStatus: Record<string, number> = { draft: 0, generated: 0, sent: 0, signed: 0, void: 0 };
    const signDays: number[] = [];
    let signedRecent = 0;
    const cutoff = Date.now() - 30 * 86400000;
    let lastUsed: string | null = null;
    for (const r of rows) {
      if (r.status in byStatus) byStatus[r.status]++;
      if (r.days_to_sign != null) signDays.push(r.days_to_sign);
      if (r.signed_at) {
        const t = new Date(r.signed_at).getTime();
        if (Number.isFinite(t) && t >= cutoff) signedRecent++;
      }
      if (r.created_at && (!lastUsed || new Date(r.created_at) > new Date(lastUsed))) {
        lastUsed = r.created_at;
      }
    }

    const items = rows.slice(offset, offset + limit);
    // Same void-reason batch enrichment used by the list endpoint so the
    // template-usage modal can show why a void row was voided without an
    // extra round-trip.
    const voidUids = items.filter(r => r.status === 'void' && r.uid).map(r => r.uid);
    if (voidUids.length > 0) {
      const reasons = await loadVoidReasonsBatch(sql, voidUids);
      for (const r of items) {
        if (r.status !== 'void') continue;
        const v = reasons.get(r.uid);
        if (v) { r.void_reason = v.reason; r.voided_at = v.voided_at; }
      }
    }

    return c.json({
      template: templateMeta,
      stats: {
        total: rows.length,
        by_status: byStatus,
        signed_last_30d: signedRecent,
        pending_signature: byStatus.sent + byStatus.generated,
        avg_days_to_sign: signDays.length
          ? Math.round((signDays.reduce((a, b) => a + b, 0) / signDays.length) * 10) / 10
          : null,
        last_used_at: lastUsed,
      },
      total: rows.length,
      limit,
      offset,
      items,
    });
  } finally {
    await sql.end();
  }
});

export default adminContracts;
