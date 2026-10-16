/**
 * What to SAY about a model. Never what it costs.
 *
 * The split this file exists to keep is the one `DECISIONS` D13 and D16 are
 * both about: which models exist, which one a task runs by default and which
 * ones a caller may pick are **facts**, and come from `GET /api/ai/pricing`,
 * which reads the router's own tables; a model's **name and the sentence under
 * it are editorial**, and are written here. Nothing in this file is derivable,
 * and nothing derivable is in this file. Since D698 the rail draws no id, no
 * rate and no estimate (D16's averages and the receipts live on
 * `/account/usage`), so this file holds no figure of any kind.
 *
 * THE CANVAS'S TABLES, AND WHY EVERY LINE IS CHECKED (D698, D-s). The AIRail
 * canvas (`design/canvases/integrated/AIRail.dc.html`) maps every page to one
 * of fourteen task kinds (`TASK_KIND`) and every kind to two to four models
 * with a role word and a line (`SUGGESTED`). It names 29 models; the router
 * carries six of them (`CANVAS_MODEL_IDS`). A canvas model the router does not
 * carry is never drawn (D-q). A carried one is drawn only where one of the
 * page's jobs runs it, and its line only where that job does the work the line
 * describes (`CANVAS_LINE_HOLDS`); elsewhere the card says what the job does.
 * An earlier version of this file refused the canvas's copy for the same
 * reason: its Validate line for the 70B, "Paired with Whisper — reads across
 * all interviews at once and writes the synthesis", described work the page
 * did not run.
 *
 * WHICH MODEL IS THE DEFAULT IS NOT DECIDED HERE (D400). The rail draws
 * "Default" only on the router's primary for the card's job, from the `model`
 * field of `/api/ai/pricing`, so a canvas "Default" on any other model is
 * dropped. The voice rule forbids "recommendation" about what Eadwyn produces,
 * which is why the badge was never RECOMMENDED again.
 *
 * ADDING A MODEL IS A ROUTER CHANGE FIRST (D698 decision 14, #1008). An id
 * with a name here and no place in `ROUTE` (`cloudflare-worker/src/services/
 * aiRouter.ts`) renders nothing. An id in `ROUTE` with no name here renders
 * nowhere either, and `airail_d698.test.mjs` fails until it has one, so the
 * catalogue never shows a bare id.
 */

/**
 * Per router model id: the name the rail draws. Every model `ROUTE` can send
 * work to has one, the guard included, although the guard is never drawn
 * (`NOT_IN_CATALOGUE`). Where the canvas names the model, the name is the
 * canvas's, so "Using Llama 3.1 8B on this page." reads as the canvas does.
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
};

const L70 = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * Router models the catalogue never draws: the guard (the `safety` task) is
 * not a model a founder runs, and a retired model (`services/aiCatalog.ts`
 * `RETIRED_MODELS`) is priced only so past runs keep their cost.
 */
export const NOT_IN_CATALOGUE = new Set([
  '@cf/meta/llama-guard-3-8b',
  '@cf/meta/llama-3.1-8b-instruct',
]);

/**
 * Every canvas model name, to the router id it is, or null where the router
 * does not carry it. 29 names; six carried. Deepgram Flux is priced for the
 * recording sheet's live captions (`services/sttModels.ts`) but is outside
 * `ROUTE`, so it is null here too and never drawn. D698.md lists all 29.
 */
export const CANVAS_MODEL_IDS = {
  'GLM-4.7 Flash': null,
  'Llama 3.3 70B Fast': L70,
  'GPT-OSS 120B': null,
  'GPT-OSS 20B': null,
  'Whisper Large v3 Turbo': '@cf/openai/whisper-large-v3-turbo',
  'Deepgram Nova-3': '@cf/deepgram/nova-3',
  'Deepgram Flux': null,
  'Kimi K2.6': null,
  'Kimi K2.7 Code': null,
  'BGE-M3': null,
  'BGE Reranker Base': null,
  'Qwen3 Embedding 0.6B': null,
  'DeepSeek V4 Pro': null,
  'DeepSeek V4 Flash': '@cf/deepseek-ai/deepseek-v4-flash-0731',
  'QwQ 32B': null,
  'Gemma 4 26B': null,
  'Llama 4 Scout': null,
  'Moondream 3.1': null,
  'Llama 3.2 11B Vision': null,
  'Qwen2.5 Coder 32B': '@cf/qwen/qwen2.5-coder-32b-instruct',
  'Granite 4.0 Micro': null,
  'Mistral Small 3.1 24B': null,
  'Llama 3.1 8B': '@cf/meta/llama-3.1-8b-instruct-fp8',
  'M2M100': null,
  'EuroLLM 9B': null,
  'Aura-2 EN': null,
  'MeloTTS': null,
  'FLUX.2 Klein 4B': null,
  'FLUX.2 Dev': null,
};

