/**
 * D1505 (#3756, deck v2 A12) — drawing a deck's images through the pipeline,
 * with no press between the steps: the route's press and the one-click run
 * both call `drawDeckImages`.
 *
 *   deckArtOf        the deck's seed base and art direction: D1544's
 *                    `theme.art_direction` (the venture's id as the base when
 *                    the theme keeps no seed_base); nothing is stored twice
 *   drawDeckImages   for each variant: seed, size, `runPipeline`, then
 *                     · passed  → the XMP mark, R2, a `proposed` row with its
 *                               steps, seed, prompt hash, qa and provenance
 *                     · refused → a `discarded` row with its qa and no bytes,
 *                               every run of it settled at zero, and (with
 *                               `autoRedraw`) one redraw at the next variant
 *   refundSettled    a refused image's usage rows set to 0 under the parent
 *                    hold before it settles, with one activity_logs row.
 *                    Nothing is charged for it, so nothing is refunded: the
 *                    hold is simply not spent on it.
 *
 * ONE HOLD. A press holds the whole press up front (`reserveAiBudget`) and
 * runs every step under it (`parentHold`); `run()` settles nothing for a step
 * under a parent. The press settles once at the end with what the passed
 * images cost. The one-click run passes its own batch hold instead and settles
 * it itself, summing the same rows (`genRuntime.ts`).
 *
 * Every run of one image carries the same `pipeline_uid` on
 * `ai_usage_logs.record_ref` (`deckimg:<pipeline_uid>`), unless it runs under a
 * batch step, whose record_ref the batch settles by.
 */
import type { Env } from '../../types';
import { quoteRun, run, type RailContext, type RunOptions, type RunResult } from '../aiRouter';
import { reserveAiBudget, settleAiReservation } from '../aiBudget';
import { EXTENSION, MIMES, sniffMime, type ImageAsk } from './images';
import { aiXmpPacket, imageSize, sha256Hex, stripMetadata, withXmp, type ImageMime } from './imageBytes';
import { areasOf, boxOfAt } from './structures';
import { logCycleWrite } from '../cycleActivity';
import { artDirectionOfTheme, type ArtDirection as D1544Art } from './artDirection';
import { pipelineQuote, runPipeline, seedOf, sizeFor, type ArtDirection, type PipelineInput, type StepLine } from './pipelines';
import type { Aspect } from '../ai/shapes';

export type DeckArt = { seed_base: string; art: ArtDirection };

/**
 * The deck's one art direction and seed base, read from D1544's art direction
 * on the version's theme (`theme.art_direction`), never stored a second time.
 * The seed base is the theme's `seed_base` when it keeps one, else the
 * venture's own id: either way the same deck, card, area and variant draw the
 * same seed.
 */
export function deckArtOf(theme: Pick<D1544Art, 'seed_base' | 'reference_uid'> | null | undefined, projectId: number, art: ArtDirection): DeckArt {
  const seed_base = theme?.seed_base != null ? `seed:${theme.seed_base}` : `venture:${projectId}`;
  return { seed_base, art: { ...art, ...(theme?.reference_uid ? { reference: theme.reference_uid } : {}) } };
}

/** The art of the deck version a generation run draws on (its theme's art direction), for a step with no request. */
async function artOfDeck(env: Env, deckId: number | null, projectId: number): Promise<DeckArt> {
  let theme: D1544Art = {};
  if (deckId) {
    try {
      const row = await env.DB.prepare('SELECT theme_json FROM pitch_decks WHERE id = ? AND project_id = ?').bind(deckId, projectId).first<{ theme_json: string | null }>();
      theme = artDirectionOfTheme(row?.theme_json ? JSON.parse(row.theme_json) : null);
    } catch { theme = {}; }
  }
  return deckArtOf(theme, projectId, { style: theme.style ?? 'flat', palette: theme.palette ?? 'brand', colours: [] });
}

/** An area's box on its card, in slide pixels, or null when the card names no such area. */
export function areaBox(slides: unknown[], card: number | null, area: string | null, aspect: Aspect): { w: number; h: number } | null {
  if (card == null || !area) return null;
  const c = (Array.isArray(slides) ? slides : [])[card];
  if (!c) return null;
  const a = areasOf(c).areas.find((x) => x.id === area);
  if (!a) return null;
  const b = boxOfAt(a, aspect === '4:3' ? '4:3' : '16:9');
  return { w: b.w, h: b.h };
}

