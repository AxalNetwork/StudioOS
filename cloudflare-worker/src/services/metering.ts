/**
 * D844 (#2466) — metering on the one AI token ledger.
 *
 * Every billable MCP tool call, connector call and workflow step is held and
 * settled through `reserveAiBudget` and `settleAiReservation`
 * (`aiBudget.ts`). There is no second balance, ledger or rate: a price here is
 * integer micro-USD, the ledger's own unit.
 *
 * THE ORDER (`meteredCall`): quote from the policy, hold under the key
 * `exec:<execution id>:<component>`, run, settle at the provider's reported
 * cost when it reports one and the policy's otherwise, and release the hold
 * (settle 0, refunded) when the run throws, times out or is cancelled. The
 * failure table is in `documentation/architecture/decisions/D844.md`.
 *
 * WHERE THE PRICE COMES FROM. The policy (`METERING_POLICY`) and the provider's
 * reported usage, both on the server. Never from tool input or model output.
 *
 * FAILS CLOSED. A hold that cannot be taken or read means no run.
 *
 * THE COMPOSITE RULE. A tool that runs AI through `aiRouter` is charged by that
 * run's own hold, as every run is. A tool's fee is a second component under the
 * same execution id, with its own key, so neither is counted twice.
 *
 * A KEY'S OWN CAP (D849, #2472). A call through a member API key holds under
 * `key:<uid>:exec:…` (`apiKeyLimits.ts`), so the key's month spend is its own
 * holds. When the key has a monthly cap, the call is refused with
 * `key_limit_reached` if the key's spend plus the quote would pass it: checked
 * before the hold and again after it, counting the new hold, which is released
 * when the re-check fails. A settled charge may then pass 80% or 100% of the
 * cap, which notifies the member once.
 */
import type { Env } from '../types';
import { reserveAiBudget, settleAiReservation } from './aiBudget';
import { KEY_LIMIT_SENTENCE, keyHoldKey, keyMonthSpend, keyMonthlyLimit, noteKeyLimitThresholds, overCap } from './apiKeyLimits';

export interface MeteredOperation {
  /** Integer micro-USD per unit. */
  price_microusd: number;
  unit: 'call';
}

export interface MeteringPolicy {
  version: string;
  operations: Record<string, MeteredOperation>;
}

/** An MCP tool's operation name in the policy. */
export const toolOperation = (name: string) => `mcp.tool.${name}`;

/**
 * v1: every registered MCP tool, free. They are reads (D846's connector reads
 * among them) and the Validate interview tools, and `structure_with_studioos` pays for its model through its
 * own `aiRouter` hold. A new tool is added here when it is registered: the
 * test `metering_d844.test.ts` fails on a registered tool the policy does not
 * list. `quoteFor` refuses an unlisted operation; `callTool` runs an unlisted
 * tool unpriced, with a warning, so a tool registered before its price never
 * charges a member by accident.
 */
export const METERING_POLICY: MeteringPolicy = Object.freeze({
  version: 'd844-1',
  operations: Object.freeze({
    [toolOperation('list_companies')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('get_validate_context')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('get_interview_guide')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('submit_interview')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('propose_placements')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('structure_with_studioos')]: { price_microusd: 0, unit: 'call' },
    // D846's connector-backed reads, over StudioOS's own records.
    [toolOperation('get_build_progress')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('list_connections')]: { price_microusd: 0, unit: 'call' },
    // D864's customer-chat tools, over the inbox's own records.
    [toolOperation('list_channel_chats')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('get_session_insights')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('assign_chat_to_interview')]: { price_microusd: 0, unit: 'call' },
    // D874's call tools. summarize_meeting's model run holds and settles its
    // own AI tokens through aiRouter, so its tool fee is 0 (the composite rule).
    [toolOperation('list_meetings')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('get_meeting_transcript')]: { price_microusd: 0, unit: 'call' },
    [toolOperation('summarize_meeting')]: { price_microusd: 0, unit: 'call' },
  }) as Record<string, MeteredOperation>,
});

const integer = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** Whether the policy prices `operation` at all. */
export const listed = (operation: string, policy: MeteringPolicy = METERING_POLICY) =>
  Object.prototype.hasOwnProperty.call(policy.operations, operation);

