#!/usr/bin/env node
// D8068 (#8068): the identity chain. Every commit an agent lands names its slot, its task,
// its run and its session in four trailers; this check reads every commit a range adds and
// fails on a missing or malformed chain. AGENTS.md § "Identity trailers" states the contract,
// and agent-provenance.test.mjs holds this parser to it.
//
//   node scripts/ci/agent-provenance.mjs --base origin/main --head HEAD [--branch <name>]
//        [--out provenance.json] [--source base|pr] [--pr-merges <file>]
//   node scripts/ci/agent-provenance.mjs --shadow --candidate <sha> [--previous <sha>] [--summary <file>]
//   node scripts/ci/agent-provenance.mjs --bind --base <sha> --head <sha> --candidate <sha>
//
// --bind (D8692, #8692) is the merge queue's proof that the pull request head it is about to check
// is the one the queue candidate was built from: the candidate's only parent is the merge group's
// base and its tree is that base merged with the head. Exit 0 when bound, 1 when refused.
//
// --shadow (D8517, #8517) is the production release's report: for each pull request merged between
// the last production deploy and the candidate, its slot, its task and whether this check passes on
// its head. It never fails: it always exits 0, and what it cannot read it prints as such.
//
// With --branch, a branch outside `agent/**` is skipped (verdict `skipped`, exit 0). Without
// it, the range is always checked, which is how an agent checks its own commits locally.
// --pr-merges names a file of commit shas, one per line, that GitHub wrote when it merged
// another pull request into this branch (#8606); the workflow reads them from the API.
// Exit 0 on pass or skip, 1 on fail, 2 on a usage or git error.
//
// The file is self-contained (node: built-ins only) because the workflow runs the copy on
// the pull request's base commit, so a branch cannot edit the check that judges it.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
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
 * merge is exempt too, whatever trailers GitHub's squash message carries. `prMergedIn` is true
 * for one of those commits, brought into the range by such a merge (#9257); it is exempt for the
 * same reason.
 */
export function checkCommit({ sha, parents = [], committedAt, message, cleanMerge = false, prMerge = false, prMergedIn = false }) {
  const merge = parents.length > 1;
  const row = { sha, merge, exempt: false, slot: null, task: null, run: null, session: null, sessionTrailer: null, problems: [] };
  if (prMerge) return { ...row, exempt: true, prMerge: true };
  if (prMergedIn) return { ...row, exempt: true, prMergedIn: true };
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

/**
 * #9257: the commits in the range that a listed pull-request merge brought in. For each merge the
 * list names, they are the commits reachable from its second and later parents but not from its
 * first, which is the branch's own line. A commit reachable from both is the branch's own and
 * stays checked. Only commits inside the range are walked, so main's history never counts.
 */
export function mergedInCommits(commits, prMerges) {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const reach = (starts) => {
    const seen = new Set();
    const stack = [...starts];
    while (stack.length) {
      const sha = stack.pop();
      if (seen.has(sha) || !bySha.has(sha)) continue;
      seen.add(sha);
      stack.push(...(bySha.get(sha).parents ?? []));
    }
    return seen;
  };
  const out = new Set();
  for (const c of commits) {
    if (!prMerges.has(c.sha) || (c.parents ?? []).length < 2) continue;
    const own = reach([c.parents[0]]);
    for (const sha of reach(c.parents.slice(1))) if (!own.has(sha) && !prMerges.has(sha)) out.add(sha);
  }
  return out;
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
  const mergedIn = mergedInCommits(commits, prMerges);
  doc.commits = commits.map((c) => checkCommit({ ...c, prMerge: prMerges.has(c.sha), prMergedIn: mergedIn.has(c.sha) }));
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
    if (c.prMergedIn) return `agent-provenance: ${c.sha.slice(0, 12)} brought by a pull request merged into this branch, exempt`;
    if (c.exempt) return `agent-provenance: ${c.sha.slice(0, 12)} clean merge, exempt`;
    if (c.problems.length) return `agent-provenance: ${c.sha.slice(0, 12)} FAIL ${c.problems.join('; ')}`;
    return `agent-provenance: ${c.sha.slice(0, 12)} ok slot=${c.slot} task=${c.task} run=${c.run} session=${c.sessionTrailer}`;
  });
  for (const p of doc.problems) lines.push(`agent-provenance: ${doc.verdict === 'skipped' ? 'SKIP' : 'FAIL'} ${p}`);
  lines.push(`agent-provenance: verdict=${doc.verdict} head=${doc.head ?? 'unknown'} commits=${doc.commits.length} source=${doc.source ?? 'local'}`);
  return lines;
}

// ---- D8517 (#8517): the shadow report the production admission prints -------------------------

