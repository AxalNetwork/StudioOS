/**
 * Task #2 — DocuSign e-sign provider (Live, Studio tier).
 *
 * Two-way bridge between the in-house e-sign tables (esign_envelopes /
 * esign_recipients / esign_audit_events) and DocuSign:
 *
 *   1. Outbound — when an admin sends an envelope and the user has a
 *      connected DocuSign integration, we POST the document to
 *      `/restapi/v2.1/accounts/<accountId>/envelopes` and persist the
 *      returned DocuSign envelope id alongside the local row
 *      (esign_envelopes.provider='docusign', .docusign_envelope_id=…).
 *      The recipient signs in DocuSign's UI (no in-house token).
 *
 *   2. Inbound — DocuSign Connect POSTs envelope status updates to
 *      `/api/integrations/webhook/docusign/<uid>`. We HMAC-verify the
 *      `X-DocuSign-Signature-1` header against the connection's webhook
 *      secret, look up the local row by `docusign_envelope_id`, and
 *      flip its status / fetch the signed PDF into R2.
 *
 *   3. Reconcile — hourly cron (`syncAllDocusignIntegrations`) polls
 *      every still-in-flight envelope so a missed Connect delivery
 *      can't leave us stuck on `sent` forever.
 *
 * Auth: OAuth2 Authorization Code grant. Demo accounts use
 * `account-d.docusign.com`, production uses `account.docusign.com`. The
 * environment is selected via the `is_demo` flag persisted in
 * `oauth_state_tokens.extra_json` (defaults to demo so a developer
 * without prod credentials still gets a working flow).
 *
 * Required env secrets (per-environment): `DOCUSIGN_CLIENT_ID`,
 * `DOCUSIGN_CLIENT_SECRET`. The optional `DOCUSIGN_CONNECT_HMAC` env
 * var, when set on the worker side, is used as the FALLBACK webhook
 * secret if the per-connection webhook_secret column hasn't been
 * configured yet (e.g. the user copy-pasted the same secret DocuSign
 * Admin generates for the whole account).
 *
 * IMPORTANT: imported once from index.ts so registerProvider() runs at boot.
 */
import type { Context } from 'hono';
import { stripTrailingSlashes, callbackBase } from '../../util/url';
import type { Env, User } from '../../types';
import {
  registerProvider,
  type ProviderImpl,
  type ConnectInput,
  type ConnectResult,
  type IntegrationRow,
  type SyncResult,
} from '../registry';
import {
  decryptCredentials,
  encryptCredentials,
  encryptWebhookSecret,
  decryptWebhookSecret,
  type CredentialBlob,
} from '../secrets';
import { encryptBytes } from '../../services/cryptoBox';
import { renderAgreementPdf, sha256Hex } from '../../services/pdf';

const PROVIDER_KEY = 'docusign';
const SCOPES = ['signature', 'extended'];
const PROD_AUTH_HOST = 'https://account.docusign.com';
const DEMO_AUTH_HOST = 'https://account-d.docusign.com';

function authHost(isDemo: boolean): string { return isDemo ? DEMO_AUTH_HOST : PROD_AUTH_HOST; }

function redirectUri(env: Env): string {
  const base = callbackBase(env);
  return `${base}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

async function ensureCreds(env: Env): Promise<{ id: string; secret: string }> {
  // Task #7 — env-var FIRST, admin-managed DB row as fallback.
  const { loadOauthCreds } = await import('../../services/providerOauthKeys');
  const cred = await loadOauthCreds(env, 'docusign');
  if (cred) return { id: cred.id, secret: cred.secret };
  const id = (env as unknown as Record<string, string | undefined>).DOCUSIGN_CLIENT_ID;
  const secret = (env as unknown as Record<string, string | undefined>).DOCUSIGN_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('docusign_oauth_unconfigured: DOCUSIGN_CLIENT_ID/DOCUSIGN_CLIENT_SECRET secrets must be set on the worker (or configured via Admin → Integration Keys).');
  }
  return { id, secret };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface UserInfoResponse {
  sub: string;
  name?: string;
  email?: string;
  accounts?: Array<{
    account_id: string;
    account_name?: string;
    is_default?: boolean;
    base_uri: string;     // e.g. https://demo.docusign.net  (NO /restapi suffix)
  }>;
}

function safeParse(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}

// ───────────────────────────────────────────────────────────── token mgmt

async function exchangeCode(env: Env, code: string, isDemo: boolean): Promise<TokenResponse> {
  const { id, secret } = await ensureCreds(env);
  const basic = btoa(`${id}:${secret}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(env),
  });
  const res = await fetch(`${authHost(isDemo)}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`docusign_token_exchange_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as TokenResponse;
}

