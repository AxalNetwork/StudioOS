/**
 * D9166 (#9166): the SPA shell's Content-Security-Policy covers every piece of
 * inline code the shell runs.
 *
 * The policy allows inline code by sha256 hash only, so a new or edited inline
 * <script> (or inline event handler) in index.html without its hash is a white
 * screen once the policy enforces. This reads the BUILT docs/ (D529: run
 * `npm run build` first): every shell there, the 58 prerendered ones included,
 * must have each executable inline script and handler hashed in
 * docs/_headers, the committed frontend/public/_headers must carry the same
 * line (the PR preview copies it as-is), and the Worker's record cards must
 * send the same value (socialCards.ts SHELL_HEADERS).
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spa_csp_9166.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  SPA_CSP_HEADER, cspHash, executableInlineScripts, hashesInPolicy, inlineEventHandlers, policyForShell,
  policyInHeaders, shellCspProblems, shellHashes, uncoveredInline, withPolicy,
} from '../../scripts/lib/spaCsp.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DOCS = path.join(ROOT, 'docs');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

function htmlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'assets') out.push(...htmlFiles(p)); } else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** `_headers` as [{ pattern, set: Map(lower name → value), detach: Set(lower name) }]. */
function rules(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    if (/^\s*#/.test(raw) || !raw.trim()) continue;
    if (!/^\s/.test(raw)) { cur = { pattern: raw.trim(), set: new Map(), detach: new Set() }; out.push(cur); continue; }
    const line = raw.trim();
    if (line.startsWith('! ')) cur.detach.add(line.slice(2).trim().toLowerCase());
    else { const at = line.indexOf(':'); cur.set.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()); }
  }
  return out;
}

const NAME = SPA_CSP_HEADER.toLowerCase();
const built = () => {
  assert.ok(existsSync(path.join(DOCS, '_headers')), 'docs/_headers is missing — run `npm run build` (D529)');
  return readFileSync(path.join(DOCS, '_headers'), 'utf8');
};

test('every executable inline script and handler in every built shell has its hash in docs/_headers', () => {
  // Mutation checked: a fifth inline <script> added to index.html with the line left as it was (the build's own
  // check removed) → this fails naming it; the watchdog's hash dropped from the line → fails.
  const policy = policyInHeaders(built());
  assert.ok(policy, `docs/_headers sets no ${SPA_CSP_HEADER}`);
  const shells = htmlFiles(DOCS).filter((f) => readFileSync(f, 'utf8').includes('<div id="root">'));
  assert.ok(shells.length > 1, 'the prerendered shells are in docs/ too');
  const needed = new Set();
  for (const f of shells) {
    const html = readFileSync(f, 'utf8');
    assert.deepEqual(uncoveredInline(html, policy), [], path.relative(ROOT, f));
    const { scripts, handlers } = shellHashes(html);
    for (const h of [...scripts, ...handlers]) needed.add(h);
  }
  const index = readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.equal(executableInlineScripts(index).length, 4, 'theme init, the dev flag, the dev SW killer and the boot watchdog');
  assert.ok(index.includes('type="application/ld+json"'), 'the shell still has its data block, which is not hashed');
  assert.deepEqual(hashesInPolicy(policy).sort(), [...needed].sort(), 'no hash in the policy that no shell needs');
});

test('the shell rule carries the policy, the standalone pages detach it, and it does not enforce yet', () => {
  // Mutation checked: the /verify-email detach removed → fails; the header renamed to the enforcing one → fails.
  const rs = rules(built());
  const setters = rs.filter((r) => r.set.has(NAME));
  assert.deepEqual(setters.map((r) => r.pattern), ['/*'], 'one rule sets it, on every path');
  assert.equal(rs.some((r) => r.set.has('content-security-policy')), false, 'the enforcing switch is its own change (D9166)');
  const at = rs.indexOf(setters[0]);
  for (const page of ['/verify-email', '/verify-email.html', '/offline', '/offline.html']) {
    const r = rs.findIndex((x) => x.pattern === page && x.detach.has(NAME));
    assert.ok(r > at, `${page} detaches the shell policy after the /* rule that sets it`);
  }
  // Every HTML file in docs/ with inline code is a covered shell or one of those detached pages.
  const policy = setters[0].set.get(NAME);
  for (const f of htmlFiles(DOCS)) {
    const html = readFileSync(f, 'utf8');
    if (!uncoveredInline(html, policy).length) continue;
    assert.ok(['offline.html', 'verify-email.html'].includes(path.relative(DOCS, f)), `${path.relative(ROOT, f)} runs inline code the policy does not cover`);
  }
});

