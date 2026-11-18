/**
 * #7073 part 2 (D7073-p2): an engine-started agent run's model call, through the
 * authenticated `agents` AI Gateway, over up to four accounts in a fixed order.
 *
 * THE ORDER is the review workflow's (`scripts/lib/claudeReview.mjs`): the
 * primary Claude account, Claude account 2, Claude account 3, then OpenAI with
 * `OPENAI_MODEL`. Every run starts at the primary. A slot with no alias, no
 * priced model, or a model HQ locked or the scope's allow-list refuses is
 * skipped before any call. The first valid answer ends the loop.
 *
 * EACH ACCOUNT IS A STORED KEY ON THE GATEWAY, chosen by alias. The request is
 * provider-native (`/anthropic/v1/messages`, `/openai/chat/completions`), with
 * `cf-aig-authorization` (the gateway's Run token, `AGENT_AI_GATEWAY_TOKEN`)
 * and `cf-aig-byok-alias`, and no provider key: the Worker never holds one.
 * `env.AI.run()` cannot do this, because it consults only the `default` alias.
 * The alias `default` is refused here for the same reason: a missing `default`
 * key falls through to Cloudflare's Unified Billing.
 *
 * WHAT MOVES THE LOOP, read from the answer (`classify`):
 *   - `advance`: a confirmed account-specific refusal that billed nothing: the
 *     account's credit is gone (Anthropic 402, its "credit balance is too low"
 *     400, its own `enforced_spend_limit_reached` 429; OpenAI's
 *     `insufficient_quota` 429), its key was refused (401, 403), or the gateway
 *     has no key under that alias (2044).
 *   - `stop_all`: the gateway's own spend limit, or any sign the call reached
 *     Unified Billing (2052, 2021). The run ends `gateway_limit`, which the task
 *     loop turns into the platform breaker, so no later run calls a model.
 *   - `stop_run`: anything else, a 429 whose source is not certain above all.
 *     That run ends; no other account is tried for it.
 *
 * MONEY. One hold per attempt, on the sponsor, under the run's one execution id
 * (`<run uid>`, component `agent.account.<slot>`), so a retried step replays
 * the same holds and never takes two. An attempt that billed nothing settles at
 * 0; one that may have been billed (a timeout, a 5xx, an unreadable answer)
 * settles at its quote. The input is guarded once, in the first attempt's hold;
 * the answer is guarded in its own attempt's hold. Every attempt writes a usage
 * row with the agent's id, so the agent's monthly cap counts it.
 *
 * Nothing here logs a key, a token or a prompt. The selected slot, alias and
 * model are returned for the run's event and its usage row.
 */
import type { Env } from '../../types';
import * as aiBudget from '../aiBudget';
import { MeteringRefused, meteredCall } from '../metering';
import {
  GUARD_CHARS_PER_OUTPUT_TOKEN, guardFinalText, guardQuoteMicro, recordUsage, type RefusalReason, type TaskClass, type UsageMeta, type UsageWho,
} from '../aiRouter';
import { GATEWAY_TEXT_MODELS, providerModelById } from '../ai/catalogue';
import { usdRatesBilledMicro } from '../ai/pricing';
// No import from `services/ai/providers/`: the Personal Advisor's import graph reaches this module, and D5339 keeps
// the provider execution service and its adapters out of that graph (`scripts/ci/no-anthropic-in-prod.mjs`). The two
// request shapes and readers below are the providers' public wire formats, small enough to state here.

/** One model request: an optional system prompt, the turns, and the most output tokens the run may use. */
export type ProviderRequest = { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens: number };
/** The Messages API version header the gateway forwards. */
const MESSAGES_VERSION = '2023-06-01';
const count = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

export type SlotNo = 1 | 2 | 3 | 4;
export type Provider = 'anthropic' | 'openai';
export type Slot = { slot: SlotNo; label: string; provider: Provider; alias: string; model: string; apiModel: string; rates: Readonly<Record<string, string>> };

