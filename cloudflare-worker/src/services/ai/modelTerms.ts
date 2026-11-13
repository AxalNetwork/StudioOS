/**
 * D1504 (#3755, deck v2 A11) — each model's terms, and which models may run
 * before their terms are reviewed.
 *
 * A model a run can reach needs a terms record: where its terms are, its
 * licence, whether its output may be used commercially, whether it must be
 * attributed, what flows down to the founder, and who reviewed it and when.
 * Owner question X (S1's pick A) is per-provider acceptance after a counsel
 * summary, so no model is "reviewed" yet: every field the review fills is null
 * ("Not recorded") until it is.
 *
 * GRANDFATHERED. The 61 models main could run when this was written
 * (every `ga` or `partner` catalogue row with a price, the partner gate open,
 * catalogue read on 2026-10-31) keep running: `grandfathered: true`.
 * The list is frozen here on purpose: a model added to the catalogue later is
 * NOT grandfathered, so `refusalFor` answers `model_terms_unreviewed` for it
 * until its terms are reviewed (`reviewed_on` and `reviewed_by` set below).
 *
 * `documentation/architecture/MODEL_TERMS.md` is the register a person reads;
 * `ai_model_terms_d1504.test.ts` holds the two equal.
 */
import { CATALOGUE_READ, modelById } from './catalogue';

export interface ModelTerms {
  /** The provider's terms page, or the model's own page until counsel names one; null when neither is known. */
  url: string | null;
  licence: string | null;
  /** Whether output may be used commercially, as the review found; null until reviewed. */
  commercial_output: boolean | null;
  /** What attribution the terms ask for, in a sentence; null until reviewed. */
  attribution: string | null;
  /** What the terms pass on to the founder using the output; null until reviewed. */
  flow_down: string | null;
  reviewed_on: string | null;
  reviewed_by: string | null;
  grandfathered: boolean;
}

/** The models main ran before this register existed. Frozen: never generated from the catalogue. */
export const GRANDFATHERED: readonly string[] = Object.freeze([
  '@cf/deepgram/aura-1',
  '@cf/deepgram/aura-2-en',
  '@cf/deepgram/aura-2-es',
  '@cf/baai/bge-base-en-v1.5',
  '@cf/baai/bge-large-en-v1.5',
  '@cf/baai/bge-m3',
  '@cf/baai/bge-reranker-base',
  '@cf/baai/bge-small-en-v1.5',
  '@cf/cloudflare/clef',
  '@cf/cloudflare/clef-flash',
  '@cf/cloudflare/clef-omni',
  '@cf/daily-co/phonellm-mini-alpha-2',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  '@cf/deepseek-ai/deepseek-v4-flash-0731',
  '@cf/deepseek-ai/deepseek-v4-pro-0813',
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  '@cf/huggingface/distilbert-sst-2-int8',
  '@cf/deepgram/flux',
  '@cf/black-forest-labs/flux-1-schnell',
  '@cf/black-forest-labs/flux-2-dev',
  '@cf/black-forest-labs/flux-2-klein-4b',
  '@cf/black-forest-labs/flux-2-klein-9b',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/aisingapore/gemma-sea-lion-v4-27b-it',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/zai-org/glm-5.2',
  '@cf/zai-org/glm-5.3',
  '@cf/zai-org/glm-5.3-flash',
  '@cf/openai/gpt-oss-120b',
  '@cf/openai/gpt-oss-20b',
  '@cf/ibm-granite/granite-4.0-h-micro',
  '@cf/ai4bharat/indictrans2-en-indic-1B',
  '@cf/moonshotai/kimi-k2.6',
  '@cf/moonshotai/kimi-k2.7-code',
  '@cf/meta/llama-3.1-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/meta/llama-3.2-11b-vision-instruct',
  '@cf/meta/llama-3.2-1b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-guard-3-8b',
  '@cf/leonardo/lucid-origin',
  '@cf/meta/m2m100-1.2b',
  '@cf/myshell-ai/melotts',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/moondream/moondream3.1-9B-A2B',
  '@cf/nvidia/nemotron-3-120b-a12b',
  '@cf/deepgram/nova-3',
  '@cf/leonardo/phoenix-1.0',
  '@cf/pfnet/plamo-embedding-1b',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/qwen/qwen3-embedding-0.6b',
  '@cf/qwen/qwen3.8-27b',
  '@cf/qwen/qwq-32b',
  '@cf/microsoft/resnet-50',
  '@cf/pipecat-ai/smart-turn-v2',
  '@cf/openai/whisper',
  '@cf/openai/whisper-large-v3-turbo',
]);

/** Reviews recorded so far, by model id. Empty until owner question X is answered. */
export const REVIEWED: Readonly<Record<string, Omit<ModelTerms, 'grandfathered' | 'url'> & { url?: string | null }>> = Object.freeze({});

/** A model's terms record. A model the register does not know is not grandfathered and not reviewed. */
export function termsOf(id: string): ModelTerms {
  const r = REVIEWED[id];
  return {
    url: r?.url ?? modelById(id)?.docs_url ?? null,
    licence: r?.licence ?? null,
    commercial_output: r?.commercial_output ?? null,
    attribution: r?.attribution ?? null,
    flow_down: r?.flow_down ?? null,
    reviewed_on: r?.reviewed_on ?? null,
    reviewed_by: r?.reviewed_by ?? null,
    grandfathered: GRANDFATHERED.includes(id),
  };
}

/** Whether a run may use the model as far as its terms go: grandfathered, or reviewed by a named person on a date. */
export const termsCleared = (id: string): boolean => {
  const t = termsOf(id);
  return t.grandfathered || (!!t.reviewed_on && !!t.reviewed_by);
};

export const TERMS_READ = CATALOGUE_READ;
