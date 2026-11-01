/**
 * D1496 part 5 (#3844, of #3727; owner Q3 = A) — a team agent may read
 * through its sponsor's approved read tools (D852), and only those.
 *
 * GRANTS. `POST /api/teams/:scope/:id/agents` takes `tool_grants: [{
 * integration_uid, tool }]`. `checkGrants` accepts each only when the server is
 * the SPONSOR's own custom MCP connection (`customRowFor` binds `user_id`), it
 * is connected, and the tool is approved and pinned to the schema the sponsor
 * saw (`grantableTools`). D852 approves only read-annotated tools, and the one
 * write a connection may hold (D1343's mail send) never qualifies.
 *
 * READS. The sponsor names the reads a run makes (`tool_reads`), at most
 * `MAX_TOOL_READS` (5, `MAX_TOOL_CALLS_PER_TURN`); the model chooses none.
 * Each read is re-checked against the grant and the connection now, runs
 * through `callCustomTool` inside `meteredCall` (D844), and its result is cut
 * to `TOOL_RESULT_MAX` (8 KB). The results enter the prompt only through
 * `toolResultsForModel`, the untrusted-data wrapper Eadwyn's tools use.
 *
 * DISCONNECT. A granted server that is gone, not connected, or whose tool is no
 * longer approved at its pinned schema (D852 drift) pauses the agent with
 * `tool_disconnected`, and the run is 409 `tool_disconnected` with `{ server:
 * { uid, name } }`. Nothing is called.
 *
 * Never logged: a tool's arguments or its result.
 */
import type { Env } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { CustomMcpError, callCustomTool, customMcpEnabled, customRowFor, grantableTools, isConnectionUid, type CustomDeps } from '../../integrations/customMcp';
import { MAX_TOOL_CALLS_PER_TURN, toolResultsForModel, type EadwynToolResult } from '../eadwynTools';
import { meteredCall } from '../metering';
import type { AgentRow } from './teams';

export const MAX_TOOL_READS = MAX_TOOL_CALLS_PER_TURN;
export const TOOL_RESULT_MAX = 8 * 1024;
export const MAX_GRANTS = 25;
/** The metered operation of an agent's read through a member's own server. Free in v1, like every MCP read (D844). */
export const AGENT_TOOL_OPERATION = 'agent.custom_tool_read';

export type ToolGrant = { integration_uid: string; tool: string };
export type ToolRead = { integration_uid: string; tool: string; arguments: Record<string, unknown> };
type No = { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };
const no = (status: number, code: string, message: string, extra?: Record<string, unknown>): No => ({ ok: false, status, code, message, ...(extra ? { extra } : {}) });

export function grantsOf(json: string): ToolGrant[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((t) => t && typeof t.integration_uid === 'string' && typeof t.tool === 'string')
      .map((t) => ({ integration_uid: t.integration_uid, tool: t.tool })) : [];
  } catch { return []; }
}

const serverOf = (uid: string, row: Pick<IntegrationRow, 'display_name'> | null) => ({ uid, name: row?.display_name || 'Your MCP server' });

const NOT_APPROVED = 'Only read tools you approved on your own connected MCP servers can be given to an agent.';

/** The grants an add may store, or 422 `tool_not_approved`. `undefined` and `[]` grant nothing. */
export async function checkGrants(env: Env, sponsorId: number, raw: unknown): Promise<{ ok: true; grants: ToolGrant[] } | No> {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return { ok: true, grants: [] };
  if (!Array.isArray(raw) || raw.length > MAX_GRANTS) return no(422, 'tool_not_approved', NOT_APPROVED);
  if (!customMcpEnabled(env)) return no(422, 'tool_not_approved', NOT_APPROVED);
  const out: ToolGrant[] = [];
  const rows = new Map<string, IntegrationRow | null>();
  for (const g of raw) {
    const uid = g && typeof g === 'object' ? (g as any).integration_uid : null;
    const tool = g && typeof g === 'object' ? (g as any).tool : null;
    if (!isConnectionUid(uid) || typeof tool !== 'string' || !tool) return no(422, 'tool_not_approved', NOT_APPROVED);
    // The sponsor's own: `customRowFor` binds user_id, so another member's server is not found.
    if (!rows.has(uid)) rows.set(uid, await customRowFor(env, sponsorId, uid));
    const row = rows.get(uid);
    const offer = row ? grantableTools(row) : null;
    if (!row || !offer || !offer.connected || !offer.tools.includes(tool)) return no(422, 'tool_not_approved', NOT_APPROVED, { integration_uid: uid, tool });
    if (!out.some((x) => x.integration_uid === uid && x.tool === tool)) out.push({ integration_uid: uid, tool });
  }
  return { ok: true, grants: out };
}

