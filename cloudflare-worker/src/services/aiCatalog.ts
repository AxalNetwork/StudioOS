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
  grow_theme_feedback: 'Theme product feedback',
  market_sizing_inputs: 'Propose market sizing inputs',
  competitor_scan: 'Find competitors',
  research_ask: 'Answer from your documents',
  structure_interview: 'Structure an interview',
  summarise_interview: 'Summarise an interview',
  ops_summary: 'Summarise the site metrics',
  image_screen: 'Screen an image',
  image_alt_text: 'Describe an image',
  // D764 (#2089) — the rail's kinds of work, in the canvas's words.
  rail_chat: 'Chat on a page',
  rail_synth: 'Group notes into themes',
  rail_speech: 'Transcribe a recording',
  rail_research: 'Research with cited sources',
  rail_reason: 'Test a claim against evidence',
  rail_vision: 'Read slides, charts and scans',
  rail_code: 'Read and write code',
  rail_numbers: 'Work through figures',
  rail_write: 'Draft text',
  rail_match: 'Find people and firms that fit',
  rail_plan: 'Plan next steps',
  rail_legal: 'Read terms and filings',
  rail_multi: 'Read sources in any language',
  rail_search: 'Answer from your documents',
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

/** A readable name for every model the router's price tables hold (token, audio, WebSocket). */
export const MODEL_NAMES: Record<string, string> = {
  '@cf/meta/llama-guard-3-8b': 'Llama Guard 3 8B',
  '@cf/meta/llama-3.1-8b-instruct': 'Llama 3.1 8B Instruct',
  '@cf/meta/llama-3.1-8b-instruct-fp8': 'Llama 3.1 8B Instruct (FP8)',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': 'Llama 3.1 8B Instruct (FP8, fast)',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 'Llama 3.3 70B Instruct (FP8, fast)',
  '@cf/meta/llama-3.2-3b-instruct': 'Llama 3.2 3B Instruct',
  '@cf/deepseek-ai/deepseek-v4-flash-0731': 'DeepSeek V4 Flash',
  '@cf/qwen/qwen2.5-coder-32b-instruct': 'Qwen 2.5 Coder 32B Instruct',
  '@cf/baai/bge-base-en-v1.5': 'BGE Base EN v1.5 (embeddings)',
  '@cf/openai/whisper': 'Whisper',
  '@cf/openai/whisper-large-v3-turbo': 'Whisper Large v3 Turbo',
  '@cf/deepgram/nova-3': 'Nova-3',
  // D760: on the rate card now that it carries WebSocket rates (live speech, D658).
  '@cf/deepgram/flux': 'Flux',
  // D764 (#2089): the rail's models, by the canvas's names.
  '@cf/zai-org/glm-4.7-flash': 'GLM-4.7 Flash',
  '@cf/openai/gpt-oss-120b': 'GPT-OSS 120B',
  '@cf/openai/gpt-oss-20b': 'GPT-OSS 20B',
  '@cf/moonshotai/kimi-k2.6': 'Kimi K2.6',
  '@cf/moonshotai/kimi-k2.7-code': 'Kimi K2.7 Code',
  '@cf/deepseek-ai/deepseek-v4-pro-0813': 'DeepSeek V4 Pro',
  '@cf/qwen/qwq-32b': 'QwQ 32B',
  '@cf/google/gemma-4-26b-a4b-it': 'Gemma 4 26B',
  '@cf/meta/llama-4-scout-17b-16e-instruct': 'Llama 4 Scout',
  '@cf/mistralai/mistral-small-3.1-24b-instruct': 'Mistral Small 3.1 24B',
  '@cf/ibm-granite/granite-4.0-h-micro': 'Granite 4.0 Micro',
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
