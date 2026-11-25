// #8506: the record a patch carries: which run, attempt, task, target and controller revision made it.
/**
 * One repair attempt runs `prepare`, then `edit` and `verify` for up to three
 * rounds, then the caller's publish step. All of them run the controller (this
 * folder and the rest of `scripts/landing-bot`) from ONE commit, resolved once
 * by `prepare` (D8506). The edit job writes `record.json` beside the patch;
 * `verify` and the caller's publish step each rebuild what they expect from
 * their own inputs and refuse a patch whose record differs in any field:
 *
 *   { version: 1, repository, task_sha256, pr, head_sha, controller_sha, run_id, run_attempt, round, patch_sha256 }
 *
 * - a patch made by another controller revision is refused, so verify vouches for the code that made the edit;
 * - a patch made from another head is refused, so what is published is what was verified;
 * - a patch whose bytes changed after the edit job is refused (`patch_sha256`);
 * - a patch from an earlier attempt of the same run (a re-run reusing its artifact) is refused (`run_attempt`).
 *
 * The record is not a signature: the edit job could lie in it. What it buys is that every job compares the same
 * fields against inputs it did not take from the edit job, so a mix-up between revisions, heads, attempts or
 * artifacts stops the attempt instead of publishing.
 */
import { sha256 } from './workspace.mjs';

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[1-9][0-9]{0,19}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** A digest of the parsed task, so every job agrees on it whatever whitespace the file had. */
export const taskDigest = (task) => sha256(JSON.stringify(task));

/** The run's identity from the Actions environment; a field it cannot read is null, and null is refused. */
export function identityFrom(env = {}) {
  const pick = (v, re) => (typeof v === 'string' && re.test(v) ? v : null);
  return { repository: pick(env.GITHUB_REPOSITORY, REPO), run_id: pick(env.GITHUB_RUN_ID, ID), run_attempt: pick(env.GITHUB_RUN_ATTEMPT, ID) };
}

/** Problems with the inputs a record is built from; [] means a record can be written. */
export function identityProblems({ identity, controller, head }) {
  const problems = [];
  if (!identity?.repository) problems.push('the repository is unknown');
  if (!identity?.run_id) problems.push('the run id is unknown');
  if (!identity?.run_attempt) problems.push('the run attempt is unknown');
  if (!SHA.test(String(controller))) problems.push('the controller revision is not a full commit SHA');
  if (!SHA.test(String(head))) problems.push('the target head is not a full commit SHA');
  return problems;
}

/** The record the edit job writes beside `patch.json`; `patchText` is that file's exact text. */
export function recordFor({ identity, task, controller, head, round, patchText }) {
  return {
    version: 1,
    repository: identity.repository,
    task_sha256: taskDigest(task),
    pr: task.pr ?? null,
    head_sha: head,
    controller_sha: controller,
    run_id: identity.run_id,
    run_attempt: identity.run_attempt,
    round: Number(round),
    patch_sha256: sha256(patchText),
  };
}

/**
 * Problems with a record against what the reading job expects; [] means it matches.
 * `expected` holds { identity, task, controller, head, round?, patchText }; `round` is checked only when given
 * (the publish step reads whichever round passed).
 */
export function checkRecord(record, expected) {
  if (!record || typeof record !== 'object' || record.version !== 1) return ['the patch carries no record, or a malformed one'];
  const problems = identityProblems(expected);
  if (!expected.task || typeof expected.task !== 'object') problems.push('the task is unknown');
  if (typeof expected.patchText !== 'string') problems.push('the patch could not be read');
  if (problems.length) return problems.map((p) => `cannot check the record: ${p}`);
  const want = recordFor({ ...expected, round: expected.round ?? record.round });
  const names = {
    repository: 'another repository',
    task_sha256: 'another task',
    pr: 'another pull request',
    head_sha: 'another head',
    controller_sha: 'another controller revision',
    run_id: 'another run',
    run_attempt: 'another attempt of this run',
    round: 'another round',
    patch_sha256: 'other patch bytes than the ones it names',
  };
  for (const [k, what] of Object.entries(names)) {
    if (record[k] !== want[k]) problems.push(`the patch was made for ${what} (${k})`);
  }
  return problems;
}

/** The patch's exact text and its record from a patch folder; a record that cannot be read is null (refused). */
export function readPatchRecord(dir, read) {
  const patchText = read(`${dir}/patch.json`);
  let record = null;
  try { record = JSON.parse(read(`${dir}/record.json`)); } catch { /* null: refused by checkRecord */ }
  return { patchText, record };
}

/**
 * #8506: the caller's publish step (the resolver's and main repair's `apply`). It checked out its controller at
 * `GITHUB_SHA` and receives the model runner's `controller` output as `CONTROLLER_SHA`: the two must be one
 * commit, and the patch's record must name it, this run and attempt, the task and the head the caller planned.
 */
export function publishRecordProblems({ env, task, head, patchText, record }) {
  const controller = env.CONTROLLER_SHA;
  const problems = [];
  if (!SHA.test(String(controller)) || controller !== env.GITHUB_SHA) {
    problems.push('the publish step does not run the controller revision the patch was made and verified with');
  }
  return [...problems, ...checkRecord(record, { identity: identityFrom(env), task, controller, head, patchText })];
}
