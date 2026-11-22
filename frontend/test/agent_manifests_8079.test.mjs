/**
 * D8079 (#8079): the agent manifests. Runs `scripts/check-agent-manifests.mjs`
 * over `agents/` (so the guard runs in CI with the frontend suite) and over one
 * fixture per refusal, written to a temporary folder. Also pins #8067's
 * privileged list, as the script carries it, to what the landing bot's PROTECTED
 * and merge-policy's T2 path rule decide on main.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CAPABILITIES_8070, UNGRANTABLE, PRIVILEGED_PATHS, globsMeet, globMatches, privilegedHits, validateManifest, readManifest,
} from '../../scripts/check-agent-manifests.mjs';
import { PROTECTED } from '../../scripts/landing-bot/rules.mjs';
import { classify } from '../../merge-control/src/lib/classify.mjs';

const root = resolve(process.cwd());
const SCRIPT = join(root, 'scripts/check-agent-manifests.mjs');
const run = (dir) => spawnSync(process.execPath, [SCRIPT, '--dir', dir], { cwd: root, encoding: 'utf8' });

/** A valid venture manifest; each fixture below changes one thing in it. */
const VENTURE = `name: market-research
kind: venture
owner: role:founder
identity: studioos-agent-publisher
capabilities:
  - research.*
  - company.read
  - fund.read
  - web.search
models:
  route: gateway
  allowed:
    - workers-ai/llama
resources:
  cpu: 1
  memory: 4GiB
limits:
  runtime: 30
  tokens: 200000
  parallel_tasks: 1
  child_agents: 0
  prs: 2
network:
  internet: false
  egress:
    - api.example.org
allowed_paths:
  - ventures/acme/research/notes-*.md
  - ventures/acme/src/*.ts
runner_pool: untrusted
approval:
  external_actions: not-required
escalation: owner
status: live
sources:
  - AGENTS.md
`;

/** Replace one line (matched exactly) of the valid manifest. */
const swap = (from, to, base = VENTURE) => {
  assert.ok(base.includes(from), `fixture base holds ${from}`);
  return base.replace(from, to);
};

/** Write `files` into a fresh folder, run the check over it, and remove the folder. */
function check(files) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-8079-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The check refuses `text` (as market-research.agent.yml) with `code`. */
function refuses(text, code, file = 'market-research.agent.yml') {
  const r = check({ [file]: text });
  assert.equal(r.status, 1, `exit 1 expected for ${code}; stdout: ${r.stdout}`);
  assert.match(r.stderr, new RegExp(`${file.replace(/\./g, '\\.')}: ${code}: `), r.stderr);
  return r.stderr;
}

test('every seed manifest in agents/ validates, and each named agent is declared', () => {
  const r = run(join(root, 'agents'));
  assert.equal(r.status, 0, r.stderr);
  const files = readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.agent.yml')).sort();
  for (const seed of ['coordinator', 'keeper', 'landing-bot', 'model-runner', 'scan-remediation', 'sessions']) {
    assert.ok(files.includes(`${seed}.agent.yml`), `agents/${seed}.agent.yml`);
  }
  assert.match(r.stdout, new RegExp(`${files.length} manifest\\(s\\)`));
});

test('the slot sessions are one platform manifest with the session identity', () => {
  const { doc } = readManifest(readFileSync(join(root, 'agents/sessions.agent.yml'), 'utf8'));
  assert.equal(doc.kind, 'platform');
  assert.equal(doc.identity, 'session');
});

test('the valid venture fixture passes, so each refusal below is caused by its one change', () => {
  const r = check({ 'market-research.agent.yml': VENTURE });
  assert.equal(r.status, 0, r.stderr);
});

