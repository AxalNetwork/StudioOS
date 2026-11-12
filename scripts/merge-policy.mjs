#!/usr/bin/env node
/** D5607 — classify a pull request's diff for the advisory landing policy. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_FILE = /\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/;
const TEST = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/;
const SENSITIVE = /(?:^|\/)(?:\.github|scripts|merge-control|attached_assets)(?:\/|$)|^cloudflare-worker\/(?:sql|src\/middleware)\/|(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|CODEOWNERS|package[^/]*\.json|wrangler[^/]*\.toml|[^/]*(?:lockfile|\.lock(?:\.json)?|[-_.]lock\.(?:json|yaml|yml)))(?:$|\/)/i;
const SENSITIVE_NAME = /auth|session|permissions?|tenan(?:t|cy)|billing|money|payment|stripe|entitlement|pricing|subscription|cap.?table|fund.?fee|remittance|valuation|sign.?in|mfa|oauth|access.?control|legal.?template/i;
const LEAF_UI = /^frontend\/src\/(?:components|icons|styles)\//;
const ORDINARY = /^(?:cloudflare-worker\/src\/(?:routes|services)|backend\/app\/(?:api\/routes|services)|frontend\/src\/(?:routes|services|pages))\//;
const LINK_MODES = new Set(['120000', '160000']);
const BASELINE_DIRECTORY = /(?:^|\/)scripts\/baselines\//i;
const BASELINE_FILENAME = /[-_.](?:baseline|ledger)\.json$/i;
const RESTRICTED_TEST = /(?:\.\s*|\b)(?:skip|todo|only)\s*(?:\(|:\s*(?!false\b))/;
const TIMEOUT = /(?:\b[\w-]*timeout[\w-]*\b)/i;
const TEST_CALL = /\b(?:test|it)\s*\(/g;
const ASSERTION = /\b(?:assert|expect)\s*(?=[.(])/g;

function changedLines(patch) {
  const added = [];
  const removed = [];
  let hunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) hunk = false;
    if (line.startsWith('@@ ')) hunk = true;
    if (!hunk) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added: added.join('\n'), removed: removed.join('\n') };
}

function pathPolicy(path, status) {
  if (SENSITIVE.test(path) || SENSITIVE_NAME.test(path)) return ['T2', 'protected path'];
  if (TEST.test(path)) {
    return status === 'A' && TEST_FILE.test(path) ? ['T0', 'added test'] : ['T2', 'existing test or fixture'];
  }
  if (path.startsWith('documentation/') || LEAF_UI.test(path)) return ['T0', 'documentation or leaf UI'];
  if (ORDINARY.test(path)) return ['T1', 'route, service, or page'];
  return ['T2', 'unmatched path'];
}

export function classify(files) {
  let tier = 'T0';
  const reasons = new Set();
  const record = (level, reason) => {
    if (level > tier) tier = level;
    reasons.add(reason);
  };

  if (!files.length) record('T2', 'No changed files were available for classification.');
  for (const { path, status, previousPath, mode, patch = '' } of files) {
    const code = status[0];
    const [level, rule] = pathPolicy(path, code);
    record(level, `${level}: ${rule}: ${path}`);
    if (previousPath) {
      const [previousLevel, previousRule] = pathPolicy(previousPath, code);
      record(previousLevel, `${previousLevel}: ${previousRule}: previous path ${previousPath}`);
    }
    if (!'ACDMR'.includes(code) || !code) record('T2', `Unsupported change status: ${path}`);
    if ([path, previousPath].some((file) =>
      file && (BASELINE_DIRECTORY.test(file) || BASELINE_FILENAME.test(file)))) {
      record('T2', `Test baseline or ledger changed: ${path}`);
    }
    const test = TEST.test(path) || (previousPath && TEST.test(previousPath));
    if (test && (code === 'D' || code === 'R')) record('T2', `Test deleted or renamed: ${path}`);

    const { added, removed } = changedLines(patch);
    if (path === 'scripts/test-drift-parts.mjs' && /\bSHARDS\b/.test(patch)) {
      record('T2', `Suite shard declaration changed: ${path}`);
    }
    if (LINK_MODES.has(mode)) record('T2', `Link or submodule present: ${path}`);
    if (/^Binary files .* differ$/m.test(patch)) record('T2', `Binary content changed: ${path}`);
    if (TIMEOUT.test(added) || TIMEOUT.test(removed)) record('T2', `Timeout changed: ${path}`);
    if (test && RESTRICTED_TEST.test(added)) record('T2', `Test skip, todo or only added: ${path}`);
    if (test && [TEST_CALL, ASSERTION].some((pattern) =>
      [...added.matchAll(pattern)].length < [...removed.matchAll(pattern)].length)) {
      record('T2', `Test or assertion count dropped: ${path}`);
    }
  }
  return { tier, reasons: [...reasons].sort() };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function changedFiles(base, head) {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('Base and head must be full Git commit SHAs.');
  }
  const bases = git('merge-base', '--all', base, head).trim().split('\n');
  if (bases.length !== 1) throw new Error('The pull request has no unique merge base.');
  const args = ['--no-ext-diff', '--no-textconv', '--find-renames', bases[0], head];
  const entries = git('diff', '--raw', '--no-abbrev', '-z', ...args, '--').split('\0');
  const files = [];
  for (let i = 0; i < entries.length - 1;) {
    const header = /^:[0-7]{6} ([0-7]{6}) [a-f0-9]{40} [a-f0-9]{40} ([A-Z][0-9]*)$/.exec(entries[i++]);
    if (!header) throw new Error('Invalid raw Git diff entry.');
    const [, mode, status] = header;
    const previousPath = /^[RC]/.test(status) ? entries[i++] : undefined;
    const path = entries[i++];
    const paths = previousPath ? [previousPath, path] : [path];
    // Three context lines keep a changed shard value tied to its declaration.
    const patch = git('--literal-pathspecs', 'diff', '--unified=3', ...args, '--', ...paths);
    files.push({ path, status, previousPath, mode, patch });
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baseFlag, base, headFlag, head, ...rest] = process.argv.slice(2);
  try {
    if (baseFlag !== '--base' || headFlag !== '--head' || rest.length) {
      throw new Error('Usage: node scripts/merge-policy.mjs --base <sha> --head <sha>');
    }
    console.log(JSON.stringify(classify(changedFiles(base, head))));
  } catch (error) {
    console.error(`merge-policy: ${error.message}`);
    process.exitCode = 1;
  }
}
