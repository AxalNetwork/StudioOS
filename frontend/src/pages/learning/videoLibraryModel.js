/** D4477: recorded video filters, transcript excerpts and validated initial playback time. */
export const VIDEO_LENGTH_OPTIONS = [
  { label: 'any', minutes: null },
  { label: 'up to 10 min', minutes: 10 },
  { label: 'up to 30 min', minutes: 30 },
];

export function videoCountLabel(shown, total) {
  return `${shown}${typeof total === 'number' && Number.isFinite(total) && total >= 0 ? ` of ${total}` : ''} video${shown === 1 && total == null ? '' : 's'}`;
}

const clock = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}` : `${String(minutes).padStart(2, '0')}:${rest}`;
};

/** Query is retained on the mapped row, never interpreted as HTML or a regular expression. */
export function transcriptHit(row) {
  if (row?.match?.in !== 'transcript') return null;
  const snippet = typeof row.match.snippet === 'string' ? row.match.snippet : '';
  const query = typeof row.query === 'string' ? row.query.trim() : '';
  const index = query ? snippet.toLowerCase().indexOf(query.toLowerCase()) : -1;
  const seconds = typeof row.match.at_seconds === 'number' && Number.isInteger(row.match.at_seconds) && row.match.at_seconds >= 0 ? row.match.at_seconds : null;
  return { title: row.title, seconds, at: seconds === null ? null : clock(seconds),
    before: index < 0 ? snippet : snippet.slice(0, index),
    match: index < 0 ? '' : snippet.slice(index, index + query.length),
    after: index < 0 ? '' : snippet.slice(index + query.length) };
}

export function itemHrefAt(row, seconds) {
  return row?.uid && Number.isInteger(seconds) && seconds >= 0 ? `/learning/videos/${encodeURIComponent(row.uid)}?t=${seconds}` : row?.href || null;
}

/** A time link is usable only when its integer is bounded by a recorded duration. */
export function parseVideoTime(value, duration) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= duration ? seconds : null;
}

export function videoStartAt(value, duration, resume) {
  return parseVideoTime(value, duration) ?? resume;
}

export function videoFilters(params) {
  return { topic: params.get('topic') || '', level: params.get('level') || '', max: params.get('max') || '' };
}

export function withVideoFilter(params, key, value) {
  const next = new URLSearchParams(params);
  next.set('tab', 'videos');
  if (value) next.set(key, value); else next.delete(key);
  return next;
}
