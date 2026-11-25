#!/usr/bin/env node
/**
 * D8505 (#8505): the @claude workflow's admission, run in a job whose token is read-only.
 *
 *   node scripts/claude-code-admission.mjs                  decide; write the outputs and one summary line
 *   node scripts/claude-code-admission.mjs --verify-head    the model job's last gate: stop if the PR head moved
 *   node scripts/claude-code-admission.mjs --fixture F.json a dry run: the event and the API answers come from F,
 *                                                           nothing is read from the network, the decision is printed
 *
 * The workflow passes everything through `env:` (GITHUB_EVENT_PATH, GITHUB_TOKEN, CLAUDE_CODE_ALLOWED_ACTORS,
 * ADMITTED_KIND, ADMITTED_NUMBER, ADMITTED_HEAD_SHA); no event text is expanded into a script. It never prints a token.
 * A refusal exits 0 (the run ends there, with its reason in the summary); an internal error exits 1, admitting nothing.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { decide, headStillAdmitted, outputLines, parseAllowlist } from './lib/claudeCodeAdmission.mjs';

const args = process.argv.slice(2);
const env = process.env;

function githubApi(token, repository) {
  const get = async (path) => {
    const res = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'studioos-claude-code-admission' },
    });
    if (!res.ok) return null;
    return res.json();
  };
  return {
    permission: async (login) => (await get(`collaborators/${encodeURIComponent(login)}/permission`))?.permission ?? null,
    pullHead: async (n) => {
      const pr = await get(`pulls/${encodeURIComponent(String(n))}`);
      return pr?.head?.sha ? { sha: pr.head.sha, repository: pr.head.repo?.full_name ?? null } : null;
    },
  };
}

function fixtureApi(f) {
  return {
    permission: async (login) => f.permissions?.[login] ?? null,
    pullHead: async (n) => f.pulls?.[String(n)] ?? null,
  };
}

const summary = (line) => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`); };

async function main() {
  if (args[0] === '--fixture') {
    const f = JSON.parse(readFileSync(args[1], 'utf8'));
    const d = await decide({ eventName: f.eventName, event: f.event, repository: f.repository, ref: f.ref, sha: f.sha, allowlist: parseAllowlist(f.allowlist) }, fixtureApi(f));
    process.stdout.write(`${JSON.stringify({ ...d, outputs: outputLines(d) }, null, 2)}\n`);
    return 0;
  }
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const api = githubApi(env.GITHUB_TOKEN, repository);
  if (args[0] === '--verify-head') {
    if (env.ADMITTED_KIND !== 'pull_request') { console.log('Not a pull request: nothing to compare.'); return 0; }
    const head = await api.pullHead(env.ADMITTED_NUMBER);
    const r = headStillAdmitted(env.ADMITTED_HEAD_SHA, head?.sha);
    summary(`${r.ok ? 'Head unchanged' : 'Stopped'}: ${r.line}`);
    console[r.ok ? 'log' : 'error'](r.line);
    return r.ok ? 0 : 1;
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const d = await decide({ eventName: env.GITHUB_EVENT_NAME, event, repository, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, allowlist: parseAllowlist(env.CLAUDE_CODE_ALLOWED_ACTORS) }, api);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${outputLines(d).join('\n')}\n`);
  summary(d.summary);
  console.log(d.summary);
  return 0;
}

main().then((code) => process.exit(code), (err) => {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'admitted=false\nreason=admission_error\n');
  summary('Refused: the admission check failed, so nothing was admitted.');
  console.error(`admission error: ${err?.message ?? err}`);
  process.exit(1);
});
