/**
 * eSignature routes — DocuSign-like flow built on R2 + D1 + Workers.
 *
 * Endpoints:
 *  - POST   /api/legal/esign/send            (admin) — create envelope + email recipient
 *  - GET    /api/legal/esign                 (admin) — list envelopes (filter by user_id, deal_id)
 *  - GET    /api/legal/esign/:id             (admin) — envelope detail + audit log
 *  - GET    /api/legal/esign/:id/document    (admin) — stream signed PDF from R2
 *  - GET    /api/legal/esign/sign/:token     (public) — fetch envelope details for signing UI
 *  - POST   /api/legal/esign/sign/:token     (public) — submit signature (canvas data URL)
 *  - POST   /api/legal/esign/sign/:token/reject (public) — recipient declines
 *
 * Security model:
 *  - Admin routes require requireAdmin (Zero Trust JWT).
 *  - Public sign/:token routes are gated by a 32-byte URL-safe random token
 *    stored in `esign_recipients.signing_token` with a 7-day expiry.
 *  - Tokens are single-use for the POST submit; GET is allowed multiple times
 *    until expiry (so the recipient can re-open the page).
 *  - Every access (GET or POST) appends to the envelope's `audit_log` JSON
 *    array AND writes to `activity_logs` for cross-system observability.
 *  - The R2 bucket is private; signed PDFs are streamed through the worker
 *    via gated downloads. No presigned URLs are issued.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireAuth } from '../auth';
import { sendAgreementAssignedEmail } from '../services/email';
import { renderAgreementPdf, sha256Hex } from '../services/pdf';

const esign = new Hono<{ Bindings: Env }>();

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SIGNATURE_DATAURL_PREFIX = 'data:image/png;base64,';
const MAX_SIGNATURE_BYTES = 256 * 1024; // 256 KB

// ---------------------------------------------------------------------------
// Schema (defensive lazy migration — same pattern as other routes).
// ---------------------------------------------------------------------------
let migrated = false;
async function ensureSchema(env: Env): Promise<void> {
  if (migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS esign_envelopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_uuid TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      deal_id INTEGER,
      document_type TEXT NOT NULL,
      document_title TEXT NOT NULL,
      document_body TEXT NOT NULL,
      body_sha256 TEXT NOT NULL,
      original_r2_key TEXT,
      signed_r2_key TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      audit_log TEXT NOT NULL DEFAULT '[]',
      created_by INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_esign_user ON esign_envelopes(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_esign_deal ON esign_envelopes(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_esign_status ON esign_envelopes(status)`,
    `CREATE TABLE IF NOT EXISTS esign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id INTEGER NOT NULL,
      user_id INTEGER,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT,
      signing_token TEXT NOT NULL UNIQUE,
      token_expires_at TIMESTAMP NOT NULL,
      signed_at TIMESTAMP,
      signer_ip TEXT,
      signer_ua TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_esign_rec_envelope ON esign_recipients(envelope_id)`,
    `CREATE INDEX IF NOT EXISTS idx_esign_rec_email ON esign_recipients(recipient_email)`,
    // Append-only audit table — replaces the read-modify-write JSON column as
    // the source of truth for compliance events. The JSON column is kept for
    // backward compatibility but no longer written to.
    `CREATE TABLE IF NOT EXISTS esign_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id INTEGER NOT NULL,
      ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      signer_id INTEGER,
      signer_email TEXT,
      action TEXT NOT NULL,
      ip TEXT,
      ua TEXT,
      meta TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_esign_audit_envelope ON esign_audit_events(envelope_id, ts)`,
    // Task #2 — DocuSign provider columns. ALTER ADD COLUMN has no
    // IF NOT EXISTS in D1; the per-statement try/catch below swallows
    // the resulting `duplicate column name` errors on re-run.
    `ALTER TABLE esign_envelopes ADD COLUMN provider TEXT NOT NULL DEFAULT 'native'`,
    `ALTER TABLE esign_envelopes ADD COLUMN docusign_envelope_id TEXT`,
    `ALTER TABLE esign_envelopes ADD COLUMN docusign_account_id TEXT`,
    // Last terminal-state reason from the provider (decline/void
    // reason for DocuSign; null for in-house). Surfaced in the admin
    // contracts UI so reviewers don't have to dig into audit events.
    `ALTER TABLE esign_envelopes ADD COLUMN last_error TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_esign_provider          ON esign_envelopes(provider)`,
    `CREATE INDEX IF NOT EXISTS idx_esign_docusign_envelope ON esign_envelopes(docusign_envelope_id)`,
    `CREATE INDEX IF NOT EXISTS idx_esign_docusign_account  ON esign_envelopes(docusign_account_id)`,
    // Partial UNIQUE — see migration 021 for rationale (account-scoped).
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_esign_account_docusign_envelope
       ON esign_envelopes(docusign_account_id, docusign_envelope_id)
       WHERE docusign_envelope_id IS NOT NULL`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch {}
  }
  migrated = true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function genToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
}

interface AuditEntry {
  ts: string;
  signer_id: number | null;
  signer_email: string | null;
  action: string;
  ip: string;
  ua?: string;
  meta?: Record<string, unknown>;
}

async function appendAudit(env: Env, envelopeId: number, entry: AuditEntry): Promise<void> {
  try {
    // Append-only insert — no RMW, no lost-update window. Source of truth
    // for the compliance audit trail.
    await env.DB.prepare(
      `INSERT INTO esign_audit_events (envelope_id, ts, signer_id, signer_email, action, ip, ua, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      envelopeId, entry.ts, entry.signer_id, entry.signer_email,
      entry.action, entry.ip, entry.ua || null,
      entry.meta ? JSON.stringify(entry.meta) : null,
    ).run();
    // Mirror to activity_logs so admins see eSign events in the global feed.
    try {
      await env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
      ).bind(`esign_${entry.action}`, JSON.stringify({ envelope_id: envelopeId, ip: entry.ip, meta: entry.meta }), entry.signer_email || 'system', entry.signer_id).run();
    } catch {}
  } catch (e) {
    console.error('[esign] appendAudit failed', e);
  }
}

interface AgreementTemplate {
  title: string;
  body: string;
}

// Minimal, generic templates keyed by AGREEMENT_OPTIONS values from the
// frontend. Real legal teams should replace these with vetted documents;
// these are placeholders that capture the intent and parties so the audit
// trail is meaningful from day one.
function buildTemplateBody(agreementType: string, recipientName: string, recipientEmail: string): AgreementTemplate {
  const intro = `This Agreement is entered into between Axal Holding Co. ("Axal") and ${recipientName || recipientEmail} ("Counterparty"), effective on the date of electronic signature appearing below.\n\n`;
  const closer = `\n\n---\n\nBy signing electronically below, the parties acknowledge that they have read and agree to the terms set forth in this Agreement and that an electronic signature has the same legal effect as a handwritten signature under the U.S. Electronic Signatures in Global and National Commerce Act (E-SIGN, 15 U.S.C. § 7001 et seq.) and the Uniform Electronic Transactions Act (UETA).`;
  const lib: Record<string, AgreementTemplate> = {
    'Subscription Booklet & LPA': { title: 'Subscription Booklet & Limited Partnership Agreement', body: intro + 'Counterparty subscribes to limited partnership interests in the Axal venture fund subject to the terms of the Limited Partnership Agreement, including capital commitments, management fees, carried interest, distribution waterfall, and transfer restrictions.\n\nCounterparty represents that they qualify as an Accredited Investor under Regulation D and will provide such verification as Axal may reasonably require.' + closer },
    'SPV Joinder Agreement':       { title: 'Special Purpose Vehicle Joinder Agreement', body: intro + 'Counterparty hereby joins the SPV formed for the specific investment opportunity described separately, agreeing to its operating agreement, capital call schedule, and pro-rata distribution mechanics.' + closer },
    'Co-Investment Side Letter':   { title: 'Co-Investment Side Letter', body: intro + 'This Side Letter modifies the standard LPA terms with respect to co-investment rights, fee offsets, and information rights as negotiated separately between the parties.' + closer },
    'Strategic Side Letter / Focused SPV': { title: 'Strategic Side Letter / Focused SPV Agreement', body: intro + 'Counterparty receives sector-focused investment exposure through a dedicated SPV, with negotiated economics and reporting cadence specific to the strategic mandate.' + closer },
    'Founder Collaboration Agreement': { title: 'Founder Collaboration Agreement', body: intro + 'Counterparty agrees to collaborate with Axal in the formation and operation of a new venture, including IP contribution, time commitment, equity vesting, and confidentiality obligations.' + closer },
    'Spin-Out Subsidiary SPA + IP Transfer': { title: 'Spin-Out Subsidiary Stock Purchase + IP Transfer', body: intro + 'Counterparty agrees to the formation of a subsidiary company, the assignment and license of relevant intellectual property to that subsidiary, and the issuance of founder shares pursuant to a vesting schedule.' + closer },
    'Strategic Scale Partnership Agreement': { title: 'Strategic Scale Partnership Agreement', body: intro + 'Counterparty engages Axal to provide strategic scaling services, including go-to-market acceleration, follow-on financing support, and operational resources, in exchange for the consideration described herein.' + closer },
    'Technology Integration / JV Agreement': { title: 'Technology Integration / Joint Venture Agreement', body: intro + 'Counterparty and Axal agree to integrate StudioOS AI technology into Counterparty\'s product suite under a joint venture structure, with shared IP rights and revenue allocation as specified.' + closer },
    'Referral / Agency Agreement': { title: 'Referral & Agency Agreement', body: intro + 'Counterparty agrees to refer qualified opportunities to Axal in exchange for the referral fees and revenue share defined herein, subject to non-circumvention and confidentiality obligations.' + closer },
    'M&A Advisory Mandate':        { title: 'M&A Advisory Mandate', body: intro + 'Counterparty engages Axal as M&A advisor on an exclusive basis for the engagement period defined herein, with success fees calculated as a percentage of transaction value.' + closer },
    'Venture Share Agreement (FAST)': { title: 'Venture Share Agreement (FAST)', body: intro + 'Counterparty agrees to advise the Axal portfolio company on a Founder/Advisor Standard Template (FAST) basis, with equity compensation vesting over the engagement period.' + closer },
    'MSA + Equity-for-Services':   { title: 'Master Services Agreement + Equity-for-Services', body: intro + 'Counterparty agrees to provide operating partner services under a Master Services Agreement, with compensation paid partially in equity of designated portfolio companies.' + closer },
    'Engagement Letter (Spin-Out Package)': { title: 'Engagement Letter — Spin-Out Legal Package', body: intro + 'Counterparty (legal counsel) is engaged to provide the standard spin-out legal package, including entity formation, IP assignment, founder agreements, and initial financing documents.' + closer },
    'White-Label Service Agreement': { title: 'White-Label Service Agreement', body: intro + 'Counterparty agrees to provide technical services on a white-label basis to Axal portfolio companies, with deliverables and SLAs defined per work order.' + closer },
    'Secondary Purchase Agreement': { title: 'Secondary Purchase Agreement', body: intro + 'Counterparty agrees to the purchase or sale of secondary interests in Axal portfolio companies on the terms described, including price, transfer mechanics, and information rights.' + closer },
  };
  return lib[agreementType] || {
    title: agreementType || 'Closing Binder Agreement',
    body: intro + `This document constitutes the Closing Binder for the agreement type "${agreementType}". Detailed terms are set forth in the attached schedules and exhibits, which are incorporated by reference. Counterparty acknowledges receipt of and agreement with all such terms.` + closer,
  };
}

// ---------------------------------------------------------------------------
// Internal helper exported for use from other routes (e.g. profiling/verify).
// Returns { envelope_id, signing_url } or null on send failure.
// ---------------------------------------------------------------------------
export async function createAndSendEnvelope(
  env: Env,
  opts: {
    adminUserId: number;
    adminName: string;
    recipientUserId: number | null;
    recipientEmail: string;
    recipientName: string;
    documentType: string;
    dealId?: number | null;
    appUrl: string;
    /**
     * Task #2 — Provider override. When 'docusign', the envelope is
     * routed through the admin's connected DocuSign account instead of
     * the in-house signing flow. Falls back to 'native' if the admin
     * has no active DocuSign integration. Default 'native'.
     */
    viaProvider?: 'native' | 'docusign';
  }
): Promise<{ envelope_id: number; envelope_uuid: string; signing_url: string; email_sent: boolean; provider?: string } | null> {
  await ensureSchema(env);

  const tpl = buildTemplateBody(opts.documentType, opts.recipientName, opts.recipientEmail);
  const envelopeUuid = crypto.randomUUID();
  const bodySha = await sha256Hex(tpl.body);

  // Atomic idempotency: SQLite executes INSERT...SELECT...WHERE NOT EXISTS
  // as a single statement, so two concurrent verify clicks cannot both
  // succeed in creating an envelope for the same (document_type, recipient).
  // The NOT EXISTS clause matches by user_id when present, otherwise by
  // recipient email via a join into esign_recipients (which doesn't yet
  // exist for the new envelope, so user_id-keyed dedupe is the primary path).
  const recipientKey = (opts.recipientUserId ?? -1);
  const insertEnv: any = await env.DB.prepare(
    `INSERT INTO esign_envelopes (envelope_uuid, user_id, deal_id, document_type, document_title, document_body, body_sha256, status, created_by, audit_log)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'sent', ?, '[]'
      WHERE NOT EXISTS (
        SELECT 1 FROM esign_envelopes
         WHERE document_type = ?
           AND COALESCE(user_id, -1) = ?
           AND status IN ('sent', 'partially_signed')
      )
     RETURNING id`
  ).bind(
    envelopeUuid, opts.recipientUserId, opts.dealId || null, opts.documentType, tpl.title, tpl.body, bodySha, opts.adminUserId,
    opts.documentType, recipientKey,
  ).first();
  if (!insertEnv?.id) {
    // Lost the race — return the winning envelope's basic info so the caller
    // can surface it without re-emailing.
    const existing: any = await env.DB.prepare(
      `SELECT id, envelope_uuid FROM esign_envelopes
        WHERE document_type = ? AND COALESCE(user_id, -1) = ? AND status IN ('sent', 'partially_signed')
        ORDER BY id DESC LIMIT 1`
    ).bind(opts.documentType, recipientKey).first();
    if (existing?.id) {
      return {
        envelope_id: existing.id as number,
        envelope_uuid: existing.envelope_uuid as string,
        signing_url: '',
        email_sent: false,
      };
    }
    return null;
  }
  const envelopeId = insertEnv.id as number;

  // ── Task #2 — DocuSign opt-in path ─────────────────────────────────────
  // When the admin requests `viaProvider:'docusign'` AND has an active
  // DocuSign integration, hand the document off to DocuSign and skip the
  // in-house token/email path (DocuSign emails the signer). On any
  // failure we fall back to the in-house flow so the agreement still
  // lands in the recipient's inbox.
  if (opts.viaProvider === 'docusign') {
    try {
      const { findActiveDocusignIntegrationForUser, sendDocusignEnvelope, ensureDocusignWebhookSecret } = await import('../integrations/providers/docusign');
      const dsRow = await findActiveDocusignIntegrationForUser(env, opts.adminUserId);
      if (!dsRow) {
        // Explicit-provider contract — caller asked for DocuSign and
        // we have no integration to satisfy it. We do NOT silently
        // fall back to native; the caller decides whether to retry
        // with provider='native' or surface a connect-DocuSign prompt.
        throw new Error('docusign_not_connected: no active DocuSign integration for the calling admin.');
      }
      {
        const webhookSecret = await ensureDocusignWebhookSecret(env, dsRow);
        const ds = await sendDocusignEnvelope(env, dsRow, {
          documentTitle: tpl.title,
          documentBody: tpl.body,
          recipientEmail: opts.recipientEmail,
          recipientName: opts.recipientName,
          emailSubject: `Please sign: ${tpl.title}`,
          appUrl: opts.appUrl,
          webhookSecret,
          integrationUid: dsRow.uid,
        });
        await env.DB.prepare(
          `UPDATE esign_envelopes SET provider = 'docusign', docusign_envelope_id = ?, docusign_account_id = ? WHERE id = ?`,
        ).bind(ds.docusign_envelope_id, dsRow.external_account_id || null, envelopeId).run();
        await appendAudit(env, envelopeId, {
          ts: new Date().toISOString(),
          signer_id: opts.adminUserId,
          signer_email: null,
          action: 'envelope_created',
          ip: 'admin',
          meta: { admin: opts.adminName, document_type: opts.documentType, recipient: opts.recipientEmail, provider: 'docusign', docusign_envelope_id: ds.docusign_envelope_id },
        });
        return {
          envelope_id: envelopeId,
          envelope_uuid: envelopeUuid,
          signing_url: '',     // DocuSign emails the signer directly
          email_sent: true,
          provider: 'docusign',
        };
      }
    } catch (e) {
      // Caller explicitly asked for DocuSign — do NOT silently fall
      // back to native. Roll back the orphan `esign_envelopes` row we
      // pre-inserted (otherwise the next send would hit the
      // status-IN-('sent','partially_signed') idempotency predicate
      // and return a stale row), preserve the typed `docusign_*`
      // prefix, and surface a route-mappable error.
      try {
        await env.DB.prepare(
          `DELETE FROM esign_envelopes WHERE id = ? AND status = 'sent' AND provider = 'native'`,
        ).bind(envelopeId).run();
      } catch {}
      const raw = (e as Error).message || 'unknown';
      const cls = raw.split(':')[0]?.slice(0, 80) || 'docusign_failed';
      console.warn('[esign] docusign send failed (explicit provider, no fallback):', cls);
      // Preserve the original typed prefix when present
      // (`docusign_not_connected`, `docusign_no_account`, …) so the
      // route handler can return the right HTTP status; only wrap
      // truly-anonymous failures.
      if (cls.startsWith('docusign_')) throw new Error(cls);
      throw new Error(`docusign_send_failed: ${cls}`);
    }
  }

  const token = genToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, recipient_name, signing_token, token_expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(envelopeId, opts.recipientUserId, opts.recipientEmail, opts.recipientName || null, token, expiresAt).run();

  const signingUrl = `${opts.appUrl}/esign/${token}`;

  await appendAudit(env, envelopeId, {
    ts: new Date().toISOString(),
    signer_id: opts.adminUserId,
    signer_email: null,
    action: 'envelope_created',
    ip: 'admin',
    meta: { admin: opts.adminName, document_type: opts.documentType, recipient: opts.recipientEmail },
  });

  const emailSent = await sendAgreementAssignedEmail(
    env, opts.recipientEmail, opts.recipientName, tpl.title, signingUrl, opts.adminName
  );

  await appendAudit(env, envelopeId, {
    ts: new Date().toISOString(),
    signer_id: null, signer_email: opts.recipientEmail,
    action: emailSent ? 'email_sent' : 'email_failed',
    ip: 'system',
    meta: { signing_url: signingUrl },
  });

  return { envelope_id: envelopeId, envelope_uuid: envelopeUuid, signing_url: signingUrl, email_sent: emailSent, provider: 'native' };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /api/legal/esign/send — admin creates an envelope and emails the recipient.
esign.post('/send', async (c) => {
  const admin = await requireAdmin(c);
  await ensureSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const documentType = String(body?.document_type || '').trim();
  const recipientEmail = String(body?.recipient_email || '').trim().toLowerCase();
  const recipientName = String(body?.recipient_name || '').trim();
  const recipientUserId = body?.recipient_user_id ? Number(body.recipient_user_id) : null;
  const dealId = body?.deal_id ? Number(body.deal_id) : null;
  // Canonical request field is `provider`; `via_provider` is kept as a
  // backwards-compat alias for any in-flight callers. Both accept
  // 'native' | 'docusign'.
  const providerRaw = String(body?.provider ?? body?.via_provider ?? 'native').toLowerCase();
  const viaProvider: 'native' | 'docusign' = providerRaw === 'docusign' ? 'docusign' : 'native';
  if (!documentType) return c.json({ error: 'document_type is required' }, 400);
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(recipientEmail)) {
    return c.json({ error: 'valid recipient_email is required' }, 400);
  }

  // Studio-tier gate. DocuSign is a Studio-only provider; non-Studio
  // admins get a 402 with the standard upsell payload (the BYPASS_ROLES
  // set in middleware/requireTier already lets super-admins through).
  if (viaProvider === 'docusign') {
    const { userMeetsTier, tierUpsell } = await import('../middleware/requireTier');
    if (!userMeetsTier(admin, 'studio')) {
      return c.json(tierUpsell('studio'), 402);
    }
  }

  let result;
  try {
    result = await createAndSendEnvelope(c.env, {
      adminUserId: admin.id,
      adminName: admin.name || admin.email,
      recipientUserId,
      recipientEmail,
      recipientName,
      documentType,
      dealId,
      appUrl: c.env.APP_URL || 'https://axal.vc',
      viaProvider,
    });
  } catch (e) {
    // No-silent-fallback: surface explicit-DocuSign failures as 412
    // (Precondition Failed) so the UI can prompt the admin to either
    // connect DocuSign or retry with provider='native'.
    const msg = (e as Error).message || '';
    if (msg.startsWith('docusign_not_connected')) {
      return c.json({ error: 'docusign_not_connected', message: 'No active DocuSign integration for the calling admin.' }, 412);
    }
    if (msg.startsWith('docusign_')) {
      // All other typed DocuSign failures (provider rejection, no
      // account access, etc.) — 502 with the typed code so the UI
      // can render an appropriate retry/connect-help affordance.
      return c.json({ error: msg.split(':')[0], message: 'DocuSign rejected the send request — check the integration credentials and retry.' }, 502);
    }
    throw e;
  }
  if (!result) return c.json({ error: 'Failed to create envelope' }, 500);
  return c.json(result);
});