async function refreshAccessToken(env: Env, refreshToken: string, isDemo: boolean): Promise<TokenResponse> {
  const { id, secret } = await ensureCreds(env);
  const basic = btoa(`${id}:${secret}`);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(`${authHost(isDemo)}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`docusign_refresh_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as TokenResponse;
}

async function fetchUserInfo(accessToken: string, isDemo: boolean): Promise<UserInfoResponse> {
  const res = await fetch(`${authHost(isDemo)}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`docusign_userinfo_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  return await res.json() as UserInfoResponse;
}

async function refreshAndPersist(env: Env, row: IntegrationRow): Promise<string> {
  const cfg = safeParse(row.config_json);
  const isDemo = cfg.is_demo !== false;  // default demo=true
  const lockKey = `docusign:refresh:${row.uid}`;
  const holder = crypto.randomUUID();
  let acquired = false;
  try {
    const cur = await env.RATE_LIMITS.get(lockKey);
    if (!cur) {
      await env.RATE_LIMITS.put(lockKey, holder, { expirationTtl: 30 });
      const verify = await env.RATE_LIMITS.get(lockKey);
      acquired = verify === holder;
    }
  } catch { /* lease infra may be unavailable */ }

  const reread = async (): Promise<CredentialBlob | null> => {
    const fresh = await env.DB.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').bind(row.id).first<{ credentials_enc: string }>();
    if (!fresh?.credentials_enc) return null;
    return await decryptCredentials(env, row.uid, fresh.credentials_enc);
  };

  if (!acquired) {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 500));
      const after = await reread();
      const at = typeof after?.access_token === 'string' ? after.access_token : '';
      const orig = await decryptCredentials(env, row.uid, row.credentials_enc);
      if (at && at !== (orig?.access_token as string | undefined)) return at;
    }
  }

  try {
    const creds = await reread();
    const refreshToken = typeof creds?.refresh_token === 'string' ? creds.refresh_token : '';
    if (!refreshToken) throw new Error('docusign_refresh_token_missing');
    const refreshed = await refreshAccessToken(env, refreshToken, isDemo);
    const newCreds: CredentialBlob = {
      ...creds,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || refreshToken,
      token_type: refreshed.token_type || 'Bearer',
      expires_at: Date.now() + ((refreshed.expires_in || 3600) * 1000),
    } as CredentialBlob;
    const enc = await encryptCredentials(env, row.uid, newCreds);
    await env.DB.prepare(
      'UPDATE integrations SET credentials_enc = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(enc, row.id).run();
    return refreshed.access_token;
  } finally {
    try { if (acquired) await env.RATE_LIMITS.delete(lockKey); } catch {}
  }
}

async function getActiveAccessToken(env: Env, row: IntegrationRow): Promise<string> {
  const creds = await decryptCredentials(env, row.uid, row.credentials_enc);
  if (!creds) throw new Error('docusign_credentials_missing');
  const at = typeof creds.access_token === 'string' ? creds.access_token : '';
  if (!at) throw new Error('docusign_credentials_incomplete');
  const exp = typeof creds.expires_at === 'number' ? creds.expires_at as number : 0;
  if (exp && exp - Date.now() < 60_000) {
    return await refreshAndPersist(env, row);
  }
  return at;
}

function dsApiBase(row: IntegrationRow): string {
  const cfg = safeParse(row.config_json);
  const baseUri = typeof cfg.base_uri === 'string' ? cfg.base_uri : '';
  if (!baseUri) throw new Error('docusign_base_uri_missing');
  return `${stripTrailingSlashes(baseUri)}/restapi/v2.1`;
}

function dsAccountId(row: IntegrationRow): string {
  const cfg = safeParse(row.config_json);
  const id = typeof cfg.account_id === 'string' ? cfg.account_id : '';
  if (!id) throw new Error('docusign_account_id_missing');
  return id;
}

async function dsFetch(env: Env, row: IntegrationRow, path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getActiveAccessToken(env, row);
  const url = path.startsWith('http') ? path : `${dsApiBase(row)}/accounts/${encodeURIComponent(dsAccountId(row))}${path}`;
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    token = await refreshAndPersist(env, row);
    const headers2 = new Headers(init.headers || {});
    headers2.set('Authorization', `Bearer ${token}`);
    if (!headers2.has('Accept')) headers2.set('Accept', 'application/json');
    if (init.body && !headers2.has('Content-Type')) headers2.set('Content-Type', 'application/json');
    res = await fetch(url, { ...init, headers: headers2 });
  }
  return res;
}

// ───────────────────────────────────────────────────────────── connect / oauth

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  const { id } = await ensureCreds(c.env);
  // is_demo is read from oauth_state_tokens.extra_json by the callback;
  // the authorize URL itself depends on it because demo and prod live on
  // different DocuSign account hosts.
  let isDemo = true;
  try {
    const row = await c.env.DB.prepare(
      'SELECT extra_json FROM oauth_state_tokens WHERE state = ?',
    ).bind(state).first<{ extra_json: string | null }>();
    const extra = safeParse(row?.extra_json || null);
    if (extra.is_demo === false) isDemo = false;
  } catch { /* default demo */ }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri(c.env),
    scope: SCOPES.join(' '),
    state,
  });
  return `${authHost(isDemo)}/oauth/auth?${params.toString()}`;
}

async function connect(c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  if (!input.oauth_code) throw new Error('docusign_requires_oauth_code: complete the OAuth handshake first.');
  const cfg = (input.config || {}) as Record<string, unknown>;
  const isDemo = cfg.is_demo !== false;  // default demo
  const tokens = await exchangeCode(c.env, input.oauth_code, isDemo);
  if (!tokens.refresh_token) {
    throw new Error('docusign_no_refresh_token: DocuSign did not return a refresh_token. Reconnect and grant offline access.');
  }
  const userInfo = await fetchUserInfo(tokens.access_token, isDemo);
  const acct = (userInfo.accounts || []).find(a => a.is_default) || (userInfo.accounts || [])[0];
  if (!acct) throw new Error('docusign_no_account_access: the user has no DocuSign accounts.');
  const credentials: CredentialBlob = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || 'Bearer',
    expires_at: Date.now() + ((tokens.expires_in || 28800) * 1000),
  };
  return {
    credentials,
    scopes: SCOPES,
    external_account_id: acct.account_id,
    external_account_name: acct.account_name || userInfo.email || null,
    capabilities: ['Send envelopes', 'Webhook on signed', 'Template library'],
    config: {
      account_id: acct.account_id,
      account_name: acct.account_name || null,
      base_uri: acct.base_uri,
      is_demo: isDemo,
      ds_user_id: userInfo.sub,
      ds_user_email: userInfo.email || null,
    },
  };
}

// ───────────────────────────────────────────────────────────── send envelope

