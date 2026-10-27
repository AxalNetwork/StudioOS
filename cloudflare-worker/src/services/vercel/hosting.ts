/**
 * D1097 (#2962) — Operating systems › Tools' Hosting block (VC1): Vercel as
 * the Hosting system, read from each Vercel connection enabled for the
 * venture's company, beside GitHub's Code system (D782). It is never written
 * into `project_core_systems`.
 *
 * What it reads today: each connection's state and the venture's health
 * events (migration 590), open ones and those closed in the last 30 days,
 * never a dismissed one. The project's facts (name, domain, framework,
 * runtime, branch, repository, plan) and Vercel's sync lines come from part
 * 1's `vercel_projects` and sync (#2961), which are not on main yet: each says
 * so, never empty and never zero.
 *
 * THE TOOLS RULE: the owner and the company's members read each event's
 * subject (a domain or a deployment id); anyone else reads the counts.
 */
import type { Env } from '../../types';
import type { HealthKind } from './health';

export const CLOSED_SHOWN_DAYS = 30;
export const PART1_WAIT = 'Waits for Vercel part 1 (#2961): the projects this connection feeds are not stored yet.';
export const SYNC_WAIT = 'Vercel’s sync lines arrive with part 1 (#2961), which records each sync.';

/** An event in words. The subject is drawn beside it, for those who may read it. */
export const HEALTH_WORDS: Record<HealthKind, string> = Object.freeze({
  production_failed: 'Production deploy failed',
  rollback: 'Production was rolled back',
  domain_misconfigured: 'Domain is misconfigured',
  domain_unverified: 'Domain is unverified',
  certificate_failed: 'Certificate renewal failed',
  domain_expiring: 'Domain registration expires soon',
});

type Viewer = { id: number };

export async function hostingSystems(env: Env, p: { id: number; company_id: number | null }, viewer: Viewer, viewerMember: boolean, href: string) {
  if (p.company_id == null) return { state: 'not_recorded', systems: [], reason: 'This project has no company scope for connectors.', syncs: { state: 'not_recorded', rows: [], reason: SYNC_WAIT } };
  const vercel = (await env.DB.prepare(
    `SELECT i.id, i.user_id, i.status, i.last_synced_at, i.last_error_at, u.name AS owner_name
       FROM integrations i
       JOIN integration_companies ic ON ic.integration_id = i.id AND ic.company_id = ? AND ic.enabled = 1
       JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
       LEFT JOIN users u ON u.id = i.user_id
      WHERE i.provider_key = 'vercel' ORDER BY i.id`,
  ).bind(p.company_id).all<any>()).results || [];
  if (!vercel.length) {
    return { state: 'empty', systems: [], reason: 'Vercel has not brought anything to this venture yet.', syncs: { state: 'not_recorded', rows: [], reason: SYNC_WAIT } };
  }
  const events = (await env.DB.prepare(
    `SELECT id, integration_id, kind, subject, opened_at, closed_at, source FROM vercel_health_events
      WHERE project_id = ? AND integration_id IN (SELECT value FROM json_each(?)) AND dismissed_at IS NULL
        AND (closed_at IS NULL OR closed_at >= ?)
      ORDER BY (closed_at IS NULL) DESC, opened_at DESC, id DESC`,
  ).bind(p.id, JSON.stringify(vercel.map((v: any) => Number(v.id))), new Date(Date.now() - CLOSED_SHOWN_DAYS * 86_400_000).toISOString())
    .all<{ id: number; integration_id: number; kind: HealthKind; subject: string; opened_at: string; closed_at: string | null; source: string }>()).results || [];
  const sees = (userId: number) => userId === viewer.id || viewerMember;
  const systems = vercel.map((v: any) => {
    const mine = events.filter((e) => Number(e.integration_id) === Number(v.id));
    const visible = sees(Number(v.user_id));
    return {
      kind: 'hosting', system: 'Hosting', provider: 'Vercel', source: 'connection', source_label: 'From the Vercel connection',
      state: v.status === 'active' ? 'Connected' : v.status === 'error' ? 'Failing' : 'Not connected',
      last_sync: v.last_synced_at ?? null, failed_at: v.last_error_at ?? null,
      owner: Number(v.user_id) === viewer.id ? 'You' : viewerMember ? v.owner_name ?? null : null,
      action: { text: 'Open', href },
      facts: null, facts_reason: PART1_WAIT,
      health: {
        open: mine.filter((e) => !e.closed_at).length,
        closed: mine.filter((e) => e.closed_at).length,
        // The Tools rule: who may read the subjects reads each event; anyone else reads the counts above.
        items: visible ? mine.map((e) => ({
          id: Number(e.id), kind: e.kind, words: HEALTH_WORDS[e.kind] ?? 'Health event', subject: e.subject,
          state: e.closed_at ? 'closed' : 'open', opened_at: e.opened_at, closed_at: e.closed_at, source: e.source,
        })) : null,
      },
    };
  });
  return { state: 'ok', systems, reason: null, syncs: { state: 'not_recorded', rows: [], reason: SYNC_WAIT } };
}
