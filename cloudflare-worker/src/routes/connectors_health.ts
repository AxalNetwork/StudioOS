/**
 * D848 (#2469) — the member's connections and their health.
 *   GET /api/connectors/health
 *
 * EACH CONNECTION, PER GRANTED COMPANY. The caller's own `integrations` rows,
 * each with the companies it may write into: an enabled `integration_companies`
 * row for a company the member still belongs to (`companyScope.ts`'s join).
 * A connection that writes no project data has no company and is listed once.
 *
 * HEALTH IS ONE OF FIVE WORDS. `ok`, `degraded`, `expired`, `disconnected` or
 * `error`, with the error's category (`contract.ts`), the time it was checked
 * and the connection's last ten checks, newest first. Never a token, never a
 * provider's message: a check stores only its state and category, and this
 * route reads back only those it recognises.
 *
 * A CHECK IS A REAL CALL, SO IT IS KEPT. Each is one `integration_logs` row
 * (`event_type = 'health'`), so no migration is needed. A check younger than
 * `FRESH_MS` is answered as it stands; an older one is run again, at most
 * `LIVE_CHECKS_PER_REQUEST` per request, so one page load never fans out to
 * every provider at once. The rest answer their last check until the next load.
 *
 * A CONNECTOR WITHOUT AN ADAPTER IS NOT GUESSED. Only GitHub and Stripe
 * implement the contract so far. Any other connection answers `contract:
 * false` and a null state, unless it is plainly disconnected: unknown is null.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { ensureRole } from './integrations';
import {
  ERROR_CATEGORIES,
  HEALTH_STATES,
  getConnectorAdapter,
  healthOfCategory,
  type ErrorCategory,
  type HealthResult,
  type HealthState,
} from '../integrations/contract';
import type { IntegrationRow } from '../integrations/registry';

const r = new Hono<{ Bindings: Env }>();

/** How long a check stands before a page load runs it again. */
export const FRESH_MS = 15 * 60_000;
/** The most provider calls one request makes. */
export const LIVE_CHECKS_PER_REQUEST = 5;
/** How many past checks each connection shows. */
export const RECENT_CHECKS = 10;

/** Statuses whose connection still holds a grant to check. */
const LIVE_STATUSES = new Set(['active', 'error']);

export interface HealthCheck {
  /** Null when no check has been run: a connector without an adapter, or one not yet reached. */
  state: HealthState | null;
  checked_at: string | null;
  error_category: ErrorCategory | null;
}

const UNCHECKED: Readonly<HealthCheck> = Object.freeze({ state: null, checked_at: null, error_category: null });

/** What a check row stores in `response_summary`: the state, and its category when it has one. */
export function encodeCheck(h: HealthResult): string {
  return h.error_category ? `${h.state}:${h.error_category}` : h.state;
}

/** A stored check, read back only when both words are ones the contract knows. */
export function decodeCheck(summary: string | null, checkedAt: string | null): HealthCheck | null {
  const [state, category, extra] = String(summary ?? '').split(':');
  if (extra !== undefined) return null;
  if (!(HEALTH_STATES as readonly string[]).includes(state)) return null;
  if (category !== undefined && !(ERROR_CATEGORIES as readonly string[]).includes(category)) return null;
  return { state: state as HealthState, checked_at: checkedAt, error_category: (category as ErrorCategory | undefined) ?? null };
}

/** SQLite's own timestamp form, so a fresh check and a stored one read alike. */
function sqliteNow(now: number): string {
  return new Date(now).toISOString().replace('T', ' ').slice(0, 19);
}

function ageMs(checkedAt: string | null, now: number): number {
  if (!checkedAt) return Infinity;
  const at = Date.parse(`${checkedAt.replace(' ', 'T')}Z`);
  return Number.isFinite(at) ? now - at : Infinity;
}

async function recordCheck(env: Env, row: IntegrationRow, h: HealthResult, checkedAt: string): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary, created_at) ' +
      "VALUES (?, ?, ?, 'outbound', 'health', ?, ?, ?)",
    ).bind(row.id, row.user_id, row.provider_key, h.state === 'ok' ? 'ok' : 'error', encodeCheck(h), checkedAt).run();
  } catch {
    console.warn('[connectors_health] a check could not be recorded');
  }
}