interface SendEnvelopeOpts {
  documentTitle: string;
  documentBody: string;
  recipientEmail: string;
  recipientName: string;
  emailSubject?: string;
  /**
   * Public origin (e.g. `https://axal.vc`) used to build the per-envelope
   * Connect callback URL. We embed `eventNotification` in the send
   * payload so DocuSign POSTs status updates back to us WITHOUT the
   * admin needing to manually configure account-level Connect.
   */
  appUrl: string;
  /** Per-integration HMAC secret DocuSign signs the webhook body with. */
  webhookSecret: string;
  /** Integration row uid — used to build the per-row webhook URL. */
  integrationUid: string;
}

interface SendEnvelopeResult {
  docusign_envelope_id: string;
  status: string;
}

/**
 * Render the agreement body to PDF, base64 it, and POST a single-document
 * single-recipient envelope to DocuSign with a SignHere anchor tab on the
 * literal "_____ESIGN_HERE_____" string we suffix to the body.
 */
export async function sendDocusignEnvelope(
  env: Env,
  row: IntegrationRow,
  opts: SendEnvelopeOpts,
): Promise<SendEnvelopeResult> {
  const ANCHOR = '_____ESIGN_HERE_____';
  const bodyWithAnchor = `${opts.documentBody}\n\nSignature: ${ANCHOR}\n`;
  // renderAgreementPdf requires a signature image — DocuSign handles the
  // actual signing UI so we embed a 1x1 transparent PNG placeholder; the
  // signed PDF we ultimately store is the one DocuSign returns.
  const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
  const bodySha = await sha256Hex(bodyWithAnchor);
  const pdf = await renderAgreementPdf({
    envelopeUuid: 'docusign-pending',
    documentTitle: opts.documentTitle,
    documentBody: bodyWithAnchor,
    signerName: opts.recipientName || opts.recipientEmail,
    signerEmail: opts.recipientEmail,
    signerIp: 'docusign',
    signedAt: new Date().toISOString(),
    signatureDataUrl: TRANSPARENT_PNG,
    bodySha256: bodySha,
  });
  const pdfBase64 = bytesToBase64(pdf);
  // eventNotification — per-envelope Connect subscription. DocuSign POSTs
  // status updates to our worker route, signing the body with HMAC-SHA256
  // keyed off `webhookSecret` (one of the `hmac` entries below). We
  // subscribe to the lifecycle envelope events that affect our local
  // status enum.
  const webhookUrl = `${stripTrailingSlashes(opts.appUrl)}/api/integrations/webhook/docusign/${encodeURIComponent(opts.integrationUid)}`;
  const eventNotification = {
    url: webhookUrl,
    loggingEnabled: 'true',
    requireAcknowledgment: 'true',
    useSoapInterface: 'false',
    includeDocuments: 'false',
    includeEnvelopeVoidReason: 'true',
    includeTimeZone: 'true',
    includeSenderAccountAsCustomField: 'false',
    includeDocumentFields: 'false',
    includeCertificateOfCompletion: 'false',
    envelopeEvents: [
      { envelopeEventStatusCode: 'sent' },
      { envelopeEventStatusCode: 'delivered' },
      { envelopeEventStatusCode: 'completed' },
      { envelopeEventStatusCode: 'declined' },
      { envelopeEventStatusCode: 'voided' },
    ],
    eventData: {
      version: 'restv2.1',
      format: 'json',
      includeData: ['recipients'],
    },
    hmac: [{ key: opts.webhookSecret, active: 'true' }],
  };

  const payload = {
    emailSubject: opts.emailSubject || `Please sign: ${opts.documentTitle}`,
    status: 'sent',
    documents: [{
      documentBase64: pdfBase64,
      name: `${opts.documentTitle}.pdf`,
      fileExtension: 'pdf',
      documentId: '1',
    }],
    recipients: {
      signers: [{
        email: opts.recipientEmail,
        name: opts.recipientName || opts.recipientEmail,
        recipientId: '1',
        routingOrder: '1',
        tabs: {
          signHereTabs: [{
            anchorString: ANCHOR,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '-12',
          }],
        },
      }],
    },
    eventNotification,
  };
  const res = await dsFetch(env, row, '/envelopes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`docusign_envelope_create_failed: ${res.status} ${txt.slice(0, 300)}`);
  }
  const out = await res.json() as { envelopeId?: string; status?: string };
  if (!out.envelopeId) throw new Error('docusign_envelope_create_no_id');
  return { docusign_envelope_id: out.envelopeId, status: out.status || 'sent' };
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ───────────────────────────────────────────────────────────── status mapping

/**
 * DocuSign envelope status → local esign_envelopes.status.
 *
 * Note: DocuSign distinguishes `sent` (recipient notified, not yet
 * opened) from `delivered` (opened by recipient, not yet signed). The
 * local schema doesn't yet have a separate `delivered` enum value, so
 * both are recorded as `sent` for the status column — but the audit
 * event preserves the original DocuSign status string verbatim
 * (`docusign_delivered` vs `docusign_sent`) so the distinction is not
 * lost.
 */
function mapDsStatus(s: string): 'sent' | 'partially_signed' | 'completed' | 'rejected' | 'void' {
  const x = (s || '').toLowerCase();
  if (x === 'completed') return 'completed';
  if (x === 'declined') return 'rejected';
  if (x === 'voided') return 'void';
  if (x === 'delivered') return 'sent'; // see note above
  return 'sent';
}

/**
 * Pull the combined signed PDF for an envelope and store it
 * AES-GCM-encrypted in R2 under the canonical
 * `esign/signed/<envelope_uuid>.pdf.enc` key. The download routes in
 * routes/esign.ts detect the `.enc` suffix and decrypt on the way out
 * with the same `cryptoBox` key (AXAL_ENCRYPTION_SECRET || JWT_SECRET).
 */
async function pullAndStoreSignedPdf(env: Env, _row: IntegrationRow, dsEnvelopeId: string, envelopeUuid: string): Promise<{ key: string; sha256: string } | null> {
  const res = await dsFetch(env, _row, `/envelopes/${encodeURIComponent(dsEnvelopeId)}/documents/combined`);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0) return null;
  const sha = await sha256Hex(new TextDecoder('latin1').decode(buf));
  // Encrypt the executed PDF before R2 put — matches the encrypted-at-rest
  // policy for sensitive contract artifacts (see services/cryptoBox.ts and
  // routes/dd.ts for prior art). The `.enc` suffix is the canonical marker
  // the download routes use to decide whether to decrypt on the way out.
  const ciphertext = await encryptBytes(env, buf);
  const key = `esign/signed/${envelopeUuid}.pdf.enc`;
  if (env.FILES) {
    await env.FILES.put(key, ciphertext, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { inner_content_type: 'application/pdf', encrypted: '1' },
    });
  }
  return { key, sha256: sha };
}

