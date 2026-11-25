#!/usr/bin/env node
// D8068 (#8068): the identity chain. Every commit an agent lands names its slot, its task,
// its run and its session in four trailers; this check reads every commit a range adds and
// fails on a missing or malformed chain. AGENTS.md § "Identity trailers" states the contract,
// and agent-provenance.test.mjs holds this parser to it.
//
//   node scripts/ci/agent-provenance.mjs --base origin/main --head HEAD [--branch <name>]
//        [--out provenance.json] [--source base|pr] [--pr-merges <file>]
//
// With --branch, a branch outside `agent/**` is skipped (verdict `skipped`, exit 0). Without
// it, the range is always checked, which is how an agent checks its own commits locally.
// --pr-merges names a file of commit shas, one per line, that GitHub wrote when it merged
// another pull request into this branch (#8606); the workflow reads them from the API.
// Exit 0 on pass or skip, 1 on fail, 2 on a usage or git error.
//
// The file is self-contained (node: built-ins only) because the workflow runs the copy on
// the pull request's base commit, so a branch cannot edit the check that judges it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Before this instant (committer date), `Claude-Session` stands in for `Agent-Session`. */
export const CUTOVER = '2026-12-01T00:00:00Z';
export const LEGACY_SESSION = 'Claude-Session';
export const MAX_COMMITS = 250;
export const AGENT_BRANCH = /^agent\/./;

// https, a dotted host, and a path of URL-safe characters: no credentials, query, fragment or port.
const sessionUrl = (v) => v.length <= 200 && /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/[A-Za-z0-9._~%/-]*)?$/.test(v);

/** The four trailers, in the order a commit writes them, each with the one value shape it accepts. */
export const TRAILERS = Object.freeze({
  'Agent-Slot': (v) => /^S(?:0[1-9]|[1-9][0-9])$/.test(v),
  'Agent-Task': (v) => /^#[1-9][0-9]{0,6}$/.test(v),
  'Agent-Run': (v) => v === 'manual' || /^[1-9][0-9]{0,19}$/.test(v),
  'Agent-Session': sessionUrl,
});

const TRAILER_LINE = /^([A-Za-z0-9][A-Za-z0-9-]*): (\S(?:.*\S)?)$/;

/** A value made safe to print in a CI log: printable ASCII only, quoted, bounded. */
export const shown = (v) => JSON.stringify(String(v).replace(/[^\x20-\x7e]/g, '?').slice(0, 80));

/**
 * The trailer block of a commit message: its last paragraph, when that is not the subject
 * and every one of its lines is `Key: value`. Anything else has no trailers at all.
 * Returns a map of key to every value given for it.
 */
export function parseTrailers(message) {
  const paragraphs = String(message).replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n/);
  const out = new Map();
  if (paragraphs.length < 2) return out;
  const lines = paragraphs.at(-1).split('\n');
  const parsed = lines.map((l) => TRAILER_LINE.exec(l));
  if (parsed.some((m) => !m)) return out;
  for (const [, key, value] of parsed) out.set(key, [...(out.get(key) ?? []), value]);
  return out;
}

/**
 * One commit's chain. `merge` is true for a commit with two or more parents; `cleanMerge` is
 * true when its combined diff is empty, i.e. it adds nothing neither parent had. A clean merge
 * is exempt: a merge that resolves or adds content is an authored change like any other.
 * `prMerge` is true when GitHub wrote the commit by merging another pull request into this
 * branch (#8606). That pull request's own commits were checked on its own branch, so its
 * merge is exempt too, whatever trailers GitHub's squash message carries.
 */
