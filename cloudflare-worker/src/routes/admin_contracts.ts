import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAdmin, requireFactor } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { mintDownloadToken } from '../services/signedDownload';
import { sendAgreementAssignedEmail } from '../services/email';

type AppContext = Context<{ Bindings: Env }>;
type ContractDownloadResult =
  | { ok: { url: string; expires_at: string }; error?: undefined }
  | { ok?: undefined; error: Response };

const adminContracts = new Hono<{ Bindings: Env }>();

const TEMPLATE_LAYERS: Record<string, { label: string; description: string }> = {
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
type PartyRole = 'founder' | 'investor' | 'mentor' | 'partner' | 'axal';
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
  // mentor
  mentor_nda_axal: ['mentor', 'axal'],
  mentor_engagement_disclaimer: ['mentor', 'axal'],
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

function partyRolesFor(docType: string | null | undefined): ReadonlyArray<PartyRole> {
  if (!docType) return [];
  return DOC_TYPE_PARTY_ROLES[docType] || [];
}

const TEMPLATES: Record<string, { title: string; layer: string }> = {
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
  mentor_nda_axal: { title: 'Mentor NDA (Axal)', layer: 'gp' },
  mentor_engagement_disclaimer: { title: 'Mentor Engagement Disclaimer', layer: 'gp' },
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
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.max(0, Math.floor((t1 - t2) / 86400000));
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
    project_id: e.deal_id ?? null,
    project_name: null,
    recipient_email: e.recipient_email || null,
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
      e.id, e.envelope_uuid, e.user_id, e.deal_id,
      e.document_type, e.document_title,
      e.status, e.created_at, e.completed_at, e.signed_r2_key,
      COALESCE(e.provider, 'native') AS provider,
      (SELECT recipient_email FROM esign_recipients WHERE envelope_id = e.id ORDER BY id ASC LIMIT 1) AS recipient_email,
      (SELECT recipient_name  FROM esign_recipients WHERE envelope_id = e.id ORDER BY id ASC LIMIT 1) AS recipient_name,
      (SELECT recipient_name  FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed' ORDER BY signed_at DESC LIMIT 1) AS signer_name,
      (SELECT signer_ip       FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed' ORDER BY signed_at DESC LIMIT 1) AS signer_ip,
      (SELECT MAX(signed_at)  FROM esign_recipients WHERE envelope_id = e.id) AS last_signed_at
    FROM esign_envelopes e
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

async function loadPairwiseNdaContracts(sql: ReturnType<typeof getSQL>): Promise<UnifiedContract[]> {
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
  } catch {
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

async function loadPartnerDealContracts(sql: ReturnType<typeof getSQL>): Promise<UnifiedContract[]> {
  let rows: any[] = [];
  try {
    rows = await sql`
      SELECT d.id, d.partner_user_id, d.deal_type, d.term_months,
             d.granted_tiers, d.status, d.created_at, d.updated_at,
             u.email AS partner_email, u.name AS partner_name
        FROM partner_deals d
        LEFT JOIN users u ON u.id = d.partner_user_id
       ORDER BY d.created_at DESC
    `;
  } catch {
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
    });
  });
}

async function loadAllContracts(sql: ReturnType<typeof getSQL>): Promise<UnifiedContract[]> {
  // Task #3 — true 4-source union: legacy documents + e-sign envelopes
  // (live signing) + pairwise NDAs (Y-1) + partner deals (X-1). Each
  // loader returns rows already normalised to UnifiedContract; failures
  // on the optional sources (table missing on older D1) collapse to []
  // inside the loader so the union is always best-effort.
  const [docRows, esignRows, pairwiseRows, partnerRows] = await Promise.all([
    loadDocumentsContracts(sql),
    loadEsignContracts(sql),
    loadPairwiseNdaContracts(sql),
    loadPartnerDealContracts(sql),
  ]);
  const merged = [...docRows, ...esignRows, ...pairwiseRows, ...partnerRows];
  merged.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
  return merged;
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
  const q = (c.req.query('q') || '').toLowerCase();
  // Task #2 — provider filter chip ("All / Native / DocuSign"). Only
  // applies to esign-source rows; legacy `documents` rows are always
  // 'native' so the filter naturally hides them when 'docusign' is
  // selected.
  const provider = (c.req.query('provider') || '').toLowerCase();
  // Task #5 (Z) — `party_role` filter chip
  // (founder|investor|mentor|partner|axal). Matches if the doc's
  // role set contains the requested role.
  const partyRole = (c.req.query('party_role') || '').toLowerCase() as PartyRole | '';
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 500);
  const offset = parseInt(c.req.query('offset') || '0', 10) || 0;

  const sql = getSQL(c.env);
  try {
    let rows = await loadAllContracts(sql);

    if (status)    rows = rows.filter(r => r.status === status);
    if (docType)   rows = rows.filter(r => r.doc_type === docType);
    if (projectId) rows = rows.filter(r => r.project_id === parseInt(projectId));
    if (provider === 'native' || provider === 'docusign') {
      rows = rows.filter(r => (r.provider || 'native') === provider);
    }
    if (partyRole && ['founder', 'investor', 'mentor', 'partner', 'axal'].includes(partyRole)) {
      rows = rows.filter(r => (r.party_roles || []).includes(partyRole as PartyRole));
    }
    if (q) {
      rows = rows.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.recipient_email || '').toLowerCase().includes(q) ||
        (r.template_name || '').toLowerCase().includes(q) ||
        (r.project_name || '').toLowerCase().includes(q)
      );
    }

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
      total, limit, offset,
      items,
      meta: { sources: ['documents', 'esign_envelopes', 'pairwise_ndas', 'partner_deals'], unioned: true },
    });
  } finally {
    await sql.end();
  }
});