/**
 * Reconcile a single envelope. Idempotent — safe to call from both the
 * Connect webhook and the cron poller.
 */
async function reconcileEnvelope(env: Env, row: IntegrationRow, dsEnvelopeId: string): Promise<{ status: string; updated: boolean }> {
  // Tenant-scoped lookup — only reconcile envelopes that belong to this
  // integration's DocuSign account. Webhook bodies arrive at the
  // per-integration URL so a cross-tenant collision (same envelope id
  // across two accounts is theoretically impossible per DocuSign, but
  // we still scope to avoid surprises if account_id is unset).
  const local = row.external_account_id
    ? await env.DB.prepare(
        `SELECT id, envelope_uuid, status FROM esign_envelopes
          WHERE provider = 'docusign'
            AND docusign_envelope_id = ?
            AND (docusign_account_id IS NULL OR docusign_account_id = ?)`,
      ).bind(dsEnvelopeId, row.external_account_id).first<{ id: number; envelope_uuid: string; status: string }>()
    : await env.DB.prepare(
        `SELECT id, envelope_uuid, status FROM esign_envelopes
          WHERE provider = 'docusign' AND docusign_envelope_id = ?`,
      ).bind(dsEnvelopeId).first<{ id: number; envelope_uuid: string; status: string }>();
  if (!local) return { status: 'unknown', updated: false };
  const res = await dsFetch(env, row, `/envelopes/${encodeURIComponent(dsEnvelopeId)}`);
  if (!res.ok) return { status: local.status, updated: false };
  const env2 = await res.json() as {
    status?: string;
    completedDateTime?: string;
    voidedDateTime?: string;
    voidedReason?: string;
    declinedDateTime?: string;
  };
  const newStatus = mapDsStatus(env2.status || '');
  if (newStatus === local.status) return { status: newStatus, updated: false };

  // Capture decline / void reasons so the admin Contracts UI can render
  // them. DocuSign only fills `voidedReason` for void; declines carry
  // their reason on the recipient resource (we fetch lazily here).
  let stateReason: string | null = null;
  if (newStatus === 'void' && env2.voidedReason) {
    stateReason = String(env2.voidedReason).slice(0, 500);
  } else if (newStatus === 'rejected') {
    try {
      const rRes = await dsFetch(env, row, `/envelopes/${encodeURIComponent(dsEnvelopeId)}/recipients`);
      if (rRes.ok) {
        const rJ = await rRes.json() as { signers?: Array<{ declinedReason?: string }> };
        const reason = (rJ.signers || []).map(s => s.declinedReason).find(Boolean);
        if (reason) stateReason = String(reason).slice(0, 500);
      }
    } catch {}
  }

  let signedKey: string | null = null;
  if (newStatus === 'completed') {
    const stored = await pullAndStoreSignedPdf(env, row, dsEnvelopeId, local.envelope_uuid);
    signedKey = stored?.key || null;
    if (!signedKey) {
      // PDF retrieval failed — DO NOT finalize the envelope status,
      // otherwise the cron sweep (which only polls sent /
      // partially_signed) will never retry the pull and we'd ship a
      // "completed" envelope with no signed artifact. Record the
      // failure on the row and leave status at sent so the next
      // sweep retries.
      try {
        await env.DB.prepare(
          `UPDATE esign_envelopes SET last_error = ? WHERE id = ?`,
        ).bind('docusign_pdf_pull_failed: signed PDF retrieval failed; will retry on next sweep', local.id).run();
      } catch {}
      return { status: local.status, updated: false };
    }

    // Mirror the in-house flow's recipient-side bookkeeping so the audit
    // trail and admin list stay consistent.
    try {
      await env.DB.prepare(
        `UPDATE esign_recipients SET status = 'signed', signed_at = COALESCE(signed_at, CURRENT_TIMESTAMP)
          WHERE envelope_id = ? AND status <> 'rejected'`,
      ).bind(local.id).run();
    } catch {}
  }
  if (newStatus === 'completed' && signedKey) {
    await env.DB.prepare(
      `UPDATE esign_envelopes SET status = ?, signed_r2_key = ?, completed_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?`,
    ).bind(newStatus, signedKey, local.id).run();
  } else {
    // For terminal non-completed states (rejected/void), persist the
    // provider-supplied reason on the envelope row so the admin
    // Contracts UI can render it without trawling audit events.
    if (stateReason && (newStatus === 'rejected' || newStatus === 'void')) {
      await env.DB.prepare(
        `UPDATE esign_envelopes SET status = ?, last_error = ? WHERE id = ?`,
      ).bind(newStatus, stateReason, local.id).run();
    } else {
      await env.DB.prepare(
        `UPDATE esign_envelopes SET status = ? WHERE id = ?`,
      ).bind(newStatus, local.id).run();
    }
  }
  // Append-only audit event for the status transition.
  try {
    await env.DB.prepare(
      `INSERT INTO esign_audit_events (envelope_id, signer_id, signer_email, action, ip, meta)
       VALUES (?, NULL, NULL, ?, 'docusign', ?)`,
    ).bind(
      local.id,
      `docusign_${env2.status || newStatus}`,
      JSON.stringify({
        docusign_envelope_id: dsEnvelopeId,
        ds_status: env2.status,
        ...(stateReason ? { reason: stateReason } : {}),
      }),
    ).run();
  } catch {}
  return { status: newStatus, updated: true };
}

