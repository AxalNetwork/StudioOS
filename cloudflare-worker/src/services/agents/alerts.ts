/**
 * #3851 (E7 of #3742, under D1528) — the agent engine's alerts, in-app through
 * `notify()`. Each fires once per its window; the window is a KV key
 * (`RATE_LIMITS`, `agents:alert:…`) written before the notice goes out, so a
 * second sweep in the same window finds it and stays quiet.
 *
 *   alert                          to              once per
 *   an agent at 80% of its cap     sponsor + team  agent, UTC month
 *   an agent at 100% of its cap    sponsor + team  agent, UTC month
 *   a task blocked after 3 tries   sponsor + team  task
 *   an approval waiting 3 days     sponsor + team  proposal
 *   DLQ arrivals (agent runs)      HQ ops          new rows (a high-water mark)
 *   the halt set or cleared        HQ              each change (the route)
 *   the `agents` gateway at 70%    HQ ops          UTC month
 * Every pause reason already alerts: `pauseAgent` → `notifyPauseOnce`
 * (`src/agents/engine.ts`, once per agent, reason and UTC day).
 *
 * The gateway's limit lives in the Cloudflare dashboard, which the Worker
 * cannot read; `AGENT_GATEWAY_MONTHLY_LIMIT_MICROUSD` mirrors it. Unset, the
 * 70% alert is off (the gateway itself still stops runs at 100%: the circuit
 * breaker in `agentRun`).
 *
 * A spend that cannot be read alerts nothing: an unknown sum is not 80%.
 * `sweepAgentAlerts` runs from the agent sweep's minute (`index.ts`, % 5 === 1).
 * Bound SQL only; names and codes in notices, never an email or a prompt.
 */
import type { Env } from '../../types';
import { notify } from '../notify';
import { monthStart, type AgentRow } from './teams';
import { tellTeam } from '../../agents/engine';
import { DISCARDS_MAX } from '../../agents/loop';
import { OPEN_TOO_LONG_DAYS, sqlTime } from './evaluation';

export const CAP_THRESHOLDS = [80, 100] as const;
export const GATEWAY_THRESHOLD = 70;
/** At most this many of each kind per sweep; the rest wait for the next. */
export const ALERTS_PER_SWEEP = 50;
const DAY = 86_400;

const monthKey = (now: Date) => now.toISOString().slice(0, 7);

/**
 * Mark `key` and say whether this call was the first. A key already there means
 * the window's alert went out. A KV that cannot be written still alerts: a
 * repeated notice is better than a missed one.
 */
export async function firstInWindow(env: Pick<Env, 'RATE_LIMITS'>, key: string, ttlSeconds: number): Promise<boolean> {
  try {
    if (await env.RATE_LIMITS.get(key)) return false;
    await env.RATE_LIMITS.put(key, '1', { expirationTtl: ttlSeconds });
  } catch { /* alert anyway */ }
  return true;
}

/** HQ: the platform's active admins, at most 20. */
export async function hqToTell(env: Env): Promise<number[]> {
  try {
    const r = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 20").all<{ id: number }>();
    return (r.results ?? []).map((x) => Number(x.id));
  } catch { return []; }
}

export async function tellHq(env: Env, n: { type: string; title: string; body: string; link?: string | null }): Promise<number> {
  let told = 0;
  for (const userId of await hqToTell(env)) {
    try {
      await notify(env, { userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null, channels: ['in_app'], category: 'proactive_nudges' });
      told += 1;
    } catch { /* one inbox never stops the others */ }
  }
  return told;
}

const nameOf = (a: Pick<AgentRow, 'first_name' | 'last_name' | 'role_key'>) =>
  [a.first_name, a.last_name].filter(Boolean).join(' ') || a.role_key;

export type AlertDeps = { tellTeam: typeof tellTeam; tellHq: typeof tellHq };
const DEFAULT_DEPS: AlertDeps = { tellTeam, tellHq };
export type AlertCounts = { cap_80: number; cap_100: number; blocked: number; waiting: number; dlq: number; gateway_70: number };

