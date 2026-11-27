// #6474: which conflicted PRs the branch keeper may merge main into this sweep: pure, from data the workflow read.
import { attempts, budget, count, eligible, LABELS, mode, order, QUIET_MINUTES } from './rules.mjs';

export const KIND = 'keeper';
export const RESERVATION_PREFIX = 'landing-bot-keeper-';
const RESERVATION = /^landing-bot-keeper-(\d{4}-\d{2}-\d{2})-([1-9]\d*)-([1-9]\d*)-(0|[1-9]\d*)$/;
const time = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const names = (labels) => (labels || []).map((l) => (typeof l === 'string' ? l : l?.name));
const login = (a) => (typeof a === 'string' ? a : a?.login) ?? null;

/**
 * D6476-p6 (#8077): at most three keeper attempts on one pull request, whatever their outcome. The third hands the PR
 * back to its session for good; no later sweep, push or dispatch makes a fourth.
 */
export const KEEPER_MAX_ATTEMPTS = 3;
const ATTEMPT_LINE = /^Keeper attempt ([1-9]\d*) of \d+: .*$/gm;
const KEEPER_TRAILER = /^Landing-Bot-Kind:\s*keeper\s*$/m;

/** The `Keeper attempt k of 3: …` lines of a sticky comment body, oldest first, one per k. */
export function attemptLines(body) {
  const byK = new Map();
  for (const m of String(body ?? '').matchAll(ATTEMPT_LINE)) byK.set(Number(m[1]), m[0]);
  return [...byK.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line);
}

/**
 * Attempts the keeper has used on this PR, from three records: the App's `bot:keeper-tried` label events, the App's
 * keeper merge commits on the branch, and the attempt lines in its sticky comment. GitHub writes no new label event
 * when the label is already on the PR, so the sticky lines are the durable count; the larger of the two counts wins.
 * @param pr { keeperTriedEvents: [{ at, actor }] | null, commits: [...] | null, stickyBody: string | null }
 * @returns { used: number | null, reasons } — `used` is null when a record could not be read (nothing is planned)
 */
export function keeperAttempts(pr, botLogin) {
  const events = pr?.keeperTriedEvents;
  const commits = pr?.commits;
  const sticky = pr?.stickyBody;
  if (!botLogin || !Array.isArray(events) || !Array.isArray(commits) || typeof sticky !== 'string') {
    return { used: null, reasons: ['the keeper attempt record could not be read'] };
  }
  const labelled = events.filter((e) => login(e?.actor) === botLogin).length;
  const merged = commits.filter((c) => [login(c?.author), login(c?.committer)].includes(botLogin) && KEEPER_TRAILER.test(String(c?.commit?.message ?? c?.message ?? ''))).length;
  const used = Math.max(labelled + merged, attemptLines(sticky).length);
  const reasons = used >= KEEPER_MAX_ATTEMPTS ? [`the keeper used ${used} of ${KEEPER_MAX_ATTEMPTS} attempts on this pull request: handed back for good`] : [];
  return { used, reasons };
}

/**
 * What attempt `k` does when its merge leaves conflicts: the labels, whether the resolver is asked, and the sticky
 * comment. Below the cap the resolver is asked; the last attempt adds `needs-session` and asks no one.
 */
export function conflictOutcome(k, files) {
  const last = k >= KEEPER_MAX_ATTEMPTS;
  return {
    labels: [LABELS.conflict, LABELS.keeperTried, ...(last ? [LABELS.needsSession] : [])],
    dispatch: !last,
    outcome: `conflicts in ${files.length} file(s)${last ? '; handed back' : ''}`,
    lines: ['Merging main into this branch leaves conflicts in:', ...files.map((f) => `- \`${f}\``), '',
      last ? 'The owning session resolves them.' : 'The conflict resolver is asked to try; if it cannot, the owning session resolves them.'],
  };
}

/**
 * The sticky body for attempt `k`: the earlier attempt lines kept, this attempt's line (replacing a line for the same
 * k, so a rerun never counts twice), then this attempt's detail.
 */
export function composeSticky(previousBody, k, outcome, lines = []) {
  const kept = attemptLines(previousBody).filter((l) => !l.startsWith(`Keeper attempt ${k} of `));
  const all = [...kept, `Keeper attempt ${k} of ${KEEPER_MAX_ATTEMPTS}: ${outcome}`];
  const final = k >= KEEPER_MAX_ATTEMPTS
    ? ['', `That was the last of ${KEEPER_MAX_ATTEMPTS} keeper attempts: the keeper hands this pull request back to its session for good and never tries it again.`]
    : [];
  return [...all, ...(lines.length ? ['', ...lines] : []), ...final];
}

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
    // D6476-p6: checked after the hand-back above, and never cleared by a push: three is the most, for good.
    const k = keeperAttempts(pr, ctx.botLogin);
    reasons.push(...k.reasons);
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
