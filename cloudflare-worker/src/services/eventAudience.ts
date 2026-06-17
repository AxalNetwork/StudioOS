/**
 * Task #39 — Event engine: complimentary-ticket audience rules (design §7).
 *
 * `events.audience_rules_json` carries a small flag set the host toggles. Each
 * flag turns on one comp-eligible principal source:
 *   - comp_official_partners  → active partners               (auto_partner)
 *   - comp_invested_lps       → LPs with invested_amount > 0  (auto_lp)
 *   - comp_investors          → investors contributing signals(auto_investor)
 *   - comp_project_founders   → founders of live projects     (auto_founder)
 *   - comp_host_connections   → the host's imported contacts  (auto_connection)
 *
 * `evaluateCompEligibility` returns the full deduped principal set (used by the
 * register-time comp check, §7). `mintCompInvitations` pre-creates pending comp
 * invitations — but ONLY for the two sources that carry a stable identity in
 * the invitation taxonomy: auto_partner and auto_lp. The other three sources
 * stay register-time only (comp is applied when they sign up), so we never
 * spam an invite to every founder/investor on the platform.
 *
 * Every source query is wrapped so a missing/renamed dependency table degrades
 * to "no eligible principals" for that rule instead of 500-ing the request.
 */
import type { Env } from '../types';

export interface AudienceRules {
  comp_official_partners?: boolean;
  comp_invested_lps?: boolean;
  comp_investors?: boolean;
  comp_host_connections?: boolean;
  comp_project_founders?: boolean;
}

export type CompSource =
  | 'auto_partner'
  | 'auto_lp'
  | 'auto_investor'
  | 'auto_founder'
  | 'auto_connection';

export interface CompPrincipal {
  user_id: number | null;
  email: string | null;
  name: string | null;
  source: CompSource;
}

export function parseAudienceRules(json: string | null | undefined): AudienceRules {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as AudienceRules) : {};
  } catch {
    return {};
  }
}

export function serializeAudienceRules(rules: AudienceRules): string {
  const clean: AudienceRules = {};
  for (const k of [
    'comp_official_partners',
    'comp_invested_lps',
    'comp_investors',
    'comp_host_connections',
    'comp_project_founders',
  ] as const) {
    if (rules[k]) clean[k] = true;
  }
  return JSON.stringify(clean);
}

async function safeAll(env: Env, sql: string, binds: unknown[] = []): Promise<any[]> {
  try {
    const r: any = await env.DB.prepare(sql).bind(...binds).all();
    return (r?.results || []) as any[];
  } catch (e) {
    console.warn('[eventAudience] source query failed (skipping rule)', (e as Error).message);
    return [];
  }
}

