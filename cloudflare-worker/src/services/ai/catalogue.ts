/**
 * D760 (#2017) — every Workers AI model, in one catalogue, priced in each unit
 * Cloudflare bills.
 *
 * WHERE THE ROWS COME FROM. Cloudflare's models page and pricing page, read on
 * 2026-10-19 through the Cloudflare docs connector (the pricing page says it was
 * updated on 2026-10-15). What was read is committed as
 * `test/fixtures/workers_ai_catalogue.json`, each row with its source URLs, and
 * `test/ai_catalogue_d760.test.mjs` holds every row here equal to it. A price
 * that moves is changed in both files in the same commit.
 *
 * NEURONS ARE WHAT IS BILLED (S1 on #2017, 2026-10-19). Cloudflare bills in
 * neurons, at $0.011 per 1,000, and the pricing table's dollar column is that
 * figure rounded for display: the 70B's 26668 neurons per 1M input tokens are
 * $0.293348, printed $0.293. So each row carries both, as strings exactly as
 * printed, per `UNIT_SCALE[unit]` units:
 *   - `neurons`, which `pricing.ts` prices from (neurons × 0.011 / 1000);
 *   - `prices`, the dollar column, kept for what Cloudflare displays.
 * Nothing here multiplies or rounds them. Where a model page shows a dollar
 * figure that differs from the table (Llama 3.2 11B Vision: 0.0485 against
 * 0.049), the fixture records both; neither is billed.
 *
 * OFFERED means status `ga` or `partner`, with a price. Every other row stays
 * in the file, so a run already recorded against a retired model keeps its
 * cost. The partner models new to the platform are offered only while the
 * owner sets `AI_PARTNER_MODELS = 'on'`; Nova-3 and Flux already run (D657,
 * D658) and are never gated.
 */

/** A model's standing on Cloudflare's pages. */
export type ModelStatus = 'ga' | 'partner' | 'beta' | 'deprecated' | 'not_found';

/** The units Cloudflare bills, named as the Worker measures them. */
export type PriceUnit =
  | 'tokens_in' | 'tokens_cached' | 'tokens_out'
  | 'audio_minutes' | 'audio_minutes_websocket'
  | 'characters' | 'images'
  | 'tiles' | 'steps' | 'input_tile_steps' | 'output_tile_steps' | 'input_tiles' | 'output_tiles'
  | 'first_megapixels' | 'subsequent_megapixels' | 'input_image_megapixels';

/** How many units each printed price covers: per 1M tokens, per 1k characters, per 1M images, else per one. */
export const UNIT_SCALE: Readonly<Record<PriceUnit, number>> = Object.freeze({
  tokens_in: 1_000_000,
  tokens_cached: 1_000_000,
  tokens_out: 1_000_000,
  audio_minutes: 1,
  audio_minutes_websocket: 1,
  characters: 1_000,
  images: 1_000_000,
  tiles: 1,
  steps: 1,
  input_tile_steps: 1,
  output_tile_steps: 1,
  input_tiles: 1,
  output_tiles: 1,
  first_megapixels: 1,
  subsequent_megapixels: 1,
  input_image_megapixels: 1,
});

export interface CatalogueModel {
  id: string;
  /** The name the models page prints. */
  name: string;
  /** Cloudflare's task name, as the models page prints it. */
  kind: string;
  /** The page's capability badges (Batch, Function calling, LoRA, Real-time, Reasoning, Vision). */
  capabilities: readonly string[];
  /** Tokens, as a model page or a dated changelog states it; null when neither does. */
  context_window: number | null;
  status: ModelStatus;
  /** Served on a paid plan only (the pricing page's note). */
  paid_only: boolean;
  /** Carries the Partner badge. */
  partner: boolean;
  /** USD per `UNIT_SCALE[unit]`, the pricing table's dollar column exactly as printed (display only). */
  prices: Readonly<Partial<Record<PriceUnit, string>>>;
  /** Neurons per `UNIT_SCALE[unit]`, exactly as printed: what Cloudflare bills. Absent where unpriced. */
  neurons?: Readonly<Partial<Record<PriceUnit, string>>>;
  /** The model's own page, or null when the connector returned none. */
  docs_url: string | null;
}

