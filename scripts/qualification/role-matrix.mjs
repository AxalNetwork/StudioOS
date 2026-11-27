#!/usr/bin/env node
/**
 * D8688 (#8688): runs the role qualification and prints the role-by-role
 * pass/fail matrix — build ids, authenticated against intended role, scope,
 * each step's result and non-sensitive evidence, missing steps, and whether a
 * result is preview-only. No npm: plain `node`, which re-runs itself under the
 * Worker tests' TypeScript loader to drive the real Worker in process.
 *
 *   node scripts/qualification/role-matrix.mjs                     # Markdown to stdout
 *   node scripts/qualification/role-matrix.mjs --json matrix.json --md matrix.md
 *   node scripts/qualification/role-matrix.mjs --phone phone.json  # merge a browser run's 390 px results
 *   node scripts/qualification/role-matrix.mjs --target preview    # refused: see the README
 *
 * The only target today is `local`: three migrated SQLite databases inside this
 * process, checked by `assertIsolatedTarget` before anything is seeded. Any
 * other target is refused with its reasons (`lib/roleQualification.mjs`),
 * because no isolated hosted environment exists for this run yet.
 *
 * `--phone` reads `{ "<row id>": { "result": "pass" | "fail", "evidence": "..." } }`
 * (row ids: admin, founder, investor, advisor, partner, pending) from a browser
 * run at 390 px and puts each into its row's 390 px column; a row it does not
 * name stays "not run". Its evidence must be publishable like the rest.
 *
 * Exit 0 when no row failed, 1 when a row failed, 2 when the run was refused
 * or could not start. A row that is only incomplete (a step with no product
 * route, a 390 px check not run here) does not fail the exit code; it is
 * printed as incomplete.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildIds, matrixMarkdown, overallResult, targetRefusals, productionDatabases, unpublishable } from '../lib/roleQualification.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const die = (m, code = 2) => { console.error(`✗ role-matrix: ${m}`); process.exit(code); };

const target = value('--target') || 'local';
if (target !== 'local') {
  // Only the local run exists. A named hosted target is still checked, so the refusal says which rule stopped it.
  const reasons = targetRefusals({ environment: target, remote: true, database: { name: value('--database') }, accounts: null },
    productionDatabases(readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8')));
  die(`target ${JSON.stringify(target)} is refused: ${[...reasons.map((r) => r.code), 'hosted_run_not_built'].join(', ')}. `
    + 'Only the local in-process run exists until an isolated qualification environment is provisioned (#7147, #7149).');
}

if (!process.env.ROLE_MATRIX_CHILD) {
  // Re-run under the Worker tests' loader, which strips TypeScript at import.
  const child = spawnSync(process.execPath, [
    '--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs',
    fileURLToPath(import.meta.url), ...args,
  ], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ROLE_MATRIX_CHILD: '1' } });
  process.exit(child.status ?? 2);
}

function readPhone(path) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(`--phone could not be read (${e.message})`); }
  const out = {};
  for (const [id, v] of Object.entries(raw ?? {})) {
    if (!['pass', 'fail'].includes(v?.result) || typeof v?.evidence !== 'string') die(`--phone: ${id} needs result pass or fail and an evidence sentence`);
    out[id] = { result: v.result, evidence: `${v.evidence} (browser run, 390 px)` };
  }
  return out;
}

const git = (a) => {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} failed`);
  return r.stdout;
};

let run;
// The Worker logs to the console as it works; the matrix is the only stdout this command promises.
const quiet = { log: console.log, info: console.info, warn: console.warn, error: console.error };
try {
  const { runQualification } = await import(pathToFileURL(resolve(ROOT, 'cloudflare-worker/test/_role_qualification_8688.ts')).href);
  const { removeMigratedDatabases } = await import(pathToFileURL(resolve(ROOT, 'cloudflare-worker/test/_storage_schema.ts')).href);
  console.log = console.info = console.warn = console.error = () => {};
  try { run = await runQualification(); } finally {
    Object.assign(console, quiet);
    removeMigratedDatabases();
  }
} catch (e) {
  Object.assign(console, quiet);
  die(`the qualification could not run: ${e?.message ?? e}`);
}

const phone = value('--phone') ? readPhone(value('--phone')) : {};
for (const row of run.rows) if (phone[row.id]) row.phone_390 = phone[row.id];

const result = {
  issue: 8688,
  mode: 'local isolated Worker (in-process SQLite; no D1, no network, no delivery)',
  build: buildIds(git),
  production_release: 'not verified here: the production sign-in release is a separate step (#8680)',
  outside_requests: run.outside_requests,
  rows: run.rows.map((r) => ({ ...r, result: overallResult(r) })),
};
const leaks = unpublishable(result.rows);
if (leaks.length) die(`the matrix carries text that must not be published: ${leaks.length} item(s); nothing was written`);

const md = matrixMarkdown(result);
if (value('--json')) writeFileSync(value('--json'), JSON.stringify(result, null, 2) + '\n');
if (value('--md')) writeFileSync(value('--md'), md);
process.stdout.write(md);
process.stdout.write(`\nOutside requests attempted: ${result.outside_requests}. Production release: ${result.production_release}.\n`);
process.exit(result.rows.some((r) => r.result === 'fail') ? 1 : 0);
