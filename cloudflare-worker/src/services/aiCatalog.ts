/**
 * D641 (#1434) — the words the Usage page puts beside the router's identifiers.
 *
 * `services/aiRouter.ts` names its work in identifiers: a task class such as
 * `workspace_explain`, a model such as `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
 * A member reading their own spend needs a sentence for each. This file holds
 * those words and nothing else: the prices stay in the router's two tables
 * (`PRICE_USD_PER_1M_TOKENS`, `PRICE_USD_PER_AUDIO_MINUTE`), which
 * `GET /api/ai/rates` reads rather than copies.
 *
 * Tests pin both maps against the router: every `TaskClass` has a label, and
 * every priced model has a name.
 */
import type { TaskClass } from './aiRouter';

/**
 * One plain label per task class, as a member would describe the job.
 * `Record<TaskClass, string>` makes a new task class without a label a type
 * error; the test reads `ROUTE`'s keys as the runtime list.
 */
export const TASK_LABELS: Record<TaskClass, string> = {
  safety: 'Safety check',
  role_detect: 'Work out your role',
  advisor_turn: 'Talk with Eadwyn',
  onboarding_chat: 'Onboarding chat',
  tool_call: 'Run a tool',
  rerank: 'Choose the next question',
  explain: 'Explain a topic',
  advisor_explain: 'Eadwyn explains',
  sentiment: 'Read the tone of text',
  embed: 'Index text for search',
  paraphrase: 'Reword market notes',
  publication: 'Summarise a publication',
  dd_synthesis: 'Read a pitch deck',
  brand_autofill: 'Fill in your brand page',
  brand_palette: 'Suggest brand colours',
  brand_taglines: 'Suggest taglines',
  workspace_explain: 'Explain this page',
  transcribe: 'Transcribe audio',
  validate_tag_pains: 'Tag interview pains',
  validate_draft_hypotheses: 'Draft hypotheses',
  market_sizing_inputs: 'Propose market sizing inputs',
  competitor_scan: 'Find competitors',
  research_ask: 'Answer from your documents',
  structure_interview: 'Structure an interview',
};

/**
 * The label for a task as a log row recorded it. `null` for a task the router
 * no longer has (a row written under a class since renamed or removed): the
 * page shows the identifier, never a label guessed for it.
 */
export function taskLabel(task: string | null | undefined): string | null {
  if (typeof task !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(TASK_LABELS, task)
    ? TASK_LABELS[task as TaskClass]
    : null;
}

/** A readable name for every model either price table holds. */
export const MODEL_NAMES: Record<string, string> = {
  '@cf/meta/llama-guard-3-8b': 'Llama Guard 3 8B',
  '@cf/meta/llama-3.1-8b-instruct': 'Llama 3.1 8B Instruct',
  '@cf/meta/llama-3.1-8b-instruct-fp8': 'Llama 3.1 8B Instruct (FP8)',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': 'Llama 3.1 8B Instruct (FP8, fast)',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 'Llama 3.3 70B Instruct (FP8, fast)',
  '@cf/meta/llama-3.2-3b-instruct': 'Llama 3.2 3B Instruct',
  '@cf/qwen/qwen2.5-coder-32b-instruct': 'Qwen 2.5 Coder 32B Instruct',
  '@cf/baai/bge-base-en-v1.5': 'BGE Base EN v1.5 (embeddings)',
  '@cf/openai/whisper': 'Whisper',
  '@cf/openai/whisper-large-v3-turbo': 'Whisper Large v3 Turbo',
};

/**
 * Models priced only so past runs keep their cost. The router no longer sends
 * work to them; a test holds that none appears in `ROUTE`.
 *
 * `@cf/meta/llama-3.1-8b-instruct` carries Cloudflare's deprecation date of
 * 2026-05-30 (see `SMALL_LLAMA` in `aiRouter.ts`).
 */
export const RETIRED_MODELS: ReadonlySet<string> = new Set([
  '@cf/meta/llama-3.1-8b-instruct',
]);
