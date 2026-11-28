// Run from the trusted default-branch copy of landing-feeder.yml.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGitHubReader } from './feeder-github.mjs';
import { reservationName, readDailyReservations } from './feeder-budget.mjs';
import { planSweep, applySweep } from './feeder-sweep.mjs';
import { enqueueCandidate } from './feeder-enqueue.mjs';
import { count, triggerAllowed } from './rules.mjs';
import { client } from './keeper.mjs';
import { gateLandingDecisions, guardEnqueue } from './stack-membership.mjs';

async function main(stage, env) {
  const repo = 'AxalNetwork/StudioOS';
  const event = env.GITHUB_EVENT_NAME;
  const dispatchPr = count(env.FEED_PR);
  const runId = count(env.GITHUB_RUN_ID);
  const attempt = count(env.GITHUB_RUN_ATTEMPT);
  if (!['plan', 'apply'].includes(stage) || env.GITHUB_REPOSITORY !== repo ||
      env.GITHUB_REF !== 'refs/heads/main' || !runId || attempt !== 1 ||
      !['schedule', 'workflow_dispatch'].includes(event) || env.LANDING_AUTO !== 'true' ||
      (event === 'workflow_dispatch' && !dispatchPr) || !triggerAllowed(env, {event, dispatchPr, prNumber: dispatchPr, kind: 'feeder'})) {
    throw new Error('Workflow invocation is outside the enabled landing policy.');
  }
  const reader = createGitHubReader({repo, token: env.GH_TOKEN, botLogin: env.LANDING_BOT_LOGIN || undefined});
  const planFile = join(env.RUNNER_TEMP, 'landing-feed-plan.json');
  const day = new Date().toISOString().slice(0, 10);
  const limit = count(env.LANDING_BOT_DAILY_FEEDS);
  // #8076 (D8076): a held candidate is said in one line in the run summary.
  const onHold = h => appendFileSync(env.GITHUB_STEP_SUMMARY, `PR #${h.number} — ${h.line}\n`);
  // #6481 (D6481-p2): a listed PR that is not admitted says why (checks, policy, conflict, hold, owner review, capacity).
  const onWait = w => appendFileSync(env.GITHUB_STEP_SUMMARY, `- ${w.number ? `PR #${w.number}` : 'Sweep'} waiting — ${w.line}\n`);
  const options = {repo, event, env, reader, dispatchPr, onHold, onWait};
  const ledger = async (slots = 0) => readDailyReservations({
    get: reader.get, runId, attempt, day, expectedSlots: slots, now: Date.now,
  });
  // #8555 (D8555): a native stack member or an unread membership is never admitted, and is re-read before the write.
  const stackRead = client({repo, token: env.GH_TOKEN}).graph;
  gateLandingDecisions(reader, stackRead, {repo});
  if (stage === 'plan') {
    const readRemainingDaily = async () => Math.max(0, limit - (await ledger()).used);
    const entries = await planSweep({...options, readRemainingDaily});
    const slots = entries.length;
    writeFileSync(planFile, JSON.stringify({day, runId, attempt, entries}), {mode: 0o600});
    appendFileSync(env.GITHUB_OUTPUT, `slots=${slots}\n`);
    appendFileSync(env.GITHUB_OUTPUT, `reservation=${reservationName({day, runId, attempt, slots})}\n`);
    appendFileSync(env.GITHUB_STEP_SUMMARY, `Selected ${slots} eligible pull request(s) for queue admission.\n`);
    return;
  }

  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  if (plan.day !== day || plan.runId !== runId || plan.attempt !== attempt || !Array.isArray(plan.entries) || !plan.entries.length) {
    throw new Error('The queue reservation does not match this run and UTC day.');
  }
  const readRemainingDaily = async () => {
    const {used, availableForCurrentRun} = await ledger(plan.entries.length);
    if (used > limit || availableForCurrentRun !== plan.entries.length) throw new Error('Unverified daily queue reservation.');
    return availableForCurrentRun;
  };
  const enqueue = async candidate => {
    if (new Date().toISOString().slice(0, 10) !== day) throw new Error('Reservation expired at UTC midnight.');
    const result = await enqueueCandidate(candidate, {appToken: env.FEED_APP_TOKEN});
    appendFileSync(env.GITHUB_STEP_SUMMARY, `PR #${candidate.number} at \`${candidate.expectedHeadOid}\` — ${result.status}\n`);
    return result;
  };
  const say = line => appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  await applySweep({...options, readRemainingDaily, enqueue: guardEnqueue(enqueue, stackRead, {repo, say})}, plan.entries);
}

main(process.argv[2], process.env).catch(error => {
  console.error(`Queue feeder stopped: ${error.message}`);
  process.exitCode = 1;
});