// GET /api/legal/esign — admin lists envelopes (filter by user_id or deal_id).
esign.get('/', async (c) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const userId = c.req.query('user_id');
  const dealId = c.req.query('deal_id');
  const recipientEmail = c.req.query('recipient_email')?.toLowerCase();
  const where: string[] = [];
  const args: any[] = [];
  if (userId)         { where.push('e.user_id = ?');         args.push(Number(userId)); }
  if (dealId)         { where.push('e.deal_id = ?');         args.push(Number(dealId)); }
  if (recipientEmail) { where.push('LOWER(r.recipient_email) = ?'); args.push(recipientEmail); }
  const sql = `SELECT e.id, e.envelope_uuid, e.user_id, e.deal_id, e.document_type, e.document_title,
                      e.status, e.created_at, e.completed_at, e.signed_r2_key,
                      (SELECT COUNT(*) FROM esign_recipients WHERE envelope_id = e.id) AS recipient_count,
                      (SELECT COUNT(*) FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed') AS signed_count
                 FROM esign_envelopes e
                 ${where.length ? 'LEFT JOIN esign_recipients r ON r.envelope_id = e.id WHERE ' + where.join(' AND ') : ''}
                 GROUP BY e.id
                 ORDER BY e.created_at DESC LIMIT 200`;
  const r: any = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ envelopes: r?.results || [] });
});

