/** Verify an operator-configured private section channel and send a fixed receipt test (#5679). */
import type { Env } from '../types';
import { postSlackMessage } from './slackBus';

const slugPattern = /^axalvc-(superadmin|admin|founder|investor|partner|advisor|explorer|all)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const channelIdPattern = /^[CG][A-Z0-9]{8,31}$/;
const teamIdPattern = /^T[A-Z0-9]{8,31}$/;
type Failure = 'unknown_section' | 'unconfigured' | 'invalid_configuration' | 'workspace_mismatch' |
  'destination_unverified' | 'rate_limited' | 'provider_unavailable' | 'post_rejected' | 'receipt_unconfirmed';
type Result = { ok: true; channel: string; ts: string } | { ok: false; reason: Failure; retry_after_seconds?: number };
type Bindings = Pick<Env, 'SLACK_BOT_TOKEN' | 'AXAL_SECTION_SLACK_TEAM_ID' | 'AXAL_SECTION_SLACK_CHANNELS'>;

async function slackRead(token: string, path: string, method: 'GET' | 'POST' = 'GET'): Promise<Response> {
  return fetch('https://slack.com/api/' + path, {
    method, headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
}

function readFailure(response: Response): Result {
  const retry = response.headers.get('retry-after');
  return response.status === 429
    ? { ok: false, reason: 'rate_limited', ...(retry && /^\d{1,7}$/.test(retry) ? { retry_after_seconds: Number(retry) } : {}) }
    : { ok: false, reason: 'provider_unavailable' };
}

interface Channel {
  id: string; name: string; is_channel?: boolean; is_group?: boolean; is_archived?: boolean; is_private?: boolean;
  is_shared?: boolean; is_ext_shared?: boolean; is_pending_ext_shared?: boolean; context_team_id?: string;
  shared_team_ids?: string[]; pending_shared?: string[]; pending_connected_team_ids?: string[];
}

function matchesDestination(c: Channel, slug: string, team: string): boolean {
  return c.name === slug && (c.is_channel === true || c.is_group === true) &&
    c.is_archived === false && c.is_private === true && c.is_shared === false &&
    c.is_ext_shared === false && c.is_pending_ext_shared === false &&
    (!c.context_team_id || c.context_team_id === team) &&
    (!c.shared_team_ids || c.shared_team_ids.every(id => id === team)) &&
    !c.pending_shared?.length && !c.pending_connected_team_ids?.length;
}

type ThreadReceipt = { channel: string; ts: string };

export function sendSectionPreview(env: Bindings, slug: string): Promise<Result> {
  const match = slugPattern.exec(slug);
  if (!match || slug.length > 80) return Promise.resolve({ ok: false, reason: 'unknown_section' });
  return sendVerifiedSection(env, slug, `[axalvc][${match[1]}][${match[2]}][test] Section notification delivery check from StudioOS.`);
}

/** Trusted D1 capacity transitions from the existing HQ sweep, including the original recovery thread. */
export function sendCapacityNotice(env: Bindings, transition: { stage: 'firing' } | { stage: 'recovery'; root: ThreadReceipt }) {
  const slug = 'axalvc-superadmin-platform';
  if (transition.stage === 'firing') return sendVerifiedSection(env, slug,
    '[axalvc][superadmin][platform][capacity][incident] HQ database size crossed its configured alert threshold. Open HQ Platform at /admin/platform.');
  return sendVerifiedSection(env, slug,
    '[axalvc][superadmin][platform][capacity][recovery] HQ database size returned within its configured threshold. Open HQ Platform at /admin/platform.', transition.root);
}

async function sendVerifiedSection(env: Bindings, slug: string, text: string, thread?: ThreadReceipt): Promise<Result> {
  const { SLACK_BOT_TOKEN: token, AXAL_SECTION_SLACK_TEAM_ID: team, AXAL_SECTION_SLACK_CHANNELS: raw } = env;
  if (!token || !team || !raw) return { ok: false, reason: 'unconfigured' };
  if (!teamIdPattern.test(team)) return { ok: false, reason: 'invalid_configuration' };
  let routes: Record<string, unknown>;
  try {
    routes = JSON.parse(raw);
  } catch { return { ok: false, reason: 'invalid_configuration' }; }
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return { ok: false, reason: 'invalid_configuration' };
  if (!Object.hasOwn(routes, slug)) return { ok: false, reason: 'unknown_section' };
  const channelId = routes[slug];
  if (typeof channelId !== 'string' || !channelIdPattern.test(channelId)) return { ok: false, reason: 'invalid_configuration' };

  if (thread && (thread.channel !== channelId || !/^\d{1,16}\.\d{6}$/.test(thread.ts))) {
    return { ok: false, reason: 'destination_unverified' };
  }
  // users.conversations lists the authenticated principal's memberships. This
  // also works when Slack omits is_member from the conversations.info response.
  try {
    const auth = await slackRead(token, 'auth.test', 'POST');
    if (!auth.ok) return readFailure(auth);
    const identity = await auth.json<{ ok?: boolean; team_id?: string; bot_id?: string }>();
    if (!identity.ok) return { ok: false, reason: 'provider_unavailable' };
    if (identity.team_id !== team || !identity.bot_id) return { ok: false, reason: 'workspace_mismatch' };
    let cursor = '';
    let verified = false;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ types: 'private_channel', exclude_archived: 'true', limit: '200', team_id: team });
      if (cursor) query.set('cursor', cursor);
      const response = await slackRead(token, 'users.conversations?' + query);
      if (!response.ok) return readFailure(response);
      const list = await response.json<{ ok?: boolean; channels?: Channel[]; response_metadata?: { next_cursor?: string } }>();
      if (!list.ok || !Array.isArray(list.channels)) return { ok: false, reason: 'provider_unavailable' };
      const room = list.channels.find(c => c.id === channelId);
      if (room) { verified = matchesDestination(room, slug, team); break; }
      const next = list.response_metadata?.next_cursor;
      if (!next || next === cursor) break;
      cursor = next;
    }
    if (!verified) return { ok: false, reason: 'destination_unverified' };
  } catch { return { ok: false, reason: 'provider_unavailable' }; }

  const result = await postSlackMessage(token, channelId, {
    text, thread_ts: thread?.ts,
  }, AbortSignal.timeout(5000));
  if (!result.ok) {
    if (result.status === 429) return { ok: false, reason: 'rate_limited', retry_after_seconds: result.retry_after_seconds };
    return { ok: false, reason: result.reason === 'slack_error' && result.slack_error ? 'post_rejected' : 'receipt_unconfirmed' };
  }
  if (result.channel !== channelId || !result.ts || !/^\d{1,16}\.\d{6}$/.test(result.ts)) {
    return { ok: false, reason: 'receipt_unconfirmed' };
  }
  return { ok: true, channel: channelId, ts: result.ts };
}
