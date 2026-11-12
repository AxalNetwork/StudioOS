// D5665: Slack Web API transport with verified workspace/channel access; no redirects or public fallback.
export function slackTransport({ token, fetchImpl = fetch }) {
  const api = async (method, body) => {
    let response;
    try { response = await fetchImpl(`https://slack.com/api/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { return { state: 'ambiguous', code: 'accepted_outcome_unknown' }; }
    if (response.status === 429) return { state: 'retry', code: 'rate_limited', retryAfterMs: Math.max(1, Number(response.headers.get('retry-after')) || 1) * 1000 };
    if (response.status >= 500) return { state: 'retry', code: 'provider_unavailable' };
    if (!response.ok) return { state: 'dead', code: 'destination_refused' };
    let value;
    try { value = await response.json(); } catch { return { state: 'ambiguous', code: 'response_invalid' }; }
    if (!value.ok) return { state: ['ratelimited', 'rate_limited', 'internal_error'].includes(value.error) ? 'retry' : 'dead', code: ['ratelimited', 'rate_limited'].includes(value.error) ? 'rate_limited' : value.error === 'internal_error' ? 'provider_unavailable' : 'destination_refused' };
    return { state: 'ok', value };
  };
  return async ({ registry, channel, text, operation, ts, threadTs, clientId }) => {
    if (!token) return { state: 'retry', code: 'not_configured' };
    const auth = await api('auth.test', {});
    if (auth.state !== 'ok') return auth.state === 'ambiguous' ? { state: 'retry', code: 'preflight_unavailable' } : auth;
    if (auth.value.team_id !== registry.teamId) return { state: 'dead', code: 'workspace_mismatch' };
    const info = await api('conversations.info', { channel: channel.id });
    if (info.state !== 'ok') return info.state === 'ambiguous' ? { state: 'retry', code: 'preflight_unavailable' } : info;
    if (info.value.channel?.id !== channel.id || info.value.channel.is_archived || !info.value.channel.is_member || Boolean(info.value.channel.is_private) !== channel.private) return { state: 'dead', code: 'channel_access_mismatch' };
    const result = await api(operation === 'update' ? 'chat.update' : 'chat.postMessage', { channel: channel.id, text, ...(operation === 'update' ? { ts } : { client_msg_id: clientId, ...(threadTs ? { thread_ts: threadTs } : {}) }), unfurl_links: false, unfurl_media: false, parse: 'none', link_names: false });
    if (result.state !== 'ok') return result;
    if (result.value.channel !== channel.id || !/^\d{1,20}\.\d{1,10}$/.test(result.value.ts || '')) return { state: 'ambiguous', code: 'receipt_invalid' };
    return { state: 'acknowledged', receipt: { channel: result.value.channel, ts: result.value.ts, transport: 'adapter', status: 200 } };
  };
}