test('prod_deploy: prod:deploy, deploy.production and a wildcard covering it are refused', () => {
  refuses(swap('  - web.search', '  - web.search\n  - prod:deploy'), 'prod_deploy');
  refuses(swap('  - web.search', '  - web.search\n  - deploy.production'), 'prod_deploy');
  refuses(swap('  - web.search', '  - web.search\n  - deploy.*'), 'prod_deploy');
  refuses(swap('  - web.search', '  - web.search\n  - "*"'), 'prod_deploy');
  // A platform agent is refused too: no agent deploys to production.
  refuses(swap('kind: venture\nowner: role:founder', 'kind: platform\nowner: S21', swap('  - web.search', '  - web.search\n  - prod:deploy')), 'prod_deploy');
});

test('capability_ungrantable: what a person does is never granted, by name or wildcard', () => {
  refuses(swap('  - web.search', '  - web.search\n  - code.merge'), 'capability_ungrantable');
  refuses(swap('  - web.search', '  - web.search\n  - code.*'), 'capability_ungrantable');
  refuses(swap('  - web.search', '  - web.search\n  - email.send'), 'capability_ungrantable');
});

test('capability_unknown: a name outside the catalogue, or a wildcard that matches none', () => {
  refuses(swap('  - web.search', '  - web.search\n  - code.push'), 'capability_unknown');
  refuses(swap('  - web.search', '  - web.search\n  - space.*'), 'capability_unknown');
});

test('privileged_path: a venture agent cannot list a path on #8067\'s list', () => {
  for (const glob of ['.github/workflows/ci.yml', 'ventures/acme/**', '**/package.json', 'ventures/acme/wrangler.toml',
    'cloudflare-worker/sql/**', 'Scripts/deploy.mjs', 'ventures/acme/src/**/*.ts', 'AGENTS.md', 'ventures/acme/yarn.lock',
    'cloudflare-worker/src/middleware/*.ts']) {
    const err = refuses(swap('  - ventures/acme/src/*.ts', `  - '${glob}'`), 'privileged_path');
    assert.match(err, new RegExp(glob.replace(/[.*?]/g, '\\$&')));
  }
});

test('privileged_path is a venture rule: the same path on a platform agent passes', () => {
  const platform = swap('kind: venture\nowner: role:founder', 'kind: platform\nowner: S21');
  const r = check({ 'market-research.agent.yml': swap('  - ventures/acme/src/*.ts', '  - .github/workflows/ci.yml', platform) });
  assert.equal(r.status, 0, r.stderr);
});

test('approval_required: email, introductions and payments always need approval', () => {
  refuses(swap('  - web.search', '  - web.search\n  - email.draft'), 'approval_required');
  refuses(swap('  - web.search', '  - web.search\n  - relationships.request-introduction'), 'approval_required');
  const ok = swap('external_actions: not-required', 'external_actions: required', swap('  - web.search', '  - web.search\n  - email.draft'));
  assert.equal(check({ 'market-research.agent.yml': ok }).status, 0);
});

test('schema: missing and unknown keys, bad values, a name that is not the file, YAML errors, stray files', () => {
  refuses(swap('status: live\n', ''), 'schema');
  refuses(`${VENTURE}budget: 10\n`, 'schema');
  refuses(swap('runner_pool: untrusted', 'runner_pool: shared'), 'schema');
  refuses(swap('  tokens: 200000', '  tokens: lots'), 'schema');
  refuses(swap('  tokens: 200000\n', ''), 'schema');
  refuses(swap('kind: venture', 'kind: robot'), 'schema');
  refuses(swap('identity: studioos-agent-publisher', 'identity: root'), 'schema');
  refuses(swap('owner: role:founder', 'owner: S21'), 'schema');
  refuses(swap('  memory: 4GiB', '  memory: none'), 'schema');
  refuses(swap('  - AGENTS.md', '  - scripts/no-such-agent.mjs'), 'schema');
  refuses(swap('  - ventures/acme/src/*.ts', '  - ventures/{a,b}/*.ts'), 'schema');
  refuses(swap('  route: gateway', '  route: none'), 'schema');
  refuses(VENTURE, 'schema', 'other-name.agent.yml');
  assert.match(refuses(`${VENTURE}name: twice\n`, 'schema'), /unreadable YAML/);
  assert.match(refuses(VENTURE, 'schema', 'market-research.agent.yaml'), /holds README\.md and `<name>\.agent\.yml` files only/);
  const empty = check({});
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /no `\*\.agent\.yml` manifest found/);
});