/**
 * The canvas's `TASK`: each section and module to one of fourteen kinds.
 * Transcribed whole, every licence's pages included, and matched without
 * regard to case because one host passes `workspace="network"`.
 */
export const TASK_KIND = {
  Studio: 'chat', Home: 'chat', 'Axal VC Fund': 'research', Validate: 'synth', 'Problem discovery': 'synth', 'Customer research': 'speech', 'Ideal customer profile': 'synth', 'Market intelligence': 'research', 'Demand and urgency signals': 'numbers', 'Experiments and evidence': 'reason', Verdict: 'reason',
  Build: 'plan', 'Solution design': 'plan', 'Prototype / MVP': 'code', 'Product roadmap': 'plan', 'Founding team': 'plan', 'Company creation': 'legal', 'Operating systems': 'plan',
  Raise: 'reason', 'Fundraising readiness': 'reason', 'Investor narrative': 'write', 'Pitch deck': 'vision', 'Data room': 'vision', 'Cap table': 'numbers', 'Use of funds': 'numbers', 'Capital relationships': 'match',
  Grow: 'plan', 'Product improvement': 'synth', Distribution: 'write', 'Revenue and traction': 'numbers', 'Team expansion': 'plan', 'Partner network': 'match', 'Market expansion': 'multi', 'Durable company-building': 'legal',
  Network: 'match', Relationships: 'match', Introductions: 'match', Organizations: 'match', Research: 'research', Ask: 'research', Markets: 'research', Market: 'research', Geographies: 'multi', Companies: 'research', Funds: 'research', Library: 'search', 'Client prep': 'research', Diligence: 'vision', Benchmarking: 'numbers',
  Deals: 'reason', Pipeline: 'match', Screening: 'reason', Commit: 'reason', Closing: 'legal', Portfolio: 'numbers', Positions: 'numbers', Performance: 'numbers', Updates: 'synth', 'Value-add': 'match',
  Fund: 'numbers', Overview: 'numbers', LPs: 'match', 'Capital calls': 'numbers', Distributions: 'numbers', Reporting: 'write',
  Practice: 'plan', Opportunities: 'match', Engagements: 'plan', Delivery: 'plan', Sessions: 'speech', Earnings: 'numbers', Cohorts: 'synth', Founders: 'match', Guidance: 'write', 'This week': 'plan', Calendar: 'plan', Outcomes: 'synth',
  Expertise: 'write', Profile: 'write', Services: 'write', Proof: 'synth', Thinking: 'write', Visibility: 'match',
  Leads: 'match', Proposals: 'write', Negotiations: 'legal', Retainers: 'numbers', Analytics: 'numbers', Deliverables: 'write', Capacity: 'plan', Health: 'synth', Offers: 'write', Catalog: 'write', 'Perk deals': 'write', 'Audience fit': 'match',
};

const M = (name, role, line) => ({ name, role, line });

