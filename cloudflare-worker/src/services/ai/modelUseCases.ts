/**
 * D1478 (#3934, task 0 of the #3721 model use-case plan): every job that runs
 * a model, its kind of work, and the models each kind may offer, as data.
 *
 * This is §2 of S1's plan (#3721, comment 6543041473) and its §3 presets
 * (comment 6543052069), with the owner's answers A–G (comment 6551512362):
 *
 *   - each job is a list of steps, `{ kind, default, alternatives, fallback,
 *     fixed }`. A fixed step has no selector; the rail shows only what it
 *     consumed. A multi-step job (Retrieve → Rank → Write) lists each step;
 *   - `USE_CASE_KINDS` is §2's kind table: the rail's selectors, each with its
 *     full list in order. The rail suggests a selector's Default, Alternative
 *     and Deeper from the job (`suggestionsFor`), so it never chooses its own
 *     three, and lists the rest of the kind under All models (`moreFor`);
 *   - `MODEL_LOCK` is answer A (c), tiered plan locks. A locked model shows its
 *     plan label (`LOCK_LABEL`) and is never swapped silently;
 *   - answer B (c): no beta or unpriced model is ever listed
 *     (`NOT_OFFERED`); `deepseek-v4.1-flash-1017` is priced (0.30 / 1.20) and
 *     joins the Summarise, Research and Reason lists on paid plans;
 *   - answer C (b): partner models are gated by `AI_PARTNER_MODELS`, which
 *     `catalogue.isOffered` applies; the lock table puts the gated ones on
 *     paid plans.
 *
 * Task 0 changes which models the rail LISTS, not which model a press RUNS:
 * every row's `models` (its automatic chain) is untouched. Each job's own
 * task (#3935 to #3938) moves its presses to the Default here, with the
 * owner's spend approval first.
 *
 * Kind-list corrections to the plan's §2 table, so that every job's Default
 * and Alternatives belong to their kind (the plan's own fit check missed
 * these): Write adds the light writers its one-line jobs use (llama-3.2-3b,
 * llama-3.2-1b, granite, 8b-fp8: EV5, NE1, RA11, GR4, LE10, MI1); Summarise
 * adds 8b-fp8 (AD3, EM3); Agent and Plan add llama-3.3-70b (ST3, BU4);
 * Numbers adds qwen3-30b (IN7, GR16); Reason adds qwen3-30b, glm-5.3-flash
 * and kimi-k2.6 (VA15, LE7, RA2, AR3); Sentiment adds clef-omni (VA9); Voice
 * turn adds llama-3.3-70b (GR8, the voice-note script, not a live turn).
 *
 * Pure: no env, no binding, no D1.
 */

type KindRow = { label: string; selectable: boolean; list: readonly string[] };
export type Lock = 'lowest_paid' | 'top_paid';
export type JobStep = {
  kind: UseCaseKind;
  default: string;
  alternatives?: readonly string[];
  /** What `run()` uses when the Default is locked or gated; the receipt names it. */
  fallback?: string;
  fallbackNote?: string;
  fixed?: true;
};
export type Presets = { fast: readonly string[]; balanced: readonly string[]; best: readonly string[] };
export type ModelJob = { id: string; label: string; steps: readonly JobStep[]; presets?: Presets; note?: string };