// GET /api/legal/esign/:id — envelope detail incl. recipients + audit log.
esign.get('/:id{[0-9]+}', async (c) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const id = Number(c.req.param('id'));
  const env: any = await c.env.DB.prepare(`SELECT * FROM esign_envelopes WHERE id = ?`).bind(id).first();
  if (!env) return c.json({ error: 'Envelope not found' }, 404);
  const recs: any = await c.env.DB.prepare(
    `SELECT id, recipient_email, recipient_name, status, signed_at, signer_ip, token_expires_at FROM esign_recipients WHERE envelope_id = ? ORDER BY id`
  ).bind(id).all();
  // Read audit log from the append-only events table (source of truth).
  const events: any = await c.env.DB.prepare(
    `SELECT ts, signer_id, signer_email, action, ip, ua, meta FROM esign_audit_events WHERE envelope_id = ? ORDER BY ts ASC, id ASC LIMIT 500`
  ).bind(id).all();
  const auditLog = (events?.results || []).map((r: any) => ({
    ...r,
    meta: r.meta ? (() => { try { return JSON.parse(r.meta); } catch { return null; } })() : null,
  }));
  return c.json({
    ...env,
    audit_log: auditLog,
    recipients: recs?.results || [],
  });
});

// GET /api/legal/esign/sign/:token/document — recipient downloads their signed
// PDF using the same magic-link token. Allowed once envelope is at least
// partially_signed (and this recipient has signed). Solves the "email-only
// recipient" download gap — they don't need a logged-in user account.
esign.get('/sign/:token/document', async (c) => {
  await ensureSchema(c.env);
  const token = c.req.param('token');
  if (!token || token.length < 32) return c.json({ error: 'Invalid token' }, 400);
  const rec: any = await c.env.DB.prepare(
    `SELECT r.id, r.envelope_id, r.recipient_email, r.status, r.token_expires_at, r.user_id,
            e.signed_r2_key, e.envelope_uuid
       FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
      WHERE r.signing_token = ?`
  ).bind(token).first();
  if (!rec) return c.json({ error: 'Invalid or expired link' }, 404);
  if (new Date(rec.token_expires_at).getTime() < Date.now()) {
    return c.json({ error: 'This link has expired.' }, 410);
  }
  if (rec.status !== 'signed' || !rec.signed_r2_key) {
    return c.json({ error: 'Document not yet signed' }, 409);
  }
  if (!c.env.FILES) return c.json({ error: 'Storage not configured' }, 500);
  if (!rec.signed_r2_key.startsWith('esign/signed/')) return c.json({ error: 'Invalid document key' }, 400);
  const obj = await c.env.FILES.get(rec.signed_r2_key);
  if (!obj) return c.json({ error: 'Document not found in storage' }, 404);
  await appendAudit(c.env, rec.envelope_id, {
    ts: new Date().toISOString(),
    signer_id: rec.user_id,
    signer_email: rec.recipient_email,
    action: 'document_downloaded_by_recipient',
    ip: clientIp(c.req.raw),
    ua: c.req.header('user-agent') || undefined,
  });
  const body = await materializeSignedPdf(c.env, rec.signed_r2_key, obj);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="axal-${rec.envelope_uuid}.pdf"`,
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
});

// GET /api/legal/esign/:id/document — stream signed PDF from R2.
esign.get('/:id{[0-9]+}/document', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const id = Number(c.req.param('id'));
  const envRow: any = await c.env.DB.prepare(`SELECT id, signed_r2_key, user_id, status FROM esign_envelopes WHERE id = ?`).bind(id).first();
  if (!envRow) return c.json({ error: 'Envelope not found' }, 404);
  // RBAC: admin OR the envelope's recipient/owner can download.
  const isAdmin = user.role === 'admin';
  if (!isAdmin && envRow.user_id !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (!envRow.signed_r2_key || envRow.status !== 'completed') {
    return c.json({ error: 'Document not yet signed' }, 409);
  }
  if (!c.env.FILES) return c.json({ error: 'R2 storage not configured' }, 500);
  if (!envRow.signed_r2_key.startsWith('esign/signed/')) {
    return c.json({ error: 'Invalid document key' }, 400);
  }
  const obj = await c.env.FILES.get(envRow.signed_r2_key);
  if (!obj) return c.json({ error: 'Document not found in storage' }, 404);
  await appendAudit(c.env, id, {
    ts: new Date().toISOString(),
    signer_id: user.id,
    signer_email: user.email,
    action: 'document_downloaded',
    ip: clientIp(c.req.raw),
  });
  const body = await materializeSignedPdf(c.env, envRow.signed_r2_key, obj);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="axal-envelope-${envRow.id}.pdf"`,
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
});

