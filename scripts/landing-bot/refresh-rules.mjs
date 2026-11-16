// #6478: the serial refresh's pure rules: which PRs went red only because main was, how many may refresh now, and the loop.
import { count, eligible, LABELS, order, verdictFor } from './rules.mjs';

export const KIND = 'refresh';
export const RESERVATION_PREFIX = 'landing-bot-refresh-';
const RESERVATION = /^landing-bot-refresh-(\d{4}-\d{2}-\d{2})-([1-9]\d*)-([1-9]\d*)-(0|[1-9]\d*)$/;

/**
 * Open, non-draft PRs whose latest CI run on the current head failed only because main was red.
 * @param prs [{ number, draft, head: { sha }, labels, latestRun: { head_sha, conclusion, jobs } | null, ... }]
 * @param main main's CI run that the PR runs failed against: { conclusion, jobs }
 */
export function inherited(prs, main) {
  const picked = [];
  const skipped = [];
  for (const pr of prs || []) {
    const why = [];
    if (pr.draft) why.push('a draft: it refreshes on its next push');
    const run = pr.latestRun;
    if (!run || run.head_sha !== pr.head?.sha) why.push('no CI run on its current head');
    else if (run.conclusion !== 'failure') why.push(`its latest run is ${run.conclusion}`);
    else {
      const v = verdictFor({ jobs: run.jobs, main });
      if (v !== 'inherited_main_failure') why.push(`verdict ${v}`);
    }
    if (why.length) skipped.push({ number: pr.number, reasons: why }); else picked.push(pr);
  }
  return { picked: order(picked), skipped };
}

/** Refreshes reserved in the last window, from today's and yesterday's reservation artifacts ({ name, created_at }). */
export function allowance(artifacts, env, now) {
  const per = count(env.LANDING_BOT_REFRESH_PER_WINDOW);
  const windowMin = count(env.LANDING_BOT_REFRESH_WINDOW_MIN);
  if (!per || !windowMin) return { n: 0, reason: 'LANDING_BOT_REFRESH_PER_WINDOW and LANDING_BOT_REFRESH_WINDOW_MIN must both be set' };
  if (!Array.isArray(artifacts)) return { n: 0, reason: 'recent refreshes could not be counted' };
  let used = 0;
  for (const a of artifacts) {
    if (typeof a?.name !== 'string' || !a.name.startsWith(RESERVATION_PREFIX)) continue;
    const m = RESERVATION.exec(a.name);
    const at = Date.parse(a.created_at);
    if (!m || !Number.isFinite(at)) return { n: 0, reason: 'a refresh reservation is malformed' };
    if (now - at < windowMin * 60_000) used += Number(m[4]);
  }
  return { n: Math.max(0, per - used), used, per, windowMin };
}

export function reservationName({ day, runId, attempt, n }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || ![runId, attempt].every((v) => Number.isSafeInteger(v) && v > 0) || !Number.isSafeInteger(n) || n < 0) throw new Error('invalid refresh reservation');
  return `${RESERVATION_PREFIX}${day}-${runId}-${attempt}-${n}`;
}

/**
 * One PR at a time. Before each: `recheck(pr)` re-reads the mode, `bot:off`, the head and `breakers('refresh')`
 * and returns { stop?: reason, skip?: reason }. `update(pr)` calls update-branch and returns
 * { ok } | { conflict } | { refused: status }. A stop ends the run at once.
 */
export async function refreshSerially(prs, n, { recheck, update, label }) {
  const log = [];
  let done = 0;
  for (const pr of prs) {
    if (done >= n) { log.push({ number: pr.number, result: 'left for the next window' }); continue; }
    const r = await recheck(pr);
    if (r?.stop) { log.push({ number: pr.number, result: `stopped: ${r.stop}` }); break; }
    if (r?.skip) { log.push({ number: pr.number, result: `skipped: ${r.skip}` }); continue; }
    const u = await update(pr);
    done += 1;
    if (u?.ok) log.push({ number: pr.number, result: 'refreshed' });
    else if (u?.conflict) { await label(pr, LABELS.conflict); log.push({ number: pr.number, result: 'conflict: labelled for the branch keeper' }); }
    else log.push({ number: pr.number, result: `update-branch refused (HTTP ${u?.refused ?? '?'})` });
  }
  return { done, log };
}

/** The per-PR recheck's pure part. */
export function recheckOne(pr, now, { env, event, dispatchPr, repo, files, breakers }) {
  if (breakers?.open) return { stop: breakers.reasons.join('; ') || 'a breaker is open' };
  if (now.head?.sha !== pr.head.sha) return { skip: 'its head changed' };
  if (now.draft) return { skip: 'it became a draft' };
  const e = eligible({ ...now, number: pr.number }, { env, event, dispatchPr, repo, files, kind: KIND, breakers });
  if (!e.ok) return { skip: e.reasons.join('; ') };
  return {};
}