/** Caps: each agent with a cap and this month's known spend at or past a threshold, once a month per threshold. */
async function capAlerts(env: Env, now: Date, d: AlertDeps, out: AlertCounts) {
  const rows = (await env.DB.prepare(
    `SELECT a.*, COUNT(l.id) AS runs,
            SUM(CASE WHEN l.charged_microusd IS NOT NULL THEN l.charged_microusd END) AS charged,
            SUM(CASE WHEN l.charged_microusd IS NULL THEN 1 ELSE 0 END) AS unknown
       FROM team_agents a JOIN ai_usage_logs l ON l.agent_id = a.id AND l.created_at >= ?
      WHERE a.status != 'removed' AND a.monthly_cap_microusd > 0
      GROUP BY a.id ORDER BY a.id LIMIT ?`,
  ).bind(monthStart(now), ALERTS_PER_SWEEP).all<AgentRow & { runs: number; charged: number | null; unknown: number | null }>()).results ?? [];
  for (const a of rows) {
    if (Number(a.unknown) > 0 || !Number(a.runs)) continue;
    const pct = (Number(a.charged) / Number(a.monthly_cap_microusd)) * 100;
    for (const t of CAP_THRESHOLDS) {
      if (pct < t) continue;
      if (!(await firstInWindow(env, `agents:alert:cap${t}:${a.id}:${monthKey(now)}`, 40 * DAY))) continue;
      await d.tellTeam(env, a, t === 100
        ? { type: 'agent_cap_reached', title: `${nameOf(a)} reached its monthly cap`, body: `${nameOf(a)} has spent its whole monthly cap. It will not run again this month unless an editor raises the cap.` }
        : { type: 'agent_cap_near', title: `${nameOf(a)} is near its monthly cap`, body: `${nameOf(a)} has spent ${t}% of its monthly cap.` });
      if (t === 100) out.cap_100 += 1; else out.cap_80 += 1;
    }
  }
}

/** Tasks an agent's work was discarded on three times: they wait for a person. Once per task. */
async function blockedAlerts(env: Env, d: AlertDeps, out: AlertCounts) {
  const rows = (await env.DB.prepare(
    `SELECT t.id AS task_id, t.title, a.* FROM scope_tasks t JOIN team_agents a ON a.id = t.assignee_agent_id
      WHERE t.assignee_kind = 'agent' AND t.status = 'blocked' AND t.blocked_reason = 'needs_person' AND t.attempts >= ?
        AND a.status != 'removed'
      ORDER BY t.id LIMIT ?`,
  ).bind(DISCARDS_MAX, ALERTS_PER_SWEEP).all<AgentRow & { task_id: number; title: string }>()).results ?? [];
  for (const r of rows) {
    if (!(await firstInWindow(env, `agents:alert:blocked:${r.task_id}`, 90 * DAY))) continue;
    await d.tellTeam(env, r, {
      type: 'agent_task_blocked',
      title: `A task needs a person`,
      body: `${nameOf(r)}'s work on "${r.title.slice(0, 80)}" was discarded ${DISCARDS_MAX} times, so it now waits for someone on the team.`,
    });
    out.blocked += 1;
  }
}

/** Proposals an agent made that have waited three days or more. Once per proposal. */
async function waitingAlerts(env: Env, now: Date, d: AlertDeps, out: AlertCounts) {
  const before = sqlTime(new Date(now.getTime() - OPEN_TOO_LONG_DAYS * DAY * 1000));
  const rows = (await env.DB.prepare(
    `SELECT p.uid AS proposal_uid, a.* FROM ai_rail_proposals p JOIN team_agents a ON a.id = p.agent_id
      WHERE p.status = 'proposed' AND p.created_at <= ? AND a.status != 'removed'
      ORDER BY p.id LIMIT ?`,
  ).bind(before, ALERTS_PER_SWEEP).all<AgentRow & { proposal_uid: string }>()).results ?? [];
  for (const r of rows) {
    if (!(await firstInWindow(env, `agents:alert:waiting:${r.proposal_uid}`, 30 * DAY))) continue;
    await d.tellTeam(env, r, {
      type: 'agent_approval_waiting',
      title: `${nameOf(r)} is waiting for a decision`,
      body: `A proposal from ${nameOf(r)} has waited ${OPEN_TOO_LONG_DAYS} days in the approvals queue. It expires after 7.`,
    });
    out.waiting += 1;
  }
}

