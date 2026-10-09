import type { Env } from '../types';
import type { IntegrationRow } from './registry';
import { scheduledSyncDue } from './connectorRules';

/** These providers write into project-backed stores; other connections are personal. */
export function writesProjectData(providerKey: string): boolean {
  return providerKey === 'hubspot' || providerKey === 'salesforce' || providerKey === 'stripe' || providerKey === 'github';
}

/** A missing scope row denies the write; joining another company grants nothing. */
export async function enabledCompanyIds(env: Env, integrationId: number): Promise<number[]> {
  const rows = await env.DB.prepare(
    'SELECT ic.company_id FROM integration_companies ic JOIN integrations i ON i.id = ic.integration_id ' +
    'JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id ' +
    'WHERE ic.integration_id = ? AND ic.enabled = 1 ORDER BY ic.company_id',
  ).bind(integrationId).all<{ company_id: number }>();
  return (rows.results || []).map((row) => row.company_id);
}

export async function companyEnabled(env: Env, integrationId: number, companyId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS allowed FROM integration_companies ic JOIN integrations i ON i.id = ic.integration_id ' +
    'JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id ' +
    'WHERE ic.integration_id = ? AND ic.company_id = ? AND ic.enabled = 1',
  ).bind(integrationId, companyId).first<{ allowed: number }>();
  return !!row;
}

export async function projectEnabled(env: Env, integrationId: number, projectId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS allowed FROM projects p JOIN integration_companies ic ON ic.company_id = p.company_id ' +
    'JOIN integrations i ON i.id = ic.integration_id ' +
    'JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id ' +
    'WHERE p.id = ? AND ic.integration_id = ? AND ic.enabled = 1 AND p.deleted_at IS NULL',
  ).bind(projectId, integrationId).first<{ allowed: number }>();
  return !!row;
}

export async function scheduledConnectorEnabled(env: Env, row: IntegrationRow): Promise<boolean> {
  if (!scheduledSyncDue(row.config_json, row.last_synced_at)) return false;
  return !writesProjectData(row.provider_key) || (await enabledCompanyIds(env, row.id)).length > 0;
}
