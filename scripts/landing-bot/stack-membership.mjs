// #8555 (D8555): read whether a PR belongs to a native GitHub stack, and hold every individual bot action on a member or an unknown.
/**
 * GitHub's contract (read 2026-11-27, D8555): the GraphQL `PullRequest` type has two read-only fields, `stack:
 * PullRequestStack` and `stackEntry: PullRequestStackEntry`, each documented as "null if it is not part of a stack".
 * `PullRequestStack` has `number`, `size` and `baseRefName`; `PullRequestStackEntry` has `position` (1 is the bottom),
 * `pullRequest` and `stack`. The REST pull resource carries a `stack` object only "when a pull request belongs to a
 * stack", so its absence there proves nothing; this adapter reads GraphQL, where a selected field answers either way.
 *
 * Results are `ordinary`, `member` or `unknown`. Only an answer that names this repository and this PR, serves both
 * fields, and sets both to null is `ordinary`. A failed, partial, contradictory or mismatched read is `unknown`, and
 * the guard holds `unknown` exactly as it holds `member`. The adapter makes one read per call and no write.
 */

export const ORDINARY = 'ordinary';
export const MEMBER = 'member';
export const UNKNOWN = 'unknown';

const REPO = /^[\w-]+\/[\w.-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const ERROR_MAX = 160;
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
// A bounded, one-line reason: an error message from the API never spills into a summary or an output line.
const bounded = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, ERROR_MAX);

// `$owner` and `$name` are filled by keeper.mjs's client().graph from the repository it was made for.
export const STACK_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){nameWithOwner
  pullRequest(number:$number){number headRefOid isDraft state isInMergeQueue autoMergeRequest{enabledAt}
    stack{number size baseRefName} stackEntry{position pullRequest{number} stack{number}}}}}`;

/**
 * Classify one GraphQL answer (the `repository` object). Pure.
 * @returns {{ status, repo, number, head, draft, queued, autoMerge, layer, stack, evidence, reason }}
 */
export function classify(repository, { repo, number } = {}) {
  const out = { status: UNKNOWN, repo: repo ?? null, number: number ?? null, head: null, draft: null, queued: null, autoMerge: null, layer: null, stack: null, evidence: null, reason: null };
  const unknown = (reason) => ({ ...out, reason: bounded(reason) });
  if (!REPO.test(repo ?? '') || !positive(number)) return unknown('the repository or PR number to read is not valid');
  if (!repository || typeof repository !== 'object') return unknown('GitHub returned no repository');
  if (typeof repository.nameWithOwner !== 'string' || repository.nameWithOwner.toLowerCase() !== repo.toLowerCase()) {
    return unknown(`GitHub answered for ${typeof repository.nameWithOwner === 'string' ? repository.nameWithOwner : 'an unnamed repository'}, not ${repo}`);
  }
  const pr = repository.pullRequest;
  if (!pr || typeof pr !== 'object') return unknown('GitHub returned no pull request');
  if (pr.number !== number) return unknown(`GitHub answered for #${pr.number}, not #${number}`);
  if (typeof pr.headRefOid !== 'string' || !SHA.test(pr.headRefOid)) return unknown('the head commit could not be read');
  out.head = pr.headRefOid;
  out.draft = typeof pr.isDraft === 'boolean' ? pr.isDraft : null;
  out.queued = typeof pr.isInMergeQueue === 'boolean' ? pr.isInMergeQueue : null;
  out.autoMerge = has(pr, 'autoMergeRequest') ? pr.autoMergeRequest !== null : null;
  // An older or partial answer without the fields is not proof of an ordinary PR.
  if (!has(pr, 'stack') || !has(pr, 'stackEntry')) return unknown('GitHub did not serve the stack and stackEntry fields');
  const { stack, stackEntry: entry } = pr;
  out.evidence = { stack: stack ?? null, stackEntry: entry ?? null };
  if (stack === null && entry === null) return { ...out, status: ORDINARY, reason: 'stack and stackEntry are both null' };
  if (stack === null || entry === null || typeof stack !== 'object' || typeof entry !== 'object') {
    return unknown('stack and stackEntry disagree about membership');
  }
  if (!positive(stack.number) || !positive(stack.size) || !positive(entry.position) || entry.position > stack.size) {
    return unknown('the stack number, size or position is not readable');
  }
  if (entry.pullRequest?.number !== number) return unknown(`the stack entry names #${entry.pullRequest?.number ?? '?'}, not #${number}`);
  if (entry.stack?.number !== stack.number) return unknown('the stack entry names another stack');
  out.stack = { number: stack.number, size: stack.size, position: entry.position, base: typeof stack.baseRefName === 'string' ? stack.baseRefName : null };
  out.layer = entry.position === 1 ? 'bottom' : 'upper';
  return { ...out, status: MEMBER, reason: `native stack #${stack.number}, layer ${entry.position} of ${stack.size}` };
}