test('the committed _headers, the build and the Worker’s record cards send one value', async () => {
  // Mutation checked: the plugin's write into docs/_headers dropped and the committed line changed → fails;
  // SHELL_HEADERS given a different value → fails.
  const policy = policyInHeaders(built());
  assert.equal(policyInHeaders(read('frontend/public/_headers')), policy, 'frontend/public/_headers is what the PR preview ships');
  assert.equal(policy, policyForShell(readFileSync(path.join(DOCS, 'index.html'), 'utf8')), 'the line is the built shell’s policy');
  const cards = read('cloudflare-worker/src/services/socialCards.ts');
  const m = /'content-security-policy-report-only':\s*"([^"]+)"/.exec(cards);
  assert.ok(m, 'SHELL_HEADERS sends the shell policy on the Worker-served shells');
  assert.equal(m[1], policy);
  for (const line of read('frontend/public/_headers').split('\n')) assert.ok(line.length <= 2000, 'Workers caps a _headers line at 2,000 characters');
});

test('the policy allows only hashes inline, and the third parties the SPA loads', () => {
  // Mutation checked: 'unsafe-inline' added to script-src → fails; Turnstile's frame origin dropped → fails.
  const policy = policyInHeaders(built());
  const dir = new Map(policy.split(';').map((d) => d.trim().split(/\s+/)).map(([n, ...v]) => [n, v]));
  const script = dir.get('script-src');
  assert.equal(script[0], "'self'");
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", 'https:', '*']) assert.ok(!script.includes(bad), `script-src has ${bad}`);
  for (const origin of ['https://js.stripe.com', 'https://challenges.cloudflare.com']) {
    assert.ok(script.includes(origin), `script-src admits ${origin}`);
    assert.ok(dir.get('frame-src').includes(origin), `frame-src admits ${origin}`);
  }
  assert.ok(dir.get('connect-src').includes('https://api.stripe.com'));
  assert.ok(dir.get('frame-src').includes('https://hooks.stripe.com'));
  assert.deepEqual(dir.get('object-src'), ["'none'"]);
  assert.deepEqual(dir.get('base-uri'), ["'self'"]);
  assert.deepEqual(dir.get('frame-ancestors'), ["'none'"], 'X-Frame-Options: DENY, said again');
  // Each origin the policy names for a script is one the source actually loads.
  const src = (f) => read(f);
  assert.match(src('frontend/src/lib/turnstile.js'), /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
  assert.match(src('frontend/src/lib/stripe.js'), /loadStripe/);
  assert.match(src('frontend/src/lib/googlePopup.js'), /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(src('frontend/src/lib/googleWorkspacePicker.js'), /https:\/\/apis\.google\.com\/js\/api\.js/);
  assert.match(src('frontend/src/lib/recaptcha.js'), /https:\/\/www\.google\.com\/recaptcha\/api\.js/);
  assert.match(src('frontend/src/pages/account/whatsappSignup.js'), /https:\/\/connect\.facebook\.net\//);
});

test('the scanner: what counts as inline code, and how a stale line is named', () => {
  // Mutation checked: the `src` skip removed → the external module counts; the ld+json skip removed → 3 not 2;
  // handler hashing dropped → the onload is not named.
  const html = [
    '<script data-cfasync="false">a()</script>',
    '<script type="module">b()</script>',
    '<script type="application/ld+json">{"x":1}</script>',
    '<script type="module" src="/assets/x.js"></script>',
    '<!-- <script>commented()</script> -->',
    '<link rel="stylesheet" href="/x.css" media="print" onload="this.media=&#39;all&#39;">',
  ].join('\n');
  assert.deepEqual(executableInlineScripts(html), ['a()', 'b()']);
  assert.deepEqual(inlineEventHandlers(html), ["this.media='all'"]);
  // sha256("a()") from `printf 'a()' | openssl dgst -sha256 -binary | base64`, not from the module.
  assert.equal(cspHash('a()'), "'sha256-qVpDBgj7bpq5hMAcGp3AOc79J3Y1Z4HvySTwKrWDoy4='");
  const policy = policyForShell(html);
  assert.match(policy, /script-src 'self' 'sha256-[^']+' 'sha256-[^']+' 'unsafe-hashes' 'sha256-[^']+' /);
  assert.deepEqual(uncoveredInline(html, policy), []);
  const without = policy.replace(cspHash("this.media='all'"), '');
  assert.match(uncoveredInline(html, without).join(), /inline event handler/);
  assert.match(uncoveredInline(html + '<script>c()</script>', policy).join(), /inline <script> 'sha256-/);
  assert.deepEqual(shellCspProblems(new Headers({ [NAME]: policy }), html), []);
  assert.match(shellCspProblems(new Headers(), html).join(), /missing security header/);
  assert.match(shellCspProblems(new Headers({ [NAME]: policy.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") }), html).join(), /unsafe-inline/);
  const text = `/*\n  ${SPA_CSP_HEADER}: old\n`;
  assert.equal(policyInHeaders(withPolicy(text, 'new')), 'new');
  assert.throws(() => withPolicy('/*\n  X-A: b\n', 'new'), /no Content-Security-Policy-Report-Only line/);
  assert.throws(() => policyInHeaders(`${text}${text}`), /2 times/);
});
