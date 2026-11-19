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
 * THE REST GUARDS THE LINE BETWEEN ACCEPTANCE AND ARRIVAL. This probe reads
 * `email_send_log`, so it CAN say the mail was handed to Gmail and accepted —
 * the first version of it wrongly disclaimed that, and would have passed on a
 * login that sent nothing. What it still cannot say is that the message
 * ARRIVED, or that the link completes a sign-in. Both halves of that are
 * asserted: it must claim the handoff, and it must not claim the inbox.
 *
 * Run with:  node --test frontend/test/magic_link_insert_probe.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  TEMPLATE_KEY, describeRefusal, maxIdOf, missingConfig, readEnvelope, redactError,
  sendPollDone, sendRowOf, sendVerdict, verdicts,
} from '../../scripts/check-magic-link-insert.mjs';
import { latestCanarySlot } from '../../scripts/check-magic-link-canary.mjs';
import { withoutSafeComments } from '../../scripts/check-unused-imports.mjs';
import { headerComment, indexMode } from '../../scripts/lib/folderFiles.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const INSERT_WF = '.github/workflows/magic-link-insert-probe.yml';
const MAIL_WF = '.github/workflows/magic-link-probe.yml';
const INSERT_SCRIPT = 'scripts/check-magic-link-insert.mjs';
const MAIL_SCRIPT = 'scripts/check-magic-link-live.mjs';

/**
 * An `X || 1234` default read out of a script, so a test cannot hold a stale copy.
 *
 * LOOKED UP WITH `indexOf`, NOT `new RegExp`. Semgrep's
 * `detect-non-literal-regexp` fires when the interpolated value is a function
 * parameter, and `name` is one — it raised alert 6081 on the first version of
 * this helper. `profile_zone_filters.test.mjs` records the same fix for the same
 * rule. The digit scan below is a LITERAL regex over the slice, which is what
 * the rule is asking for; nothing here is built from an argument.
 */
function defaultOf(name, file = INSERT_SCRIPT) {
  const src = read(file);
  const needle = `${name} || `;
  const at = src.indexOf(needle);
  assert.ok(at > 0, `could not read the default for ${name} out of ${file}`);
  const digits = /^[\d_]+/.exec(src.slice(at + needle.length));
  assert.ok(digits, `${name} in ${file} has no numeric default after its \`||\``);
  return Number(digits[0].replace(/_/g, ''));
}

/** A passing send row, so a test about one verdict is not failed by another. */
const SENT = { status: 'sent', lastError: null };

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

/** The closest two schedules ever come, in minutes, midnight not being a wall. */
function canaryFireMinutes() {
  return Array.from({ length: 1440 }, (_, i) => i)
    .filter((minute) => latestCanarySlot(minute * 60_000) === minute * 60_000);
}

function closestGapMinutes(aMinutes, bMinutes) {
  let closest = Infinity;
  for (const a of aMinutes) {
    for (const b of bMinutes) {
      const d = Math.abs(a - b);
      closest = Math.min(closest, Math.min(d, 1440 - d));
    }
  }
  return closest;
}

test('the fire-minute expansion is right before anything leans on it', () => {
  assert.deepEqual(fireMinutes('0 */4 * * *'), [0, 240, 480, 720, 960, 1200]);
  assert.deepEqual(fireMinutes('30 */4 * * *'), [30, 270, 510, 750, 990, 1230]);
  assert.deepEqual(fireMinutes('15 4 * * *'), [255]);
});

test('the nominal request schedules leave the mailbox observation window clear', () => {
  // If they can, the mailbox probe passes on the insert probe's email. The gap
  // is measured against the mailbox probe's OWN budget, read from its source,
  // so moving either one alone fails here.
  const insert = canaryFireMinutes();
  const mail = cronsOf(MAIL_WF).flatMap(fireMinutes);
  assert.ok(insert.length && mail.length, 'one of the probes has no schedule');

  const budgetMs = defaultOf('MAGIC_MAIL_BUDGET_MS', MAIL_SCRIPT);
  const closest = closestGapMinutes(insert, mail);
  assert.ok(
    closest * 60_000 > budgetMs,
    `the probes fire ${closest} minutes apart, inside the mailbox probe's ${budgetMs}ms polling window — it would accept the insert probe's email as its own`,
  );
});

test('the gap also clears this probe own budgets, which are much longer', () => {
  // The send budget is three minutes. A gap that only beat the mailbox probe's
  // 120s would let this probe still be polling when the other one starts asking.
  const ours = defaultOf('MAGIC_ROW_BUDGET_MS') + defaultOf('MAGIC_SEND_BUDGET_MS');
  const closest = closestGapMinutes(canaryFireMinutes(), cronsOf(MAIL_WF).flatMap(fireMinutes));
  assert.ok(
    closest * 60_000 > ours,
    `the probes fire ${closest} minutes apart but this one can still be running ${ours}ms in`,
  );
});

test('the budgets fit inside the job timeout', () => {
  // Raising a budget past the timeout makes the job die with no report at all,
  // which reads as infrastructure trouble rather than as a slow flow.
  const wf = read(INSERT_WF);
  const mins = Number((/timeout-minutes: (\d+)/.exec(wf) || [])[1]);
  assert.ok(Number.isFinite(mins), 'the job has no timeout-minutes');
  const worst = defaultOf('MAGIC_ROW_BUDGET_MS') + defaultOf('MAGIC_SEND_BUDGET_MS');
  assert.ok(worst < mins * 60_000, `the budgets total ${worst}ms but the job is killed at ${mins} minutes`);
});