/**
 * Read one PR's membership. `graph(query, variables)` is keeper.mjs's client().graph (it throws on GraphQL errors and
 * on an answer without `repository`). Never throws: a failed read is `unknown` with a bounded reason.
 */
export async function readMembership(graph, { repo, number }) {
  if (!REPO.test(repo ?? '') || !positive(number)) return classify(null, { repo, number });
  if (typeof graph !== 'function') return { ...classify(null, { repo, number }), reason: 'no GitHub reader' };
  let answer;
  try { answer = await graph(STACK_QUERY, { number }); } catch (e) {
    return { ...classify(null, { repo, number }), reason: bounded(`the stack read failed (${e?.message ?? e})`) };
  }
  return classify(answer, { repo, number });
}

/** The one summary line for a held action. */
export function holdLine(m, { boundary, expectedHead, moved }) {
  const where = `#${m.number ?? '?'} held before ${boundary}`;
  if (moved) return `${where}: the head moved since the plan (${String(expectedHead).slice(0, 10)} → ${String(m.head ?? 'unread').slice(0, 10)}); the planned action is stale`;
  if (m.status === MEMBER) {
    const queued = m.queued ? '; in the merge queue: its entry, order and auto-merge are left as they are' : '';
    return `${where}: ${m.layer} layer of ${m.reason}${m.draft ? ' (draft)' : ''}; native stacks are not maintained one PR at a time${queued}`;
  }
  return `${where}: stack membership unknown (${m.reason || 'not recorded'}); held until it reads as ordinary`;
}

/**
 * The guard every individual write or model dispatch calls first. It re-reads membership now and, when `expectedHead`
 * is given, the exact head. It proceeds only for an ordinary PR at that head.
 * @returns {{ hold: boolean, disposition: string, membership, line: string|null }}
 */
export async function stackGuard({ graph, repo, number, expectedHead, boundary }) {
  const m = await readMembership(graph, { repo, number });
  const pinned = expectedHead !== undefined && expectedHead !== null;
  const moved = pinned && (!SHA.test(String(expectedHead)) || m.head !== expectedHead);
  if (m.status === ORDINARY && !moved) return { hold: false, disposition: 'proceed', membership: m, line: null };
  // A member or an unknown is said as such; a moved head is the reason only for an otherwise ordinary PR.
  const disposition = m.status === MEMBER ? (m.queued ? 'held-queued-member' : 'held-member') : m.status === UNKNOWN ? 'held-unknown' : 'held-head-moved';
  return { hold: true, disposition, membership: m, line: holdLine(m, { boundary, expectedHead, moved: disposition === 'held-head-moved' }) };
}

/** Call-site shorthand: guard, write the hold line with `say`, and answer whether the caller must stop. */
export async function stackHeld(graph, { repo, number, head, boundary, say }) {
  const g = await stackGuard({ graph, repo, number, expectedHead: head, boundary });
  if (g.hold) say?.(`- ${g.line}`);
  return g.hold;
}

/** The planned PRs ({ number, head: { sha } }) that are ordinary at their planned head; the rest are said and dropped. */
export async function ordinaryOnly(graph, { repo, prs, boundary, say }) {
  const out = [];
  for (const p of prs) if (!(await stackHeld(graph, { repo, number: p.number, head: p.head?.sha, boundary, say }))) out.push(p);
  return out;
}

/**
 * The feeder (#6481): wrap its reader's `readLandingDecision` so a PR that is not an ordinary PR at the decision's head
 * never has `mayQueue: true`; plan and apply then pass it over with the failing gate named, as any other policy gate.
 */
export function gateLandingDecisions(reader, graph, { repo }) {
  const read = reader.readLandingDecision.bind(reader);
  reader.readLandingDecision = async (number) => {
    const d = await read(number);
    if (d?.mayQueue !== true) return d;
    const g = await stackGuard({ graph, repo, number, expectedHead: d.pr?.head_sha ?? 'unread', boundary: 'queue admission' });
    if (!g.hold) return d;
    return { ...d, mayQueue: false, gates: [...(Array.isArray(d.gates) ? d.gates : []), { name: 'native stack', ok: false, detail: g.line }] };
  };
  return reader;
}

/**
 * The feeder's write boundary: re-read membership and the exact head just before `enqueuePullRequest`. A held
 * candidate is not written and is reported `held`, which the sweep treats as a refusal.
 */
export function guardEnqueue(enqueue, graph, { repo, say }) {
  return async (candidate) => {
    const g = await stackGuard({ graph, repo, number: candidate?.number, expectedHead: candidate?.expectedHeadOid ?? 'unread', boundary: 'queue entry' });
    if (!g.hold) return enqueue(candidate);
    say?.(`- ${g.line}`);
    return { number: candidate?.number, expectedHeadOid: candidate?.expectedHeadOid, status: 'held', reason: g.line };
  };
}
