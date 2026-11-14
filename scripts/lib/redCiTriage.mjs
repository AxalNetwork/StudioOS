/**
 * #6326: the `red-ci-triage` skill's decisions, apart from GitHub. Which CI
 * failure digest comment on a PR is the current one, which open `[alert]`
 * issues hold the PR back (AGENTS.md § Red main, D5398, D5604), which failed
 * jobs are real leaves rather than summary gates, which tests, type errors,
 * lint errors and guard failures a raw Actions job log names, and the local
 * command that reproduces each one. The CLI that reads GitHub is
 * `../red-ci-triage.mjs`; tested in `redCiTriage.test.mjs`.
 *
 * It never decides that a failure is someone else's: the verdict is
 * `ciClassify.mjs`'s, judged against main as it was when the PR's run started
 * (not main now), and a current digest's verdict outranks the script's own.
 * A test is called "also red on main" when the same file and test name failed
 * in any of main's failed logs: suite parts are packed per run (test-drift-parts
 * --plan), so a test can sit in a different part on main than on the PR.
 */
import { ALERT_KINDS } from './githubAlerts.mjs';
import { VERDICTS } from './ciClassify.mjs';

export const DIGEST_MARKER = '<!-- studioos-ci-digest:v1 -->';
export const DIGEST_AUTHOR = 'github-actions[bot]';

/** Jobs whose failure only reports other jobs' results (ci.yml). */
export const SUMMARY_JOBS = Object.freeze(['test:drift (full suite)', 'landing gate']);

/** Alerts that change what a slot may do with a red PR, and what each one forbids. */
export const BLOCKING_ALERTS = Object.freeze({
  [ALERT_KINDS['main-red'].title]: 'One repair PR, named on the alert. Do not port it, merge main or re-run for an inherited failure (D5398).',
  [ALERT_KINDS.queue.title]: 'No branch updates, no bulk re-runs, at most one failed-job re-run and only for a PR-specific failure, no dispatched jobs (D5398).',
  [ALERT_KINDS['queue-stalled'].title]: 'Do not add new entries to the merge queue (D5604).',
});

/** The bot's digest comment on a PR, parsed; null when there is none. */
export function parseDigest(comments) {
  const c = (comments || []).find((x) => x?.user?.login === DIGEST_AUTHOR && typeof x.body === 'string' && x.body.startsWith(DIGEST_MARKER));
  if (!c) return null;
  let meta = {};
  try { meta = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(c.body)?.[1] || '{}'); } catch { meta = {}; }
  const jobs = [...c.body.matchAll(/^- \[([^\]]+)\]\((https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/(\d+)\/job\/(\d+))\): (.*)$/gm)]
    .map((m) => ({ name: m[1], url: m[2], runId: Number(m[3]), jobId: Number(m[4]), step: m[5] }));
  return {
    verdict: typeof meta.verdict === 'string' ? meta.verdict : null,
    headSha: typeof meta.headSha === 'string' ? meta.headSha : null,
    digestCount: Number.isSafeInteger(meta.digestCount) ? meta.digestCount : null,
    updatedAt: c.updated_at || c.created_at || null,
    url: c.html_url || null,
    jobs,
  };
}

/** Open `[alert] …` issues (not PRs), each marked with what it forbids, blocking ones first. */
export function openAlerts(issues) {
  return (issues || [])
    .filter((i) => i && !i.pull_request && i.state !== 'closed' && typeof i.title === 'string' && i.title.startsWith('[alert] '))
    .map((i) => ({ number: i.number, title: i.title, url: i.html_url, rule: BLOCKING_ALERTS[i.title] || null }))
    .sort((a, b) => Number(Boolean(b.rule)) - Number(Boolean(a.rule)) || a.number - b.number);
}