/** The most merged changes one report reads; a longer range is reported as cut short. */
export const SHADOW_MAX_CHANGES = 100;
const PR_SUBJECT = /\(#([1-9][0-9]{0,6})\)\s*$|^Merge pull request #([1-9][0-9]{0,6}) /;
const IDENTITY_KEYS = [...Object.keys(TRAILERS), LEGACY_SESSION];

/**
 * One merged pull request's row, from the commits on its head. `human` is a pull request none of
 * whose commits names any identity trailer: the check has nothing to judge there. Otherwise the
 * verdict is checkRange's, and `forms` says which session trailer each commit used.
 */
export function classifyPr({ number, commits }) {
  const row = { pr: number, status: 'unavailable', slot: null, task: null, forms: [], commits: 0, problems: [] };
  if (!Array.isArray(commits) || commits.length === 0) {
    return { ...row, problems: ['no commits could be read for the pull request head'] };
  }
  row.commits = commits.length;
  const named = commits.some((c) => IDENTITY_KEYS.some((k) => parseTrailers(c.message).has(k)));
  if (!named) return { ...row, status: 'human' };
  const doc = checkRange({ commits });
  const forms = new Set(doc.commits.map((c) => c.sessionTrailer ?? (c.exempt ? 'exempt' : 'none')));
  return { ...row, status: doc.verdict === 'pass' ? 'pass' : 'fail', slot: doc.slot, task: doc.task, forms: [...forms].sort(),
    problems: [...doc.problems, ...doc.commits.flatMap((c) => c.problems.map((p) => `${c.sha.slice(0, 12)} ${p}`))] };
}

/**
 * Every change on the candidate's first-parent line since `previous`, as one row each. A change
 * whose pull request cannot be read, or that names none (a direct push), is printed as such.
 * `resolvePr(number, sha)` returns the pull request head's commits; it may throw.
 */
export function shadowRows({ changes, resolvePr }) {
  return changes.map(({ sha, subject }) => {
    const m = PR_SUBJECT.exec(subject);
    const number = m ? Number(m[1] ?? m[2]) : null;
    if (number === null) return { pr: null, sha, status: 'no-pr', slot: null, task: null, forms: [], commits: 0, problems: ['no pull request number in the subject'] };
    try {
      return { sha, ...classifyPr({ number, commits: resolvePr(number, sha) }) };
    } catch (e) {
      return { sha, pr: number, status: 'unavailable', slot: null, task: null, forms: [], commits: 0,
        problems: [`pull request head not readable (${shown(String(e.message).split('\n')[0])})`] };
    }
  });
}

const cell = (v) => String(v ?? '').replace(/[^\x20-\x7e]/g, '?').replace(/[|`<>]/g, '?').slice(0, 120) || '-';

/** The job-summary section: a header line, one table row per change, and the totals. */
export function renderShadow({ candidate, previous, rows, note = null, truncated = false }) {
  const lines = ['### Agent provenance (shadow mode)', '',
    `Candidate \`${cell(candidate).slice(0, 12)}\`, previous production deploy ${previous ? `\`${cell(previous).slice(0, 12)}\`` : 'not found'}. ` +
    'Shadow mode: this report never fails the release.'];
  if (note) lines.push('', cell(note));
  if (truncated) lines.push('', `Only the newest ${SHADOW_MAX_CHANGES} changes are listed.`);
  lines.push('', '| PR | Slot | Task | Provenance | Session trailer | Detail |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(`| ${r.pr === null ? cell(r.sha).slice(0, 12) : `#${r.pr}`} | ${cell(r.slot)} | ${cell(r.task)} | ${r.status} | ${cell(r.forms.join(', '))} | ${cell(r.problems.slice(0, 2).join('; '))} |`);
  }
  const count = (s) => rows.filter((r) => r.status === s).length;
  lines.push('', `pass ${count('pass')}, fail ${count('fail')}, human ${count('human')}, unavailable ${count('unavailable') + count('no-pr')}.`);
  return lines.join('\n');
}

/** Reads the pull request's head from git: fetches refs/pull/N/head and lists what it adds over the squash's parent. */
export function gitResolvePr({ cwd = process.cwd(), fetchRef = (n) => execFileSync('git', ['fetch', '--no-tags', '--quiet', 'origin', `refs/pull/${n}/head`], { cwd, stdio: 'ignore' }) } = {}) {
  return (number, sha) => {
    fetchRef(number);
    const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
    const head = git('rev-parse', '--verify', 'FETCH_HEAD^{commit}');
    const base = git('merge-base', head, `${sha}^`);
    return readCommits(base, head, { cwd });
  };
}

/** The shadow report for a range. Never throws, and always returns the exit status 0. */
export function shadowMain(argv, { cwd = process.cwd(), log = console.log, resolvePr = null, summaryFile = process.env.GITHUB_STEP_SUMMARY } = {}) {
  try {
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) {
      const key = argv[i];
      if (!['--shadow', '--candidate', '--previous', '--summary'].includes(key)) throw new Error(`unknown argument ${shown(key)}`);
      if (key === '--shadow') { i -= 1; continue; }
      opts[key.slice(2)] = argv[i + 1] ?? '';
    }
    const candidate = opts.candidate ?? '';
    const previous = opts.previous ?? '';
    if (!REV.test(candidate)) throw new Error('--candidate takes a sha');
    if (previous && !REV.test(previous)) throw new Error('--previous takes a sha');
    const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const range = previous ? `${previous}..${candidate}` : candidate;
    const listing = git('rev-list', '--first-parent', `--max-count=${previous ? SHADOW_MAX_CHANGES + 1 : 1}`, range, '--').split('\n').filter(Boolean);
    const truncated = listing.length > SHADOW_MAX_CHANGES;
    const note = previous ? null : 'No earlier successful production deploy was found, so only the candidate commit is reported.';
    const changes = listing.slice(0, SHADOW_MAX_CHANGES).reverse().map((sha) => ({ sha, subject: git('log', '-1', '--format=%s', sha).trim() }));
    const rows = shadowRows({ changes, resolvePr: resolvePr ?? gitResolvePr({ cwd }) });
    const text = renderShadow({ candidate, previous, rows, note, truncated });
    log(text);
    if (opts.summary || summaryFile) appendFileSync(opts.summary || summaryFile, `${text}\n`);
  } catch (e) {
    // Shadow mode: an unreadable range is a line in the log, never a failed release.
    log(`agent-provenance: shadow report unavailable (${shown(String(e.message).split('\n')[0])})`);
  }
  return 0;
}

// ---- D8692 (#8692): a merge-queue range is bound to the candidate it reports on ----------------

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Proves that `head` is the pull request head the merge queue built `candidate` from. The queue
 * squashes (ruleset `merge_method: SQUASH`) and may stack an entry behind earlier candidates, so the
 * candidate is one commit whose only parent is the merge group's `base` (main, or the candidate ahead
 * of it) and whose tree is `base` merged with the head. Both must hold: the parent binds the base, the
 * tree binds the head. Returns the problems found, none when the head is bound; throws on a git error.
 */
export function bindCandidate({ base, head, candidate, cwd = process.cwd() }) {
  for (const [name, v] of [['--base', base], ['--head', head], ['--candidate', candidate]]) {
    if (!FULL_SHA.test(v ?? '')) throw new Error(`${name} takes a full commit sha`);
  }
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const sha of [base, head, candidate]) git('rev-parse', '--verify', '--quiet', `${sha}^{commit}`);
  const problems = [];
  const parents = git('log', '-1', '--format=%P', candidate).split(' ').filter(Boolean);
  if (parents.length !== 1 || parents[0] !== base) {
    problems.push(`candidate ${candidate} is not one commit on the merge group base ${base} (its parents: ${parents.join(', ') || 'none'})`);
  }
  const candidateTree = git('rev-parse', `${candidate}^{tree}`);
  const merged = spawnSync('git', ['merge-tree', '--write-tree', base, head], { cwd, encoding: 'utf8' });
  if (merged.status === 1) {
    problems.push(`pull request head ${head} conflicts with base ${base}, so candidate ${candidate} was not built from it`);
  } else if (merged.status !== 0) {
    throw new Error(`git merge-tree failed (${String(merged.stderr || merged.error?.message || '').split('\n')[0]})`);
  } else {
    const tree = merged.stdout.split('\n')[0].trim();
    if (tree !== candidateTree) {
      problems.push(`pull request head ${head} is not the one candidate ${candidate} was built from: base ${base} merged with it gives tree ${tree}, the candidate's tree is ${candidateTree}`);
    }
  }
  return { problems, tree: candidateTree };
}

