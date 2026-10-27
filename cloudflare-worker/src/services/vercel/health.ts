/**
 * D1097 (#2962, part 2 of #2408) — Vercel's production health events
 * (migration 590): which events the evidence opens, and the store that opens,
 * closes and dismisses them.
 *
 * EVIDENCE, NEVER A WEBHOOK BODY. `healthFindings` reads what the sync (or a
 * webhook's nudge) read from Vercel's API: the project, its production
 * deployments, its domains with their configuration, the account's domains
 * with their expiry, and certificate state when a read carries it. A source
 * that was not read checks nothing, so a partial read never closes an event
 * it could not see (`checked`).
 *
 * DISMISS STAYS DISMISSED. A dismissed event stays open until its evidence
 * clears; the next sync finds it open and opens nothing new. Evidence that
 * clears and comes back later is a new event with its own `opened_at`.
 *
 * Nothing here reads a log, a commit message or a person. Every statement is
 * bound.
 */
import type { Env } from '../../types';
import type { Deployment, Domain, VercelProject } from './api';

export const HEALTH_KINDS = Object.freeze(['production_failed', 'rollback', 'domain_misconfigured', 'domain_unverified', 'certificate_failed', 'domain_expiring'] as const);
export type HealthKind = typeof HEALTH_KINDS[number];

/**
 * A Vercel-registered domain's expiry window, in days, as #2408 and #2962
 * word it: "expiring within 30 days, or 14 with auto-renew off". The owner
 * confirms the reading (D1097 §5); both figures live here only.
 */
export const EXPIRY_WINDOW_DAYS = Object.freeze({ renewOn: 30, renewOff: 14 });
const DAY = 86_400_000;

export interface HealthEvidence {
  /** The project, for `targets.production`. */
  project?: VercelProject | null;
  /** Production deployments, any order; null when they were not read. */
  production?: Deployment[] | null;
  /** The project's domains (`verified`); null when not read. */
  projectDomains?: Domain[] | null;
  /** Each project domain's configuration (`misconfigured`), by name; null when not read. */
  configs?: Record<string, { misconfigured?: boolean } | null> | null;
  /** The account's domains (`expiresAt`, `renew`); null when not read. */
  accountDomains?: Domain[] | null;
  /** Certificate state per domain, when a read carries it; null when none does. */
  certificates?: Array<{ domain: string; failed: boolean }> | null;
}
export interface Finding { kind: HealthKind; subject: string }

const created = (d: Deployment) => Number(d.createdAt ?? d.created ?? 0);
const idOf = (d: Deployment | null | undefined) => (d ? String(d.uid ?? d.id ?? '') : '');
const stateOf = (d: Deployment) => String(d.readyState ?? d.state ?? '').toUpperCase();
const domainName = (raw: unknown) => {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return /^[a-z0-9.-]{1,253}$/.test(s) ? s : null;
};
const subjectOk = (s: string) => s.length >= 1 && s.length <= 253;

/** What the evidence says is wrong now, and which kinds it was able to check. */
export function healthFindings(e: HealthEvidence, now: Date = new Date()): { checked: HealthKind[]; open: Finding[] } {
  const checked = new Set<HealthKind>();
  const open: Finding[] = [];
  const add = (kind: HealthKind, subject: string | null) => { if (subject && subjectOk(subject) && !open.some((f) => f.kind === kind && f.subject === subject)) open.push({ kind, subject }); };

  if (Array.isArray(e.production)) {
    const prod = [...e.production].filter((d) => !d.target || d.target === 'production').sort((a, b) => created(b) - created(a));
    checked.add('production_failed');
    // The newest production deployment failed.
    if (prod[0] && stateOf(prod[0]) === 'ERROR') add('production_failed', idOf(prod[0]));
    // Production points at a deployment older than the newest ready one: it was rolled back.
    const current = e.project?.targets?.production ?? null;
    if (e.project) {
      checked.add('rollback');
      const newestReady = prod.find((d) => stateOf(d) === 'READY') ?? null;
      if (current && newestReady && idOf(current) && idOf(current) !== idOf(newestReady) && created(current) < created(newestReady)) add('rollback', idOf(current));
    }
  }
  const mine = Array.isArray(e.projectDomains) ? e.projectDomains.map((d) => ({ name: domainName(d.name), verified: d.verified })).filter((d) => d.name) : null;
  if (mine) {
    checked.add('domain_unverified');
    for (const d of mine) if (d.verified === false) add('domain_unverified', d.name);
  }
  if (e.configs && typeof e.configs === 'object') {
    checked.add('domain_misconfigured');
    for (const [name, cfg] of Object.entries(e.configs)) if (cfg?.misconfigured === true) add('domain_misconfigured', domainName(name));
  }
  if (Array.isArray(e.certificates)) {
    checked.add('certificate_failed');
    for (const c of e.certificates) if (c?.failed === true) add('certificate_failed', domainName(c.domain));
  }
  // A Vercel-registered domain (Vercel knows its expiry) that one of this project's domains sits on.
  if (Array.isArray(e.accountDomains) && mine) {
    checked.add('domain_expiring');
    for (const d of e.accountDomains) {
      const name = domainName(d.name);
      if (!name || d.expiresAt == null || !Number.isFinite(Number(d.expiresAt))) continue;
      if (!mine.some((m) => m.name === name || (m.name as string).endsWith(`.${name}`))) continue;
      const window = d.renew === false ? EXPIRY_WINDOW_DAYS.renewOff : EXPIRY_WINDOW_DAYS.renewOn;
      if ((Number(d.expiresAt) - now.getTime()) / DAY <= window) add('domain_expiring', name);
    }
  }
  return { checked: HEALTH_KINDS.filter((k) => checked.has(k)), open };
}

