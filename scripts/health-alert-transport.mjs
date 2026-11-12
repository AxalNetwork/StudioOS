// D5663: the legacy single-channel webhook reports acknowledgement, retry or uncertainty explicitly.
export function webhookDelivery({ url, fetchImpl = fetch }) {
  return async ({ text }) => {
    if (!url) return { state: 'retry', code: 'not_configured' };
    // Incoming webhooks have no message timestamp and cannot support thread destinations.
    let parsed;
    try { parsed = new URL(url); } catch { return { state: 'dead' }; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'hooks.slack.com' || !parsed.pathname.startsWith('/services/')) return { state: 'dead' };
    let response;
    try { response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000), redirect: 'error' }); }
    catch { return { state: 'ambiguous' }; }
    if (response.status === 429) return { state: 'retry', code: 'rate_limited', retryAfterMs: Math.max(1, Number(response.headers.get('retry-after')) || 1) * 1000 };
    if (response.status >= 500) return { state: 'retry', code: 'provider_unavailable' };
    let body;
    try { body = await response.text(); } catch { return { state: 'ambiguous' }; }
    if (response.ok && body.trim() === 'ok') return { state: 'acknowledged', receipt: { transport: 'webhook', status: 200 } };
    return { state: 'dead' };
  };
}