/** A refused image's runs, settled at zero under the parent hold, with one audit row. */
export async function refundSettled(env: Env, a: { reservationUid: string; userId: number; usageLogIds: number[]; projectId: number; pipelineUid: string; code: string }): Promise<number> {
  if (!a.usageLogIds.length) return 0;
  const ids = JSON.stringify(a.usageLogIds);
  const r = await env.DB.prepare(
    `UPDATE ai_usage_logs SET charged_microusd = 0
      WHERE user_id = ? AND reservation_uid = ? AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
  ).bind(a.userId, a.reservationUid, ids).run();
  // The venture's own cycle log, beside the press's `deck_image_proposed` row: the zeroing is a write it can read.
  await logCycleWrite(env, {
    projectId: a.projectId, userId: a.userId, cycle: 'raise', module: 'pitch-deck', entityId: null, action: 'deck_image_refused_zero',
    summary: `An image was refused (${a.code}); its ${a.usageLogIds.length} run${a.usageLogIds.length === 1 ? '' : 's'} settled at zero (pipeline ${a.pipelineUid})`,
  });
  return Number(r.meta?.changes ?? 0);
}

export type DrawArgs = {
  userId: number;
  deckId: number;
  projectId: number;
  slides: unknown[];
  ask: ImageAsk;
  base: string;                        // promptOf(ask, colours)
  colours: string[];
  draw: RunOptions;                    // the deck_image run: task, job, model pick, rail
  model: string;                       // the model the quote resolved to
  area: string | null;
  slideAspect: Aspect;
  cardUid: string | null;
  surface: string;                     // the page the press is on (D552); every run of the pipeline records it
  rail: RailContext;
  /** The deck's art direction and seed base (`deckArtOf`). */
  art: DeckArt;
  /** The one-click run's batch hold; without it the press holds its own. */
  parentHold?: { uid: string; userId: number } | null;
  /** Redraw a refused image once, at the next variant (the one-click bar). */
  autoRedraw?: boolean;
};

export type Refused = { pipeline_uid: string; variant_index: number; code: string; message: string; steps: StepLine[]; charged_microusd: 0; redraw: boolean };
export type Drawn = { rows: any[]; refused: Refused[]; stopped: { code: string; message: string } | null; hold_microusd: number };

const dataSize = (bytes: Uint8Array, mime: ImageMime) => imageSize(bytes, mime);

/** The pipeline's input for one variant of this request. */
export function inputFor(a: DrawArgs, art: DeckArt, variant: number, parentHold: { uid: string; userId: number } | null): PipelineInput {
  const box = areaBox(a.slides, a.ask.card, a.area, a.slideAspect);
  return {
    userId: a.userId, surface: a.surface, rail: a.rail, base: a.base, draw: a.draw,
    size: sizeFor(a.model, a.ask.aspect as Aspect, box),
    seed: seedOf(art.seed_base, a.cardUid, a.area, variant),
    art: art.art,
    ...(parentHold ? { parentHold } : {}),
  };
}

/**
 * A generation run's image step (#3753, the one-click run): the same pipeline,
 * under the run's parent hold, with no press. A refused image settles at zero
 * and is redrawn once at the next variant; a second refusal leaves the area
 * out. Nothing it returns has skipped the check.
 */
export type PipelineStepArgs = {
  userId: number; projectId: number; deckId: number | null; cardUid: string | null; area: string | null;
  base: string; draw: RunOptions; model: string | null; size: { width: number; height: number } | null;
  parentHold: { uid: string; userId: number } | null; rail: RailContext;
  run: (o: RunOptions) => Promise<RunResult>;
};
export type PipelineStepResult =
  | { ok: true; image: NonNullable<RunResult['image']>; model: string; alt: string | null; seed: number; variant_index: number; pipeline_uid: string; steps: StepLine[]; qa: unknown; refused: Refused[]; usage_log_id: number | null }
  | { ok: false; code: string; message: string; refused: Refused[] };
export async function pipelineStep(env: Env, a: PipelineStepArgs): Promise<PipelineStepResult> {
  const art = await artOfDeck(env, a.deckId, a.projectId);
  const charged = async (id: number | null | undefined) => {
    if (!id) return null;
    const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(id, a.userId).first<any>().catch(() => null);
    return row?.charged_microusd == null ? null : Number(row.charged_microusd);
  };
  const refused: Refused[] = [];
  let last: { code: string; message: string } = { code: 'image_refused', message: 'The image was not used. You were not charged for it.' };
  for (let v = 0; v < 2; v += 1) {
    const pipelineUid = crypto.randomUUID();
    const seed = seedOf(art.seed_base, a.cardUid, a.area, v);
    const r = await runPipeline({
      userId: a.userId, rail: a.rail, base: a.base, draw: a.draw, size: a.size, seed, art: art.art,
      ...(a.parentHold ? { parentHold: a.parentHold } : {}),
    }, { run: a.run, quoteRun: (o) => quoteRun(env, o) as any, charged });
    if (r.ok) {
      return { ok: true, image: r.image, model: r.model, alt: r.alt, seed, variant_index: v, pipeline_uid: pipelineUid, steps: r.steps, qa: r.qa, refused, usage_log_id: r.draw_usage_log_id };
    }
    last = { code: r.code, message: r.message };
    if (!r.image) break; // the draw itself failed: nothing to check, nothing to redraw
    if (a.parentHold) await refundSettled(env, { reservationUid: a.parentHold.uid, userId: a.userId, usageLogIds: r.usage_log_ids, projectId: a.projectId, pipelineUid, code: r.code });
    refused.push({ pipeline_uid: pipelineUid, variant_index: v, code: r.code, message: r.message, steps: r.steps.map((s) => ({ ...s, charged_microusd: 0 })), charged_microusd: 0, redraw: false });
  }
  return { ok: false, ...last, refused };
}

/** What one image's every step holds, priced by the router (pd14's one quote). */
export async function quoteDeckImage(env: Env, a: DrawArgs) {
  return pipelineQuote(inputFor(a, a.art, 0, null), { quoteRun: (o) => quoteRun(env, o) as any });
}

/** Draw `ask.count` images (plus one redraw each with `autoRedraw`), checked, under one hold. */
export async function drawDeckImages(env: Env, a: DrawArgs): Promise<Drawn | { refusal: string; error: string }> {
  const art = a.art;
  const q = await quoteDeckImage(env, a);
  if (!q.ok) return { refusal: q.refusal, error: q.error };
  const tries = a.ask.count * (a.autoRedraw ? 2 : 1);
  let own: { uid: string; userId: number } | null = null;
  let parent = a.parentHold ?? null;
  if (!parent) {
    const held = await reserveAiBudget(env, a.userId, q.hold_microusd * tries);
    if (!held.ok) return { refusal: held.refusal, error: 'the press could not be held' };
    own = held.reservation;
    parent = own;
  }
  const charged = async (id: number | null | undefined) => {
    if (!id) return null;
    const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(id, a.userId).first<any>().catch(() => null);
    return row?.charged_microusd == null ? null : Number(row.charged_microusd);
  };
  const rows: any[] = [];
  const refused: Refused[] = [];
  let stopped: { code: string; message: string } | null = null;
  // A press starts at the card's next variant, so "draw one more" is a new seed
  // and not the same picture again; each row records its variant, so its seed
  // is still hash(seed_base, card_uid, area, variant_index).
  const last = await env.DB.prepare('SELECT MAX(variant_index) AS v FROM deck_images WHERE project_id = ? AND card_uid IS ?')
    .bind(a.projectId, a.cardUid).first<{ v: number | null }>();
  let variant = last?.v == null ? 0 : Number(last.v) + 1;
  try {
    for (let n = 0; n < a.ask.count; n += 1) {
      for (let attempt = 0; attempt < (a.autoRedraw ? 2 : 1); attempt += 1) {
        const v = variant;
        variant += 1;
        const pipelineUid = crypto.randomUUID();
        const rail = a.parentHold ? a.rail : { ...a.rail, record: `deckimg:${pipelineUid}` };
        const input = { ...inputFor(a, art, v, parent), rail };
        const r = await runPipeline({ ...input, draw: { ...input.draw, rail } }, { run: (o) => run(env, { ...o, surface: a.surface, rail: o.rail ?? rail }), quoteRun: (o) => quoteRun(env, o) as any, charged });
        const promptSha = await sha256Hex(new TextEncoder().encode(r.prompt));
        if (!r.ok && !r.image) { stopped = { code: r.code, message: r.message }; break; }
        if (!r.ok) {
          await refundSettled(env, { reservationUid: parent!.uid, userId: a.userId, usageLogIds: r.usage_log_ids, projectId: a.projectId, pipelineUid, code: r.code });
          const uid = crypto.randomUUID();
          await env.DB.prepare(`INSERT INTO deck_images (uid, project_id, deck_id, card, card_uid, r2_key, mime, size_bytes, source, prompt, style, aspect, use, state,
              model, charged_microusd, created_by, discarded_at, seed, steps, prompt_sha256, pipeline_uid, variant_index, qa_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'generated', ?, ?, ?, ?, 'discarded', ?, 0, ?, datetime('now'), ?, ?, ?, ?, ?, ?)`)
            .bind(uid, a.projectId, a.deckId, a.ask.card, a.cardUid, `refused/${a.projectId}/${uid}`, r.image?.mime ?? 'image/png', a.ask.description, a.ask.style, a.ask.aspect, a.ask.use,
              r.model, a.userId, input.seed, JSON.stringify(r.steps.map((s) => ({ ...s, charged_microusd: 0 }))), promptSha, pipelineUid, v, JSON.stringify({ ...r.qa, code: r.code })).run();
          const willRedraw = !!a.autoRedraw && attempt === 0;
          refused.push({ pipeline_uid: pipelineUid, variant_index: v, code: r.code, message: r.message, steps: r.steps.map((s) => ({ ...s, charged_microusd: 0 })), charged_microusd: 0, redraw: !willRedraw && attempt === 0 });
          if (willRedraw) continue;
          break;
        }
        const mime = ((MIMES as readonly string[]).includes(r.image.mime) ? r.image.mime : sniffMime(r.image.bytes)) as ImageMime | null;
        if (!mime) { stopped = { code: 'image_unreadable', message: 'The image came back in a format the deck cannot show. Nothing was placed.' }; break; }
        const stripped = stripMetadata(r.image.bytes, mime);
        const marked = withXmp(stripped, mime, aiXmpPacket(r.model));
        const bytes = marked ?? stripped;
        const size = dataSize(bytes, mime);
        const sha = await sha256Hex(stripped);
        const taken = await env.DB.prepare('SELECT 1 FROM deck_images WHERE project_id = ? AND sha256 = ?').bind(a.projectId, sha).first();
        const uid = crypto.randomUUID();
        const key = `deck-images/${a.projectId}/${uid}.${EXTENSION[mime]}`;
        try {
          await env.FILES!.put(key, bytes, { httpMetadata: { contentType: mime }, customMetadata: { projectId: String(a.projectId), userId: String(a.userId) } });
        } catch {
          stopped = { code: 'image_unsaved', message: 'Eadwyn drew the image, but it could not be stored. It was charged for the run; try again in a moment.' };
          break;
        }
        const total = r.steps.reduce((s, x) => (s == null || x.charged_microusd == null ? null : s + x.charged_microusd), 0 as number | null);
        const provenance = {
          pipeline_uid: pipelineUid, model: r.model, seed: input.seed, size: input.size, prompt_sha256: promptSha, expanded: r.expanded,
          art_direction: art.art, xmp: marked ? { DigitalSourceType: 'trainedAlgorithmicMedia', CreatorTool: r.model } : null,
        };
        await env.DB.prepare(`INSERT INTO deck_images (uid, project_id, deck_id, card, card_uid, r2_key, mime, size_bytes, width, height, sha256, source, prompt, style, aspect, use,
            state, model, alt, ai_usage_log_id, charged_microusd, created_by, seed, steps, prompt_sha256, pipeline_uid, variant_index, qa_json, provenance_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(uid, a.projectId, a.deckId, a.ask.card, a.cardUid, key, mime, bytes.byteLength, size?.width ?? r.image.width, size?.height ?? r.image.height, taken ? null : sha,
            a.ask.description, a.ask.style, a.ask.aspect, a.ask.use, r.model, r.alt ?? '', r.draw_usage_log_id, total, a.userId,
            input.seed, JSON.stringify(r.steps), promptSha, pipelineUid, v, JSON.stringify(r.qa), JSON.stringify(provenance)).run();
        rows.push(await env.DB.prepare('SELECT * FROM deck_images WHERE uid = ?').bind(uid).first());
        break;
      }
      if (stopped) break;
    }
  } finally {
    if (own) {
      const sum = await env.DB.prepare('SELECT COALESCE(SUM(charged_microusd), 0) AS c FROM ai_usage_logs WHERE reservation_uid = ? AND user_id = ?')
        .bind(own.uid, a.userId).first<{ c: number }>();
      const cost = Number(sum?.c ?? 0);
      await settleAiReservation(env, own, cost, cost === 0);
    }
  }
  return { rows, refused, stopped, hold_microusd: q.hold_microusd };
}
