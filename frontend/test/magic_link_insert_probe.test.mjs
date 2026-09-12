/**
 * Task #168 — the insert probe's own logic, and the one place the two probes
 * can break each other.
 *
 * THE INTERACTION IS THE IMPORTANT PART OF THIS FILE. Both probes request a
 * magic link for the same address. `check-magic-link-live.mjs` then accepts any
 * message whose `internalDate` post-dates its own request — so if the insert
 * probe fires inside that polling window, the mailbox probe picks up THIS
 * probe's email, follows a perfectly valid link, and passes without ever
 * proving its own mail arrived. A false pass on the one check whose entire
 * value is being believed, and nothing in either script would notice. Only the
 * schedule keeps them apart, so the schedule is asserted here, from source.
 *
 * The rest guards the same overclaiming risk as the mailbox probe: this one
 * cannot see delivery, and a green run must not be allowed to imply it did.
 *
 * Run with:  node --test frontend/test/magic_link_insert_probe.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { maxIdOf, missingConfig, readEnvelope, verdicts } from '../../scripts/check-magic-link-insert.mjs';
import { withoutSafeComments } from '../../scripts/check-unused-imports.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const INSERT_WF = '.github/workflows/magic-link-insert-probe.yml';
const MAIL_WF = '.github/workflows/magic-link-probe.yml';
const INSERT_SCRIPT = 'scripts/check-magic-link-insert.mjs';
const MAIL_SCRIPT = 'scripts/check-magic-link-live.mjs';

// ---------------------------------------------------------------------------
// THE SCHEDULE, which is a correctness requirement rather than housekeeping

/** Minutes-of-day at which a minute/hour cron fires. */
function fireMinutes(cron) {
  const [minute, hour] = cron.trim().split(/\s+/);
  const expand = (field, max) => {
    const out = new Set();
    for (const part of String(field).split(',')) {
      const [range, stepRaw] = part.split('/');
      const step = stepRaw ? Number(stepRaw) : 1;
      let lo = 0;
      let hi = max;
      if (range !== '*') {
        const [a, b] = range.split('-');
        lo = Number(a);
        hi = b === undefined ? Number(a) : Number(b);
      }
      for (let v = lo; v <= hi; v += step) out.add(v);
    }
    return [...out].sort((a, b) => a - b);
  };
  const out = [];
  for (const h of expand(hour, 23)) for (const m of expand(minute, 59)) out.push(h * 60 + m);
  return out.sort((a, b) => a - b);
}

const cronsOf = (wf) => [...read(wf).matchAll(/^\s*- cron: '([^']+)'/gm)].map((m) => m[1]);

test('the fire-minute expansion is right before anything leans on it', () => {
  assert.deepEqual(fireMinutes('0 */4 * * *'), [0, 240, 480, 720, 960, 1200]);
  assert.deepEqual(fireMinutes('30 */4 * * *'), [30, 270, 510, 750, 990, 1230]);
  assert.deepEqual(fireMinutes('15 4 * * *'), [255]);
});

test('the two probes can never fire inside each other window', () => {
  // If they can, the mailbox probe passes on the insert probe's email. The gap
  // is measured against the mailbox probe's OWN budget, read from its source,
  // so moving either one alone fails here.
  const insert = cronsOf(INSERT_WF);
  const mail = cronsOf(MAIL_WF);
  assert.ok(insert.length && mail.length, 'one of the probes has no schedule');

  const budgetMs = Number((/MAGIC_MAIL_BUDGET_MS \|\| ([\d_]+)/.exec(read(MAIL_SCRIPT)) || [])[1]?.replace(/_/g, ''));
  assert.ok(Number.isFinite(budgetMs), 'could not read the mailbox probe mail budget');

  let closest = Infinity;
  for (const a of insert.flatMap(fireMinutes)) {
    for (const b of mail.flatMap(fireMinutes)) {
      // Circular distance in minutes — midnight is not a wall.
      const d = Math.abs(a - b);
      closest = Math.min(closest, Math.min(d, 1440 - d));
    }
  }
  assert.ok(
    closest * 60_000 > budgetMs,
    `the probes fire ${closest} minutes apart, inside the mailbox probe's ${budgetMs}ms polling window — it would accept the insert probe's email as its own`,
  );
});