/** `--bind --base <sha> --head <sha> --candidate <sha>`: exit 0 when bound, 1 when refused, 2 on a usage or git error. */
export function bindMain(argv, { cwd = process.cwd(), log = console.log } = {}) {
  const opts = {};
  try {
    for (let i = 1; i < argv.length; i += 2) {
      const key = argv[i];
      if (argv[0] !== '--bind' || !['--base', '--head', '--candidate'].includes(key) || argv[i + 1] === undefined) {
        throw new Error(`unknown or incomplete argument ${shown(key)}`);
      }
      opts[key.slice(2)] = argv[i + 1];
    }
    const { problems, tree } = bindCandidate({ ...opts, cwd });
    if (problems.length === 0) {
      log(`agent-provenance: bound head=${opts.head} to candidate=${opts.candidate} over base=${opts.base} tree=${tree}`);
      return 0;
    }
    for (const p of problems) log(`agent-provenance: REFUSED ${p}`);
    return 1;
  } catch (e) {
    log(`agent-provenance: cannot bind the range (${shown(String(e.message).split('\n')[0])})`);
    return 2;
  }
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
  const argv = process.argv.slice(2);
  process.exitCode = argv[0] === '--shadow' ? shadowMain(argv) : argv[0] === '--bind' ? bindMain(argv) : main(argv);
}
