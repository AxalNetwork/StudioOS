/**
 * Task #3 — Per-provider OAuth credential dry-run probe.
 *
 * Used by `POST /api/admin/integration-keys/:provider/test` to give an
 * admin a quick "are these creds even recognised by the provider?" check
 * without forcing them through a full user-consent OAuth dance.
 *
 * Strategy: send a deliberately invalid grant request to the provider's
 * token endpoint. We're NOT after a successful token — we're after the
 * provider's error code:
 *   - if the error is `invalid_client` / `invalid_client_id` → creds are
 *     wrong (test fails)
 *   - if the error is `invalid_grant` / `invalid_request` / `bad_verification_code`
 *     etc. → creds are recognised, only our junk code/assertion was rejected
 *     (test passes)
 *
 * Network failure / timeout returns `{ ok: false, reachable: false }` so
 * the UI can distinguish a CF Worker outbound issue from a creds issue.
 */
import type { Env } from '../types';
import { loadOauthCreds, type ManagedProviderKey } from './providerOauthKeys';

export interface ProviderTestResult {
  ok: boolean;
  reachable: boolean;
  http_status?: number;
  provider_error?: string | null;
  detail: string;
}

const TIMEOUT_MS = 7_000;

async function safeFetch(input: string, init: RequestInit): Promise<Response | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function parseJsonSafe(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

// Errors that mean "creds rejected" (test FAILS).
const CLIENT_ERRORS = new Set([
  'invalid_client', 'invalid_client_id', 'unauthorized_client',
  'consumer_key_unknown', 'invalid_consumer_key',
]);
// Errors that mean "creds accepted, only the bogus payload was rejected" (test PASSES).
const GRANT_ERRORS = new Set([
  'invalid_grant', 'invalid_request', 'invalid_code', 'bad_verification_code',
  'unsupported_grant_type', 'redirect_uri_mismatch', 'invalid_scope',
  'invalid_redirect_uri', 'invalid_assertion',
]);

function classify(providerError: string | null | undefined, httpStatus: number): boolean {
  const e = String(providerError || '').toLowerCase();
  if (e && CLIENT_ERRORS.has(e)) return false;
  if (e && GRANT_ERRORS.has(e)) return true;
  // No structured error code: treat 4xx with a plausible body as "creds reached
  // the provider", since unknown clients usually 401 with `invalid_client`.
  if (httpStatus >= 200 && httpStatus < 500) return httpStatus !== 401;
  return false;
}

async function testSlack(id: string, secret: string): Promise<ProviderTestResult> {
  const body = new URLSearchParams({
    client_id: id, client_secret: secret,
    code: 'axal-probe-invalid-code', redirect_uri: 'https://axal.invalid/cb',
  });
  const res = await safeFetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res) return { ok: false, reachable: false, detail: 'Network/timeout reaching slack.com' };
  const j = await parseJsonSafe(res);
  // Slack returns `{ ok: false, error: "..." }` (200 with body).
  const err = (j?.error || '').toLowerCase();
  // Slack-specific: `invalid_client_id` / `bad_client_secret` = creds bad.
  if (err === 'bad_client_secret' || err === 'invalid_client_id') {
    return { ok: false, reachable: true, http_status: res.status, provider_error: err,
      detail: 'Slack rejected the client credentials.' };
  }
  if (err === 'invalid_code' || err === 'invalid_grant') {
    return { ok: true, reachable: true, http_status: res.status, provider_error: err,
      detail: 'Slack accepted the client credentials (only the probe code was rejected).' };
  }
  return { ok: classify(err, res.status), reachable: true, http_status: res.status,
    provider_error: err || null, detail: `Slack response: ${err || res.status}` };
}

async function testHubspot(id: string, secret: string): Promise<ProviderTestResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: id, client_secret: secret,
    code: 'axal-probe-invalid-code',
    redirect_uri: 'https://axal.invalid/cb',
  });
  const res = await safeFetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res) return { ok: false, reachable: false, detail: 'Network/timeout reaching hubapi.com' };
  const j = await parseJsonSafe(res);
  const err = (j?.error || '').toLowerCase();
  return { ok: classify(err, res.status), reachable: true, http_status: res.status,
    provider_error: err || null,
    detail: classify(err, res.status)
      ? 'HubSpot accepted the client credentials.'
      : `HubSpot rejected credentials (${err || res.status}).` };
}

async function testSalesforce(id: string, secret: string): Promise<ProviderTestResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: id, client_secret: secret,
    code: 'axal-probe-invalid-code',
    redirect_uri: 'https://axal.invalid/cb',
  });
  const res = await safeFetch('https://login.salesforce.com/services/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res) return { ok: false, reachable: false, detail: 'Network/timeout reaching salesforce.com' };
  const j = await parseJsonSafe(res);
  const err = (j?.error || '').toLowerCase();
  return { ok: classify(err, res.status), reachable: true, http_status: res.status,
    provider_error: err || null,
    detail: classify(err, res.status)
      ? 'Salesforce accepted the consumer key + secret.'
      : `Salesforce rejected credentials (${err || res.status}).` };
}

async function testDocusign(id: string, secret: string): Promise<ProviderTestResult> {
  // DocuSign: probe the OAuth token endpoint with a junk auth_code grant.
  // We use prod by default; the demo env returns the same error codes.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: 'axal-probe-invalid-code',
  });
  const basic = btoa(`${id}:${secret}`);
  const res = await safeFetch('https://account.docusign.com/oauth/token', {
    method: 'POST',
    headers: {
      'authorization': `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res) return { ok: false, reachable: false, detail: 'Network/timeout reaching docusign.com' };
  const j = await parseJsonSafe(res);
  const err = (j?.error || '').toLowerCase();
  return { ok: classify(err, res.status), reachable: true, http_status: res.status,
    provider_error: err || null,
    detail: classify(err, res.status)
      ? 'DocuSign accepted the integration key + secret.'
      : `DocuSign rejected credentials (${err || res.status}).` };
}

export async function testOauthCreds(
  env: Env,
  providerKey: ManagedProviderKey,
): Promise<ProviderTestResult> {
  const cred = await loadOauthCreds(env, providerKey);
  if (!cred) {
    return { ok: false, reachable: false, detail: 'No credentials configured for this provider.' };
  }
  switch (providerKey) {
    case 'slack':      return testSlack(cred.id, cred.secret);
    case 'hubspot':    return testHubspot(cred.id, cred.secret);
    case 'salesforce': return testSalesforce(cred.id, cred.secret);
    case 'docusign':   return testDocusign(cred.id, cred.secret);
  }
}
