/**
 * The platform's switches, read the way the code that obeys them reads them.
 *
 * ONE OF THEM AN OPERATOR CAN THROW (D203). Most of the platform's switches
 * are set at deploy — Worker variables — and one the AI router throws by
 * itself. Eadwyn's kill has a second half since D203: a row in
 * `platform_switches` that HQ throws and releases from Platform → Switches,
 * with a reason and an audit entry, without a deploy
 * (services/operatorSwitches.ts). That entry is marked `writable` and carries
 * both halves; every other entry is still read-only, and nothing stages a
 * switch to one territory. HQ Platform's Feature flags console lists them all
 * (D202, H17 P7).
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
 *   eadwyn_off                   advisor/rollout advisorKillState    ADVISOR_V2_DISABLED, ADVISOR_DISABLED
 *                                                                      + the platform_switches row (D203)
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
import { advisorKillState, type AdvisorKillState } from './advisor/rollout';
import { operatorSwitchActorName } from './operatorSwitches';
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

/**
 * Every switch the registry reports, in the order it reports them. The throw
 * route reads this to tell a switch an operator cannot throw (409) from a key
 * that names nothing (404), and the worker test fails when the list and what
 * readPlatformSwitches returns differ.
 */
export const PLATFORM_SWITCH_KEYS = [
  'eadwyn_off', 'eadwyn_rerank_off', 'ai_budget_trip', 'session_charging',
  'stripe_tax', 'cf_queue', 'market_sources_live', 'diligence_connectors_live',
] as const;

/**
 * An operator switch's stored half, as the console reads it. `available:
 * false` is a store that could not be read, which is never the same claim as
 * a switch nobody threw.
 */
export type OperatorHalf =
  | {
    available: true;
    thrown: boolean;
    /** Why it was last thrown or released; null while nobody ever has. */
    reason: string | null;
    set_by_user_id: number | null;
    /** The account's name, or its email; null when it cannot be named. */
    set_by_name: string | null;
    /** SQLite's clock, `YYYY-MM-DD HH:MM:SS`; null while nobody ever has. */
    set_at: string | null;
    /** When this reading was taken from the store, ISO. */
    read_at: string;
    /** Set when the latest read failed and this is the last good reading. */
    stale_reason?: string;
  }
  | { available: false; reason: string };

export interface PlatformSwitch {
  key: string;
  label: string;
  state: SwitchState;
  /**
   * `deploy`: a Worker variable, changed by a deployment. `runtime`: thrown by
   * the platform itself. `operator`: HQ can throw it from Platform → Switches,
   * beside the deploy variable that can also hold it on.
   */
  set_by: 'deploy' | 'runtime' | 'operator';
  /** What is true while the switch is on. */
  effect: string;
  /** A family's count, or a mode. Never a variable's value. */
  detail?: string;
  /** A family of switches: how many of its members are on. */
  count?: { on: number; of: number };
  /** Why the state is what it is, where the state alone would mislead. */
  reason?: string;
  /** Present, and true, only on a switch an operator can throw (D203). */
  writable?: true;
  /** An operator switch's deploy half: is the Worker variable holding it on. */
  deploy?: 'on' | 'off';
  /** An operator switch's stored half. */
  operator?: OperatorHalf;
}

const onOff = (b: boolean): SwitchState => (b ? 'on' : 'off');

/** Names joined for a sentence, the list cut short rather than the sentence. */
function names(list: string[], max = 6): string {
  if (list.length <= max) return list.join(', ');
  return `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
}

/**
 * Eadwyn's kill as the console reports it — the verdict `advisorKillState`
 * reaches, which is the verdict every advisor route refuses by, plus both
 * halves so an operator can see what holds it.
 *
 * THE STATE IS THE GATE'S, never recomputed here: `on` when the gate refuses,
 * `unreadable` when the store could not be read and nothing else decided —
 * the gate fails open on exactly that, so Eadwyn is answering while the
 * console cannot say whether an operator meant it to stop.
 */
async function eadwynSwitch(env: Env, kill: AdvisorKillState): Promise<PlatformSwitch> {
  const read = kill.operator;
  let operator: OperatorHalf;
  if (!read) {
    // Only the gate's own mode leaves the store unread; the console asks in
    // `inspect`, which always reads it. Said rather than assumed.
    operator = { available: false, reason: 'The operator switch store was not read.' };
  } else if (!read.readable) {
    operator = { available: false, reason: read.reason };
  } else {
    const row = read.rows.get('eadwyn_off') || null;
    operator = {
      available: true,
      thrown: row?.thrown === true,
      reason: row ? row.reason : null,
      set_by_user_id: row ? row.set_by_user_id : null,
      set_by_name: row ? await operatorSwitchActorName(env, row.set_by_user_id) : null,
      set_at: row ? row.set_at : null,
      read_at: read.read_at,
      ...(read.stale_reason ? { stale_reason: read.stale_reason } : {}),
    };
  }

  const state: SwitchState = kill.off ? 'on' : operator.available ? 'off' : 'unreadable';
  let reason: string | undefined;
  if (kill.by === 'deploy') {
    reason = 'Held on by the deployment. Releasing an operator switch does not turn Eadwyn back on; '
      + 'only a deployment does.';
  } else if (state === 'unreadable') {
    reason = 'The operator switch store could not be read, so whether an operator has thrown this '
      + 'is unknown. Eadwyn fails open on the same error and keeps answering; the deployment can '
      + 'still switch it off.';
  } else if (operator.available && operator.stale_reason) {
    reason = 'The latest read of the operator switch store failed. This is the last reading that '
      + 'answered, and it is the one the gate here is using.';
  }

  return {
    key: 'eadwyn_off',
    label: 'Eadwyn off',
    state,
    set_by: 'operator',
    effect: 'Eadwyn answers every message with a notice that it is unavailable.',
    ...(reason ? { reason } : {}),
    writable: true,
    deploy: kill.deploy ? 'on' : 'off',
    operator,
  };
}

/**
 * The switches an operator can throw, as the console reports them — one entry
 * per OPERATOR_SWITCH_KEYS key, each built from the predicate that obeys it.
 * `inspect`: both halves, the store read now; the verdict is computed exactly
 * as the gate computes it (services/advisor/rollout.ts).
 */
export async function readOperatorSwitchEntries(env: Env): Promise<PlatformSwitch[]> {
  return [await eadwynSwitch(env, await advisorKillState(env, { inspect: true }))];
}

export async function readPlatformSwitches(env: Env): Promise<PlatformSwitch[]> {
  const settlement = settlementMode(env);
  const [eadwyn] = await readOperatorSwitchEntries(env);
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
      reason: 'The router threw it when the organisation\'s AI spend for this month passed its cap. It '
        + 'holds for the rest of the calendar month (UTC) and lifts on the 1st, when the next month\'s '
        + 'budget starts — nothing in the product clears it sooner.',
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
    eadwyn,
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
