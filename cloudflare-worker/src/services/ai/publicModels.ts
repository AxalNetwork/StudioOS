/**
 * D786 (#2211) — the models the Pricing page's Models tab draws, for anyone:
 * `GET /api/public/ai/models`.
 *
 * Every model the router offers (`catalogue.isOffered` under the owner's
 * switches), with its name, its kind, its price per unit as a MEMBER pays it
 * (Cloudflare's cost × `AI_MARKUP`, D762), the words for each unit, the canvas
 * pages whose rail rows name it (D764's matrix), and its New and Paid-only
 * flags. Read from the same catalogue, pricing and matrix the signed-in reads
 * use (`/api/ai/catalogue`, `/api/ai/pricing`), never a typed copy.
 *
 * ONLY PUBLIC FIELDS (D785 D-b). No cost price, no neurons, no licence, no
 * multiplier, no status, no partner flag and no route: a test holds the exact
 * key set. No D1 and no binding, so the edge and the isolate cache it.
 */
import { CATALOGUE, isOffered, type CatalogueSwitches, type PriceUnit } from './catalogue';
import { AI_MARKUP, billedUnitPrice, unitPrice } from './pricing';
import { railOptionRows, railRows } from './railMatrix';

/** What each unit's price is per, as the page prints it. */
export const UNIT_WORDS: Readonly<Record<PriceUnit, string>> = Object.freeze({
  tokens_in: 'per 1M input tokens',
  tokens_cached: 'per 1M cached input tokens',
  tokens_out: 'per 1M output tokens',
  audio_minutes: 'per audio minute',
  audio_minutes_websocket: 'per streamed audio minute',
  characters: 'per 1k characters',
  images: 'per 1M images',
  tiles: 'per tile',
  steps: 'per step',
  input_tile_steps: 'per input tile-step',
  output_tile_steps: 'per output tile-step',
  input_tiles: 'per input tile',
  output_tiles: 'per output tile',
  first_megapixels: 'for the first megapixel',
  subsequent_megapixels: 'per further megapixel',
  input_image_megapixels: 'per input megapixel',
});

/**
 * Models new to the platform: the rail's "New" pill (`frontend/src/ui/railModels.js`
 * `NEW_MODELS`, by display name), by catalogue id. A test reads both back.
 */
export const NEW_MODEL_IDS: ReadonlySet<string> = new Set([
  '@cf/zai-org/glm-5.3-flash', '@cf/zai-org/glm-5.3', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/qwen/qwen3.8-27b',
  '@cf/nvidia/nemotron-3-120b-a12b', '@cf/ai4bharat/indictrans2-en-indic-1B', '@cf/aisingapore/gemma-sea-lion-v4-27b-it',
  '@cf/pipecat-ai/smart-turn-v2', '@cf/deepgram/aura-2-es', '@cf/black-forest-labs/flux-2-klein-4b',
  '@cf/leonardo/lucid-origin', '@cf/leonardo/phoenix-1.0',
]);

export interface PublicModel {
  id: string;
  name: string;
  kind: string;
  /** USD per unit, as a member pays it. */
  billed: Record<string, number>;
  unit_words: Record<string, string>;
  /** Canvas page names whose rail rows name this model, in the matrix's order. */
  pages: string[];
  is_new: boolean;
  paid_only: boolean;
}

/** The Models tab's rows, in the catalogue's order. */
export function publicModels(env: CatalogueSwitches): PublicModel[] {
  const pages = new Map<string, string[]>();
  for (const row of [...railRows(), ...railOptionRows()]) {
    for (const m of row.models) {
      const list = pages.get(m.id) ?? [];
      if (!list.includes(row.pageKey)) list.push(row.pageKey);
      pages.set(m.id, list);
    }
  }
  return CATALOGUE.filter((m) => isOffered(m, env)).map((m) => {
    const billed: Record<string, number> = {};
    const words: Record<string, string> = {};
    for (const unit of Object.keys(m.neurons ?? {}) as PriceUnit[]) {
      const price = unitPrice(m.id, unit);
      if (price == null) continue;
      billed[unit] = billedUnitPrice(price, AI_MARKUP);
      words[unit] = UNIT_WORDS[unit] ?? unit;
    }
    return {
      id: m.id, name: m.name, kind: m.kind, billed, unit_words: words,
      pages: pages.get(m.id) ?? [], is_new: NEW_MODEL_IDS.has(m.id), paid_only: m.paid_only,
    };
  });
}
