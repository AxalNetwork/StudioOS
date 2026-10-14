/**
 * D652 — the read-only functions an Eadwyn run calls, one per provider
 * (#1464, part of D649, scoped by D650's `integration_companies`).
 *
 * A reader reads what the member's connection already brought into StudioOS,
 * from D1. It never calls the provider, and it writes nothing: this module is
 * scanned for `.push(`, `.sync(` and `.action(` by
 * `test/eadwyn_connectors_d652.test.ts`, so even an array is built without
 * `Array.prototype.push`.
 *
 * COMPANY SCOPE, ON EVERY RUN. Each reader first asks `companyEnabled` for the
 * run's company. That join re-reads `user_company_links`, so a member who
 * left the company, or a company switched off for this connection since the
 * conversation started, reads nothing. Past the gate, every row is narrowed
 * to projects of that company (`p.company_id = ?`, not deleted).
 *
 * Only the connectors that write project data (`writesProjectData`) have a
 * reader: their rows belong to a company. Calendly, Carta, DocuSign and the
 * rest land personal or unscoped rows; they join this map when their rows
 * can be scoped the same way.
 */
import type { Env } from '../types';
import type { IntegrationRow } from '../integrations/registry';
import { companyEnabled } from '../integrations/companyScope';
import { MODULE_LABELS } from '../integrations/moduleLabels';
import type { ConnectorRead, ConnectorReader } from './eadwynConnectors';

/** At most this many rows feed one connector's lines. */
const READ_LIMIT = 20;

const NOTHING = (row: IntegrationRow): ConnectorRead => ({ facts: [], as_of: row.last_synced_at ?? null });

function money(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'not recorded';
}

async function inScope(env: Env, row: IntegrationRow, companyId: number | null): Promise<boolean> {
  return companyId !== null && (await companyEnabled(env, row.id, companyId));
}

/**
 * Deals a CRM connection synced, one literal query per CRM: they differ only
 * in the column that holds the CRM's id. Affinity stores its ids in
 * `hubspot_deal_id` too, prefixed `affinity:`; those are not HubSpot's.
 */
const CRM_DEALS_SQL = {
  hubspot:
    `SELECT p.name AS project_name, d.status, d.amount, d.updated_at
       FROM deals d JOIN projects p ON p.id = d.project_id
      WHERE p.company_id = ? AND p.deleted_at IS NULL
        AND d.hubspot_deal_id IS NOT NULL AND d.hubspot_deal_id NOT LIKE 'affinity:%'
      ORDER BY d.updated_at DESC, d.id DESC LIMIT ?`,
  salesforce:
    `SELECT p.name AS project_name, d.status, d.amount, d.updated_at
       FROM deals d JOIN projects p ON p.id = d.project_id
      WHERE p.company_id = ? AND p.deleted_at IS NULL
        AND d.sf_opportunity_id IS NOT NULL
      ORDER BY d.updated_at DESC, d.id DESC LIMIT ?`,
} as const;

async function crmDeals(
  env: Env,
  row: IntegrationRow,
  companyId: number | null,
  crm: keyof typeof CRM_DEALS_SQL,
  noun: string,
): Promise<ConnectorRead> {
  if (!(await inScope(env, row, companyId))) return NOTHING(row);
  const rows = await env.DB.prepare(CRM_DEALS_SQL[crm])
    .bind(companyId, READ_LIMIT).all<{ project_name: string | null; status: string; amount: number | null; updated_at: string }>();
  const deals = rows.results ?? [];
  return {
    facts: deals.length
      ? deals.map((d) => `${noun} for ${d.project_name || 'an unnamed project'}: stage ${d.status}, amount ${money(d.amount)}, updated ${d.updated_at}`)
      : [`No ${noun.toLowerCase()} from this connection is linked to this company's projects.`],
    as_of: row.last_synced_at ?? null,
  };
}

const hubspot: ConnectorReader = (env, _user, row, companyId) =>
  crmDeals(env, row, companyId, 'hubspot', 'HubSpot deal');

const salesforce: ConnectorReader = (env, _user, row, companyId) =>
  crmDeals(env, row, companyId, 'salesforce', 'Salesforce opportunity');

/** Stripe's latest snapshot per project, as its sync wrote it (`source = 'stripe'`). */
const stripe: ConnectorReader = async (env, _user, row, companyId) => {
  if (!(await inScope(env, row, companyId))) return NOTHING(row);
  const rows = await env.DB.prepare(
    `SELECT p.name AS project_name, m.snapshot_date, m.mrr, m.arr, m.monthly_churn_pct, m.active_users
       FROM project_metrics m JOIN projects p ON p.id = m.project_id
      WHERE m.source = 'stripe' AND p.company_id = ? AND p.deleted_at IS NULL
        AND m.snapshot_date = (SELECT MAX(m2.snapshot_date) FROM project_metrics m2
                                WHERE m2.project_id = m.project_id AND m2.source = 'stripe')
      ORDER BY m.snapshot_date DESC, p.id LIMIT ?`,
  ).bind(companyId, READ_LIMIT).all<{
    project_name: string | null; snapshot_date: string; mrr: number | null; arr: number | null;
    monthly_churn_pct: number | null; active_users: number | null;
  }>();
  const snaps = rows.results ?? [];
  return {
    facts: snaps.length
      ? snaps.map((m) => `Stripe for ${m.project_name || 'an unnamed project'} on ${m.snapshot_date}: MRR ${money(m.mrr)}, ARR ${money(m.arr)}, monthly churn ${m.monthly_churn_pct ?? 'not recorded'}%, paying customers ${m.active_users ?? 'not recorded'}`)
      : ['No Stripe figures from this connection are linked to this company\'s projects.'],
    as_of: snaps[0]?.snapshot_date ?? row.last_synced_at ?? null,
  };
};

/** What GitHub delivered, counted per project and module from its ledger (D655). */
const github: ConnectorReader = async (env, _user, row, companyId) => {
  if (!(await inScope(env, row, companyId))) return NOTHING(row);
  const rows = await env.DB.prepare(
    `SELECT p.name AS project_name, f.module, f.kind, COUNT(*) AS n, MAX(f.last_seen_at) AS last_seen
       FROM connector_fed_items f JOIN projects p ON p.id = f.project_id
      WHERE f.integration_id = ? AND p.company_id = ? AND p.deleted_at IS NULL
      GROUP BY p.id, f.module, f.kind
      ORDER BY last_seen DESC LIMIT ?`,
  ).bind(row.id, companyId, READ_LIMIT).all<{ project_name: string | null; module: string; kind: string; n: number; last_seen: string }>();
  const groups = rows.results ?? [];
  return {
    facts: groups.length
      ? groups.map((g) => `GitHub for ${g.project_name || 'an unnamed project'}: ${g.n} ${g.kind.replace(/_/g, ' ')}${Number(g.n) === 1 ? '' : 's'} into ${MODULE_LABELS[g.module] || g.module}`)
      : ['Nothing from this GitHub connection has landed in this company\'s projects.'],
    as_of: row.last_synced_at ?? null,
  };
};

/**
 * RULE 1's other half: the readers that exist. A connector not in this map
 * is never read, even switched on, and no source line names it.
 */
export const CONNECTOR_READERS: Record<string, ConnectorReader> = { github, hubspot, salesforce, stripe };