/** The quote for `units` of `operation`, in micro-USD. An operation the policy does not list is refused. */
export function quoteFor(operation: string, units = 1, policy: MeteringPolicy = METERING_POLICY): number {
  const op = listed(operation, policy) ? policy.operations[operation] : null;
  if (!op || !integer(op.price_microusd)) throw new Error('Metering policy has no price for this operation');
  if (!integer(units) || units < 1) throw new Error('Metering units unreadable');
  const quote = op.price_microusd * units;
  if (!Number.isSafeInteger(quote)) throw new Error('Metering quote unreadable');
  return quote;
}

/** A refusal at the hold, in the words a member reads. No amounts. */
export class MeteringRefused extends Error {
  code: string;
  sentence: string;
  constructor(code: string, sentence: string) {
    super(sentence);
    this.code = code;
    this.sentence = sentence;
  }
}

/** The ledger's refusals, as an MCP error result says them. */
export const REFUSAL_WORDS: Record<string, { code: string; sentence: string }> = {
  budget_user_month: { code: 'insufficient_tokens', sentence: 'Not enough AI tokens. Add AI tokens or wait for next month’s allowance.' },
  budget_user_day: { code: 'insufficient_tokens', sentence: 'Not enough AI tokens. Add AI tokens or wait for next month’s allowance.' },
  spend_limit: { code: 'monthly_limit', sentence: 'Your monthly limit is reached. Raise it in Usage, or wait for next month.' },
  ai_paused: { code: 'ai_paused', sentence: 'AI is paused on this account. Contact support.' },
  budget_review: { code: 'budget_review', sentence: 'An earlier AI charge on this account is being checked. Try again once it is settled.' },
};

export function refusalFor(refusal: string): MeteringRefused {
  const words = REFUSAL_WORDS[refusal] ?? REFUSAL_WORDS.budget_user_month;
  return new MeteringRefused(words.code, words.sentence);
}

/** Why a metered run stopped early: its hold is released, never charged. */
export class MeteredRunStopped extends Error {
  reason: 'timeout' | 'cancelled';
  constructor(reason: 'timeout' | 'cancelled') {
    super(reason === 'timeout' ? 'Metered run timed out' : 'Metered run was cancelled');
    this.reason = reason;
  }
}

export interface MeteredUsage {
  /** The hold, or null when the quote was 0 and nothing was held. */
  reservation_uid: string | null;
  reserved_microusd: number;
  /** What was charged; null while a provider cost above the hold is in review. */
  charged_microusd: number | null;
  refunded_microusd: number;
  pricing_version: string;
  /** True when the provider reported more than the hold, and the hold went to review. */
  review: boolean;
}

export interface MeteredCallInput {
  userId: number;
  /** One execution: every component of it shares this id. */
  executionId: string;
  operation: string;
  /** The component under the execution, for the hold's key. Defaults to the operation. */
  component?: string;
  /** The server-side quote (`quoteFor`). */
  quoteMicrousd: number;
  /** The member key the call came through: its holds are tagged with it, and its own monthly cap applies (D849). */
  apiKeyUid?: string | null;
  pricingVersion?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: Date;
}

/** The run's handle: it reports the provider's cost, when the provider reports one. */
export interface Meter {
  reportCost(microusd: number): void;
}

/** The key of one component's hold. */
export const holdKey = (executionId: string, component: string) => `exec:${executionId}:${component}`;

const ID = /^[A-Za-z0-9._:-]{1,120}$/;

