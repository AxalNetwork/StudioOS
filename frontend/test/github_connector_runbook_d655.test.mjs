/**
 * D655 (#1885) — the GitHub connector's App runbook, held to the code it
 * describes.
 *
 * A runbook cannot fail on its own. What can fail is the owner registering the
 * App from a page that has drifted: a callback the Worker no longer sends, a
 * permission the callback now refuses, a variable name nothing reads, or an
 * error code that no longer exists. So each of those is read from the source
 * here and looked for in the page, and the page is checked for anything that
 * looks like a real credential, because the repository is public.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const RUNBOOK = raw('documentation/operations/GITHUB_CONNECTOR_APP.md');
const PRODUCTION = raw('documentation/architecture/PRODUCTION.md');
const WRANGLER = raw('wrangler.toml');
const GITHUB = raw('cloudflare-worker/src/integrations/providers/github.ts');
const REGISTRY = raw('cloudflare-worker/src/integrations/registry.ts');
const KEYS = raw('cloudflare-worker/src/services/providerOauthKeys.ts');

const SOURCES = {
  'integrations.ts': 'cloudflare-worker/src/routes/integrations.ts',
  'github.ts': 'cloudflare-worker/src/integrations/providers/github.ts',
  'oauth.ts': 'cloudflare-worker/src/integrations/oauth.ts',
  'providerOauthKeys.ts': 'cloudflare-worker/src/services/providerOauthKeys.ts',
  'providerOauthTest.ts': 'cloudflare-worker/src/services/providerOauthTest.ts',
  'admin_integration_keys.ts': 'cloudflare-worker/src/routes/admin_integration_keys.ts',
  'connectorsModel.js': 'frontend/src/pages/account/connectorsModel.js',
};

/** The value of `name` inside one `[block]` of wrangler.toml. */
function tomlVar(block, name) {
  const start = WRANGLER.indexOf(`\n[${block}]\n`);
  assert.ok(start >= 0, `wrangler.toml has [${block}]`);
  const rest = WRANGLER.slice(start + block.length + 4);
  const end = rest.search(/\n\[/);
  const body = end < 0 ? rest : rest.slice(0, end);
  const line = body.split('\n').find((l) => l.split('=')[0].trim() === name);
  const value = line?.slice(line.indexOf('=') + 1).trim().match(/^"([^"]*)"$/)?.[1];
  assert.ok(value !== undefined, `[${block}] sets ${name}`);
  return value;
}

