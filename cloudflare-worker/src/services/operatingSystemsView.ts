/**
 * D5078 (#5078; Build v2 boards BD20 A/B, BD12, BD24 B) — Operating systems'
 * Systems and Tools as the founder reads them: one state per row, the action
 * that state earns, and why a failing connection failed, in words.
 *
 * Pure apart from `toolSyncLines`, which reads `integration_logs` once. The
 * state and the action come from `systemsState.ts` (D5065), so a row here, the
 * record page and the overview card cannot disagree about a connection.
 *
 * Two privacy rules carry over unchanged (D686, D782):
 *   - the owner's name, a connection's own display name, repository names and
 *     a failure's stored words reach the owner and the company's members only;
 *   - Reconnect is the owner's: only the person whose sign-in it is can repair
 *     it, so anyone else sees who owns it (where the first rule allows) instead.
 */
import type { Env } from '../types';
import { CONNECTOR_METADATA, REGISTRY, getDescriptor } from '../integrations/registry';
import { MODULE_LABELS } from '../integrations/moduleLabels';
import { syncArrivals, syncArrivalsText, syncErrorWords } from '../integrations/githubFeeds';
import { NO_COMPANY_REASON } from './connectorBinding';
import { disconnectedReason, systemActionIntent, systemStateOf, type SystemActionIntent, type SystemState } from './systemsState';

/** The Build modules, by their feed keys: a tool that feeds one of these feeds Build. */
export const BUILD_FEED_MODULES = Object.freeze(['solution_design', 'prototype_mvp', 'product_roadmap', 'founding_team', 'company_creation', 'operating_systems']);

/**
 * Tools whose Build part is drawn although the registry claims no feed for them
 * yet (`CONNECTOR_METADATA[..].feeds` lists only shipped inbound landings):
 * Lovable's From Lovable on Prototype / MVP (D1083) and PostHog's lines on
 * Prototype / MVP, Product roadmap and Operating systems (D1606). Each names the
 * modules its part sits on in `frontend/src/pages/cycles/buildParts.jsx`.
 */
export const BUILD_PART_TOOLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  lovable: Object.freeze(['prototype_mvp']),
  posthog: Object.freeze(['prototype_mvp', 'product_roadmap', 'operating_systems']),
});

/** Personal connections, listed only in Connect a tool (the Tools note says so). */
const PERSONAL = new Set(['google_calendar', 'microsoft_365']);

/** The words on a row's button. The record page keeps its longer "Manage connection". */
export const ROW_ACTION_LABEL: Record<SystemActionIntent, string> = { manage: 'Manage', reconnect: 'Reconnect', connect: 'Connect', choose: 'Connect' };

export type RowAction = { intent: SystemActionIntent; text: string; href: string };

const connectHref = (providerKey: string, projectId: number) =>
  `/build/connect?tool=${encodeURIComponent(providerKey)}&project_id=${encodeURIComponent(String(projectId))}`;
const recordHref = (kind: string, projectId: number) =>
  `/build/operating-systems/${encodeURIComponent(kind)}?project_id=${encodeURIComponent(String(projectId))}`;

/** "9 Oct", from a stored timestamp; null when it is not one. */
export function shortDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw.slice(0, 10)) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

/** Bare codes some connectors store as a failure's words, in a member's words. */
const ERROR_CODE_WORDS: Record<string, string> = {
  token_rejected: 'The provider rejected the saved sign-in.',
  mcp_tool_drift: 'The provider’s tools changed since it was connected.',
};
/**
 * Why a connection failed, from its latest failed sync's words: `syncErrorWords`'s
 * rule (the leading code dropped, anything credential-shaped hidden), and a
 * bare code is never shown as an identifier.
 */
export function failureWords(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (Object.hasOwn(ERROR_CODE_WORDS, text)) return ERROR_CODE_WORDS[text];
  if (/^[a-z][a-z0-9_]*$/.test(text)) return 'The sync did not complete.';
  return syncErrorWords(text);
}

/**
 * Each failing connection's latest failed sync words, set on its row as
 * `last_error` (one statement, none when no row is failing). A store that
 * cannot be read leaves the words out: the row then says only that it failed.
 */
export async function withLastFailures(env: Env, connections: ConnectionRow[]): Promise<void> {
  const failing = connections.filter(c => c.id != null && systemStateOf(c, c.status) === 'failing');
  if (!failing.length) return;
  try {
    const logs = (await env.DB.prepare(
      `SELECT integration_id, response_summary FROM integration_logs WHERE id IN (
         SELECT MAX(id) FROM integration_logs WHERE event_type = 'sync' AND status <> 'ok'
            AND integration_id IN (SELECT value FROM json_each(?)) GROUP BY integration_id)`,
    ).bind(JSON.stringify([...new Set(failing.map(c => Number(c.id)))])).all<any>()).results ?? [];
    const words = new Map(logs.map(l => [Number(l.integration_id), l.response_summary as string | null]));
    for (const c of failing) if (words.has(Number(c.id))) c.last_error = words.get(Number(c.id)) ?? null;
  } catch { /* the words stay out; the row still says it failed */ }
}