/** The newest CI run among those listed (by creation time, then id). */
export function newestRun(runs) {
  return [...(runs || [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0] || null;
}

/** The jobs without the summary gates, for `classify` and `infraFingerprint` (the gate's own failure step is not a setup step). */
export const leafJobs = (jobs) => (jobs || []).filter((j) => j && !SUMMARY_JOBS.includes(j.name));

/**
 * Main's CI run as the PR's run saw it: the newest completed push run on main created before the PR run started.
 * Comparing with main now would call an inherited failure the PR's own once main's repair lands.
 */
export function mainRunBefore(mainRuns, prRun) {
  const start = Date.parse(prRun?.run_started_at || prRun?.created_at || '');
  if (!Number.isFinite(start)) return null;
  return newestRun((mainRuns || []).filter((r) => r && r.status === 'completed' && Date.parse(r.created_at) < start));
}

/**
 * The verdict that governs. The digest is what AGENTS.md § Red main tells a slot to read, so when it is current
 * (written for this head) its verdict wins and the script's reading is shown beside it; otherwise the script's.
 */
export function ruling({ digest, head, run, live }) {
  const digestCurrent = Boolean(digest && digest.headSha === head && run && run.head_sha === head && VERDICTS.includes(digest.verdict));
  if (!digestCurrent) return { verdict: live, source: 'script', disagree: false };
  return { verdict: digest.verdict, source: 'digest', disagree: digest.verdict !== live };
}

/** Failed or timed-out jobs that are leaves, with their failed step. */
export function failedLeafJobs(jobs) {
  return (jobs || [])
    .filter((j) => j && ['failure', 'timed_out'].includes(j.conclusion) && !SUMMARY_JOBS.includes(j.name))
    .map((j) => ({ id: j.id, name: j.name, url: j.html_url || null, conclusion: j.conclusion,
      step: j.steps?.find((s) => ['failure', 'timed_out'].includes(s.conclusion))?.name || null }));
}

/** `suite (worker-2-of-6)` → `worker-2-of-6`; any other job → null. */
export const suitePart = (jobName) => /^suite \(([\w-]+)\)$/.exec(String(jobName))?.[1] || null;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
/** One log line without the Actions timestamp and colour codes. */
export const cleanLine = (line) => String(line).replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').replace(ANSI, '').replace(/\r$/, '');

/** A runner path or file URL → a path from the repository root. */
export function repoPath(p) {
  return String(p).replace(/^file:\/\//, '').replace(/^\/home\/runner\/work\/[^/]+\/[^/]+\//, '').replace(/^\.\//, '');
}

const unquote = (v) => {
  const s = String(v).trim();
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
};

/**
 * Everything a raw job log names as failing.
 *   tests     node --test TAP `not ok` entries with a location (a parent whose only failure is its subtests is dropped)
 *   types     tsc `file(line,col): error TSxxxx: …`
 *   lint      eslint stylish `line:col  error  message  rule` under an absolute file path
 *   guards    `✖ <guard>: …` lines from the guard scripts, with up to five detail lines
 *   failedCommand  `test-drift-parts: "<cmd>" exited N` (the step of a suite part that failed)
 *   failedStep     the last `##[group]Run <cmd>` before the first `##[error]`
 *   errors    other `##[error]` messages (not "Process completed with exit code")
 *   thrown    the last `Error: …` / `Error [CODE]: …` line, for a script that crashed
 *   counts    the TAP totals, summed over every node --test run in the log
 */
export function parseLog(text) {
  const lines = String(text || '').split('\n').map(cleanLine);
  const out = { tests: [], types: [], lint: [], guards: [], failedCommand: null, failedStep: null, errors: [], thrown: null, counts: { tests: 0, pass: 0, fail: 0 } };
  let lastRun = null;
  let lintFile = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const run = /^##\[group\]Run (.+)$/.exec(line);
    if (run) { lastRun = run[1].trim(); continue; }
    const err = /^##\[error\](.*)$/.exec(line);
    if (err) {
      if (!out.failedStep && lastRun) out.failedStep = lastRun;
      if (!/^Process completed with exit code/.test(err[1])) out.errors.push(err[1].trim());
      continue;
    }
    const nok = /^(\s*)not ok \d+ - (.*)$/.exec(line);
    if (nok) {
      const indent = nok[1].length;
      const name = nok[2].replace(/\s+# (?:SKIP|TODO).*$/, '').trim();
      const fields = {};
      for (let k = i + 1; k < lines.length && k < i + 60; k++) {
        const l = lines[k];
        if (new RegExp(`^\\s{${indent}}\\s*\\.\\.\\.\\s*$`).test(l) && k > i + 1) break;
        const f = /^\s+(location|failureType|error|code): (.*)$/.exec(l);
        if (f && !(f[1] in fields)) {
          let value = f[2];
          if (/^[|>]-?$/.test(value.trim())) {
            const body = [];
            const deeper = (lines[k + 1] || '').match(/^\s*/)[0].length;
            for (let m = k + 1; m < lines.length && m < k + 12; m++) {
              const l2 = lines[m];
              if (l2.trim() && l2.match(/^\s*/)[0].length < deeper) break;
              if (l2.trim()) body.push(l2.trim());
            }
            value = body.join(' ');
          }
          fields[f[1]] = unquote(value);
        }
      }
      if (fields.failureType === 'subtestsFailed' || fields.failureType === 'cancelledByParent') continue;
      const loc = /^(.*?):(\d+):(\d+)$/.exec(fields.location || '');
      const file = loc ? repoPath(loc[1]) : (/\.test\.(?:mjs|ts|js)$/.test(name) ? repoPath(name) : null);
      out.tests.push({ file, line: loc ? Number(loc[2]) : null, name, error: (fields.error || '').slice(0, 300), failureType: fields.failureType || null, depth: indent });
      continue;
    }
    const total = /^# (tests|pass|fail) (\d+)$/.exec(line);
    if (total) { out.counts[total[1]] += Number(total[2]); continue; }
    const ts = /^(\S+?\.(?:ts|tsx|mts|js|jsx|mjs))\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (ts) { out.types.push({ file: repoPath(ts[1]), line: Number(ts[2]), code: ts[4], message: ts[5].slice(0, 300) }); continue; }
    if (/^\/\S+\.(?:js|jsx|mjs|ts|tsx)$/.test(line.trim())) { lintFile = repoPath(line.trim()); continue; }
    const lint = /^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}(\S+)\s*$/.exec(line);
    if (lint && lintFile) { out.lint.push({ file: lintFile, line: Number(lint[1]), message: lint[3], rule: lint[4] }); continue; }
    if (line.trim() === '') lintFile = null;
    const guard = /^✖ ([\w.-]+):\s*(.*)$/.exec(line);
    if (guard) {
      const details = [];
      for (let k = i + 1; k < lines.length && details.length < 5 && /^\s+\S/.test(lines[k]); k++) details.push(lines[k].trim().slice(0, 300));
      out.guards.push({ name: guard[1], message: guard[2].slice(0, 300), details });
      continue;
    }
    const thrown = /^(?:[A-Z]\w*)?Error(?: \[\w+\])?: (.+)$/.exec(line);
    if (thrown) out.thrown = line.trim().slice(0, 300);
    const part = /^test-drift-parts: "(.+)" exited (\S+)$/.exec(line);
    if (part) out.failedCommand = part[1];
  }
  const seen = new Set();
  out.tests = out.tests.filter((t) => { const k = `${t.file}\u0000${t.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return out;
}

const globRegex = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?')}$`);

/**
 * The `node … --test` prefixes package.json uses, with the file globs each one owns.
 * `scripts` is package.json's `scripts` object.
 */
export function testRunners(scripts) {
  const runners = [];
  for (const [name, cmd] of Object.entries(scripts || {})) {
    if (typeof cmd !== 'string' || !/^test:/.test(name)) continue;
    for (const seg of cmd.split(' && ')) {
      const at = seg.indexOf(' --test ');
      if (!/^node /.test(seg) || at < 0) continue;
      const patterns = (seg.slice(at + 8).match(/'[^']*'|"[^"]*"|\S+/g) || []).map((s) => s.replace(/^['"]|['"]$/g, ''));
      runners.push({ script: name, prefix: seg.slice(0, at + 8).trim(), patterns, regexes: patterns.map(globRegex) });
    }
  }
  return runners;
}

const shellQuote = (s) => (/^[\w./@%+=:,-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

/** The local command that re-runs one failing test file with the loader its suite uses; null if no suite owns it. */
export function reproduceTest(file, scripts) {
  if (!file) return null;
  const runner = testRunners(scripts).find((r) => r.regexes.some((re) => re.test(file)));
  return runner ? `${runner.prefix} ${shellQuote(file)}` : null;
}

/** The type check that covers a file. */
export function reproduceTypes(file) {
  const f = String(file || '');
  if (f.startsWith('frontend/')) return 'npm run test:types:frontend';
  if (f.startsWith('meeting-bot/')) return 'npx --no-install tsc -p meeting-bot/tsconfig.json';
  if (f.startsWith('merge-control/')) return 'cloudflare-worker/node_modules/.bin/tsc -p merge-control/tsconfig.json';
  return 'npm run test:types';
}

/** The `test:guards` step that prints `✖ <name>:`, e.g. `test-clock` → `node --no-warnings scripts/check-test-clock.mjs`. */
export function guardCommand(name, scripts) {
  const steps = String(scripts?.['test:guards'] || '').split(' && ').map((s) => s.trim());
  const base = String(name).replace(/\.mjs$/, '');
  const wanted = [`${base}.mjs`, `check-${base}.mjs`, `build-${base}.mjs`];
  return steps.find((s) => s.split(/\s+/).some((w) => wanted.some((n) => w === `scripts/${n}` || w.endsWith(`/${n}`)))) || null;
}

/** A tsc path is relative to the project it ran in; find the file it names. */
export function resolveTypePath(file, exists = () => false) {
  if (exists(file)) return file;
  for (const dir of ['cloudflare-worker', 'frontend', 'meeting-bot', 'merge-control']) if (exists(`${dir}/${file}`)) return `${dir}/${file}`;
  return file;
}

/**
 * One triage line per failure, each with the command that reproduces it.
 * `parsed` is parseLog's result for one job; `job` its failedLeafJobs entry.
 */
export function findings(job, parsed, scripts, exists = () => false) {
  const rows = [];
  for (const t of parsed.tests) rows.push({ kind: 'test', job: job.name, file: t.file, line: t.line, what: t.name, why: t.error, reproduce: reproduceTest(t.file, scripts) });
  for (const e of parsed.types) {
    const file = resolveTypePath(e.file, exists);
    rows.push({ kind: 'type', job: job.name, file, line: e.line, what: e.code, why: e.message, reproduce: reproduceTypes(file) });
  }
  for (const l of parsed.lint) rows.push({ kind: 'lint', job: job.name, file: l.file, line: l.line, what: l.rule, why: l.message, reproduce: `npx --no-install eslint --no-warn-ignored ${shellQuote(l.file)}` });
  for (const g of parsed.guards) rows.push({ kind: 'guard', job: job.name, file: null, line: null, what: g.name, why: [g.message, ...g.details].filter(Boolean).join(' | ').slice(0, 400), reproduce: guardCommand(g.name, scripts) });
  if (!rows.length) {
    // ci / fast runs some guards from the base branch's copy under $RUNNER_TEMP/fast-guards; locally that is the checkout.
    const cmd = parsed.failedCommand || (parsed.failedStep ? parsed.failedStep.replace(/"\$RUNNER_TEMP\/fast-guards\/([^"]+)"/g, '$1') : null);
    const why = [...parsed.errors, parsed.thrown].filter(Boolean).join(' | ').slice(0, 400);
    rows.push({ kind: 'step', job: job.name, file: null, line: null, what: job.step || '(step unknown)', why: why || 'No test, type, lint or guard failure was recognised in the log; read it.', reproduce: cmd });
  }
  return rows;
}

/**
 * Mark each PR failure that main's logs also show.
 * `main` is null when main was not read, else { failedJobs: [job names], rows: { job: findings }, unread: [job names] }.
 *   test rows   true when the same file and test name failed in any of main's logs (parts are packed per run);
 *               false when every failed main log was read and none has it; null when one could not be read.
 *   other rows  compared within the same job: false when that job passed on main, null when its main log is unread.
 */
export function markShared(rows, main) {
  if (!main) return rows.map((r) => ({ ...r, onMain: null }));
  const failedJobs = main.failedJobs || [];
  const byJob = main.rows || {};
  const unread = main.unread || [];
  const allTests = Object.values(byJob).flat().filter((m) => m.kind === 'test');
  return rows.map((r) => {
    if (r.kind === 'test') {
      if (allTests.some((m) => m.file === r.file && m.what === r.what)) return { ...r, onMain: true };
      return { ...r, onMain: unread.length ? null : false };
    }
    if (!failedJobs.includes(r.job)) return { ...r, onMain: false };
    const m = byJob[r.job];
    if (!m) return { ...r, onMain: null };
    return { ...r, onMain: m.some((x) => x.kind === r.kind && x.file === r.file && x.what === r.what) };
  });
}

/**
 * What the slot does next (AGENTS.md § Red main and a backed-up queue). `verdict` is `ruling()`'s;
 * `mainNow` is the conclusion of main's latest completed CI run, which may be newer than the one the verdict used.
 */
export function nextStep({ verdict, rows = [], alerts = [], mainNow = null }) {
  const mainRed = alerts.find((a) => a.title === ALERT_KINDS['main-red'].title);
  const queue = alerts.find((a) => a.title === ALERT_KINDS.queue.title);
  if (verdict === 'infra_failure') {
    return 'Runner setup failed (Set up job, checkout or npm ci): not a test failure, and nothing to fix on the branch. Say so in STATUS.'
      + (queue ? ` While #${queue.number} is open: at most one failed-job re-run, and only for a PR-specific failure.` : '');
  }
  if (verdict === 'inherited_main_failure') {
    const hidden = rows.filter((r) => r.onMain === false);
    const later = hidden.length ? ` Note in STATUS the ${hidden.length} failure(s) not in main's log, to fix once main is green.` : '';
    if (mainNow === 'success') {
      return `Inherited from main, and main is green now. Do not port the repair. Let the PR revalidate; merge main once only if it needs a fresh run (AGENTS.md § Red main, rule 3).${later}`;
    }
    return `Do nothing to the PR. STATUS: blockers: inherited main failure, ${mainRed ? `#${mainRed.number}` : '<alert issue>'}. No port, no merge of main, no re-run.${later}`;
  }
  if (verdict === 'main_health_unknown') return 'Main could not be read: treat every failure as this PR\'s own until you know otherwise.';
  if (!rows.length) return 'Read the failed job log: nothing was recognised.';
  const own = rows.filter((r) => r.onMain !== true);
  return own.length ? 'Reproduce each failure not marked [also red on main] locally with its command, fix it on this branch, push once.'
    : 'Every failure found here is also in main\'s logs; the part the verdict calls this PR\'s own needs its log read.';
}
