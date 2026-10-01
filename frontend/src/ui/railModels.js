/**
 * What to SAY about a model. Never what it costs.
 *
 * The split this file exists to keep is the one `DECISIONS` D13 and D16 are
 * both about: a model's **name, id and rate are facts** and come from
 * `GET /api/ai/pricing`, which reads the router's own tables; a model's
 * **name and description are editorial** and are written here.
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
 * WHICH MODEL CARRIES THE BADGE IS NOT DECIDED HERE (D400). This file used to
 * hold a typed `RECOMMENDED_BY_TASK` map, and the rail drew a RECOMMENDED
 * badge from it. Two things were wrong with that. The word: the voice rule
 * forbids "recommendation" about what the assistant produces. And the source:
 * the one entry the map held named `ROUTE.workspace_explain.model` — the
 * router's own primary, the model that runs when nobody picks one — so the
 * badge was a hand-typed copy of a router fact. It now says "Default" and
 * `modelsForTask` derives it from the `model` field of `/api/ai/pricing`, so
 * it cannot name a model the router does not default to.
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
 * and the tags the rail shows under the default entry.
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
