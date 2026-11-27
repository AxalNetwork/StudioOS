/**
 * Task #168 — the magic-link probe's own logic, tested without a network.
 *
 * The production job uses a dedicated inbox. Here the real CLI runs against
 * an ordered fetch fixture, covering the mail/read boundary, retry behavior
 * and authenticated identity. Helper cases also cover parsing and verdicts.
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
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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
  // A following query parameter stops the token, entity-encoded or not.
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
    'https://other.invalid/api/auth/magic/verify?token=example',
    'https://axal.vc/api/auth/magic/verify?token=example&token=ambiguous',
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
  assert.equal(verifyOutcome({ status: 302, location: 'https://axal.vc/dashboard?magic=ok' }).ok, true);
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

test('the probe is not wired into test:drift', () => {
  // It needs production and secrets. A check that cannot run in the suite
  // must not be in the suite claiming to have run.
  const pkg = read('package.json');
  assert.ok(!/check-magic-link-live/.test(pkg),
    'the live probe is in package.json — test:drift would try to reach production');
});

// ---------------------------------------------------------------------------
// Run the actual CLI in a separate Node process. Every HTTP response comes from
// an ordered fixture. An unexpected call, extra retry or unconsumed fixture
// fails the test even when the CLI would catch a fetch error and exit red.
function installMockFetch(steps) {
  let failure;
  let repeatLast;
  // Only the child process uses this clock. Each response advances its timeline.
  let now = Date.UTC(2026, 0, 1);
  Date.now = () => now;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const step = steps.shift() || repeatLast;
    if (step?.repeat) repeatLast = step;
    if (!step || step.route !== url.origin + url.pathname || (init.method || 'GET') !== (step.method || 'GET')) {
      failure = `Unexpected request: ${init.method || 'GET'} ${url.pathname}`;
    } else if (step.cookie && new Headers(init.headers).get('cookie') !== step.cookie) {
      failure = 'The identity request did not carry the issued session cookie';
    } else if (step.token && url.searchParams.get('token') !== step.token) {
      failure = 'The verification request did not use the token from the email';
    }
    if (failure) throw new Error(failure);
    now += step.elapsedMs ?? 1;
    if (step.fresh) step.body.internalDate = String(now);
    return new Response(step.html ?? JSON.stringify(step.body || {}), {
      status: step.status || 200,
      headers: step.headers || { 'content-type': 'application/json' },
    });
  };
  process.on('exit', () => {
    if (failure || steps.length) {
      console.error(failure || `Probe stopped before ${steps[0].route}`);
      process.exitCode = 90;
    }
  });
}

const probeAddress = 'probe@example.invalid';
const authBase = 'https://axal.vc/api/auth';
const messages = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const start = { route: authBase + '/magic/start', method: 'POST', status: 202 };
const oauth = { route: 'https://oauth2.googleapis.com/token', method: 'POST', body: { access_token: 'test-access' } };
const delivered = [
  { route: messages, body: { messages: [{ id: 'example' }] } },
  { route: messages + '/example', fresh: true, body: { payload: { body: { data: b64(LINK) } } } },
];
const verify = {
  route: authBase + '/magic/verify', token: TOKEN, status: 302,
  headers: { location: 'https://axal.vc/dashboard?magic=ok', 'set-cookie': 'studioos_auth=test-session; Secure; HttpOnly; Path=/' },
};
const me = { route: authBase + '/me', cookie: 'studioos_auth=test-session', body: { email: probeAddress, id: 1 } };

function runProbe(t, steps, expected, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'magic-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, 'outputs');
  writeFileSync(output, '');
  const mock = `(${installMockFetch.toString()})(${JSON.stringify(steps)})`;
  const result = spawnSync(process.execPath, [
    '--import', 'data:text/javascript,' + encodeURIComponent(mock), 'scripts/check-magic-link-live.mjs',
  ], {
    encoding: 'utf8', timeout: 5000,
    env: {
      GITHUB_OUTPUT: output, GITHUB_ACTIONS: 'true', MAGIC_PROBE_HOST: 'https://axal.vc',
      MAGIC_PROBE_EMAIL: probeAddress, GMAIL_CLIENT_ID: 'test-client', GMAIL_CLIENT_SECRET: 'test-secret',
      GMAIL_REFRESH_TOKEN: 'test-refresh', MAGIC_POLL_MS: '2', MAGIC_MAIL_BUDGET_MS: '1500', ...env,
    },
  });
  assert.ifError(result.error);
  const log = result.stdout + result.stderr;
  assert.equal(result.status, expected === 'PASS' ? 0 : expected === 'CONFIG_ERROR' ? 2 : 1, log);
  assert.equal(readFileSync(output, 'utf8').trim(), `classification=${expected}`, log);
  for (const secret of [TOKEN, 'test-secret', 'test-refresh', 'test-access', 'test-session']) {
    assert.ok(!log.includes(secret), 'probe exposed fixture credentials in its logs');
  }
  return log;
}

test('missing configuration and refused starts end before any mailbox access', (t) => {
  runProbe(t, [], 'CONFIG_ERROR', { GMAIL_REFRESH_TOKEN: '' });
  const challenged = runProbe(t, [{
    ...start, status: 403, html: '<html>Challenge</html>',
    headers: { 'content-type': 'text/html', 'cf-ray': 'example', 'cf-mitigated': 'challenge' },
  }], 'EDGE_CHALLENGED');
  assert.match(challenged, /outcome: EDGE_CHALLENGED/);
  const edgeRefusal = runProbe(t, [{
    ...start, status: 403, html: '<html>Forbidden</html>', headers: { 'content-type': 'text/html', 'cf-ray': 'example' },
  }], 'EDGE_REFUSED');
  assert.match(edgeRefusal, /mail_delivered: NOT CHECKED/);
  const unavailable = runProbe(t, [{
    ...start, status: 502, html: '<html>Bad gateway</html>', headers: { 'content-type': 'text/html', 'cf-ray': 'example' },
  }], 'START_FAILURE');
  assert.doesNotMatch(unavailable, /outcome: EDGE_CHALLENGED/);
  const throttled = runProbe(t, [{ ...start, status: 429 }], 'START_FAILURE');
  assert.match(throttled, /outcome: APPLICATION_REFUSED/);
});

test('mailbox authorization and read failures preserve the untested delivery stage', (t) => {
  const expired = runProbe(t, [start, { ...oauth, status: 400, body: { error: 'invalid_grant' } }], 'GMAIL_AUTH');
  assert.match(expired, /invalid_grant/);
  assert.match(expired, /mail_delivered: NOT CHECKED/i);
  runProbe(t, [start, oauth, { route: messages, status: 403 }], 'GMAIL_READ');
  runProbe(t, [start, oauth, delivered[0], { ...delivered[1], status: 403 }], 'GMAIL_READ');
});

test('a readable inbox without a new link gives a delivery timeout', (t) => {
  runProbe(t, [start, oauth, { route: messages, body: {}, repeat: true, elapsedMs: 100 }], 'DELIVERY_FAILURE', {
    MAGIC_MAIL_BUDGET_MS: '400', MAGIC_POLL_MS: '20',
  });
});

test('temporary Google errors recover within a single sign-in request or give a dependency verdict', (t) => {
  const unavailable = { ...oauth, status: 503, body: {} };
  runProbe(t, [start, unavailable, oauth, ...delivered, verify, me], 'PASS');
  runProbe(t, [start, unavailable, unavailable, unavailable], 'DEPENDENCY_FAILURE');
});

test('a redirect only verifies sign-in when its session identifies the requested account', (t) => {
  const requests = [start, oauth, ...delivered];
  const refused = runProbe(t, [...requests, {
    ...verify, headers: { location: 'https://axal.vc/login?magic_error=expired' },
  }], 'VERIFY_FAILURE');
  assert.match(refused, /magic_error=expired/);
  runProbe(t, [...requests, { ...verify, headers: { location: verify.headers.location } }], 'VERIFY_FAILURE');
  runProbe(t, [...requests, { ...verify, headers: { ...verify.headers, location: 'https://other.invalid/?magic=ok' } }], 'VERIFY_FAILURE');
  runProbe(t, [...requests, verify, { ...me, body: { id: 2, email: 'other@example.invalid' } }], 'VERIFY_FAILURE');
  const signedIn = runProbe(t, [...requests, verify, me], 'PASS');
  assert.match(signedIn, /outcome: VERIFIED_END_TO_END/);
});

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

test('both workflows serialize requests for the shared probe mailbox', () => {
  const group = (path) => {
    const wf = read(path);
    const block = /^concurrency:\n((?:  .*\n)+)/m.exec(wf)?.[1] || '';
    assert.match(block, /^  cancel-in-progress: false$/m, path);
    const name = /^  group: ([a-z0-9-]+)$/m.exec(block)?.[1];
    assert.ok(name, `Missing fixed mailbox concurrency group in ${path}`);
    return name;
  };
  assert.equal(group(WORKFLOW), group('.github/workflows/magic-link-insert-probe.yml'));
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

test('the job publishes each classification and requires both proofs to go green', (t) => {
  const script = runBlockOf(read(WORKFLOW), 'Report the outcome');
  const dir = mkdtempSync(join(tmpdir(), 'magic-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summary = join(dir, 'summary.md');
  const run = (code, classification) => {
    writeFileSync(summary, '');
    const result = spawnSync('bash', ['-e', '-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PROBE_CODE: code, PROBE_CLASSIFICATION: classification, GITHUB_STEP_SUMMARY: summary },
    });
    assert.ifError(result.error);
    return { status: result.status, summary: readFileSync(summary, 'utf8'), log: result.stdout + result.stderr };
  };
  const pass = run('0', 'PASS');
  assert.equal(pass.status, 0, pass.log);
  assert.match(pass.log, /::notice/);

  for (const classification of [
    'CONFIG_ERROR', 'EDGE_CHALLENGED', 'EDGE_REFUSED', 'START_FAILURE', 'GMAIL_AUTH', 'GMAIL_READ',
    'DEPENDENCY_FAILURE', 'DELIVERY_FAILURE', 'VERIFY_FAILURE', 'INFRA_FAILURE',
  ]) {
    const result = run(classification === 'CONFIG_ERROR' ? '2' : '1', classification);
    assert.equal(result.status, 1, classification);
    assert.ok(result.summary.includes(classification), result.summary);
    assert.match(result.log, /::error/);
  }
  for (const [code, classification] of [['0', ''], ['0', 'GMAIL_AUTH'], ['1', 'PASS'], ['', 'PASS'], ['127', '']]) {
    assert.equal(run(code, classification).status, 1, `${code}/${classification} claimed success`);
  }
});

test('the shell report receives the exit code and classification as step outputs', () => {
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
  assert.match(wf, /PROBE_CLASSIFICATION: \$\{\{ steps\.probe\.outputs\.classification \}\}/);
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
  // Select the workflow's configuration bullet, not a summary row or mention: the insert probe's
  // row cross-references this workflow by name, and an `includes` lookup picked
  // up that row instead — then failed for lacking secrets it never needed.
  const row = readme.split('\n').find((l) => l.startsWith('- `magic-link-probe.yml` ·')) || '';
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
