#!/usr/bin/env node
/**
 * D5398 (#5398): label a PR's red CI as its own or inherited from a red main, read-only. The rule is
 * `lib/ciClassify.mjs`; this reads the GitHub API and writes the verdict to the job summary.
 *
 *   GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_ID (this PR's CI run), [CI_WORKFLOW=ci.yml], [GITHUB_STEP_SUMMARY]
 *   node scripts/ci-classify.mjs
 *
 * It never fails the job it runs in: a read that fails is `main_health_unknown`, and every error exits 0.
 */
import { appendFileSync } from 'node:fs';
import { classify, infraFingerprint, summary } from './lib/ciClassify.mjs';
import { ALERT_KINDS } from './lib/githubAlerts.mjs';

const env = process.env;
const repo = env.GITHUB_REPOSITORY;

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
const jobsOf = async (runId) => (await gh(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`)).jobs || [];

async function main() {
  const pr = await jobsOf(env.RUN_ID);
  const fingerprint = infraFingerprint(pr);
  if (fingerprint) {
    const text = summary({ verdict: 'infra_failure', reason: `Runner setup failed: ${fingerprint}.`, shared: [], own: [] });
    console.log(text);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
    return;
  }
  let main = null; let mainRunUrl = null; let incident = null;
  try {
    const list = await gh(`/repos/${repo}/actions/workflows/${env.CI_WORKFLOW || 'ci.yml'}/runs?branch=main&event=push&status=completed&per_page=1`);
    const run = list?.workflow_runs?.[0];
    if (run) { main = { conclusion: run.conclusion, jobs: await jobsOf(run.id) }; mainRunUrl = run.html_url; }
  } catch (e) { console.log(`main's CI could not be read: ${e.message}`); }
  try {
    const issues = await gh(`/repos/${repo}/issues?state=open&per_page=100&sort=created&direction=desc`);
    incident = (issues || []).find((i) => !i.pull_request && i.title === ALERT_KINDS['main-red'].title)?.html_url || null;
  } catch { /* the incident link is a convenience */ }
  const result = classify({ pr, main, incident });
  const text = summary(result, { mainRunUrl });
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  if (result.verdict === 'inherited_main_failure') console.log('::notice::inherited_main_failure: every failed part is red on main too (D5398).');
}

main().catch((e) => console.log(`::warning::ci-classify: ${e.message}`));
