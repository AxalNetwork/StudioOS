import { ownLicenceMeets } from '../licencePlans';
/** D4422 (#4422): the existing plan/model offer, shared by Team settings and enforcement. */
import type { Env, User } from '../../types';
import { isAdmin } from '../../routes/_t13t14t15_helpers';
import { modelRefusal } from '../aiRouter';
import { CATALOGUE } from '../ai/catalogue';
import { AI_MARKUP, billedUnitPrice, unitPrice } from '../ai/pricing';
import { MODEL_CONNECTIONS } from '../ai/moduleConnections';
import { USE_KINDS, type UseKind } from '../ai/modelUseCases';

/**
 * D8769 (#8769): the jobs a Team agent's model can be listed for, in the order
 * the Model and cap step groups them. Only the selectable text kinds an agent's
 * run uses; voice, image, embedding and guard kinds never apply to an agent.
 */
export const AGENT_JOBS: readonly UseKind[] = Object.freeze(['research', 'reason', 'numbers', 'legal', 'write', 'synth', 'plan', 'agent', 'chat', 'code', 'read_images'] as UseKind[]);

/** The agent jobs (`AGENT_JOBS`, from `USE_KINDS`) a model is listed for, each `{ key, label }`, in that order. */
export function modelJobs(id: string): Array<{ key: UseKind; label: string }> {
  return AGENT_JOBS.filter((k) => USE_KINDS[k].selectable && USE_KINDS[k].models.includes(id)).map((k) => ({ key: k, label: USE_KINDS[k].label }));
}

/** Owner Q6 = A: a founder on a paid plan (the D852 rule), or HQ's admin. */
export function planOk(user: User): boolean {
  if (isAdmin(user)) return true;
  return ownLicenceMeets(user, 'founder', 'growth');
}

/**
 * #3842 add-on (S1, for TM3b): the models an agent may run on. Every text
 * model the module connections give chat work (`MODEL_CONNECTIONS`), from the
 * catalogue; member-billed input/output rates are expressed per million tokens;
 * `plan_locked` when the run would refuse it today
 * (`modelRefusal`: a beta, the partner gate shut, unpriced) or the caller's
 * plan cannot add agents, so the list and the add route's
 * `model_not_offered` agree. Deprecated models are not listed.
 *
 * D8769 (#8769): each model also carries the jobs it is listed for
 * (`modelJobs`, from `USE_KINDS`), its catalogue `capabilities` and its
 * `context_window` (null when the catalogue has none), so the step can group
 * models by the work they support and say what each is good at.
 */
export function agentModels(env: Env, user: User) {
  const plan = planOk(user);
  return CATALOGUE
    .filter((m) => MODEL_CONNECTIONS[m.id]?.operation === 'chat' && m.status !== 'deprecated' && m.status !== 'not_found')
    .map((m) => {
      const input = unitPrice(m.id, 'tokens_in');
      const output = unitPrice(m.id, 'tokens_out');
      return {
        id: m.id, label: m.name, kind: m.kind, beta: m.status === 'beta', plan_locked: !plan || modelRefusal(env, m.id) !== null,
        jobs: modelJobs(m.id), capabilities: [...m.capabilities], context_window: m.context_window ?? null,
        input_usd_per_million: input == null ? null : billedUnitPrice(input, AI_MARKUP),
        output_usd_per_million: output == null ? null : billedUnitPrice(output, AI_MARKUP),
      };
    });
}
