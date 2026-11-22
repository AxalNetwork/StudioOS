/**
 * D8070 (#8070): capability RBAC for agents. An agent may do only what its
 * capability set names, in `<domain>.<action>` form; `requireCapability` is
 * the one check, called once at each guarded call site:
 *
 *   run admission        `agents/engine.ts` admitInScope   the task's module → its domain action (`moduleCapability`)
 *   compute dispatch     `agents/computeBridge.ts`          cloud.read
 *   publish request      `agents/agentPublisherBroker.ts`   code.pr
 *   skill tool           `agents/skillLinks.ts` attachCheck each tool's declared capability (`toolCapability`)
 *   preview deploy       no trigger exists on main yet; the one that lands calls requireCapability(…, 'deploy.preview')
 *
 * Refusal codes: `capability_ungrantable` (one of the five reserved names, always, enforced or not),
 * `capability_unknown` (a name the catalogue does not hold, always), `capability_not_offered` (outside the
 * platform's ceiling this month), `capability_missing` (no live grant), `capability_unreadable` (the policy
 * or the grants could not be read: refused, never assumed).
 *
 * Until HQ turns `capabilities_enforced` on, only the always-refused codes apply, so agents already working
 * keep working while their sets are granted. A database whose schema predates the migration reads as "not
 * enforced" (the deploy applies migrations before the Worker ships); any other read failure refuses.
 *
 * Wildcards (`research.*`) expand at grant time into one row per name (`expandCapabilities`), never at check time.
 */
import type { Env } from '../types';

export type Domain = 'research' | 'company' | 'fund' | 'relationships' | 'code' | 'deploy' | 'cloud' | 'finance' | 'legal' | 'email' | 'web';
export type CatalogueEntry = { name: string; domain: Domain; action: string; grantable: boolean };

/** The catalogue, as the migration seeds it. The table is the record; this copy is for expansion and tests. */
export const CAPABILITY_CATALOGUE: readonly CatalogueEntry[] = Object.freeze(([
  ['research.read', 1], ['research.write', 1], ['company.read', 1], ['company.write', 1], ['fund.read', 1],
  ['relationships.read', 1], ['relationships.request-introduction', 1],
  ['code.read', 1], ['code.branch', 1], ['code.commit', 1], ['code.pr', 1],
  ['deploy.preview', 1], ['deploy.staging', 1], ['cloud.read', 1], ['finance.read', 1],
  ['legal.read', 1], ['legal.draft', 1], ['email.read', 1], ['email.draft', 1], ['web.search', 1],
  ['code.merge', 0], ['deploy.production', 0], ['cloud.write', 0], ['finance.execute', 0], ['email.send', 0],
] as const).map(([name, g]) => {
  const [domain, action] = name.split('.') as [Domain, string];
  return Object.freeze({ name, domain, action, grantable: g === 1 });
}));

const BY_NAME = new Map(CAPABILITY_CATALOGUE.map((c) => [c.name, c]));
/** The five names a person does. They exist so a refusal can name them; no agent is ever granted one. */
export const RESERVED_CAPABILITIES: readonly string[] = Object.freeze(CAPABILITY_CATALOGUE.filter((c) => !c.grantable).map((c) => c.name));
export const DOMAINS: readonly Domain[] = Object.freeze([...new Set(CAPABILITY_CATALOGUE.map((c) => c.domain))]);
export const capabilityOf = (name: string): CatalogueEntry | null => BY_NAME.get(name) ?? null;

export type CapabilityCode = 'capability_missing' | 'capability_ungrantable' | 'capability_unknown' | 'capability_not_offered' | 'capability_unreadable';
export type CapabilityRefusal = { ok: false; status: number; code: CapabilityCode; capability: string; message: string };
export type CapabilityCheck = { ok: true } | CapabilityRefusal;

const refusal = (status: number, code: CapabilityCode, capability: string, message: string): CapabilityRefusal =>
  ({ ok: false, status, code, capability, message });

/**
 * Each task module's domain action (the run admission's check). A module that drafts for the team to accept is a
 * `write`; one that only reads a record family is that family's `read`. Every module in the catalogue has one
 * (the test walks `MODULES`); an unlisted module answers null and is refused under enforcement.
 */