/** The four slots, in order. Each reads an alias variable; the model is shared per provider. */
export const SLOTS: ReadonlyArray<{ slot: SlotNo; label: string; provider: Provider; aliasVar: string }> = Object.freeze([
  { slot: 1, label: 'Primary Claude', provider: 'anthropic', aliasVar: 'AGENT_CLAUDE_ALIAS_1' },
  { slot: 2, label: 'Claude account 2', provider: 'anthropic', aliasVar: 'AGENT_CLAUDE_ALIAS_2' },
  { slot: 3, label: 'Claude account 3', provider: 'anthropic', aliasVar: 'AGENT_CLAUDE_ALIAS_3' },
  { slot: 4, label: 'OpenAI', provider: 'openai', aliasVar: 'AGENT_OPENAI_ALIAS' },
]);
export const CLAUDE_MODEL_VAR = 'AGENT_CLAUDE_MODEL';
export const OPENAI_MODEL_VAR = 'OPENAI_MODEL';
export const GATEWAY_TOKEN_SECRET = 'AGENT_AI_GATEWAY_TOKEN';
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ACCOUNT = /^[0-9a-f]{32}$/;
export const ATTEMPT_TIMEOUT_MS = 60_000;

type Vars = Record<string, unknown>;
const str = (env: Vars, k: string) => String(env[k] ?? '').trim();