test('both schedules together stay inside the per-address rate limit', () => {
  // The limiter is per ADDRESS and both probes use the same one, so the
  // arithmetic is over the union of their firings, not each schedule alone.
  const auth = read('cloudflare-worker/src/routes/auth.ts');
  const lim = /magic-start-email:\$\{email\}`, (\d+), (\d+)/.exec(auth);
  assert.ok(lim, 'could not read the per-address limiter');
  const [limit, windowSec] = [Number(lim[1]), Number(lim[2])];

  const all = [...cronsOf(INSERT_WF), ...cronsOf(MAIL_WF)].flatMap(fireMinutes).sort((a, b) => a - b);
  let minGap = 1440 - all[all.length - 1] + all[0];
  for (let i = 1; i < all.length; i += 1) minGap = Math.min(minGap, all[i] - all[i - 1]);
  const perWindow = Math.floor(windowSec / (minGap * 60)) + 1;
  assert.ok(
    perWindow <= limit,
    `the two schedules put up to ${perWindow} requests in the ${windowSec}s window that allows ${limit}`,
  );
});

// ---------------------------------------------------------------------------
// The verdicts — two, and neither of them is about delivery

test('a fast endpoint that commits nothing still fails', () => {
  // The outage's exact shape: the request never reached its INSERT.
  const { rows, ok } = verdicts({ startMs: 180, rowFound: false, rowMs: NaN, startBudgetMs: 5000 });
  assert.equal(ok, false);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.start_latency.ok, true, 'the endpoint was fast and should say so');
  assert.equal(by.token_row_written.ok, false);
  assert.match(by.token_row_written.detail, /did not reach its INSERT/);
});

test('both verdicts are required, and the boundary is inclusive', () => {
  const base = { startMs: 200, rowFound: true, rowMs: 400, startBudgetMs: 5000 };
  assert.equal(verdicts(base).ok, true);
  assert.equal(verdicts({ ...base, startMs: 5001 }).ok, false, 'a slow start passed');
  assert.equal(verdicts({ ...base, startMs: 5000 }).ok, true, 'exactly at budget is within it');
  assert.equal(verdicts({ ...base, rowFound: false }).ok, false, 'a missing row passed');
});

test('a missing latency measurement is never within budget', () => {
  for (const bad of [NaN, undefined, null, 'fast']) {
    assert.equal(verdicts({ startMs: bad, rowFound: true, rowMs: 1, startBudgetMs: 5000 }).ok, false,
      `startMs=${String(bad)} passed`);
  }
});

test('rowFound must be exactly true, not merely truthy', () => {
  for (const v of ['yes', 1, {}, [], 'false']) {
    assert.equal(verdicts({ startMs: 1, rowFound: v, rowMs: 1, startBudgetMs: 9 }).ok, false,
      `rowFound=${JSON.stringify(v)} passed`);
  }
});

test('the probe never claims to have checked delivery', () => {
  // The overclaim this whole file guards. A green run means "answers and
  // commits"; saying more would make it a substitute for the mailbox probe,
  // which is the one thing it must never become.
  const src = read(INSERT_SCRIPT);
  const wf = read(INSERT_WF);
  assert.match(src, /NOT CHECKED HERE: delivery/, 'the script stopped disclaiming delivery');
  assert.match(wf, /says nothing about delivery/i, 'the pass annotation stopped disclaiming delivery');
  assert.match(wf, /magic-link-probe\.yml/, 'the workflow no longer points at the probe that CAN see delivery');
  // And it must not borrow the mailbox probe's verdict names.
  const { rows } = verdicts({ startMs: 1, rowFound: true, rowMs: 1, startBudgetMs: 9 });
  const keys = rows.map((r) => r.key);
  assert.deepEqual(keys, ['start_latency', 'token_row_written']);
  assert.ok(!keys.includes('mail_delivered'), 'it claims a verdict it cannot reach');
  assert.ok(!keys.includes('sign_in_completed'), 'it claims a verdict it cannot reach');
});

// ---------------------------------------------------------------------------
// "Cannot read D1" is not "no row was written"

test('a refused or broken D1 read is reported as could-not-run', () => {
  for (const status of [401, 403]) {
    const out = readEnvelope({ status, body: null });
    assert.equal(out.ok, false);
    assert.equal(out.cannotRun, true, `${status} was not treated as could-not-run`);
    assert.match(out.why, /D1 read/, 'the message does not name the missing permission');
  }
  assert.equal(readEnvelope({ status: 500, body: null }).cannotRun, true);
  // A 200 whose envelope says failure is still a read failure, not a finding.
  const failed = readEnvelope({ status: 200, body: { success: false, errors: [{ code: 7400, message: 'nope' }] } });
  assert.equal(failed.cannotRun, true);
  assert.match(failed.why, /7400: nope/, 'the API error detail is dropped');
  // And the happy path hands the result through.
  const good = readEnvelope({ status: 200, body: { success: true, result: [{ results: [{ id: 9 }] }] } });
  assert.equal(good.ok, true);
  assert.deepEqual(good.result, [{ results: [{ id: 9 }] }]);
});

test('the could-not-run path exits 2, never 1', () => {
  // Exit 1 says "the sign-in flow is broken". Saying that when the truth is a
  // missing D1 permission sends someone hunting a production auth bug.
  const src = read(INSERT_SCRIPT);
  for (const anchor of ['if (!db.ok) {', 'if (!before.ok) {', 'if (!after.ok) {']) {
    const at = src.indexOf(anchor);
    assert.ok(at > 0, `could not find the guard ${anchor}`);
    const block = src.slice(at, at + 260);
    assert.match(block, /process\.exit\(2\)/, `${anchor} does not exit 2`);
    assert.doesNotMatch(block, /process\.exit\(1\)/, `${anchor} exits 1 — that claims the flow is broken`);
  }
});

// ---------------------------------------------------------------------------
// Reading the row id

test('a row id is read out of the D1 answer shape', () => {
  assert.equal(maxIdOf([{ results: [{ id: 41 }] }]), 41);
  assert.equal(maxIdOf([{ results: [{ id: '41' }] }]), 41, 'a stringified id was refused');
  // No tokens for this address yet: MAX(id) is NULL, and the baseline is 0 so
  // that any row at all counts as new.
  assert.equal(maxIdOf([{ results: [{ id: null }] }]), 0);
  assert.equal(maxIdOf([{ results: [] }]), 0);
  // A shape it does not understand is null — NOT zero, which would read as
  // "no rows" and make the next row look new.
  for (const bad of [null, undefined, {}, [], [{}], [{ results: 'nope' }], [{ results: [{ id: 'x' }] }]]) {
    assert.equal(maxIdOf(bad), null, `${JSON.stringify(bad)} was parsed as a count`);
  }
});

test('the verdict rests on the row id, not on a parsed timestamp', () => {
  // `created_at` is a SQLite CURRENT_TIMESTAMP — `'YYYY-MM-DD HH:MM:SS'` in
  // UTC — and `new Date('2026-08-03 12:20:43')` parses as LOCAL time in Node.
  // Comparing that against a runner clock is a timezone bug and a skew bug at
  // once. AUTOINCREMENT ids are monotonic and carry no clock.
  const src = read(INSERT_SCRIPT);
  assert.match(src, /SELECT MAX\(id\) AS id FROM magic_link_tokens WHERE email = \?/,
    'the baseline query changed shape');
  assert.match(src, /after\.id > before\.id/, 'the freshness test is no longer an id comparison');
  // Read the CODE, not the prose: the script's header explains the timezone
  // trap by quoting `new Date('2026-08-03 12:20:43')`, and a naive search finds
  // its own explanation. `withoutSafeComments` is the guard's own helper for
  // exactly this, already mutation-tested in unused_imports_guard.test.mjs.
  assert.ok(!/new Date\(/.test(withoutSafeComments(src)),
    'a Date appeared in the code — the id comparison exists so no clock is handled at all');
  // Scoped to the address, so a real person signing in mid-run is not mistaken
  // for the probe's own row.
  assert.match(src, /params: \[address\]/, 'the query is no longer scoped to the probe address');
});

test('no token material is read', () => {
  const src = read(INSERT_SCRIPT);
  assert.ok(!/token_hash/.test(src),
    'the probe reads token_hash — it needs only the row id, and reading credential material that serves no purpose is not a thing to do');
});

// ---------------------------------------------------------------------------
// Refusing to run is not passing

test('missing config is reported, and two of the three already exist', () => {
  assert.deepEqual(
    missingConfig({}).sort(),
    ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'MAGIC_PROBE_EMAIL'],
  );
  const full = { MAGIC_PROBE_EMAIL: 'a@b.c', CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: 'y' };
  assert.deepEqual(missingConfig(full), []);
  assert.deepEqual(missingConfig({ ...full, MAGIC_PROBE_EMAIL: '   ' }), ['MAGIC_PROBE_EMAIL'],
    'whitespace counted as configuration');
  // It must NOT demand the Gmail OAuth trio — needing one secret instead of
  // four is this probe's entire reason for existing.
  for (const k of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) {
    assert.ok(!missingConfig({}).includes(k), `${k} is required — the probe lost its point`);
  }
});

test('the script exits NON-zero when unconfigured', () => {
  const src = read(INSERT_SCRIPT);
  const block = src.slice(src.indexOf('const missing = missingConfig();'), src.indexOf('const address ='));
  assert.ok(block.length > 100, 'could not read the config guard');
  assert.match(block, /process\.exit\(2\)/, 'unconfigured no longer exits non-zero');
  assert.doesNotMatch(block, /process\.exit\(0\)/, 'unconfigured exits 0 — a pass it never earned');
});

test('the probe is not wired into test:drift', () => {
  // It reaches production and writes a row. A check that cannot run inside the
  // suite must not sit in the suite claiming to have run.
  assert.ok(!/check-magic-link-insert/.test(read('package.json')),
    'the live probe is in package.json — test:drift would reach production');
});

// ---------------------------------------------------------------------------
// The report block, executed rather than grepped

function runBlockOf(wf, stepName) {
  const lines = wf.split('\n');
  const start = lines.findIndex((l) => l.includes(`name: ${stepName}`));
  assert.ok(start >= 0, `no step named ${stepName}`);
  const runAt = lines.findIndex((l, i) => i > start && /^\s*run: \|\s*$/.test(l));
  assert.ok(runAt > start, `the ${stepName} step has no block-scalar run:`);
  const indent = lines[runAt].match(/^\s*/)[0].length;
  const body = [];
  for (let i = runAt + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.trim() === '') { body.push(''); continue; }
    if (l.match(/^\s*/)[0].length <= indent) break;
    body.push(l.slice(indent + 2));
  }
  return body.join('\n');
}

test('only a passing probe is green, and the two failures are told apart', () => {
  const script = runBlockOf(read(INSERT_WF), 'Report the outcome');
  const dir = mkdtempSync(join(tmpdir(), 'insert-probe-'));
  const sh = join(dir, 'report.sh');
  writeFileSync(sh, script);
  const run = (code) => {
    const summary = join(dir, `s-${code || 'empty'}.md`);
    writeFileSync(summary, '');
    const r = spawnSync('bash', [sh], {
      encoding: 'utf8',
      env: { ...process.env, PROBE_CODE: code, GITHUB_STEP_SUMMARY: summary },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, summary: readFileSync(summary, 'utf8') };
  };

  const pass = run('0');
  assert.equal(pass.status, 0, 'a passing probe failed the job');
  assert.match(pass.out, /::notice/);
  assert.match(pass.summary, /Delivery is NOT covered here/, 'the pass summary stopped disclaiming delivery');

  const cannot = run('2');
  assert.equal(cannot.status, 1, 'COULD NOT RUN went green — a pass it never earned');
  assert.match(cannot.out, /::error.*COULD NOT RUN/);
  assert.match(cannot.summary, /MAGIC_PROBE_EMAIL/, 'the summary does not name the secret to add');
  assert.match(cannot.summary, /not.{0,4} a finding about the sign-in flow/i,
    'the summary lets could-not-run read as a broken flow');

  const broke = run('1');
  assert.equal(broke.status, 1, 'a failed probe went green');
  assert.match(broke.out, /::error.*INSERT not reached/);
  assert.match(broke.summary, /token_row_written/);
  assert.match(broke.summary, /start_latency/);

  // Anything unplanned — a step killed before it wrote its output, an exit code
  // from something else — is not a pass.
  for (const code of ['', '3', '127', 'null']) {
    assert.equal(run(code).status, 1, `PROBE_CODE=${JSON.stringify(code)} was treated as a pass`);
  }
});

test('the probe step publishes its exit code, and the report reads it via env', () => {
  const wf = read(INSERT_WF);
  const step = wf.slice(wf.indexOf('id: probe'), wf.indexOf('name: Report the outcome'));
  assert.match(step, /continue-on-error: true/, 'the report step would be skipped on failure');
  assert.match(step, /code=\$code" >> "\$GITHUB_OUTPUT"/, 'the exit code is not published');
  assert.match(step, /exit \$code/, 'the probe step swallows its own failure');
  assert.match(wf, /PROBE_CODE: \$\{\{ steps\.probe\.outputs\.code \}\}/, 'the code is not passed through env');
  const report = wf.slice(wf.indexOf('name: Report the outcome'));
  assert.doesNotMatch(report.slice(report.indexOf('run:')), /\$\{\{/,
    'a workflow expression is interpolated into the report shell');
});

test('it can be dispatched by hand, and it stays on a schedule', () => {
  const wf = read(INSERT_WF);
  assert.match(wf, /^ {2}workflow_dispatch:$/m, 'it cannot be triggered by hand, which is how it gets its first run');
  assert.match(wf, /^ {2}schedule:$/m, 'the schedule block is gone — the cron line survives as inert YAML');
});

// ---------------------------------------------------------------------------
// Wiring

test('the new probe is documented where the other live probes are', () => {
  const scripts = read('scripts/README.md');
  assert.match(scripts, /`check-magic-link-insert\.mjs`/, 'add it to the live-probes table in scripts/README.md');
  const wfReadme = read('.github/workflows/README.md');
  assert.match(wfReadme, /`magic-link-insert-probe\.yml`/, 'add the row to .github/workflows/README.md');
  // Anchored on the row's first cell — see the same fix in
  // magic_link_probe.test.mjs; a mention in someone else's row is not this row.
  const row = wfReadme.split('\n').find((l) => l.startsWith('| `magic-link-insert-probe.yml` |')) || '';
  assert.match(row, /MAGIC_PROBE_EMAIL/, 'the row does not name the one secret to add');
  assert.match(row, /CLOUDFLARE_API_TOKEN/, 'the row does not say the Cloudflare secrets are reused');
  assert.match(row, /deliver/i, 'the row does not say delivery is out of scope');
});

test('D79 records why this is a second probe and not a mode of the first', () => {
  const decisions = read('documentation/architecture/DECISIONS.md');
  // A real heading, not a substring: `## D79x` contains `## D79` and would
  // satisfy an `indexOf`.
  const heading = /^## D79 — .+$/m.exec(decisions);
  assert.ok(heading, 'D79 is missing, or its heading is not `## D79 — …`');
  const body = decisions.slice(heading.index, heading.index + 5000);
  assert.match(body, /D78/, 'D79 does not connect itself to the rule it is preserving');
  // The offset claim has to carry BOTH crons and the budget it is measured
  // against, or it is a sentence rather than a fact. Saying "offset" somewhere
  // is satisfied by the section heading alone.
  assert.match(body, /0 \*\/4 \* \* \*/, 'D79 does not name this probe cron');
  assert.match(body, /30 \*\/4 \* \* \*/, 'D79 does not name the mailbox probe cron it is offset from');
  // Tolerant of the line wrap — the prose is hard-wrapped, so a fixed-space
  // match would fail on a reflow rather than on a missing claim.
  assert.match(body, /120s\s+mail budget/, 'D79 does not say what the offset is measured against');
});