// GET /api/admin/contracts/stats — aggregate counters across the union.
adminContracts.get('/stats', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  try {
    const rows = await loadAllContracts(sql);
    const byStatus: Record<string, number> = { draft: 0, generated: 0, sent: 0, signed: 0, void: 0 };
    const byTypeCount = new Map<string, number>();
    const signDays: number[] = [];
    let signedRecent = 0;
    const cutoff = Date.now() - 30 * 86400000;

    for (const r of rows) {
      if (r.status in byStatus) byStatus[r.status]++;
      if (r.doc_type) byTypeCount.set(r.doc_type, (byTypeCount.get(r.doc_type) || 0) + 1);
      const days = daysBetween(r.signed_at, r.created_at);
      if (days != null) signDays.push(days);
      if (r.signed_at) {
        const t = new Date(r.signed_at).getTime();
        if (Number.isFinite(t) && t >= cutoff) signedRecent++;
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
  } finally {
    await sql.end();
  }
});

// GET /api/admin/contracts/templates — catalog with usage counts.
// Counts come from BOTH `documents.template_name|doc_type` and
// `esign_envelopes.document_type` so usage isn't undercounted post-migration.
adminContracts.get('/templates', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  try {
    const [docs, envs]: [any[], any[]] = await Promise.all([
      sql.unsafe(
        `SELECT template_name, doc_type, created_at FROM documents
          WHERE LOWER(COALESCE(doc_type, '')) IN (${Array.from(CONTRACT_DOC_TYPES).map(() => '?').join(',')})`,
        Array.from(CONTRACT_DOC_TYPES),
      ),
      sql`SELECT document_type, created_at FROM esign_envelopes`,
    ]);
    const usage = new Map<string, number>();
    const lastUsed = new Map<string, string>();
    const bump = (key: string | null | undefined, when: string | null | undefined) => {
      if (!key) return;
      usage.set(key, (usage.get(key) || 0) + 1);
      const prev = lastUsed.get(key);
      if (when && (!prev || new Date(when) > new Date(prev))) lastUsed.set(key, when);
    };
    for (const d of docs) bump(d.template_name || d.doc_type, d.created_at);
    for (const e of envs) bump(e.document_type, e.created_at);

    const out = Object.entries(TEMPLATES).map(([k, v]) => ({
      key: k,
      title: v.title,
      doc_type: k,
      layer: v.layer,
      layer_label: TEMPLATE_LAYERS[v.layer]?.label || v.layer,
      usage_count: usage.get(k) || 0,
      last_used_at: lastUsed.get(k) || null,
    }));
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
          LEFT JOIN users u ON u.id = d.partner_user_id
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

// GET /api/admin/contracts/:uid — detail (UNION-aware).
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
        e.id, e.envelope_uuid, e.user_id, e.deal_id,
        e.document_type, e.document_title,
        e.status, e.created_at, e.completed_at, e.signed_r2_key,
        (SELECT recipient_email FROM esign_recipients WHERE envelope_id = e.id ORDER BY id ASC LIMIT 1) AS recipient_email,
        (SELECT recipient_name  FROM esign_recipients WHERE envelope_id = e.id ORDER BY id ASC LIMIT 1) AS recipient_name,
        (SELECT recipient_name  FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed' ORDER BY signed_at DESC LIMIT 1) AS signer_name,
        (SELECT signer_ip       FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed' ORDER BY signed_at DESC LIMIT 1) AS signer_ip,
        (SELECT MAX(signed_at)  FROM esign_recipients WHERE envelope_id = e.id) AS last_signed_at
      FROM esign_envelopes e WHERE e.id = ${ref.row.id} LIMIT 1
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
    let envelopeTitle: string | null = null;
    let projectId: number | null = null;

    if (ref.source === 'documents') {
      const d = ref.row;
      if (String(d.status).toLowerCase() === 'signed') {
        return c.json({ error: 'Cannot void a signed contract' }, 400);
      }
      envelopeTitle = d.title || null;
      projectId = d.project_id ?? null;
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
      envelopeTitle = env.document_title;
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
// Task #5 (Z) — Pairwise NDAs tab.
// Surfaces the founder ↔ investor NDA pairs from `pairwise_ndas`
// (created by Y-1) joined to user emails on both sides + the underlying
// envelope for "Open contract" deep-links.
// ---------------------------------------------------------------------------
adminContracts.get('/pairwise-ndas', async (c) => {
  await requireAdmin(c);
  // Task #5 (Z) — optional ?status= filter
  // (pending|partially_signed|active|expired|revoked) and ?intermediary=
  // filter (relation context, e.g. `axal`, `direct`, `<partner_uid>`).
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
         ORDER BY p.created_at DESC
         LIMIT 500
      `;
    } catch (e) {
      // Table may not be present yet on older deployments — surface
      // empty rather than 500 so the tab renders an "empty state".
      console.warn('[admin_contracts] pairwise_ndas query failed', e);
      return c.json({ items: [], note: 'pairwise_ndas table not present on this environment' });
    }
    if (statusFilter) rows = rows.filter(r => String(r.status || '').toLowerCase() === statusFilter);
    if (intermediaryFilter) rows = rows.filter(r => String(r.intermediary || '').toLowerCase() === intermediaryFilter);
    return c.json({ items: rows });
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// Task #5 (Z) — Partner Deals tab.
// Surfaces the X-1 `partner_deals` table (deal type, term, granted tiers,
// status, redemption count). Returns an empty list — gracefully — until
// X-1 lands the table so this endpoint is safe to ship now.
// ---------------------------------------------------------------------------
adminContracts.get('/partner-deals', async (c) => {
  await requireAdmin(c);
  // Task #5 (Z) — optional ?deal_type= filter chip.
  const dealType = (c.req.query('deal_type') || '').toLowerCase();
  const sql = getSQL(c.env);
  try {
    let rows: any[] = [];
    try {
      rows = await sql`
        SELECT d.id, d.partner_user_id, d.deal_type, d.term_months,
               d.granted_tiers, d.status, d.created_at, d.updated_at,
               u.email AS partner_email, u.name AS partner_name,
               (SELECT COUNT(*) FROM partner_deal_redemptions r
                 WHERE r.deal_id = d.id) AS redemption_count
          FROM partner_deals d
          LEFT JOIN users u ON u.id = d.partner_user_id
         ORDER BY d.created_at DESC
         LIMIT 500
      `;
    } catch (e) {
      // X-1 hasn't created the table yet on this environment.
      return c.json({ items: [], note: 'partner_deals table not yet present (X-1 backend pending)' });
    }
    if (dealType) rows = rows.filter(r => String(r.deal_type || '').toLowerCase() === dealType);
    return c.json({ items: rows });
  } finally {
    await sql.end();
  }
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
  { key: 'mentor_nda_v1',                     doc_type: 'mentor_nda_axal',                   title: 'Mentor NDA (Axal) v1' },
  { key: 'mentor_disclaimer_v1',              doc_type: 'mentor_engagement_disclaimer',     title: 'Mentor Engagement Disclaimer v1' },
  { key: 'accreditation_v1',                  doc_type: 'accreditation_v1',                  title: 'Accreditation Attestation v1' },
  { key: 'partner_msa_v1',                    doc_type: 'partner_services',                  title: 'Partner Services / MSA v1' },
  { key: 'nda_3way_founder_investor_axal_v1', doc_type: 'nda_3way_founder_investor_axal',   title: '3-Way NDA (Founder ↔ Investor ↔ Axal) v1' },
];

adminContracts.get('/templates/legal', async (c) => {
  await requireAdmin(c);
  return c.json({ items: LEGAL_TEMPLATE_CATALOG });
});

export default adminContracts;
