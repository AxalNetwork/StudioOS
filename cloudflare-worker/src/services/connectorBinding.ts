/**
 * D8774 (#8774) — whether a connected tool feeds THIS venture, named at the
 * three scopes main records, so no page says a module receives data unless
 * every one of them holds:
 *
 *   account  the `integrations` row: the tool is connected to a person's account;
 *   company  an enabled `integration_companies` row for the venture's company,
 *            whose owner still belongs to it (`projectEnabled`'s rule);
 *   venture  for GitHub, the connection's `config.project_id` is this venture and
 *            it has repositories chosen (`syncGithub` refuses anything else).
 *
 * `projectBinding` is pure: the reads hand it what they already selected, and
 * `lastGoodReads` adds the one statement that says when this venture was last
 * read. Q3 option A (D8774, owner pending): a read is Stale as soon as the
 * latest sync failed, and otherwise after STALE_AFTER_HOURS without a good one.
 */
import type { Env } from '../types';
import { CONNECTOR_METADATA } from '../integrations/registry';
import { MODULE_LABELS } from '../integrations/moduleLabels';

export const STALE_AFTER_HOURS = 24;

/** BD20 A: the venture is in no company, so nothing a tool reads can land in it. */
export const NO_COMPANY_REASON = 'This venture is not in a company yet, so no connected tool feeds it.';

export type BindingState =
  | 'no_company' | 'company_off' | 'no_repo' | 'other_venture' | 'failing' | 'not_read' | 'stale' | 'no_items' | 'healthy';

export type ProjectBinding = {
  state: BindingState;
  /** The three scopes, each in a word the page draws as one line of the ladder. */
  scopes: { account: 'connected' | 'failing' | 'disconnected'; company: 'on' | 'off' | 'none'; venture: 'bound' | 'no_repo' | 'other_venture' | 'unknown' };
  /** True only when all three scopes hold: the one condition for saying a module receives data. */
  effective: boolean;
  /** The modules a sync would feed, with no counts: what will feed after sync (BLS03). Empty unless the company scope holds. */
  feeds_after_sync: string[];
  last_good_read: { at: string; source: string; repositories: string[] | null; partial: boolean } | null;
  stale: { since: string | null; hours: number | null } | null;
  reason: string;
};

export type BindingInput = {
  providerKey: string;
  status: unknown;
  /** The venture's company, or null. */
  companyId: number | null;
  /** The connection is enabled for that company and its owner belongs to it. */
  companyEnabled: boolean;
  projectId: number;
  /** The connection's `config_json`, for GitHub's project and repositories. */
  configJson: string | null;
  lastGoodRead: ProjectBinding['last_good_read'];
  /** Items this connection has landed in this venture (`connector_fed_items`). */
  fedTotal: number;
  /** Whether the viewer may read repository names (the owner-and-members rule). */
  sees: boolean;
  now?: number;
};

