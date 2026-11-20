#!/usr/bin/env node
// D7151 (#7151): record whether this release could be rolled back
// automatically. REPORT ONLY: it writes evidence and a job-summary section and
// always exits 0, so it can never change what the release does. #7152 acts on
// the class.
//
// Runs in `.github/workflows/cloudflare-worker-deploy.yml` after "Record
// migration plan and previous Worker version" and before any write, and reads
// what that step left in the evidence directory:
//
//   migration-plan.log         migrate-d1 --remote --dry-run (the pending files)
//   previous-deployments.json  wrangler deployments list --json (the live version)
//
// It then reads, with the credentials the release already holds, the live
// version's bindings (`wrangler versions view <id> --json`) and, when the
// version does not report its Durable Object migration tag, the deployed
// commit's wrangler.toml (`gh api`, the job's read-only GitHub token). Anything
// it cannot read is passed on as unknown, and unknown is manual.
//
// Writes rollback-class.json (the class, its reasons, the rollback target) and
// rollback-class.md (the same, as the job summary shows it) into the evidence
// directory, and appends the summary to $GITHUB_STEP_SUMMARY. The evidence
// keeps binding names and types only: never a variable's value or the
// version's author.
//
// Usage: node scripts/release-rollback-class.mjs <evidence-dir>

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANUAL_RULES,
  classifyRelease,
  pendingFromPlan,
  previousVersion,
  productionConfig,
  reduceVersion,
  renderSummary,
} from './lib/rollbackClass.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'cloudflare-worker', 'sql', 'migrations');
const evidence = process.argv[2];
if (!evidence) {
  console.log('usage: node scripts/release-rollback-class.mjs <evidence-dir>');
  process.exit(0);
}

const note = (msg) => console.log(`[rollback-class] ${msg}`);
const read = (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
const json = (text) => {
  const t = String(text ?? '');
  const at = t.search(/[[{]/);
  try { return at < 0 ? null : JSON.parse(t.slice(at)); } catch { return null; }
};
const firstLine = (s) => String(s ?? '').trim().split('\n')[0].slice(0, 200);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 90_000, ...opts });
  if (r.error || r.status !== 0) {
    const said = String(r.error?.message ?? `${r.stderr ?? ''}\n${r.stdout ?? ''}`).replace(/\x1b\[[0-9;]*m/g, '');
    note(`${cmd} ${args[0]} did not answer: ${firstLine(said.split('\n').find((l) => /error/i.test(l)) ?? said)}`);
    return null;
  }
  return r.stdout;
}

function main() {
  const plan = pendingFromPlan(read(path.join(evidence, 'migration-plan.log')));
  const migrations = (plan ?? []).map((name) => ({
    name,
    sql: /^[\w.-]+\.sql$/.test(name) ? read(path.join(MIGRATIONS, name)) : null,
  }));
  const candidate = productionConfig(readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8'));
  const previous = previousVersion(json(read(path.join(evidence, 'previous-deployments.json'))));

  let deployed = null;
  if (previous.id && /^[0-9a-f-]{36}$/.test(previous.id)) {
    const out = run('node', ['node_modules/wrangler/bin/wrangler.js', 'versions', 'view', previous.id,
      '--config', '../wrangler.toml', '--env', 'production', '--json'], { cwd: path.join(ROOT, 'cloudflare-worker') });
    deployed = reduceVersion(json(out));
  }

  let deployedTag = deployed?.migrationTag ?? null;
  let tagSource = deployedTag ? 'the live version' : null;
  if (!deployedTag && deployed?.commit && process.env.GITHUB_REPOSITORY) {
    const toml = run('gh', ['api', '-H', 'Accept: application/vnd.github.raw',
      `repos/${process.env.GITHUB_REPOSITORY}/contents/wrangler.toml?ref=${deployed.commit}`]);
    if (toml) {
      try {
        deployedTag = productionConfig(toml).migrationTags.at(-1) ?? null;
        tagSource = `wrangler.toml at the deployed commit ${deployed.commit}`;
      } catch (e) {
        note(`the deployed commit's wrangler.toml did not parse: ${firstLine(e.message)}`);
      }
    }
  }

  const result = classifyRelease({ plan, migrations, candidate, deployed, deployedTag, previous });
  const record = {
    candidate: process.env.GITHUB_SHA ?? null,
    ...result,
    deployedDoTagSource: tagSource,
    deployedCommit: deployed?.commit ?? null,
    deployedBindings: deployed?.bindings ?? null,
    liveDeploymentVersions: previous.versions,
  };
  const md = renderSummary(result);
  writeFileSync(path.join(evidence, 'rollback-class.json'), JSON.stringify(record, null, 2) + '\n');
  writeFileSync(path.join(evidence, 'rollback-class.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${md}`);
  return md;
}

let md;
try {
  md = main();
} catch (e) {
  // Report only: a classifier fault is recorded as manual and never fails the release.
  const result = classifyRelease({ plan: null, candidate: null, deployed: null, deployedTag: null, previous: null });
  result.reasons.unshift({ rule: 'classifier-error', file: null, line: null, text: `${MANUAL_RULES['classifier-error']}: ${firstLine(e?.message)}` });
  md = renderSummary(result);
  try {
    writeFileSync(path.join(evidence, 'rollback-class.json'), JSON.stringify({ candidate: process.env.GITHUB_SHA ?? null, ...result }, null, 2) + '\n');
    writeFileSync(path.join(evidence, 'rollback-class.md'), md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${md}`);
  } catch { /* the step log below still carries it */ }
}
process.stdout.write(md);