// Helper — DocuSign-routed envelopes are stored AES-GCM-encrypted in R2
// at `esign/signed/<uuid>.pdf.enc`; in-house envelopes are stored
// plaintext at `esign/signed/<uuid>.pdf`. We pick the decode path off
// the suffix so a single download route handles both providers.
async function materializeSignedPdf(env: Env, key: string, obj: R2ObjectBody): Promise<Uint8Array | ReadableStream | null> {
  if (key.endsWith('.enc')) {
    const { decryptBytes } = await import('../services/cryptoBox');
    const ciphertext = new Uint8Array(await obj.arrayBuffer());
    return await decryptBytes(env, ciphertext);
  }
  return obj.body;
}

// GET /api/legal/esign/sign/:token — public, fetch envelope for signing UI.
esign.get('/sign/:token', async (c) => {
  await ensureSchema(c.env);
  const token = c.req.param('token');
  if (!token || token.length < 32) return c.json({ error: 'Invalid token' }, 400);
  const rec: any = await c.env.DB.prepare(
    `SELECT r.*, e.envelope_uuid, e.document_type, e.document_title, e.document_body, e.status AS envelope_status, e.body_sha256
       FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
      WHERE r.signing_token = ?`
  ).bind(token).first();
  if (!rec) return c.json({ error: 'Invalid or expired link' }, 404);
  if (new Date(rec.token_expires_at).getTime() < Date.now()) {
    return c.json({ error: 'This signing link has expired. Please request a new one from the Axal admin who sent it.' }, 410);
  }
  await appendAudit(c.env, rec.envelope_id, {
    ts: new Date().toISOString(),
    signer_id: rec.user_id,
    signer_email: rec.recipient_email,
    action: 'envelope_viewed',
    ip: clientIp(c.req.raw),
    ua: c.req.header('user-agent') || undefined,
  });
  return c.json({
    envelope_uuid: rec.envelope_uuid,
    document_type: rec.document_type,
    document_title: rec.document_title,
    document_body: rec.document_body,
    body_sha256: rec.body_sha256,
    recipient_email: rec.recipient_email,
    recipient_name: rec.recipient_name,
    status: rec.status,
    envelope_status: rec.envelope_status,
    expires_at: rec.token_expires_at,
  });
});

