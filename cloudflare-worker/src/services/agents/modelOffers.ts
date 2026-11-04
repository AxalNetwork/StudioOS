import { holdsLicence } from '../accountLicences';
/** D4422 (#4422): the existing plan/model offer, shared by Team settings and enforcement. */
import type { Env, User } from '../../types';
import { userMeetsTier } from '../../middleware/requireTier';
import { isAdmin } from '../../routes/_t13t14t15_helpers';
import { modelRefusal } from '../aiRouter';
import { CATALOGUE } from '../ai/catalogue';
import { MODEL_CONNECTIONS } from '../ai/moduleConnections';

/** Owner Q6 = A: a founder on a paid plan (the D852 rule), or HQ's admin. */
export function planOk(user: User): boolean {
  if (isAdmin(user)) return true;
  return holdsLicence(user, 'founder') && userMeetsTier(user, 'growth');
}

/**
 * #3842 add-on (S1, for TM3b): the models an agent may run on. Every text
 * model the module connections give chat work (`MODEL_CONNECTIONS`), from the
 * catalogue; `plan_locked` when the run would refuse it today
 * (`modelRefusal`: a beta, the partner gate shut, unpriced) or the caller's
 * plan cannot add agents, so the list and the add route's
 * `model_not_offered` agree. Deprecated models are not listed.
 */
export function agentModels(env: Env, user: User) {
  const plan = planOk(user);
  return CATALOGUE
    .filter((m) => MODEL_CONNECTIONS[m.id]?.operation === 'chat' && m.status !== 'deprecated' && m.status !== 'not_found')
    .map((m) => ({ id: m.id, label: m.name, kind: m.kind, beta: m.status === 'beta', plan_locked: !plan || modelRefusal(env, m.id) !== null }));
}
