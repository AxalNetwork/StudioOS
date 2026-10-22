/**
 * D713 (#1778) — a member's own Mercury connection. READ-ONLY.
 *
 * Founders, partners and, on HQ, investors (`personal_roles`, D752) hold
 * their own Mercury organization as an ordinary `integrations` row. It is read
 * on demand, inside a request its owner makes (`services/mercuryPersonal.ts`):
 * this module defines no sync, push, webhook, preview or action, and the route
 * answers a Mercury webhook 404 before it looks anything up.
 *
 * D881 (#2554): a member connects only by Sign in with Mercury
 * (`routes/mercury_oauth.ts`, Mercury's MCP server). `connect` takes no token:
 * a new connection and a replace of a stored one are both refused, and nothing
 * reaches Mercury or is stored. A row a member connected with a Read Only API
 * token before D881 keeps reading through #1775's GET-only client
 * (`services/mercury/connection.ts`) until they disconnect or sign in, which
 * turns the same row into a sign-in. No row is disconnected for them.
 *
 * Each refusal keeps its own status and code (`ConnectRefusal`):
 *   403 support_session_refused    a support session (`impersonated_by`)
 *   403 purpose_not_allowed        a role that holds no personal connection
 *   403 purpose_not_allowed        an HQ-only personal role off HQ (D752; the route answers first)
 *   410 token_connect_retired      every token, new or a replace (D881)
 *
 * DECISION 3 lives here, and the sign-in and `mercuryPersonal.ts` call it on every connect and read:
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

/** D881: the one refusal every token connect reads, new or a replace. */
export const TOKEN_CONNECT_RETIRED = 'Connect Mercury with Sign in with Mercury.';
/** D881: what a member connected by token before D881 reads beside their connection. */
export const LEGACY_TOKEN_NOTICE = 'Connected with an API token. Sign in with Mercury to keep it connected after you reconnect.';

async function connect(c: C, user: User, _input: ConnectInput): Promise<ConnectResult> {
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
  // D881 (#2554): Sign in with Mercury only. A token is never read, checked or stored.
  throw new ConnectRefusal(410, 'token_connect_retired', TOKEN_CONNECT_RETIRED);
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