export const MODULE_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  studio: 'company.write',
  'problem-discovery': 'research.write', 'customer-research': 'research.write', 'ideal-customer-profile': 'research.write',
  'market-intelligence': 'research.write', 'demand-signals': 'research.write', experiments: 'research.write', verdict: 'research.write',
  'solution-design': 'company.write', 'prototype-mvp': 'company.write', 'product-roadmap': 'company.write',
  'founding-team': 'company.write', 'company-creation': 'legal.draft', 'operating-systems': 'company.write',
  'fundraising-readiness': 'company.write', 'investor-narrative': 'company.write', 'pitch-deck': 'company.write',
  'data-room': 'company.write', 'cap-table': 'finance.read', 'use-of-funds': 'company.write',
  'capital-relationships': 'relationships.read',
  'product-improvement': 'company.write', distribution: 'company.write', 'revenue-and-traction': 'finance.read',
  'team-expansion': 'company.write', 'partner-network': 'relationships.read', 'market-expansion': 'research.write',
  'durable-company-building': 'company.write',
  research: 'research.write', network: 'relationships.read',
});
export const moduleCapability = (module: string | null | undefined): string | null =>
  (module && Object.prototype.hasOwnProperty.call(MODULE_CAPABILITY, module) ? MODULE_CAPABILITY[module] : null);

/** A connector read tool's declared capability, by its connector (`hubspot.read_contacts` → relationships.read). */
export const CONNECTOR_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  hubspot: 'relationships.read', salesforce: 'relationships.read', attio: 'relationships.read', pipedrive: 'relationships.read',
  affinity: 'relationships.read', linkedin: 'relationships.read',
  gmail: 'email.read', outlook: 'email.read', beehiiv: 'email.read',
  github: 'code.read', gitlab: 'code.read',
  linear: 'company.read', posthog: 'company.read', jira: 'company.read',
  notion: 'research.read', google_drive: 'research.read', drive: 'research.read', dropbox: 'research.read',
  mercury: 'finance.read', stripe: 'finance.read', quickbooks: 'finance.read', xero: 'finance.read', brex: 'finance.read',
  ramp: 'finance.read', carta: 'finance.read',
  cloudflare: 'cloud.read', aws: 'cloud.read', gcp: 'cloud.read',
  docusign: 'legal.read',
});
export function toolCapability(tool: string): string | null {
  const connector = /^([a-z][a-z0-9_]{0,31})\./.exec(tool)?.[1];
  return connector && Object.prototype.hasOwnProperty.call(CONNECTOR_CAPABILITY, connector) ? CONNECTOR_CAPABILITY[connector] : null;
}

/**
 * Names (and `<domain>.*` wildcards) as the grantable names they stand for, sorted and without repeats. A
 * wildcard takes only its domain's grantable names. An unknown name, an empty domain, or a reserved name named
 * outright is refused: the grant route never writes part of a list.
 */
export function expandCapabilities(v: unknown): { ok: true; value: string[] } | { ok: false; code: 'capability_unknown' | 'capability_ungrantable'; capability: string } {
  if (!Array.isArray(v) || v.length === 0 || v.length > 40 || v.some((x) => typeof x !== 'string')) return { ok: false, code: 'capability_unknown', capability: '' };
  const out = new Set<string>();
  for (const raw of v as string[]) {
    const name = raw.trim();
    const wild = /^([a-z]+)\.\*$/.exec(name);
    if (wild) {
      const names = CAPABILITY_CATALOGUE.filter((c) => c.domain === wild[1] && c.grantable).map((c) => c.name);
      if (!names.length) return { ok: false, code: 'capability_unknown', capability: name };
      names.forEach((n) => out.add(n));
      continue;
    }
    const c = capabilityOf(name);
    if (!c) return { ok: false, code: 'capability_unknown', capability: name };
    if (!c.grantable) return { ok: false, code: 'capability_ungrantable', capability: name };
    out.add(name);
  }
  return { ok: true, value: [...out].sort() };
}

export type CapabilityPolicy = { enforced: boolean; ceiling: string[] | null };

/** A D1 error that says the migration has not run here (a table or column it adds is absent). */
const schemaPredates = (e: unknown) => /no such (table|column)/i.test(String((e as Error)?.message ?? e));

