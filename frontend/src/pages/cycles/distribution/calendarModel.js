/** D4489 — UTC calendar arithmetic, independent of browser timezone. */
export const PREVIEW_WIDTHS = Object.freeze({ linkedin: 552, x: 598, instagram: 468, facebook: 500, youtube: 315 });
export const dayKey = (d) => d.toISOString().slice(0, 10);
export function monthGrid(date) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, i) => new Date(first.valueOf() + i * 86400000));
}
export function weekGrid(date) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, i) => new Date(first.valueOf() + i * 86400000));
}
export function dayPieces(pieces, day, expanded = false) {
  const all = pieces.filter((p) => p.planned_on === day);
  return { visible: expanded ? all : all.slice(0, 2), overflow: expanded ? 0 : Math.max(0, all.length - 2) };
}
export function pieceStatus(piece) {
  const key = piece.source === 'notion' ? 'planned' : piece.status;
  return { label: ({ idea: 'Idea', planned: 'Planned', scheduled: 'Scheduled', published: 'Published', dropped: 'Dropped', draft: 'Draft' })[key] || 'Not recorded',
    className: key === 'scheduled' ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : 'border text-gray-600 dark:text-gray-300', dropped: piece.status === 'dropped' };
}
export const FOUNDER_REASON = 'Only the founder publishes from this venture.';

/** Local raster previews only: never render an arbitrary URL from form/DOM text. */
export function previewImageUrl(value, origin) {
  if (typeof value !== 'string' || typeof origin !== 'string') return undefined;
  // Browser-created blob URLs end in a UUID. Disallow HTML, credentials,
  // query/fragment suffixes and every network/data/javascript URL.
  if (!/^blob:https?:\/\/[a-z0-9.:[\]-]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'blob:' || parsed.origin !== origin) return undefined;
    const id = parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1);
    return `blob:${origin}/${encodeURIComponent(id)}`;
  } catch { return undefined; }
}
