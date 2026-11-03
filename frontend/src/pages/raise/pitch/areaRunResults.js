/**
 * D1512 (#3764) — what "Generate into N areas" shows when one run made every
 * area's proposals (`deckAreasApi.generate`): one result per variant, in the
 * shape `AreaResults.jsx` already draws, labelled by its model, its variant,
 * its cost and its seconds.
 *
 *   - A variant that failed carries its own sentence; the area's other
 *     variants stay acceptable.
 *   - Each result decides itself (`decide('accept' | 'discard')`) through the
 *     area routes, so Accept records the outcome #3761 reads, by the area's
 *     card and area.
 *   - An area the server refused (its gate, its plan, nothing to write from)
 *     shows the Worker's sentence and charges nothing.
 *   - An area still generating when the dialog stops waiting stays in the
 *     deck's proposals; it is not shown as failed.
 */
import { deckAreasApi } from '../../../lib/api/deckAreas.js';

export const STILL_RUNNING = 'Still generating. It stays in this deck’s proposals; nothing more was charged.';

const imageBlockOf = (image) => ({ kind: 'image', image_url: image.url, image_id: image.uid, alt: image.alt || '', tag: 'illustration', fit: 'cover', crop: { x: 50, y: 50 } });

function payloadResult(payload) {
  if (!payload) return null;
  if (payload.kind === 'text') return { kind: 'text', before: String(payload.before ?? ''), after: String(payload.after ?? '') };
  if (payload.kind === 'image' && payload.image?.uid) return { kind: 'image', imageUid: payload.image.uid, image: payload.image, block: imageBlockOf(payload.image) };
  if (payload.kind === 'block' && payload.block) return { kind: 'block', block: payload.block, title: payload.title ?? null };
  if (payload.kind === 'blocks' && Array.isArray(payload.blocks) && payload.blocks.length) return { kind: 'block', block: payload.blocks[0], title: payload.label ?? null };
  return null;
}

/** The lightbox's results for one area run: `{ results, refusal: null }`. */
export function areaRunResults(deckId, run) {
  const results = [];
  for (const p of run?.proposals ?? []) {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    if (p.state === 'running' || !variants.length) {
      results.push({ key: p.area_id, areaKey: p.area_id, status: 'not_run', line: STILL_RUNNING });
      continue;
    }
    const decide = (n) => (decision) => (decision === 'accept'
      ? deckAreasApi.accept(deckId, p.card_uid, p.area_id, p.uid, n)
      : deckAreasApi.discard(deckId, p.uid));
    for (const v of variants) {
      const label = [v.model_label, variants.length > 1 ? `variant ${v.n}` : null, v.seconds != null ? `${v.seconds} s` : null].filter(Boolean).join(' · ');
      const base = {
        key: variants.length > 1 ? `${p.area_id}~${v.n}` : p.area_id, areaKey: p.area_id, proposalUid: p.uid, variant: v.n, seed: v.seed ?? null,
        modelName: label, charged: v.cost_microusd ?? null, charges: p.kind !== 'records', critique: v.critique ?? null, decide: decide(v.n),
      };
      const shaped = v.state === 'ready' ? payloadResult(v.payload) : null;
      if (shaped) results.push({ ...base, status: 'proposed', ...shaped });
      else results.push({ ...base, status: 'refused', error: { message: v.error?.message || 'This variant has nothing to place.', code: v.error?.code ?? null } });
    }
  }
  for (const r of run?.refused ?? []) {
    results.push({ key: r.key, areaKey: r.key, status: 'refused', error: { message: r.refusal?.message || 'This area cannot run.', code: r.refusal?.code ?? null } });
  }
  return { results, refusal: null };
}
