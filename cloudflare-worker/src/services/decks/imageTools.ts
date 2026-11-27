/**
 * D1534 (#3778 phase 2, deck builder v2 B2) and D4316 (#4316) — the deck's AI
 * image tools, through AI Gateway:
 * - background removal: Bria RMBG 2.0 (owner decision M = B);
 * - upscale: Pruna P-Image-Upscale (the owner's answer A on #4316), twice the
 *   pixels on each side, capped at 8 megapixels.
 *
 * IN THIS ORDER, each refusing before the next costs anything:
 *   1. the tool has a model (`gatewayImageModelFor`);
 *   2. its provider's own switch, exactly 'on' (`imageToolOn`: `AI_PROVIDER_BRIA`
 *      for Bria, `AI_PROVIDER_PRUNA` for Pruna), else `image_tool_off`, and the
 *      model is never called;
 *   3. the quote: the model's printed per-image price at the member's billed
 *      multiplier (`toolQuoteMicro`);
 *   4. the hold, through `meteredCall` (the same ledger every metered run uses):
 *      a refusal (not enough tokens, AI paused, a cap) holds nothing and calls nothing;
 *   5. the call, `env.AI.run(model, toolInput(...), gateway)`. The answer is a URL
 *      the provider hosts; its PNG (or, for an upscaled JPEG, its JPEG) is fetched
 *      once. Any failure releases the hold, and nothing is charged.
 *   6. one `ai_usage_logs` row, the charge on it.
 *
 * The result is an image the route stores as a proposed child image
 * (`deck_images.image_tool`, migration 766). The founder keeps it or reverts it,
 * as with an edit (D1544).
 */
import type { Env } from '../../types';
import { GATEWAY_IMAGE_MODELS, gatewayImageModelFor, imageToolOn, type GatewayImageModel, type ImageToolId } from '../ai/catalogue';
import * as aiBudget from '../aiBudget';
import { deckGatewayOptionFor, recordUsage, type RefusalReason, type UsageMeta } from '../aiRouter';
import { MeteringRefused, meteredCall } from '../metering';

export const IMAGE_TOOLS: readonly ImageToolId[] = Object.freeze(['remove_background', 'upscale']);
export const isImageTool = (v: unknown): v is ImageToolId => typeof v === 'string' && (IMAGE_TOOLS as readonly string[]).includes(v);

/** The words the toolbar shows: the tool's name, and why it cannot run. */
export const TOOL_WORDS: Readonly<Record<ImageToolId, string>> = Object.freeze({ remove_background: 'Remove background', upscale: 'Upscale' });
export const NO_MODEL_MESSAGE = 'This tool is coming later. Nothing was run.';
/** Each tool's own "off" and "failed" sentence. */
export const OFF_MESSAGES: Readonly<Record<ImageToolId, string>> = Object.freeze({
  remove_background: 'Background removal is coming later. Nothing was run and nothing was charged.',
  upscale: 'Upscale is coming later. Nothing was run and nothing was charged.',
});
export const FAILED_MESSAGES: Readonly<Record<ImageToolId, string>> = Object.freeze({
  remove_background: 'The background could not be removed this time. Nothing was charged.',
  upscale: 'The image could not be upscaled this time. Nothing was charged.',
});
export const OFF_MESSAGE = OFF_MESSAGES.remove_background;
export const FAILED_MESSAGE = FAILED_MESSAGES.remove_background;
/** Every tool's result is fetched once, and a result larger than this is refused (as an upload is). */
export const RESULT_MAX_BYTES = 20 * 1024 * 1024;
/** D4316: an upscale's result may be larger: 8 megapixels as a PNG. */
export const UPSCALE_RESULT_MAX_BYTES = 40 * 1024 * 1024;
/**
 * D4316: Upscale asks for twice the pixels on each side (4× the area), never past
 * this many megapixels, and refuses before any hold an image already at it.
 */
export const UPSCALE_MAX_MEGAPIXELS = 8;
export const UPSCALE_TOO_LARGE_MESSAGE = 'This image is already large enough to upscale. Nothing was run and nothing was charged.';
export const TOOL_TIMEOUT_MS = 60_000;
/** The usage row's task: an image edit. */
const TASK = 'rail_edit_image' as const;

