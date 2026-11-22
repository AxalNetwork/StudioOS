// #6474: which conflicted PRs the branch keeper may merge main into this sweep: pure, from data the workflow read.
import { attempts, budget, count, eligible, LABELS, mode, order, QUIET_MINUTES } from './rules.mjs';

export const KIND = 'keeper';
export const RESERVATION_PREFIX = 'landing-bot-keeper-';
const RESERVATION = /^landing-bot-keeper-(\d{4}-\d{2}-\d{2})-([1-9]\d*)-([1-9]\d*)-(0|[1-9]\d*)$/;
const time = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const names = (labels) => (labels || []).map((l) => (typeof l === 'string' ? l : l?.name));

export function reservationName({ day, runId, attempt, n }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || ![runId, attempt].every((v) => Number.isSafeInteger(v) && v > 0) || !Number.isSafeInteger(n) || n < 0) {
    throw new Error('invalid keeper reservation');
  }
  return `${RESERVATION_PREFIX}${day}-${runId}-${attempt}-${n}`;
}

/**
 * Pushes reserved today, from the reservation artifacts of today's keeper runs. Each run uploads its reservation
 * before it may push, and its push step runs only if that upload succeeded, so a run without one pushed nothing.
 * @param artifactsByRun Map(runId -> [{ name }]) for every keeper run created today
 */
export function pushesReserved(artifactsByRun, day) {
  const out = [];
  for (const [runId, files] of artifactsByRun) {
    for (const f of files || []) {
      if (typeof f?.name !== 'string' || !f.name.startsWith(RESERVATION_PREFIX)) continue;
      const m = RESERVATION.exec(f.name);
      if (!m || Number(m[2]) !== runId) throw new Error('a keeper reservation is malformed');
      if (m[1] !== day) continue;
      for (let i = 0; i < Number(m[4]); i++) out.push({ at: `${day}T00:00:00Z` });
    }
  }
  return out;
}

/**
 * The sweep's plan.
 * @param prs [{ number, state, draft, body, labels, mergeable: 'CONFLICTING'|'MERGEABLE'|'UNKNOWN', inMergeQueue,
 *              headChangedAt, handedBackAt, head: { ref, sha, repo: { full_name } }, base: { repo: { full_name } },
 *              files: [{ path }] | null, commits: [...] | null, ownerQueued }]
 * @param ctx { env, event, dispatchPr, repo, breakers: { open, reasons }, botLogin, now, pushesToday: [{ at }] | null }
 * @returns { act: [pr], skipped: [{ number, reasons }] }
 */
export function plan(prs, ctx) {
  const { env = {}, now } = ctx;
  const skipped = [];
  const ready = [];
  const quiet = (env.LANDING_BOT_QUIET_MIN ?? '') === '' ? QUIET_MINUTES : count(env.LANDING_BOT_QUIET_MIN);
  for (const pr of prs || []) {
    const reasons = [];
    if (pr?.mergeable !== 'CONFLICTING') reasons.push('not conflicting (a PR that is only behind is left to the queue)');
    if (pr?.inMergeQueue !== false) reasons.push('in the merge queue, or its queue state could not be read');
    const changed = time(pr?.headChangedAt);
    if (changed === null || now - changed < quiet * 60_000) reasons.push(`its head changed under ${quiet} minutes ago`);
    const labels = names(pr?.labels);
    const handedBack = time(pr?.handedBackAt);
    // D6476-p5: the keeper's own hand-back (bot:keeper-tried) or a session hand-back, never the PR-list `conflict`
    // indicator, which any reader may add and which must not stop a keeper run that is otherwise allowed.
    if ((labels.includes(LABELS.keeperTried) || labels.includes(LABELS.needsSession)) && (handedBack === null || changed === null || changed <= handedBack)) {
      reasons.push('handed back; waiting for the session to push');
    }
    const e = eligible(pr, { env, event: ctx.event, dispatchPr: ctx.dispatchPr, repo: ctx.repo, files: pr?.files ?? null, kind: KIND, breakers: ctx.breakers });
    reasons.push(...e.reasons);
    const a = attempts(pr, KIND, { botLogin: ctx.botLogin, now, commits: pr?.commits ?? null, runs: [] });
    reasons.push(...a.reasons);
    if (reasons.length) skipped.push({ number: pr?.number ?? null, reasons });
    else ready.push(pr);
  }
  const cap = mode(env) === 'dispatch' ? 1 : count(env.LANDING_BOT_KEEPER_PER_SWEEP);
  const act = [];
  const used = Array.isArray(ctx.pushesToday) ? [...ctx.pushesToday] : null;
  for (const pr of order(ready)) {
    if (act.length >= cap) { skipped.push({ number: pr.number, reasons: [`LANDING_BOT_KEEPER_PER_SWEEP (${cap}) reached`] }); continue; }
    const b = budget(KIND, env, { now, pushes: used });
    if (!b.allowed) { skipped.push({ number: pr.number, reasons: b.reasons }); continue; }
    act.push(pr);
    used.push({ at: new Date(now).toISOString() });
  }
  return { act, skipped };
}
