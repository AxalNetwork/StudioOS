/** D4486 (#4486) — venture channel readings and read-only connection cards; no provider calls or credentials. */
import type { Env, User } from '../types';
import { utmSource } from './growCycle';
import { PUBLISH_TARGETS } from '../integrations/publishTargets';

type Row = Record<string, any>;
const rows = async (env: Env, sql: string, ...args: any[]): Promise<Row[]> =>
  (await env.DB.prepare(sql).bind(...args).all<Row>()).results || [];
const nameOf = (v: unknown) => typeof v === 'string' && v.trim() && !v.includes('@') ? v.trim() : null;
const person = (r: Row) => ({ user_id: r.id, name: nameOf(r.name), avatar: r.has_photo ? `/api/settings/headshot/${encodeURIComponent(r.uid)}` : null });

export async function channelMembers(env: Env, pid: number) {
  return (await rows(env, `SELECT u.id, u.uid, u.name, (u.headshot_r2_key IS NOT NULL AND u.headshot_r2_key <> '') AS has_photo FROM users u
    WHERE u.is_active = 1 AND (u.founder_id = (SELECT founder_id FROM projects WHERE id = ?)
      OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ? AND m.user_id = u.id AND m.status = 'accepted'))
    ORDER BY u.name, u.id`, pid, pid)).map(person);
}

/** Attribution is scanned once per venture, never once per channel. Counts without an observed tag stay null. */
export async function channelReadings(env: Env, pid: number) {
  const channels = await rows(env, `SELECT uid, id, name, state, kind, purpose, owner_user_id, utm_source
    FROM growth_channels WHERE project_id = ? ORDER BY name, id`, pid);
  const members = await channelMembers(env, pid);
  const [contactRead, activityRead, campaignRead] = await Promise.allSettled([
    rows(env, "SELECT utm_json, created_at FROM contacts WHERE project_id = ? AND audience = 'customer' AND utm_json IS NOT NULL", pid),
    rows(env, `SELECT channel_id, strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(at))) AS at FROM (
      SELECT channel_id, updated_at AS at FROM content_calendar_items WHERE project_id = ?
      UNION ALL SELECT s.channel_id, s.created_at AS at FROM channel_spend s
        JOIN growth_channels g ON g.id = s.channel_id WHERE g.project_id = ?
      UNION ALL SELECT g.id AS channel_id, f.updated_at AS at FROM mercury_grow_facts f
        JOIN growth_channels g ON g.uid = f.subject AND g.project_id = f.project_id
        WHERE f.project_id = ? AND f.module = 'distribution' AND f.kind IN ('marketing_spend', 'channel_spend')
    ) GROUP BY channel_id`, pid, pid, pid),
    rows(env, `SELECT cc.channel_id, c.uid, c.name FROM grow_campaign_channels cc
      JOIN grow_campaigns c ON c.id = cc.campaign_id
      JOIN growth_channels g ON g.id = cc.channel_id AND g.project_id = c.project_id
      WHERE c.project_id = ? AND c.archived_at IS NULL ORDER BY c.name, c.uid`, pid),
  ]);
  const hits = new Map<string, { count: number; at: string | null }>();
  const latest = (a: string | null, b: string | null) => !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;
  if (contactRead.status === 'fulfilled') for (const r of contactRead.value) {
    const source = utmSource(r.utm_json);
    if (!source) continue;
    const was = hits.get(source);
    hits.set(source, { count: (was?.count || 0) + 1, at: latest(was?.at || null, r.created_at) });
  }
  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const activityByChannel = new Map((activityRead.status === 'fulfilled' ? activityRead.value : []).map((a) => [a.channel_id, a.at]));
  const campaignsByChannel = new Map<number, { uid: string; name: string }[]>();
  if (campaignRead.status === 'fulfilled') for (const c of campaignRead.value) {
    const group = campaignsByChannel.get(c.channel_id) || [];
    group.push({ uid: c.uid, name: c.name }); campaignsByChannel.set(c.channel_id, group);
  }
  return { members, channels: channels.map((r) => {
    const hit = hits.get(r.utm_source);
    const at = activityRead.status === 'fulfilled' && contactRead.status === 'fulfilled'
      ? latest(activityByChannel.get(r.id) || null, hit?.at || null) : null;
    return {
      uid: r.uid, name: r.name, status: r.state, kind: r.kind, purpose: r.purpose, utm_source: r.utm_source,
      owner: memberById.get(r.owner_user_id) || null,
      last_activity: at, last_activity_reason: at ? null : activityRead.status === 'rejected' || contactRead.status === 'rejected'
        ? 'Unreadable: channel activity could not be read.' : 'Not recorded: no content, attributed contact or spend activity.',
      results: hit?.count ?? null, results_reason: hit ? null : contactRead.status === 'rejected'
        ? 'Unreadable: attributed contacts could not be read.' : 'Not recorded: no customer contact has this UTM source.',
      campaigns: campaignRead.status === 'fulfilled' ? campaignsByChannel.get(r.id) || [] : null,
      campaigns_reason: campaignRead.status === 'rejected' ? 'Unreadable: campaign links could not be read.' : null,
    };
  }) };
}

