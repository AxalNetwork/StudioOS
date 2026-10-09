/**
 * D663 — seconds a deck share-link view spent on each slide
 * (`deck_view_slides`, migration 442). The share viewer's heartbeat
 * (`routes/decks.ts`) sends its running total per slide; this file cleans
 * them and stores each one bounded so a view's slides never add up to more
 * than the view's `read_seconds`. The Raise cycle's Pitch deck card reads
 * them (`services/raiseCycle.ts`).
 */
import type { Env } from '../types';

/** Highest slide index the heartbeat accepts (the store's CHECK). */
export const MAX_SLIDE_INDEX = 199;

/**
 * The seconds a slide may hold so the view's slides never add up to more than
 * the view's `read_seconds`. `requested` is the viewer's running total on
 * this slide; `otherSlides` what the view's other slides already hold.
 * The heartbeat's SQL applies this same bound inside its one statement.
 */
export function capSlideSeconds(readSeconds: number, otherSlides: number, requested: number): number {
  const room = Math.max(0, Math.floor(Number(readSeconds) || 0) - Math.max(0, Math.floor(Number(otherSlides) || 0)));
  return Math.max(0, Math.min(Math.floor(Number(requested) || 0), room));
}

/**
 * The viewer's per-slide running totals from one heartbeat, cleaned: whole
 * slide indexes 0–199 with whole positive seconds, at most 200, in slide
 * order. Anything else in the body is dropped, never stored.
 */
export function slideTotals(raw: unknown): Array<[number, number]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: Array<[number, number]> = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(k)) continue;
    const idx = Number(k);
    const sec = Math.floor(Number(v));
    if (idx > MAX_SLIDE_INDEX || !Number.isFinite(sec) || sec <= 0) continue;
    out.push([idx, Math.min(sec, 7200)]);
  }
  return out.sort((a, b) => a[0] - b[0]).slice(0, MAX_SLIDE_INDEX + 1);
}

/**
 * Store one slide's running total for a view, bounded in the same statement
 * by what the view's other slides already hold (`capSlideSeconds`, in SQL):
 * the view's slides never add up to more than its `read_seconds`, whatever
 * order or rate the heartbeats arrive in. A total only ever grows.
 */
export async function recordSlideSeconds(env: Env, viewId: number, deckId: number, slide: number, seconds: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO deck_view_slides (view_id, slide_index, seconds, updated_at)
     SELECT v.id, ?, MIN(?, v.read_seconds - COALESCE((SELECT SUM(o.seconds) FROM deck_view_slides o WHERE o.view_id = v.id AND o.slide_index != ?), 0)), datetime('now')
       FROM deck_share_views v
      WHERE v.id = ? AND v.deck_id = ?
        AND v.read_seconds - COALESCE((SELECT SUM(o.seconds) FROM deck_view_slides o WHERE o.view_id = v.id AND o.slide_index != ?), 0) > 0
     ON CONFLICT(view_id, slide_index) DO UPDATE SET seconds = MAX(seconds, excluded.seconds), updated_at = excluded.updated_at`,
  ).bind(slide, seconds, slide, viewId, deckId, slide).run();
}