/** The canvas's `SUG`: each kind's models, role words and lines, in order. */
export const SUGGESTED = {
  chat: [M('GLM-4.7 Flash', 'Default', 'Fast replies that can use your workspace'), M('Llama 3.3 70B Fast', 'Longer', 'Fuller answers and drafts'), M('GPT-OSS 120B', 'Deeper', 'Hard questions that need reasoning')],
  synth: [M('Llama 3.3 70B Fast', 'Default', 'Groups notes and quotes into themes'), M('GLM-4.7 Flash', 'Faster', 'Quick tagging at a lower cost'), M('GPT-OSS 120B', 'Deeper', 'Checks a theme against all the evidence')],
  speech: [M('Whisper Large v3 Turbo', 'Transcribe', 'Turns each recording into a transcript'), M('Deepgram Nova-3', 'Speakers', 'Labels who said what'), M('Deepgram Flux', 'Live', 'Captions while you talk'), M('Llama 3.3 70B Fast', 'Structure', 'Places quotes on themes and hypotheses')],
  research: [M('Kimi K2.6', 'Default', 'Long sources, cited answers'), M('GPT-OSS 120B', 'Deeper', 'Weighs conflicting sources'), M('BGE-M3', 'Search', 'Finds the right records first'), M('BGE Reranker Base', 'Rank', 'Puts the most relevant on top')],
  reason: [M('GPT-OSS 120B', 'Default', 'Tests a claim against its evidence'), M('DeepSeek V4 Pro', 'Second view', 'Reviews the first answer'), M('QwQ 32B', 'Challenge', 'Argues the other side')],
  vision: [M('Gemma 4 26B', 'Default', 'Reads slides, charts and scans'), M('Llama 4 Scout', 'Alternative', 'Mixed text and images'), M('Moondream 3.1', 'Extract', 'Pulls figures out of images')],
  code: [M('Kimi K2.7 Code', 'Default', 'Reads your repository and its changes'), M('Qwen2.5 Coder 32B', 'Alternative', 'Reviews and writes code')],
  numbers: [M('DeepSeek V4 Pro', 'Default', 'Shows its working on every figure'), M('GPT-OSS 120B', 'Alternative', 'Explains what moved and why'), M('Granite 4.0 Micro', 'Faster', 'Reads figures out of documents')],
  write: [M('Llama 3.3 70B Fast', 'Default', 'Drafts in your voice, cited'), M('Mistral Small 3.1 24B', 'Polished', 'Tighter, more formal drafts'), M('GLM-4.7 Flash', 'Faster', 'Short drafts and replies')],
  match: [M('BGE-M3', 'Match', 'Finds people and firms that fit'), M('BGE Reranker Base', 'Rank', 'Orders them by fit'), M('Llama 3.3 70B Fast', 'Draft', 'Writes the introduction, for you to send')],
  plan: [M('GLM-4.7 Flash', 'Default', 'Plans, lists and next steps'), M('GPT-OSS 20B', 'Alternative', 'Steady structured output'), M('GPT-OSS 120B', 'Deeper', 'Trade-offs and dependencies')],
  legal: [M('DeepSeek V4 Pro', 'Default', 'Reads terms and filings closely'), M('GPT-OSS 120B', 'Second view', 'Checks the first reading')],
  multi: [M('BGE-M3', 'Search', 'Finds sources in any language'), M('M2M100', 'Translate', 'Translates, keeping the original'), M('EuroLLM 9B', 'European', 'Reads European-language sources')],
  search: [M('BGE-M3', 'Index', 'Makes every document searchable'), M('Qwen3 Embedding 0.6B', 'Alternative', 'A second index to compare'), M('Kimi K2.6', 'Answer', 'Answers from the documents, cited')],
};

/**
 * THE CANVAS LINES THAT HOLD, per kind and model: the router tasks whose run
 * does what the line says (D-s). A carried model drawn for any other job is
 * drawn as that job's card: "Default" when it is the job's router primary, no
 * role word otherwise, and the job's own sentence. Every carried line not
 * listed here is untrue wherever it would be drawn; D698.md gives each
 * verdict.
 */
export const CANVAS_LINE_HOLDS = {
  'synth|Llama 3.3 70B Fast': ['validate_tag_pains'],
  'speech|Whisper Large v3 Turbo': ['transcribe'],
  'speech|Deepgram Nova-3': ['transcribe'],
  'speech|Llama 3.3 70B Fast': ['structure_interview'],
};

/** The canvas's `ALL`: the catalogue's groups, in its order. */
export const CATALOGUE_GROUPS = [
  ['Conversation and writing', ['GLM-4.7 Flash', 'Llama 3.3 70B Fast', 'Mistral Small 3.1 24B', 'GPT-OSS 20B', 'Llama 3.1 8B', 'Granite 4.0 Micro']],
  ['Reasoning', ['GPT-OSS 120B', 'DeepSeek V4 Pro', 'DeepSeek V4 Flash', 'Kimi K2.6', 'QwQ 32B']],
  ['Documents and images', ['Gemma 4 26B', 'Llama 4 Scout', 'Moondream 3.1', 'Llama 3.2 11B Vision']],
  ['Code', ['Kimi K2.7 Code', 'Qwen2.5 Coder 32B']],
  ['Search', ['BGE-M3', 'Qwen3 Embedding 0.6B', 'BGE Reranker Base']],
  ['Speech and voice', ['Whisper Large v3 Turbo', 'Deepgram Nova-3', 'Deepgram Flux', 'Aura-2 EN', 'MeloTTS']],
  ['Languages', ['M2M100', 'EuroLLM 9B']],
  ['Images', ['FLUX.2 Klein 4B', 'FLUX.2 Dev']],
];

