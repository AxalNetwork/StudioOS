import { founderZoneActions } from './founderZoneActions';
import { investorZoneActions } from './investorZoneActions';
import { partnerZoneActions } from './partnerZoneActions';
import { advisorZoneActions } from './advisorZoneActions';

/**
 * The zone action row for a surface that serves more than one licence.
 *
 * `/network/*` and `/research/*` are single components answering four roles.
 * Their zone bodies are identical and their zone ACTIONS are not — the same
 * artboard label means different things to a founder and to an advisor, and
 * sometimes one of them has a route for it and the other does not. So the body
 * stays shared and the answers stay in each profile's own table; this picks the
 * table by the role the shell already resolved.
 *
 * An unknown role gets an EMPTY list rather than a default profile's. A header
 * that silently shows a founder's actions to an operator would be the same
 * broken promise as a dead button, and harder to notice.
 */
const BY_ROLE = {
  founder: founderZoneActions,
  investor: investorZoneActions,
  partner: partnerZoneActions,
  advisor: advisorZoneActions,
};

export function zoneActionsFor(role, key, opts) {
  const fn = BY_ROLE[role];
  return fn ? fn(key, opts) : [];
}
