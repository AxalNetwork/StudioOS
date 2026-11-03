/**
 * D4181 (#4181, lr17) — what the studio's analytics Sheet says about one
 * video, from `GET /api/admin/learning/items/:uid/analytics`. Pure.
 *
 * Under five viewers the reply carries no figure and the Sheet says only "Not
 * enough views to show". A figure the reply marks unavailable reads its own
 * reason ("Not recorded"), never 0. No member is named anywhere: the reply
 * holds counts, a rate, a median and a curve of shares.
 */
import { clockLabel } from './learningModel';

export const SHEET_SUB = 'Video · reads the positions the player writes';
export const NOT_ENOUGH = 'Not enough views to show';
export const NOT_RECORDED = 'Not recorded';
export const CURVE_TITLE = 'Drop-off over the video';
export const CURVE_NOTE = 'Viewers still watching through the video, span by span, with its chapters.';

const absent = (block) => (block && block.available === false ? block.reason || NOT_RECORDED : null);

/** The Sheet's view of one reply: `{ enough: false, line }` or the tiles, the curve and its lines. */
export function analyticsView(reply) {
  const a = reply?.analytics;
  const title = String(reply?.item?.title || '').trim() || 'This video';
  if (!a || a.enough !== true) return { title, enough: false, line: a?.reason || NOT_ENOUGH };
  const median = a.median_watch_seconds;
  const tiles = [
    { key: 'views', label: 'Views', value: String(a.views) },
    { key: 'completion', label: 'Completion rate', value: `${a.completion_pct}%` },
    { key: 'median', label: 'Median watch time', value: absent(median) ? null : clockLabel(median?.value), reason: absent(median) },
  ];
  const curveAbsent = absent(a.drop_off);
  const d = curveAbsent ? null : a.drop_off?.value;
  const duration = reply?.item?.duration_seconds ?? null;
  const markers = (Array.isArray(a.chapters) ? a.chapters : [])
    .filter((c) => Number.isFinite(c?.start_seconds) && duration > 0 && c.start_seconds < duration)
    .map((c) => ({ title: c.title, at: clockLabel(c.start_seconds), pct: (c.start_seconds / duration) * 100 }));
  const drop = d?.biggest_drop;
  return {
    title,
    enough: true,
    tiles,
    curve: d ? {
      bars: d.buckets.map((b) => ({ ...b, from: clockLabel(b.start_seconds), label: `${clockLabel(b.start_seconds)}–${clockLabel(b.end_seconds)}: ${b.still_watching_pct}% still watching` })),
      markers,
      biggest: drop ? `Biggest drop at ${clockLabel(drop.at_seconds)}${drop.chapter ? ` ${drop.chapter}` : ''}: ${drop.points} points.` : 'No drop between spans.',
      unrecorded: d.unrecorded > 0 ? `${d.unrecorded} ${d.unrecorded === 1 ? 'view' : 'views'} without a recorded position: ${NOT_RECORDED}` : null,
    } : null,
    curveReason: curveAbsent,
  };
}

/** Whether a studio row opens the Sheet: a video item only (a reading has no positions). */
export const hasAnalytics = (row) => row?.kind === 'video' && Boolean(row?.uid);