/** Agent runs that reached the dead-letter queue since the last sweep: one notice to HQ ops per batch. */
async function dlqAlerts(env: Env, d: AlertDeps, out: AlertCounts) {
  const KEY = 'agents:alert:dlq:last';
  let last = 0;
  try { last = Number(await env.RATE_LIMITS.get(KEY)) || 0; } catch { /* from the start */ }
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n, MAX(id) AS top FROM cf_dlq_mirror WHERE job_type = 'agent_run' AND id > ?",
  ).bind(last).first<{ n: number; top: number | null }>();
  if (!r || !Number(r.n) || r.top == null) return;
  try { await env.RATE_LIMITS.put(KEY, String(r.top), { expirationTtl: 400 * DAY }); } catch { /* told again next sweep */ }
  await d.tellHq(env, {
    type: 'agents_dlq',
    title: 'Agent runs reached the dead-letter queue',
    body: `${Number(r.n)} agent run message(s) failed every retry and reached the dead-letter queue.`,
    link: '/admin/operations',
  });
  out.dlq += Number(r.n);
}

/** The `agents` gateway's month at 70% of the limit HQ mirrored into the var. Once a month. */
async function gatewayAlerts(env: Env, now: Date, d: AlertDeps, out: AlertCounts) {
  const limit = Number(String(env.AGENT_GATEWAY_MONTHLY_LIMIT_MICROUSD ?? '').trim());
  if (!Number.isSafeInteger(limit) || limit <= 0) return;
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS runs,
            SUM(CASE WHEN charged_microusd IS NOT NULL THEN charged_microusd END) AS charged,
            SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS unknown
       FROM ai_usage_logs WHERE agent_id IS NOT NULL AND created_at >= ?`,
  ).bind(monthStart(now)).first<{ runs: number; charged: number | null; unknown: number | null }>();
  if (!r || Number(r.unknown) > 0 || !Number(r.runs)) return;
  if ((Number(r.charged) / limit) * 100 < GATEWAY_THRESHOLD) return;
  if (!(await firstInWindow(env, `agents:alert:gateway${GATEWAY_THRESHOLD}:${monthKey(now)}`, 40 * DAY))) return;
  await d.tellHq(env, {
    type: 'agents_gateway_near',
    title: `Agents are at ${GATEWAY_THRESHOLD}% of the gateway's monthly limit`,
    body: `Agent runs this month have spent ${GATEWAY_THRESHOLD}% or more of the agents gateway's limit. At 100% the engine pauses itself.`,
    link: '/admin/operations',
  });
  out.gateway_70 += 1;
}

/** Every sweep alert, each kind on its own so one failed read never stops another. */
export async function sweepAgentAlerts(env: Env, now = new Date(), deps: Partial<AlertDeps> = {}): Promise<AlertCounts> {
  const d = { ...DEFAULT_DEPS, ...deps };
  const out: AlertCounts = { cap_80: 0, cap_100: 0, blocked: 0, waiting: 0, dlq: 0, gateway_70: 0 };
  const steps: [string, () => Promise<void>][] = [
    ['cap', () => capAlerts(env, now, d, out)],
    ['blocked', () => blockedAlerts(env, d, out)],
    ['waiting', () => waitingAlerts(env, now, d, out)],
    ['dlq', () => dlqAlerts(env, d, out)],
    ['gateway', () => gatewayAlerts(env, now, d, out)],
  ];
  for (const [name, run] of steps) {
    try { await run(); } catch { console.warn(`[agents] alert_${name}_unreadable`); }
  }
  return out;
}

/** The halt set or cleared: HQ hears each change. */
export async function haltAlert(env: Env, halted: boolean, reason: string | null, byName: string | null, d: Pick<AlertDeps, 'tellHq'> = DEFAULT_DEPS) {
  await d.tellHq(env, halted
    ? { type: 'agents_halt_set', title: 'Every agent is halted', body: `${byName ?? 'An admin'} halted every agent${reason ? `: ${reason}` : ''}. Runs end at their next step; nothing new starts.`, link: '/admin/agents' }
    : { type: 'agents_halt_cleared', title: 'Agents may run again', body: `${byName ?? 'An admin'} cleared the halt. Agents may be started again.`, link: '/admin/agents' });
}