/** A connection row as the tools and systems reads select it. */
export type ConnectionRow = {
  id?: number | null; user_id: number; provider_key: string; status: unknown;
  last_synced_at?: string | null; last_error_at?: string | null; last_error?: string | null; owner_name?: string | null;
};

/**
 * The action one connection earns, by its state: Connected → Manage, Failing
 * or Reconnect required → Reconnect (its owner only), and why there is none.
 */
export function connectionAction(c: ConnectionRow, state: SystemState, viewerId: number, viewerMember: boolean, href: string | null, manageHref: string | null = href):
  { action: RowAction | null; reason: string | null } {
  if (!href) return { action: null, reason: null };
  const intent = systemActionIntent(state, true);
  if (intent === 'reconnect' && c.user_id !== viewerId) {
    const owner = viewerMember ? c.owner_name ?? null : null;
    return { action: null, reason: owner ? `Only ${owner} can reconnect it.` : 'Only the connection’s owner can reconnect it.' };
  }
  return { action: { intent, text: ROW_ACTION_LABEL[intent], href: intent === 'manage' && manageHref ? manageHref : href }, reason: null };
}

/**
 * Why a connection is not connected, in words: a failure's stored words (to
 * the owner and members; anyone else reads that it failed), or a disconnected
 * connection's reason. Null for a healthy one.
 */
export function connectionWhy(c: ConnectionRow, state: SystemState, sees: boolean): string | null {
  if (state === 'failing') return sees && c.last_error != null ? failureWords(c.last_error) : 'The last sync did not complete.';
  if (state === 'disconnected') return `Reconnect required: ${disconnectedReason(c.status)}.`;
  return null;
}

/** Each feed key a tool names, in words, Build's modules only. */
const buildFeeds = (keys: readonly string[]) => keys.filter(k => BUILD_FEED_MODULES.includes(k)).map(k => MODULE_LABELS[k] ?? k);

/**
 * The registry tools that feed Build and have no enabled connection for the
 * company: what each would feed, and Connect. A tool the catalogue marks
 * coming soon is listed after them as Coming soon, with no action, because
 * the connect route refuses it (Google Workspace and Figma today).
 * `connectedKeys` are the provider keys the company already has enabled.
 */
export function notConnectedTools(connectedKeys: Iterable<string>, projectId: number) {
  const have = new Set(connectedKeys);
  const listed = REGISTRY.filter(d => !PERSONAL.has(d.key) && !have.has(d.key) && /^[a-z0-9_]{1,80}$/.test(d.key))
    .map(d => ({ d, soon: d.status === 'coming_soon', feeds: buildFeeds([...(CONNECTOR_METADATA[d.key]?.feeds ?? []), ...(BUILD_PART_TOOLS[d.key] ?? [])]) }))
    .filter(({ feeds }) => feeds.length > 0);
  return [...listed.filter(t => !t.soon), ...listed.filter(t => t.soon)].map(({ d, soon, feeds }) => ({
    id: `connect-${d.key}`,
    cells: {
      tool: d.display_name, category: CONNECTOR_METADATA[d.key]?.category ?? 'Not recorded', state: soon ? 'Coming soon' : 'Not connected',
      last_sync: null, failed_at: null, feeds: [...new Set(feeds)].join(' · '), owner: null,
      action: soon ? null : { text: ROW_ACTION_LABEL.connect, href: connectHref(d.key, projectId) },
      reason: soon ? 'Not available to connect yet.' : null,
    },
    keys: soon ? { state: 'coming_soon', intent: 'none' } : { state: 'not_connected', intent: 'connect' },
  }));
}

export type SystemKindRow = {
  kind: string; label: string; workspace: boolean;
  /** The mapped connection the read is allowed to see, or null. */
  connection: (ConnectionRow & { display_name?: string | null }) | null;
};

/**
 * BD20 B: the five core systems, one state each driving one line and one
 * action. A kind with nothing mapped is one line, "Connect a provider to
 * start", never three Not recorded facts. Workspace is a capability: it says it
 * records no sync. `next` is the page's one dominant action: reconnect or
 * connect the first system that needs it (BD23).
 */