test('#8070\'s names: twenty grantable, five a person does', () => {
  assert.equal(CAPABILITIES_8070.length, 20);
  assert.deepEqual([...UNGRANTABLE].sort(), ['cloud.write', 'code.merge', 'deploy.production', 'email.send', 'finance.execute']);
  for (const name of UNGRANTABLE) {
    assert.ok(validateManifest({ capabilities: [name] }, 'x').some((p) => p.code === 'capability_ungrantable' || p.code === 'prod_deploy'), name);
  }
});

test('globs: * stays in one folder, **/ may be empty, case is ignored', () => {
  assert.ok(globMatches('**/package.json', 'package.json'));
  assert.ok(globMatches('**/package.json', 'a/b/package.json'));
  assert.ok(!globMatches('**/package.json', 'a/mypackage.json'));
  assert.ok(globMatches('src/*.ts', 'src/a.ts'));
  assert.ok(!globMatches('src/*.ts', 'src/a/b.ts'));
  assert.ok(globMatches('scripts/**', 'SCRIPTS/x.mjs'));
  assert.ok(globsMeet('ventures/*/src/**', '**/scripts/**'));
  assert.ok(!globsMeet('ventures/acme/src/*.ts', '**/scripts/**'));
  assert.ok(!globsMeet('ventures/acme/*.md', '**/package*.json'));
  assert.ok(globsMeet('ventures/acme/*.json', '**/package*.json'));
  assert.deepEqual(privilegedHits('frontend/src/pages/*.jsx'), []);
});

// #8067: one privileged list. Until its module lands, the script's copy must agree
// with the two lists that decide a privileged change on main today.
const PROBES = [
  '.github/workflows/ci.yml', '.github/CODEOWNERS', 'frontend/.github/x.yml', 'scripts/ci/x.mjs', 'scripts/deploy.mjs',
  'ventures/acme/scripts/run.mjs', 'merge-control/src/index.ts', 'attached_assets/terms.pdf', 'cloudflare-worker/sql/schema.sql',
  'cloudflare-worker/src/middleware/cors.ts', 'AGENTS.md', 'CLAUDE.md', 'docs/AGENTS.md', 'CODEOWNERS', '.gitattributes',
  'frontend/.gitattributes', 'package.json', 'frontend/package.json', 'package-lock.json', 'ventures/acme/package-extra.json',
  'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'deps.lock.json', 'poetry-lock.yaml',
  'wrangler.toml', 'cloudflare-worker/wrangler.preview.toml', 'meeting-bot/wrangler.toml',
  // Not privileged:
  'frontend/src/pages/Home.jsx', 'cloudflare-worker/src/routes/deals.ts', 'documentation/README.md', 'agents/README.md',
  'cloudflare-worker/src/services/mailer.ts', 'ventures/acme/src/index.ts', 'frontend/src/lib/api/deals.js', 'design/tokens/tokens.json',
  'cloudflare-worker/src/agents/loop.ts', 'meeting-bot/src/index.ts', 'ventures/acme/README.md',
];

test('#8067\'s list agrees with the landing bot\'s PROTECTED and merge-policy\'s T2 path rule', () => {
  for (const path of PROBES) {
    const today = PROTECTED.some((re) => re.test(path))
      || classify([{ path, status: 'M', patch: '' }]).reasons.some((r) => r === `T2: protected path: ${path}`);
    const listed = PRIVILEGED_PATHS.some((glob) => globMatches(glob, path));
    assert.equal(listed, today, `${path}: privileged list says ${listed}, main says ${today}`);
  }
});