/** Router models the canvas does not name, each in its kind's group. */
export const CATALOGUE_EXTRAS = {
  '@cf/meta/llama-3.2-3b-instruct': 'Conversation and writing',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': 'Conversation and writing',
  '@cf/openai/whisper': 'Speech and voice',
  '@cf/baai/bge-base-en-v1.5': 'Search',
};

/**
 * WHAT EACH PAGE'S AI WORK IS, and which router task does it. Editorial, like
 * the tables above: the task names are the router's, and which model each
 * runs is read from `GET /api/ai/pricing`. A job that response does not list
 * is skipped, so a card never names a task the router does not carry.
 *
 * `pick` is whether the rail's choice reaches the run. It does for the fill
 * bands, which send it (`FillProposals.jsx`, which reads `readRailModel` for
 * every fill kind). It does not for the zone drafts (`/api/research/drafts`
 * takes no model), for Ask, or for transcription and structuring, whose models
 * are chosen on the recording sheet and in the review. Those draw the router's
 * model as a plain row: a choice there would change nothing (D17).
 */
export const SECTION_JOBS = {
  Validate: [
    {
      task: 'transcribe',
      pick: false,
      why: 'Turns every recorded interview into text you can search and quote. You pick the model when you record.',
    },
    {
      task: 'validate_tag_pains',
      pick: true,
      why: 'Tags the phrases you logged to the pain themes you named, as proposals you accept or discard.',
    },
    {
      task: 'validate_draft_hypotheses',
      pick: true,
      why: 'Reads your pain map and drafts hypothesis cards, as proposals you accept or discard.',
    },
  ],
  Research: [
    {
      task: 'research_ask',
      pick: false,
      why: 'Answers a question you ask from your own library, with its sources.',
    },
    {
      task: 'workspace_explain',
      pick: false,
      why: 'Drafts the reading on a zone band when you press its button.',
    },
  ],
};

/**
 * A module that runs work of its own (D698 decision 5). Validate's other
 * modules keep the section's three jobs, as every Validate page always has.
 * Product improvement's task is D691's; until `/api/ai/pricing` lists it the
 * page keeps `DEFAULT_JOBS`.
 */
export const MODULE_JOBS = {
  'Problem discovery': [SECTION_JOBS.Validate[1]],
  'Experiments and evidence': [SECTION_JOBS.Validate[2]],
  'Customer research': [
    SECTION_JOBS.Validate[0],
    {
      task: 'structure_interview',
      pick: false,
      why: 'Places an interview\'s quotes on your themes and hypotheses, for you to review. You pick the model on the review.',
    },
  ],
  'Product improvement': [
    {
      task: 'grow_theme_feedback',
      pick: true,
      why: 'Groups the feedback you logged into themes, as proposals you accept or discard.',
    },
  ],
};

/** Every other page, on every licence: the zone drafts. */
export const DEFAULT_JOBS = [
  {
    task: 'workspace_explain',
    pick: false,
    why: 'Drafts the reading on a zone band when you press its button. It is given the figures beside it and nothing else.',
  },
];

/** A table keyed by name, read without regard to case. */
function lookup(table, name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return undefined;
  for (const [k, v] of Object.entries(table)) if (k.toLowerCase() === want) return v;
  return undefined;
}

/** The page's jobs: the module's own, else the section's, else the zone drafts. */
export const jobsFor = (section, module) =>
  lookup(MODULE_JOBS, module) || lookup(SECTION_JOBS, section) || DEFAULT_JOBS;

/** The canvas's kind for a page: by module, then by section, else `chat`. */
export const kindFor = (section, module) =>
  lookup(TASK_KIND, module) || lookup(TASK_KIND, section) || 'chat';

export const modelName = (id) => MODEL_COPY[id]?.name || null;

const listedBy = (route) => [route.model, ...(route.fallback_chain || []), ...(route.alternates || [])].filter(Boolean);