export type ToolState = { tool: ImageToolId; on: boolean; model: string | null; model_label: string | null; usd_per_image: string | null; message: string | null };

/** Whether a tool can run here, and what it costs per image, before anything is held. */
export function toolState(env: Env, tool: ImageToolId): ToolState {
  const m = gatewayImageModelFor(tool);
  if (!m) return { tool, on: false, model: null, model_label: null, usd_per_image: null, message: NO_MODEL_MESSAGE };
  const on = imageToolOn(env as never, m);
  return { tool, on, model: m.id, model_label: m.name, usd_per_image: m.usdPerImage, message: on ? null : OFF_MESSAGES[tool] };
}

export const toolStates = (env: Env): ToolState[] => IMAGE_TOOLS.map((t) => toolState(env, t));

/** One image on this model, billed to this member, in micro-USD. */
export async function toolQuoteMicro(env: Env, userId: number, m: GatewayImageModel): Promise<number> {
  return aiBudget.billedUsdToMicro(Number(m.usdPerImage), await aiBudget.memberChargeMultiplier(env, userId));
}

export type ToolResult =
  | { ok: true; bytes: Uint8Array; mime: 'image/png' | 'image/jpeg'; model: string; charged_microusd: number | null; hold_microusd: number; usage_log_id: number | null }
  | { ok: false; status: number; code: string; message: string };

type AiLike = { run(model: string, input: unknown, opts?: unknown): Promise<unknown> };
export type ToolDeps = { ai?: AiLike; fetch?: typeof fetch; timeoutMs?: number };

class ToolFailed extends Error {}

const b64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * D4316: the target size of an upscale, in megapixels: 4× the area, capped at
 * UPSCALE_MAX_MEGAPIXELS. Null when the image is already at the cap, or its size
 * is unknown (then the tool refuses before anything is held).
 */
export function upscaleTarget(size: { width: number; height: number } | null): number | null {
  if (!size || !(size.width > 0) || !(size.height > 0)) return null;
  const mp = (size.width * size.height) / 1_000_000;
  if (mp >= UPSCALE_MAX_MEGAPIXELS) return null;
  return Math.min(UPSCALE_MAX_MEGAPIXELS, Math.max(1, Math.ceil(mp * 4)));
}

/**
 * Each tool's input, from its model's schema:
 * - Bria: `{ image, preserve_alpha: true }`;
 * - Pruna (UNVERIFIED against Cloudflare's page, which the session could not
 *   reach; the fields are Pruna's published schema): `upscale_mode: 'target'`
 *   at `target` megapixels, the same format as the original so a PNG keeps its
 *   transparency, and no detail or realism enhancement, which can change the picture.
 */
export function toolInput(tool: ImageToolId, image: string, mime: string, target: number | null): Record<string, unknown> {
  if (tool === 'upscale') {
    return { image, upscale_mode: 'target', target, enhance_details: false, enhance_realism: false, output_format: mime === 'image/jpeg' ? 'jpg' : 'png' };
  }
  return { image, preserve_alpha: true };
}

/** The URL Bria answers with: `{ image }`, or the REST shape `{ result: { image } }`. */
export function resultUrl(out: unknown): string | null {
  const o = out as { image?: unknown; result?: { image?: unknown } } | null;
  // D4316: an upscaler may answer with the URL alone.
  const url = typeof out === 'string' ? out : typeof o?.image === 'string' ? o.image : typeof o?.result?.image === 'string' ? o.result.image : null;
  return url && /^https:\/\//.test(url) ? url : null;
}

/**
 * Run one tool on one image, under a hold. `executionId` keys the hold, so a
 * retried press is not charged twice.
 */
