/**
 * Task #168 — the magic-link probe's own logic, tested without a network.
 *
 * The probe itself can only run in CI against production. That is exactly
 * why its PARSING and VERDICT logic has to be covered here: the one thing
 * worse than an unverified fix is a probe that reports a pass it did not
 * earn, and every way this script could do that lives in these functions.
 *
 * The three that can lie, and what they would lie about:
 *
 *   `isFreshMessage`  — accept a leftover email from an earlier run and the
 *                       probe passes for months after delivery breaks.
 *   `verdicts`        — collapse three findings into one and a silent
 *                       delivery failure hides behind a fast endpoint.
 *   `verifyOutcome`   — read a `magic_error=` redirect as success and the
 *                       probe passes while sign-in is broken.
 *
 * Run with:  node --test frontend/test/magic_link_probe.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  extractMagicToken, decodeGmailBody, isFreshMessage, verdicts,
  verifyOutcome, missingConfig,
} from '../../scripts/check-magic-link-live.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

// Deliberately READABLE rather than random-looking. A fixture that imitates a
// real token trips gitleaks' `generic-api-key` rule on Shannon entropy — the
// first version of this file did, and failed CI — and `.gitleaks.toml` asks
// for "test fixtures with obviously synthetic IDs" instead of an allowlist
// entry, which is right: an exemption for a random-looking string is a
// standing invitation to hide a real one behind it. It still exercises
// everything the extraction needs: mixed case, digits, `-` and `_`, and
// enough length for the quoted-printable cut below to land mid-token.
const TOKEN = 'EXAMPLE-not-a-real-token-0123456789-aBcD_xyz';
const LINK = `https://axal.vc/api/auth/magic/verify?token=${TOKEN}`;

// ---------------------------------------------------------------------------
// Pulling the token out of a real-ish email

test('the token survives what mail does to a URL', () => {
  // Each of these is something a mail pipeline really does, and each would
  // otherwise hand back a truncated token that verify rejects as invalid —
  // reporting a broken sign-in when sign-in is fine.
  assert.equal(extractMagicToken(`Click here: ${LINK}`), TOKEN);
  assert.equal(extractMagicToken(`<a href="${LINK}">Sign in</a>`), TOKEN);
  assert.equal(extractMagicToken(`<a href='${LINK}'>Sign in</a>`), TOKEN);
  assert.equal(extractMagicToken(`Go to ${LINK}.`), TOKEN, 'a trailing sentence full stop was kept');
  assert.equal(extractMagicToken(`(${LINK})`), TOKEN);
  // A following query parameter stops the token, entity-encoded or not. This
  // passes because `&` is outside the token charset, NOT because anything
  // decodes `&amp;` — the probe deliberately has no such step, and a test
  // that claimed otherwise would be pinning a line that does not exist.
  assert.equal(extractMagicToken(`${LINK}&next=%2Fdeals`), TOKEN);
  assert.equal(extractMagicToken(`${LINK}&amp;next=%2Fdeals`), TOKEN);
});

test('an entity-encoded `=` in token= is still a link', () => {
  // THIS is the entity case that matters: a template that writes `&#61;`
  // leaves `verify?token&#61;<token>`, which the URL pattern does not match
  // at all — so the probe would report "no link arrived" on mail that did.
  assert.equal(
    extractMagicToken(`https://axal.vc/api/auth/magic/verify?token&#61;${TOKEN}`),
    TOKEN,
  );
});

test('a quoted-printable soft break does not cut the token in half', () => {
  // Encoders wrap at 76 columns with `=\r\n`. A token split across that
  // boundary is the classic way this kind of probe reports a false failure.
  const cut = TOKEN.length - 12;
  const wrapped = `https://axal.vc/api/auth/magic/verify?token=${TOKEN.slice(0, cut)}=\r\n${TOKEN.slice(cut)}`;
  assert.equal(extractMagicToken(wrapped), TOKEN);
});

test('a body with no magic link yields null, not a guess', () => {
  for (const body of [
    '', null, undefined,
    'Your receipt is attached.',
    'https://axal.vc/login',                                  // a login link, not a magic one
    'https://axal.vc/api/auth/magic/verify',                  // the path with no token
  ]) {
    assert.equal(extractMagicToken(body), null, `${JSON.stringify(body)} produced a token`);
  }
});

test('a Gmail payload is flattened across every nested part', () => {
  // Gmail nests multipart/alternative inside multipart/related routinely;
  // the link may be in either the plain or the HTML half.
  const payload = {
    body: {},
    parts: [
      { mimeType: 'text/plain', body: { data: b64('Sign in: no link in this half') } },
      {
        mimeType: 'multipart/alternative',
        parts: [{ mimeType: 'text/html', body: { data: b64(`<a href="${LINK}">Sign in</a>`) } }],
      },
    ],
  };
  assert.equal(extractMagicToken(decodeGmailBody(payload)), TOKEN);
});

test('a part that will not decode does not lose the rest of the message', () => {
  // `Buffer.from(junk, 'base64')` does not throw — it drops the invalid
  // characters — so a garbage string proves only that parts are concatenated.
  // To actually exercise the try/catch, the first part's data throws when
  // read, which is what a hostile or malformed payload amounts to.
  const payload = {
    parts: [
      { body: { data: { toString() { throw new Error('unreadable part'); } } } },
      { body: { data: '!!!not base64!!!' } },
      { body: { data: b64(LINK) } },
    ],
  };
  assert.equal(extractMagicToken(decodeGmailBody(payload)), TOKEN,
    'one bad part took the whole message down');
  assert.equal(decodeGmailBody(null), '');
  assert.equal(decodeGmailBody({}), '');
});

// ---------------------------------------------------------------------------
// THE STALE-MESSAGE TRAP

test('a message from before the request is never this run\'s', () => {
  // Without this the probe finds last week's link, passes, and keeps passing
  // long after delivery has stopped — the exact shape of the /api/health
  // smoke that stayed green through the original outage.
  const requestedAt = 1_757_000_000_000;
  assert.equal(isFreshMessage({ internalDate: String(requestedAt + 1000) }, requestedAt), true);
  assert.equal(isFreshMessage({ internalDate: String(requestedAt) }, requestedAt), false,
    'a message at the exact request instant predates the send');
  assert.equal(isFreshMessage({ internalDate: String(requestedAt - 1) }, requestedAt), false);
  assert.equal(isFreshMessage({ internalDate: String(requestedAt - 86_400_000) }, requestedAt), false);
});

test('a message with no usable timestamp is refused, not assumed fresh', () => {
  const requestedAt = 1_757_000_000_000;
  for (const m of [
    {}, null, undefined, { internalDate: '' }, { internalDate: 'yesterday' },
    // These two are the ones the `Number.isFinite` guard actually earns:
    // every case above already fails the `> requestedAtMs` comparison on its
    // own (NaN and 0 are both not greater), but an infinite timestamp IS
    // greater than any instant and would sail through as fresh.
    { internalDate: '1e999' }, { internalDate: 'Infinity' },
  ]) {
    assert.equal(isFreshMessage(m, requestedAt), false, `${JSON.stringify(m)} was treated as fresh`);
  }
});

// ---------------------------------------------------------------------------
// The verdicts — three, separately

test('a fast endpoint does not cover for mail that never arrived', () => {
  // THE REGRESSION THE ROUND-TRIP EXISTS FOR. D74 moved the send to
  // `waitUntil`, so /magic/start can answer in 200ms while nothing is
  // delivered. A single pass/fail would read this as healthy.
  const { rows, ok } = verdicts({
    startMs: 200, mailMs: NaN, signedIn: false,
    startBudgetMs: 5000, mailBudgetMs: 120_000,
  });
  assert.equal(ok, false);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.start_latency.ok, true, 'the endpoint really was fast and should say so');
  assert.equal(by.mail_delivered.ok, false);
  assert.equal(by.sign_in_completed.ok, false);
  assert.match(by.mail_delivered.detail, /never deliver/);
});

test('every one of the three has to pass for the probe to pass', () => {
  const base = { startMs: 200, mailMs: 4000, signedIn: true, startBudgetMs: 5000, mailBudgetMs: 120_000 };
  assert.equal(verdicts(base).ok, true);
  assert.equal(verdicts({ ...base, startMs: 5001 }).ok, false, 'a slow start passed');
  assert.equal(verdicts({ ...base, mailMs: 120_001 }).ok, false, 'late mail passed');
  assert.equal(verdicts({ ...base, signedIn: false }).ok, false, 'a failed sign-in passed');
  // The budgets are inclusive at the boundary, and that is deliberate: a
  // response exactly at budget is within it.
  assert.equal(verdicts({ ...base, startMs: 5000 }).ok, true);
  assert.equal(verdicts({ ...base, mailMs: 120_000 }).ok, true);
});

test('a missing measurement never counts as within budget', () => {
  // `NaN <= budget` is false in JS, but relying on that silently is how a
  // never-measured value becomes a pass after a refactor.
  for (const bad of [NaN, undefined, null, 'fast']) {
    assert.equal(verdicts({ startMs: bad, mailMs: 1, signedIn: true, startBudgetMs: 5000, mailBudgetMs: 9 }).ok,
      false, `startMs=${String(bad)} passed`);
    assert.equal(verdicts({ startMs: 1, mailMs: bad, signedIn: true, startBudgetMs: 5000, mailBudgetMs: 9 }).ok,
      false, `mailMs=${String(bad)} passed`);
  }
});

test('signedIn must be exactly true — not merely truthy', () => {
  for (const v of ['yes', 1, {}, [], 'false']) {
    assert.equal(verdicts({ startMs: 1, mailMs: 1, signedIn: v, startBudgetMs: 9, mailBudgetMs: 9 }).ok,
      false, `signedIn=${JSON.stringify(v)} passed`);
  }
});

// ---------------------------------------------------------------------------
// Reading the verify redirect

test('only the success redirect counts as a sign-in', () => {
  assert.equal(verifyOutcome({ status: 302, location: 'https://axal.vc/deals?magic=ok' }).ok, true);
  assert.equal(verifyOutcome({ status: 302, location: 'https://axal.vc/validate?magic=ok' }).ok, true);
});

test('every magic_error redirect is a failure, and names its code', () => {
  // These are the refusals `/magic/verify` can emit. Reading any of them as
  // success would have the probe pass while sign-in is broken.
  for (const code of ['invalid', 'expired', 'rate', 'limiter', 'inactive', 'error']) {
    const out = verifyOutcome({ status: 302, location: `https://axal.vc/login?magic_error=${code}` });
    assert.equal(out.ok, false, `magic_error=${code} was read as success`);
    // Asserting only that `why` CONTAINS the code would be satisfied by the
    // generic "redirected somewhere unexpected: <the whole url>" fallback,
    // which quotes the URL and therefore the code — so the refusal branch
    // would not be pinned at all. Require its own wording.
    assert.match(out.why, new RegExp(`refused the link: magic_error=${code}$`),
      `a magic_error redirect fell through to the generic branch instead of being named as a refusal`);
  }
  // And the real handler still emits that shape.
  const auth = read('cloudflare-worker/src/routes/auth.ts');
  assert.match(auth, /magic_error=\$\{code\}/,
    'verify no longer redirects with magic_error — the probe reads a shape that is gone');
  assert.match(auth, /\?magic=ok/,
    'verify no longer redirects with magic=ok — the probe would never see a success');
});

test('anything that is not that redirect is a failure', () => {
  assert.equal(verifyOutcome({ status: 200, location: null }).ok, false);
  assert.equal(verifyOutcome({ status: 500, location: null }).ok, false);
  assert.equal(verifyOutcome({ status: 302, location: 'https://axal.vc/' }).ok, false);
  assert.equal(verifyOutcome({ status: 302, location: '' }).ok, false);
  // `magic=okay` is not `magic=ok`.
  assert.equal(verifyOutcome({ status: 302, location: 'https://axal.vc/deals?magic=okay' }).ok, false);
  // The status has to be checked on its own, and this is the only input that
  // proves it is: every case above is already refused by the location, so
  // dropping the status check would leave them all passing. A 200 carrying a
  // success-shaped Location header is not a redirect and did not sign anyone
  // in — if verify ever answers that way, the probe must go red, not quietly
  // accept a page it never followed.
  assert.equal(verifyOutcome({ status: 200, location: 'https://axal.vc/deals?magic=ok' }).ok, false,
    'a non-redirect status was accepted because its Location looked right');
  assert.equal(verifyOutcome({ status: 301, location: 'https://axal.vc/deals?magic=ok' }).ok, false);
});

// ---------------------------------------------------------------------------
// Refusing to run is not passing

test('missing config is reported, never silently skipped', () => {
  assert.deepEqual(
    missingConfig({}).sort(),
    ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'MAGIC_PROBE_EMAIL'].sort(),
  );
  const full = {
    MAGIC_PROBE_EMAIL: 'a@b.c', GMAIL_CLIENT_ID: 'x',
    GMAIL_CLIENT_SECRET: 'y', GMAIL_REFRESH_TOKEN: 'z',
  };
  assert.deepEqual(missingConfig(full), []);
  // Whitespace is not configuration.
  assert.deepEqual(missingConfig({ ...full, GMAIL_REFRESH_TOKEN: '   ' }), ['GMAIL_REFRESH_TOKEN']);
});

test('the script exits NON-zero when unconfigured', () => {
  // The whole point of #168: the post-deploy smoke only probed /api/health,
  // which is RATE_LIMIT_EXEMPT, and stayed green straight through the
  // outage. A probe that exits 0 when it never ran repeats that mistake.
  const src = read('scripts/check-magic-link-live.mjs');
  const block = src.slice(src.indexOf('const missing = missingConfig();'), src.indexOf('const address ='));
  assert.ok(block.length > 100, 'could not read the config guard');
  assert.match(block, /process\.exit\(2\)/, 'unconfigured no longer exits non-zero');
  assert.doesNotMatch(block, /process\.exit\(0\)/, 'unconfigured exits 0 — it would report a pass it never earned');
});

test('the probe is not wired into test:drift', () => {
  // It needs production and secrets. A check that cannot run in the suite
  // must not be in the suite claiming to have run.
  const pkg = read('package.json');
  assert.ok(!/check-magic-link-live/.test(pkg),
    'the live probe is in package.json — test:drift would try to reach production');
});

test('the probe respects the limits the worker actually enforces', () => {
  // Read off auth.ts rather than trusted: a probe that trips its own
  // limiter fails for a reason that has nothing to do with the fix.
  const auth = read('cloudflare-worker/src/routes/auth.ts');
  assert.match(auth, /magic-start-email:\$\{email\}`, 3, 900/,
    'the per-address limit changed — recheck the probe schedule against it');
  const src = read('scripts/check-magic-link-live.mjs');
  assert.match(src, /res\.status === 429/, 'the probe no longer notices being rate-limited');
  assert.match(src, /3 per 900s/, 'the probe stopped naming the limit it must stay under');
});

// ---------------------------------------------------------------------------
// The workflow that runs it — the schedule and, above all, what counts as green

const WORKFLOW = '.github/workflows/magic-link-probe.yml';

/**
 * The smallest gap, in seconds, between two firings of a 5-field cron.
 *
 * Day-of-month / month / day-of-week are deliberately ignored: constraining
 * them can only make gaps LARGER, so treating them as `*` is a lower bound —
 * conservative in the direction that matters here.
 */