test('both schedules together stay inside the per-address rate limit', () => {
  // The limiter is per ADDRESS and both probes use the same one, so the
  // arithmetic is over the union of their firings, not each schedule alone.
  const auth = read('cloudflare-worker/src/routes/auth.ts');
  const lim = /magic-start-email:\$\{email\}`, (\d+), (\d+)/.exec(auth);
  assert.ok(lim, 'could not read the per-address limiter');
  const [limit, windowSec] = [Number(lim[1]), Number(lim[2])];

  const all = [...canaryFireMinutes(), ...cronsOf(MAIL_WF).flatMap(fireMinutes)].sort((a, b) => a - b);
  let minGap = 1440 - all[all.length - 1] + all[0];
  for (let i = 1; i < all.length; i += 1) minGap = Math.min(minGap, all[i] - all[i - 1]);
  const perWindow = Math.floor(windowSec / (minGap * 60)) + 1;
  assert.ok(
    perWindow <= limit,
    `the two schedules put up to ${perWindow} requests in the ${windowSec}s window that allows ${limit}`,
  );
});

// ---------------------------------------------------------------------------
// The four verdicts

test('a fast endpoint that commits nothing still fails', () => {
  // The outage's exact shape: the request never reached its INSERT. The 202 is
  // what makes it that shape rather than D173's — an endpoint that ACCEPTED the
  // request and then wrote nothing is the bug; one that refused it is not.
  const { rows, ok } = verdicts({ startMs: 180, startStatus: 202, rowFound: false, rowMs: NaN, sendRow: SENT, startBudgetMs: 5000 });
  assert.equal(ok, false);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.start_latency.ok, true, 'the endpoint was fast and should say so');
  assert.equal(by.endpoint_accepted.ok, true, 'a 202 is acceptance');
  assert.equal(by.token_row_written.ok, false);
  assert.equal(by.token_row_written.skipped, undefined, 'an accepted request must be CHECKED, not skipped');
  assert.match(by.token_row_written.detail, /did not reach its INSERT/);
});

test('all four verdicts are required, and the boundary is inclusive', () => {
  const base = { startMs: 200, startStatus: 202, rowFound: true, rowMs: 400, sendRow: SENT, startBudgetMs: 5000, sendBudgetMs: 180_000 };
  assert.equal(verdicts(base).ok, true);
  assert.equal(verdicts({ ...base, startMs: 5001 }).ok, false, 'a slow start passed');
  assert.equal(verdicts({ ...base, startMs: 5000 }).ok, true, 'exactly at budget is within it');
  assert.equal(verdicts({ ...base, rowFound: false }).ok, false, 'a missing row passed');
  assert.equal(verdicts({ ...base, sendRow: null }).ok, false, 'a missing send passed');
  assert.equal(verdicts({ ...base, sendRow: { status: 'queued' } }).ok, false, 'an undelivered send passed');
  assert.deepEqual(verdicts(base).rows.map((r) => r.key),
    ['start_latency', 'endpoint_accepted', 'token_row_written', 'mail_send_recorded']);
});

test('an unreported status is not a pass', () => {
  // Omitting `startStatus` entirely must fail, exactly as omitting `sendRow`
  // does, so a caller that forgets to pass what the endpoint answered cannot
  // quietly restore the pre-D173 behaviour of reporting a refusal as a finding
  // about the INSERT.
  const base = { startMs: 200, rowFound: true, rowMs: 400, sendRow: SENT, startBudgetMs: 5000, sendBudgetMs: 180_000 };
  assert.equal(verdicts(base).ok, false, 'an absent startStatus passed');
  assert.equal(verdicts({ ...base, startStatus: undefined }).ok, false, 'an undefined startStatus passed');
  assert.equal(verdicts({ ...base, startStatus: null }).ok, false, 'a null startStatus passed');
  assert.equal(verdicts({ ...base, startStatus: 200 }).ok, false, 'a non-202 2xx passed');
  assert.equal(verdicts({ ...base, startStatus: '202' }).ok, false, 'a stringified status passed');
});

test('a send that was never looked up is not a pass', () => {
  // Omitting the argument entirely must fail, so adding a caller that forgets
  // to poll the send log cannot quietly restore the old two-verdict behaviour.
  const base = { startMs: 200, startStatus: 202, rowFound: true, rowMs: 400, startBudgetMs: 5000, sendBudgetMs: 180_000 };
  assert.equal(verdicts(base).ok, false, 'an absent sendRow passed');
  assert.equal(verdicts({ ...base, sendRow: undefined }).ok, false, 'an undefined sendRow passed');
});

test('a missing latency measurement is never within budget', () => {
  for (const bad of [NaN, undefined, null, 'fast']) {
    const { rows, ok } = verdicts({ startMs: bad, startStatus: 202, rowFound: true, rowMs: 1, sendRow: SENT, startBudgetMs: 5000 });
    assert.equal(ok, false, `startMs=${String(bad)} passed`);
    // It must fail on the LATENCY verdict, not merely fall out of the overall
    // pass because some other row is unhappy — otherwise this assertion would
    // survive the latency check being deleted outright.
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.equal(by.start_latency.ok, false, `startMs=${String(bad)} was judged within budget`);
  }
});

test('rowFound must be exactly true, not merely truthy', () => {
  for (const v of ['yes', 1, {}, [], 'false']) {
    assert.equal(verdicts({ startMs: 1, startStatus: 202, rowFound: v, rowMs: 1, sendRow: SENT, startBudgetMs: 9 }).ok, false,
      `rowFound=${JSON.stringify(v)} passed`);
  }
});

// ---------------------------------------------------------------------------
// D173 — a refusal is its own verdict, and the body is what makes it diagnosable
//
// Thirty-nine runs of this workflow failed reporting `token_row_written: ✗ …
// which is exactly how the outage presented`. The endpoint had answered 403 in
// 166ms and never been given the chance to reach an INSERT. These tests pin the
// two halves of the fix: the refusal is CAPTURED with enough detail to tell a
// Worker 403 from an edge 403, and the downstream verdicts stop claiming to
// have checked something they could not.

test('an edge refusal is read as the edge, and says which headers say so', () => {
  const r = describeRefusal({
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      Server: 'cloudflare',
      'CF-RAY': '8d2fa1b2c3d4e5f6-CDG',
    },
    body: '<!DOCTYPE html><html><body>Sorry, you have been blocked</body></html>',
  });
  assert.equal(r.origin, 'edge');
  // The identifying marks must all reach the line, or the reading cannot be
  // checked by the person reading it.
  assert.match(r.line, /status 403/);
  assert.match(r.line, /content-type text\/html/);
  assert.match(r.line, /server cloudflare/);
  assert.match(r.line, /cf-ray 8d2fa1b2c3d4e5f6-CDG/);
  assert.match(r.reading, /WAF|bot/i, 'the edge reading does not name what to go and look at');
  assert.match(r.snippet, /blocked/, 'the body was dropped — it is the evidence');
});

test('a worker refusal is read as the worker, and points at our own gates', () => {
  const r = describeRefusal({
    status: 403,
    headers: { 'content-type': 'application/json', 'cf-ray': '8d2fa1b2c3d4e5f6-CDG' },
    body: '{"error":"forbidden"}',
  });
  assert.equal(r.origin, 'worker');
  assert.match(r.reading, /routes\/auth\.ts/, 'the worker reading does not name the file to read');
  // A cf-ray is on EVERY Cloudflare-fronted response, our own Worker's
  // included, so it must not on its own drag the reading to the edge.
  assert.equal(
    describeRefusal({ status: 400, headers: { 'cf-ray': 'x' }, body: '{"detail":"bad email"}' }).origin,
    'worker',
    'a cf-ray outvoted our own JSON error shape',
  );
});

test('an unrecognised refusal says so rather than guessing', () => {
  // Cloudflare's plaintext firewall page is a real shape and it is NEITHER our
  // JSON nor HTML. Reporting it as `unknown` with the body printed is the
  // honest answer; inventing a rule per Cloudflare body shape is how a reading
  // becomes a guess, which is the defect this whole change exists to end.
  const plain = describeRefusal({
    status: 403,
    headers: { 'content-type': 'text/plain; charset=UTF-8', 'cf-ray': 'abc-CDG' },
    body: 'error code: 1020',
  });
  assert.equal(plain.origin, 'unknown');
  assert.match(plain.reading, /read the snippet/i);
  assert.match(plain.snippet, /error code: 1020/, 'the one readable fact was dropped');
  // JSON-shaped but unparseable, and JSON that is not our error shape, both
  // stay unknown rather than being claimed as ours.
  assert.equal(describeRefusal({ status: 500, headers: {}, body: '{not json' }).origin, 'unknown');
  assert.equal(describeRefusal({ status: 500, headers: {}, body: '{"ok":false}' }).origin, 'unknown');
  // A refusal with no body at all still reports its status.
  const bare = describeRefusal({ status: 502, headers: null, body: '' });
  assert.equal(bare.snippet, null, 'an empty body became an empty-looking snippet rather than nothing');
  assert.equal(bare.line, 'status 502');
});

test('the refusal body is redacted before it reaches a public CI log', () => {
  // Same rule as `last_error`, for the same reason: this prints into a log
  // anyone who can read the repo can read. An error page that echoed the
  // request would otherwise put a live sign-in link there.
  const fake = 'not-a-real-token-not-a-real-token';
  const r = describeRefusal({
    status: 403,
    headers: { 'content-type': 'text/html' },
    body: `<p>blocked:\n  https://axal.vc/api/auth/magic/verify?token=${fake}</p>`,
  });
  assert.ok(!r.snippet.includes(fake), 'the token survived into the refusal snippet');
  assert.ok(!r.snippet.includes('axal.vc/api/auth/magic/verify'), 'the verify URL survived');
  assert.match(r.snippet, /url removed/);
  // Whitespace is collapsed, so the 200-character budget carries words rather
  // than the indentation of an HTML error page.
  assert.ok(!/\n/.test(r.snippet), 'the snippet kept its newlines');
  assert.ok(r.snippet.length <= 201, 'the snippet is unbounded');
});

test('headers are read from a real Headers object as well as a plain one', () => {
  // The script passes `res.headers`, a `Headers` instance with `.get` and no
  // enumerable keys; every fixture here passes a plain object. A reader that
  // only handled one of the two would work in tests and see nothing in CI.
  const h = new Headers({ 'content-type': 'text/html', 'cf-ray': 'abc-CDG', server: 'cloudflare' });
  const r = describeRefusal({ status: 403, headers: h, body: '<html>no</html>' });
  assert.equal(r.origin, 'edge', 'a Headers instance was read as having no headers');
  assert.equal(r.cfRay, 'abc-CDG');
});

test('a refused request does NOT report the outage shape', () => {
  // The headline defect. Both downstream verdicts must read NOT CHECKED and be
  // marked `skipped`, so the report stops sending a reader to routes/auth.ts
  // for an INSERT that was never reachable.
  const refusal = describeRefusal({
    status: 403,
    headers: { 'content-type': 'text/html', 'cf-ray': 'abc-CDG' },
    body: '<html>blocked</html>',
  });
  const { rows, ok } = verdicts({
    startMs: 166, startStatus: 403, refusal,
    rowFound: false, rowMs: NaN, sendRow: null, sendMs: NaN,
    startBudgetMs: 5000, sendBudgetMs: 180_000,
  });
  assert.equal(ok, false, 'a refused request passed');

  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  // The endpoint was genuinely fast. Saying otherwise would be the same class
  // of false finding in the other direction.
  assert.equal(by.start_latency.ok, true, '166ms against a 5000ms budget is not slow');
  assert.equal(by.endpoint_accepted.ok, false);
  assert.equal(by.token_row_written.skipped, true, 'the INSERT verdict was reported as a finding, not as not-checked');
  assert.equal(by.mail_send_recorded.skipped, true, 'the send verdict was reported as a finding, not as not-checked');
  assert.match(by.token_row_written.detail, /NOT CHECKED/);
  assert.match(by.mail_send_recorded.detail, /NOT CHECKED/);

  // The exact sentence that misled for thirty-nine runs must be nowhere in a
  // refused report.
  const all = rows.map((r) => r.detail).join('\n');
  assert.ok(!/exactly how the outage presented/.test(all),
    'a refused request still claims the outage shape — this is the defect D173 exists to fix');
  assert.ok(!/never reached its own INSERT/.test(all),
    'a refused request still blames the send errand');

  // And the refusal's own evidence reaches the report, or the run is no more
  // diagnosable than the thirty-nine that came before it.
  assert.match(by.endpoint_accepted.detail, /REFUSED/);
  assert.match(by.endpoint_accepted.detail, /status 403/);
  assert.match(by.endpoint_accepted.detail, /cf-ray abc-CDG/, 'the cf-ray did not reach the verdict line');
  assert.match(by.endpoint_accepted.detail, /blocked/, 'the body did not reach the verdict line');
  assert.match(by.endpoint_accepted.detail, /WAF|bot/i, 'the reading did not reach the verdict line');
});

test('a skipped verdict denies the pass on its own', () => {
  // `skipped` rows carry `ok: false` today, so this could pass for the wrong
  // reason. Assert the property directly: a row that is skipped must not be
  // countable as a pass even if it were marked ok.
  const rows = [{ key: 'a', ok: true }, { key: 'b', ok: true, skipped: true }];
  assert.equal(rows.every((r) => r.ok && !r.skipped), false);
  // And the script derives its overall verdict that way rather than on `ok`
  // alone — read from source, because a skipped-but-ok row cannot be produced
  // through the public shape.
  assert.match(read(INSERT_SCRIPT), /rows\.every\(\(r\) => r\.ok && !r\.skipped\)/,
    'the overall pass no longer excludes skipped rows');
});

test('a non-2xx is read for its body, and the run stops there', () => {
  const src = read(INSERT_SCRIPT);

  // 1 · the body is actually captured. Without this the verdict has nothing to
  // report and the whole change is decoration.
  const startBlock = src.slice(src.indexOf('/api/auth/magic/start'), src.indexOf('let rowFound'));
  assert.ok(startBlock.length > 200, 'could not bound the /magic/start block');
  assert.match(startBlock, /if \(res\.status !== 202\) \{/, 'the non-202 branch is gone');
  assert.match(startBlock, /await res\.text\(\)/, 'the refusal body is never read');
  assert.match(startBlock, /describeRefusal\(\{ status: res\.status, headers: res\.headers/,
    'the refusal is built without the headers that identify the responder');

  // 2 · a refusal exits BEFORE the polls. Falling through burned three minutes
  // waiting for a row that cannot exist, and then reported its absence as the
  // outage. Positions, not presence: the guard existing below the poll would
  // satisfy a plain `match`.
  const guardAt = src.indexOf('if (startStatus !== 202) {');
  const pollAt = src.indexOf('const rowDeadline');
  assert.ok(guardAt > 0, 'the refusal no longer ends the run');
  assert.ok(pollAt > 0, 'could not find the token poll');
  assert.ok(guardAt < pollAt, 'the refusal guard sits AFTER the row poll — a refused run still polls D1 for a row that cannot exist');
  assert.match(src.slice(guardAt, pollAt), /process\.exit\(1\)/, 'the refusal path does not fail the run');

  // 3 · and it reports through the same printer as the happy path, so the two
  // exits cannot disagree about what a verdict looks like.
  assert.match(src.slice(guardAt, pollAt), /report\(verdicts\(\{/, 'the refusal path builds its own report');
  assert.match(src, /r\.skipped \? '–' : r\.ok \? '✓' : '✗'/, 'a skipped verdict prints as a failure again');
});

// ---------------------------------------------------------------------------
// The send verdict — four outcomes, each sending a reader somewhere different

test('only status sent is a passing send', () => {
  assert.equal(sendVerdict({ row: SENT, sendMs: 82_000, sendBudgetMs: 180_000 }).ok, true);
  for (const status of ['queued', 'failed', 'dlq', 'SENT', 'sent ', 'pending', '']) {
    assert.equal(sendVerdict({ row: { status }, sendBudgetMs: 180_000 }).ok, false,
      `status=${JSON.stringify(status)} was accepted as sent`);
  }
});

test('a missing send-log row leaves provider acceptance unverified', () => {
  for (const row of [null, undefined]) {
    const v = sendVerdict({ row, sendBudgetMs: 180_000 });
    assert.equal(v.ok, false);
    assert.match(v.detail, /no email_send_log row/);
    assert.match(v.detail, /provider acceptance is unverified/);
  }
});

test('a queued row reports the elapsed budget without assuming a delivery result', () => {
  // The whole reason this verdict exists: the token row is committed, the
  // endpoint answered fast, and no mail was sent. Both other verdicts pass.
  const v = sendVerdict({ row: { status: 'queued', lastError: null }, sendBudgetMs: 180_000 });
  assert.equal(v.ok, false);
  assert.match(v.detail, /still queued after 180000ms/, 'it does not say how long it waited');
  assert.match(v.detail, /provider acceptance was not recorded within budget/);
});

test('a failed send carries its cause, redacted', () => {
  const v = sendVerdict({ row: { status: 'failed', lastError: 'gmail_creds_missing' }, sendBudgetMs: 1 });
  assert.equal(v.ok, false);
  assert.match(v.detail, /failed/);
  assert.match(v.detail, /gmail_creds_missing/, 'the cause was dropped — it is the whole diagnostic value');
  // A row with no error still reports its status rather than an empty dash.
  const bare = sendVerdict({ row: { status: 'dlq', lastError: null }, sendBudgetMs: 1 });
  assert.match(bare.detail, /dlq/);
  assert.doesNotMatch(bare.detail, /—\s*$/, 'it trails an empty cause separator');
});

test('a live sign-in link can never reach the log through last_error', () => {
  // `deliverNow` stores the thrown message, and the payload it was thrown from
  // carries the rendered magic_url. CI logs are public to anyone who can read
  // the repo, and the token is valid for 15 minutes.
  // The stand-in token is deliberately repetitive and readable: `.gitleaks.toml`
  // prefers obviously synthetic fixtures to allowlist entries, and a
  // random-looking one trips `generic-api-key` on Shannon entropy alone — which
  // it did, at 4.97, on an earlier probe's fixture.
  const fake = 'not-a-real-token-not-a-real-token';
  const url = `https://axal.vc/api/auth/magic/verify?token=${fake}`;
  const out = sendVerdict({ row: { status: 'failed', lastError: `POST ${url} failed` }, sendBudgetMs: 1 }).detail;
  assert.ok(!out.includes(fake), 'the token survived into the report');
  assert.ok(!out.includes('axal.vc/api/auth/magic/verify'), 'the verify URL survived into the report');
  assert.match(out, /url removed/);
});

test('redaction strips secrets and keeps the diagnostics worth having', () => {
  assert.equal(redactError(null), null);
  assert.equal(redactError(undefined), null);
  // The real error strings the code can produce must survive intact, or the
  // redaction has cost more than it bought.
  const send = read('cloudflare-worker/src/services/email/send.ts');
  for (const msg of ['gmail_creds_missing', 'gmail_send_failed', 'deliver_now_threw']) {
    assert.ok(send.includes(msg), `${msg} is no longer a real error string — re-aim this test`);
    assert.equal(redactError(msg), msg, `${msg} was mangled by redaction`);
  }
  // Long unbroken runs are token-shaped whatever they are.
  assert.equal(redactError('id LONGTOKENLONGTOKENLONGTOKENLONG end'), 'id [redacted] end');
  assert.equal(redactError('short abc123 end'), 'short abc123 end', 'a short token-ish word was redacted');
  // And it cannot grow without bound.
  assert.ok(redactError('word '.repeat(200)).length <= 201);
});

test('the poll stops on a terminal status and waits through the rest', () => {
  for (const status of ['sent', 'failed', 'dlq']) {
    assert.equal(sendPollDone({ status }), true, `${status} is terminal and should stop the poll`);
  }
  for (const row of [null, undefined, { status: 'queued' }, { status: 'pending' }]) {
    assert.equal(sendPollDone(row), false, `${JSON.stringify(row)} stopped the poll early`);
  }
});

// ---------------------------------------------------------------------------
// Claiming the handoff without claiming the inbox

test('the probe claims the Gmail handoff and disclaims arrival', () => {
  // Both halves matter. Dropping the claim makes it undersell what it proves;
  // dropping the disclaimer makes it a substitute for the mailbox probe, which
  // is the one thing it must never become.
  // Read the CODE, not the prose. Both of these phrases also appear in the
  // script's own docblocks — `sendVerdict`'s outcome table literally lists
  // "sent  Gmail accepted the message" — so a search over the raw source is
  // satisfied by the explanation of the claim rather than by the claim, and
  // deleting the real report line leaves the test green. Measured: it did.
  const src = withoutSafeComments(read(INSERT_SCRIPT));
  const wf = read(INSERT_WF);

  assert.match(src, /NOT CHECKED HERE: that the mail ARRIVED/, 'the script stopped disclaiming arrival');
  assert.match(src, /Gmail accepted the message/, 'the script no longer claims the handoff it can prove');
  assert.match(wf, /mailbox probe checks arrival and sign-in/i, 'the pass annotation stopped identifying the separate arrival check');
  assert.match(wf, /magic-link-probe\.yml/, 'the workflow no longer points at the probe that CAN see arrival');

  // It must not borrow the mailbox probe's verdict names: `mail_delivered`
  // would claim the inbox, `sign_in_completed` the session.
  const keys = verdicts({ startMs: 1, startStatus: 202, rowFound: true, rowMs: 1, sendRow: SENT, startBudgetMs: 9 }).rows.map((r) => r.key);
  assert.ok(!keys.includes('mail_delivered'), 'it claims a verdict it cannot reach');
  assert.ok(!keys.includes('sign_in_completed'), 'it claims a verdict it cannot reach');
  assert.ok(keys.includes('mail_send_recorded'), 'the send verdict is gone');
});

test('the send budget clears the slowest send production has actually shown', () => {
  // Measured 2026-09-12 against production `email_send_log`: the four real
  // `auth_magic_link` rows went from `enqueued_at` to `sent_at` in 10s, 29s,
  // 82s and 26s, all on the first attempt. A 60s budget — the first number
  // written here — would have failed the 82s send, which succeeded.
  const SLOWEST_OBSERVED_MS = 82_000;
  const budget = defaultOf('MAGIC_SEND_BUDGET_MS');
  assert.ok(
    budget > SLOWEST_OBSERVED_MS,
    `the send budget is ${budget}ms, under the ${SLOWEST_OBSERVED_MS}ms a real production send has taken`,
  );
});

// ---------------------------------------------------------------------------
// "Cannot read D1" is not "no row was written" and not "no mail was sent"

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
  // missing D1 permission sends someone hunting a production auth bug. Every
  // read in the script is covered, the send-log ones included.
  const src = read(INSERT_SCRIPT);
  for (const anchor of [
    'if (!db.ok) {', 'if (!before.ok) {', 'if (!beforeSend.ok) {',
    'if (!after.ok) {', 'if (!got.ok) {',
  ]) {
    const at = src.indexOf(anchor);
    assert.ok(at > 0, `could not find the guard ${anchor}`);
    const block = src.slice(at, at + 260);
    assert.match(block, /process\.exit\(2\)/, `${anchor} does not exit 2`);
    assert.doesNotMatch(block, /process\.exit\(1\)/, `${anchor} exits 1 — that claims the flow is broken`);
  }
});

test('an unparseable send-log answer is could-not-run, not a missing send', () => {
  // `undefined` and `null` must stay different all the way through: one is "the
  // answer made no sense", the other is "there is genuinely no row".
  assert.equal(sendRowOf(null), undefined);
  assert.equal(sendRowOf('nope'), undefined);
  assert.equal(sendRowOf([{}]), undefined);
  assert.equal(sendRowOf([{ results: 'nope' }]), undefined);
  assert.equal(sendRowOf([{ results: [{ id: 9, status: null }] }]), undefined, 'a null status parsed as a row');
  assert.equal(sendRowOf([{ results: [] }]), null, 'an empty answer must be "no row", not unparseable');
  assert.deepEqual(sendRowOf([{ results: [{ id: 9, status: 'queued', last_error: null }] }]),
    { status: 'queued', lastError: null });
  assert.deepEqual(sendRowOf([{ results: [{ id: 9, status: 'failed', last_error: 'boom' }] }]),
    { status: 'failed', lastError: 'boom' });
  // And the script routes the unparseable case to exit 2 rather than to a verdict.
  const src = read(INSERT_SCRIPT);
  assert.match(src, /if \(row === undefined\) return \{ ok: false, cannotRun: true/,
    'an unparseable send-log answer no longer routes to could-not-run');
});

// ---------------------------------------------------------------------------
// Reading the rows

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

test('both verdicts rest on a row id, not on a parsed timestamp', () => {
  // `created_at` / `enqueued_at` are SQLite CURRENT_TIMESTAMPs —
  // `'YYYY-MM-DD HH:MM:SS'` in UTC — and `new Date('2026-08-03 12:20:43')`
  // parses as LOCAL time in Node. Comparing that against a runner clock is a
  // timezone bug and a skew bug at once. AUTOINCREMENT ids carry no clock.
  const src = read(INSERT_SCRIPT);
  assert.match(src, /SELECT MAX\(id\) AS id FROM magic_link_tokens WHERE email = \?/,
    'the token baseline query changed shape');
  assert.match(src, /SELECT MAX\(id\) AS id FROM email_send_log WHERE to_addr = \? AND template_key = \?/,
    'the send-log baseline query changed shape');
  assert.match(src, /after\.id > before\.id/, 'the token freshness test is no longer an id comparison');
  // Read the CODE, not the prose: the script's header explains the timezone
  // trap by quoting `new Date('2026-08-03 12:20:43')`, and a naive search finds
  // its own explanation. `withoutSafeComments` is the guard's own helper for
  // exactly this, already mutation-tested in unused_imports_guard.test.mjs.
  assert.ok(!/new Date\(/.test(withoutSafeComments(src)),
    'a Date appeared in the code — the id comparison exists so no clock is handled at all');
  // Both queries are scoped to the probe address, so a real person signing in
  // mid-run is not mistaken for the probe's own row.
  assert.match(src, /\[address\]\);/, 'the token query is no longer scoped to the probe address');
  assert.match(src, /\[address, TEMPLATE_KEY\]/, 'the send-log query is no longer scoped to the address');
});

test('an old sent row can never satisfy the send verdict', () => {
  // The August rows are all `status='sent'`. Without the `id > ?` scope, the
  // newest of them would pass this verdict forever — the same trap the token
  // baseline exists to avoid, one table over.
  const src = read(INSERT_SCRIPT);
  assert.match(
    src,
    /FROM email_send_log WHERE to_addr = \? AND template_key = \? AND id > \? ORDER BY id ASC LIMIT 1/,
    'the send-log poll is not scoped to rows newer than the baseline',
  );
  assert.match(src, /\[address, TEMPLATE_KEY, String\(sinceId\)\]/, 'the poll does not bind the baseline id');
  // The baseline is taken before the request, not after.
  const beforeReq = src.slice(0, src.indexOf('/api/auth/magic/start'));
  assert.match(beforeReq, /const beforeSend = await maxSendLogId\(/,
    'the send-log baseline is taken after the request, so this run own row would count as pre-existing');
});

test('the template key the probe looks for is the one the endpoint sends', () => {
  // A renamed template would make the probe watch for a row that never appears
  // and report a broken send forever. Literals on both sides, no constructed
  // regex.
  assert.equal(TEMPLATE_KEY, 'auth_magic_link', 'the probe changed which template it looks for');
  assert.ok(read('cloudflare-worker/src/templates/email/registry.ts').includes('auth_magic_link: t({'),
    'auth_magic_link is no longer a registered template');
  assert.ok(read('cloudflare-worker/src/routes/auth.ts').includes("sendEmail(c.env, 'auth_magic_link'"),
    '/magic/start no longer sends auth_magic_link — the probe is watching the wrong row');
  // And the key is a code constant, not an env override that could point the
  // probe at a template nothing sends.
  assert.ok(!/process\.env\.\w*TEMPLATE/.test(read(INSERT_SCRIPT)),
    'the template key became configurable — a wrong value reads as a healthy silence');
});

test('no token material is read', () => {
  const src = read(INSERT_SCRIPT);
  assert.ok(!/token_hash/.test(src),
    'the probe reads token_hash — it needs only the row id, and reading credential material that serves no purpose is not a thing to do');
  // The send log is read for status and cause only, never the rendered body.
  assert.ok(!/\bSELECT \*/.test(src), 'a SELECT * would pull columns the probe has no business reading');
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

test('the report publishes the observed outcome and fails closed on incomplete results', (t) => {
  const script = runBlockOf(read(INSERT_WF), 'Report the outcome');
  const dir = mkdtempSync(join(tmpdir(), 'insert-probe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summary = join(dir, 'summary.md');
  const run = (code, outcome = '', startStatus = '', failed = '') => {
    writeFileSync(summary, '');
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env, GITHUB_STEP_SUMMARY: summary, PROBE_CODE: code,
        PROBE_OUTCOME: outcome, PROBE_START_STATUS: startStatus, PROBE_FAILED_CHECKS: failed,
      },
    });
    return { status: result.status, log: result.stdout, summary: readFileSync(summary, 'utf8') };
  };

  const pass = run('0', 'ACCEPTED_NOT_VERIFIED', '202');
  assert.equal(pass.status, 0);
  assert.match(pass.log, /::notice/);
  assert.match(pass.summary, /status=sent/);
  assert.match(pass.summary, /mailbox probe checks arrival and sign-in/);

  for (const outcome of ['EDGE_CHALLENGED', 'APPLICATION_REFUSED', 'REFUSED_UNATTRIBUTED']) {
    const r = run('1', outcome);
    assert.equal(r.status, 1);
    assert.match(r.log, /::error/);
    assert.ok(r.summary.includes(outcome));
    assert.match(r.summary, /Token insertion and mail handoff were NOT CHECKED/);
    if (outcome === 'EDGE_CHALLENGED') assert.match(r.summary, /cf-ray/);
  }

  const unavailable = run('2');
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.log, /::error.*COULD NOT RUN/);
  assert.match(unavailable.summary, /missing configuration or D1 read error/);
  const partial = run('2', '', '202');
  assert.equal(partial.status, 1);
  assert.match(partial.summary, /accepted the request .*202.*D1 read failed/);

  const failure = run('1', 'APPLICATION_FAILED', '202', 'mail_send_recorded');
  assert.equal(failure.status, 1);
  assert.match(failure.summary, /Failed checks: mail_send_recorded/);
  const noResponse = run('1', 'APPLICATION_FAILED');
  assert.equal(noResponse.status, 1);
  assert.match(noResponse.summary, /no HTTP response/);

  for (const [code, outcome] of [['', ''], ['0', ''], ['0', 'EDGE_CHALLENGED'], ['1', ''], ['3', ''], ['127', ''], ['null', '']]) {
    const r = run(code, outcome);
    assert.equal(r.status, 1);
    assert.match(r.summary, /INCOMPLETE PROBE RESULT/);
  }
});

test('the CLI publishes the edge challenge and distinguishes D1 failures before and after HTTP 202', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'insert-d1-error-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stub = join(dir, 'fetch.mjs');
  writeFileSync(stub, `
    let accepted = false;
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/api/auth/magic/start') {
        if (process.env.FAIL_PHASE === 'challenge') return new Response('<html>Challenge</html>', {
          status: 403, headers: { 'content-type': 'text/html', 'cf-ray': 'test-ray' },
        });
        accepted = true;
        return new Response(null, { status: 202 });
      }
      if (process.env.FAIL_PHASE === 'before' || accepted) throw new TypeError('network error');
      const result = path.endsWith('/database') ? [{ name: 'studioos-db', uuid: 'fixture' }] : [{ results: [{ id: 0 }] }];
      return Response.json({ success: true, result });
    };
  `);
  for (const phase of ['before', 'after', 'challenge']) {
    const output = join(dir, phase);
    writeFileSync(output, '');
    const result = spawnSync(process.execPath, ['--import', stub, INSERT_SCRIPT], {
      encoding: 'utf8', timeout: 5_000,
      env: {
        GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: output, MAGIC_PROBE_EMAIL: 'fixture@example.invalid', FAIL_PHASE: phase,
        CLOUDFLARE_ACCOUNT_ID: 'fixture', CLOUDFLARE_API_TOKEN: 'fixture',
      },
    });
    const outputs = readFileSync(output, 'utf8');
    if (phase === 'challenge') {
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stdout, /::notice title=StudioOS auth probe::edge-refused/);
      assert.match(outputs, /^outcome=EDGE_CHALLENGED$/m);
      assert.match(outputs, /^failed_checks=endpoint_accepted$/m);
    } else {
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /D1 read failed/);
      assert.equal(outputs, phase === 'after' ? 'start_status=202\n' : '');
    }
  }
});

test('the probe step publishes its exit code, and the report reads it via env', () => {
  const wf = read(INSERT_WF);
  const step = wf.slice(wf.indexOf('id: probe'), wf.indexOf('name: Report the outcome'));
  assert.match(step, /continue-on-error: true/, 'the report step would be skipped on failure');
  assert.match(step, /code=\$code" >> "\$GITHUB_OUTPUT"/, 'the exit code is not published');
  assert.match(step, /exit \$code/, 'the probe step swallows its own failure');
  assert.match(wf, /PROBE_CODE: \$\{\{ steps\.probe\.outputs\.code \}\}/, 'the code is not passed through env');
  for (const [name, output] of [['PROBE_OUTCOME', 'outcome'], ['PROBE_START_STATUS', 'start_status'], ['PROBE_FAILED_CHECKS', 'failed_checks']]) {
    assert.ok(wf.includes(name + ': ${{ steps.probe.outputs.' + output + ' }}'));
  }
  const report = wf.slice(wf.indexOf('name: Report the outcome'));
  assert.doesNotMatch(report.slice(report.indexOf('run:')), /\$\{\{/,
    'a workflow expression is interpolated into the report shell');
});

test('the workflow header names every verdict the code actually produces', () => {
  // DERIVED, NOT TYPED. The header used to read "THREE VERDICTS" and list
  // three; D173 added a fourth and the header is exactly the kind of prose
  // that outlives its fact. Reading the keys out of `verdicts()` means a fifth
  // one cannot be added without the header gaining a line.
  const keys = verdicts({
    startMs: 1, startStatus: 202, rowFound: true, rowMs: 1, sendRow: SENT, startBudgetMs: 9,
  }).rows.map((r) => r.key);
  const header = read(INSERT_WF).split('\non:')[0];
  assert.ok(header.length > 500, 'could not bound the workflow header comment');
  for (const k of keys) {
    assert.ok(header.includes(k), `the workflow header does not name the ${k} verdict`);
  }
  // And the count in the heading must match, or the heading is the stale claim.
  const words = { 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX' };
  assert.ok(header.includes(`${words[keys.length]} VERDICTS:`),
    `the header does not say ${words[keys.length]} VERDICTS — the probe now reports ${keys.length}`);
});

test('scheduled runs only observe D1, while manual runs default to checking the public edge', () => {
  const wf = read(INSERT_WF);
  assert.match(wf, /^ {2}workflow_dispatch:$/m);
  assert.match(wf, /default: public-edge/);
  const lagMinutes = 15;
  const observers = cronsOf(INSERT_WF).flatMap(fireMinutes);
  assert.deepEqual(canaryFireMinutes().map((minute) => (minute + lagMinutes) % 1440).sort((a, b) => a - b), observers);
  const observerStep = wf.slice(wf.indexOf('name: Observe the scheduled'), wf.indexOf('name: Ask for a link'));
  assert.match(observerStep, /if: github\.event_name == 'schedule' \|\| inputs\.probe == 'scheduled-canary'/);
  assert.match(observerStep, /run: node scripts\/check-magic-link-canary\.mjs/);
  for (const step of wf.split('      - name: ').filter((x) => x.startsWith('Ask for a link') || x.startsWith('Report the outcome'))) {
    assert.match(step, /if: github\.event_name == 'workflow_dispatch' && inputs\.probe != 'scheduled-canary'/);
  }
});

// ---------------------------------------------------------------------------
// Wiring

test('the new probe is documented where the other live probes are', () => {
  // #6470: scripts/README.md names it under "The live probes"; its description is the
  // script's header comment, which the README's generated list reads.
  const scripts = read('scripts/README.md');
  assert.equal(indexMode(scripts), 'generated');
  assert.match(scripts.slice(scripts.indexOf('## The live probes'), scripts.indexOf('## The deck harness')), /`check-magic-link-insert\.mjs`/,
    'name it with the other live probes in scripts/README.md');
  const wfReadme = read('.github/workflows/README.md');
  assert.match(wfReadme, /`magic-link-insert-probe\.yml`/, 'add the row to .github/workflows/README.md');
  // Select this workflow's configuration bullet, not the summary inventory row. See
  // magic_link_probe.test.mjs; a mention in someone else's row is not this row.
  const row = wfReadme.split('\n').find((l) => l.startsWith('- `magic-link-insert-probe.yml` ·')) || '';
  assert.match(row, /MAGIC_PROBE_EMAIL/, 'the row does not name the one secret to add');
  assert.match(row, /CLOUDFLARE_API_TOKEN/, 'the row does not say the Cloudflare secrets are reused');
  assert.match(row, /mail_send_recorded/, 'the row does not mention the send verdict');
  assert.match(row, /arriv/i, 'the row does not say arrival is out of scope');
  // Both READMEs must stop saying the old thing: that this probe cannot see
  // delivery at all.
  const scriptsRow = headerComment('check-magic-link-insert.mjs', read('scripts/check-magic-link-insert.mjs'));
  assert.ok(scriptsRow, 'check-magic-link-insert.mjs has no header comment for scripts/README.md\'s generated list');
  assert.ok(!/It cannot see delivery/.test(scriptsRow),
    'the header still claims the probe cannot see delivery — it reads email_send_log now');
  assert.match(scriptsRow, /email_send_log/, 'the header does not say what proves the send');
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

test('D80 records what email_send_log proves and what it still does not', () => {
  const decisions = read('documentation/architecture/DECISIONS.md');
  const heading = /^## D80 — .+$/m.exec(decisions);
  assert.ok(heading, 'D80 is missing, or its heading is not `## D80 — …`');
  const body = decisions.slice(heading.index, heading.index + 6000);
  assert.match(body, /email_send_log/, 'D80 does not name the table the verdict rests on');
  // ANCHOR ON THE LOAD-BEARING SENTENCE, NOT ON A WORD. D80 mentions
  // "acceptance", "arrival", "D79" and "82s" more than once each, so a loose
  // /arriv/i is satisfied by an incidental later mention and deleting the actual
  // claim leaves the test green. Measured: all four escaped that way first.
  assert.match(body, /\*\*Proved: acceptance\.\*\*/, 'D80 does not state plainly that acceptance is what is proved');
  assert.match(body, /\*\*Not proved: arrival\.\*\*/, 'D80 does not state plainly that arrival is not');
  assert.match(body, /verdict and not the mode D79 rejected/,
    'D80 does not answer to the decision it looks like it contradicts');
  assert.match(body, /10s, 29s, 82s and 26s/, 'D80 does not record the measured send latencies that set the budget');
});