export const NOT_OFFERED = [
  ['linkedin', 'LinkedIn', 'Needs LinkedIn’s approval'], ['meta', 'Meta', 'Not offered yet'],
  ['x', 'X', 'Not offered yet'], ['google_ads_youtube', 'Google Ads · YouTube', 'Not offered yet'],
  ['tiktok', 'TikTok', 'Not offered yet'], ['beehiiv', 'Beehiiv', 'Not offered yet'],
] as const;

/** Only the caller's mailbox/integrations. No private grant is inherited from the venture owner. */
export async function channelConnections(env: Env, user: User, pid: number, support: boolean) {
  const unavailable = (key: string, name: string, reason: string) => ({ key, name, status: 'not_offered', reason, permission: null, identity: null, href: null });
  const fixed: Row[] = NOT_OFFERED.map(([key, name, reason]) => unavailable(key, name, reason));
  if (support) return [...fixed, ...[['email', 'Email'], ['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'], ['mercury', 'Mercury'], ['lovable', 'Lovable sign-ups'], ['publish', 'Publish']]
    .map(([key, name]) => ({ key, name, status: 'unreadable', reason: 'Private connections are unavailable in a support session.', permission: null, identity: null, href: null }))];
  const safe = async (key: string, name: string, href: string, permission: string, read: () => Promise<Row[]>) => {
    try { return await read(); } catch { return [{ key, name, status: 'unreadable', reason: 'Unreadable: this connection could not be read.', permission, identity: null, href }]; }
  };
  const [mail, integrations, lovable, publish] = await Promise.all([
    safe('email', 'Email', '/email', 'Send mail you approve from your own mailbox', async () => {
      const accounts = await rows(env, "SELECT uid, address, status, last_error IS NOT NULL AS failed FROM mail_accounts WHERE user_id = ? AND status <> 'revoked' ORDER BY id", user.id);
      return accounts.length ? accounts.map((a) => ({ key: `email:${a.uid}`, name: 'Email', status: a.status === 'expired' ? 'expired' : a.failed ? 'error' : 'connected',
        reason: a.status === 'expired' ? 'Reconnect this mailbox in Email settings.' : a.failed ? 'The last mailbox check failed. Open Email settings.' : null,
        permission: 'Send mail you approve from your own mailbox', identity: a.address, href: '/email' }))
        : [{ key: 'email', name: 'Email', status: 'not_connected', reason: 'No mailbox connected.', permission: 'Send mail you approve from your own mailbox', identity: null, href: '/email' }];
    }),
    safe('connectors', 'Connectors', '/account/connectors', 'Read existing connections', async () => {
      const own = await rows(env, "SELECT provider_key, status FROM integrations WHERE user_id = ? AND provider_key IN ('whatsapp', 'telegram', 'mercury')", user.id);
      return [['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'], ['mercury', 'Mercury']].map(([key, name]) => {
        const i = own.find((i) => i.provider_key === key);
        return { key, name, status: i?.status === 'active' ? 'connected' : i?.status === 'error' ? 'error' : 'not_connected',
          reason: i?.status === 'error' ? 'The connection needs attention in Connectors.' : null,
          permission: key === 'mercury' ? 'Read spend and results' : 'Interview capture only today', identity: null, href: `/account/connectors/${key}` };
      });
    }),
    safe('lovable', 'Lovable sign-ups', '/build/prototype-mvp', 'Read the linked prototype', async () => {
      const links = await rows(env, 'SELECT uid, last_status FROM lovable_app_links WHERE project_id = ? ORDER BY id', pid);
      return [{ key: 'lovable', name: 'Lovable sign-ups', status: links.some((l) => l.last_status === 'live') ? 'connected' : links.some((l) => l.last_status === 'not_reachable') ? 'error' : 'not_connected',
        reason: links.length ? 'A prototype link does not grant publishing or messaging access.' : 'No prototype link recorded.', permission: 'Read the linked prototype', identity: null, href: '/build/prototype-mvp' }];
    }),
    safe('publish', 'Publish', '/account/connectors', 'Publish only after confirmation', async () => {
      const destinations = await rows(env, `SELECT d.provider_key FROM publish_destinations d
        JOIN integrations i ON i.id = d.integration_id JOIN projects p ON p.company_id = d.company_id
        WHERE p.id = ? AND i.user_id = ? AND i.status = 'active' AND d.enabled = 1`, pid, user.id);
      const connected = destinations.some((d) => PUBLISH_TARGETS.some((p) => p.key === d.provider_key));
      return [{ key: 'publish', name: 'Publish', status: connected ? 'connected' : PUBLISH_TARGETS.length ? 'not_connected' : 'not_offered',
        reason: PUBLISH_TARGETS.length ? null : 'Not offered yet', permission: connected ? 'Publish only after confirmation' : null, identity: null, href: PUBLISH_TARGETS.length ? '/account/connectors' : null }];
    }),
  ]);
  return [...mail, ...integrations, ...lovable, ...publish, ...fixed];
}