function minGapSeconds(cron) {
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
  const fires = [];
  for (const h of expand(hour, 23)) for (const m of expand(minute, 59)) fires.push(h * 60 + m);
  fires.sort((a, b) => a - b);
  if (fires.length < 2) return 86_400;
  let gap = 1440 - fires[fires.length - 1] + fires[0];   // across midnight
  for (let i = 1; i < fires.length; i += 1) gap = Math.min(gap, fires[i] - fires[i - 1]);
  return gap * 60;
}

test('the gap calculator is right about the crons in this repo', () => {
  // It underpins the limiter assertion below, so it gets its own check —
  // otherwise a broken calculator would wave through any schedule at all.
  assert.equal(minGapSeconds('30 */4 * * *'), 4 * 3600);
  assert.equal(minGapSeconds('0 */6 * * *'), 6 * 3600, 'the SPA smoke cadence');
  assert.equal(minGapSeconds('*/5 * * * *'), 300);
  assert.equal(minGapSeconds('15 4 * * *'), 86_400, 'once a day');
  assert.equal(minGapSeconds('0,30 * * * *'), 1800);
  assert.equal(minGapSeconds('0 0,1 * * *'), 3600, 'here the wrap past midnight is the widest gap');
  // And here it is the SMALLEST — 23:00 to 00:00 is an hour, while the only
  // in-day gap is 23. Drop the wrap term and this returns 82800s, waving
  // through a schedule that fires twice in quick succession every night.
  assert.equal(minGapSeconds('0 0,23 * * *'), 3600, 'the gap across midnight was not measured');
});