export async function evaluateCompEligibility(
  env: Env,
  rules: AudienceRules,
  hostUserId: number | null,
): Promise<CompPrincipal[]> {
  const out: CompPrincipal[] = [];

  if (rules.comp_official_partners) {
    const rows = await safeAll(
      env,
      `SELECT p.email AS email, p.name AS name,
              (SELECT u.id FROM users u WHERE lower(u.email) = lower(p.email)) AS user_id
         FROM partners p
        WHERE p.status = 'active'`,
    );
    for (const r of rows) {
      out.push({ user_id: r.user_id ?? null, email: r.email ?? null, name: r.name ?? null, source: 'auto_partner' });
    }
  }

  if (rules.comp_invested_lps) {
    const rows = await safeAll(
      env,
      `SELECT lp.user_id AS user_id, u.email AS email, u.name AS name
         FROM limited_partners lp
         JOIN users u ON u.id = lp.user_id
        WHERE lp.invested_amount > 0`,
    );
    for (const r of rows) {
      out.push({ user_id: r.user_id ?? null, email: r.email ?? null, name: r.name ?? null, source: 'auto_lp' });
    }
  }

  if (rules.comp_investors) {
    const rows = await safeAll(
      env,
      `SELECT ip.user_id AS user_id, u.email AS email, u.name AS name
         FROM investor_profiles ip
         JOIN users u ON u.id = ip.user_id
        WHERE ip.contribute_to_signals = 1`,
    );
    for (const r of rows) {
      out.push({ user_id: r.user_id ?? null, email: r.email ?? null, name: r.name ?? null, source: 'auto_investor' });
    }
  }

  if (rules.comp_project_founders) {
    const rows = await safeAll(
      env,
      `SELECT DISTINCT f.email AS email, f.name AS name,
              (SELECT u.id FROM users u WHERE lower(u.email) = lower(f.email)) AS user_id
         FROM projects pr
         JOIN founders f ON f.id = pr.founder_id
        WHERE pr.status IN ('tier_1','tier_2','spinout','active')`,
    );
    for (const r of rows) {
      out.push({ user_id: r.user_id ?? null, email: r.email ?? null, name: r.name ?? null, source: 'auto_founder' });
    }
  }

  if (rules.comp_host_connections && hostUserId) {
    const rows = await safeAll(
      env,
      `SELECT nc.email AS email, nc.name AS name,
              (SELECT u.id FROM users u WHERE lower(u.email) = lower(nc.email)) AS user_id
         FROM network_connections nc
        WHERE nc.user_id = ? AND nc.email IS NOT NULL AND nc.email <> ''`,
      [hostUserId],
    );
    for (const r of rows) {
      out.push({ user_id: r.user_id ?? null, email: r.email ?? null, name: r.name ?? null, source: 'auto_connection' });
    }
  }

  // Dedupe by user_id (preferred) else lowercased email. First match wins, so
  // the source priority follows the insertion order above.
  const seen = new Set<string>();
  const deduped: CompPrincipal[] = [];
  for (const p of out) {
    const key = p.user_id != null ? `u:${p.user_id}` : p.email ? `e:${p.email.toLowerCase()}` : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }
  return deduped;
}

export async function isPrincipalCompEligible(
  env: Env,
  rules: AudienceRules,
  principal: { userId?: number | null; email?: string | null },
  hostUserId: number | null,
): Promise<{ eligible: boolean; source: CompSource | null }> {
  if (!rules || Object.keys(rules).length === 0) return { eligible: false, source: null };
  const set = await evaluateCompEligibility(env, rules, hostUserId);
  const email = principal.email ? principal.email.toLowerCase() : null;
  for (const p of set) {
    if (principal.userId != null && p.user_id != null && Number(p.user_id) === Number(principal.userId)) {
      return { eligible: true, source: p.source };
    }
    if (email && p.email && p.email.toLowerCase() === email) {
      return { eligible: true, source: p.source };
    }
  }
  return { eligible: false, source: null };
}

/**
 * Pre-mint pending comp invitations for the stable-identity sources only
 * (auto_partner + auto_lp). Idempotent per (event, principal): an existing
 * invitation — matched on invited_user_id or invited_email — is left alone.
 * Returns the number of new invitations created.
 */
export async function mintCompInvitations(
  env: Env,
  eventId: number,
  rules: AudienceRules,
  hostUserId: number | null,
  invitedBy: number | null,
): Promise<{ minted: number }> {
  const all = await evaluateCompEligibility(env, rules, hostUserId);
  const principals = all.filter((p) => p.source === 'auto_partner' || p.source === 'auto_lp');
  let minted = 0;
  for (const p of principals) {
    if (p.user_id == null && !p.email) continue;
    let exists: any = null;
    if (p.user_id != null) {
      exists = await env.DB.prepare(
        `SELECT id FROM event_invitations WHERE event_id = ? AND invited_user_id = ? LIMIT 1`,
      ).bind(eventId, p.user_id).first();
    }
    if (!exists && p.email) {
      exists = await env.DB.prepare(
        `SELECT id FROM event_invitations WHERE event_id = ? AND lower(invited_email) = lower(?) LIMIT 1`,
      ).bind(eventId, p.email).first();
    }
    if (exists) continue;
    const token = crypto.randomUUID().replace(/-/g, '');
    try {
      await env.DB.prepare(
        `INSERT INTO event_invitations
           (event_id, token, invited_user_id, invited_email, invited_name, source, comp, status, invited_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'pending', ?)`,
      ).bind(eventId, token, p.user_id ?? null, p.email ?? null, p.name ?? null, p.source, invitedBy ?? null).run();
      minted++;
    } catch {
      // UNIQUE(token) collision or a concurrent mint — skip.
    }
  }
  return { minted };
}