/** The text of one `## n.` section of the runbook. */
function section(n) {
  const start = RUNBOOK.indexOf(`\n## ${n}. `);
  assert.ok(start >= 0, `the runbook has §${n}`);
  const rest = RUNBOOK.slice(start + 4);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

test('the callback is the one the Worker sends, in the runbook and in PRODUCTION.md', () => {
  const prod = tomlVar('env.production.vars', 'OAUTH_CALLBACK_BASE_URL');
  assert.equal(tomlVar('vars', 'OAUTH_CALLBACK_BASE_URL'), prod, 'both blocks pin the same callback base');
  const key = GITHUB.match(/const PROVIDER_KEY = '([^']+)'/)?.[1];
  assert.equal(key, 'github');
  // github.ts builds its redirect URI with the shared helper (D751), which
  // appends the path to callbackBase.
  assert.match(GITHUB, /function redirectUri\(env: Env\): string \{\s*return oauthCallbackUrl\(env, PROVIDER_KEY\);/);
  assert.ok(raw('cloudflare-worker/src/util/url.ts').includes('return `${callbackBase(env)}/api/integrations/oauth/${key}/callback`;'));
  const callback = `${prod}/api/integrations/oauth/${key}/callback`;
  assert.ok(RUNBOOK.includes(`exactly \`${callback}\``), `the runbook registers ${callback}`);
  assert.ok(PRODUCTION.includes(`Callback \`${callback}\``), `PRODUCTION.md registers ${callback}`);
  const hosts = [...RUNBOOK.matchAll(/https:\/\/([^/\s`]+)\/api\/integrations\/oauth\/github\/callback/g)].map((m) => m[1]);
  assert.ok(hosts.length >= 1);
  for (const h of hosts) assert.ok(['app.axal.vc', 'axal.vc'].includes(h), `callback host ${h}`);
});

test('the permissions are exactly the registry\'s four read scopes', () => {
  const block = REGISTRY.slice(REGISTRY.indexOf("key: 'github'"));
  const scopes = block.match(/oauth_scopes:\s*\[([^\]]*)\]/)?.[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.ok(scopes?.length, 'the github entry lists oauth_scopes');
  const want = scopes.map((s) => {
    const [name, level] = s.split(':');
    assert.equal(level, 'read', `${s} is a read scope`);
    const label = name.replace(/_/g, ' ');
    return `- **${label[0].toUpperCase()}${label.slice(1)}:** Read-only`;
  }).sort();
  const sub = section(2).split(/^### Repository permissions$/m)[1];
  assert.ok(sub, '§2 has a Repository permissions subsection');
  const listed = sub.split(/^#{2,3} /m)[0].split('\n').filter((l) => l.startsWith('- ')).sort();
  assert.deepEqual(listed, want);
});

test('the variable names are the ones the Worker reads', () => {
  const m = KEYS.match(/github:\s*\{\s*id:\s*'([A-Z_]+)',\s*secret:\s*'([A-Z_]+)'\s*\}/);
  assert.ok(m, 'providerOauthKeys.ts names the github pair');
  for (const name of [m[1], m[2]]) {
    assert.ok(RUNBOOK.includes(`\`${name}\``), `the runbook names ${name}`);
    assert.ok(PRODUCTION.includes(`\`${name}\``), `PRODUCTION.md names ${name}`);
  }
  assert.ok(RUNBOOK.includes('`GITHUB_APP_SLUG`'));
  assert.ok(PRODUCTION.includes('`GITHUB_APP_SLUG`'));
});

test('PRODUCTION.md links the runbook from the variables and from Provider setup', () => {
  const links = PRODUCTION.split('](../operations/GITHUB_CONNECTOR_APP.md)').length - 1;
  assert.ok(links >= 2, `PRODUCTION.md links the runbook twice, found ${links}`);
  const setup = PRODUCTION.slice(PRODUCTION.indexOf('**Provider setup, owner-run, once each.**'));
  assert.match(setup.split('\n').find((l) => l.includes('**GitHub App.**')) ?? '', /GITHUB_CONNECTOR_APP\.md/);
});

test('Integration keys links GitHub\'s setup guide to this runbook', () => {
  // #1882 shipped the console's link to PRODUCTION.md until this runbook landed.
  const keys = raw('cloudflare-worker/src/routes/admin_integration_keys.ts');
  assert.ok(keys.includes("github: 'documentation/operations/GITHUB_CONNECTOR_APP.md',"));
});

test('the docs index links both GitHub runbooks', () => {
  const index = raw('documentation/README.md');
  for (const f of ['GITHUB_CONNECTOR_APP.md', 'TICKET_GITHUB_SYNC.md']) {
    assert.ok(index.includes(`](operations/${f})`), `documentation/README.md links ${f}`);
    assert.ok(existsSync(resolve(process.cwd(), `documentation/operations/${f}`)), `${f} exists`);
  }
});

test('Test\'s accepted answer is the code GitHub gives for a junk code', () => {
  assert.ok(raw(SOURCES['providerOauthTest.ts']).includes('bad_verification_code'));
  assert.ok(RUNBOOK.includes('`bad_verification_code`'));
});

test('every troubleshooting code is still in the file the row names', () => {
  const rows = section(8).split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| What') && !l.startsWith('| ---'));
  assert.ok(rows.length >= 10, `§8 has its rows, found ${rows.length}`);
  let checked = 0;
  for (const row of rows) {
    const cell = row.split(' | ')[1];
    let file = null;
    for (const seg of cell.split(';')) {
      const code = seg.match(/`([a-z_]+)(?::[^`]*)?`/)?.[1];
      file = seg.match(/([A-Za-z_]+\.(?:ts|js|jsx)):/)?.[1] ?? file;
      if (!code) continue;
      assert.ok(file && SOURCES[file], `§8 names a known file for ${code}`);
      assert.ok(raw(SOURCES[file]).includes(code), `${code} is in ${SOURCES[file]}`);
      checked++;
    }
  }
  assert.ok(checked >= 15, `checked ${checked} codes`);
});

test('neither page carries anything that looks like a credential', () => {
  for (const [name, text] of [['runbook', RUNBOOK], ['PRODUCTION.md', PRODUCTION]]) {
    assert.doesNotMatch(text, /\bIv1\.[0-9a-f]{16}\b/, `${name}: no classic Client ID`);
    assert.doesNotMatch(text, /\bIv23[A-Za-z0-9]{16}\b/, `${name}: no Client ID`);
    assert.doesNotMatch(text, /\bgh[opsur]_[A-Za-z0-9]{20,}/, `${name}: no GitHub token`);
    assert.doesNotMatch(text, /PRIVATE KEY-----/, `${name}: no private key`);
    assert.doesNotMatch(text, /\b[0-9a-f]{40}\b/, `${name}: no client secret`);
  }
});