// POST /api/legal/esign/sign/:token — submit signature.
esign.post('/sign/:token', async (c) => {
  await ensureSchema(c.env);
  const token = c.req.param('token');
  if (!token || token.length < 32) return c.json({ error: 'Invalid token' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const sigDataUrl: string = body?.signature_data_url || '';
  const accepted: boolean = !!body?.accepted;
  const typedName: string = String(body?.typed_name || '').trim().slice(0, 200);

  if (!accepted) return c.json({ error: 'You must accept the terms to sign.' }, 400);
  if (!sigDataUrl.startsWith(SIGNATURE_DATAURL_PREFIX)) {
    return c.json({ error: 'Signature must be a PNG canvas drawing' }, 400);
  }
  const sigB64 = sigDataUrl.slice(SIGNATURE_DATAURL_PREFIX.length);
  if (sigB64.length > MAX_SIGNATURE_BYTES * 1.4) {
    return c.json({ error: 'Signature image too large' }, 413);
  }

  const rec: any = await c.env.DB.prepare(
    `SELECT r.*, e.envelope_uuid, e.document_type, e.document_title, e.document_body, e.body_sha256, e.user_id AS envelope_user_id
       FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
      WHERE r.signing_token = ?`
  ).bind(token).first();
  if (!rec) return c.json({ error: 'Invalid or expired link' }, 404);
  if (new Date(rec.token_expires_at).getTime() < Date.now()) {
    return c.json({ error: 'This signing link has expired.' }, 410);
  }
  if (rec.status === 'signed') {
    return c.json({ error: 'This document has already been signed.' }, 409);
  }
  if (rec.status === 'rejected') {
    return c.json({ error: 'This signing request was previously declined.' }, 409);
  }

  // Limited-access gate: a user with access_level='limited' can browse the
  // platform but is explicitly NOT permitted to enter into binding
  // agreements until they complete KYC. Enforced server-side so a magic
  // signing link in their inbox can't bypass the policy.
  //
  // Resolve the recipient user robustly: envelope_user_id may be NULL (the
  // /send endpoint accepts an optional recipient_user_id). Fall back to
  // looking up by lowercased recipient email so the gate also catches
  // signers whose envelope wasn't linked at creation time.
  let recipientUser: any = null;
  if (rec.envelope_user_id) {
    recipientUser = await c.env.DB.prepare(
      `SELECT access_level, kyc_status FROM users WHERE id = ?`
    ).bind(rec.envelope_user_id).first().catch(() => null);
  }
  if (!recipientUser && rec.recipient_email) {
    recipientUser = await c.env.DB.prepare(
      `SELECT access_level, kyc_status FROM users WHERE lower(email) = lower(?)`
    ).bind(rec.recipient_email).first().catch(() => null);
  }
  if (recipientUser && recipientUser.access_level === 'limited' && recipientUser.kyc_status !== 'approved') {
    return c.json({
      error: 'Limited access — please complete KYC verification before signing legal agreements. Contact Axal compliance if you need help.',
      code: 'kyc_required_for_signing',
    }, 403);
  }

  const ip = clientIp(c.req.raw);
  const ua = c.req.header('user-agent') || '';
  const signedAt = new Date().toISOString();
  const signerName = typedName || rec.recipient_name || rec.recipient_email;

  // Atomic claim: only one concurrent POST can transition pending → signing.
  // If two requests race, exactly one sees `meta.changes === 1`; the other
  // gets 0 and we return 409. This guarantees the PDF generation + R2
  // upload only happens once, eliminating the last-writer-wins overwrite.
  const claim: any = await c.env.DB.prepare(
    `UPDATE esign_recipients SET status = 'signing', signer_ip = ?, signer_ua = ? WHERE id = ? AND status = 'pending'`
  ).bind(ip, ua.slice(0, 512), rec.id).run();
  if ((claim?.meta?.changes || claim?.changes || 0) < 1) {
    return c.json({ error: 'This signing session is already in progress or completed.' }, 409);
  }

  // Render the signed PDF and upload to R2.
  if (!c.env.FILES) {
    // Best-effort rollback so the recipient can retry.
    await c.env.DB.prepare(`UPDATE esign_recipients SET status = 'pending', signer_ip = NULL, signer_ua = NULL WHERE id = ? AND status = 'signing'`).bind(rec.id).run().catch(() => {});
    return c.json({ error: 'Storage not configured' }, 500);
  }
  let signedKey: string;
  try {
    const pdfBytes = await renderAgreementPdf({
      envelopeUuid: rec.envelope_uuid,
      documentTitle: rec.document_title,
      documentBody: rec.document_body,
      signerName,
      signerEmail: rec.recipient_email,
      signerIp: ip,
      signedAt,
      signatureDataUrl: sigDataUrl,
      bodySha256: rec.body_sha256,
    });
    signedKey = `esign/signed/${rec.envelope_uuid}.pdf`;
    await c.env.FILES.put(signedKey, pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: {
        envelope_uuid: rec.envelope_uuid,
        signer_email: rec.recipient_email,
        signed_at: signedAt,
        body_sha256: rec.body_sha256,
      },
    });
  } catch (e: any) {
    console.error('[esign] PDF render/upload failed', e);
    // Roll the claim back so the recipient can retry.
    await c.env.DB.prepare(`UPDATE esign_recipients SET status = 'pending', signer_ip = NULL, signer_ua = NULL WHERE id = ? AND status = 'signing'`).bind(rec.id).run().catch(() => {});
    return c.json({ error: 'Failed to generate signed PDF', detail: e?.message }, 500);
  }

  // Finalize the claim → 'signed'.
  await c.env.DB.prepare(
    `UPDATE esign_recipients SET status = 'signed', signed_at = ? WHERE id = ? AND status = 'signing'`
  ).bind(signedAt, rec.id).run();

  const remaining: any = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM esign_recipients WHERE envelope_id = ? AND status NOT IN ('signed','rejected')`
  ).bind(rec.envelope_id).first();
  const allSigned = (remaining?.n || 0) === 0;

  if (allSigned) {
    // Task #1 (Slack, 2026-05-10) — gate the completion UPDATE on a
    // not-yet-completed status so concurrent final signers don't both
    // observe `remaining=0` and double-fire the contract_signed notify.
    // `meta.changes` reflects the real row count touched; only the winner
    // proceeds to dispatch the notification.
    const upd = await c.env.DB.prepare(
      `UPDATE esign_envelopes SET status = 'completed', signed_r2_key = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'completed'`
    ).bind(signedKey, rec.envelope_id).run();
    const wonRace = (upd.meta?.changes ?? 0) > 0;
    // Best-effort; never blocks the sign API.
    if (wonRace) try {
      const envelopeRow = await c.env.DB.prepare(
        `SELECT user_id, document_title, envelope_uuid FROM esign_envelopes WHERE id = ?`
      ).bind(rec.envelope_id).first<{ user_id: number | null; document_title: string | null; envelope_uuid: string }>();
      if (envelopeRow?.user_id) {
        const { notify } = await import('../services/notify');
        await notify(c.env, {
          userId: envelopeRow.user_id,
          type: 'contract_signed',
          title: `Contract fully signed: ${envelopeRow.document_title || 'Agreement'}`,
          body: `All counterparties have signed. The executed PDF is available in your Legal vault.`,
          link: '/legal',
          payload: { envelope_uuid: envelopeRow.envelope_uuid },
          channels: ['in_app', 'email', 'slack'],
          category: 'contract_signed',
        });
      }
    } catch (e) { console.warn('[esign] notify contract_signed failed', e); }
  } else {
    await c.env.DB.prepare(
      `UPDATE esign_envelopes SET status = 'partially_signed', signed_r2_key = ? WHERE id = ?`
    ).bind(signedKey, rec.envelope_id).run();
  }

  await appendAudit(c.env, rec.envelope_id, {
    ts: signedAt,
    signer_id: rec.user_id,
    signer_email: rec.recipient_email,
    action: 'envelope_signed',
    ip,
    ua,
    meta: { typed_name: typedName, signed_r2_key: signedKey, all_signed: allSigned },
  });

  return c.json({
    signed: true,
    completed: allSigned,
    envelope_uuid: rec.envelope_uuid,
    signed_at: signedAt,
  });
});

// POST /api/legal/esign/sign/:token/reject — decline to sign.
esign.post('/sign/:token/reject', async (c) => {
  await ensureSchema(c.env);
  const token = c.req.param('token');
  const body = await c.req.json().catch(() => ({}));
  const reason: string = String(body?.reason || '').slice(0, 1000);
  const rec: any = await c.env.DB.prepare(
    `SELECT id, envelope_id, recipient_email, status, token_expires_at, user_id FROM esign_recipients WHERE signing_token = ?`
  ).bind(token).first();
  if (!rec) return c.json({ error: 'Invalid or expired link' }, 404);
  if (new Date(rec.token_expires_at).getTime() < Date.now()) {
    return c.json({ error: 'This link has expired.' }, 410);
  }
  if (rec.status !== 'pending') {
    return c.json({ error: `Cannot decline — status is ${rec.status}` }, 409);
  }
  await c.env.DB.prepare(`UPDATE esign_recipients SET status = 'rejected' WHERE id = ?`).bind(rec.id).run();
  await c.env.DB.prepare(`UPDATE esign_envelopes SET status = 'rejected' WHERE id = ?`).bind(rec.envelope_id).run();
  await appendAudit(c.env, rec.envelope_id, {
    ts: new Date().toISOString(),
    signer_id: rec.user_id,
    signer_email: rec.recipient_email,
    action: 'envelope_rejected',
    ip: clientIp(c.req.raw),
    meta: { reason },
  });
  return c.json({ rejected: true });
});

export default esign;
