/**
 * D754 (#1982) — the WhatsApp webhook refuses an unsigned body.
 *
 * `POST /api/channels/whatsapp/webhook` checks Meta's `X-Hub-Signature-256`
 * over the raw body before it parses anything (`routes/channels.ts`), and
 * answers 401 when the signature is missing or wrong, and 503 while the app
 * secret is unset (fail closed). The live smoke sends it an unsigned body that
 * would store nothing even if it were accepted (an empty `entry` list), and
 * fails only when the webhook ACCEPTS it: any 2xx. It makes no call to Meta
 * and needs no secret.
 *
 * Pure: the probe takes its `fetch`, so a test hands it a fake.
 */

export const WHATSAPP_WEBHOOK_PATH = '/api/channels/whatsapp/webhook';

/** The unsigned body the probe sends: a WhatsApp envelope with no entries. */
export const UNSIGNED_PROBE_BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

/**
 * What a status says about the guard.
 *   2xx      accepted     — the webhook took an unsigned body: FAIL
 *   401, 403 guarded      — the signature check refused it
 *   503      unconfigured — the secrets are not set yet, so it fails closed
 *   other    other        — not an acceptance; reported, never a failure here
 */
export function webhookGuardVerdict(status) {
  const s = Number(status);
  if (s >= 200 && s < 300) {
    return { ok: false, kind: 'accepted', reason: `the WhatsApp webhook accepted an unsigned body (HTTP ${s}); it must answer 401 or 403` };
  }
  if (s === 401 || s === 403) return { ok: true, kind: 'guarded', reason: null };
  if (s === 503) return { ok: true, kind: 'unconfigured', reason: null };
  return { ok: true, kind: 'other', reason: null };
}

/**
 * POST the unsigned body to one host's webhook and judge the answer. No
 * signature header is ever sent. A request that fails outright answers
 * `{ ok: true, kind: 'unreachable' }`: reachability is the other checks'
 * job, and this one fails only on an acceptance.
 */
export async function probeUnsignedWebhook(base, fetchImpl, { timeoutMs = 15000 } = {}) {
  const url = String(base).replace(/\/$/, '') + WHATSAPP_WEBHOOK_PATH;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'axal-spa-live-smoke' },
      body: UNSIGNED_PROBE_BODY,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { url, status: null, ok: true, kind: 'unreachable', reason: `request failed: ${err?.message || err}` };
  }
  try { await res.body?.cancel?.(); } catch { /* the body is never read */ }
  return { url, status: res.status, ...webhookGuardVerdict(res.status) };
}