/** The model each provider's slots use, priced from the catalogue, or null: an unpriced model is never called. */
export function slotModel(env: Vars, provider: Provider): { model: string; apiModel: string; rates: Readonly<Record<string, string>> } | null {
  if (provider === 'anthropic') {
    const m = providerModelById(str(env, CLAUDE_MODEL_VAR));
    return m && m.provider === 'anthropic' ? { model: m.id, apiModel: m.apiModel, rates: m.rates } : null;
  }
  const want = str(env, OPENAI_MODEL_VAR).replace(/^openai\//, '');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(want)) return null;
  const m = GATEWAY_TEXT_MODELS.find((g) => g.provider === 'openai' && g.id === `openai/${want}`);
  if (m) return { model: m.id, apiModel: want, rates: m.rates };
  // A model the catalogue does not price (the review's `gpt-5.3-codex`) is priced by the owner's
  // AGENT_OPENAI_RATES, USD per 1M tokens: {"tokens_in":"…","tokens_cached":"…","tokens_out":"…"}. No rates, no call.
  const rates = openaiRates(env);
  return rates ? { model: `openai/${want}`, apiModel: want, rates } : null;
}

export const OPENAI_RATES_VAR = 'AGENT_OPENAI_RATES';
const RATE = /^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/;
/** The owner's rates for the OpenAI account's model, or null when unset or not exactly three positive decimal rates. */
export function openaiRates(env: Vars): Readonly<Record<string, string>> | null {
  let raw: unknown;
  try { raw = JSON.parse(str(env, OPENAI_RATES_VAR) || 'null'); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const keys = ['tokens_in', 'tokens_cached', 'tokens_out'];
  if (Object.keys(r).sort().join() !== [...keys].sort().join()) return null;
  if (!keys.every((k) => typeof r[k] === 'string' && RATE.test(r[k] as string) && Number(r[k]) > 0)) return null;
  return Object.freeze({ tokens_in: r.tokens_in as string, tokens_cached: r.tokens_cached as string, tokens_out: r.tokens_out as string });
}

/**
 * The configured slots, in order, and why each other one was skipped. `allowed(model)` is the caller's model
 * permission check (HQ's locks, the scope's allow-list): a refused model skips its slot.
 */
export function accountSlots(env: Vars, allowed: (model: string) => boolean = () => true): { slots: Slot[]; skipped: Array<{ slot: SlotNo; reason: string }> } {
  const slots: Slot[] = [];
  const skipped: Array<{ slot: SlotNo; reason: string }> = [];
  for (const s of SLOTS) {
    const alias = str(env, s.aliasVar);
    if (!alias) { skipped.push({ slot: s.slot, reason: 'not configured' }); continue; }
    if (!ALIAS.test(alias) || alias === 'default') { skipped.push({ slot: s.slot, reason: 'alias refused' }); continue; }
    const m = slotModel(env, s.provider);
    if (!m) { skipped.push({ slot: s.slot, reason: 'no priced model' }); continue; }
    if (!allowed(m.model)) { skipped.push({ slot: s.slot, reason: 'model not allowed' }); continue; }
    slots.push({ slot: s.slot, label: s.label, provider: s.provider, alias, ...m });
  }
  return { slots, skipped };
}

/** The gateway's provider-native endpoint, or null when the gateway or account id cannot be read. */
export function endpoint(env: Vars, provider: Provider): string | null {
  const gatewayId = str(env, 'AGENT_AI_GATEWAY');
  const account = str(env, 'CLOUDFLARE_ACCOUNT_ID');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(gatewayId) || !ACCOUNT.test(account)) return null;
  const base = `https://gateway.ai.cloudflare.com/v1/${account}/${gatewayId}`;
  return provider === 'anthropic' ? `${base}/anthropic/v1/messages` : `${base}/openai/chat/completions`;
}

/** The request for one slot. The provider key is never sent: the gateway supplies the stored key for the alias. */
export function buildRequest(env: Vars, slot: Slot, req: ProviderRequest, meta: Record<string, string>): { url: string; init: RequestInit } | null {
  const url = endpoint(env, slot.provider);
  const token = str(env, GATEWAY_TOKEN_SECRET);
  if (!url || !token) return null;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cf-aig-authorization': `Bearer ${token}`,
    'cf-aig-byok-alias': slot.alias,
    'cf-aig-collect-log-payload': 'false',
    'cf-aig-skip-cache': 'true',
    'cf-aig-metadata': JSON.stringify(meta),
  };
  let body: string;
  if (slot.provider === 'anthropic') {
    headers['anthropic-version'] = MESSAGES_VERSION;
    body = JSON.stringify({
      model: slot.apiModel,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });
  } else {
    body = JSON.stringify({
      model: slot.apiModel,
      messages: [...(req.system ? [{ role: 'system', content: req.system }] : []), ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
      max_completion_tokens: req.maxTokens,
    });
  }
  return { url, init: { method: 'POST', headers, body } };
}

/** Thrown inside the metered call for an attempt that billed nothing, so metering releases its hold. */
class Released extends Error {
  readonly step: { kind: 'failed'; c: Classified; status: number };
  constructor(step: { kind: 'failed'; c: Classified; status: number }) { super('released'); this.step = step; }
}

export type Verdict = 'advance' | 'stop_run' | 'stop_all';
export type Classified = { verdict: Verdict; reason: string; billed: 'no' | 'maybe' };

/** The gateway's own error code, when the body is the gateway's (`{ errors: [{ code }] }` or `{ error: { code: <number> } }`). */
function gatewayCode(body: unknown): number | null {
  const b = body as { errors?: Array<{ code?: unknown }>; error?: { code?: unknown } } | null;
  const first = Array.isArray(b?.errors) ? b!.errors[0] : b?.error;
  return Number.isSafeInteger(first?.code) ? (first!.code as number) : null;
}

/** What a failed answer means for the loop. Pure. */
export function classify(provider: Provider, status: number, body: unknown): Classified {
  const code = gatewayCode(body);
  const err = (body as { error?: { type?: unknown; code?: unknown; message?: unknown; details?: { error_code?: unknown } } } | null)?.error;
  const message = typeof err?.message === 'string' ? err.message : '';
  if (code === 2044) return { verdict: 'advance', reason: 'no key is stored under this alias', billed: 'no' };
  if (code === 2052 || code === 2021) return { verdict: 'stop_all', reason: 'the call reached Unified Billing', billed: 'no' };
  if (status === 429 && code != null && code !== 2003 && code !== 2018) return { verdict: 'stop_all', reason: 'the gateway\'s spend limit', billed: 'no' };
  if (status === 401 || status === 403) return { verdict: 'advance', reason: 'the account\'s key was refused', billed: 'no' };
  if (provider === 'anthropic') {
    if (status === 402) return { verdict: 'advance', reason: 'the account has no credit', billed: 'no' };
    if (status === 400 && /credit balance/i.test(message)) return { verdict: 'advance', reason: 'the account has no credit', billed: 'no' };
    if (status === 429 && err?.details?.error_code === 'enforced_spend_limit_reached') return { verdict: 'advance', reason: 'the account reached its spend limit', billed: 'no' };
  } else if (status === 429 && err?.code === 'insufficient_quota') {
    return { verdict: 'advance', reason: 'the account has no credit', billed: 'no' };
  }
  if (status === 429) return { verdict: 'stop_run', reason: 'rate limited, source not certain', billed: 'no' };
  if (status >= 400 && status < 500) return { verdict: 'stop_run', reason: `refused (${status})`, billed: 'no' };
  return { verdict: 'stop_run', reason: status ? `failed (${status})` : 'no answer', billed: 'maybe' };
}

type Usage = Record<string, number> | null;
/** A 2xx answer's text and usage, through the provider's own reader. */
export function readAnswer(provider: Provider, status: number, body: unknown, header: (n: string) => string | null): { ok: true; output: string; usage: Usage } | { ok: false } {
  void header;
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return { ok: false };
  if (provider === 'anthropic') {
    const b = body as { content?: unknown; usage?: Record<string, unknown> | null };
    if (!Array.isArray(b.content)) return { ok: false };
    const output = b.content
      .filter((x): x is { type: 'text'; text: string } => !!x && x.type === 'text' && typeof x.text === 'string')
      .map((x) => x.text).join('');
    const u = b.usage ?? null;
    const input = count(u?.input_tokens);
    const out = count(u?.output_tokens);
    const write = u?.cache_creation_input_tokens == null ? 0 : count(u.cache_creation_input_tokens);
    const read = u?.cache_read_input_tokens == null ? 0 : count(u.cache_read_input_tokens);
    const usage = input == null || out == null || write == null || read == null ? null : { tokens_in: input, tokens_cache_write: write, tokens_cached: read, tokens_out: out };
    return output.trim() ? { ok: true, output, usage } : { ok: false };
  }
  const b = body as { choices?: unknown; usage?: Record<string, unknown> | null };
  const choice = Array.isArray(b.choices) ? (b.choices[0] as { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown } | undefined) : undefined;
  const message = choice?.message;
  // A model that declined (`refusal`, or a content filter) has not answered.
  if (!message || (typeof message.refusal === 'string' && message.refusal.trim()) || choice?.finish_reason === 'content_filter') return { ok: false };
  const output = typeof message.content === 'string' ? message.content : '';
  const u = b.usage ?? null;
  const prompt = count(u?.prompt_tokens);
  const completion = count(u?.completion_tokens);
  const details = u?.prompt_tokens_details as Record<string, unknown> | null | undefined;
  const cached = details?.cached_tokens == null ? 0 : count(details.cached_tokens);
  const usage = prompt == null || completion == null || cached == null || cached > prompt ? null : { tokens_in: prompt - cached, tokens_cached: cached, tokens_out: completion };
  return output.trim() ? { ok: true, output, usage } : { ok: false };
}

/** The most one attempt on this slot can hold: every input token at the dearest input rate, and every output token. */
export function slotQuote(slot: Slot, req: ProviderRequest, multiplier: number): number {
  const chars = (req.system ?? '').length + req.messages.reduce((n, m) => n + m.content.length, 0);
  const tokensIn = Math.ceil(chars / 3);
  const inputUnits = Object.keys(slot.rates).filter((u) => u !== 'tokens_out');
  return Math.max(...inputUnits.map((u) => usdRatesBilledMicro(slot.rates as never, { [u]: tokensIn, tokens_out: req.maxTokens } as never, multiplier)));
}

export type AccountAttempt = { slot: SlotNo; alias: string; model: string; outcome: 'answered' | Verdict | 'guard'; reason: string; billed: 'yes' | 'no' | 'maybe'; usageLogId: number | null };
export type AccountsResult =
  | { ok: true; output: string; slot: SlotNo; alias: string; model: string; usageLogId: number | null; attempts: AccountAttempt[] }
  | { ok: false; code: 'accounts_unconfigured' | 'accounts_exhausted' | 'account_failed' | 'gateway_limit' | 'guard_blocked' | 'guard_unavailable' | 'step_lost' | 'insufficient_tokens'; message: string; attempts: AccountAttempt[] };

export type AccountsInput = {
  who: UsageWho & { userId: number; agentId?: number | null };
  task: TaskClass;
  executionId: string;
  request: ProviderRequest;
  guardText: string;
  allowed?: (model: string) => boolean;
};
export type AccountsDeps = { fetch?: typeof fetch; timeoutMs?: number; guard?: typeof guardFinalText; record?: typeof recordUsage };

/**
 * The loop. Returns the first valid answer, or why there is none. Never throws for a provider's answer; a hold the
 * sponsor's budget refuses ends the run with `insufficient_tokens`.
 */
export async function runAccounts(env: Env, input: AccountsInput, deps: AccountsDeps = {}): Promise<AccountsResult> {
  const doFetch = deps.fetch ?? fetch;
  const guard = deps.guard ?? guardFinalText;
  const record = deps.record ?? recordUsage;
  const vars = env as unknown as Vars;
  const { slots } = accountSlots(vars, input.allowed);
  const attempts: AccountAttempt[] = [];
  if (!slots.length || !str(vars, GATEWAY_TOKEN_SECRET) || !endpoint(vars, slots[0].provider)) {
    return { ok: false, code: 'accounts_unconfigured', message: 'No model account is set up for agents yet, so the agent was not run. Nothing was charged.', attempts };
  }
  const multiplier = await aiBudget.memberChargeMultiplier(env, input.who.userId);
  const meta = { surface: 'agents', run: input.executionId.slice(0, 64), agent: String(input.who.agentId ?? '') };
  let inputGuarded = false;

  for (const slot of slots) {
    const usage = (latency: number, tIn: number, tOut: number, usd: number): UsageMeta => ({
      task: input.task, model: slot.model, latency_ms: latency, prompt_tokens: tIn, completion_tokens: tOut,
      est_cost_usd: usd, fallback_used: slot.slot > 1, cached: false, safety_score: null,
    });
    const units = (extra: Record<string, string | number | boolean>) => ({ provider: slot.provider, via: 'ai_gateway', billing: 'byok', slot: slot.slot, alias: slot.alias, ...extra });
    const providerQuote = slotQuote(slot, input.request, multiplier);
    const guardQuote = guardQuoteMicro(inputGuarded ? '' : input.guardText, input.request.maxTokens * GUARD_CHARS_PER_OUTPUT_TOKEN, multiplier);
    const guards: Array<Awaited<ReturnType<typeof guardFinalText>>> = [];
    const guardMicro = () => guards.reduce((n, g) => n + g.micro, 0);
    type Step = { kind: 'answered'; output: string; usage: Usage; micro: number } | { kind: 'failed'; c: Classified; status: number } | { kind: 'guard'; side: 'input' | 'output'; action: string };
    let done: { value: Step; usage: { charged_microusd: number | null; reservation_uid: string | null } };
    const started = Date.now();
    try {
      done = await meteredCall(env, {
        userId: input.who.userId, executionId: input.executionId, component: `agent.account.${slot.slot}`,
        operation: input.who.surface ?? input.task, quoteMicrousd: providerQuote + guardQuote, timeoutMs: (deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS) + 30_000,
      }, async (meter): Promise<Step> => {
        if (!inputGuarded) {
          const g = await guard(env, { userId: input.who.userId, surface: input.who.surface ?? null }, input.guardText, multiplier, 'input');
          guards.push(g);
          if (g.decision.action === 'block' || g.decision.action === 'fail') { meter.reportCost(guardMicro()); return { kind: 'guard', side: 'input', action: g.decision.action }; }
          inputGuarded = true;
        }
        const req = buildRequest(vars, slot, input.request, meta)!;
        let status = 0;
        let body: unknown = null;
        let header: (n: string) => string | null = () => null;
        try {
          const res = await doFetch(req.url, { ...req.init, signal: AbortSignal.timeout(deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS) });
          status = res.status;
          body = await res.json().catch(() => null);
          header = (n) => res.headers.get(n);
        } catch { status = 0; }
        if (status >= 200 && status < 300) {
          const a = readAnswer(slot.provider, status, body, header);
          if (!a.ok) { meter.reportCost(providerQuote + guardMicro()); return { kind: 'failed', c: { verdict: 'stop_run', reason: 'the answer could not be read', billed: 'maybe' }, status }; }
          const micro = a.usage ? usdRatesBilledMicro(slot.rates as never, a.usage as never, multiplier) : providerQuote;
          const g = await guard(env, { userId: input.who.userId, surface: input.who.surface ?? null }, a.output, multiplier, 'output');
          guards.push(g);
          meter.reportCost(micro + guardMicro());
          if (g.decision.action === 'block' || g.decision.action === 'fail') return { kind: 'guard', side: 'output', action: g.decision.action };
          return { kind: 'answered', output: a.output, usage: a.usage, micro };
        }
        const c = classify(slot.provider, status, body);
        // An attempt that may have been billed is counted at its quote; one that billed nothing, at its guard calls
        // only. Nothing to count at all: the hold is released (refunded), as metering releases any run that ends early.
        const cost = (c.billed === 'maybe' ? providerQuote : 0) + guardMicro();
        if (cost === 0) throw new Released({ kind: 'failed', c, status });
        meter.reportCost(cost);
        return { kind: 'failed', c, status };
      });
    } catch (e) {
      if (e instanceof Released) {
        const m = (e as { meteringUsage?: { charged_microusd: number | null; reservation_uid: string | null } }).meteringUsage;
        done = { value: e.step, usage: { charged_microusd: m ? m.charged_microusd : 0, reservation_uid: m?.reservation_uid ?? null } };
      } else if (e instanceof MeteringRefused) {
        if (e.code === 'execution_closed') return { ok: false, code: 'step_lost', message: 'This step ran before; what it wrote was not saved. Nothing more was charged.', attempts };
        await record(env, input.who, usage(0, 0, 0, 0), 'insufficient_tokens' as RefusalReason, { charged: 0, units: units({ error: 'hold_refused' }) });
        return { ok: false, code: 'insufficient_tokens', message: 'The sponsor\'s AI budget cannot cover this run, so the agent was not run.', attempts };
      } else {
        throw e;
      }
    }
    const v = done.value;
    const latency = Date.now() - started;
    const charge = (extra: Record<string, string | number | boolean>) => ({ charged: done.usage.charged_microusd, reservationUid: done.usage.reservation_uid, units: units(extra) });
    const row = async (refusal: string | null, u: UsageMeta, extra: Record<string, string | number | boolean>) => {
      const id = await record(env, input.who, u, refusal as RefusalReason | null, charge(extra));
      for (const g of guards) await g.record(id, done.usage.reservation_uid);
      return id;
    };
    if (v.kind === 'guard') {
      const refusal = v.action === 'block' ? (v.side === 'input' ? 'guard_blocked' : 'guard_blocked_output') : 'guard_unavailable';
      const id = await row(refusal, usage(latency, 0, 0, 0), { guard: v.side });
      attempts.push({ slot: slot.slot, alias: slot.alias, model: slot.model, outcome: 'guard', reason: refusal, billed: (done.usage.charged_microusd ?? 1) > 0 ? 'yes' : 'no', usageLogId: id });
      return { ok: false, code: v.action === 'block' ? 'guard_blocked' : 'guard_unavailable', message: 'The safety check stopped this run.', attempts };
    }
    if (v.kind === 'answered') {
      const tIn = v.usage ? (v.usage.tokens_in ?? 0) + (v.usage.tokens_cache_write ?? 0) + (v.usage.tokens_cached ?? 0) : 0;
      const id = await row(null, usage(latency, tIn, v.usage?.tokens_out ?? 0, v.micro / multiplier / 1_000_000), v.usage ? { usage_reported: true } : { usage_reported: false });
      attempts.push({ slot: slot.slot, alias: slot.alias, model: slot.model, outcome: 'answered', reason: 'answered', billed: 'yes', usageLogId: id });
      return { ok: true, output: v.output, slot: slot.slot, alias: slot.alias, model: slot.model, usageLogId: id, attempts };
    }
    const id = await row('all_models_failed', usage(latency, 0, 0, 0), { status: v.status, verdict: v.c.verdict, billed: v.c.billed });
    attempts.push({ slot: slot.slot, alias: slot.alias, model: slot.model, outcome: v.c.verdict, reason: v.c.reason, billed: v.c.billed, usageLogId: id });
    if (v.c.verdict === 'stop_all') return { ok: false, code: 'gateway_limit', message: 'Agents reached the platform\'s limit, so they are paused for now. You can still work on this yourself.', attempts };
    if (v.c.verdict === 'stop_run') return { ok: false, code: 'account_failed', message: 'The model did not answer, so the agent did not finish. The task is open again.', attempts };
  }
  return { ok: false, code: 'accounts_exhausted', message: 'Every model account refused this run for credit, so the agent did not finish. Add credit to one of them.', attempts };
}
