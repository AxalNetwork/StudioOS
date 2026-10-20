/**
 * What to SAY about a model, and which models All models lists.
 *
 * WHICH MODELS A PAGE RUNS IS THE WORKER'S (D769 PR 2, #2088; D764, #2089).
 * "Suggested for this page" and "On this page" come from
 * `GET /api/ai/rail?page=<key>[&option=<key>]`, the Worker's matrix
 * (`cloudflare-worker/src/services/ai/railMatrix.json`, generated from the
 * owner's canvas): each model's name, role word, line and price, the member's
 * pick, and the page's options. `railView` below shapes that answer for the
 * rail. The tables that used to decide it here (the canvas's kinds and
 * suggestions, the lines that held, each page's jobs) are retired: the matrix
 * holds the same canvas, read once, by the Worker that runs it.
 *
 * PRICES ARE NOT TYPED HERE. Each model's price comes with the Worker's answer
 * (D760's `cost` and `billed`), and `ui/railPrices.js` prints it.
 *
 * WHAT STAYS: each router model's name (`MODEL_COPY`), for a model the answer
 * does not name, and All models, the canvas's ten groups (`ALL_MODELS`, D720
 * §1) with each name's router id, or null where the router cannot run it yet.
 * ADDING A MODEL IS A ROUTER CHANGE FIRST (D698 decision 14, #1008): an id
 * with no place in `ROUTE` (`cloudflare-worker/src/services/aiRouter.ts`) is
 * null here, and `airail_d698.test.mjs` fails a router id with no name.
 */

/**
 * Per router model id: the name the rail draws where the Worker's answer
 * names none. Every model `ROUTE` can send work to has one, the guard and the
 * retired 8B included. Where the canvas names the model, the name is the
 * canvas's.
 */
export const MODEL_COPY = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { name: 'Llama 3.3 70B Fast' },
  '@cf/meta/llama-3.1-8b-instruct-fp8': { name: 'Llama 3.1 8B' },
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': { name: 'Llama 3.1 8B Fast' },
  '@cf/meta/llama-3.2-3b-instruct': { name: 'Llama 3.2 3B' },
  '@cf/qwen/qwen2.5-coder-32b-instruct': { name: 'Qwen2.5 Coder 32B' },
  '@cf/deepseek-ai/deepseek-v4-flash-0731': { name: 'DeepSeek V4 Flash' },
  '@cf/openai/whisper-large-v3-turbo': { name: 'Whisper Large v3 Turbo' },
  '@cf/openai/whisper': { name: 'Whisper' },
  '@cf/deepgram/nova-3': { name: 'Deepgram Nova-3' },
  '@cf/baai/bge-base-en-v1.5': { name: 'BGE Base EN v1.5' },
  '@cf/meta/llama-guard-3-8b': { name: 'Llama Guard 3 8B' },
  // D764 (#2089): the rail_<kind> tasks' models, by the canvas's names.
  '@cf/zai-org/glm-4.7-flash': { name: 'GLM-4.7 Flash' },
  '@cf/openai/gpt-oss-120b': { name: 'GPT-OSS 120B' },
  '@cf/openai/gpt-oss-20b': { name: 'GPT-OSS 20B' },
  '@cf/moonshotai/kimi-k2.6': { name: 'Kimi K2.6' },
  '@cf/moonshotai/kimi-k2.7-code': { name: 'Kimi K2.7 Code' },
  '@cf/deepseek-ai/deepseek-v4-pro-0813': { name: 'DeepSeek V4 Pro' },
  '@cf/qwen/qwq-32b': { name: 'QwQ 32B' },
  '@cf/google/gemma-4-26b-a4b-it': { name: 'Gemma 4 26B' },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { name: 'Llama 4 Scout' },
  // D766: Build › Brand's logo (`brand_logo`).
  '@cf/black-forest-labs/flux-1-schnell': { name: 'FLUX.1 Schnell' },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { name: 'Mistral Small 3.1 24B' },
  '@cf/ibm-granite/granite-4.0-h-micro': { name: 'Granite 4.0 Micro' },
};

