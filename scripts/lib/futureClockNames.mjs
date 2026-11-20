/**
 * D7124: the nightly future-clock run's failing tests, made readable where
 * D5663 allows them: the trusted reporter's job log and step summary. The
 * alert issue and the Slack text get two derived facts only, the break date
 * and a pointer to the run summary, never a test name.
 *
 * On 2026-11-15 the run said "2 verified test failures with the clock 7 days
 * ahead" and linked a run whose names sat only in a 3-day artifact. Nobody
 * opened it, and 46.6 hours later one of those tests stopped the merge queue
 * for 6 h 25 min (#7108).
 */

const DAY = 86_400_000;

/** The repository path of a test file in a TAP `location:` (absolute on the runner) or a file-level test name. */
export function repoTestPath(text) {
  const m = /(?:^|\/)((?:frontend|cloudflare-worker|meeting-bot|merge-control|scripts)\/(?:[\w.-]+\/)*[\w.-]+\.test\.(?:mjs|ts))(?::\d+(?::\d+)?)?$/.exec(String(text || ''));
  return m && !m[1].split('/').includes('..') ? m[1] : null;
}

/**
 * Every failed test in node:test TAP, nested ones included, as `{ file, test }`, in order and de-duplicated. A
 * suite (`describe`) that failed only because a child did is left out; its children are listed. A file that failed
 * outside any test is listed under its own path.
 */
export function tapFailures(tap) {
  const lines = String(tap || '').split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)not ok \d+ - (.+?)\s*(?:# (?:SKIP|TODO)\b.*)?$/.exec(lines[i]);
    if (!m) continue;
    let location = null; let suite = false;
    if (/^\s*---$/.test(lines[i + 1] || '')) {
      for (let j = i + 2; j < lines.length && !/^\s*\.\.\.$/.test(lines[j]); j++) {
        const loc = /^\s*location: '(.+)'$/.exec(lines[j]);
        if (loc && !location) location = loc[1];
        if (/^\s*type: 'suite'$/.test(lines[j])) suite = true;
      }
    }
    const name = m[2];
    const file = repoTestPath(location) || repoTestPath(name);
    if (suite || !file) continue;
    const test = repoTestPath(name) === file ? file : name;
    const key = `${file}\u0000${test}`;
    if (!seen.has(key)) { seen.add(key); out.push({ file, test }); }
  }
  return out;
}

/** The day these failures break main: the run's start plus `days`, as YYYY-MM-DD (UTC); null when unreadable. */
export function breakDate(startedAt, days = 7) {
  const t = Date.parse(startedAt || '');
  return Number.isFinite(t) ? new Date(t + days * DAY).toISOString().slice(0, 10) : null;
}

/** A test name as markdown may carry it: no backtick, angle bracket, ampersand, backslash, pipe, control character or mention. */
export const safeTestName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f`<>&\\|]/g, ' ').replaceAll('@', ' at ').replace(/\s+/g, ' ').trim().slice(0, 200);

/** At most this many failures are listed in the job log and step summary; the rest are counted. */
export const LIST_MAX = 50;

/** The command that reruns one file the way the nightly ran it (scripts/future-clock-changed.mjs). */
export const reproduce = (file) => `node scripts/future-clock-changed.mjs --offset +7d ${file}`;

/**
 * The reporter's step summary and job log text: each failure with its part and file, and how to reproduce it.
 * `failures` are `[{ part, file, test }]` from verified parts only.
 */
export function futureClockSummary({ failures = [], failed = 0, days = 7, broke = null, runUrl = null, complete = true }) {
  const shown = failures.slice(0, LIST_MAX);
  const files = [...new Set(shown.map((f) => f.file))];
  const head = failed
    ? `### ${failed} test failure(s) with the clock ${days} days ahead (D7124)\n\nThey break main${broke ? ` by ${broke}` : ''} unless they are fixed first. An open \`[alert] future-clock tests failing\` is a main repair due before that date (AGENTS.md § Red main).`
    : `### No test fails with the clock ${days} days ahead (D7124)`;
  const partial = complete ? '' : '\n\nThe evidence is incomplete: some parts could not be verified, so this list may be short (D5663).';
  if (!shown.length) return `${head}${partial}\n`;
  const rows = shown.map((f) => `| ${safeTestName(f.part)} | \`${f.file}\` | ${safeTestName(f.test)} |`);
  const more = failures.length > shown.length ? `\n\n…and ${failures.length - shown.length} more.` : '';
  return `${head}${partial}\n\n| Part | File | Test |\n| --- | --- | --- |\n${rows.join('\n')}${more}\n\nReproduce one file:\n\n\`\`\`sh\n${files.map(reproduce).join('\n')}\n\`\`\`\n\nFix: freeze the clock in the test (\`t.mock.timers.enable({ apis: ['Date'], now })\`) or pass \`nowMs\` into the code under test.${runUrl ? `\n\nRun: ${runUrl}` : ''}\n`;
}

/** The same failures as plain job-log lines. */
export function futureClockLogLines({ failures = [], broke = null }) {
  const shown = failures.slice(0, LIST_MAX);
  return [
    ...shown.map((f) => `future-clock: ${safeTestName(f.part)} ${f.file} › ${safeTestName(f.test)}`),
    ...(failures.length > shown.length ? [`future-clock: …and ${failures.length - shown.length} more`] : []),
    ...[...new Set(shown.map((f) => f.file))].map((file) => `future-clock: reproduce: ${reproduce(file)}`),
    ...(broke && shown.length ? [`future-clock: these break main by ${broke}`] : []),
  ];
}

const RUN_LINE = /^Latest failing run: /;
const RUN_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/[1-9]\d*$/;

/**
 * The open alert issue's body with one line naming the newest failing run, replacing an earlier one, before the
 * health marker, so the link always reaches a run whose summary still exists. Derived facts only (D5663).
 */
export function withFutureClockRunLine(body, { runUrl, broke }) {
  const text = String(body || '');
  if (!RUN_URL.test(runUrl || '') || !/^\d{4}-\d{2}-\d{2}$/.test(broke || '')) return text;
  const line = `Latest failing run: [run](${runUrl}). The failing test names and the reproduce command are in its summary. A failure first seen in that run breaks main by ${broke}.`;
  const kept = text.split('\n').filter((l) => !RUN_LINE.test(l)).join('\n');
  const at = kept.indexOf('<!-- studioos-health:v1');
  return at < 0 ? `${kept.trimEnd()}\n\n${line}` : `${kept.slice(0, at).trimEnd()}\n\n${line}\n\n${kept.slice(at)}`;
}