/** Run one adapter's check. A check that throws is the adapter's error, classified by it. */
async function runCheck(env: Env, row: IntegrationRow): Promise<HealthResult | null> {
  const adapter = getConnectorAdapter(row.provider_key);
  if (!adapter) return null;
  try {
    return await adapter.health({ env, row });
  } catch (e) {
    const category = adapter.classifyError(e);
    console.warn('[connectors_health] check failed', row.provider_key, category);
    return { state: healthOfCategory(category), error_category: category };
  }
}

// GET /api/connectors/health
r.get('/', async (c) => {
  const user = await requireAuth(c);
  ensureRole(c, user);
  const now = Date.now();

  const rows = ((await c.env.DB.prepare(
    'SELECT * FROM integrations WHERE user_id = ? ORDER BY id',
  ).bind(user.id).all<IntegrationRow>()).results || []);

  const grants = ((await c.env.DB.prepare(
    'SELECT ic.integration_id, ic.company_id FROM integration_companies ic JOIN integrations i ON i.id = ic.integration_id ' +
    'JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id ' +
    'WHERE i.user_id = ? AND ic.enabled = 1 ORDER BY ic.company_id',
  ).bind(user.id).all<{ integration_id: number; company_id: number }>()).results || []);

  const logged = ((await c.env.DB.prepare(
    'SELECT integration_id, response_summary, created_at FROM (' +
    'SELECT integration_id, response_summary, created_at, ' +
    'ROW_NUMBER() OVER (PARTITION BY integration_id ORDER BY id DESC) AS rn ' +
    "FROM integration_logs WHERE user_id = ? AND event_type = 'health'" +
    ') WHERE rn <= ? ORDER BY integration_id, rn',
  ).bind(user.id, RECENT_CHECKS).all<{ integration_id: number; response_summary: string | null; created_at: string | null }>()).results || []);

  const checksOf = new Map<number, HealthCheck[]>();
  for (const l of logged) {
    const check = decodeCheck(l.response_summary, l.created_at);
    if (!check) continue;
    const list = checksOf.get(l.integration_id) ?? [];
    list.push(check);
    checksOf.set(l.integration_id, list);
  }

  let liveLeft = LIVE_CHECKS_PER_REQUEST;
  const connections = [];
  for (const row of rows) {
    const adapter = getConnectorAdapter(row.provider_key);
    const checks = checksOf.get(row.id) ?? [];
    let health: HealthCheck;
    if (!LIVE_STATUSES.has(row.status) || !row.credentials_enc) {
      health = { state: 'disconnected', checked_at: null, error_category: null };
    } else if (!adapter) {
      health = { ...UNCHECKED };
    } else if (checks.length && ageMs(checks[0].checked_at, now) < FRESH_MS) {
      health = checks[0];
    } else if (liveLeft > 0) {
      liveLeft -= 1;
      const result = await runCheck(c.env, row);
      const checkedAt = sqliteNow(now);
      if (result) {
        await recordCheck(c.env, row, result, checkedAt);
        health = { state: result.state, checked_at: checkedAt, error_category: result.error_category };
        checks.unshift(health);
        if (checks.length > RECENT_CHECKS) checks.length = RECENT_CHECKS;
      } else {
        health = { ...UNCHECKED };
      }
    } else {
      health = checks[0] ?? { ...UNCHECKED };
    }
    connections.push({
      uid: row.uid,
      provider_key: row.provider_key,
      contract: !!adapter,
      pattern: adapter?.pattern ?? null,
      company_ids: grants.filter((g) => g.integration_id === row.id).map((g) => g.company_id),
      health,
      checks,
    });
  }

  const byCompany = new Map<number, string[]>();
  for (const g of grants) {
    const uid = rows.find((row) => row.id === g.integration_id)?.uid;
    if (!uid) continue;
    byCompany.set(g.company_id, [...(byCompany.get(g.company_id) ?? []), uid]);
  }

  return c.json({
    ok: true,
    connections,
    companies: [...byCompany.entries()].map(([company_id, uids]) => ({ company_id, connections: uids })),
    fresh_seconds: FRESH_MS / 1000,
  });
});

export default r;
