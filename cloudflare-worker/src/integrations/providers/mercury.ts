/**
 * D713 (#1778) — a member's own Mercury connection. READ-ONLY, `connect` ONLY.
 *
 * Founders, partners and, on HQ, investors (`personal_roles`, D752) connect
 * their own Mercury organization with a Read Only API token. The row is an ordinary
 * `integrations` row, encrypted by the route (`secrets.ts`, KEK_PII); only its
 * four-character preview is ever shown. It is read on demand, inside a request
 * its owner makes (`services/mercuryPersonal.ts`): this module defines no
 * sync, push, webhook, preview or action, and the route answers a Mercury
 * webhook 404 before it looks anything up.
 *
 * Every read goes through #1775's GET-only client and `parse.ts`, which keep
 * the organization's id and name and the accounts' kind and last four, and
 * drop every account, routing and EIN field.
 *
 * Each refusal keeps its own status and code (`ConnectRefusal`):
 *   403 support_session_refused    a support session (`impersonated_by`)
 *   403 purpose_not_allowed        a role that holds no personal connection
 *   403 purpose_not_allowed        an HQ-only personal role off HQ (D752; the route answers first)
 *   400 webhook_not_supported      a `webhook_secret` was sent
 *   400 api_key_required           no token
 *   400 token_rejected             Mercury answered 401 or 403
 *   403 write_scope_refused        the API reports a permission above read-only
 *   400 confirm_read_only_required it reports none, and the member did not confirm
 *   409 mercury_entity_account     decision 3: an Axal entity's organization
 *   503 bank_registry_unavailable  decision 3 could not be checked; nothing is stored
 *
 * DECISION 3 lives here, and `mercuryPersonal.ts` calls it again on every read:
 * the organization's normalised name against `AXAL_ENTITIES`, its account ids
 * against #1775's `mercury_accounts`, and its checking and savings last fours
 * against #1773's active `entity_bank_accounts` (`entity_key`, `account_last4`
 * and `status` only, never a decrypt). Those are the only reads personal code
 * makes of a #1775 or #1773 table.
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import { ConnectRefusal, audienceFor, type IntegrationRow, getDescriptor, noPersonalConnectionSentence, personalHqOnlyOffHq, personalHqOnlySentence, personalMercuryFor, registerProvider, type ConnectInput, type ConnectResult } from '../registry';
import { selectJwt } from '../../auth';
import { branchOf } from '../../util/branch';
import { canHoldValidateSource } from '../../routes/_founder_validate_helpers';
import { MercuryClientError } from '../../services/mercury/client';
import { tokenBankReader, type OrganizationRead } from '../../services/mercury/reads';
import { mcpCredentialsOf, revokeGrant } from '../../services/mercury/oauth';
import type { ParsedAccount, ParsedOrganization, TokenPermission } from '../../services/mercury/parse';
import { AXAL_ENTITIES } from '../../services/legalDocFormat';

type C = Context<{ Bindings: Env }>;

/**
 * Decision 3's normal form: lower-cased, every run of characters that are not
 * letters or digits made one space, trimmed, and a trailing `llc`, `l l c`,
 * `lp` or `l p` dropped. "AXAL VC MANAGEMENT, LLC" is "axal vc management".
 */
export function normalizeEntityName(name: string | null | undefined): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/(?:^|\s)(?:llc|l l c|lp|l p)$/, '').trim();
}

const AXAL_NAMES = Object.values(AXAL_ENTITIES).map((e) => normalizeEntityName(e.name));

/** The organization is an Axal entity's: its normalised name equals one. */
export function isAxalEntityName(name: string | null | undefined): boolean {
  const n = normalizeEntityName(name);
  return !!n && AXAL_NAMES.includes(n);
}

/** A bank line's counterparty names an Axal entity (D713 decisions 6 and 7). */
export function namesAxalEntity(counterparty: string | null | undefined, only?: keyof typeof AXAL_ENTITIES): boolean {
  const n = ` ${normalizeEntityName(counterparty)} `;
  const names = only ? [normalizeEntityName(AXAL_ENTITIES[only].name)] : AXAL_NAMES;
  return names.some((e) => n.includes(` ${e} `));
}

export const ENTITY_REFUSED = 'This Mercury organization belongs to an Axal entity. Connect your own organization; Axal\'s accounts are connected only for fund administration.';

/**
 * Decision 3. Null when the organization is the member's own; a refusal when
 * it is, or may be, an Axal entity's. A registry that cannot be read refuses:
 * the check fails closed.
 */
