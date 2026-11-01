/**
 * D663 — seconds a deck share-link view spent on each slide
 * (`deck_view_slides`, migration 442). The share viewer's heartbeat
 * (`routes/decks.ts`) sends its running total per slide; this file cleans
 * them and stores each one bounded so a view's slides never add up to more
 * than the view's `read_seconds`. The Raise cycle's Pitch deck card reads
 * them (`services/raiseCycle.ts`).
 */
import type { Env } from '../types';
import { cardUidAt } from './decks/slideModel';

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

/**
 * D1500: name each counted slide's card by its uid (migration 714), read from
 * the version the view is of, so the seconds follow the card even after the
 * founder reorders it. Best effort: a database without 714, or a version that
 * cannot be read, keeps the seconds by place as before.
 */
export async function recordSlideCardUids(env: Env, viewId: number, deckId: number, slides: number[]): Promise<void> {
  if (!slides.length) return;
  try {
    // Only the slides still unnamed: a heartbeat after the first reads nothing more.
    const open = await env.DB.prepare('SELECT slide_index FROM deck_view_slides WHERE view_id = ? AND card_uid IS NULL').bind(viewId).all<{ slide_index: number }>();
    const todo = new Set((open.results || []).map((r) => Number(r.slide_index)));
    const wanted = slides.filter((s) => todo.has(s));
    if (!wanted.length) return;
    const row = await env.DB.prepare('SELECT slides FROM pitch_decks WHERE id = ?').bind(deckId).first<{ slides: string | null }>();
    const cards = JSON.parse(row?.slides || '[]');
    for (const slide of wanted) {
      const uid = cardUidAt(cards, slide);
      if (!uid) continue;
      await env.DB.prepare('UPDATE deck_view_slides SET card_uid = ? WHERE view_id = ? AND slide_index = ? AND card_uid IS NULL').bind(uid, viewId, slide).run();
    }
  } catch (e) {
    console.warn('[deck_view_slides] card_uid not recorded', (e as Error)?.message);
  }
}
