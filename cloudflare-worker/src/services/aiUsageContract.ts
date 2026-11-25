/**
 * D8522 (#8522) — the fields every `ai_usage_logs` row carries, and the one place that fills them.
 *
 * Before this, `recordUsage` took whatever its callers handed it, so a row could name no provider,
 * no request or no payer, and the admin usage view (`aiUsageAdmin`) and the anomaly check
 * (`tokenAnomalies`) undercounted it without saying so. Now:
 *   · `usageContract()` builds the contract from what a caller supplied, and a field it was not
 *     given reads `NOT_REPORTED`, never absent;
 *   · `contractProblems()` is the runtime check: it names each field a row lacks;
 *   · `recordUsage` is the only function that inserts into the table
 *     (`ai_usage_contract_d8522.test.ts` fails on any other INSERT).
 *
 * Pure: no imports, so it loads anywhere the router does.
 */

/** What a row says when its writer could not supply a field. */
export const NOT_REPORTED = 'not reported';

export interface UsageContract {
  /** The page the call came from (`/path`), or NOT_REPORTED. The legacy `surface` column stores NULL for the same meaning. */
  surface: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  /** false: the token counts above read 0 (or an estimate) because the provider reported none. */
  tokens_reported: boolean;
  /** Who pays: the member, the agent, or NOT_REPORTED (a system run). */
  payer: { user_id: number | null; agent_id: number | null; label: string };
  request_id: string;
}

export interface ContractInput {
  surface: string | null;
  model: string;
  provider?: unknown;
  prompt_tokens: number;
  completion_tokens: number;
  tokens_reported?: boolean;
  user_id?: unknown;
  agent_id?: number | null;
  request_id?: unknown;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 160) : null);
const whole = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const id = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : null);

/**
 * The provider a model name implies when the caller named none: `@cf/...` and `@hf/...` run on
 * Workers AI, `vendor/model` ids run on that vendor, anything else is not reported.
 */
export function providerOfModel(model: string): string {
  if (/^@(cf|hf)\//.test(model)) return 'workers-ai';
  const m = /^([a-z0-9_-]+)\/[^/]+/i.exec(model);
  return m ? m[1].toLowerCase() : NOT_REPORTED;
}

export function usageContract(i: ContractInput): UsageContract {
  const userId = id(i.user_id);
  const agentId = id(i.agent_id);
  const model = text(i.model) ?? NOT_REPORTED;
  return {
    surface: text(i.surface) ?? NOT_REPORTED,
    provider: text(i.provider) ?? providerOfModel(model),
    model,
    prompt_tokens: whole(i.prompt_tokens),
    completion_tokens: whole(i.completion_tokens),
    tokens_reported: i.tokens_reported === true,
    payer: { user_id: userId, agent_id: agentId, label: agentId ? `agent:${agentId}` : userId ? `user:${userId}` : NOT_REPORTED },
    request_id: text(i.request_id) ?? NOT_REPORTED,
  };
}

/** The fields a row lacks; empty means it satisfies the contract. A field that reads NOT_REPORTED is present. */
export function contractProblems(c: Partial<UsageContract> | null | undefined): string[] {
  const out: string[] = [];
  if (!c || typeof c !== 'object') return ['row'];
  for (const k of ['surface', 'provider', 'model', 'request_id'] as const) {
    if (typeof c[k] !== 'string' || !(c[k] as string).trim()) out.push(k);
  }
  for (const k of ['prompt_tokens', 'completion_tokens'] as const) {
    if (!Number.isSafeInteger(c[k]) || (c[k] as number) < 0) out.push(k);
  }
  if (typeof c.tokens_reported !== 'boolean') out.push('tokens_reported');
  if (!c.payer || typeof c.payer.label !== 'string' || !c.payer.label) out.push('payer');
  return out;
}