// ───────────────────────────────────────────────────────────── webhook (Connect)

/**
 * DocuSign Connect signs the body with HMAC-SHA256, base64-encoded, and
 * sends one or more `X-DocuSign-Signature-1..N` headers (one per
 * configured HMAC key). We accept a match against ANY of them.
 */
async function verifyWebhook(secret: string, body: string, headers: Headers): Promise<boolean> {
  const provided: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const h = headers.get(`x-docusign-signature-${i}`);
    if (h) provided.push(h.trim());
  }
  if (provided.length === 0) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  for (const p of provided) {
    if (constantTimeEqual(p, expected)) return true;
  }
  return false;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function webhook(c: Context<{ Bindings: Env }>, row: IntegrationRow, body: string, _signature: string | null): Promise<{ summary: string }> {
  // DocuSign Connect supports both XML (legacy) and JSON. We probe for
  // the envelope id in either.
  const dsEnvelopeId = extractEnvelopeId(body);
  if (!dsEnvelopeId) return { summary: 'webhook received (no envelopeId found)' };

  // Replay protection. The signature check (verifyWebhook) confirms the
  // body's authenticity but not its freshness — a captured-and-replayed
  // payload would still pass. We dedupe on a SHA-256 of the raw body
  // scoped to this integration row, with a 24-hour KV TTL. The reconcile
  // path itself is idempotent, but rejecting replays early avoids
  // re-issuing audit-log rows for the same event.
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const dedupeKey = `docusign:webhook:${row.uid}:${hex}`;
    const seen = await c.env.RATE_LIMITS.get(dedupeKey);
    if (seen) return { summary: `replay rejected (docusign_envelope=${dsEnvelopeId})` };
    await c.env.RATE_LIMITS.put(dedupeKey, '1', { expirationTtl: 86400 });
  } catch { /* KV unavailable — fall through to reconcile (still idempotent) */ }

  try {
    const r = await reconcileEnvelope(c.env, row, dsEnvelopeId);
    return { summary: `reconciled docusign_envelope=${dsEnvelopeId} status=${r.status} updated=${r.updated}` };
  } catch (e) {
    // Avoid echoing upstream response bodies into logs — DocuSign error
    // payloads can carry recipient PII. Log only the error class.
    const msg = (e as Error).message || 'unknown';
    const cls = msg.split(':')[0]?.slice(0, 80) || 'reconcile_failed';
    return { summary: `reconcile failed: ${cls}` };
  }
}

function extractEnvelopeId(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      const data = (j.data as Record<string, unknown>) || j;
      const id = (data.envelopeId as string) || ((data.envelopeSummary as Record<string, unknown>)?.envelopeId as string);
      if (typeof id === 'string' && id) return id;
    } catch { /* fall through */ }
  }
  // XML fallback — DocuSign Connect's legacy format.
  const m = /<EnvelopeID>([0-9a-fA-F-]+)<\/EnvelopeID>/.exec(body)
    || /<envelopeId>([0-9a-fA-F-]+)<\/envelopeId>/.exec(body);
  return m ? m[1] : null;
}

// ───────────────────────────────────────────────────────────── sync (cron)