export function checkCommit({ sha, parents = [], committedAt, message, cleanMerge = false, prMerge = false }) {
  const merge = parents.length > 1;
  const row = { sha, merge, exempt: false, slot: null, task: null, run: null, session: null, sessionTrailer: null, problems: [] };
  if (prMerge) return { ...row, exempt: true, prMerge: true };
  if (merge && cleanMerge) return { ...row, exempt: true };
  const trailers = parseTrailers(message);
  for (const [key, valid] of Object.entries(TRAILERS)) {
    let values = trailers.get(key) ?? [];
    let from = key;
    if (key === 'Agent-Session' && values.length === 0) {
      const at = Date.parse(committedAt);
      const legacy = trailers.get(LEGACY_SESSION) ?? [];
      if (legacy.length && Number.isFinite(at) && at < Date.parse(CUTOVER)) {
        values = legacy;
        from = LEGACY_SESSION;
      } else if (legacy.length) {
        row.problems.push(`${LEGACY_SESSION} is accepted as Agent-Session only before ${CUTOVER}`);
        continue;
      }
    }
    if (values.length === 0) { row.problems.push(`missing ${key}`); continue; }
    if (values.length > 1) { row.problems.push(`${from} given ${values.length} times`); continue; }
    if (!valid(values[0])) { row.problems.push(`${from} ${shown(values[0])} is malformed`); continue; }
    const field = { 'Agent-Slot': 'slot', 'Agent-Task': 'task', 'Agent-Run': 'run', 'Agent-Session': 'session' }[key];
    row[field] = values[0];
    if (key === 'Agent-Session') row.sessionTrailer = from;
  }
  return row;
}

/** The issue an `agent/<agent>/<issue>-<slug>` branch names, or null. */
export const branchIssue = (branch) => /^agent\/[^/]+\/([1-9][0-9]*)-/.exec(branch ?? '')?.[1] ?? null;

/**
 * The verdict for a range: `skipped` for a branch outside agent/**, `fail` when any commit
 * breaks its chain or the range names more than one slot or task (or a task other than the
 * branch's issue), `pass` otherwise. Shaped as provenance.json.
 */
export function checkRange({ commits, branch = null, base = null, head = null, source = null, prMerges = new Set() }) {
  const doc = { version: 1, verdict: 'pass', branch, base, head, source, slot: null, task: null,
    runs: [], sessions: [], commits: [], problems: [] };
  if (branch !== null && !AGENT_BRANCH.test(branch)) {
    return { ...doc, verdict: 'skipped', problems: [`branch ${shown(branch)} is not agent/**; nothing to check`] };
  }
  if (commits.length === 0) return { ...doc, verdict: 'fail', problems: ['the range adds no commits'] };
  if (commits.length > MAX_COMMITS) {
    return { ...doc, verdict: 'fail', problems: [`the range adds more than ${MAX_COMMITS} commits`] };
  }
  doc.commits = commits.map((c) => checkCommit({ ...c, prMerge: prMerges.has(c.sha) }));
  const chained = doc.commits.filter((c) => !c.exempt);
  const distinct = (k) => [...new Set(chained.map((c) => c[k]).filter(Boolean))];
  const slots = distinct('slot');
  const tasks = distinct('task');
  doc.runs = distinct('run');
  doc.sessions = distinct('session');
  if (slots.length > 1) doc.problems.push(`the range names ${slots.length} slots: ${slots.join(', ')}`);
  if (tasks.length > 1) doc.problems.push(`the range names ${tasks.length} tasks: ${tasks.join(', ')}`);
  if (slots.length === 1) doc.slot = slots[0];
  if (tasks.length === 1) doc.task = tasks[0];
  const issue = branchIssue(branch);
  if (issue && tasks.length === 1 && tasks[0] !== `#${issue}`) {
    doc.problems.push(`the branch names #${issue} but the commits name ${tasks[0]}`);
  }
  if (chained.length === 0) doc.problems.push('every commit is a clean or pull-request merge; no commit carries the chain');
  if (doc.problems.length || doc.commits.some((c) => c.problems.length)) doc.verdict = 'fail';
  return doc;
}

const REV = /^(?!-)[A-Za-z0-9._/~^@{}-]{1,200}$/;

/** The shas a --pr-merges file lists: one full lowercase sha per line, blank lines ignored. */
export function readPrMerges(text) {
  const shas = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bad = shas.find((v) => !/^[0-9a-f]{40}$/.test(v));
  if (bad !== undefined) throw new Error(`--pr-merges lists ${shown(bad)}, not a commit sha`);
  return new Set(shas);
}