/** The two policy columns; null when they could not be read for any reason but an older schema. */
export async function readCapabilityPolicy(env: Pick<Env, 'DB'>): Promise<CapabilityPolicy | null> {
  try {
    const row = await env.DB.prepare('SELECT capabilities_enforced, capability_ceiling_json FROM ai_agent_policy WHERE id = 1')
      .first<{ capabilities_enforced: number; capability_ceiling_json: string | null }>();
    if (!row) return { enforced: false, ceiling: null };
    let ceiling: string[] | null = null;
    if (row.capability_ceiling_json != null) {
      const parsed = JSON.parse(row.capability_ceiling_json);
      if (!Array.isArray(parsed)) return null;
      ceiling = parsed.filter((x): x is string => typeof x === 'string');
    }
    return { enforced: Number(row.capabilities_enforced) === 1, ceiling };
  } catch (e) {
    return schemaPredates(e) ? { enforced: false, ceiling: null } : null;
  }
}

/**
 * May `agent` do `name`? A reserved name, or a name the catalogue does not hold, is refused whatever the policy
 * says. Everything else is checked once HQ turns enforcement on: an action with no declared capability (null) is
 * refused, a name must be inside the ceiling, and the agent must hold a live grant.
 */
export async function requireCapability(env: Pick<Env, 'DB'>, agent: { id: number } | null, name: string | null): Promise<CapabilityCheck> {
  const c = name ? capabilityOf(name) : null;
  const unknown = () => refusal(403, 'capability_unknown', name ?? '', 'This action has no capability the platform knows, so no agent may do it.');
  if (name && !c) return unknown();
  if (c && !c.grantable) return refusal(403, 'capability_ungrantable', c.name, `${c.name} is done by a person. No agent can be granted it.`);
  const policy = await readCapabilityPolicy(env);
  if (!policy) return refusal(503, 'capability_unreadable', name ?? '', 'The agent capability policy could not be read. Nothing was done.');
  if (!policy.enforced) return { ok: true };
  // An action that declares no capability (a connector with none) is refused once HQ enforces.
  if (!c) return unknown();
  if (policy.ceiling && !policy.ceiling.includes(c.name)) {
    return refusal(403, 'capability_not_offered', c.name, `The platform does not offer ${c.name} to agents this month.`);
  }
  if (!agent || !Number.isSafeInteger(agent.id)) return refusal(403, 'capability_missing', c.name, `This agent has not been granted ${c.name}.`);
  try {
    const row = await env.DB.prepare('SELECT 1 AS ok FROM agent_capabilities WHERE agent_id = ? AND capability = ? AND revoked_at IS NULL')
      .bind(agent.id, c.name).first<{ ok: number }>();
    return row ? { ok: true } : refusal(403, 'capability_missing', c.name, `This agent has not been granted ${c.name}.`);
  } catch {
    return refusal(503, 'capability_unreadable', c.name, 'The agent capability policy could not be read. Nothing was done.');
  }
}

/**
 * The publisher's provenance names its agent as `agent:<id>` or by its 32-hex uid. Null when it names neither,
 * which `requireCapability` refuses as `capability_missing` under enforcement.
 */
export async function agentOfProvenance(env: Pick<Env, 'DB'>, ref: string): Promise<{ id: number } | null> {
  const byId = /^agent:([1-9][0-9]{0,15})$/.exec(ref);
  if (byId) return { id: Number(byId[1]) };
  if (/^[a-f0-9]{32}$/.test(ref)) {
    const row = await env.DB.prepare('SELECT id FROM team_agents WHERE uid = ?').bind(ref).first<{ id: number }>();
    return row ? { id: row.id } : null;
  }
  return null;
}

// ── The matrix (HQ › AI agents › Operations › Policies) ─────────────────────────────────────────────────────────

export type GrantRow = {
  id: number; agent_id: number; capability: string; granted_by: number; granted_by_name: string | null; granted_at: string;
  grant_reason: string; revoked_by: number | null; revoked_by_name: string | null; revoked_at: string | null; revoke_reason: string | null;
};