/** The kinds of generation work: the rail's selectors (§2), each with its full list in order. */
export const USE_CASE_KINDS = {
  chat: { label: "Chat", selectable: true, list: ["@cf/zai-org/glm-4.7-flash", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-20b", "@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-3.2-3b-instruct", "@cf/aisingapore/gemma-sea-lion-v4-27b-it", "@cf/moonshotai/kimi-k2.6"] },
  write: { label: "Write", selectable: true, list: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash", "@cf/aisingapore/gemma-sea-lion-v4-27b-it", "@cf/meta/llama-3.2-3b-instruct", "@cf/meta/llama-3.2-1b-instruct", "@cf/ibm-granite/granite-4.0-h-micro", "@cf/meta/llama-3.1-8b-instruct-fp8"] },
  synth: { label: "Summarise and structure", selectable: true, list: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash", "@cf/meta/llama-3.1-8b-instruct-fp8-fast", "@cf/meta/llama-3.2-3b-instruct", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/moonshotai/kimi-k2.6", "@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/deepseek-ai/deepseek-v4.1-flash-1017"] },
  plan: { label: "Plan", selectable: true, list: ["@cf/zai-org/glm-4.7-flash", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-20b", "@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"] },
  reason: { label: "Reason", selectable: true, list: ["@cf/openai/gpt-oss-120b", "@cf/openai/gpt-oss-20b", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/qwen/qwq-32b", "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/zai-org/glm-5.3-flash", "@cf/moonshotai/kimi-k2.6", "@cf/deepseek-ai/deepseek-v4.1-flash-1017"] },
  numbers: { label: "Numbers", selectable: true, list: ["@cf/openai/gpt-oss-120b", "@cf/qwen/qwq-32b", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/ibm-granite/granite-4.0-h-micro", "@cf/qwen/qwen3-30b-a3b-fp8"] },
  research: { label: "Research", selectable: true, list: ["@cf/openai/gpt-oss-120b", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/moonshotai/kimi-k2.6", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/deepseek-ai/deepseek-v4.1-flash-1017"] },
  code: { label: "Code", selectable: true, list: ["@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/zai-org/glm-5.3-flash", "@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.3", "@cf/qwen/qwen3.8-27b"] },
  agent: { label: "Agent", selectable: true, list: ["@cf/zai-org/glm-4.7-flash", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-120b", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/moonshotai/kimi-k2.6", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"] },
  read_images: { label: "Read images", selectable: true, list: ["@cf/google/gemma-4-26b-a4b-it", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/moondream/moondream3.1-9B-A2B", "@cf/meta/llama-3.2-11b-vision-instruct", "@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash", "@cf/moonshotai/kimi-k2.6"] },
  draw: { label: "Draw", selectable: true, list: ["@cf/black-forest-labs/flux-2-klein-9b", "@cf/black-forest-labs/flux-1-schnell", "@cf/black-forest-labs/flux-2-klein-4b", "@cf/black-forest-labs/flux-2-dev", "@cf/leonardo/lucid-origin", "@cf/leonardo/phoenix-1.0"] },
  edit_image: { label: "Edit image", selectable: true, list: ["@cf/black-forest-labs/flux-2-klein-4b", "@cf/black-forest-labs/flux-2-klein-9b", "@cf/black-forest-labs/flux-2-dev"] },
  listen_file: { label: "Listen (file)", selectable: true, list: ["@cf/openai/whisper-large-v3-turbo", "@cf/deepgram/nova-3", "@cf/openai/whisper"] },
  listen_live: { label: "Listen (live)", selectable: true, list: ["@cf/deepgram/flux", "@cf/deepgram/nova-3"] },
  speak: { label: "Speak", selectable: true, list: ["@cf/deepgram/aura-2-en", "@cf/deepgram/aura-2-es", "@cf/deepgram/aura-1", "@cf/myshell-ai/melotts"] },
  voice_turn: { label: "Voice turn", selectable: true, list: ["@cf/daily-co/phonellm-mini-alpha-2", "@cf/zai-org/glm-4.7-flash", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"] },
  translate: { label: "Translate", selectable: true, list: ["@cf/meta/m2m100-1.2b", "@cf/ai4bharat/indictrans2-en-indic-1B"] },
  decide: { label: "Decide", selectable: true, list: ["@cf/cloudflare/clef-flash", "@cf/cloudflare/clef", "@cf/cloudflare/clef-omni"] },
  sentiment: { label: "Sentiment", selectable: true, list: ["@cf/huggingface/distilbert-sst-2-int8", "@cf/cloudflare/clef-flash", "@cf/cloudflare/clef", "@cf/cloudflare/clef-omni"] },
  retrieve: { label: "Retrieve", selectable: true, list: ["@cf/baai/bge-m3", "@cf/qwen/qwen3-embedding-0.6b", "@cf/baai/bge-large-en-v1.5", "@cf/baai/bge-small-en-v1.5", "@cf/pfnet/plamo-embedding-1b"] },
  retrieve_index: { label: "Retrieve (index)", selectable: false, list: ["@cf/baai/bge-base-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b"] },
  rank: { label: "Rank", selectable: false, list: ["@cf/baai/bge-reranker-base"] },
  screen: { label: "Screen images", selectable: false, list: ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/moondream/moondream3.1-9B-A2B"] },
  guard: { label: "Guard", selectable: false, list: ["@cf/meta/llama-guard-3-8b"] },
  turn_taking: { label: "Turn-taking", selectable: false, list: ["@cf/pipecat-ai/smart-turn-v2"] },
  legal: { label: "Legal", selectable: true, list: ["@cf/openai/gpt-oss-120b", "@cf/openai/gpt-oss-20b", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/deepseek-ai/deepseek-v4-flash-0731"] },
  image_tags: { label: "Image tags", selectable: false, list: ["@cf/microsoft/resnet-50"] },
} as const satisfies Record<string, KindRow>;

/** Owner answer A (c): the lowest plan that may run a model. Unlisted models run on every plan. */
export const MODEL_LOCK: Readonly<Record<string, Lock>> = Object.freeze({"@cf/zai-org/glm-5.3-flash": "lowest_paid", "@cf/deepseek-ai/deepseek-v4-flash-0731": "lowest_paid", "@cf/black-forest-labs/flux-2-klein-9b": "lowest_paid", "@cf/leonardo/lucid-origin": "lowest_paid", "@cf/leonardo/phoenix-1.0": "lowest_paid", "@cf/deepgram/aura-2-en": "lowest_paid", "@cf/deepgram/aura-2-es": "lowest_paid", "@cf/deepgram/aura-1": "lowest_paid", "@cf/qwen/qwen3.8-27b": "lowest_paid", "@cf/deepseek-ai/deepseek-v4.1-flash-1017": "lowest_paid", "@cf/deepseek-ai/deepseek-v4-pro-0813": "top_paid", "@cf/zai-org/glm-5.3": "top_paid", "@cf/moonshotai/kimi-k2.6": "top_paid", "@cf/moonshotai/kimi-k2.7-code": "top_paid", "@cf/black-forest-labs/flux-2-dev": "top_paid"});

/** §2 as data: one entry per job, each step with its kind, Default, Alternatives and fallback. */
export const MODEL_JOBS: readonly ModelJob[] = Object.freeze([
  {"id": "ST1", "label": "Ask Eadwyn (`routes/eadwyn.ts:514`)", "steps": [{"kind": "chat", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-120b", "@cf/openai/gpt-oss-20b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/aisingapore/gemma-sea-lion-v4-27b-it", "@cf/moonshotai/kimi-k2.6"]}], "presets": {"fast": ["@cf/qwen/qwen3-30b-a3b-fp8"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/openai/gpt-oss-120b", "@cf/moonshotai/kimi-k2.6"]}},
  {"id": "ST2", "label": "Read this page back (`routes/ai.ts:720`)", "steps": [{"kind": "synth", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/zai-org/glm-4.7-flash", "@cf/meta/llama-3.2-3b-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct"]}], "presets": {"fast": ["@cf/meta/llama-3.2-3b-instruct"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "ST3", "label": "Studio interview, Send: tool calls (`routes/advisor.ts:2602`)", "steps": [{"kind": "agent", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-120b", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}], "presets": {"fast": ["@cf/qwen/qwen3-30b-a3b-fp8"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "ST4", "label": "Explain this question (`advisor.ts:2268`)", "steps": [{"kind": "chat", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/meta/llama-3.2-3b-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/openai/gpt-oss-20b"]}], "presets": {"fast": ["@cf/meta/llama-3.2-3b-instruct"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/openai/gpt-oss-120b"]}},
  {"id": "ST5", "label": "Choose the next question (`services/advisor/rerank.ts:268`)", "steps": [{"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "decide", "default": "@cf/cloudflare/clef-flash", "fallbackNote": "the first question in the bank", "fixed": true}]},
  {"id": "ST6", "label": "Record a voice answer (`advisor.ts:2909`)", "steps": [{"kind": "listen_file", "default": "@cf/openai/whisper-large-v3-turbo", "alternatives": ["@cf/openai/whisper", "@cf/deepgram/nova-3"]}], "presets": {"fast": ["@cf/openai/whisper"], "balanced": ["@cf/openai/whisper-large-v3-turbo"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "ST7", "label": "Read an answer or prompt aloud", "steps": [{"kind": "speak", "default": "@cf/myshell-ai/melotts", "alternatives": ["@cf/deepgram/aura-2-en", "@cf/deepgram/aura-1", "@cf/deepgram/aura-2-es"]}], "presets": {"fast": ["@cf/myshell-ai/melotts"], "balanced": ["@cf/deepgram/aura-1"], "best": ["@cf/deepgram/aura-2-en", "@cf/deepgram/aura-2-es"]}},
  {"id": "ST8", "label": "Voice mode: hear the member", "steps": [{"kind": "listen_live", "default": "@cf/deepgram/flux", "alternatives": ["@cf/deepgram/nova-3"]}], "presets": {"fast": ["@cf/deepgram/flux"], "balanced": ["@cf/deepgram/flux"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "ST9", "label": "Voice mode: the words of the reply", "steps": [{"kind": "voice_turn", "default": "@cf/daily-co/phonellm-mini-alpha-2", "alternatives": ["@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/daily-co/phonellm-mini-alpha-2"], "balanced": ["@cf/daily-co/phonellm-mini-alpha-2"], "best": ["@cf/zai-org/glm-4.7-flash"]}},
  {"id": "ST10", "label": "Voice mode: speak the reply (it must stream)", "steps": [{"kind": "speak", "default": "@cf/deepgram/aura-2-en", "alternatives": ["@cf/deepgram/aura-1", "@cf/deepgram/aura-2-es"], "fallback": "@cf/myshell-ai/melotts"}], "presets": {"fast": ["@cf/deepgram/aura-1"], "balanced": ["@cf/deepgram/aura-2-en"], "best": ["@cf/deepgram/aura-2-en"]}},
  {"id": "ST11", "label": "Voice mode, cheap path: turn end", "steps": [{"kind": "turn_taking", "default": "@cf/pipecat-ai/smart-turn-v2", "fixed": true}]},
  {"id": "ST12", "label": "Input and output safety (`aiRouter.ts:1545-1660`, `services/advisor/guardrails.ts:150`)", "steps": [{"kind": "guard", "default": "@cf/meta/llama-guard-3-8b", "fixed": true}]},
  {"id": "ON1", "label": "Onboarding chat turn (`routes/profiling.ts:240,256`)", "steps": [{"kind": "chat", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.2-3b-instruct", "@cf/aisingapore/gemma-sea-lion-v4-27b-it"], "fallback": "@cf/meta/llama-3.1-8b-instruct-fp8"}], "presets": {"fast": ["@cf/qwen/qwen3-30b-a3b-fp8"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/openai/gpt-oss-120b", "@cf/moonshotai/kimi-k2.6"]}},
  {"id": "ON2", "label": "Profiling tool calls (`profiling.ts:336`)", "steps": [{"kind": "agent", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-120b", "@cf/mistralai/mistral-small-3.1-24b-instruct"]}], "presets": {"fast": ["@cf/qwen/qwen3-30b-a3b-fp8"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "ON3", "label": "Persona from the first message (`routes/personas.ts:160` → `persona-router.ts:85`)", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-flash", "fallback": "@cf/meta/llama-3.1-8b-instruct-fp8", "fixed": true}]},
  {"id": "ON4", "label": "Role detection (`role_detect`, `aiRouter.ts:664`)", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-flash", "fixed": true}]},
  {"id": "ON5", "label": "Free-text answer sentiment (`services/advisor/banks/existingFounder.ts:86`)", "steps": [{"kind": "sentiment", "default": "@cf/huggingface/distilbert-sst-2-int8", "alternatives": ["@cf/cloudflare/clef-flash", "@cf/cloudflare/clef"]}], "presets": {"fast": ["@cf/huggingface/distilbert-sst-2-int8"], "balanced": ["@cf/huggingface/distilbert-sst-2-int8"], "best": ["@cf/cloudflare/clef"]}},
  {"id": "VA1", "label": "Record a Session, the final transcript per chunk, and the legacy recording (`services/interviewProcessing.ts:168`, `routes/founder_validate.ts:1136`)", "steps": [{"kind": "listen_file", "default": "@cf/openai/whisper-large-v3-turbo", "alternatives": ["@cf/deepgram/nova-3", "@cf/openai/whisper"]}], "presets": {"fast": ["@cf/openai/whisper"], "balanced": ["@cf/openai/whisper-large-v3-turbo"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "VA2", "label": "Live transcript while recording (`services/liveTranscription.ts:111`)", "steps": [{"kind": "listen_live", "default": "@cf/deepgram/flux", "alternatives": ["@cf/deepgram/nova-3"]}], "presets": {"fast": ["@cf/deepgram/flux"], "balanced": ["@cf/deepgram/flux"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "VA3", "label": "WhatsApp and Telegram voice notes (`services/channels/channelAudio.ts:104`)", "steps": [{"kind": "listen_file", "default": "@cf/openai/whisper-large-v3-turbo", "alternatives": ["@cf/openai/whisper"]}], "presets": {"fast": ["@cf/openai/whisper"], "balanced": ["@cf/openai/whisper-large-v3-turbo"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "VA4", "label": "Zoom, Meet and Teams recordings, the meeting bot, speaker labels (`services/channels/meetingAudio.ts:385`, `services/meetingBotAssembly.ts:136`)", "steps": [{"kind": "listen_file", "default": "@cf/deepgram/nova-3", "alternatives": ["@cf/openai/whisper-large-v3-turbo"], "fallback": "@cf/openai/whisper-large-v3-turbo", "fallbackNote": "turbo plus heuristic labels"}], "presets": {"fast": ["@cf/openai/whisper-large-v3-turbo"], "balanced": ["@cf/deepgram/nova-3"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "VA5", "label": "Structure, summarise and extract items (`services/interviewStructuring.ts:556,718,920`, `services/conversationItems.ts:285`)", "steps": [{"kind": "synth", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/meta/llama-3.1-8b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/moonshotai/kimi-k2.6"], "fallback": "@cf/mistralai/mistral-small-3.1-24b-instruct"}], "presets": {"fast": ["@cf/meta/llama-3.1-8b-instruct-fp8-fast"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/deepseek-ai/deepseek-v4-flash-0731"]}},
  {"id": "VA6", "label": "Ask the transcript (`interviewStructuring.ts:722`)", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "fixed": true}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "research", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/moonshotai/kimi-k2.6", "@cf/deepseek-ai/deepseek-v4-flash-0731"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/moonshotai/kimi-k2.6", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "VA7", "label": "Translate a segment (`services/sessionTranslation.ts:204`)", "steps": [{"kind": "translate", "default": "@cf/meta/m2m100-1.2b", "alternatives": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}], "presets": {"fast": ["@cf/meta/m2m100-1.2b"], "balanced": ["@cf/meta/m2m100-1.2b"], "best": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}},
  {"id": "VA8", "label": "Detect the segment language (`sessionTranslation.ts:142`)", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-flash", "fallback": "@cf/meta/llama-3.1-8b-instruct-fp8", "fixed": true}]},
  {"id": "VA9", "label": "Sentiment and urgency cues per segment", "steps": [{"kind": "sentiment", "default": "@cf/huggingface/distilbert-sst-2-int8", "alternatives": ["@cf/cloudflare/clef-flash", "@cf/cloudflare/clef", "@cf/cloudflare/clef-omni"]}], "presets": {"fast": ["@cf/huggingface/distilbert-sst-2-int8"], "balanced": ["@cf/huggingface/distilbert-sst-2-int8"], "best": ["@cf/cloudflare/clef"]}},
  {"id": "VA10", "label": "Read the interview prompts aloud", "steps": [{"kind": "speak", "default": "@cf/myshell-ai/melotts", "alternatives": ["@cf/deepgram/aura-2-en", "@cf/deepgram/aura-2-es", "@cf/deepgram/aura-1"]}], "presets": {"fast": ["@cf/myshell-ai/melotts"], "balanced": ["@cf/deepgram/aura-1"], "best": ["@cf/deepgram/aura-2-en", "@cf/deepgram/aura-2-es"]}},
  {"id": "VA11", "label": "Problem discovery: tag phrases and fill the theme form (`services/fills/registry.ts:63`, `routes/rail_run.ts:158`)", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "fixed": true}, {"kind": "synth", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/meta/llama-3.1-8b-instruct-fp8-fast", "@cf/meta/llama-3.2-3b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/meta/llama-3.1-8b-instruct-fp8-fast"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "VA12", "label": "ICP: segment form fill and clustering of interviewees", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/qwen/qwen3-embedding-0.6b", "@cf/baai/bge-large-en-v1.5"]}, {"kind": "synth", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/qwen/qwen3-embedding-0.6b", "@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "VA13", "label": "Market sizing and competitor scan (`registry.ts:286,457`, `services/competitorAnalysis.ts:184`)", "steps": [{"kind": "research", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/moonshotai/kimi-k2.6", "@cf/deepseek-ai/deepseek-v4-flash-0731"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/moonshotai/kimi-k2.6"]}},
  {"id": "VA14", "label": "Demand and urgency: score each quote", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef", "alternatives": ["@cf/cloudflare/clef-flash"]}], "presets": {"fast": ["@cf/cloudflare/clef-flash"], "balanced": ["@cf/cloudflare/clef"], "best": ["@cf/cloudflare/clef"]}},
  {"id": "VA15", "label": "Experiments: draft a hypothesis (`registry.ts:174`)", "steps": [{"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/openai/gpt-oss-20b", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/qwen/qwen3-30b-a3b-fp8"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "VA16", "label": "Demand test: landing-page copy", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "VA17", "label": "Demand test: the visual", "steps": [{"kind": "draw", "default": "@cf/black-forest-labs/flux-2-klein-4b", "alternatives": ["@cf/black-forest-labs/flux-1-schnell", "@cf/leonardo/lucid-origin"], "fallback": "@cf/black-forest-labs/flux-1-schnell"}], "presets": {"fast": ["@cf/black-forest-labs/flux-1-schnell"], "balanced": ["@cf/black-forest-labs/flux-2-klein-4b"], "best": ["@cf/black-forest-labs/flux-2-klein-9b"]}},
  {"id": "VA18", "label": "Verdict: go, pivot or stop (`routes/cycle_verdict.ts`)", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef", "fixed": true}, {"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "BU1", "label": "Build plan wording (`routes/build_plan.ts:153`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "BU2", "label": "Roadmap, this-week and retro drafts (`routes/research.ts:2938,2886,3017`)", "steps": [{"kind": "plan", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-20b", "@cf/openai/gpt-oss-120b"]}], "presets": {"fast": ["@cf/qwen/qwen3-30b-a3b-fp8"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/openai/gpt-oss-120b"]}},
  {"id": "BU3", "label": "KPI drafts (`research.ts:2974`)", "steps": [{"kind": "numbers", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/qwen/qwq-32b", "@cf/ibm-granite/granite-4.0-h-micro"]}], "presets": {"fast": ["@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "BU4", "label": "Solution design and Prototype must-have form fills (`services/fills/fields.ts:58-61,77-78`)", "steps": [{"kind": "plan", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/openai/gpt-oss-20b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/openai/gpt-oss-20b"]}},
  {"id": "BU5", "label": "Prototype code: scaffold, component, review", "steps": [{"kind": "code", "default": "@cf/qwen/qwen2.5-coder-32b-instruct", "alternatives": ["@cf/zai-org/glm-5.3-flash", "@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.3", "@cf/qwen/qwen3.8-27b"], "fallback": "@cf/qwen/qwen2.5-coder-32b-instruct"}], "presets": {"fast": ["@cf/qwen/qwen2.5-coder-32b-instruct"], "balanced": ["@cf/zai-org/glm-5.3-flash", "@cf/qwen/qwen2.5-coder-32b-instruct"], "best": ["@cf/moonshotai/kimi-k2.7-code", "@cf/qwen/qwen3.8-27b"]}},
  {"id": "BU6", "label": "Read a screenshot or whiteboard, then plan from it", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it", "alternatives": ["@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/moondream/moondream3.1-9B-A2B", "@cf/meta/llama-3.2-11b-vision-instruct"], "fallback": "@cf/google/gemma-4-26b-a4b-it"}], "presets": {"fast": ["@cf/meta/llama-3.2-11b-vision-instruct", "@cf/moondream/moondream3.1-9B-A2B"], "balanced": ["@cf/google/gemma-4-26b-a4b-it"], "best": ["@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash"]}},
  {"id": "BU7", "label": "Solution mock-ups and product renders", "steps": [{"kind": "draw", "default": "@cf/leonardo/lucid-origin", "alternatives": ["@cf/black-forest-labs/flux-2-dev", "@cf/black-forest-labs/flux-1-schnell"], "fallback": "@cf/black-forest-labs/flux-1-schnell"}], "presets": {"fast": ["@cf/black-forest-labs/flux-1-schnell"], "balanced": ["@cf/leonardo/lucid-origin"], "best": ["@cf/black-forest-labs/flux-2-dev"]}},
  {"id": "BU8", "label": "Company creation documents", "steps": [{"kind": "legal", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "DK1", "label": "Outline and build a deck (`routes/deck_new.ts:142`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash", "@cf/aisingapore/gemma-sea-lion-v4-27b-it"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "DK2", "label": "Rewrite, shorten, tone and translate; charts from records (`routes/deck_assist.ts:139`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "DK3", "label": "Draft the deck's text from the venture's records: the one-click path (`services/decks/autofill.ts:224`; JSON Mode, so no streaming)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/zai-org/glm-4.7-flash", "@cf/mistralai/mistral-small-3.1-24b-instruct"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "DK4", "label": "Card and area images (`routes/deck_images.ts:117`)", "steps": [{"kind": "draw", "default": "@cf/black-forest-labs/flux-2-klein-9b", "alternatives": ["@cf/black-forest-labs/flux-1-schnell", "@cf/black-forest-labs/flux-2-klein-4b", "@cf/black-forest-labs/flux-2-dev"], "fallback": "@cf/black-forest-labs/flux-1-schnell", "fallbackNote": "schnell, with \"square, cropped to 16:9\" in the quote"}], "presets": {"fast": ["@cf/black-forest-labs/flux-1-schnell"], "balanced": ["@cf/black-forest-labs/flux-2-klein-9b"], "best": ["@cf/black-forest-labs/flux-2-dev"]}},
  {"id": "DK5", "label": "Edit this image or restyle it to the brand", "steps": [{"kind": "edit_image", "default": "@cf/black-forest-labs/flux-2-klein-4b", "alternatives": ["@cf/black-forest-labs/flux-2-klein-9b", "@cf/black-forest-labs/flux-2-dev"], "fallbackNote": "none (the press is hidden)"}], "presets": {"fast": ["@cf/black-forest-labs/flux-2-klein-4b"], "balanced": ["@cf/black-forest-labs/flux-2-klein-4b"], "best": ["@cf/black-forest-labs/flux-2-klein-9b"]}},
  {"id": "DK6", "label": "After every draw: real-person check, screen, alt text", "steps": [{"kind": "screen", "default": "@cf/moondream/moondream3.1-9B-A2B", "fixed": true}, {"kind": "screen", "default": "@cf/meta/llama-4-scout-17b-16e-instruct", "fixed": true}]},
  {"id": "DK7", "label": "Uploaded deck to text (`services/deckExtract.ts:118`)", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it", "fixed": true}]},
  {"id": "DK8", "label": "Map text to sections; review the deck or a version (`deckExtract.ts:180,253`, `routes/deck_reviewer.ts:128`, `services/deckVersionReview.ts:164`)", "steps": [{"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/openai/gpt-oss-20b", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-pro-0813"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/moonshotai/kimi-k2.6"]}},
  {"id": "DK9", "label": "Slide design feedback", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it", "alternatives": ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/moondream/moondream3.1-9B-A2B", "@cf/meta/llama-3.2-11b-vision-instruct", "@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash"]}], "presets": {"fast": ["@cf/meta/llama-3.2-11b-vision-instruct", "@cf/moondream/moondream3.1-9B-A2B"], "balanced": ["@cf/google/gemma-4-26b-a4b-it"], "best": ["@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash"]}},
  {"id": "DK10", "label": "Voice-over and rehearsal narration", "steps": [{"kind": "speak", "default": "@cf/deepgram/aura-2-en", "alternatives": ["@cf/deepgram/aura-2-es", "@cf/deepgram/aura-1", "@cf/myshell-ai/melotts"], "fallback": "@cf/myshell-ai/melotts"}], "presets": {"fast": ["@cf/myshell-ai/melotts"], "balanced": ["@cf/deepgram/aura-1"], "best": ["@cf/deepgram/aura-2-en", "@cf/deepgram/aura-2-es"]}},
  {"id": "DK11", "label": "Rehearsal: transcribe", "steps": [{"kind": "listen_file", "default": "@cf/openai/whisper-large-v3-turbo", "alternatives": ["@cf/openai/whisper", "@cf/deepgram/nova-3"]}], "presets": {"fast": ["@cf/openai/whisper"], "balanced": ["@cf/openai/whisper-large-v3-turbo"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "DK12", "label": "Rehearsal: critique", "steps": [{"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/openai/gpt-oss-20b", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/moonshotai/kimi-k2.6"]}},
  {"id": "DK13", "label": "Grid and research agents (#3716)", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3"}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "research", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/moonshotai/kimi-k2.6", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/moonshotai/kimi-k2.6", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "RA1", "label": "Positioning, section draft, objection, phrase the fix (`routes/cycle_raise.ts:697,1058,1093`, `research.ts:3524`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "RA2", "label": "Data room: read the room (`research.ts:3203`)", "steps": [{"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/moonshotai/kimi-k2.6", "@cf/zai-org/glm-5.3-flash"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/moonshotai/kimi-k2.6"]}},
  {"id": "RA3", "label": "Data room: OCR and classify each upload", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it", "fixed": true}, {"kind": "decide", "default": "@cf/cloudflare/clef", "alternatives": ["@cf/cloudflare/clef-flash"]}], "presets": {"fast": ["@cf/cloudflare/clef-flash"], "balanced": ["@cf/cloudflare/clef"], "best": ["@cf/cloudflare/clef"]}},
  {"id": "RA4", "label": "Data room: investor Q&A over the room", "steps": [{"kind": "retrieve_index", "default": "@cf/qwen/qwen3-embedding-0.6b", "fixed": true}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "research", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/moonshotai/kimi-k2.6", "@cf/deepseek-ai/deepseek-v4-flash-0731"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/moonshotai/kimi-k2.6", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "RA5", "label": "Data room: PII and redaction check", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef", "fixed": true}]},
  {"id": "RA6", "label": "Readiness: explain the score and the clauses (`routes/pmf_explain.ts:56`, `research.ts:3170`)", "steps": [{"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/openai/gpt-oss-20b"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "RA7", "label": "Cap table: read an uploaded document (`services/capTableDocumentRead.ts:160,187`)", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it", "fixed": true}, {"kind": "legal", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "RA8", "label": "Cap table round and order of payment; use of funds (`research.ts:3116,3251`, `routes/use_of_funds_eadwyn.ts:75`)", "steps": [{"kind": "numbers", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/qwen/qwq-32b", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "RA9", "label": "Capital relationships: note to a stage proposal (`services/capRelTabs.ts:348`)", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef", "alternatives": ["@cf/cloudflare/clef-flash"]}], "presets": {"fast": ["@cf/cloudflare/clef-flash"], "balanced": ["@cf/cloudflare/clef"], "best": ["@cf/cloudflare/clef"]}},
  {"id": "RA10", "label": "Capital relationships: intro and follow-up drafts (`capRelTabs.ts:396`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "RA11", "label": "Match investors to the venture (`services/market_intel/extractors/fit_match.ts`)", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b"]}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "write", "default": "@cf/meta/llama-3.2-3b-instruct", "alternatives": ["@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/zai-org/glm-4.7-flash"]}},
  {"id": "RA12", "label": "Investor update (`services/updateShare.ts:211`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "IN1", "label": "IC memo, closing note, thin-evidence draft, deal room note (`research.ts:2446,2499,3480`, `routes/deal_flow.ts:82`)", "steps": [{"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/moonshotai/kimi-k2.6"]}},
  {"id": "IN2", "label": "Decision gate (`routes/pipeline.ts:102`)", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef", "fixed": true}, {"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "IN3", "label": "Deal legal notes, diligence review, spin-out equity (`routes/legalcap.ts:301,424,708`)", "steps": [{"kind": "legal", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "IN4", "label": "Deal scoring queue job (`cloudflare-worker/ai-workers/scoring.ts:45`)", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef", "fixed": true}]},
  {"id": "IN5", "label": "Valuation and equity queue jobs (`valuation.ts:64,171`, `equity.ts:35`)", "steps": [{"kind": "numbers", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}], "presets": {"fast": ["@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "IN6", "label": "LPA drafting (`lpa.ts:72`)", "steps": [{"kind": "legal", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "IN7", "label": "Traction review (`traction.ts:31`)", "steps": [{"kind": "numbers", "default": "@cf/qwen/qwen3-30b-a3b-fp8", "alternatives": ["@cf/openai/gpt-oss-120b", "@cf/ibm-granite/granite-4.0-h-micro"]}], "presets": {"fast": ["@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/qwen/qwen3-30b-a3b-fp8"], "best": ["@cf/openai/gpt-oss-120b"]}},
  {"id": "IN8", "label": "Diligence documents (vision row)", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it", "alternatives": ["@cf/qwen/qwen3.8-27b", "@cf/moondream/moondream3.1-9B-A2B", "@cf/zai-org/glm-5.3-flash", "@cf/meta/llama-4-scout-17b-16e-instruct"]}], "presets": {"fast": ["@cf/meta/llama-3.2-11b-vision-instruct", "@cf/moondream/moondream3.1-9B-A2B"], "balanced": ["@cf/google/gemma-4-26b-a4b-it"], "best": ["@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash"]}},
  {"id": "IN9", "label": "Portfolio updates: sentiment and risk flags", "steps": [{"kind": "sentiment", "default": "@cf/huggingface/distilbert-sst-2-int8", "alternatives": ["@cf/cloudflare/clef-flash", "@cf/cloudflare/clef"]}], "presets": {"fast": ["@cf/huggingface/distilbert-sst-2-int8"], "balanced": ["@cf/huggingface/distilbert-sst-2-int8", "@cf/cloudflare/clef-flash"], "best": ["@cf/cloudflare/clef"]}},
  {"id": "IN10", "label": "Partner bands (`research.ts:1579-2407`); audience fit and leads", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "fixed": true}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/zai-org/glm-4.7-flash"]}, "note": "Partner bands keep each row's own kind and list; the match rows embed and rank."},
  {"id": "IN11", "label": "Partner status-report and advisor services forms (`fields.ts:87-91`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "IN12", "label": "Advisor sessions: transcribe (speech row)", "steps": [{"kind": "listen_file", "default": "@cf/deepgram/nova-3", "alternatives": ["@cf/openai/whisper-large-v3-turbo"], "fallback": "@cf/openai/whisper-large-v3-turbo"}], "presets": {"fast": ["@cf/openai/whisper-large-v3-turbo"], "balanced": ["@cf/deepgram/nova-3"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "IN13", "label": "Advisor sessions: summarise", "steps": [{"kind": "synth", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/meta/llama-3.2-3b-instruct"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "GR1", "label": "Feedback themes (`registry.ts:642`)", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3"}, {"kind": "synth", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/meta/llama-3.1-8b-instruct-fp8-fast", "@cf/meta/llama-3.2-3b-instruct"]}], "presets": {"fast": ["@cf/meta/llama-3.1-8b-instruct-fp8-fast"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "GR2", "label": "Landing auto-fill, palette, taglines, customer sequence (`routes/brand.ts:464,1109,1145`, `research.ts:3291`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "GR3", "label": "Logo (`brand.ts:514`)", "steps": [{"kind": "draw", "default": "@cf/leonardo/lucid-origin", "alternatives": ["@cf/leonardo/phoenix-1.0", "@cf/black-forest-labs/flux-2-klein-9b", "@cf/black-forest-labs/flux-1-schnell"], "fallback": "@cf/black-forest-labs/flux-1-schnell"}], "presets": {"fast": ["@cf/leonardo/phoenix-1.0"], "balanced": ["@cf/leonardo/lucid-origin"], "best": ["@cf/leonardo/lucid-origin"]}},
  {"id": "GR4", "label": "Rank applicants (`research.ts:3346`)", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/baai/bge-large-en-v1.5"]}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "write", "default": "@cf/meta/llama-3.2-3b-instruct"}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/zai-org/glm-4.7-flash"]}},
  {"id": "GR5", "label": "Marketing and outreach copy: posts, ads, newsletter (#3722, `routes/newsletter.ts`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/aisingapore/gemma-sea-lion-v4-27b-it", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "GR6", "label": "Campaign and post images without text", "steps": [{"kind": "draw", "default": "@cf/black-forest-labs/flux-2-klein-9b", "alternatives": ["@cf/black-forest-labs/flux-1-schnell", "@cf/black-forest-labs/flux-2-klein-4b", "@cf/black-forest-labs/flux-2-dev"], "fallback": "@cf/black-forest-labs/flux-1-schnell"}], "presets": {"fast": ["@cf/black-forest-labs/flux-1-schnell"], "balanced": ["@cf/black-forest-labs/flux-2-klein-9b"], "best": ["@cf/black-forest-labs/flux-2-dev"]}},
  {"id": "GR7", "label": "Ads and social cards with words", "steps": [{"kind": "draw", "default": "@cf/leonardo/lucid-origin", "alternatives": ["@cf/leonardo/phoenix-1.0"], "fallback": "@cf/black-forest-labs/flux-1-schnell", "fallbackNote": "schnell, with a warning that its lettering is unreliable"}], "presets": {"fast": ["@cf/leonardo/phoenix-1.0"], "balanced": ["@cf/leonardo/lucid-origin"], "best": ["@cf/leonardo/lucid-origin"]}},
  {"id": "GR8", "label": "Prospect voice notes: the script", "steps": [{"kind": "voice_turn", "default": "@cf/daily-co/phonellm-mini-alpha-2", "alternatives": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}], "presets": {"fast": ["@cf/daily-co/phonellm-mini-alpha-2"], "balanced": ["@cf/daily-co/phonellm-mini-alpha-2"], "best": ["@cf/zai-org/glm-4.7-flash"]}},
  {"id": "GR9", "label": "Prospect voice notes: the voice (Opus in Ogg; disclosed as AI)", "steps": [{"kind": "speak", "default": "@cf/deepgram/aura-2-en", "alternatives": ["@cf/deepgram/aura-2-es", "@cf/deepgram/aura-1"], "fallbackNote": "none (the press is hidden)"}], "presets": {"fast": ["@cf/myshell-ai/melotts"], "balanced": ["@cf/deepgram/aura-1"], "best": ["@cf/deepgram/aura-2-en", "@cf/deepgram/aura-2-es"]}},
  {"id": "GR10", "label": "Follow-ups and suggested replies", "steps": [{"kind": "write", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}], "presets": {"fast": ["@cf/meta/llama-3.2-3b-instruct"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}},
  {"id": "GR11", "label": "Reply triage", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-flash", "fixed": true}]},
  {"id": "GR12", "label": "Publish: drafting, alt text and screen (`routes/publish.ts:200`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}, {"kind": "screen", "default": "@cf/meta/llama-4-scout-17b-16e-instruct", "fixed": true}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "GR13", "label": "Market expansion: localise copy", "steps": [{"kind": "write", "default": "@cf/mistralai/mistral-small-3.1-24b-instruct", "alternatives": ["@cf/aisingapore/gemma-sea-lion-v4-27b-it", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/mistralai/mistral-small-3.1-24b-instruct"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/aisingapore/gemma-sea-lion-v4-27b-it"]}},
  {"id": "GR14", "label": "Market expansion: literal translation", "steps": [{"kind": "translate", "default": "@cf/meta/m2m100-1.2b", "alternatives": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}], "presets": {"fast": ["@cf/meta/m2m100-1.2b"], "balanced": ["@cf/meta/m2m100-1.2b"], "best": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}},
  {"id": "GR15", "label": "Market expansion: voice", "steps": [{"kind": "speak", "default": "@cf/deepgram/aura-2-es", "alternatives": ["@cf/myshell-ai/melotts"], "fallback": "@cf/myshell-ai/melotts"}], "presets": {"fast": ["@cf/myshell-ai/melotts"], "balanced": ["@cf/deepgram/aura-2-es"], "best": ["@cf/deepgram/aura-2-es"]}},
  {"id": "GR16", "label": "Revenue and traction narrative", "steps": [{"kind": "numbers", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/ibm-granite/granite-4.0-h-micro", "@cf/qwen/qwen3-30b-a3b-fp8"]}], "presets": {"fast": ["@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "GR17", "label": "Partner network matching", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/baai/bge-large-en-v1.5"]}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/zai-org/glm-4.7-flash"]}},
  {"id": "NE1", "label": "41 match rows: introductions, best fit, co-founder, advisors (`routes/networkfx.ts:93`, `services/matchingVectors.ts`)", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/baai/bge-small-en-v1.5"]}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "write", "default": "@cf/meta/llama-3.2-3b-instruct", "alternatives": ["@cf/zai-org/glm-4.7-flash", "@cf/ibm-granite/granite-4.0-h-micro"]}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/zai-org/glm-4.7-flash"]}},
  {"id": "NE2", "label": "Re-engagement, intro email, relationships (`research.ts:3412,3450,1513`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "NE3", "label": "Directory and global search (`routes/search.ts:139`, `services/vectorize.ts:231`)", "steps": [{"kind": "retrieve_index", "default": "@cf/baai/bge-base-en-v1.5", "fixed": true}]},
  {"id": "RE1", "label": "Ask the library (`research.ts:694` → `:756`)", "steps": [{"kind": "retrieve_index", "default": "@cf/baai/bge-base-en-v1.5", "fixed": true}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "research", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/moonshotai/kimi-k2.6", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/moonshotai/kimi-k2.6", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "RE2", "label": "Add to the library and re-index (`services/queueWorker.ts:441`)", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it"}, {"kind": "retrieve_index", "default": "@cf/baai/bge-base-en-v1.5", "fixed": true}]},
  {"id": "RE3", "label": "Drafts and company analysis (`research.ts:1356-1488`, `competitorAnalysis.ts:184`)", "steps": [{"kind": "research", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/moonshotai/kimi-k2.6", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/moonshotai/kimi-k2.6"]}},
  {"id": "RE4", "label": "Multilingual and Japanese documents", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/pfnet/plamo-embedding-1b", "@cf/qwen/qwen3-embedding-0.6b"]}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5"], "balanced": ["@cf/baai/bge-m3"], "best": ["@cf/qwen/qwen3-embedding-0.6b", "@cf/pfnet/plamo-embedding-1b"]}},
  {"id": "RE5", "label": "Charts and figures inside documents", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it", "alternatives": ["@cf/moondream/moondream3.1-9B-A2B", "@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash"]}], "presets": {"fast": ["@cf/meta/llama-3.2-11b-vision-instruct", "@cf/moondream/moondream3.1-9B-A2B"], "balanced": ["@cf/google/gemma-4-26b-a4b-it"], "best": ["@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash"]}},
  {"id": "RE6", "label": "Geographies (multi row)", "steps": [{"kind": "write", "default": "@cf/mistralai/mistral-small-3.1-24b-instruct", "alternatives": ["@cf/aisingapore/gemma-sea-lion-v4-27b-it"]}, {"kind": "translate", "default": "@cf/meta/m2m100-1.2b", "alternatives": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/mistralai/mistral-small-3.1-24b-instruct"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/aisingapore/gemma-sea-lion-v4-27b-it"]}},
  {"id": "RE7", "label": "Auto-tag uploaded images", "steps": [{"kind": "image_tags", "default": "@cf/microsoft/resnet-50", "fixed": true}]},
  {"id": "CA1", "label": "Plan my week (`routes/calendar.ts`)", "steps": [{"kind": "plan", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-20b", "@cf/openai/gpt-oss-120b"]}], "presets": {"fast": ["@cf/qwen/qwen3-30b-a3b-fp8"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/openai/gpt-oss-120b"]}},
  {"id": "CA2", "label": "Meeting prep brief", "steps": [{"kind": "synth", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/zai-org/glm-4.7-flash", "@cf/mistralai/mistral-small-3.1-24b-instruct"]}], "presets": {"fast": ["@cf/meta/llama-3.2-3b-instruct"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "CA3", "label": "Classify an imported event", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-flash", "fixed": true}]},
  {"id": "CA4", "label": "Compliance deadlines from documents", "steps": [{"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-flash-0731"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "CA5", "label": "Meeting notes from a calendar call", "steps": [{"kind": "listen_file", "default": "@cf/deepgram/nova-3", "alternatives": ["@cf/openai/whisper-large-v3-turbo"], "fallback": "@cf/openai/whisper-large-v3-turbo"}, {"kind": "synth", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}], "presets": {"fast": ["@cf/openai/whisper-large-v3-turbo"], "balanced": ["@cf/deepgram/nova-3"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "EV1", "label": "Description and agenda, for admins and members (`fields.ts:93-95`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "EV2", "label": "Event cover, illustrative (`routes/events.ts:410`, `frontend/src/pages/events/EventEditorPage.jsx:235`)", "steps": [{"kind": "draw", "default": "@cf/black-forest-labs/flux-2-klein-9b", "alternatives": ["@cf/black-forest-labs/flux-1-schnell", "@cf/leonardo/phoenix-1.0", "@cf/black-forest-labs/flux-2-klein-4b", "@cf/black-forest-labs/flux-2-dev"], "fallback": "@cf/black-forest-labs/flux-1-schnell"}], "presets": {"fast": ["@cf/black-forest-labs/flux-1-schnell"], "balanced": ["@cf/black-forest-labs/flux-2-klein-9b"], "best": ["@cf/black-forest-labs/flux-2-dev"]}},
  {"id": "EV3", "label": "Event cover with the title lettered", "steps": [{"kind": "draw", "default": "@cf/leonardo/lucid-origin", "alternatives": ["@cf/leonardo/phoenix-1.0"], "fallbackNote": "none (the press is hidden)"}], "presets": {"fast": ["@cf/leonardo/phoenix-1.0"], "balanced": ["@cf/leonardo/lucid-origin"], "best": ["@cf/leonardo/lucid-origin"]}},
  {"id": "EV4", "label": "My events recommendations (`events.ts:436`)", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/baai/bge-small-en-v1.5"], "fallbackNote": "rules"}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/zai-org/glm-4.7-flash"]}},
  {"id": "EV5", "label": "\"Why this?\" and \"What you'll get from this\"", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.2-3b-instruct", "alternatives": ["@cf/zai-org/glm-4.7-flash", "@cf/ibm-granite/granite-4.0-h-micro", "@cf/meta/llama-3.2-1b-instruct"]}], "presets": {"fast": ["@cf/meta/llama-3.2-1b-instruct"], "balanced": ["@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/zai-org/glm-4.7-flash"]}},
  {"id": "EV6", "label": "Suggested audience to invite", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/baai/bge-large-en-v1.5"]}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/zai-org/glm-4.7-flash"]}},
  {"id": "EV7", "label": "Translate an event", "steps": [{"kind": "translate", "default": "@cf/meta/m2m100-1.2b", "alternatives": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}], "presets": {"fast": ["@cf/meta/m2m100-1.2b"], "balanced": ["@cf/meta/m2m100-1.2b"], "best": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}},
  {"id": "EV8", "label": "After-event notes", "steps": [{"kind": "listen_file", "default": "@cf/openai/whisper-large-v3-turbo", "alternatives": ["@cf/deepgram/nova-3"]}, {"kind": "synth", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}], "presets": {"fast": ["@cf/meta/llama-3.2-3b-instruct"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "AR1", "label": "Outline, section, rewrite, headlines, SEO, newsletter summary (#3695)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash", "@cf/aisingapore/gemma-sea-lion-v4-27b-it"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "AR2", "label": "Continue, and long sections", "steps": [{"kind": "write", "default": "@cf/mistralai/mistral-small-3.1-24b-instruct", "alternatives": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/mistralai/mistral-small-3.1-24b-instruct"], "best": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}},
  {"id": "AR3", "label": "Check facts and sources", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3"}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/moonshotai/kimi-k2.6", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/moonshotai/kimi-k2.6", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "AR4", "label": "Hero and inline images (4 variants, aspect, style; `services/articleCovers.ts` today)", "steps": [{"kind": "draw", "default": "@cf/black-forest-labs/flux-2-klein-9b", "alternatives": ["@cf/black-forest-labs/flux-1-schnell", "@cf/black-forest-labs/flux-2-dev", "@cf/leonardo/lucid-origin"], "fallback": "@cf/black-forest-labs/flux-1-schnell"}], "presets": {"fast": ["@cf/black-forest-labs/flux-1-schnell"], "balanced": ["@cf/black-forest-labs/flux-2-klein-9b"], "best": ["@cf/black-forest-labs/flux-2-dev"]}},
  {"id": "AR5", "label": "Read the article aloud", "steps": [{"kind": "speak", "default": "@cf/deepgram/aura-2-en", "alternatives": ["@cf/deepgram/aura-1", "@cf/deepgram/aura-2-es", "@cf/myshell-ai/melotts"], "fallback": "@cf/myshell-ai/melotts"}], "presets": {"fast": ["@cf/myshell-ai/melotts"], "balanced": ["@cf/deepgram/aura-1"], "best": ["@cf/deepgram/aura-2-en", "@cf/deepgram/aura-2-es"]}},
  {"id": "AR6", "label": "Translate", "steps": [{"kind": "translate", "default": "@cf/meta/m2m100-1.2b", "alternatives": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}], "presets": {"fast": ["@cf/meta/m2m100-1.2b"], "balanced": ["@cf/meta/m2m100-1.2b"], "best": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}},
  {"id": "AR7", "label": "Related articles", "steps": [{"kind": "retrieve_index", "default": "@cf/baai/bge-base-en-v1.5", "fixed": true}]},
  {"id": "LE1", "label": "Lesson and webinar transcripts and captions (`routes/learning_video.ts`)", "steps": [{"kind": "listen_file", "default": "@cf/openai/whisper-large-v3-turbo", "alternatives": ["@cf/deepgram/nova-3", "@cf/openai/whisper"]}], "presets": {"fast": ["@cf/openai/whisper"], "balanced": ["@cf/openai/whisper-large-v3-turbo"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "LE2", "label": "Live webinar captions", "steps": [{"kind": "listen_live", "default": "@cf/deepgram/nova-3"}], "presets": {"fast": ["@cf/deepgram/nova-3"], "balanced": ["@cf/deepgram/nova-3"], "best": ["@cf/deepgram/nova-3"]}},
  {"id": "LE3", "label": "Caption translation", "steps": [{"kind": "translate", "default": "@cf/meta/m2m100-1.2b", "alternatives": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}], "presets": {"fast": ["@cf/meta/m2m100-1.2b"], "balanced": ["@cf/meta/m2m100-1.2b"], "best": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}},
  {"id": "LE4", "label": "Search across transcripts", "steps": [{"kind": "retrieve_index", "default": "@cf/baai/bge-base-en-v1.5", "fixed": true}]},
  {"id": "LE5", "label": "Chapters, summaries, key points", "steps": [{"kind": "synth", "default": "@cf/mistralai/mistral-small-3.1-24b-instruct", "alternatives": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/meta/llama-3.2-3b-instruct"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "LE6", "label": "Exercise feedback (charged per press)", "steps": [{"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/qwen/qwq-32b", "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", "@cf/openai/gpt-oss-20b"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/qwen/qwq-32b"]}},
  {"id": "LE7", "label": "Exam questions and answer explanations", "steps": [{"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/openai/gpt-oss-20b", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", "@cf/qwen/qwq-32b"]}], "presets": {"fast": ["@cf/qwen/qwen3-30b-a3b-fp8"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "LE8", "label": "Course cover (`frontend/src/pages/learning/StudioCourseBuilder.jsx:55`)", "steps": [{"kind": "draw", "default": "@cf/black-forest-labs/flux-2-klein-4b", "alternatives": ["@cf/black-forest-labs/flux-1-schnell", "@cf/black-forest-labs/flux-2-klein-9b", "@cf/leonardo/lucid-origin"], "fallback": "@cf/black-forest-labs/flux-1-schnell"}], "presets": {"fast": ["@cf/black-forest-labs/flux-1-schnell"], "balanced": ["@cf/black-forest-labs/flux-2-klein-4b"], "best": ["@cf/black-forest-labs/flux-2-klein-9b"]}},
  {"id": "LE9", "label": "Video moderation", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-omni", "fixed": true}]},
  {"id": "LE10", "label": "Recommended for you", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/baai/bge-small-en-v1.5"]}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "write", "default": "@cf/meta/llama-3.2-3b-instruct", "alternatives": ["@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/zai-org/glm-4.7-flash"]}},
  {"id": "LE11", "label": "Lesson narration", "steps": [{"kind": "speak", "default": "@cf/deepgram/aura-2-en", "alternatives": ["@cf/deepgram/aura-1", "@cf/deepgram/aura-2-es", "@cf/myshell-ai/melotts"], "fallback": "@cf/myshell-ai/melotts"}], "presets": {"fast": ["@cf/myshell-ai/melotts"], "balanced": ["@cf/deepgram/aura-1"], "best": ["@cf/deepgram/aura-2-en", "@cf/deepgram/aura-2-es"]}},
  {"id": "EM1", "label": "Draft from ticked records (`services/mail/drafts.ts:202`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/zai-org/glm-4.7-flash"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "EM2", "label": "Inbox triage and priority", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-flash", "fixed": true}]},
  {"id": "EM3", "label": "Thread summary", "steps": [{"kind": "synth", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-3.2-3b-instruct"]}], "presets": {"fast": ["@cf/meta/llama-3.2-3b-instruct"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}},
  {"id": "EM4", "label": "Suggested reply", "steps": [{"kind": "write", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}], "presets": {"fast": ["@cf/meta/llama-3.2-3b-instruct"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}},
  {"id": "EM5", "label": "Read attachments", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it", "fixed": true}]},
  {"id": "EM6", "label": "Translate a thread", "steps": [{"kind": "translate", "default": "@cf/meta/m2m100-1.2b", "alternatives": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}], "presets": {"fast": ["@cf/meta/m2m100-1.2b"], "balanced": ["@cf/meta/m2m100-1.2b"], "best": ["@cf/ai4bharat/indictrans2-en-indic-1B"]}},
  {"id": "EM7", "label": "Sentiment", "steps": [{"kind": "sentiment", "default": "@cf/huggingface/distilbert-sst-2-int8", "alternatives": ["@cf/cloudflare/clef-flash"]}], "presets": {"fast": ["@cf/huggingface/distilbert-sst-2-int8"], "balanced": ["@cf/huggingface/distilbert-sst-2-int8"], "best": ["@cf/cloudflare/clef"]}},
  {"id": "AG1", "label": "An agent's turn with tools (#3727)", "steps": [{"kind": "agent", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-120b", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/moonshotai/kimi-k2.6"]}], "presets": {"fast": ["@cf/qwen/qwen3-30b-a3b-fp8"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "AG2", "label": "\"Should I take this action?\"", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-flash"}, {"kind": "guard", "default": "@cf/meta/llama-guard-3-8b", "fixed": true}]},
  {"id": "AG3", "label": "Agent memory per company", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "fixed": true}]},
  {"id": "AG4", "label": "CFO: runway note and scenarios", "steps": [{"kind": "numbers", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/nvidia/nemotron-3-120b-a12b"]}], "presets": {"fast": ["@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "AG5", "label": "CTO: code and technical plans", "steps": [{"kind": "code", "default": "@cf/qwen/qwen2.5-coder-32b-instruct", "alternatives": ["@cf/zai-org/glm-5.3", "@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.3-flash", "@cf/qwen/qwen3.8-27b"]}], "presets": {"fast": ["@cf/qwen/qwen2.5-coder-32b-instruct"], "balanced": ["@cf/zai-org/glm-5.3-flash", "@cf/qwen/qwen2.5-coder-32b-instruct"], "best": ["@cf/moonshotai/kimi-k2.7-code", "@cf/qwen/qwen3.8-27b"]}},
  {"id": "AG6", "label": "CMO: posts and ads; images", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"}, {"kind": "draw", "default": "@cf/black-forest-labs/flux-2-klein-9b", "alternatives": ["@cf/leonardo/lucid-origin"], "fallback": "@cf/black-forest-labs/flux-1-schnell"}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "AG7", "label": "Counsel (always escalates)", "steps": [{"kind": "legal", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "AG8", "label": "Research analyst", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3"}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}, {"kind": "research", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/nvidia/nemotron-3-120b-a12b", "@cf/moonshotai/kimi-k2.6"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/moonshotai/kimi-k2.6", "@cf/nvidia/nemotron-3-120b-a12b"]}},
  {"id": "AG9", "label": "Head of People: hiring match", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/baai/bge-large-en-v1.5"]}, {"kind": "rank", "default": "@cf/baai/bge-reranker-base", "fixed": true}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5", "@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/baai/bge-m3", "@cf/meta/llama-3.2-3b-instruct"], "best": ["@cf/baai/bge-large-en-v1.5", "@cf/qwen/qwen3-embedding-0.6b", "@cf/zai-org/glm-4.7-flash"]}},
  {"id": "AG10", "label": "Evaluation board: score accepted proposals", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef", "fixed": true}]},
  {"id": "AG11", "label": "An agent's voice channel", "steps": [{"kind": "listen_live", "default": "@cf/deepgram/flux", "alternatives": ["@cf/deepgram/nova-3"]}, {"kind": "voice_turn", "default": "@cf/daily-co/phonellm-mini-alpha-2", "alternatives": ["@cf/zai-org/glm-4.7-flash"]}, {"kind": "speak", "default": "@cf/deepgram/aura-2-en", "alternatives": ["@cf/deepgram/aura-1"], "fallback": "@cf/myshell-ai/melotts"}], "presets": {"fast": ["@cf/deepgram/aura-1"], "balanced": ["@cf/deepgram/aura-2-en"], "best": ["@cf/deepgram/aura-2-en"]}},
  {"id": "AD1", "label": "Publication summary (`services/publications.ts:120`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "alternatives": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], "best": ["@cf/mistralai/mistral-small-3.1-24b-instruct"]}},
  {"id": "AD2", "label": "Insights narrative", "steps": [{"kind": "numbers", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/ibm-granite/granite-4.0-h-micro"]}], "presets": {"fast": ["@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "AD3", "label": "Monitoring summary (`routes/monitoring.ts:235`, a system job)", "steps": [{"kind": "synth", "default": "@cf/meta/llama-3.1-8b-instruct-fp8", "fixed": true}]},
  {"id": "AD4", "label": "Platform code rows: Platform, Integration keys, GitHub sync, Monitoring", "steps": [{"kind": "code", "default": "@cf/qwen/qwen2.5-coder-32b-instruct", "alternatives": ["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-5.3", "@cf/moonshotai/kimi-k2.7-code"]}], "presets": {"fast": ["@cf/qwen/qwen2.5-coder-32b-instruct"], "balanced": ["@cf/zai-org/glm-5.3-flash", "@cf/qwen/qwen2.5-coder-32b-instruct"], "best": ["@cf/moonshotai/kimi-k2.7-code", "@cf/qwen/qwen3.8-27b"]}},
  {"id": "AD5", "label": "X and Telegram media: screen and alt text (`routes/admin_x.ts:746,805`, `routes/admin_telegram.ts`)", "steps": [{"kind": "screen", "default": "@cf/meta/llama-4-scout-17b-16e-instruct", "fixed": true}]},
  {"id": "AD6", "label": "Approvals: identity checks, entity profiles, due diligence", "steps": [{"kind": "read_images", "default": "@cf/google/gemma-4-26b-a4b-it", "alternatives": ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/moondream/moondream3.1-9B-A2B", "@cf/qwen/qwen3.8-27b"]}, {"kind": "decide", "default": "@cf/cloudflare/clef"}], "presets": {"fast": ["@cf/meta/llama-3.2-11b-vision-instruct", "@cf/moondream/moondream3.1-9B-A2B"], "balanced": ["@cf/google/gemma-4-26b-a4b-it"], "best": ["@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-5.3-flash"]}},
  {"id": "AD7", "label": "Approvals: LP and Spin-Out applications", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef", "fixed": true}, {"kind": "reason", "default": "@cf/openai/gpt-oss-120b", "alternatives": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}], "presets": {"fast": ["@cf/openai/gpt-oss-20b"], "balanced": ["@cf/openai/gpt-oss-120b"], "best": ["@cf/deepseek-ai/deepseek-v4-pro-0813"]}},
  {"id": "AD8", "label": "Support tickets: triage, then a reply draft", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-flash", "fixed": true}, {"kind": "write", "default": "@cf/zai-org/glm-4.7-flash", "alternatives": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}], "presets": {"fast": ["@cf/zai-org/glm-4.7-flash"], "balanced": ["@cf/zai-org/glm-4.7-flash"], "best": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]}},
  {"id": "MO1", "label": "The text guard on every run (D763)", "steps": [{"kind": "guard", "default": "@cf/meta/llama-guard-3-8b", "fixed": true}]},
  {"id": "MO2", "label": "Image screen on every upload and every generated image; consent prompt when a face is found", "steps": [{"kind": "screen", "default": "@cf/meta/llama-4-scout-17b-16e-instruct", "alternatives": ["@cf/moondream/moondream3.1-9B-A2B"], "fixed": true}]},
  {"id": "MO3", "label": "Spin-Out moderation queue triage (`routes/spinout_moderation.ts`)", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef", "alternatives": ["@cf/cloudflare/clef-flash"]}], "presets": {"fast": ["@cf/cloudflare/clef-flash"], "balanced": ["@cf/cloudflare/clef"], "best": ["@cf/cloudflare/clef"]}},
  {"id": "MO4", "label": "Community and message abuse", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-flash"}, {"kind": "guard", "default": "@cf/meta/llama-guard-3-8b", "fixed": true}]},
  {"id": "MO5", "label": "Audio and video moderation of calls", "steps": [{"kind": "decide", "default": "@cf/cloudflare/clef-omni", "fixed": true}]},
  {"id": "MI1", "label": "Paraphrase snippets to de-identify them (`services/market_intel/extractors/index.ts:151`)", "steps": [{"kind": "write", "default": "@cf/meta/llama-3.1-8b-instruct-fp8", "alternatives": ["@cf/ibm-granite/granite-4.0-h-micro"]}], "presets": {"fast": ["@cf/ibm-granite/granite-4.0-h-micro"], "balanced": ["@cf/meta/llama-3.1-8b-instruct-fp8"], "best": ["@cf/meta/llama-3.1-8b-instruct-fp8"]}},
  {"id": "MI2", "label": "Thesis and discovery embeddings (`extractors/thesis_embedding.ts:22`)", "steps": [{"kind": "retrieve_index", "default": "@cf/baai/bge-base-en-v1.5", "fixed": true}]},
  {"id": "MI3", "label": "Sentiment dimension (`routes/market_intel.ts:146`)", "steps": [{"kind": "sentiment", "default": "@cf/huggingface/distilbert-sst-2-int8", "alternatives": ["@cf/cloudflare/clef-flash"]}], "presets": {"fast": ["@cf/huggingface/distilbert-sst-2-int8"], "balanced": ["@cf/huggingface/distilbert-sst-2-int8"], "best": ["@cf/cloudflare/clef"]}},
  {"id": "MI4", "label": "News and signal clustering", "steps": [{"kind": "retrieve", "default": "@cf/baai/bge-m3", "alternatives": ["@cf/qwen/qwen3-embedding-0.6b"]}], "presets": {"fast": ["@cf/baai/bge-small-en-v1.5"], "balanced": ["@cf/baai/bge-m3"], "best": ["@cf/qwen/qwen3-embedding-0.6b", "@cf/pfnet/plamo-embedding-1b"]}},
]);

/** Each rail option (`railMatrix.json` `options`) to its job. A `page|option` key wins over the bare option key. Null: the option runs no model. */
export const OPTION_JOBS: Readonly<Record<string, string | null>> = Object.freeze({
  "ask:studio": "ST1",
  "explain:question": "ST4",
  "answer:interview": "ST3",
  "transcribe:voice-answer": "ST6",
  "draft:period-narrative": "AD2",
  "draft:terms": "IN11",
  "ask:library": "RE1",
  "draft:session-brief": "CA2",
  "draft:checkpoint-brief": "CA2",
  "analyze:competitors": "RE3",
  "rerun:analysis": "RE3",
  "refresh:sources": "RE3",
  "upload:document": "RE2",
  "draft:index-gaps": "RE3",
  "reindex:document": "RE2",
  "draft:build/plan": "BU1",
  "draft:build/this-week": "BU2",
  "draft:build/retro": "BU2",
  "draft:build/kpi": "BU3",
  "draft:build/roadmap": "BU2",
  "draft:update": "RA12",
  "form:landing": "GR2",
  "draft:grow/customers": "GR2",
  "draft:taglines": "GR2",
  "draft:logo": "GR3",
  "form:palette": "GR2",
  "fill:feedback_theme": "GR1",
  "draft:grow/talent": "GR4",
  "draft:network/re-engagement": "NE2",
  "draft:network/intro-email": "NE2",
  "draft:network/introductions": "NE1",
  "draft:network/relationships": "NE2",
  "draft:raise/liquidity": "RA8",
  "draft:raise/capital": "RA8",
  "draft:raise/legal": "RA6",
  "draft:raise/pmf-explain": "RA6",
  "draft:raise/pmf-questions": "RA1",
  "draft:raise/data-room": "RA2",
  "draft:narrative-objection": "RA1",
  "draft:narrative-section": "RA1",
  "draft:raise/narrative-fix": "RA1",
  "draft:narrative-positioning": "RA1",
  "deck:build": "DK1",
  "deck:outline": "DK1",
  "deck:tone": "DK2",
  "deck:chart": "DK2",
  "deck:expand": "DK2",
  "deck:rewrite": "DK2",
  "deck:shorten": "DK2",
  "deck:table": "DK2",
  "deck:timeline": "DK2",
  "deck:translate": "DK2",
  "form:deck": "DK3",
  "form:deck-template": "DK3",
  "deck:image": "DK4",
  "review:deck-file": "DK7",
  "review:deck-again": "DK8",
  "review:deck-text": "DK8",
  "review:deck-version": "DK8",
  "draft:raise/use-of-funds-check": "RA8",
  "draft:raise/use-of-funds-runway": "RA8",
  "form:uof-milestone-wording": "RA1",
  "ask:research": "RE1",
  "draft:research/ask": "RE3",
  "extract:candidate": "RE3",
  "analyse:competitors": "RE3",
  "extract:site": "RE3",
  "analyse:again": "RE3",
  "analyse:sources": "RE3",
  "draft:research/funds": "RE3",
  "draft:research/library": "RE3",
  "upload:reindex": "RE2",
  "ask:transcript": "VA6",
  "transcribe:interview": "VA1",
  "transcribe:session": "VA1",
  "structure:transcript": "VA5",
  "summarise:session": "VA5",
  "transcribe:recording": "VA1",
  "fill:hypothesis": "VA15",
  "fill:pain_tag": "VA11",
  "draft:closing-cover-note": "IN1",
  "draft:ic-memo": "IN1",
  "draft:lp-reminder": "RA10",
  "draft:multiple-narrative": "IN5",
  "draft:updates-read": "IN13",
  "draft:support-summary": "IN11",
  "ask:evidence": "RE1",
  "ask:question": "RE1",
  "draft:thin-evidence": "IN1",
  "draft:capacity-findings": "CA1",
  "draft:chases": "IN11",
  "draft:board-read": "CA1",
  "draft:weekly-reports": "IN11",
  "draft:operating-brief": "CA1",
  "suggest:paths": "NE1",
  "draft:single-contact-exposure": "NE2",
  "draft:orphan-reassignment": "NE2",
  "draft:pass-reasons": "NE1",
  "draft:catalog-read": "IN11",
  "draft:expiry-consequences": "IN3",
  "draft:consent-requests": "IN11",
  "draft:attribution-read": "GR16",
  "draft:quarter-narrative": "GR16",
  "draft:proposal": "IN11",
  "draft:counter": "IN3",
  "draft:win-loss-read": "IN13",
  "draft:publication-summary": "AD1",
  "sessions:block": null,
  "Operating Partner · Delivery · Health|draft:renewal-risk": "IN13",
  "Operating Partner · Pipeline · Retainers|draft:renewal-risk": "GR16"
});

export type UseCaseKind = keyof typeof USE_CASE_KINDS;

/** §4.2 fix 11 and §1 rows 14–15: never on any list. */
export const HIDDEN_MODELS: readonly string[] = Object.freeze(['@cf/zai-org/glm-5.2', '@cf/meta/llama-3.1-70b-instruct-fp8-fast']);

/** §1.5, plus the catalogue's later beta `clairic`: current, but never offered (answer B (c)). */
export const NOT_OFFERED: readonly string[] = Object.freeze([
  '@cf/google/embeddinggemma-300m', '@cf/meta/llama-3.1-8b-instruct-fast', '@cf/lykon/dreamshaper-8-lcm', '@cf/llava-hf/llava-1.5-7b-hf',
  '@cf/facebook/detr-resnet-50', '@cf/stabilityai/stable-diffusion-xl-base-1.0', '@cf/bytedance/stable-diffusion-xl-lightning',
  '@cf/runwayml/stable-diffusion-v1-5-img2img', '@cf/runwayml/stable-diffusion-v1-5-inpainting', '@cf/openai/whisper-tiny-en',
  '@cf/google/gemma-2b-it-lora', '@cf/google/gemma-7b-it-lora', '@cf/meta-llama/llama-2-7b-chat-hf-lora', '@cf/mistral/mistral-7b-instruct-v0.2-lora',
  '@cf/cloudflare/clairic',
]);

export const LOCK_LABEL: Readonly<Record<Lock, string>> = Object.freeze({ lowest_paid: 'Lowest paid plan', top_paid: 'Top paid plan' });

/** The old rail kinds (`aiRouter.RAIL_KINDS`) and the option kind `image`, each as the use-case kind it lists. */
export const RAIL_KIND_USE: Readonly<Record<string, UseCaseKind>> = Object.freeze({
  chat: 'chat', synth: 'synth', speech: 'listen_file', research: 'research', reason: 'reason', vision: 'read_images', code: 'code',
  numbers: 'numbers', write: 'write', match: 'retrieve', plan: 'plan', legal: 'legal', multi: 'translate', search: 'retrieve_index',
  image: 'draw', draw: 'draw', edit_image: 'edit_image', voice_turn: 'voice_turn', agent: 'agent', decide: 'decide',
  sentiment: 'sentiment', translate: 'translate',
});

/**
 * Jobs a page runs that no rail option names yet (§2's "where" for each). A
 * page's selectors are its options' jobs and these.
 */
export const PAGE_JOBS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'Founder · Studio': ['ST1', 'ST2', 'ST3', 'ST4', 'ST6', 'ST7', 'ST8', 'ST9', 'ST10'],
  'Founder · Validate · Problem discovery': ['VA11'],
  'Founder · Validate · Customer research': ['VA1', 'VA2', 'VA5', 'VA6', 'VA10'],
  'Founder · Validate · Ideal customer profile': ['VA12'],
  'Founder · Validate · Market intelligence': ['VA13'],
  'Founder · Validate · Demand and urgency signals': ['VA14', 'VA16', 'VA17'],
  'Founder · Validate · Experiments and evidence': ['VA15'],
  'Founder · Validate · Verdict': ['VA18'],
  'Founder · Build': ['BU1'],
  'Founder · Build · Solution design': ['BU4', 'BU6', 'BU7'],
  'Founder · Build · Prototype / MVP': ['BU4', 'BU5', 'BU6'],
  'Founder · Build · Product roadmap': ['BU2'],
  'Founder · Build · Operating systems': ['BU2', 'BU3'],
  'Founder · Build · Company creation': ['BU8'],
  'Founder · Raise · Investor narrative': ['RA1'],
  'Founder · Raise · Pitch deck': ['DK1', 'DK2', 'DK3', 'DK4', 'DK5', 'DK6', 'DK7', 'DK8', 'DK9', 'DK10', 'DK11', 'DK12', 'DK13'],
  'Founder · Raise · Data room': ['RA2', 'RA3', 'RA4', 'RA5'],
  'Founder · Raise · Fundraising readiness': ['RA6'],
  'Founder · Raise · Cap table': ['RA7', 'RA8'],
  'Founder · Raise · Use of funds': ['RA8'],
  'Founder · Raise · Capital relationships': ['RA9', 'RA10', 'RA11'],
  'Founder · Grow · Product improvement': ['GR1'],
  'Founder · Grow · Distribution': ['GR2', 'GR3', 'GR5', 'GR6', 'GR7', 'GR8', 'GR9', 'GR10', 'GR12'],
  'Founder · Grow · Revenue and traction': ['GR16'],
  'Founder · Grow · Partner network': ['GR17'],
  'Founder · Grow · Market expansion': ['GR13', 'GR14', 'GR15'],
  'Founder · Network': ['NE1', 'NE2'],
  'Founder · Research': ['RE1', 'RE3'],
  'Founder · Research · Geographies': ['RE6'],
  'Founder · Research · Library': ['RE1', 'RE2'],
  'Advisor · Practice · Sessions': ['IN12', 'IN13'],
});

/**
 * The revision's ask 4: a job for each element group of the deck grid
 * (`frontend/src/pages/raise/pitch/deckV2Model.js` `ELEMENT_GROUPS`), and for
 * each element that runs a model, so #3754's `resolveElementModel` can route
 * one model per element. Null: the element is placed with no model. `stock`
 * is the eighth group the final canvas names; its picker row is not on main.
 */
export const ELEMENT_GROUP_JOBS: Readonly<Record<string, { job: string; elements: Readonly<Record<string, string | null>> }>> = Object.freeze({
  text: { job: 'DK2', elements: { title: 'DK2', kicker: 'DK2', body: 'DK2', bullets: 'DK2', callout: 'DK2', caption: 'DK2', quote_founder: null, team_bios: 'DK2', speaker_notes: 'DK2' } },
  images: { job: 'DK4', elements: { photo: 'DK4', illustration: 'DK4', upload: 'DK6', brand_assets: null, edit_vary: 'DK5', remove_bg: 'DK5', upscale: 'DK5' } },
  graphics: { job: 'DK4', elements: { icons: null, shapes: null, textures: 'DK4', logo_wall: null } },
  data: { job: 'DK2', elements: { chart: 'DK2', metric: null, table: 'DK2', timeline: 'DK2', market_size: 'VA13', projections: 'RA8', competition: 'VA13', typed_table: 'DK2', market_chart: 'VA13', projection_chart: 'RA8', positioning: 'DK2' } },
  diagrams: { job: 'DK2', elements: { flow: 'DK2', cycle: 'DK2', matrix: 'DK2', funnel: 'DK2', hierarchy: 'DK2', hub: 'DK2' } },
  venture: { job: 'DK2', elements: { team_grid: null, use_of_funds: 'RA8', round_terms: 'RA8', interview_quote: 'VA5', cap_table: 'RA8' } },
  media: { job: 'DK11', elements: { video: null, audio: null, link: null, recorded_video: 'DK11', button: null, embeds: null } },
  stock: { job: 'DK6', elements: {} },
});

const BY_ID = new Map(MODEL_JOBS.map((j) => [j.id, j]));

export function jobById(id: string | null | undefined): ModelJob | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/** An option's job: its `page|option` key first, then the bare option key. Null when it runs no model or is not listed. */
export function jobForOption(pageKey: string, optionKey: string | null | undefined): ModelJob | null {
  if (!optionKey) return null;
  const key = `${pageKey}|${optionKey}`;
  const id = Object.prototype.hasOwnProperty.call(OPTION_JOBS, key) ? OPTION_JOBS[key] : OPTION_JOBS[optionKey];
  return jobById(id ?? null);
}

const offerable = (id: string) => !HIDDEN_MODELS.includes(id) && !NOT_OFFERED.includes(id);

export function kindList(kind: UseCaseKind): readonly string[] {
  return USE_CASE_KINDS[kind].list.filter(offerable);
}

/** The step a job's selector of `kind` reads: its first selectable step of that kind. */
export function stepOf(job: ModelJob, kind: UseCaseKind): JobStep | null {
  return job.steps.find((s) => s.kind === kind && !s.fixed) ?? null;
}

/**
 * The job's three suggestions for one step: its Default, its first
 * Alternative, and Deeper, the Best preset's first model of the step's kind
 * that is neither (else the next Alternative). Never more than three.
 */
export function suggestionsFor(job: ModelJob, step: JobStep): Array<{ id: string; role: 'Default' | 'Alternative' | 'Deeper' }> {
  const list = kindList(step.kind);
  const alts = (step.alternatives ?? []).filter((id) => list.includes(id) && id !== step.default);
  const out: Array<{ id: string; role: 'Default' | 'Alternative' | 'Deeper' }> = [{ id: step.default, role: 'Default' }];
  if (alts[0]) out.push({ id: alts[0], role: 'Alternative' });
  const best = (job.presets?.best ?? []).find((id) => list.includes(id) && !out.some((o) => o.id === id));
  const deeper = best ?? alts.find((id) => !out.some((o) => o.id === id));
  if (deeper) out.push({ id: deeper, role: 'Deeper' });
  return out;
}

/** Everything else of the step's kind, under All models: the job's other Alternatives first, then the kind's list. */
export function moreFor(job: ModelJob | null, kind: UseCaseKind, shown: readonly string[]): string[] {
  const step = job ? stepOf(job, kind) : null;
  const order = [...(step?.alternatives ?? []), ...kindList(kind)];
  const out: string[] = [];
  for (const id of order) {
    if (!offerable(id) || !kindList(kind).includes(id) || shown.includes(id) || out.includes(id)) continue;
    if (!conditionMet(id, job, step)) continue;
    out.push(id);
  }
  return out;
}

/**
 * §2's kind table limits two models to a context: r1-distill to Learning
 * (LE jobs) and sea-lion to Southeast Asian locales, which the rail cannot
 * read, so it is listed only where a job names it as an Alternative.
 */
function conditionMet(id: string, job: ModelJob | null, step: JobStep | null): boolean {
  if (id === '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b') return !!job && job.id.startsWith('LE');
  if (id === '@cf/aisingapore/gemma-sea-lion-v4-27b-it') return !!step?.alternatives?.includes(id);
  return true;
}

export type Selector = {
  kind: UseCaseKind;
  label: string;
  jobs: string[];
  models: Array<{ id: string; role: 'Default' | 'Alternative' | 'Deeper' }>;
  more: string[];
};

/**
 * One selector per selectable kind the jobs use, in the order the jobs name
 * them. The first job of a kind supplies its three suggestions; the rest of
 * the kind's list is under `more`. Fixed steps make no selector.
 */
export function selectorsFor(jobIds: readonly string[]): Selector[] {
  const out: Selector[] = [];
  for (const id of jobIds) {
    const job = jobById(id);
    if (!job) continue;
    for (const step of job.steps) {
      if (step.fixed || !USE_CASE_KINDS[step.kind].selectable) continue;
      const have = out.find((s) => s.kind === step.kind);
      if (have) { if (!have.jobs.includes(job.id)) have.jobs.push(job.id); continue; }
      const models = suggestionsFor(job, step);
      out.push({ kind: step.kind, label: USE_CASE_KINDS[step.kind].label, jobs: [job.id], models, more: moreFor(job, step.kind, models.map((m) => m.id)) });
    }
  }
  return out;
}

/** A page's jobs: its options' jobs, in their order, then `PAGE_JOBS`. */
export function jobsOnPage(pageKey: string, optionKeys: readonly string[]): string[] {
  const ids: string[] = [];
  for (const o of optionKeys) { const j = jobForOption(pageKey, o); if (j && !ids.includes(j.id)) ids.push(j.id); }
  for (const id of PAGE_JOBS[pageKey] ?? []) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/** A model's plan lock, or null when every plan runs it. */
export function lockOf(id: string): { lock: Lock; label: string } | null {
  const lock = MODEL_LOCK[id];
  return lock ? { lock, label: LOCK_LABEL[lock] } : null;
}