export async function entityAccountRefusal(env: Env, org: ParsedOrganization, accounts: ParsedAccount[]): Promise<ConnectRefusal | null> {
  if (isAxalEntityName(org.legal_name)) return new ConnectRefusal(409, 'mercury_entity_account', ENTITY_REFUSED);
  const ids = accounts.map((a) => a.mercury_account_id);
  const fours = [...new Set(accounts.map((a) => a.last_four))];
  try {
    if (ids.length) {
      const held = await env.DB.prepare(
        'SELECT 1 AS held FROM mercury_accounts WHERE mercury_account_id IN (SELECT value FROM json_each(?)) LIMIT 1',
      ).bind(JSON.stringify(ids)).first();
      if (held) return new ConnectRefusal(409, 'mercury_entity_account', ENTITY_REFUSED);
    }
    if (fours.length) {
      const registered = await env.DB.prepare(
        `SELECT entity_key, account_last4, status FROM entity_bank_accounts
          WHERE status = 'active' AND account_last4 IN (SELECT value FROM json_each(?)) LIMIT 1`,
      ).bind(JSON.stringify(fours)).first();
      if (registered) return new ConnectRefusal(409, 'mercury_entity_account', ENTITY_REFUSED);
    }
  } catch {
    return new ConnectRefusal(503, 'bank_registry_unavailable', 'Axal\'s account registry could not be read, so the connection could not be checked. Nothing was saved; try again later.');
  }
  return null;
}

/** Decision 2: a reported permission above read-only is refused; an unreported one needs the member's word. */
export function readOnlyRefusal(permission: TokenPermission, confirmed: boolean): ConnectRefusal | null {
  if (permission === 'above_read_only') {
    return new ConnectRefusal(403, 'write_scope_refused', 'That token can do more than read. Create a Read Only API token in your Mercury organization and use it instead.');
  }
  if (permission === 'not_reported' && !confirmed) {
    return new ConnectRefusal(400, 'confirm_read_only_required', 'Confirm that this is a Read Only token before connecting it.');
  }
  return null;
}

/** A support session acting as the member (`impersonated_by`, as `mcp_consent.ts` reads it). */
export async function isSupportSession(c: C): Promise<boolean> {
  return !!(await selectJwt(c))?.payload.impersonated_by;
}

export type { OrganizationRead };

/** The organization and its checking and savings accounts, through the GET-only client. */
export function readOrganization(token: string): Promise<OrganizationRead> {
  return tokenBankReader(token).readOrganization();
}

async function connect(c: C, user: User, input: ConnectInput): Promise<ConnectResult> {
  if (await isSupportSession(c)) {
    throw new ConnectRefusal(403, 'support_session_refused', 'A support session cannot connect a member\'s bank account.');
  }
  const desc = getDescriptor('mercury');
  const viewer = { role: String(user.role || ''), hq: branchOf(c.env) === null, venture: canHoldValidateSource(user) };
  // D752, defence in depth: `/connect` refuses this caller before it gets here.
  if (desc && personalHqOnlyOffHq(desc, viewer)) {
    throw new ConnectRefusal(403, 'purpose_not_allowed', personalHqOnlySentence(desc.display_name));
  }
  const variant = personalMercuryFor(user.role);
  if (!desc || !variant || audienceFor(desc, viewer) !== 'personal') {
    throw new ConnectRefusal(403, 'purpose_not_allowed', noPersonalConnectionSentence('Mercury'));
  }
  if (input.webhook_secret) {
    throw new ConnectRefusal(400, 'webhook_not_supported', 'Mercury takes no webhook here. Leave the webhook secret empty.');
  }
  const token = typeof input.api_key === 'string' ? input.api_key.trim() : '';
  if (!token || token.length > 512) {
    throw new ConnectRefusal(400, 'api_key_required', 'Paste a Read Only API token from your Mercury organization.');
  }
  let read: OrganizationRead;
  try {
    read = await readOrganization(token);
  } catch (e) {
    if (e instanceof MercuryClientError && e.code === 'unauthorized') {
      throw new ConnectRefusal(400, 'token_rejected', 'Mercury did not accept that token. Check it and try again.');
    }
    throw e;
  }
  const confirmed = input.config?.confirm_read_only === true;
  const scope = readOnlyRefusal(read.permission, confirmed);
  if (scope) throw scope;
  const entity = await entityAccountRefusal(c.env, read.org, read.accounts);
  if (entity) throw entity;
  // D840: a token replaces a sign-in on the same row; the sign-in's grant is revoked first.
  const prior = await c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'mercury'").bind(user.id).first<IntegrationRow>();
  const priorGrant = prior ? await mcpCredentialsOf(c.env, prior) : null;
  if (priorGrant) await revokeGrant(c.env, priorGrant);
  return {
    credentials: { api_key: token },
    external_account_id: read.org.id,
    external_account_name: read.org.legal_name,
    capabilities: [...variant.capabilities],
    config: { read_only: read.permission === 'read_only' ? 'reported' : 'confirmed' },
  };
}

/**
 * D840 (#2346): a member who signed in with Mercury has their grant revoked,
 * best effort, before the generic route deletes the row. A pasted token has
 * nothing to revoke: the member deletes it in Mercury.
 */
async function disconnect(c: C, _user: User, row: IntegrationRow): Promise<void> {
  const creds = await mcpCredentialsOf(c.env, row);
  if (creds) await revokeGrant(c.env, creds);
}

registerProvider({ key: 'mercury', connect, disconnect });