/** Each agent's live grants and its last revoke per name, newest first; the catalogue and the policy beside them. */
export async function capabilityMatrix(env: Pick<Env, 'DB'>) {
  const catalogue = ((await env.DB.prepare('SELECT name, domain, action, grantable, sentence FROM capability_catalog ORDER BY domain, name')
    .all<{ name: string; domain: string; action: string; grantable: number; sentence: string }>()).results ?? [])
    .map((r) => ({ ...r, grantable: r.grantable === 1 }));
  const rows = (await env.DB.prepare(`SELECT g.id, g.agent_id, g.capability, g.granted_by, gu.name AS granted_by_name, g.granted_at, g.grant_reason,
      g.revoked_by, ru.name AS revoked_by_name, g.revoked_at, g.revoke_reason
    FROM agent_capabilities g LEFT JOIN users gu ON gu.id = g.granted_by LEFT JOIN users ru ON ru.id = g.revoked_by
    ORDER BY g.agent_id, g.capability, g.id DESC`).all<GrantRow>()).results ?? [];
  const agents = (await env.DB.prepare(`SELECT a.id, a.uid, a.role_key, a.first_name, a.last_name, a.status FROM team_agents a
    WHERE a.status <> 'removed' ORDER BY a.id`).all<{ id: number; uid: string; role_key: string; first_name: string | null; last_name: string | null; status: string }>()).results ?? [];
  const byAgent = new Map<number, Map<string, GrantRow>>();
  for (const r of rows) {
    const m = byAgent.get(r.agent_id) ?? new Map<string, GrantRow>();
    // Newest first: the first row per name is its current state (a live grant, or the last revoke).
    if (!m.has(r.capability)) m.set(r.capability, r);
    byAgent.set(r.agent_id, m);
  }
  const policy = await readCapabilityPolicy(env);
  return {
    catalogue,
    policy,
    agents: agents.map((a) => ({
      uid: a.uid, role_key: a.role_key, first_name: a.first_name, last_name: a.last_name, status: a.status,
      cells: [...(byAgent.get(a.id)?.values() ?? [])].map((g) => ({
        capability: g.capability, granted: g.revoked_at == null,
        granted_by: g.granted_by_name, granted_at: g.granted_at, grant_reason: g.grant_reason,
        revoked_by: g.revoked_by_name, revoked_at: g.revoked_at, revoke_reason: g.revoke_reason,
      })),
    })),
  };
}

/** The agent's live grants, by name. */
export async function liveGrants(env: Pick<Env, 'DB'>, agentId: number): Promise<string[]> {
  return ((await env.DB.prepare('SELECT capability FROM agent_capabilities WHERE agent_id = ? AND revoked_at IS NULL ORDER BY capability')
    .bind(agentId).all<{ capability: string }>()).results ?? []).map((r) => r.capability);
}

export function grantStatement(env: Pick<Env, 'DB'>, agentId: number, capability: string, by: number, reason: string) {
  // The partial unique index keeps one live grant; a name already live is left as it is.
  return env.DB.prepare(`INSERT INTO agent_capabilities (agent_id, capability, granted_by, grant_reason) VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_id, capability) WHERE revoked_at IS NULL DO NOTHING`).bind(agentId, capability, by, reason);
}

export function revokeStatement(env: Pick<Env, 'DB'>, agentId: number, capability: string, by: number, reason: string) {
  return env.DB.prepare(`UPDATE agent_capabilities SET revoked_at = CURRENT_TIMESTAMP, revoked_by = ?, revoke_reason = ?
    WHERE agent_id = ? AND capability = ? AND revoked_at IS NULL`).bind(by, reason, agentId, capability);
}

/** A reason: 1 to 200 characters after trimming. */
export const CAPABILITY_REASON_MAX = 200;
export function capabilityReason(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length >= 1 && s.length <= CAPABILITY_REASON_MAX ? s : null;
}

/** A ceiling: null (every grantable name) or a list of grantable names, wildcards expanded. */
export function ceilingOf(v: unknown): { ok: true; value: string[] | null } | { ok: false; code: 'capability_unknown' | 'capability_ungrantable'; capability: string } {
  if (v === null) return { ok: true, value: null };
  if (Array.isArray(v) && v.length === 0) return { ok: true, value: [] };
  return expandCapabilities(v);
}