/** When the catalogue was read, and the date the pricing page gave. */
export const CATALOGUE_READ = Object.freeze({ read_on: '2026-10-19', pricing_page_updated: '2026-10-15' });

export const CATALOGUE: readonly CatalogueModel[] = Object.freeze([
  { id: '@cf/deepgram/aura-1', name: 'aura-1', kind: 'Text-to-Speech', capabilities: ['Batch', 'Real-time'], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { characters: '0.015' }, neurons: { characters: '1363.64' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/aura-1/' },
  { id: '@cf/deepgram/aura-2-en', name: 'aura-2-en', kind: 'Text-to-Speech', capabilities: ['Batch', 'Real-time'], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { characters: '0.030' }, neurons: { characters: '2727.27' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/aura-2-en/' },
  { id: '@cf/deepgram/aura-2-es', name: 'aura-2-es', kind: 'Text-to-Speech', capabilities: ['Batch', 'Real-time'], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { characters: '0.030' }, neurons: { characters: '2727.27' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/aura-2-es/' },
  { id: '@cf/facebook/bart-large-cnn', name: 'bart-large-cnn', kind: 'Summarization', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/bart-large-cnn/' },
  { id: '@cf/baai/bge-base-en-v1.5', name: 'bge-base-en-v1.5', kind: 'Text Embeddings', capabilities: ['Batch'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.067' }, neurons: { tokens_in: '6058' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/' },
  { id: '@cf/baai/bge-large-en-v1.5', name: 'bge-large-en-v1.5', kind: 'Text Embeddings', capabilities: ['Batch'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.204' }, neurons: { tokens_in: '18582' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/bge-large-en-v1.5/' },
  { id: '@cf/baai/bge-m3', name: 'bge-m3', kind: 'Text Embeddings', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.012' }, neurons: { tokens_in: '1075' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/bge-m3/' },
  { id: '@cf/baai/bge-reranker-base', name: 'bge-reranker-base', kind: 'Text Classification', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.003' }, neurons: { tokens_in: '283' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/' },
  { id: '@cf/baai/bge-small-en-v1.5', name: 'bge-small-en-v1.5', kind: 'Text Embeddings', capabilities: ['Batch'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.020' }, neurons: { tokens_in: '1841' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/bge-small-en-v1.5/' },
  { id: '@cf/cloudflare/clef', name: 'clef', kind: 'Text Generation', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.240' }, neurons: { tokens_in: '21818' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/clef/' },
  { id: '@cf/cloudflare/clef-flash', name: 'clef-flash', kind: 'Text Generation', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.038' }, neurons: { tokens_in: '3455' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/clef-flash/' },
  { id: '@cf/cloudflare/clef-omni', name: 'clef-omni', kind: 'Text Generation', capabilities: ['Vision'], context_window: 64000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.150' }, neurons: { tokens_in: '13636' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/clef-omni/' },
  { id: '@cf/daily-co/phonellm-mini-alpha-2', name: 'phonellm-mini-alpha-2', kind: 'Text Generation', capabilities: ['Function calling'], context_window: 262140, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.060', tokens_out: '0.240' }, neurons: { tokens_in: '5455', tokens_out: '21818' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/phonellm-mini-alpha-2/' },
  { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'deepseek-r1-distill-qwen-32b', kind: 'Text Generation', capabilities: ['Reasoning'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.497', tokens_out: '4.881' }, neurons: { tokens_in: '45170', tokens_out: '443756' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/deepseek-r1-distill-qwen-32b/' },
  { id: '@cf/deepseek-ai/deepseek-v4-flash-0731', name: 'deepseek-v4-flash-0731', kind: 'Text Generation', capabilities: ['Batch', 'Function calling', 'Reasoning'], context_window: 1048576, status: 'ga', paid_only: true, partner: false, prices: { tokens_in: '0.440', tokens_cached: '0.014', tokens_out: '1.320' }, neurons: { tokens_in: '40000', tokens_cached: '1273', tokens_out: '120000' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/deepseek-v4-flash-0731/' },
  { id: '@cf/deepseek-ai/deepseek-v4-pro-0813', name: 'deepseek-v4-pro-0813', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning'], context_window: 1048576, status: 'ga', paid_only: true, partner: false, prices: { tokens_in: '1.320', tokens_cached: '0.044', tokens_out: '3.960' }, neurons: { tokens_in: '120000', tokens_cached: '4000', tokens_out: '360000' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/deepseek-v4-pro-0813/' },
  { id: '@cf/facebook/detr-resnet-50', name: 'detr-resnet-50', kind: 'Object Detection', capabilities: [], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/detr-resnet-50/' },
  { id: '@cf/huggingface/distilbert-sst-2-int8', name: 'distilbert-sst-2-int8', kind: 'Text Classification', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.026' }, neurons: { tokens_in: '2394' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/distilbert-sst-2-int8/' },
  { id: '@cf/lykon/dreamshaper-8-lcm', name: 'dreamshaper-8-lcm', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/dreamshaper-8-lcm/' },
  { id: '@cf/google/embeddinggemma-300m', name: 'embeddinggemma-300m', kind: 'Text Embeddings', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/embeddinggemma-300m/' },
  { id: '@cf/deepgram/flux', name: 'flux', kind: 'Automatic Speech Recognition', capabilities: ['Real-time'], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { audio_minutes_websocket: '0.0077' }, neurons: { audio_minutes_websocket: '700.00' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/flux/' },
  { id: '@cf/black-forest-labs/flux-1-schnell', name: 'flux-1-schnell', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tiles: '0.0000528', steps: '0.0001056' }, neurons: { tiles: '4.80', steps: '9.60' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/' },
  { id: '@cf/black-forest-labs/flux-2-dev', name: 'flux-2-dev', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { input_tile_steps: '0.00021', output_tile_steps: '0.00041' }, neurons: { input_tile_steps: '18.75', output_tile_steps: '37.50' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/flux-2-dev/' },
  { id: '@cf/black-forest-labs/flux-2-klein-4b', name: 'flux-2-klein-4b', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { input_tiles: '0.000059', output_tiles: '0.000287' }, neurons: { input_tiles: '5.37', output_tiles: '26.05' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/' },
  { id: '@cf/black-forest-labs/flux-2-klein-9b', name: 'flux-2-klein-9b', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { first_megapixels: '0.015', subsequent_megapixels: '0.002', input_image_megapixels: '0.002' }, neurons: { first_megapixels: '1363.64', subsequent_megapixels: '181.82', input_image_megapixels: '181.82' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/flux-2-klein-9b/' },
  { id: '@cf/google/gemma-2b-it-lora', name: 'gemma-2b-it-lora', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/gemma-2b-it-lora/' },
  { id: '@cf/google/gemma-3-12b-it', name: 'gemma-3-12b-it', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: { tokens_in: '0.345', tokens_out: '0.556' }, neurons: { tokens_in: '31371', tokens_out: '50560' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/gemma-3-12b-it/' },
  { id: '@cf/google/gemma-4-26b-a4b-it', name: 'gemma-4-26b-a4b-it', kind: 'Text Generation', capabilities: ['Batch', 'Function calling', 'Reasoning', 'Vision'], context_window: 256000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.100', tokens_out: '0.300' }, neurons: { tokens_in: '9091', tokens_out: '27273' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/' },
  { id: '@hf/google/gemma-7b-it', name: 'gemma-7b-it', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/gemma-7b-it/' },
  { id: '@cf/google/gemma-7b-it-lora', name: 'gemma-7b-it-lora', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/gemma-7b-it-lora/' },
  { id: '@cf/aisingapore/gemma-sea-lion-v4-27b-it', name: 'gemma-sea-lion-v4-27b-it', kind: 'Text Generation', capabilities: [], context_window: 128000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.351', tokens_out: '0.555' }, neurons: { tokens_in: '31876', tokens_out: '50488' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/gemma-sea-lion-v4-27b-it/' },
  { id: '@cf/zai-org/glm-4.7-flash', name: 'glm-4.7-flash', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning'], context_window: 131072, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.060', tokens_out: '0.400' }, neurons: { tokens_in: '5500', tokens_out: '36400' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/' },
  { id: '@cf/zai-org/glm-5.2', name: 'glm-5.2', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning'], context_window: 262144, status: 'ga', paid_only: true, partner: false, prices: { tokens_in: '1.400', tokens_cached: '0.260', tokens_out: '4.400' }, neurons: { tokens_in: '127273', tokens_cached: '23636', tokens_out: '400000' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/glm-5.2/' },
  { id: '@cf/zai-org/glm-5.3', name: 'glm-5.3', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning'], context_window: null, status: 'ga', paid_only: true, partner: false, prices: { tokens_in: '1.400', tokens_cached: '0.260', tokens_out: '4.400' }, neurons: { tokens_in: '127273', tokens_cached: '23636', tokens_out: '400000' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/glm-5.3/' },
  { id: '@cf/zai-org/glm-5.3-flash', name: 'glm-5.3-flash', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning', 'Vision'], context_window: 1048576, status: 'ga', paid_only: true, partner: false, prices: { tokens_in: '0.150', tokens_cached: '0.030', tokens_out: '0.500' }, neurons: { tokens_in: '13636', tokens_cached: '2727', tokens_out: '45455' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/' },
  { id: '@cf/openai/gpt-oss-120b', name: 'gpt-oss-120b', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning'], context_window: 128000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.350', tokens_out: '0.750' }, neurons: { tokens_in: '31818', tokens_out: '68182' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/' },
  { id: '@cf/openai/gpt-oss-20b', name: 'gpt-oss-20b', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning'], context_window: 128000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.200', tokens_out: '0.300' }, neurons: { tokens_in: '18182', tokens_out: '27273' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/' },
  { id: '@cf/ibm-granite/granite-4.0-h-micro', name: 'granite-4.0-h-micro', kind: 'Text Generation', capabilities: ['Function calling'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.017', tokens_out: '0.112' }, neurons: { tokens_in: '1542', tokens_out: '10158' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/' },
  { id: '@hf/nousresearch/hermes-2-pro-mistral-7b', name: 'hermes-2-pro-mistral-7b', kind: 'Text Generation', capabilities: ['Function calling'], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/hermes-2-pro-mistral-7b/' },
  { id: '@cf/ai4bharat/indictrans2-en-indic-1B', name: 'indictrans2-en-indic-1B', kind: 'Translation', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.342', tokens_out: '0.342' }, neurons: { tokens_in: '31050', tokens_out: '31050' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/indictrans2-en-indic-1B/' },
  { id: '@cf/moonshotai/kimi-k2.5', name: 'kimi-k2.5', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning', 'Vision'], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: { tokens_in: '0.600', tokens_cached: '0.100', tokens_out: '3.000' }, neurons: { tokens_in: '54545', tokens_cached: '9091', tokens_out: '272727' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/kimi-k2.5/' },
  { id: '@cf/moonshotai/kimi-k2.6', name: 'kimi-k2.6', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning', 'Vision'], context_window: 262144, status: 'ga', paid_only: true, partner: false, prices: { tokens_in: '0.950', tokens_cached: '0.160', tokens_out: '4.000' }, neurons: { tokens_in: '86364', tokens_cached: '14545', tokens_out: '363636' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/' },
  { id: '@cf/moonshotai/kimi-k2.7-code', name: 'kimi-k2.7-code', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning', 'Vision'], context_window: 262144, status: 'ga', paid_only: true, partner: false, prices: { tokens_in: '0.950', tokens_cached: '0.190', tokens_out: '4.000' }, neurons: { tokens_in: '86364', tokens_cached: '17273', tokens_out: '363636' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/kimi-k2.7-code/' },
  { id: '@cf/meta/llama-2-7b-chat-fp16', name: 'llama-2-7b-chat-fp16', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: { tokens_in: '0.556', tokens_out: '6.667' }, neurons: { tokens_in: '50505', tokens_out: '606061' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-2-7b-chat-fp16/' },
  { id: '@cf/meta-llama/llama-2-7b-chat-hf-lora', name: 'llama-2-7b-chat-hf-lora', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-2-7b-chat-hf-lora/' },
  { id: '@cf/meta/llama-2-7b-chat-int8', name: 'llama-2-7b-chat-int8', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-2-7b-chat-int8/' },
  { id: '@cf/meta/llama-3-8b-instruct', name: 'llama-3-8b-instruct', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: { tokens_in: '0.282', tokens_out: '0.827' }, neurons: { tokens_in: '25608', tokens_out: '75147' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3-8b-instruct/' },
  { id: '@cf/meta/llama-3-8b-instruct-awq', name: 'llama-3-8b-instruct-awq', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: { tokens_in: '0.123', tokens_out: '0.266' }, neurons: { tokens_in: '11161', tokens_out: '24215' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3-8b-instruct-awq/' },
  { id: '@cf/meta/llama-3.1-70b-instruct', name: 'llama-3.1-70b-instruct', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.1-70b-instruct/' },
  { id: '@cf/meta/llama-3.1-70b-instruct-fp8-fast', name: 'llama-3.1-70b-instruct-fp8-fast', kind: 'Text Generation', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.293', tokens_out: '2.253' }, neurons: { tokens_in: '26668', tokens_out: '204805' }, docs_url: null },
  { id: '@cf/meta/llama-3.1-8b-instruct', name: 'llama-3.1-8b-instruct', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: { tokens_in: '0.282', tokens_out: '0.827' }, neurons: { tokens_in: '25608', tokens_out: '75147' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct/' },
  { id: '@cf/meta/llama-3.1-8b-instruct-awq', name: 'llama-3.1-8b-instruct-awq', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: { tokens_in: '0.123', tokens_out: '0.266' }, neurons: { tokens_in: '11161', tokens_out: '24215' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-awq/' },
  { id: '@cf/meta/llama-3.1-8b-instruct-fast', name: 'llama-3.1-8b-instruct-fast', kind: 'Text Generation', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fast/' },
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8', name: 'llama-3.1-8b-instruct-fp8', kind: 'Text Generation', capabilities: [], context_window: 32000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.152', tokens_out: '0.287' }, neurons: { tokens_in: '13778', tokens_out: '26128' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/' },
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', name: 'llama-3.1-8b-instruct-fp8-fast', kind: 'Text Generation', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.045', tokens_out: '0.384' }, neurons: { tokens_in: '4119', tokens_out: '34868' }, docs_url: null },
  { id: '@cf/meta/llama-3.2-11b-vision-instruct', name: 'llama-3.2-11b-vision-instruct', kind: 'Text Generation', capabilities: ['LoRA', 'Vision'], context_window: 128000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.049', tokens_out: '0.676' }, neurons: { tokens_in: '4410', tokens_out: '61493' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/' },
  { id: '@cf/meta/llama-3.2-1b-instruct', name: 'llama-3.2-1b-instruct', kind: 'Text Generation', capabilities: [], context_window: 60000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.027', tokens_out: '0.201' }, neurons: { tokens_in: '2457', tokens_out: '18252' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.2-1b-instruct/' },
  { id: '@cf/meta/llama-3.2-3b-instruct', name: 'llama-3.2-3b-instruct', kind: 'Text Generation', capabilities: ['LoRA'], context_window: 80000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.051', tokens_out: '0.335' }, neurons: { tokens_in: '4625', tokens_out: '30475' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'llama-3.3-70b-instruct-fp8-fast', kind: 'Text Generation', capabilities: ['Batch', 'Function calling'], context_window: 24000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.293', tokens_out: '2.253' }, neurons: { tokens_in: '26668', tokens_out: '204805' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/' },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', name: 'llama-4-scout-17b-16e-instruct', kind: 'Text Generation', capabilities: ['Batch', 'Function calling', 'Vision'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.270', tokens_out: '0.850' }, neurons: { tokens_in: '24545', tokens_out: '77273' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/' },
  { id: '@cf/meta/llama-guard-3-8b', name: 'llama-guard-3-8b', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.484', tokens_out: '0.030' }, neurons: { tokens_in: '44003', tokens_out: '2730' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llama-guard-3-8b/' },
  { id: '@cf/llava-hf/llava-1.5-7b-hf', name: 'llava-1.5-7b-hf', kind: 'Image-to-Text', capabilities: [], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/llava-1.5-7b-hf/' },
  { id: '@cf/leonardo/lucid-origin', name: 'lucid-origin', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { tiles: '0.006996', steps: '0.000132' }, neurons: { tiles: '636.00', steps: '12.00' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/lucid-origin/' },
  { id: '@cf/meta/m2m100-1.2b', name: 'm2m100-1.2b', kind: 'Translation', capabilities: ['Batch'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.342', tokens_out: '0.342' }, neurons: { tokens_in: '31050', tokens_out: '31050' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/' },
  { id: '@cf/myshell-ai/melotts', name: 'melotts', kind: 'Text-to-Speech', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { audio_minutes: '0.0002' }, neurons: { audio_minutes: '18.63' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/melotts/' },
  { id: '@hf/meta-llama/meta-llama-3-8b-instruct', name: 'meta-llama-3-8b-instruct', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/meta-llama-3-8b-instruct/' },
  { id: '@cf/mistral/mistral-7b-instruct-v0.1', name: 'mistral-7b-instruct-v0.1', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: { tokens_in: '0.110', tokens_out: '0.190' }, neurons: { tokens_in: '10000', tokens_out: '17300' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/mistral-7b-instruct-v0.1/' },
  { id: '@hf/mistral/mistral-7b-instruct-v0.2', name: 'mistral-7b-instruct-v0.2', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/mistral-7b-instruct-v0.2/' },
  { id: '@cf/mistral/mistral-7b-instruct-v0.2-lora', name: 'mistral-7b-instruct-v0.2-lora', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/mistral-7b-instruct-v0.2-lora/' },
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', name: 'mistral-small-3.1-24b-instruct', kind: 'Text Generation', capabilities: ['Function calling'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.351', tokens_out: '0.555' }, neurons: { tokens_in: '31876', tokens_out: '50488' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/mistral-small-3.1-24b-instruct/' },
  { id: '@cf/moondream/moondream3.1-9B-A2B', name: 'moondream3.1-9B-A2B', kind: 'Image-to-Text', capabilities: ['Vision'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.300', tokens_out: '1.000' }, neurons: { tokens_in: '27273', tokens_out: '90909' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/' },
  { id: '@cf/nvidia/nemotron-3-120b-a12b', name: 'nemotron-3-120b-a12b', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.500', tokens_out: '1.500' }, neurons: { tokens_in: '45455', tokens_out: '136364' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/' },
  { id: '@cf/deepgram/nova-3', name: 'nova-3', kind: 'Automatic Speech Recognition', capabilities: ['Batch', 'Real-time'], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { audio_minutes: '0.0052', audio_minutes_websocket: '0.0092' }, neurons: { audio_minutes: '472.73', audio_minutes_websocket: '836.36' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/nova-3/' },
  { id: '@cf/microsoft/phi-2', name: 'phi-2', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/phi-2/' },
  { id: '@cf/leonardo/phoenix-1.0', name: 'phoenix-1.0', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'partner', paid_only: false, partner: true, prices: { tiles: '0.005830', steps: '0.000110' }, neurons: { tiles: '530.00', steps: '10.00' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/phoenix-1.0/' },
  { id: '@cf/pfnet/plamo-embedding-1b', name: 'plamo-embedding-1b', kind: 'Text Embeddings', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.019' }, neurons: { tokens_in: '1689' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/plamo-embedding-1b/' },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'qwen2.5-coder-32b-instruct', kind: 'Text Generation', capabilities: ['LoRA'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.660', tokens_out: '1.000' }, neurons: { tokens_in: '60000', tokens_out: '90909' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/qwen2.5-coder-32b-instruct/' },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', name: 'qwen3-30b-a3b-fp8', kind: 'Text Generation', capabilities: ['Batch', 'Function calling', 'Reasoning'], context_window: 32000, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.051', tokens_out: '0.335' }, neurons: { tokens_in: '4625', tokens_out: '30475' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/' },
  { id: '@cf/qwen/qwen3-embedding-0.6b', name: 'qwen3-embedding-0.6b', kind: 'Text Embeddings', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.012' }, neurons: { tokens_in: '1075' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/qwen3-embedding-0.6b/' },
  { id: '@cf/qwen/qwen3.8-27b', name: 'qwen3.8-27b', kind: 'Text Generation', capabilities: ['Function calling', 'Reasoning', 'Vision'], context_window: 262144, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.450', tokens_out: '3.200' }, neurons: { tokens_in: '40909', tokens_out: '290909' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/' },
  { id: '@cf/qwen/qwq-32b', name: 'qwq-32b', kind: 'Text Generation', capabilities: ['LoRA', 'Reasoning'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { tokens_in: '0.660', tokens_out: '1.000' }, neurons: { tokens_in: '60000', tokens_out: '90909' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/qwq-32b/' },
  { id: '@cf/microsoft/resnet-50', name: 'resnet-50', kind: 'Image Classification', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { images: '2.51' }, neurons: { images: '228055' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/resnet-50/' },
  { id: '@cf/pipecat-ai/smart-turn-v2', name: 'smart-turn-v2', kind: 'Voice Activity Detection', capabilities: ['Batch', 'Real-time'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { audio_minutes: '0.00033795' }, neurons: { audio_minutes: '0.51' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/smart-turn-v2/' },
  { id: '@cf/defog/sqlcoder-7b-2', name: 'sqlcoder-7b-2', kind: 'Text Generation', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/sqlcoder-7b-2/' },
  { id: '@cf/runwayml/stable-diffusion-v1-5-img2img', name: 'stable-diffusion-v1-5-img2img', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/stable-diffusion-v1-5-img2img/' },
  { id: '@cf/runwayml/stable-diffusion-v1-5-inpainting', name: 'stable-diffusion-v1-5-inpainting', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/stable-diffusion-v1-5-inpainting/' },
  { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', name: 'stable-diffusion-xl-base-1.0', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-base-1.0/' },
  { id: '@cf/bytedance/stable-diffusion-xl-lightning', name: 'stable-diffusion-xl-lightning', kind: 'Text-to-Image', capabilities: [], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-lightning/' },
  { id: '@cf/unum/uform-gen2-qwen-500m', name: 'uform-gen2-qwen-500m', kind: 'Image-to-Text', capabilities: [], context_window: null, status: 'deprecated', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/uform-gen2-qwen-500m/' },
  { id: '@cf/openai/whisper', name: 'whisper', kind: 'Automatic Speech Recognition', capabilities: [], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { audio_minutes: '0.0005' }, neurons: { audio_minutes: '41.14' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/whisper/' },
  { id: '@cf/openai/whisper-large-v3-turbo', name: 'whisper-large-v3-turbo', kind: 'Automatic Speech Recognition', capabilities: ['Batch'], context_window: null, status: 'ga', paid_only: false, partner: false, prices: { audio_minutes: '0.0005' }, neurons: { audio_minutes: '46.63' }, docs_url: 'https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/' },
  { id: '@cf/openai/whisper-tiny-en', name: 'whisper-tiny-en', kind: 'Automatic Speech Recognition', capabilities: [], context_window: null, status: 'beta', paid_only: false, partner: false, prices: {}, docs_url: 'https://developers.cloudflare.com/workers-ai/models/whisper-tiny-en/' },
]);

/** The owner's switches this file reads, as plain strings (#1008 sets them). Not `Env`: nothing here touches a binding. */
export interface CatalogueSwitches {
  AI_PARTNER_MODELS?: string;
  AI_PAID_MODELS?: string;
}

const BY_ID: ReadonlyMap<string, CatalogueModel> = new Map(CATALOGUE.map((m) => [m.id, m]));

export const modelById = (id: string): CatalogueModel | null => BY_ID.get(id) ?? null;

export const isPriced = (m: CatalogueModel): boolean => Object.keys(m.prices).length > 0;

/** Partner models that ran before the gate existed (D657 Nova-3, D658 Flux). */
export const PARTNER_ALWAYS_OFFERED: ReadonlySet<string> = new Set(['@cf/deepgram/nova-3', '@cf/deepgram/flux']);

/** A partner model new to the platform: offered only while `AI_PARTNER_MODELS` is 'on'. */
export const partnerGated = (m: CatalogueModel): boolean => m.partner && !PARTNER_ALWAYS_OFFERED.has(m.id);

/** Status `ga` or `partner`, with a price, and past the partner gate. */
export function isOffered(m: CatalogueModel, env: CatalogueSwitches): boolean {
  if (m.status !== 'ga' && m.status !== 'partner') return false;
  if (!isPriced(m)) return false;
  return !partnerGated(m) || env.AI_PARTNER_MODELS === 'on';
}

/**
 * Why a run on this model is refused, or null when it may run. A model the
 * catalogue cannot price is `model_unpriced` (a run billed at zero trips no
 * cap); a model it knows but does not offer, a beta or retired one or a gated
 * partner, is `model_not_offered`.
 */
export function refusalFor(model: string, env: CatalogueSwitches): 'model_unpriced' | 'model_not_offered' | null {
  const m = modelById(model);
  if (!m) return 'model_unpriced';
  if (m.status !== 'ga' && m.status !== 'partner') return 'model_not_offered';
  if (!isPriced(m)) return 'model_unpriced';
  return isOffered(m, env) ? null : 'model_not_offered';
}

/** True unless the owner sets `AI_PAID_MODELS = 'on'`. D764 applies it to the paid-only models; this task only exports it. */
export const defaultDemoted = (env: CatalogueSwitches): boolean => env.AI_PAID_MODELS !== 'on';

// ─────────────────────────────────────────────────────── D851: model providers

/**
 * D851 (#2474): models served by a provider's own API rather than Workers AI
 * (pattern C, a native adapter in `providers/`). They are NOT in `CATALOGUE`,
 * which is Cloudflare's list and is held equal to its fixture. A provider
 * prices in USD per 1M tokens, not neurons, so each row carries its rates as
 * the provider prints them, with the page and the date they were read.
 *
 * OFF BY DEFAULT. A row is offered only while its provider's switch is exactly
 * 'on' (`AI_PROVIDER_ANTHROPIC`); unset or any other value is off, so a typo
 * never sends a member's text to a provider. The platform key is a Worker
 * secret, never in D1 and never a member's key (`aiProviders.ts`).
 */
export type ProviderId = 'anthropic';

/** The units a provider reports, each priced per 1M. `tokens_in` is uncached input only. */
export type ProviderUnit = 'tokens_in' | 'tokens_cache_write' | 'tokens_cached' | 'tokens_out';

export interface ProviderModel {
  /** The id the platform uses: `<provider>/<provider's model id>`. */
  id: string;
  provider: ProviderId;
  /** The model id the provider's API takes. */
  apiModel: string;
  name: string;
  /** USD per 1M of each unit, exactly as printed. */
  rates: Readonly<Record<ProviderUnit, string>>;
  source: string;
  read: string;
}

/** The provider switch each row needs, and the version a settlement records. */
export const PROVIDER_SWITCH: Readonly<Record<ProviderId, 'AI_PROVIDER_ANTHROPIC'>> = Object.freeze({ anthropic: 'AI_PROVIDER_ANTHROPIC' });
export const PROVIDER_PRICING_VERSION = 'p1-2026-10-21';

export const PROVIDER_MODELS: readonly ProviderModel[] = Object.freeze([
  {
    id: 'anthropic/claude-sonnet-5-5',
    provider: 'anthropic',
    apiModel: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    // Input, 5-minute cache write, cache hit, output (D851.md §1.8).
    rates: Object.freeze({ tokens_in: '2', tokens_cache_write: '2.50', tokens_cached: '0.10', tokens_out: '10' }),
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    read: '2026-10-21',
  },
]);

export type ProviderSwitches = Partial<Record<'AI_PROVIDER_ANTHROPIC', string>>;

export const providerModelById = (id: string): ProviderModel | null => PROVIDER_MODELS.find((m) => m.id === id) ?? null;

/** Offered only while its provider's switch is exactly 'on'. */
export const providerOffered = (m: ProviderModel, env: ProviderSwitches): boolean => env[PROVIDER_SWITCH[m.provider]] === 'on';