test('the schedule cannot trip the limiter the worker actually enforces', () => {
  // A probe that fails because it rate-limited ITSELF reports a broken
  // sign-in when sign-in is fine — the same false-alarm class the token-
  // truncation cases above guard.
  const wf = read(WORKFLOW);
  const auth = read('cloudflare-worker/src/routes/auth.ts');
  const lim = /magic-start-email:\$\{email\}`, (\d+), (\d+)/.exec(auth);
  assert.ok(lim, 'could not read the per-address limiter — the schedule is unconstrained');
  const [limit, windowSec] = [Number(lim[1]), Number(lim[2])];

  // The `schedule:` key itself, not just a `- cron:` line under it: comment
  // out the key and the cron line survives as inert YAML, so the probe would
  // silently stop running while every assertion below still passed. #168 is
  // about the question STAYING answered.
  assert.match(wf, /^ {2}schedule:$/m, 'the schedule block is gone — the probe would only ever run by hand');
  assert.match(wf, /^ {2}workflow_dispatch:$/m, 'it can no longer be triggered by hand, which is how it gets its first run');

  const crons = [...wf.matchAll(/^\s*- cron: '([^']+)'/gm)].map((m) => m[1]);
  assert.ok(crons.length >= 1, 'the probe has no schedule — it would only ever run by hand');
  for (const cron of crons) {
    const gap = minGapSeconds(cron);
    // Firings inside any window of `windowSec`, worst case.
    const perWindow = Math.floor(windowSec / gap) + 1;
    assert.ok(
      perWindow <= limit,
      `cron '${cron}' fires every ${gap}s, so up to ${perWindow} requests land in the ${windowSec}s window that allows ${limit}`,
    );
  }
});

/**
 * Pull one step's `run:` block out of the workflow and dedent it, so the
 * assertions below can EXECUTE it rather than describe it.
 */
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

test('the report block really does exit 0 only for a verified sign-in', () => {
  // THE ASSERTION THIS WHOLE TASK IS ABOUT, and it is worth running rather
  // than grepping: `/api/health` was green throughout the original outage, so
  // a report step that goes green when the probe failed — or when it never
  // ran — repeats that exactly. Grepping for `exit 1` would be satisfied by an
  // `exit 1` sitting in an unreachable branch.
  const script = runBlockOf(read(WORKFLOW), 'Report the outcome');
  const dir = mkdtempSync(join(tmpdir(), 'magic-probe-'));
  const sh = join(dir, 'report.sh');
  writeFileSync(sh, script);

  const run = (code) => {
    const summary = join(dir, `summary-${code === '' ? 'empty' : code}.md`);
    writeFileSync(summary, '');
    const r = spawnSync('bash', [sh], {
      encoding: 'utf8',
      env: { ...process.env, PROBE_CODE: code, GITHUB_STEP_SUMMARY: summary },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, summary: readFileSync(summary, 'utf8') };
  };

  const verified = run('0');
  assert.equal(verified.status, 0, 'a verified sign-in fails the job');
  assert.match(verified.out, /::notice/);
  assert.match(verified.summary, /end to end/);

  const unconfigured = run('2');
  assert.equal(unconfigured.status, 1, 'NOT CONFIGURED went green — a pass it never earned');
  assert.match(unconfigured.out, /::error.*NOT CONFIGURED/);
  // The summary has to name the four secrets, or the red is unactionable.
  for (const secret of ['MAGIC_PROBE_EMAIL', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) {
    assert.match(unconfigured.summary, new RegExp(secret), `the NOT CONFIGURED summary omits ${secret}`);
  }

  const broken = run('1');
  assert.equal(broken.status, 1, 'a failed round trip went green');
  assert.match(broken.out, /::error.*BROKEN/);
  // All three, not just one: whoever opens a red run needs to know which
  // verdict to look at and what each one means.
  for (const key of ['start_latency', 'mail_delivered', 'sign_in_completed']) {
    assert.match(broken.summary, new RegExp(key), `the failure summary omits ${key}`);
  }
  assert.match(broken.summary, /waitUntil/,
    'the summary stopped naming the failure mode the round trip exists for — a fast endpoint with no mail');

  // And the cases nobody planned for: a step killed before it wrote its
  // output, or an exit code from something else entirely. Neither is a pass.
  for (const code of ['', '3', '127', 'null']) {
    assert.equal(run(code).status, 1, `PROBE_CODE=${JSON.stringify(code)} was treated as a pass`);
  }
});

test('only a real sign-in is green — both failures fail the job', () => {
  // THE ASSERTION THIS WHOLE TASK IS ABOUT. `/api/health` was green
  // throughout the original outage; a probe whose job stays green when it
  // fails, or when it never ran, repeats that exactly.
  const wf = read(WORKFLOW);
  const report = wf.slice(wf.indexOf('name: Report the outcome'));
  assert.ok(report.length > 200, 'could not find the report step');

  // Exit code 2 (never ran) and anything else non-zero both re-fail.
  const unconfigured = report.slice(report.indexOf('2)'), report.indexOf('*)'));
  assert.match(unconfigured, /exit 1/, 'NOT CONFIGURED no longer fails the job — a green tick would claim a pass it never earned');
  assert.match(unconfigured, /::error/, 'NOT CONFIGURED was downgraded to a warning, which is invisible on a green check');
  const failed = report.slice(report.indexOf('*)'));
  assert.match(failed, /exit 1/, 'a failed round trip no longer fails the job');
  assert.match(failed, /::error/, 'a failed round trip was downgraded to a warning');

  // And the success branch must NOT exit non-zero, or the probe can never pass.
  const success = report.slice(report.indexOf('0)'), report.indexOf('2)'));
  assert.doesNotMatch(success, /exit 1/, 'a passing probe fails the job');
  assert.match(success, /::notice/, 'a pass says nothing');
});

test('the report step can still tell the two failures apart', () => {
  // It branches on the exit CODE, so the probe step has to publish it.
  // `continue-on-error` alone yields only success/failure, which would
  // collapse "never ran" into "sign-in is broken" and send someone hunting a
  // production bug that is really four missing secrets.
  const wf = read(WORKFLOW);
  const step = wf.slice(wf.indexOf('id: probe'), wf.indexOf('name: Report the outcome'));
  assert.match(step, /continue-on-error: true/, 'the report step would be skipped on failure');
  assert.match(step, /code=\$code" >> "\$GITHUB_OUTPUT"/, 'the exit code is not published');
  assert.match(step, /exit \$code/, 'the probe step swallows its own failure');
  assert.match(wf, /PROBE_CODE: \$\{\{ steps\.probe\.outputs\.code \}\}/,
    'the report step no longer reads the code — pass it through env, never interpolated into the shell');
  // Interpolating a ${{ }} expression straight into `run:` is the shell
  // injection shape; this job reads it from the environment instead.
  const report = wf.slice(wf.indexOf('name: Report the outcome'));
  assert.doesNotMatch(report.slice(report.indexOf('run:')), /\$\{\{/,
    'a workflow expression is interpolated into the report shell');
});

test('the mailbox secrets stay out of the workflows that do not need them', () => {
  // post-deploy-smoke.yml says "No secrets required" in its own header, and
  // folding this in would hand every scheduled SPA check a mailbox credential.
  const smoke = read('.github/workflows/post-deploy-smoke.yml');
  assert.ok(!/GMAIL_|MAGIC_PROBE_EMAIL|check-magic-link-live/.test(smoke),
    'the magic-link probe or its secrets leaked into the SPA smoke');
  const wf = read(WORKFLOW);
  for (const secret of ['MAGIC_PROBE_EMAIL', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) {
    assert.match(wf, new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`),
      `${secret} is not wired into the probe step`);
  }
  assert.match(wf, /run: node scripts\/check-magic-link-live\.mjs|node scripts\/check-magic-link-live\.mjs/,
    'the workflow does not actually run the probe');
});

