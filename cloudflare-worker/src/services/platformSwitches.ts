/**
 * The platform's switches, read the way the code that obeys them reads them.
 *
 * THERE IS STILL NO FEATURE-FLAG STORE. No table, no panel, nothing an
 * operator can throw from the product or stage to one territory. What the
 * platform does have is a handful of switches set at deploy — Worker
 * variables — and one the AI router throws by itself. HQ Platform's Feature
 * flags console lists them read-only, so an operator can see what is on
 * without reading the deploy configuration (D202, H17 P7). The store that
 * would let HQ throw one is D203's.
 *
 * EACH SWITCH ASKS ITS READER'S OWN PREDICATE. The predicates disagree about
 * what "on" means, and each disagreement is somebody's shipped decision:
 *
 *   Eadwyn off / reranking off   '1' or 'true', exactly
 *   Stripe Tax                   '1', 'true', 'yes' or 'on', any case
 *   Session charging             '1' exactly, AND a Stripe key present
 *   Cloudflare Queue             'true' exactly, AND the JOB_QUEUE binding
 *   market-intelligence source   'live', any case — '1' means the stub
 *   diligence connector          1 | true | on | yes, any case
 *
 * A second parser written here would be wrong for at least one of them, and
 * would show a switch as on while the code that obeys it reads it as off —
 * the exact disagreement a console exists to rule out. So nothing below reads
 * a variable; every entry calls the function its reader calls.
 *
 * STATE ONLY, NEVER A VALUE, AND NEVER A VARIABLE NAME. The payload carries
 * on / off / unreadable and a sentence about what "on" does. Which variable
 * sets each switch is written here, for engineers, and in D202:
 *
 *   key                          reader                        variable(s)
 *   eadwyn_off                   advisor/rollout isAdvisorDisabled   ADVISOR_V2_DISABLED, ADVISOR_DISABLED
 *   eadwyn_rerank_off            advisor/rerank rerankDisabled       ADVISOR_RERANK_DISABLED
 *   ai_budget_trip               aiRouter aiOrgKillSwitchState       (KV key, set by the router)
 *   session_charging             advisorMoney settlementMode         ADVISOR_CHARGING_ENABLED + STRIPE_SECRET_KEY
 *   stripe_tax                   util/stripeTax stripeTaxEnabled     STRIPE_TAX_ENABLED
 *   cf_queue                     queue cfQueueEnabled                USE_CF_QUEUE + JOB_QUEUE binding
 *   market_sources_live          market_intel/registry isLive        MI_FLAG_<SOURCE>
 *   diligence_connectors_live    dueDiligence isFlagged              DD_FLAG_<CONNECTOR>
 *
 * `frontend/test/hq_platform_consoles_d202.test.mjs` fails when an entry
 * stops importing its reader's predicate, and the worker test drives each one
 * with the values the predicates disagree on.
 */
import type { Env } from '../types';
import { isAdvisorDisabled } from './advisor/rollout';
import { rerankDisabled } from './advisor/rerank';
import { aiOrgKillSwitchState } from './aiRouter';
import { settlementMode } from './advisorMoney';
import { stripeTaxEnabled } from '../util/stripeTax';
import { cfQueueEnabled } from './queue';
import { listSources, isLive } from './market_intel/registry';
// The source modules register themselves on import; without the barrel,
// listSources() answers with whatever some other module happened to load.
// routes/market_intel.ts imports it at the top for the same reason.
import './market_intel/sources';
import { CONNECTORS, isFlagged } from './dueDiligence';

/**
 * Every state a switch can be reported in. HQ Platform gives each one a tone,
 * and `hq_platform_consoles_d202.test.mjs` fails when the page's tones and
 * this list differ — a tone for a state nothing returns is decoration, and a
 * state with no tone would draw as whatever the fallback happens to be.
 */
export const SWITCH_STATES = ['on', 'off', 'unreadable'] as const;
export type SwitchState = typeof SWITCH_STATES[number];

export interface PlatformSwitch {
  key: string;
  label: string;
  state: SwitchState;
  /** `deploy`: a Worker variable, changed by a deployment. `runtime`: thrown by the platform itself. */
  set_by: 'deploy' | 'runtime';
  /** What is true while the switch is on. */
  effect: string;
  /** A family's count, or a mode. Never a variable's value. */
  detail?: string;
  /** A family of switches: how many of its members are on. */
  count?: { on: number; of: number };
  /** Why the state is what it is, where the state alone would mislead. */
  reason?: string;
}

