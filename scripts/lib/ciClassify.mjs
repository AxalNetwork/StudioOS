/**
 * D5398 (#5398): is a PR's red CI its own, or inherited from a red main? The pure half; the CLI that reads the
 * GitHub API is `../ci-classify.mjs`.
 *
 * One broken merge turned dozens of PRs red at once, and each slot then fixed, ported or re-ran the same thing. This
 * says which case a PR is in, so one repair is made on main and nobody chases the same failure on their branch.
 *
 * IT NEVER TURNS A FAILURE GREEN. It only labels it, and it fails safe: anything it cannot prove is inherited is
 * `pr_failure` (look at it) or `main_health_unknown` (main's state could not be read), never `inherited_main_failure`.
 *
 *   inherited_main_failure  every part failing on the PR is also failing on main's latest completed CI run
 *   pr_failure              at least one part fails on the PR but passed on main: that part is the PR's to fix
 *   main_health_unknown     main's latest CI run is missing, still running, cancelled, or its jobs could not be read
 *
 * The comparison is by CI part (job name, e.g. `suite (worker-1-of-6)`). A part failing on both can still hide a
 * second, PR-only failure inside it, so an inherited verdict says so, and the PR's own tests in that part still
 * count once main is green again.
 */
export const VERDICTS = Object.freeze(['pr_failure', 'inherited_main_failure', 'main_health_unknown', 'infra_failure']);

export const INFRA_STEPS = Object.freeze([
  /^Set up job$/,
  /^Run actions\/(?:checkout|setup-node)@[\w.-]+$/,
  /^(?:Run )?npm ci$/,
  /^Install [\w .-]+$/,
]);

/** Jobs whose failure is only a summary of others: the gate reports the suite parts. */
const SUMMARY_JOBS = new Set(['test:drift (full suite)']);
/**
 * A job name as it may appear in the summary: letters, digits, spaces and `( ) - _ : . / ↔`, at most 100 characters.
 * Job names come from the workflow file, which a pull request can change, so anything else is dropped rather than
 * written into the job summary (CodeQL: network data written to a file).
 */
export const safeJobName = (v) => {
  const s = String(v ?? '');
  return s.length <= 100 && /^[\p{L}\p{N} ()\-_:./↔]+$/u.test(s) ? s : '';
};
/** Only a github.com page reaches the summary as a link. */
export const safeGithubUrl = (v) => (typeof v === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues|actions\/runs)\/\d+$/.test(v) ? v : null);

/** Ignore the dependent summary gate. Every failed leaf must have a known setup failure. */
export function infraFingerprint(jobs) {
  const failed = (jobs || []).filter(j => ['failure', 'timed_out'].includes(j?.conclusion) && !SUMMARY_JOBS.has(j.name));
  if (!failed.length) return null;
  const fingerprints = [];
  for (const job of failed) {
    const name = safeJobName(job.name).replace(/ \((?:frontend|worker)-\d+-of-\d+\)$/, '');
    const step = safeJobName(job.steps?.find(s => s.conclusion === 'failure')?.name);
    if (!name || !INFRA_STEPS.some(pattern => pattern.test(step))) return null;
    fingerprints.push(`${name}/${step}`);
  }
  return fingerprints.sort()[0];
}
/** A PR job whose name is not shown still counts as the PR's own failure, never as inherited. */
export const UNSHOWN_JOB = '(a job whose name is not shown)';
const failedNames = (jobs, unsafe = '') => [...new Set((jobs || [])
  .filter((j) => j && (j.conclusion === 'failure' || j.conclusion === 'timed_out'))
  .map((j) => safeJobName(j.name) || unsafe)
  .filter((n) => n && !SUMMARY_JOBS.has(n)))].sort();

/**
 * @param pr    the PR run's jobs: [{ name, conclusion }]
 * @param main  main's latest completed CI run: { conclusion, jobs: [{ name, conclusion }] }, or null when unread
 * @param incident  the open `[alert] main is red` issue's URL, if any
 */
export function classify({ pr, main, incident = null }) {
  const prFailed = failedNames(pr, UNSHOWN_JOB);
  if (!prFailed.length) return { verdict: 'pr_failure', prFailed, mainFailed: [], own: [], shared: [], incident, reason: 'No failed part was found on this PR run; read its own log.' };
  const usable = main && Array.isArray(main.jobs) && (main.conclusion === 'failure' || main.conclusion === 'timed_out' || main.conclusion === 'success');
  if (!usable) {
    return { verdict: 'main_health_unknown', prFailed, mainFailed: [], own: [], shared: [], incident, reason: 'main\'s latest CI run could not be read, or has not finished, so nothing here is called inherited.' };
  }
  const mainFailed = failedNames(main.jobs);
  const own = prFailed.filter((n) => !mainFailed.includes(n));
  const shared = prFailed.filter((n) => mainFailed.includes(n));
  if (own.length) {
    return { verdict: 'pr_failure', prFailed, mainFailed, own, shared, incident, reason: `${own.join(', ')} passed on main and failed here: that is this PR's to fix.` };
  }
  return {
    verdict: 'inherited_main_failure', prFailed, mainFailed, own, shared, incident,
    reason: 'Every failed part here is failing on main too. Do not port the fix, merge main or re-run for it: one repair goes to main.',
  };
}

/** The job summary, in Markdown. Links come from the API, never from a commit message or a PR body. */
export function summary(result, { mainRunUrl: rawRunUrl = null } = {}) {
  const mainRunUrl = safeGithubUrl(rawRunUrl);
  const incident = safeGithubUrl(result.incident);
  const lines = [`### CI failure: \`${result.verdict}\` (D5398)`, '', result.reason, ''];
  if (result.shared.length) lines.push(`Failing on main too: ${result.shared.map((n) => `\`${n}\``).join(', ')}`);
  if (result.own.length) lines.push(`This PR's own: ${result.own.map((n) => `\`${n}\``).join(', ')}`);
  if (mainRunUrl) lines.push(`Main's latest CI run: ${mainRunUrl}`);
  if (result.verdict === 'inherited_main_failure') {
    lines.push(incident ? `The red-main incident and its one repair: ${incident}` : 'No `[alert] main is red` issue is open yet; it opens within 15 minutes.');
    lines.push('', 'A part failing on both can still hide a PR-only failure inside it: once main is green, this PR\'s own tests in those parts still count.');
  }
  return lines.join('\n');
}