/**
 * The rail's "Suggested for this page" and "All models", from the page's
 * section and module, `/api/ai/pricing` and the stored picks (D698 decisions
 * 5 to 7). Pure, so every page's answer is tested without a renderer.
 *
 * `picks` is task → stored id, read by the rail from `readRailModel(workspace,
 * task)`, the store `FillProposals.jsx` sends, so the card and the run agree.
 *
 * Returns:
 *   unreadable  the price list was not read; the rail draws Unreadable.
 *   cards       { id, name, role, line, tasks, pickable, checked }. `tasks`
 *               are the page's pickable jobs that offer the model: choosing
 *               the card writes the pick for each.
 *   fallback    no canvas model is run here, so the one card is the router's
 *               primary for the page's first pickable job (else its first).
 *   offList     a stored pick that no card draws, { id, name }, or null.
 *   groups      [{ title, chips: [{ id, name, tasks, pickable, selected }] }],
 *               the router's catalogue in the canvas's groups, empty ones out.
 *   pickable    whether any job on this page takes the rail's pick.
 */
export function railSuggestions({ section, module, pricing, picks = {} } = {}) {
  const routes = pricing?.routes;
  if (!routes || typeof routes !== 'object') {
    return { unreadable: true, cards: [], fallback: false, offList: null, groups: [], pickable: false };
  }
  const listed = (job) => !!routes[job.task]?.model;
  let jobs = jobsFor(section, module).filter(listed);
  if (!jobs.length) jobs = DEFAULT_JOBS.filter(listed);

  const offers = (job) => (job.pick && Array.isArray(routes[job.task].alternates) ? routes[job.task].alternates : []);
  const pickJobs = jobs.filter((j) => offers(j).length > 0);
  const tasksFor = (id) => pickJobs.filter((j) => offers(j).includes(id)).map((j) => j.task);
  const running = (job) => {
    const p = picks?.[job.task];
    return typeof p === 'string' && offers(job).includes(p) ? p : routes[job.task].model;
  };
  const current = pickJobs.length ? running(pickJobs[0]) : null;
  const card = (id, role, line) => {
    const tasks = tasksFor(id);
    return { id, name: modelName(id) || id.split('/').pop(), role, line, tasks, pickable: tasks.length > 0, checked: id === current };
  };

  const kind = kindFor(section, module);
  const cards = [];
  for (const s of SUGGESTED[kind] || []) {
    const id = CANVAS_MODEL_IDS[s.name];
    if (!id || cards.some((c) => c.id === id)) continue;
    const job = jobs.find((j) => listedBy(routes[j.task]).includes(id));
    if (!job) continue;
    const primary = routes[job.task].model === id;
    const holds = (CANVAS_LINE_HOLDS[`${kind}|${s.name}`] || []).includes(job.task);
    const role = holds ? (s.role === 'Default' && !primary ? null : s.role) : (primary ? 'Default' : null);
    cards.push(card(id, role, holds ? s.line : job.why));
  }
  let fallback = false;
  if (!cards.length && jobs.length) {
    const job = pickJobs[0] || jobs[0];
    cards.push(card(routes[job.task].model, 'Default', job.why));
    fallback = true;
  }

  let offList = null;
  for (const job of pickJobs) {
    const p = picks?.[job.task];
    if (typeof p === 'string' && offers(job).includes(p) && !cards.some((c) => c.id === p)) {
      offList = { id: p, name: modelName(p) || p.split('/').pop() };
      break;
    }
  }

  const carried = new Set();
  for (const route of Object.values(routes)) for (const id of listedBy(route || {})) carried.add(id);
  for (const id of NOT_IN_CATALOGUE) carried.delete(id);
  const chip = (id) => {
    const tasks = tasksFor(id);
    return { id, name: modelName(id), tasks, pickable: tasks.length > 0, selected: id === (offList?.id || current) };
  };
  const groups = [];
  for (const [title, names] of CATALOGUE_GROUPS) {
    const ids = [];
    for (const n of names) {
      const id = CANVAS_MODEL_IDS[n];
      if (id && carried.has(id) && !ids.includes(id)) ids.push(id);
    }
    for (const [id, group] of Object.entries(CATALOGUE_EXTRAS)) {
      if (group === title && carried.has(id) && !ids.includes(id)) ids.push(id);
    }
    const chips = ids.filter((id) => modelName(id)).map(chip);
    if (chips.length) groups.push({ title, chips });
  }

  return { unreadable: false, cards, fallback, offList, groups, pickable: pickJobs.length > 0 };
}