/** The guard: listed under Safety, never picked. */
export const GUARD_MODEL = '@cf/meta/llama-guard-3-8b';

/**
 * D720 §1: All models, as the "AIRail · every page" canvas groups it
 * (`canvas.json`, `all_models`), in its order, ten groups with Safety last.
 * Each name carries its router id, or null where `ROUTE` cannot send it work
 * yet (D761, #2018, adds them as they land); `airail_d698.test.mjs` holds the
 * two lists equal, the retired 8B aside. The last two Conversation and
 * writing rows are router models the canvas does not name.
 */
const R = (name, id = null) => [name, id];
export const ALL_MODELS = [
  ['Conversation and writing', [
    R('GLM-4.7 Flash', '@cf/zai-org/glm-4.7-flash'), R('GLM-5.3 Flash'), R('Llama 3.3 70B Fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
    R('Mistral Small 3.1 24B', '@cf/mistralai/mistral-small-3.1-24b-instruct'), R('GPT-OSS 20B', '@cf/openai/gpt-oss-20b'), R('Qwen3 30B A3B'), R('Llama 3.1 8B', '@cf/meta/llama-3.1-8b-instruct-fp8'),
    R('Granite 4.0 Micro', '@cf/ibm-granite/granite-4.0-h-micro'), R('Llama 3.2 3B', '@cf/meta/llama-3.2-3b-instruct'), R('Llama 3.1 8B Fast', '@cf/meta/llama-3.1-8b-instruct-fp8-fast'),
  ]],
  ['Reasoning', [
    R('GPT-OSS 120B', '@cf/openai/gpt-oss-120b'), R('DeepSeek V4 Pro', '@cf/deepseek-ai/deepseek-v4-pro-0813'), R('DeepSeek V4 Flash', '@cf/deepseek-ai/deepseek-v4-flash-0731'), R('GLM-5.3'),
    R('Nemotron 3 120B'), R('Qwen3.8 27B'), R('QwQ 32B', '@cf/qwen/qwq-32b'), R('Kimi K2.6', '@cf/moonshotai/kimi-k2.6'),
  ]],
  ['Code', [R('Kimi K2.7 Code', '@cf/moonshotai/kimi-k2.7-code'), R('Qwen2.5 Coder 32B', '@cf/qwen/qwen2.5-coder-32b-instruct')]],
  ['Reading images and files', [R('Llama 4 Scout', '@cf/meta/llama-4-scout-17b-16e-instruct'), R('Gemma 4 26B', '@cf/google/gemma-4-26b-a4b-it'), R('Llama 3.2 11B Vision'), R('Moondream 3.1')]],
  ['Search and ranking', [R('BGE-M3'), R('Qwen3 Embedding 0.6B'), R('BGE Base EN v1.5', '@cf/baai/bge-base-en-v1.5'), R('BGE Reranker Base')]],
  ['Languages', [R('M2M100'), R('IndicTrans2'), R('SEA-LION v4 27B')]],
  ['Speech to text', [
    R('Whisper Large v3 Turbo', '@cf/openai/whisper-large-v3-turbo'), R('Whisper', '@cf/openai/whisper'),
    R('Deepgram Nova-3', '@cf/deepgram/nova-3'), R('Deepgram Flux'), R('Smart Turn v2'),
  ]],
  ['Voice', [R('Aura-2 EN'), R('Aura-2 ES'), R('MeloTTS')]],
  ['Images', [R('FLUX.2 Klein 9B'), R('FLUX.2 Klein 4B'), R('FLUX.2 Dev'), R('FLUX.1 Schnell', '@cf/black-forest-labs/flux-1-schnell'), R('Lucid Origin'), R('Phoenix 1.0')]],
  ['Safety', [R('Llama Guard 3 8B', GUARD_MODEL)]],
];

/**
 * The New badge: the canvas's `new_models`, less BGE Base EN v1.5 and FLUX.1
 * Schnell, which already run in production (D720 §1).
 */
export const NEW_MODELS = new Set([
  'GLM-5.3 Flash', 'GLM-5.3', 'Qwen3 30B A3B', 'Qwen3.8 27B', 'Nemotron 3 120B', 'IndicTrans2',
  'SEA-LION v4 27B', 'Smart Turn v2', 'Aura-2 ES', 'FLUX.2 Klein 4B', 'Lucid Origin', 'Phoenix 1.0',
]);

export const modelName = (id) => MODEL_COPY[id]?.name || null;
const tail = (id) => String(id).split('/').pop();

/**
 * The rail's model blocks, from one read of `GET /api/ai/rail` (D769 PR 2).
 * Pure, so every answer is tested without a renderer.
 *
 * `reading` is `{ loading, error, status, data }`. `page` is the page key the
 * shell resolved (`useRailPage().page`), null where the rail is off the
 * canvas's pages. `option` is the open option's key (`useRailOption`).
 * `pick` is a pick made since the read, shown at once.
 * `price(model)` prints a model's price (`ui/railPrices.js`).
 *
 * Returns:
 *   state    'loading'; 'unreadable' (the read failed: never an empty list);
 *            'none' (no page key, or the matrix has no row for it: the rail
 *            says "Not recorded" and why); or 'ready'.
 *   cards    { id, name, role, line, price, checked }, the row's models,
 *            default first, as the Worker orders them.
 *   current  the model the next run takes: the member's pick, else the
 *            row's first, its default.
 *   pickable whether the row offers a choice (more than one model).
 *   options  "On this page": { key, label, model, open } per option the page
 *            registers, `model` the name of its pick or default.
 *   groups   All models: [{ title, chips: [{ id, name, isNew, pickable,
 *            selected }] }], the router's models only. A chip is pickable
 *            where the row offers it, the guard never.
 */
export function railView({ reading, page, option = null, pick = null, price = () => null } = {}) {
  const empty = { cards: [], current: null, pickable: false, options: [], groups: [] };
  if (!page) return { ...empty, state: 'none', reason: 'This page has no row in the rail\'s model list.' };
  if (!reading || reading.loading) return { ...empty, state: 'loading' };
  if (reading.status === 404) return { ...empty, state: 'none', reason: 'The rail\'s model list has no row for this page yet.' };
  const data = reading.data;
  if (reading.error || !data || !Array.isArray(data.models)) return { ...empty, state: 'unreadable' };

  const models = data.models.filter((m) => m && typeof m.id === 'string');
  const offered = (id) => models.some((m) => m.id === id);
  const chosen = [pick, data.pick].find((id) => typeof id === 'string' && offered(id));
  const current = chosen ?? models[0]?.id ?? null;
  const cards = models.map((m) => ({
    id: m.id,
    name: m.name || modelName(m.id) || tail(m.id),
    role: m.role || null,
    line: m.line || null,
    price: price(m),
    checked: m.id === current,
  }));
  const options = (Array.isArray(data.options) ? data.options : []).filter((o) => o && o.key).map((o) => {
    const list = Array.isArray(o.models) ? o.models : [];
    const runs = list.find((m) => m.id === o.pick) || list[0];
    return {
      key: o.key,
      label: o.label || o.key,
      model: runs ? runs.name || modelName(runs.id) || tail(runs.id) : null,
      open: !!option && o.key === option,
    };
  });
  const groups = [];
  for (const [title, rows] of ALL_MODELS) {
    const chips = rows.filter(([, id]) => id).map(([name, id]) => ({
      id, name, isNew: NEW_MODELS.has(name), pickable: id !== GUARD_MODEL && offered(id), selected: id === current,
    }));
    if (chips.length) groups.push({ title, chips });
  }
  return { state: 'ready', cards, current, pickable: models.length > 1, options, groups };
}
