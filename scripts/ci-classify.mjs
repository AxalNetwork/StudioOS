#!/usr/bin/env node
/** D5502 (#5502): read-only, bounded diagnostics for PR, merge-group and main; never changes the failing gate. */
import { appendFileSync, writeFileSync } from 'node:fs';
import { collectEvidence, boundedBody } from './lib/ciFailureCollector.mjs';
import { renderEvidence } from './lib/ciFailures.mjs';
import { ALERT_KINDS } from './lib/githubAlerts.mjs';
const env = process.env;
async function main() {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '') || !/^\d+$/.test(env.RUN_ID || '')) throw new Error('invalid run coordinates');
  const request = path => fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000),
  });
  const api = async path => JSON.parse((await boundedBody(await request(path))).toString());
  const result = await collectEvidence({ api, download: async path => boundedBody(await request(path)), runId: env.RUN_ID, baseSha: env.CI_FAILURE_BASE });
  try {
    const issues = await api('/issues?state=open&per_page=100&sort=created&direction=desc');
    const incident = issues.find(i => !i.pull_request && i.title === ALERT_KINDS['main-red'].title)?.html_url;
    if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(incident || '')) result.incident = incident;
  } catch { /* Optional incident link never changes attribution. */ }
  let text = `${renderEvidence(result)}\n\n`;
  if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(result.runUrl || '')) text += `Tested run: ${result.runUrl}\n`;
  text += `Tested SHA: ${result.testedSha}\n`;
  for (const f of result.unknown) if (f.jobUrl) text += `Job: ${f.jobUrl}\n`;
  if (result.incident && result.shared.length) text += `Canonical incident: ${result.incident}\n`;
  text += result.warnings.join('\n');
  console.log(text.slice(0, 24000));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text.slice(0, 24000));
  writeFileSync('ci-failures-classified.json', JSON.stringify(result));
}
main().catch(() => {
  const text = '### CI failure evidence: main_health_unknown\n\nDiagnostic API unavailable. Read the failed jobs in this run; no failure is called inherited.\n';
  console.log(text); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text);
});
