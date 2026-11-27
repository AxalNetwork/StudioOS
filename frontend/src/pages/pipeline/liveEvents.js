// #4701 — what the Pipeline board does with a socket message. Pure, so a test
// drives it without a socket.

/**
 * Every event that changes what the board draws. Keep in step with the
 * `notifyPipelineRoom` call sites in `routes/pipeline.ts` — a new type that is
 * not listed here is swallowed and the board goes stale until a reload.
 */
export const BOARD_EVENTS = new Set([
  'stage_advanced',
  'project_created',
  'gate_review_created',
  'gate_decided',
]);

/**
 * Route one message. `refresh` re-reads the board (the board sync decides when,
 * so an event that lands during a local move is queued rather than dropped);
 * `tally` receives a vote update. Returns what it did, for the caller's tests.
 */
export function routeBoardEvent(msg, { refresh, tally }) {
  if (!msg || !msg.type) return 'ignored';
  if (msg.type === 'vote_updated') {
    const dealId = Number(msg.deal_id);
    if (!Number.isFinite(dealId) || !msg.tally || typeof msg.tally !== 'object') return 'ignored';
    tally(dealId, msg.tally, Number(msg.ts) || 0);
    return 'tally';
  }
  if (BOARD_EVENTS.has(msg.type)) { refresh(); return 'refresh'; }
  return 'ignored';
}

/**
 * Keep the newest tally per deal. Events can arrive out of order across a
 * reconnect; an older one must not overwrite a newer one. A tally with no
 * timestamp (0) never beats one that has.
 */
export function acceptTally(known, dealId, tally, ts) {
  const have = known[dealId];
  if (have && ts && have.ts && ts < have.ts) return known;
  return { ...known, [dealId]: { tally, ts } };
}

/**
 * A pushed tally is the public aggregate: it carries no `my_vote`, because that
 * is the viewer's own and was never broadcast. Merge it over what this viewer
 * already holds so their own vote highlight survives someone else's vote.
 */
export function mergePushedTally(current, pushed) {
  if (!pushed) return current;
  return { ...pushed, my_vote: current?.my_vote ?? null };
}