async function sync(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<SyncResult> {
  return { summary: (await syncIntegration(c.env, row)).summary };
}

async function syncIntegration(env: Env, row: IntegrationRow): Promise<{ summary: string; counts: Record<string, number> }> {
  // Reconcile in-flight envelopes scoped to THIS integration's DocuSign
  // account (multi-tenant isolation). The `docusign_account_id` column
  // is populated on send and matched against the integration row's
  // `external_account_id` (which equals the DocuSign accountId returned
  // from /oauth/userinfo at connect time). Without this scoping the
  // sweep would call dsFetch with this row's tokens against envelopes
  // belonging to other tenants and rack up DocuSign 404s.
  if (!row.external_account_id) {
    return { summary: 'skipped (no external_account_id)', counts: { polled: 0, updated: 0, errors: 0 } };
  }
  const inflight = await env.DB.prepare(
    `SELECT docusign_envelope_id FROM esign_envelopes
      WHERE provider = 'docusign'
        AND docusign_envelope_id IS NOT NULL
        AND docusign_account_id = ?
        AND status IN ('sent','partially_signed')
      ORDER BY id DESC LIMIT 100`,
  ).bind(row.external_account_id).all<{ docusign_envelope_id: string }>();
  const counts = { polled: 0, updated: 0, errors: 0 };
  for (const r of (inflight.results || []) as Array<{ docusign_envelope_id: string }>) {
    counts.polled++;
    try {
      const out = await reconcileEnvelope(env, row, r.docusign_envelope_id);
      if (out.updated) counts.updated++;
    } catch { counts.errors++; }
  }
  return { summary: `polled=${counts.polled} updated=${counts.updated} errors=${counts.errors}`, counts };
}

export async function syncAllDocusignIntegrations(env: Env): Promise<{ scanned: number; ok: number; failed: number }> {
  const rows = await env.DB.prepare(
    `SELECT * FROM integrations WHERE provider_key = 'docusign' AND status = 'active'`,
  ).all<IntegrationRow>();
  const list = (rows.results || []) as IntegrationRow[];
  let ok = 0, failed = 0;
  for (const row of list) {
    try {
      await syncIntegration(env, row);
      ok++;
      await env.DB.prepare(
        `UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?`,
      ).bind(row.id).run();
    } catch (e) {
      failed++;
      await env.DB.prepare(
        `UPDATE integrations SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(((e as Error).message || 'sync failed').slice(0, 300), row.id).run();
    }
  }
  return { scanned: list.length, ok, failed };
}

// ───────────────────────────────────────────────────────────── Connect provisioning

// Per-integration Connect name. The uid is appended so two integrations
// on the same DocuSign account never collide on duplicate-name and so
// findExistingConnect cannot mis-adopt another integration's config.
function connectName(row: IntegrationRow): string {
  return `Axal StudioOS (${row.uid})`;
}

/**
 * GET /connect on the account and look up the configuration belonging to
 * this integration. Match is keyed primarily by exact `urlToPublishTo`
 * (which embeds the per-integration uid via `/webhook/docusign/<uid>`)
 * and secondarily by our per-integration `connectName(row)`. We never
 * adopt a configuration whose URL points at a different integration.
 */
async function findExistingConnect(env: Env, row: IntegrationRow, webhookUrl: string): Promise<string | null> {
  try {
    const res = await dsFetch(env, row, '/connect');
    if (!res.ok) return null;
    const j = await res.json() as { configurations?: Array<{ connectId?: string; name?: string; urlToPublishTo?: string }> };
    const list = j.configurations || [];
    const wantName = connectName(row);
    const byUrl = list.find(c => c.urlToPublishTo === webhookUrl);
    if (byUrl?.connectId) return byUrl.connectId;
    const byName = list.find(c => c.name === wantName && c.urlToPublishTo === webhookUrl);
    return byName?.connectId || null;
  } catch {
    return null;
  }
}

/**
 * Register an account-level DocuSign Connect subscription pointing at
 * our per-integration webhook URL, then install our per-integration
 * HMAC secret as the active signing key. Returns the resulting
 * `connectId` so the caller can persist it atomically alongside the
 * webhook secret.
 *
 * Eliminates the manual "DocuSign Admin → Connect → paste URL + secret"
 * step that previously gated webhook delivery. The hourly reconcile cron
 * remains as a safety net for missed Connect deliveries (DocuSign Connect
 * has at-least-once semantics with retries, but our webhook handler
 * dedupes on body SHA-256 — see `webhook()` above).
 *
 * On duplicate-name failure (re-running after a partial success where
 * the create-then-persist sequence was interrupted), we GET /connect,
 * pick the matching configuration, and re-install the HMAC against it
 * rather than failing.
 */
async function provisionConnect(env: Env, row: IntegrationRow, webhookUrl: string, webhookSecret: string): Promise<string> {
  const payload = {
    configurationType: 'custom',
    name: connectName(row),
    urlToPublishTo: webhookUrl,
    allowEnvelopePublish: 'true',
    enableLog: 'true',
    requireMutualTls: 'false',
    signMessageWithX509Cert: 'false',
    includeSenderAccountAsCustomField: 'false',
    includeDocuments: 'false',
    includeCertificateOfCompletion: 'false',
    includeEnvelopeVoidReason: 'true',
    includeTimeZone: 'true',
    useSoapInterface: 'false',
    requiresAcknowledgement: 'true',
    allUsers: 'true',
    envelopeEvents: 'Sent,Delivered,Completed,Declined,Voided',
    eventData: { version: 'restv2.1', format: 'json', includeData: ['recipients'] },
  };
  let connectId: string | null = null;
  const res = await dsFetch(env, row, '/connect', { method: 'POST', body: JSON.stringify(payload) });
  if (res.ok) {
    const out = await res.json() as { connectId?: string };
    connectId = out.connectId || null;
  } else {
    const status = res.status;
    const txt = await res.text();
    // 400/409 most commonly mean "configuration with this name already exists"
    // — recover by adopting the existing one. Anything else is fatal.
    if (status === 400 || status === 409) {
      connectId = await findExistingConnect(env, row, webhookUrl);
    }
    if (!connectId) {
      throw new Error(`docusign_connect_create_failed: ${status} ${txt.slice(0, 200)}`);
    }
  }
  if (!connectId) throw new Error('docusign_connect_create_no_id');

  // Install our per-integration HMAC secret as the active signing key.
  // Our webhook verifier matches against any X-DocuSign-Signature-1..5
  // header, so a leftover legacy key on an adopted configuration would
  // not break us — but we want our secret present and active.
  const hmacRes = await dsFetch(env, row, `/connect/${encodeURIComponent(connectId)}/hmac`, {
    method: 'POST',
    body: JSON.stringify({ active: 'true', value: webhookSecret }),
  });
  if (!hmacRes.ok) {
    const txt = await hmacRes.text();
    throw new Error(`docusign_connect_hmac_failed: ${hmacRes.status} ${txt.slice(0, 200)}`);
  }
  return connectId;
}

async function tearDownConnect(env: Env, row: IntegrationRow): Promise<void> {
  const cfg = safeParse(row.config_json);
  const connectId = typeof cfg.connect_id === 'string' ? cfg.connect_id as string : '';
  if (!connectId) return;
  try {
    const res = await dsFetch(env, row, `/connect/${encodeURIComponent(connectId)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      // Don't echo upstream body — DocuSign errors can carry account context.
      console.warn(`[docusign] connect teardown returned ${res.status}`);
    }
  } catch (e) {
    console.warn('[docusign] tearDownConnect failed:', (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────── postConnect

/**
 * After OAuth completes, provision a DocuSign Connect subscription
 * pointing at `/api/integrations/webhook/docusign/<uid>` and ATOMICALLY
 * persist (a) the per-integration HMAC secret into `webhook_secret_enc`
 * and (b) the resulting `connectId` into `config_json.connect_id`. The
 * secret is intentionally NOT persisted until provisioning succeeds:
 * the "Webhook: Connected" indicator on the IntegrationsPage UI is
 * driven by `has_webhook_secret`, so a half-provisioned state (secret
 * persisted but DocuSign Connect not actually configured) would render
 * a false-positive. With this ordering, `has_webhook_secret=true`
 * implies remote provisioning succeeded.
 *
 * The per-envelope `eventNotification` path in `sendDocusignEnvelope`
 * lazily creates its own secret via `ensureDocusignWebhookSecret` on
 * first send, so the absence of `webhook_secret_enc` after a failed
 * postConnect doesn't break envelope dispatch — it just means the
 * legacy per-envelope flow takes over until provisioning is retried.
 *
 * Single-flight via a KV lease (mirrors `ensureWebhookSubscription` in
 * `providers/calendly.ts`) so two concurrent isolates handling racing
 * OAuth callback retries don't both try to create the Connect
 * configuration. The loser bails immediately; the winner persists.
 */
async function postConnect(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<void> {
  const appUrl = callbackBase(c.env);
  if (!appUrl.startsWith('http')) {
    console.warn('[docusign] postConnect skipped: APP_URL not set');
    return;
  }

  // Re-load fresh row state — `row` is the in-memory copy from
  // registerProvider's connect() return shape and lacks fields like
  // `webhook_secret_enc` and any concurrently-persisted `connect_id`.
  const fresh = await c.env.DB.prepare('SELECT * FROM integrations WHERE id = ?')
    .bind(row.id).first<IntegrationRow>();
  if (!fresh) return;
  const cfg0 = safeParse(fresh.config_json);
  if (typeof cfg0.connect_id === 'string' && cfg0.connect_id) {
    return; // already provisioned by a prior callback
  }

  const lockKey = `docusign:connect_provision:${fresh.uid}`;
  const holder = crypto.randomUUID();
  let acquired = false;
  let kvAvailable = true;
  try {
    const cur = await c.env.RATE_LIMITS.get(lockKey);
    if (cur) {
      // Another isolate is mid-provisioning — bail; it will persist.
      return;
    }
    await c.env.RATE_LIMITS.put(lockKey, holder, { expirationTtl: 60 });
    const verify = await c.env.RATE_LIMITS.get(lockKey);
    acquired = verify === holder;
  } catch {
    // KV infrastructure unavailable — proceed best-effort WITHOUT a
    // lock. The under-lock re-check below + provisionConnect's
    // duplicate-config recovery (findExistingConnect) keep this safe
    // even in the rare two-isolate race; better than silently leaving
    // the integration unprovisioned.
    kvAvailable = false;
  }
  if (kvAvailable && !acquired) return; // legitimately held by another isolate

  try {
    // Re-check under the lock — winner may have already persisted between
    // our first read and lock acquisition.
    const recheck = await c.env.DB.prepare('SELECT * FROM integrations WHERE id = ?')
      .bind(fresh.id).first<IntegrationRow>();
    if (!recheck) return;
    const cfg1 = safeParse(recheck.config_json);
    if (typeof cfg1.connect_id === 'string' && cfg1.connect_id) return;

    const webhookUrl = `${appUrl}/api/integrations/webhook/docusign/${encodeURIComponent(recheck.uid)}`;

    // Reuse any existing per-integration secret (e.g. one already
    // persisted by sendDocusignEnvelope's lazy ensureDocusignWebhookSecret
    // path on a first-send-before-postConnect race). Overwriting it
    // here with a fresh secret would invalidate verification for any
    // in-flight envelope whose eventNotification already embeds the
    // older secret.
    let plaintextSecret: string;
    let secretAlreadyPersisted = false;
    if (recheck.webhook_secret_enc) {
      const existing = await decryptWebhookSecret(c.env, recheck.uid, recheck.webhook_secret_enc);
      if (existing) {
        plaintextSecret = existing;
        secretAlreadyPersisted = true;
      } else {
        // Decrypt failed (corrupted/legacy ciphertext) — generate a new one.
        const buf = crypto.getRandomValues(new Uint8Array(32));
        plaintextSecret = btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
    } else {
      const buf = crypto.getRandomValues(new Uint8Array(32));
      plaintextSecret = btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    let connectId: string;
    try {
      connectId = await provisionConnect(c.env, recheck, webhookUrl, plaintextSecret);
    } catch (e) {
      const msg = ((e as Error).message || 'connect_provision_failed').slice(0, 300);
      try {
        await c.env.DB.prepare(
          'UPDATE integrations SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ).bind(msg, recheck.id).run();
      } catch {}
      console.warn('[docusign] postConnect provisionConnect failed:', msg);
      return;
    }

    // Atomic persist: secret (if not already there) + connect_id + clear
    // last_error in one UPDATE. If this UPDATE fails, the next retry
    // will GET /connect, find the existing configuration by URL, and
    // re-install the HMAC (provisionConnect handles that recovery path).
    try {
      const newCfg = { ...cfg1, connect_id: connectId };
      if (secretAlreadyPersisted) {
        await c.env.DB.prepare(
          'UPDATE integrations SET config_json = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ).bind(JSON.stringify(newCfg), recheck.id).run();
      } else {
        // CAS-style guard: only write the secret if no concurrent writer
        // (e.g. sendDocusignEnvelope) has populated it in the meantime.
        // If they have, drop our generated secret (use theirs) and just
        // record connect_id — provisionConnect already installed our
        // generated secret as the active HMAC, but a follow-up sweep
        // (or the next first-send) will reconcile, and webhook verifier
        // accepts any of X-DocuSign-Signature-1..5.
        const enc = await encryptWebhookSecret(c.env, recheck.uid, plaintextSecret);
        const upd = await c.env.DB.prepare(
          `UPDATE integrations SET webhook_secret_enc = ?, config_json = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND webhook_secret_enc IS NULL`,
        ).bind(enc, JSON.stringify(newCfg), recheck.id).run();
        const changes = (upd.meta as { changes?: number } | undefined)?.changes ?? 0;
        if (changes === 0) {
          // Concurrent writer beat us to webhook_secret_enc — install
          // their secret as an additional active HMAC on the Connect
          // configuration so DocuSign signs with both, and persist
          // connect_id only.
          try {
            const concurrentRow = await c.env.DB.prepare('SELECT webhook_secret_enc FROM integrations WHERE id = ?')
              .bind(recheck.id).first<{ webhook_secret_enc: string | null }>();
            const otherSecret = concurrentRow?.webhook_secret_enc
              ? await decryptWebhookSecret(c.env, recheck.uid, concurrentRow.webhook_secret_enc)
              : null;
            if (otherSecret && otherSecret !== plaintextSecret) {
              const hmacRes = await dsFetch(c.env, recheck, `/connect/${encodeURIComponent(connectId)}/hmac`, {
                method: 'POST',
                body: JSON.stringify({ active: 'true', value: otherSecret }),
              });
              if (!hmacRes.ok) {
                console.warn('[docusign] postConnect: secondary HMAC install non-2xx', hmacRes.status);
              }
            }
          } catch (e) {
            console.warn('[docusign] postConnect: secondary HMAC install threw:', (e as Error).message);
          }
          await c.env.DB.prepare(
            'UPDATE integrations SET config_json = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ).bind(JSON.stringify(newCfg), recheck.id).run();
        }
      }
    } catch (e) {
      const msg = ((e as Error).message || 'connect_persist_failed').slice(0, 300);
      try {
        await c.env.DB.prepare(
          'UPDATE integrations SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ).bind(msg, recheck.id).run();
      } catch {}
      console.warn('[docusign] postConnect persist failed:', msg);
    }
  } finally {
    try { if (acquired) await c.env.RATE_LIMITS.delete(lockKey); } catch {}
  }
}

// ───────────────────────────────────────────────────────────── disconnect

async function disconnect(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<void> {
  // Tear down the Connect subscription FIRST — once the OAuth token is
  // revoked we lose the ability to call DocuSign on this account's behalf.
  await tearDownConnect(c.env, row);
  // Best-effort revoke. DocuSign uses /oauth/revoke — failures are non-fatal.
  try {
    const cfg = safeParse(row.config_json);
    const isDemo = cfg.is_demo !== false;
    const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
    const rt = typeof creds?.refresh_token === 'string' ? creds.refresh_token : '';
    if (rt) {
      const { id, secret } = await ensureCreds(c.env);
      const basic = btoa(`${id}:${secret}`);
      await fetch(`${authHost(isDemo)}/oauth/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({ token: rt }),
      }).catch(() => {});
    }
  } catch { /* non-fatal */ }
}

/**
 * Look up an active DocuSign integration row owned by `userId`. Used by
 * the in-house e-sign send path to opportunistically route through
 * DocuSign when the admin/user has a connected account.
 */
export async function findActiveDocusignIntegrationForUser(env: Env, userId: number): Promise<IntegrationRow | null> {
  const r = await env.DB.prepare(
    `SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'docusign' AND status = 'active' LIMIT 1`,
  ).bind(userId).first<IntegrationRow>();
  return r || null;
}

/**
 * Lazily generate + persist a per-integration HMAC webhook secret, so
 * the very first send-envelope call provisions Connect with a fresh
 * secret. The plaintext secret is returned ONCE to the caller (to embed
 * in the DocuSign `eventNotification.hmac` block) and the ciphertext is
 * persisted in `integrations.webhook_secret_enc` for later verifyWebhook
 * lookups. Subsequent sends decrypt the existing secret instead of
 * rotating it.
 */
export async function ensureDocusignWebhookSecret(env: Env, row: IntegrationRow): Promise<string> {
  if (row.webhook_secret_enc) {
    const cur = await decryptWebhookSecret(env, row.uid, row.webhook_secret_enc);
    if (cur) return cur;
  }
  // 32 random bytes, base64url-encoded.
  const buf = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const enc = await encryptWebhookSecret(env, row.uid, b64);
  // CAS-style write: only persist if no concurrent writer (postConnect or
  // a parallel sendDocusignEnvelope in another isolate) has already
  // populated webhook_secret_enc. On CAS miss, decrypt-and-return their
  // secret so the caller embeds the secret that's actually persisted —
  // never split-brain on the active HMAC for envelope verification.
  const upd = await env.DB.prepare(
    `UPDATE integrations SET webhook_secret_enc = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND webhook_secret_enc IS NULL`,
  ).bind(enc, row.id).run();
  const changes = (upd.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (changes === 0) {
    const fresh = await env.DB.prepare('SELECT webhook_secret_enc FROM integrations WHERE id = ?')
      .bind(row.id).first<{ webhook_secret_enc: string | null }>();
    if (fresh?.webhook_secret_enc) {
      const cur = await decryptWebhookSecret(env, row.uid, fresh.webhook_secret_enc);
      if (cur) {
        row.webhook_secret_enc = fresh.webhook_secret_enc;
        return cur;
      }
    }
    // Concurrent row had ciphertext we can't decrypt (corrupted/legacy);
    // overwrite with our freshly generated secret to recover.
    await env.DB.prepare(
      `UPDATE integrations SET webhook_secret_enc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(enc, row.id).run();
  }
  // Mutate the in-memory row so subsequent reads in the same request see it.
  row.webhook_secret_enc = enc;
  return b64;
}

// ───────────────────────────────────────────────────────────── register

const docusignProvider: ProviderImpl = {
  key: PROVIDER_KEY,
  connect,
  sync,
  webhook,
  disconnect,
  buildAuthorizeUrl,
  verifyWebhook,
  postConnect,
};

registerProvider(docusignProvider);