test('the new workflow is listed in the workflows README', () => {
  const readme = read('.github/workflows/README.md');
  assert.match(readme, /`magic-link-probe\.yml`/,
    'add the magic-link-probe.yml row to .github/workflows/README.md');
  // The README is the "what does this need to be green" doc; a probe whose
  // four secrets are undocumented is a probe nobody can turn on.
  // Anchored on the row's FIRST cell, not just a mention: the insert probe's
  // row cross-references this workflow by name, and an `includes` lookup picked
  // up that row instead — then failed for lacking secrets it never needed.
  const row = readme.split('\n').find((l) => l.startsWith('| `magic-link-probe.yml` |')) || '';
  for (const secret of ['MAGIC_PROBE_EMAIL', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) {
    assert.ok(row.includes(secret), `the README row does not name ${secret}`);
  }
});

test('the mail budget sits inside the token TTL — both numbers read from source', () => {
  // Comparing two literals here (`120_000 < 15 * 60_000`) would be a dead
  // assertion that can never fail. Both sides come off their own file, so
  // moving EITHER — the TTL in the worker or the default budget in the probe —
  // is what this catches.
  const auth = read('cloudflare-worker/src/routes/auth.ts');
  const src = read('scripts/check-magic-link-live.mjs');
  const num = (re, text, what) => {
    const m = re.exec(text);
    assert.ok(m, `could not read ${what} — the guard is comparing nothing`);
    return Number(m[1].replace(/_/g, ''));
  };
  const ttlMin = num(/MAGIC_LINK_TTL_MIN = (\d+)/, auth, 'MAGIC_LINK_TTL_MIN');
  const budgetMs = num(/MAGIC_MAIL_BUDGET_MS \|\| ([\d_]+)/, src, 'the default mail budget');
  assert.ok(
    budgetMs < ttlMin * 60_000,
    `the mail budget (${budgetMs}ms) outlives the token (${ttlMin} min) — the probe would follow a link that has already expired and report a broken sign-in`,
  );
});