export async function runImageTool(env: Env, input: {
  tool: ImageToolId; userId: number; bytes: Uint8Array; mime: string; executionId: string; surface: string; option: string;
  /** D4316: the image's pixel size, which Upscale needs for its target. */
  size?: { width: number; height: number } | null;
}, deps: ToolDeps = {}): Promise<ToolResult> {
  const state = toolState(env, input.tool);
  const m = gatewayImageModelFor(input.tool);
  if (!m) return { ok: false, status: 503, code: 'image_tool_off', message: NO_MODEL_MESSAGE };
  if (!state.on) return { ok: false, status: 503, code: 'image_tool_off', message: OFF_MESSAGES[input.tool] };
  const ai = deps.ai ?? (env as unknown as { AI?: AiLike }).AI;
  if (!ai || typeof ai.run !== 'function') return { ok: false, status: 503, code: 'image_tool_off', message: OFF_MESSAGES[input.tool] };
  const target = input.tool === 'upscale' ? upscaleTarget(input.size ?? null) : null;
  if (input.tool === 'upscale' && target === null) return { ok: false, status: 422, code: 'image_large_enough', message: UPSCALE_TOO_LARGE_MESSAGE };
  const maxBytes = input.tool === 'upscale' ? UPSCALE_RESULT_MAX_BYTES : RESULT_MAX_BYTES;
  const quote = await toolQuoteMicro(env, input.userId, m);
  const usd = Number(m.usdPerImage);
  const usage = (latency: number, cost: number): UsageMeta => ({
    task: TASK, model: m.id, latency_ms: latency, prompt_tokens: 0, completion_tokens: 0, est_cost_usd: cost, fallback_used: false, cached: false, safety_score: null,
  });
  const who = { userId: input.userId, surface: input.surface, railOption: input.option };
  // The deck's own AI Gateway (D1504), built by the router as every gateway option is: a `deck:` option is a deck run.
  const gateway = deckGatewayOptionFor(env, { task: TASK, userId: input.userId, rail: { page: 'Founder · Raise · Pitch deck', option: input.option } });
  const get = deps.fetch ?? fetch;
  const started = Date.now();
  let done;
  try {
    done = await meteredCall(env, {
      userId: input.userId, executionId: input.executionId, component: `image_tool.${input.tool}`,
      operation: `ai.image_tool.${input.tool}`, quoteMicrousd: quote, timeoutMs: deps.timeoutMs ?? TOOL_TIMEOUT_MS,
    }, async () => {
      let out: unknown;
      try { out = await ai.run(m.id, toolInput(input.tool, `data:${input.mime};base64,${b64(input.bytes)}`, input.mime, target), gateway); }
      catch { throw new ToolFailed('call'); }
      const url = resultUrl(out);
      if (!url) throw new ToolFailed('answer');
      const res = await get(url).catch(() => null);
      if (!res || !res.ok) throw new ToolFailed('fetch');
      const bytes = new Uint8Array(await res.arrayBuffer());
      // Background removal is always a PNG (its alpha); an upscale keeps its original's format.
      const fits = input.tool === 'upscale' && input.mime === 'image/jpeg' ? isJpeg(bytes) : isPng(bytes);
      if (!bytes.byteLength || bytes.byteLength > maxBytes || !fits) throw new ToolFailed('result');
      return bytes;
    });
  } catch (e) {
    if (e instanceof MeteringRefused) {
      // The ledger's codes are written as the same text column, as `aiProviders.ts` writes them.
      await recordUsage(env, who, usage(0, 0), e.code as RefusalReason);
      return { ok: false, status: 402, code: e.code, message: e.sentence };
    }
    // The call, its answer or its file failed, or the run timed out: the hold was released.
    await recordUsage(env, who, usage(Date.now() - started, 0), 'all_models_failed');
    return { ok: false, status: 503, code: 'image_tool_failed', message: FAILED_MESSAGES[input.tool] };
  }
  const charged = done.usage.charged_microusd;
  const rowId = await recordUsage(env, who, usage(Date.now() - started, usd), null, {
    charged, reservationUid: done.usage.reservation_uid, units: { images: 1, provider: m.provider },
  });
  const mime = isJpeg(done.value) ? 'image/jpeg' : 'image/png';
  return { ok: true, bytes: done.value, mime, model: m.id, charged_microusd: charged, hold_microusd: quote, usage_log_id: rowId };
}

/** Every tool row, through AI Gateway (Bria and Pruna): the PR's spend line reads these. */
export const TOOL_MODELS = GATEWAY_IMAGE_MODELS;
