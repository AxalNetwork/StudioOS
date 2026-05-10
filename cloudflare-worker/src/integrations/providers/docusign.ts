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
  const base = (env.APP_URL || '').replace(/\/+$/, '');
  return `${base}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

function ensureCreds(env: Env): { id: string; secret: string } {
  const id = (env as unknown as Record<string, string | undefined>).DOCUSIGN_CLIENT_ID;
  const secret = (env as unknown as Record<string, string | undefined>).DOCUSIGN_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('docusign_oauth_unconfigured: DOCUSIGN_CLIENT_ID/DOCUSIGN_CLIENT_SECRET secrets must be set on the worker.');
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
  const { id, secret } = ensureCreds(env);
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
  const { id, secret } = ensureCreds(env);
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
  return `${baseUri.replace(/\/+$/, '')}/restapi/v2.1`;
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
  const { id } = ensureCreds(c.env);
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
  const webhookUrl = `${opts.appUrl.replace(/\/+$/, '')}/api/integrations/webhook/docusign/${encodeURIComponent(opts.integrationUid)}`;
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
      `UPDATE esign_envelopes SET status = ?, signed_r2_key = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(newStatus, signedKey, local.id).run();
  } else {
    await env.DB.prepare(
      `UPDATE esign_envelopes SET status = ? WHERE id = ?`,
    ).bind(newStatus, local.id).run();
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

// ───────────────────────────────────────────────────────────── disconnect

async function disconnect(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<void> {
  // Best-effort revoke. DocuSign uses /oauth/revoke — failures are non-fatal.
  try {
    const cfg = safeParse(row.config_json);
    const isDemo = cfg.is_demo !== false;
    const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
    const rt = typeof creds?.refresh_token === 'string' ? creds.refresh_token : '';
    if (rt) {
      const { id, secret } = ensureCreds(c.env);
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
    const { decryptWebhookSecret } = await import('../secrets');
    const cur = await decryptWebhookSecret(env, row.uid, row.webhook_secret_enc);
    if (cur) return cur;
  }
  // 32 random bytes, base64url-encoded.
  const buf = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const enc = await encryptWebhookSecret(env, row.uid, b64);
  await env.DB.prepare(
    `UPDATE integrations SET webhook_secret_enc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(enc, row.id).run();
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
};

registerProvider(docusignProvider);
