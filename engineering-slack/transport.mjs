// D5665: Slack Web API transport with verified workspace/channel access; no redirects or public fallback.
export function verifiedWorkflowChannel(room, { teamId, hashtag, id }) {
  return Boolean(room && room.id === id && room.name === hashtag.slice(1) &&
    room.is_private === true && room.is_archived === false && room.is_shared === false &&
    room.is_ext_shared === false && room.is_pending_ext_shared === false &&
    (!room.context_team_id || room.context_team_id === teamId) &&
    (!room.shared_team_ids || room.shared_team_ids.every(team => team === teamId)) &&
    !room.pending_shared?.length && !room.pending_connected_team_ids?.length);
}
export function slackTransport({ token, fetchImpl = fetch }) {
  const api = async (method, body, verb = 'POST') => {
    let response;
    try {
      const url = new URL('https://slack.com/api/' + method);
      const options = { method: verb, headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) };
      if (verb === 'GET') {
        url.search = new URLSearchParams(body).toString();
      } else {
        options.headers['content-type'] = 'application/json; charset=utf-8';
        options.body = JSON.stringify(body);
      }
      response = await fetchImpl(url.href, options);
    }
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
    if (channel.hashtag) {
      // users.conversations enumerates the authenticated bot's memberships. A channel rename
      // or external share invalidates the private routing configuration before any message is sent.
      if (!auth.value.bot_id) return { state: 'dead', code: 'workspace_mismatch' };
      let cursor = '', target;
      for (let page = 0; page < 20; page++) {
        const membership = await api('users.conversations', { types: 'private_channel', exclude_archived: 'true', limit: '200', team_id: registry.teamId, cursor }, 'GET');
        if (membership.state !== 'ok') return membership.state === 'ambiguous' ? { state: 'retry', code: 'preflight_unavailable' } : membership;
        if (!Array.isArray(membership.value.channels)) return { state: 'retry', code: 'preflight_unavailable' };
        target = membership.value.channels.find(room => room.id === channel.id);
        if (target) break;
        const next = membership.value.response_metadata?.next_cursor;
        if (!next || next === cursor) break;
        cursor = next;
      }
      if (!verifiedWorkflowChannel(target, { ...channel, teamId: registry.teamId })) return { state: 'dead', code: 'channel_access_mismatch' };
    } else {
      const info = await api('conversations.info', { channel: channel.id });
      if (info.state !== 'ok') return info.state === 'ambiguous' ? { state: 'retry', code: 'preflight_unavailable' } : info;
      if (info.value.channel?.id !== channel.id || info.value.channel.is_archived || !info.value.channel.is_member || Boolean(info.value.channel.is_private) !== channel.private) return { state: 'dead', code: 'channel_access_mismatch' };
    }
    const result = await api(operation === 'update' ? 'chat.update' : 'chat.postMessage', { channel: channel.id, text, ...(operation === 'update' ? { ts } : { client_msg_id: clientId, ...(threadTs ? { thread_ts: threadTs } : {}) }), unfurl_links: false, unfurl_media: false, parse: 'none', link_names: false });
    if (result.state !== 'ok') return result;
    if (result.value.channel !== channel.id || !/^\d{1,20}\.\d{1,10}$/.test(result.value.ts || '')) return { state: 'ambiguous', code: 'receipt_invalid' };
    return { state: 'acknowledged', receipt: { channel: result.value.channel, ts: result.value.ts, transport: 'adapter', status: 200 } };
  };
}