/** The granted tools as the profile shows them: each with its server's name and whether it can be read now. */
export async function grantsView(env: Env, a: Pick<AgentRow, 'tool_grants_json' | 'sponsor_user_id'>) {
  const out: { integration_uid: string; tool: string; server: { uid: string; name: string }; status: 'connected' | 'disconnected' }[] = [];
  const rows = new Map<string, IntegrationRow | null>();
  for (const g of grantsOf(a.tool_grants_json)) {
    if (!rows.has(g.integration_uid)) {
      let row: IntegrationRow | null = null;
      try { row = await customRowFor(env, a.sponsor_user_id, g.integration_uid); } catch { row = null; }
      rows.set(g.integration_uid, row);
    }
    const row = rows.get(g.integration_uid) ?? null;
    const offer = row ? grantableTools(row) : null;
    out.push({ ...g, server: serverOf(g.integration_uid, row), status: offer && offer.connected && offer.tools.includes(g.tool) ? 'connected' : 'disconnected' });
  }
  return out;
}

/** The run's `tool_reads`, shaped: an array of granted reads, at most five. */
export function cleanReads(raw: unknown, grants: ToolGrant[]): { ok: true; reads: ToolRead[] } | No {
  if (raw === undefined || raw === null) return { ok: true, reads: [] };
  if (!Array.isArray(raw)) return no(400, 'invalid_tool_reads', 'Tool reads are a list of { integration_uid, tool, arguments }.');
  if (raw.length > MAX_TOOL_READS) return no(422, 'too_many_tool_reads', `An agent reads through at most ${MAX_TOOL_READS} tools in one run.`);
  const reads: ToolRead[] = [];
  for (const r of raw) {
    const uid = r && typeof r === 'object' ? (r as any).integration_uid : null;
    const tool = r && typeof r === 'object' ? (r as any).tool : null;
    const args = r && typeof r === 'object' ? (r as any).arguments : undefined;
    if (typeof uid !== 'string' || typeof tool !== 'string') return no(400, 'invalid_tool_reads', 'Each tool read names its server and its tool.');
    if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) return no(400, 'invalid_tool_reads', 'A tool read\'s arguments are an object.');
    if (!grants.some((g) => g.integration_uid === uid && g.tool === tool)) return no(403, 'tool_not_granted', 'This agent was not given that tool.');
    reads.push({ integration_uid: uid, tool, arguments: (args as Record<string, unknown>) ?? {} });
  }
  return { ok: true, reads };
}

/** A result cut to 8 KB of JSON, said so when cut. */
export function capResult(data: unknown): unknown {
  let text: string;
  try { text = JSON.stringify(data ?? null); } catch { return { unreadable: true }; }
  if (text.length <= TOOL_RESULT_MAX) return data ?? null;
  return { truncated: true, text: text.slice(0, TOOL_RESULT_MAX) };
}

export type ToolDeps = {
  call?: typeof callCustomTool;
  metered?: typeof meteredCall;
  custom?: CustomDeps;
};

export type Disconnected = { ok: false; disconnected: { uid: string; name: string } } ;

/**
 * Check every read's connection first (nothing is called when one is gone),
 * then run them in order, each metered. Answers the wrapped block for the
 * prompt, or the server that disconnected, or a refusal.
 */
export async function readTools(env: Env, a: Pick<AgentRow, 'uid' | 'sponsor_user_id'>, reads: ToolRead[], executionId: string, deps: ToolDeps = {}):
  Promise<{ ok: true; block: string | null; calls: number } | Disconnected | No> {
  if (!reads.length) return { ok: true, block: null, calls: 0 };
  if (!customMcpEnabled(env)) return no(409, 'custom_mcp_off', 'Connected tools are switched off, so this run cannot read them.');
  const rows = new Map<string, IntegrationRow>();
  for (const r of reads) {
    const row = rows.get(r.integration_uid) ?? await customRowFor(env, a.sponsor_user_id, r.integration_uid);
    const offer = row ? grantableTools(row) : null;
    if (!row || !offer?.connected || !offer.tools.includes(r.tool)) return { ok: false, disconnected: serverOf(r.integration_uid, row) };
    rows.set(r.integration_uid, row);
  }
  const call = deps.call ?? callCustomTool;
  const metered = deps.metered ?? meteredCall;
  const results: EadwynToolResult[] = [];
  let n = 0;
  for (const r of reads) {
    const row = rows.get(r.integration_uid)!;
    n += 1;
    try {
      const { value } = await metered(env, {
        userId: a.sponsor_user_id, executionId, operation: AGENT_TOOL_OPERATION, component: `read${n}`, quoteMicrousd: 0, surface: 'mcp',
      }, async () => call(env, row, r.tool, r.arguments, deps.custom ?? {}));
      results.push({ name: r.tool, outcome: 'data', data: capResult(value.data) });
    } catch (e) {
      // A schema changed at the server since it was pinned, or the sign-in was refused: the server is disconnected for this agent.
      if (e instanceof CustomMcpError && (e.code === 'tool_not_approved' || e.code === 'unauthorized' || e.code === 'not_found')) {
        return { ok: false, disconnected: serverOf(r.integration_uid, row) };
      }
      results.push({ name: r.tool, outcome: 'refused', error: 'The tool could not be read.' });
    }
  }
  return { ok: true, block: toolResultsForModel(results), calls: n };
}
