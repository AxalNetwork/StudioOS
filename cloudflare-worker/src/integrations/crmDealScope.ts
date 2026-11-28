/**
 * D8964 (#8964): the HubSpot and Salesforce reads that scope a deal or project to the integration owner.
 *
 * A founder row belongs to a user through `users.founder_id` (the column `canAccessFounderResource` in
 * `../auth.ts` compares, and the join `services/records/grow.ts` uses for a connected integration's
 * projects). `founders` has no `user_id`, so the providers' old `f.user_id = ?` failed with "no such
 * column" on the real schema. Each statement keeps its bind order: the owner's user id is still one `?`.
 * An owner with no `founder_id` (an admin, an investor) matches nothing: the scalar subquery is NULL.
 * `cloudflare-worker/test/crm_deal_scope_8964.test.ts` runs every statement on the migrated schema.
 */

/** True when founder `f` is the one held by the user bound at this `?`. */
export const FOUNDER_OF_OWNER = 'f.id = (SELECT u.founder_id FROM users u WHERE u.id = ? AND u.founder_id IS NOT NULL)';

export type CrmDealKey = 'hubspot_deal_id' | 'sf_opportunity_id';

const ENABLED_COMPANY =
  'EXISTS (SELECT 1 FROM integration_companies ic WHERE ic.integration_id = ? AND ic.company_id = p.company_id AND ic.enabled = 1)';

/** Outbound sync: the owner's deals in an enabled company. Binds (owner, since, integration), plus hidden IDs when D5454's guard is requested. */
export function ownerDealsChangedSinceSql(key: CrmDealKey, excludeHidden = false): string {
  return `SELECT d.id, d.status, d.${key}, d.updated_at ` +
    'FROM deals d ' +
    'LEFT JOIN projects p ON p.id = d.project_id ' +
    'LEFT JOIN founders f ON f.id = p.founder_id ' +
    `WHERE ${FOUNDER_OF_OWNER} AND datetime(d.updated_at) > datetime(?) ` +
    `AND ${ENABLED_COMPANY} ` +
    (excludeHidden ? 'AND d.id NOT IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) ' : '') +
    'ORDER BY datetime(d.updated_at) DESC LIMIT 100';
}

/** Inbound sync and webhook: the owner's local deal for one CRM id, in an enabled company. Binds (crm id, owner, integration). */
export function ownerDealByCrmIdSql(key: CrmDealKey): string {
  return 'SELECT d.id, d.status, d.stage_changed_at FROM deals d ' +
    'LEFT JOIN projects p ON p.id = d.project_id ' +
    'LEFT JOIN founders f ON f.id = p.founder_id ' +
    `WHERE d.${key} = ? AND ${FOUNDER_OF_OWNER} ` +
    `AND ${ENABLED_COMPANY}`;
}

/** Salesforce push: one deal, only when the owner's. Binds (deal id, owner). */
export const SF_OWNER_DEAL_SQL =
  'SELECT d.*, p.name as project_name, p.sf_account_id ' +
  'FROM deals d ' +
  'LEFT JOIN projects p ON p.id = d.project_id ' +
  'LEFT JOIN founders f ON f.id = p.founder_id ' +
  `WHERE d.id = ? AND ${FOUNDER_OF_OWNER}`;

/** Salesforce account push: one project, only when the owner's. Binds (project id, owner). */
export const SF_OWNER_PROJECT_SQL =
  'SELECT p.*, f.id as f_id, f.email as founder_email, f.name as founder_name, f.sf_contact_id as founder_sf_contact_id ' +
  'FROM projects p LEFT JOIN founders f ON f.id = p.founder_id ' +
  `WHERE p.id = ? AND ${FOUNDER_OF_OWNER}`;
