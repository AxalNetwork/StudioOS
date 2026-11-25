#!/usr/bin/env node
// D8532 (#8532): rehearse the release window on a pull request.
//
// The candidate is this checkout (HEAD). The base is the commit the pull
// request merges into. The base tree is exported beside it with `git archive`
// (no worktree, so nothing in this repository's git state changes; the design,
// documentation and attachment trees the Worker never imports are left out),
// its Worker dependencies installed from its own lockfile and its generated
// modules built, so "the old Worker" is the base commit's code and nothing of
// the candidate's. Then `lib/releaseWindow.mjs`
// runs the five steps and this writes the report.
//
//   node scripts/release-window-rehearsal.mjs --base <sha> --out <dir> [--base-deps install|link] [--keep]
//
//   --base-deps install   (default, CI) `npm ci` in the base tree's cloudflare-worker/
//   --base-deps link      reuse this checkout's cloudflare-worker/node_modules: quicker
//                         locally, and wrong if the pull request changes a dependency
//
// Writes <out>/release-window.json and <out>/release-window.md, appends the
// markdown to $GITHUB_STEP_SUMMARY when set, and exits 1 when the verdict is
// fail. Local only: no Cloudflare account, no network beyond `npm ci`, never a
// deploy and never a production database.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMigrationFiles } from './lib/migrationPlan.mjs';
import { rehearse, renderReport } from './lib/releaseWindow.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
// Trees the base Worker never imports, left out of the base export.
const SKIP = ['attached_assets', 'design', 'documentation', 'spin-out-lab-pipeline', 'frontend/test', 'frontend/tests'];
// The base Worker's own test files are never run; its test helpers (the TypeScript loader) are.
const SKIP_GLOBS = ['cloudflare-worker/test/**/*.test.*'];
const opt = (name, fallback = null) => { const at = argv.indexOf(name); return at < 0 ? fallback : argv[at + 1]; };

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-8).join('\n')}`);
  return r.stdout.trim();
}

function main() {
  const baseRef = opt('--base');
  const out = resolve(opt('--out', join(tmpdir(), 'release-window')));
  const deps = opt('--base-deps', 'install');
  if (!baseRef || !['install', 'link'].includes(deps)) {
    console.error('usage: release-window-rehearsal.mjs --base <sha> --out <dir> [--base-deps install|link] [--keep]');
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  const baseSha = sh('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: ROOT });
  const candidateSha = sh('git', ['rev-parse', 'HEAD'], { cwd: ROOT });
  const scratch = mkdtempSync(join(tmpdir(), 'release-window-'));
  const baseTree = join(scratch, 'base');
  try {
    mkdirSync(baseTree);
    const archive = spawnSync('git', ['archive', '--format=tar', baseSha, '--', '.', ...SKIP.map((d) => `:(exclude)${d}`), ...SKIP_GLOBS.map((g) => `:(exclude,glob)${g}`)],
      { cwd: ROOT, maxBuffer: 2 * 1024 * 1024 * 1024 });
    if (archive.status !== 0) throw new Error(`git archive ${baseSha} failed: ${String(archive.stderr).trim()}`);
    const untar = spawnSync('tar', ['-x', '-C', baseTree], { input: archive.stdout, maxBuffer: 64 * 1024 * 1024 });
    if (untar.status !== 0) throw new Error(`tar failed: ${String(untar.stderr).trim()}`);
    const baseWorker = join(baseTree, 'cloudflare-worker');
    if (deps === 'link') {
      symlinkSync(join(ROOT, 'cloudflare-worker', 'node_modules'), join(baseWorker, 'node_modules'), 'dir');
      if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(baseTree, 'node_modules'), 'dir');
    }
    else sh('npm', ['ci', '--prefix', baseWorker, '--no-audit', '--no-fund'], { cwd: baseTree });
    if (existsSync(join(baseTree, 'scripts', 'build-generated.mjs'))) sh(process.execPath, ['scripts/build-generated.mjs'], { cwd: baseTree });
    const work = join(scratch, 'db');
    mkdirSync(work);
    const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
    const report = rehearse({
      workDir: work,
      baseSha, candidateSha,
      baseSqlDir: join(baseWorker, 'sql'),
      baseWorker,
      baseToml: read(join(baseTree, 'wrangler.toml')),
      candidateRoot: ROOT,
      candidateWorker: join(ROOT, 'cloudflare-worker'),
      candidateToml: read(join(ROOT, 'wrangler.toml')),
      candidateFiles: listMigrationFiles(join(ROOT, 'cloudflare-worker', 'sql', 'migrations')),
    });
    report.base_deps = deps;
    const md = renderReport(report);
    writeFileSync(join(out, 'release-window.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(out, 'release-window.md'), md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    console.log(md);
    process.exitCode = report.verdict === 'pass' ? 0 : 1;
  } finally {
    if (!argv.includes('--keep')) rmSync(scratch, { recursive: true, force: true });
    else console.log(`kept ${scratch}`);
  }
}

main();
