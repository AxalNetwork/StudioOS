/**
 * D5080 (#5080) — the browser view of a summary derived from several reads.
 *
 * Source states use the Worker's platform vocabulary. `partial` belongs to
 * the derived answer: some required reads answered and some did not. A card
 * must check `complete` before saying none, all, every, or showing a zero.
 */
const FAILED = new Set(['unreadable', 'unavailable', 'refused']);

export function derivedSummary(value, sources = []) {
  const required = sources.filter((source) => source?.required !== false);
  const unreadable = required.filter((source) => FAILED.has(source?.state)).map((source) => source.key);
  const answered = required.length - unreadable.length;
  const state = unreadable.length
    ? answered > 0 ? 'partial' : 'unreadable'
    : value == null ? 'not_recorded' : 'recorded';
  return {
    state,
    value: state === 'unreadable' ? null : value,
    complete: unreadable.length === 0,
    sources: sources.map((source) => ({ ...source })),
    unreadable_sources: unreadable,
  };
}

/** Convert a page read state to the source vocabulary used above. */
export function summarySource(key, status, required = true) {
  const state = status === 'ready' || status === 'ok'
    ? 'recorded'
    : status === 'none' || status === 'not_recorded'
      ? 'not_recorded'
      : status === 'unavailable' ? 'unavailable' : status === 'loading' || status === 'idle' ? 'unreadable' : status;
  return { key, state, required };
}