/** The commits `head` adds over `base`, oldest first, read from git. */
export function readCommits(base, head, { cwd = process.cwd() } = {}) {
  if (!REV.test(base) || !REV.test(head)) throw new Error('--base and --head take a revision name or sha');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const shas = git('rev-list', '--reverse', `--max-count=${MAX_COMMITS + 1}`, `${base}..${head}`, '--').split('\n').filter(Boolean);
  return shas.map((sha) => {
    const [, parents, committedAt, ...body] = git('log', '-1', '--format=%H%n%P%n%cI%n%B', sha).split('\n');
    const list = parents.split(' ').filter(Boolean);
    const cleanMerge = list.length > 1 && git('diff-tree', '--cc', '--no-commit-id', '--name-only', '-r', sha).trim() === '';
    return { sha, parents: list, committedAt, message: body.join('\n'), cleanMerge };
  });
}

/** The lines the check prints. The last one is what the landing bot reads. */
export function report(doc) {
  const lines = doc.commits.map((c) => {
    if (c.prMerge) return `agent-provenance: ${c.sha.slice(0, 12)} pull request merged into this branch, exempt`;
    if (c.exempt) return `agent-provenance: ${c.sha.slice(0, 12)} clean merge, exempt`;
    if (c.problems.length) return `agent-provenance: ${c.sha.slice(0, 12)} FAIL ${c.problems.join('; ')}`;
    return `agent-provenance: ${c.sha.slice(0, 12)} ok slot=${c.slot} task=${c.task} run=${c.run} session=${c.sessionTrailer}`;
  });
  for (const p of doc.problems) lines.push(`agent-provenance: ${doc.verdict === 'skipped' ? 'SKIP' : 'FAIL'} ${p}`);
  lines.push(`agent-provenance: verdict=${doc.verdict} head=${doc.head ?? 'unknown'} commits=${doc.commits.length} source=${doc.source ?? 'local'}`);
  return lines;
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--base', '--head', '--branch', '--out', '--source', '--pr-merges'].includes(key) || argv[i + 1] === undefined) {
      throw new Error(`unknown or incomplete argument ${shown(key)}`);
    }
    out[key.slice(2)] = argv[i + 1];
  }
  if (!out.base || !out.head) throw new Error('--base and --head are required');
  if (out.source && !['base', 'pr'].includes(out.source)) throw new Error('--source is base or pr');
  return out;
}

export function main(argv, { cwd = process.cwd(), log = console.log } = {}) {
  let opts;
  try {
    opts = args(argv);
  } catch (e) {
    log(`agent-provenance: ${e.message}`);
    return 2;
  }
  const branch = opts.branch ?? null;
  let prMerges = new Set();
  if (opts['pr-merges']) {
    try {
      prMerges = readPrMerges(readFileSync(opts['pr-merges'], 'utf8'));
    } catch (e) {
      log(`agent-provenance: ${e.code === 'ENOENT' ? '--pr-merges file not found' : e.message}`);
      return 2;
    }
  }
  let doc;
  if (branch !== null && !AGENT_BRANCH.test(branch)) {
    doc = checkRange({ commits: [], branch, base: opts.base, head: opts.head, source: opts.source ?? null });
  } else {
    let commits;
    let headSha;
    try {
      commits = readCommits(opts.base, opts.head, { cwd });
      headSha = execFileSync('git', ['rev-parse', '--verify', `${opts.head}^{commit}`], { cwd, encoding: 'utf8' }).trim();
    } catch (e) {
      log(`agent-provenance: git could not read the range (${shown(e.message.split('\n')[0])})`);
      return 2;
    }
    doc = checkRange({ commits, branch, base: opts.base, head: headSha, source: opts.source ?? null, prMerges });
  }
  for (const line of report(doc)) log(line);
  if (opts.out) writeFileSync(opts.out, `${JSON.stringify(doc, null, 2)}\n`);
  return doc.verdict === 'fail' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