export function systemsPart(kinds: SystemKindRow[], viewerId: number, viewerMember: boolean, projectId: number) {
  const rows = kinds.map(({ kind, label, workspace, connection: c }) => {
    const state = systemStateOf(c, c?.status);
    const sees = !!c && (c.user_id === viewerId || viewerMember);
    const provider = c ? (c.user_id === viewerId ? c.display_name : getDescriptor(c.provider_key)?.display_name) ?? getDescriptor(c.provider_key)?.display_name ?? c.provider_key : null;
    const synced = shortDate(c?.last_synced_at);
    const line = state === 'not_connected' ? 'Connect a provider to start'
      : workspace ? 'Connected · a workspace connection records no sync'
        : state === 'connected' ? (synced ? `Last good sync ${synced}` : 'Connected · no sync recorded yet')
          : state === 'failing' ? [shortDate(c?.last_error_at) ? `Failing since ${shortDate(c?.last_error_at)}` : 'Failing', synced ? `last good sync ${synced}` : 'no good sync recorded'].join(' · ')
            : `Reconnect required · ${disconnectedReason(c?.status)}`;
    const reconnectHref = c && /^[a-z0-9_]{1,80}$/.test(c.provider_key) ? connectHref(c.provider_key, projectId) : null;
    const { action, reason } = !c
      ? { action: { intent: 'connect' as const, text: ROW_ACTION_LABEL.connect, href: recordHref(kind, projectId) }, reason: null }
      : connectionAction(c, state, viewerId, viewerMember, reconnectHref ?? recordHref(kind, projectId), recordHref(kind, projectId));
    return {
      kind, label, state, provider, line, action,
      why: c ? connectionWhy(c, state, sees) : null,
      reason,
      owner: !c ? null : c.user_id === viewerId ? 'You' : viewerMember ? c.owner_name ?? null : null,
    };
  });
  const count = (s: SystemState) => rows.filter(r => r.state === s).length;
  const first = rows.find(r => r.action?.intent === 'reconnect') ?? rows.find(r => r.action?.intent === 'connect') ?? null;
  return {
    state: 'ok' as const, reason: null, rows,
    summary: { connected: count('connected'), failing: count('failing'), disconnected: count('disconnected'), not_connected: count('not_connected'), total: rows.length },
    next: first?.action ? { text: `${first.action.text} ${first.label}`, href: first.action.href } : null,
  };
}

/** BD20 A: no company yet, so there are no system rows, only the one step first. D8774: the words are `connectorBinding.ts`'s. */
export { NO_COMPANY_REASON };
export const systemsWithoutCompany = () => ({ state: 'not_recorded' as const, reason: NO_COMPANY_REASON, rows: [], summary: null, next: null });

/** How many sync lines Tools shows, newest first, and the label that says the list stops there. */
export const SYNC_LINES = 20;
export const SYNC_LINES_LABEL = `Latest ${SYNC_LINES}`;

const parsed = (raw: string | null): Record<string, unknown> | null => {
  try { const v = JSON.parse(raw || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};

/**
 * D782's sync lines, for every connection enabled for the company (not only
 * GitHub's): one statement, newest first, at most SYNC_LINES, labelled as the
 * latest so the list never reads as the whole history. What arrived is
 * GitHub's ledger words; another provider's line says it synced and that what
 * arrived is not recorded. Repository names follow the owner-and-members rule.
 */
export async function toolSyncLines(env: Env, connections: ConnectionRow[], sees: (userId: number) => boolean) {
  const bounded = { limit: SYNC_LINES, label: SYNC_LINES_LABEL };
  const owners = new Map(connections.filter(c => c.id != null).map(c => [Number(c.id), { user: Number(c.user_id), provider: c.provider_key }]));
  if (!owners.size) return { state: 'empty', rows: [], reason: 'No sync yet.', ...bounded };
  let logs: any[];
  try {
    logs = (await env.DB.prepare(
      `SELECT id, integration_id, status, response_summary, payload_json, created_at FROM integration_logs
        WHERE event_type = 'sync' AND integration_id IN (SELECT value FROM json_each(?))
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(JSON.stringify([...owners.keys()]), SYNC_LINES).all<any>()).results ?? [];
  } catch {
    return { state: 'unreadable', rows: [], reason: 'The sync history could not be read.', ...bounded };
  }
  const lines = logs.map((l) => {
    const owner = owners.get(Number(l.integration_id));
    const github = owner?.provider === 'github';
    const payload = parsed(l.payload_json);
    const failed = l.status !== 'ok';
    const arrived = failed || !github ? [] : syncArrivals(payload);
    const repos = github && Array.isArray(payload?.repositories) ? (payload!.repositories as unknown[]).filter((r): r is string => typeof r === 'string') : null;
    const more = Number.isSafeInteger(payload?.repositories_more) ? Number(payload!.repositories_more) : 0;
    return {
      id: `sync-${l.id}`, at: l.created_at ?? null, provider: getDescriptor(owner?.provider ?? '')?.display_name ?? 'Unknown tool',
      state: failed ? 'failed' : payload?.partial === true ? 'partial' : 'done',
      repositories: repos && sees(owner?.user ?? -1) ? repos : null,
      repositories_more: repos ? more : null,
      arrived: arrived.map(a => ({ module: a.module, label: a.label, count: a.count, stored: a.stored })),
      text: failed ? null : github ? syncArrivalsText(arrived) : 'Not recorded',
      error: failed ? syncErrorWords(l.response_summary) : null,
    };
  });
  return { state: lines.length ? 'ok' : 'empty', rows: lines, reason: lines.length ? null : 'No sync yet.', ...bounded };
}