const onOff = (b: boolean): SwitchState => (b ? 'on' : 'off');

/** Names joined for a sentence, the list cut short rather than the sentence. */
function names(list: string[], max = 6): string {
  if (list.length <= max) return list.join(', ');
  return `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
}

export async function readPlatformSwitches(env: Env): Promise<PlatformSwitch[]> {
  const settlement = settlementMode(env);
  const trip = await aiOrgKillSwitchState(env);

  const sources = listSources();
  const liveSources = sources.filter((s) => isLive(env, s.key));
  const flaggedConnectors = CONNECTORS.filter((c) => isFlagged(env, c.flag_env));

  const tripSwitch: PlatformSwitch = {
    key: 'ai_budget_trip',
    label: 'AI budget trip',
    state: trip === 'unreadable' ? 'unreadable' : onOff(trip === 'on'),
    set_by: 'runtime',
    effect: 'Every AI call on the platform is refused.',
    ...(trip === 'on' ? {
      reason: 'The router threw it when the organisation\'s monthly AI spend passed its cap. It clears '
        + 'when its key expires, up to 35 days after it was set — nothing in the product clears it sooner.',
    } : {}),
    ...(trip === 'unreadable' ? {
      reason: 'The spend store did not answer, so whether the trip is set is unknown. The router fails '
        + 'open on the same error and keeps serving.',
    } : {}),
    ...(trip === 'no_store' ? {
      reason: 'No spend store is bound on this deployment, so the router keeps no budget and cannot trip.',
    } : {}),
  };

  return [
    {
      key: 'eadwyn_off',
      label: 'Eadwyn off',
      state: onOff(isAdvisorDisabled(env)),
      set_by: 'deploy',
      effect: 'Eadwyn answers every message with a notice that it is unavailable.',
    },
    {
      key: 'eadwyn_rerank_off',
      label: 'Eadwyn question reranking off',
      state: onOff(rerankDisabled(env)),
      set_by: 'deploy',
      effect: 'Eadwyn asks its questions in the bank\'s fixed order; no model picks the most relevant one.',
    },
    tripSwitch,
    {
      key: 'session_charging',
      label: 'Session charging',
      state: onOff(settlement !== 'none'),
      set_by: 'deploy',
      effect: 'Priced sessions are charged through Stripe.',
      ...(settlement === 'none' ? {} : { detail: settlement === 'live' ? 'Stripe live mode' : 'Stripe test mode' }),
    },
    {
      key: 'stripe_tax',
      label: 'Stripe Tax',
      state: onOff(stripeTaxEnabled(env)),
      set_by: 'deploy',
      effect: 'Checkouts, invoices and subscriptions ask Stripe to compute tax.',
    },
    {
      key: 'cf_queue',
      label: 'Cloudflare Queue',
      state: onOff(cfQueueEnabled(env)),
      set_by: 'deploy',
      effect: 'Background jobs go to the Cloudflare queue rather than the D1 job table.',
    },
    {
      key: 'market_sources_live',
      label: 'Live market sources',
      state: onOff(liveSources.length > 0),
      set_by: 'deploy',
      effect: 'A live source calls its provider; every other source serves its stub rows.',
      count: { on: liveSources.length, of: sources.length },
      detail: liveSources.length
        ? `${liveSources.length} of ${sources.length} live: ${names(liveSources.map((s) => s.display_name))}`
        : `none of ${sources.length} live`,
    },
    {
      key: 'diligence_connectors_live',
      label: 'Live diligence connectors',
      state: onOff(flaggedConnectors.length > 0),
      set_by: 'deploy',
      effect: 'A switched-on connector runs during a diligence check; a switched-off one is recorded as '
        + 'disabled and adds nothing.',
      count: { on: flaggedConnectors.length, of: CONNECTORS.length },
      detail: flaggedConnectors.length
        ? `${flaggedConnectors.length} of ${CONNECTORS.length} on: ${names(flaggedConnectors.map((c) => c.label))}`
        : `none of ${CONNECTORS.length} on`,
    },
  ];
}