export const fedKey = (kind: HealthKind, subject: string, openedAt: string) => `health:${kind}:${subject}:${openedAt}`;

/**
 * Open what the evidence newly shows, and close what it no longer shows among
 * the kinds it checked. Each opened row gets its `connector_fed_items` row in
 * the same batch. Returns what changed, as counts.
 */
export async function applyHealth(env: Env, ctx: { integrationId: number; projectId: number; vercelProjectId?: string | null; source: 'sync' | 'webhook' },
  findings: { checked: HealthKind[]; open: Finding[] }, now: Date = new Date()): Promise<{ opened: number; closed: number; still: number }> {
  const at = now.toISOString();
  const rows = (await env.DB.prepare(
    'SELECT id, kind, subject, opened_at FROM vercel_health_events WHERE integration_id = ? AND project_id = ? AND closed_at IS NULL',
  ).bind(ctx.integrationId, ctx.projectId).all<{ id: number; kind: HealthKind; subject: string; opened_at: string }>()).results || [];
  const key = (k: string, s: string) => `${k}\u0000${s}`;
  const openNow = new Map(rows.map((r) => [key(r.kind, r.subject), r]));
  const wanted = new Set(findings.open.map((f) => key(f.kind, f.subject)));
  const statements = [];
  let opened = 0; let still = 0; let closed = 0;
  for (const f of findings.open) {
    const held = openNow.get(key(f.kind, f.subject));
    if (held) {
      still += 1;
      statements.push(env.DB.prepare('UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?')
        .bind(ctx.integrationId, fedKey(f.kind, f.subject, held.opened_at)));
      continue;
    }
    opened += 1;
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO vercel_health_events (integration_id, project_id, vercel_project_id, kind, subject, opened_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(ctx.integrationId, ctx.projectId, ctx.vercelProjectId ?? null, f.kind, f.subject, at, ctx.source));
    statements.push(env.DB.prepare(
      `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
       SELECT ?, ?, 'operating_systems', 'health_event', ?, 'vercel_health_events', id FROM vercel_health_events
        WHERE integration_id = ? AND project_id = ? AND kind = ? AND subject = ? AND opened_at = ?
       ON CONFLICT (integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`,
    ).bind(ctx.integrationId, ctx.projectId, fedKey(f.kind, f.subject, at), ctx.integrationId, ctx.projectId, f.kind, f.subject, at));
  }
  const checked = new Set(findings.checked);
  for (const r of rows) {
    if (!checked.has(r.kind) || wanted.has(key(r.kind, r.subject))) continue;
    closed += 1;
    statements.push(env.DB.prepare('UPDATE vercel_health_events SET closed_at = ? WHERE id = ? AND closed_at IS NULL').bind(at, r.id));
  }
  if (statements.length) await env.DB.batch(statements);
  return { opened, closed, still };
}

export type DismissOutcome = 'ok' | 'not_found' | 'closed' | 'already';

/** The founder dismisses an open event of their venture; it stays open, and out of the read, until its evidence clears. */
export async function dismissHealthEvent(env: Env, projectId: number, id: number, userId: number, extra: D1PreparedStatement[] = []): Promise<DismissOutcome> {
  const row = await env.DB.prepare('SELECT closed_at, dismissed_at FROM vercel_health_events WHERE id = ? AND project_id = ?')
    .bind(id, projectId).first<{ closed_at: string | null; dismissed_at: string | null }>();
  if (!row) return 'not_found';
  if (row.closed_at) return 'closed';
  if (row.dismissed_at) return 'already';
  const [upd] = await env.DB.batch([
    env.DB.prepare('UPDATE vercel_health_events SET dismissed_at = ?, dismissed_by = ? WHERE id = ? AND project_id = ? AND dismissed_at IS NULL AND closed_at IS NULL')
      .bind(new Date().toISOString(), userId, id, projectId),
    ...extra,
  ]);
  return Number((upd as any)?.meta?.changes ?? 0) ? 'ok' : 'already';
}