const configOf = (raw: string | null): Record<string, unknown> => {
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

/** A stored UTC timestamp ("2026-10-18 09:00:00" or ISO) in milliseconds; NaN when it is not one. */
export function storedTime(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return Number.NaN;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
}

/** What a tool would feed in Build, in words, from the registry: no counts. */
export function feedsAfterSync(providerKey: string): string[] {
  return (CONNECTOR_METADATA[providerKey]?.feeds ?? []).map(k => MODULE_LABELS[k] ?? k);
}

/** Only GitHub records which venture it feeds; every other tool feeds its company's ventures. */
const VENTURE_BOUND = new Set(['github']);

export function projectBinding(i: BindingInput): ProjectBinding {
  const status = typeof i.status === 'string' ? i.status.trim().toLowerCase() : '';
  const account = status === 'active' ? 'connected' : status === 'error' ? 'failing' : 'disconnected';
  const company = i.companyId == null ? 'none' : i.companyEnabled ? 'on' : 'off';
  const cfg = configOf(i.configJson);
  const repos = Array.isArray(cfg.repositories) ? cfg.repositories.filter((r): r is string => typeof r === 'string') : [];
  const bound = Number(cfg.project_id);
  const venture = !VENTURE_BOUND.has(i.providerKey) ? 'unknown'
    : Number.isSafeInteger(bound) && bound > 0 && bound !== i.projectId ? 'other_venture'
      : bound === i.projectId && repos.length > 0 ? 'bound' : 'no_repo';
  const scopes = { account, company, venture } as ProjectBinding['scopes'];
  const base = { scopes, last_good_read: i.lastGoodRead, stale: null as ProjectBinding['stale'] };
  const after = company === 'on' ? feedsAfterSync(i.providerKey) : [];
  if (company === 'none') return { ...base, state: 'no_company', effective: false, feeds_after_sync: [], reason: NO_COMPANY_REASON };
  if (company === 'off') {
    return { ...base, state: 'company_off', effective: false, feeds_after_sync: [],
      reason: 'It is connected to its owner’s account but not turned on for this venture’s company, so it feeds nothing here.' };
  }
  if (venture === 'other_venture') {
    return { ...base, state: 'other_venture', effective: false, feeds_after_sync: after,
      reason: 'Its repositories feed another venture in this company. Choose repositories for this venture to feed it instead.' };
  }
  if (venture === 'no_repo') {
    return { ...base, state: 'no_repo', effective: false, feeds_after_sync: after,
      reason: 'No repository is chosen for this venture yet, so nothing has been read. Choose repositories, then sync.' };
  }
  const now = i.now ?? Date.now();
  const lastAt = i.lastGoodRead ? storedTime(i.lastGoodRead.at) : Number.NaN;
  const hours = Number.isFinite(lastAt) ? Math.max(0, Math.floor((now - lastAt) / 3_600_000)) : null;
  if (account !== 'connected') {
    // Q3 A: the latest sync failed, so the last good read is stale from now.
    return { ...base, state: 'failing', effective: true, feeds_after_sync: after,
      stale: { since: i.lastGoodRead?.at ?? null, hours },
      reason: account === 'failing'
        ? (i.lastGoodRead ? 'The latest sync failed. What is shown is from the last good read.' : 'The latest sync failed and this venture has no good read yet.')
        : 'The connection needs reconnecting before it can read this venture again.' };
  }
  if (!i.lastGoodRead) {
    return { ...base, state: 'not_read', effective: true, feeds_after_sync: after,
      reason: 'No sync of this venture is recorded yet. Sync to read it.' };
  }
  if (hours != null && hours >= STALE_AFTER_HOURS) {
    return { ...base, state: 'stale', effective: true, feeds_after_sync: after, stale: { since: i.lastGoodRead.at, hours },
      reason: `The last good read of this venture is ${hours} hours old.` };
  }
  if (i.fedTotal === 0) {
    return { ...base, state: 'no_items', effective: true, feeds_after_sync: after,
      reason: 'The last read found no items for this venture. That is a measured zero, not a missing read.' };
  }
  return { ...base, state: 'healthy', effective: true, feeds_after_sync: after, reason: '' };
}

/** The repositories on a read's log row, for whoever may see them; null otherwise. */
const readRepos = (payload: Record<string, unknown>, sees: boolean) =>
  sees && Array.isArray(payload.repositories) ? (payload.repositories as unknown[]).filter((r): r is string => typeof r === 'string') : null;

/**
 * The last successful read of `projectId` by each connection: one statement.
 * A sync row names its venture (`project_id` on its payload, from D8774 on).
 * An older row that names none is this venture's read only while the
 * connection is bound to it and the row is newer than its latest
 * `repositories_chosen`, which records the venture the choice was for.
 * A log that cannot be read gives no read: the page says Not read, never a date.
 */
export async function lastGoodReads(env: Env, connections: { id: number; config_json: string | null }[], projectId: number, sees: (id: number) => boolean):
  Promise<Map<number, ProjectBinding['last_good_read']>> {
  const out = new Map<number, ProjectBinding['last_good_read']>();
  const ids = connections.filter(c => Number.isSafeInteger(Number(c.id))).map(c => ({ id: Number(c.id), bound: Number(configOf(c.config_json).project_id) === projectId }));
  if (!ids.length) return out;
  const PID = `CASE WHEN json_valid(x.payload_json) THEN json_extract(x.payload_json, '$.project_id') END`;
  try {
    const rows = (await env.DB.prepare(
      `SELECT l.integration_id, l.payload_json, l.created_at FROM integration_logs l
        JOIN (SELECT value AS id FROM json_each(?)) c ON c.id = l.integration_id
        WHERE l.id = (SELECT MAX(x.id) FROM integration_logs x WHERE x.integration_id = l.integration_id AND x.event_type = 'sync' AND x.status = 'ok'
          AND (${PID} = ?
            OR (${PID} IS NULL
              AND x.integration_id IN (SELECT value FROM json_each(?))
              AND x.id > COALESCE((SELECT MAX(r.id) FROM integration_logs r WHERE r.integration_id = x.integration_id AND r.event_type = 'repositories_chosen'), 0)
              AND EXISTS (SELECT 1 FROM integration_logs r WHERE r.integration_id = x.integration_id AND r.event_type = 'repositories_chosen'))))`,
    ).bind(JSON.stringify(ids.map(c => c.id)), projectId, JSON.stringify(ids.filter(c => c.bound).map(c => c.id))).all<any>()).results ?? [];
    for (const r of rows) {
      const payload = configOf(r.payload_json);
      out.set(Number(r.integration_id), {
        at: String(r.created_at), source: 'GitHub sync', repositories: readRepos(payload, sees(Number(r.integration_id))), partial: payload.partial === true,
      });
    }
  } catch { /* no read is said rather than a guessed one */ }
  return out;
}
