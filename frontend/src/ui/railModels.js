/**
 * What to SAY about a model. Never what it costs.
 *
 * The split this file exists to keep is the one `DECISIONS` D13 and D16 are
 * both about: a model's **name, id and rate are facts** and come from
 * `GET /api/ai/pricing`, which reads the router's own tables; a model's
 * **description and its recommendation are editorial** and are written here.
 * Nothing in this file is derivable, and nothing derivable is in this file.
 *
 * WHY NOT THE CANVAS'S OWN COPY. `design/incoming/AIRail.dc.html` ships a
 * `MENUS` object with a why-sentence per model per surface, and it is tempting
 * to transcribe. Its Validate entry for the 70b reads "Paired with Whisper —
 * reads across all interviews at once and writes the synthesis", which
 * describes a task this rail does not run: the workspace surface runs
 * `workspace_explain`, a read-back of the summary lines beside it. Copying that
 * sentence would put a true-sounding description of the wrong work under a
 * model that does different work. The canvas is a proposal (`design/incoming/README.md`:
 * "A canvas is a proposal, not a specification"), so the sentences below
 * describe what the model is actually asked to do here.
 *
 * WHY A RECOMMENDATION IS ALLOWED TO BE TYPED. It is a judgement — "this is
 * the one to reach for on this page" — and there is nothing to derive it from:
 * the router's table knows prices and context windows, not which trade suits a
 * founder reading a page back. What a test CAN hold is that a recommendation
 * names a model the router actually offers, which is the failure that would
 * matter (`frontend/test/worker_rail_models.test.mjs`).
 *
 * ADDING A MODEL IS A TWO-FILE CHANGE, DELIBERATELY. An id with copy here and
 * no `alternates` entry in `cloudflare-worker/src/services/aiRouter.ts` renders
 * nothing — `modelsForTask` builds the menu from the router and joins this in.
 * An id in `alternates` with no copy here renders with its short name and no
 * sentence, which is ugly but honest. Neither direction can put a model on
 * screen that the worker would refuse.
 */

/**
 * Per model id: the short display name, one sentence on when to reach for it,
 * and the tags the rail shows under a recommended entry.
 *
 * `name` is the vendor's own product name rather than the id's last segment,
 * which is what the rail rendered before this file existed —
 * "llama-3.3-70b-instruct-fp8-fast" is an identifier, not a name.
 */
export const MODEL_COPY = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': {
    name: 'Llama 3.3 70B Fast',
    why: 'Reads every line on the page together and writes one summary. The most careful of the three, and the dearest to answer with.',
    tags: ['Best for: reading a page back', 'Long context'],
  },
  '@cf/meta/llama-3.1-8b-instruct-fp8': {
    name: 'Llama 3.1 8B',
    why: 'A fifth the price of the 70b, with a wider window. Shorter, plainer answers.',
    tags: ['Best for: a quick read', 'Cheaper'],
  },
  '@cf/meta/llama-3.2-3b-instruct': {
    name: 'Llama 3.2 3B',
    why: 'Six times cheaper again, and shallower with it. Enough for a page with a handful of lines on it.',
    tags: ['Best for: short pages', 'Cheapest'],
  },
};

/**
 * Which entries a task presents as the one to reach for, by aiRouter task
 * class. A list rather than a single id because a task can reasonably have two
 * — the canvas's own Validate menu badges Whisper and the 70b together, one
 * per kind of work — and because a list degrades to "none" without a special
 * case when a task has no opinion.
 *
 * Every id here must appear in that task's `alternates`, or the rail would
 * badge a model it cannot offer. Pinned rather than assumed.
 */
export const RECOMMENDED_BY_TASK = {
  workspace_explain: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
};