/** Runs `run` under a hold. The result carries what the usage row records. */
export async function meteredCall<T>(env: Env, input: MeteredCallInput, run: (meter: Meter) => Promise<T>): Promise<{ value: T; usage: MeteredUsage }> {
  const component = input.component ?? input.operation;
  if (!ID.test(String(input.executionId)) || !ID.test(component)) throw new Error('Metering execution unreadable');
  const keyUid = input.apiKeyUid ?? null;
  if (keyUid != null && !ID.test(String(keyUid))) throw new Error('Metering key unreadable');
  if (!integer(input.quoteMicrousd)) throw new Error('Metering quote unreadable');
  const pricing_version = input.pricingVersion ?? METERING_POLICY.version;
  let reported: number | null = null;
  const meter: Meter = {
    reportCost(microusd: number) {
      if (!integer(microusd)) throw new Error('Provider cost unreadable');
      reported = microusd;
    },
  };

  // Free: nothing is held, and the run is the run.
  if (input.quoteMicrousd === 0) {
    const value = await guarded(run(meter), input);
    return { value, usage: { reservation_uid: null, reserved_microusd: 0, charged_microusd: 0, refunded_microusd: 0, pricing_version, review: false } };
  }

  const now = input.now ?? new Date();
  const key = keyUid ? keyHoldKey(keyUid, input.executionId, component) : holdKey(input.executionId, component);
  // D849: the key's own cap, before the hold. Its earlier hold for this same call, on a replay, is not counted twice.
  const keyLimit = keyUid ? await keyMonthlyLimit(env, input.userId, keyUid) : null;
  if (keyUid && keyLimit != null && overCap(await keyMonthSpend(env, input.userId, keyUid, now, key), input.quoteMicrousd, keyLimit)) {
    throw new MeteringRefused('key_limit_reached', KEY_LIMIT_SENTENCE);
  }
  const hold = await reserveAiBudget(env, input.userId, input.quoteMicrousd, now, { idempotencyKey: key });
  if (!hold.ok) throw refusalFor(hold.refusal);
  // A replay of an execution that already finished never runs again: running it
  // would be free, and charging it would be twice.
  if ('replayed' in hold && hold.replayed && hold.status !== 'pending') {
    throw new MeteringRefused('execution_closed', 'This call has already finished. Start a new one.');
  }
  const reservation = hold.reservation;
  // D849: the re-check, counting this hold. A call racing this one past the cap
  // is counted too, so both are refused rather than both charged.
  if (keyUid && keyLimit != null && !('replayed' in hold && hold.replayed)
    && (await keyMonthSpend(env, input.userId, keyUid, now)) > keyLimit) {
    await settleAiReservation(env, reservation, 0, true);
    throw new MeteringRefused('key_limit_reached', KEY_LIMIT_SENTENCE);
  }

  let value: T;
  try {
    value = await guarded(run(meter), input);
  } catch (e) {
    // Released, never charged. If the release itself fails, the hold expires
    // in five minutes and the next read releases it (`releaseExpired`), so the
    // run's own error is the one the caller sees.
    let released = true;
    try { await settleAiReservation(env, reservation, 0, true); }
    catch (release) { released = false; console.warn('[metering] release failed', (release as Error)?.message); }
    if (e && typeof e === 'object') {
      (e as { meteringUsage?: MeteredUsage }).meteringUsage = { reservation_uid: reservation.uid, reserved_microusd: input.quoteMicrousd,
        charged_microusd: released ? 0 : null, refunded_microusd: released ? input.quoteMicrousd : 0, pricing_version, review: false };
    }
    throw e;
  }
  const cost: number = reported ?? input.quoteMicrousd;
  try {
    await settleAiReservation(env, reservation, cost);
  } catch (e) {
    // A provider cost above the hold: the hold is in review with its recorded
    // cost (D640), for a Super Admin to charge or refund. Never capped here.
    if (/exceeds reservation/.test(String((e as Error)?.message))) {
      return { value, usage: { reservation_uid: reservation.uid, reserved_microusd: input.quoteMicrousd, charged_microusd: null, refunded_microusd: 0, pricing_version, review: true } };
    }
    throw e;
  }
  // D849: a settled charge may pass 80% or 100% of the key's cap. A notice never fails the call.
  if (keyUid && keyLimit != null && cost > 0) {
    try { await noteKeyLimitThresholds(env, input.userId, keyUid, now); }
    catch (notice) { console.warn('[metering] key limit notice failed', (notice as Error)?.message); }
  }
  return { value, usage: { reservation_uid: reservation.uid, reserved_microusd: input.quoteMicrousd,
    charged_microusd: cost, refunded_microusd: input.quoteMicrousd - cost, pricing_version, review: false } };
}

/** The run, stopped by its timeout or its signal. A stopped run's result is never used. */
function guarded<T>(work: Promise<T>, input: { timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
  const stops: Promise<never>[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  if (input.timeoutMs != null) {
    stops.push(new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new MeteredRunStopped('timeout')), input.timeoutMs); }));
  }
  if (input.signal) {
    if (input.signal.aborted) return Promise.reject(new MeteredRunStopped('cancelled'));
    stops.push(new Promise<never>((_, reject) => {
      onAbort = () => reject(new MeteredRunStopped('cancelled'));
      input.signal!.addEventListener('abort', onAbort, { once: true });
    }));
  }
  if (!stops.length) return work;
  return Promise.race([work, ...stops]).finally(() => {
    if (timer) clearTimeout(timer);
    if (onAbort) input.signal?.removeEventListener('abort', onAbort);
  });
}
