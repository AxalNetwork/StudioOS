// D8069 (#8069): every job that reads a cloud credential names the GitHub environment that holds it, `id-token: write`
// sits only beside a step that exchanges the OIDC token, no static AWS or Azure key exists, and the deploy and ops
// workflows declare their permissions per job. Parses the workflows with the `yaml` package, so a comment or a quoted
// example never counts as a read.
//
// Run alone: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/workflow_environments_8069.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
// CI installs the Worker's YAML parser (frontend/test/dr_cleanup_7917).
const YAML = createRequire(join(ROOT, 'cloudflare-worker', 'package.json'))('yaml');
const DIR = join(ROOT, '.github', 'workflows');

/** A credential that unlocks a cloud account: a Cloudflare API token or an S3-style access key, or an AWS/Azure one. */
export const isCloudCredential = (name) =>
  /CLOUDFLARE_API_TOKEN$|_ACCESS_KEY_ID$|_SECRET_ACCESS_KEY$|^AWS_|^AZURE_/.test(name);
/** Long-lived cloud keys that #8064 replaces with OIDC federation. None may be read by any workflow. */
export const FORBIDDEN_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AZURE_CLIENT_SECRET', 'AZURE_CREDENTIALS'];
/** What exchanges the job's OIDC token. A job holding `id-token: write` must contain one of these. */
export const OIDC_CONSUMERS = [
  /\buses:\s*anthropics\/claude-code-action@/, // D5530: Claude Code's workload identity federation
  /\bvars\.ANTHROPIC_FEDERATION_RULE_ID\b/, // the same federation, read by a script
  /\bACTIONS_ID_TOKEN_REQUEST_(?:URL|TOKEN)\b/, // a step that requests the token itself
  /\buses:\s*aws-actions\/configure-aws-credentials@/, // #8064: AWS role assumption
  /\buses:\s*azure\/login@/, // #8064: Azure federated credential
  /\buses:\s*actions\/attest-build-provenance@/, // #8073: Sigstore keyless signing
  /\bvars\.CI_CAPACITY_AUDIENCE\b/, // D7909: scripts/ci/capacity-client.mjs requests the token for this audience
];
/**
 * Jobs that read a cloud credential without an environment, each with why and who removes it.
 * file-backup is a scheduled alert: production-ops has a required reviewer, so naming it would hold every
 * alert run for approval. The owner chooses its home on #8069 (D8069, "Owner gates").
 */
export const EXCEPTIONS = [
  { workflow: 'github-alerts.yml', job: 'file-backup', reason: 'scheduled read-only backup health check; home pending the owner (D8069)' },
];
/** The deploy and ops workflows #8069 names: each declares `permissions` per job and none at the top. */
export const JOB_PERMISSION_WORKFLOWS = [
  'cloudflare-worker-deploy.yml', 'merge-control-deploy.yml', 'meeting-bot-deploy.yml', 'archive-observer-deploy.yml',
  'pr-preview-deploy.yml', 'post-deploy-smoke.yml', 'backup-d1.yml', 'dr-drill.yml', 'file-recovery.yml',
];

/** Every `secrets.NAME` and `secrets['NAME']` inside `${{ }}` (and in bare `if:` expressions) in a job. */
export function secretsRead(value, key = '') {
  const out = new Set();
  const scan = (expr) => {
    for (const m of expr.matchAll(/\bsecrets\.([A-Za-z_][\w-]*)|\bsecrets\[\s*'([\w-]+)'\s*\]/g)) out.add((m[1] || m[2]).toUpperCase());
  };
  const visit = (k, v) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) scan(m[1]);
      if (k === 'if' && !v.includes('${{')) scan(v);
    } else if (v && typeof v === 'object') for (const [ck, cv] of Object.entries(v)) visit(ck, cv);
  };
  visit(key, value);
  return out;
}

const environmentName = (job) => (typeof job.environment === 'string' ? job.environment : job.environment?.name) || null;
const grantsIdToken = (permissions) => permissions === 'write-all' || (permissions && typeof permissions === 'object' && permissions['id-token'] === 'write');

/** Whether a job exchanges its OIDC token: itself, or through a local reusable workflow whose job does (to a depth of 4). */
function usesOidc(job, load, depth = 0) {
  if (OIDC_CONSUMERS.some((re) => re.test(YAML.stringify(job)))) return true;
  if (depth >= 4 || typeof job.uses !== 'string') return false;
  // A local call, or this repository's own workflow pinned at a commit (D8335's capacity planner pin). The pinned
  // copy is read from the tree: a pin moves only to a commit on main, so the tree carries the reviewed text.
  const m = job.uses.match(/^(?:\.\/|AxalNetwork\/StudioOS\/)\.github\/workflows\/([\w.-]+\.ya?ml)(?:@[0-9a-f]{40})?$/);
  if (!m || (job.uses.startsWith('AxalNetwork/') && !job.uses.includes('@'))) return false;
  const text = load(m[1]);
  if (!text) return false;
  return Object.values(YAML.parse(text).jobs || {}).some((j) => grantsIdToken(j.permissions) && usesOidc(j, load, depth + 1));
}

/** The problems in one parsed workflow. `load(name)` returns another workflow's text, for reusable calls. */
export function problems(file, text, load = () => null) {
  const wf = YAML.parse(text);
  const out = [];
  const top = wf.permissions;
  for (const [id, job] of Object.entries(wf.jobs || {})) {
    const where = `${file} › ${id}`;
    const read = secretsRead(job);
    for (const name of read) if (FORBIDDEN_KEYS.includes(name)) out.push(`${where} reads ${name}: use an OIDC login (#8064), not a long-lived key`);
    const cloud = [...read].filter(isCloudCredential);
    const excepted = EXCEPTIONS.some((e) => e.workflow === file && e.job === id);
    if (cloud.length && !environmentName(job) && !excepted) out.push(`${where} reads ${cloud.join(', ')} without naming an environment`);
    // The preview jobs must never read the generic name while a repository copy of it can still exist:
    // a missing environment secret falls back to the repository secret of the same name.
    if (environmentName(job) === 'preview' && read.has('CLOUDFLARE_API_TOKEN')) out.push(`${where} reads CLOUDFLARE_API_TOKEN in preview; until #8063 deletes the repository copy that resolves to the generic token`);
    const permissions = job.permissions ?? top;
    if (grantsIdToken(permissions)) {
      if (!usesOidc(job, load)) out.push(`${where} holds id-token: write with no OIDC login step`);
    }
  }
  if (JOB_PERMISSION_WORKFLOWS.includes(file)) {
    if (top && !(typeof top === 'object' && Object.keys(top).length === 0)) out.push(`${file} grants permissions at the top; declare them per job and set \`permissions: {}\``);
    for (const [id, job] of Object.entries(wf.jobs || {})) if (job.permissions === undefined) out.push(`${file} › ${id} declares no permissions`);
  }
  return out;
}

const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const load = (name) => { try { return readFileSync(join(DIR, name), 'utf8'); } catch { return null; } };

test('D8069: every workflow meets the environment, OIDC and per-job permission rules', () => {
  const found = files.flatMap((f) => problems(f, load(f), load));
  assert.deepEqual(found, []);
});

test('D8069: the named deploy and ops workflows exist, and every exception still names a real job', () => {
  for (const f of JOB_PERMISSION_WORKFLOWS) assert.ok(files.includes(f), `${f} is missing`);
  for (const e of EXCEPTIONS) {
    const wf = YAML.parse(load(e.workflow));
    assert.ok(wf.jobs?.[e.job], `exception ${e.workflow} › ${e.job} names no job; remove it`);
    assert.ok([...secretsRead(wf.jobs[e.job])].some(isCloudCredential), `exception ${e.workflow} › ${e.job} reads no cloud credential; remove it`);
    assert.ok(!wf.jobs[e.job].environment, `${e.workflow} › ${e.job} now names an environment; remove the exception`);
  }
});

test('D8069: the preview jobs enter `preview`, the production deploys `production`, every DR and recovery job `production-ops`', () => {
  const env = (f, j) => environmentName(YAML.parse(load(f)).jobs[j]);
  assert.equal(env('pr-preview-deploy.yml', 'deploy'), 'preview');
  assert.equal(env('pr-preview-deploy.yml', 'delete'), 'preview');
  assert.match(load('pr-preview-deploy.yml'), /name: 'preview' \}\);/, 'resolve checks the environment the jobs enter');
  for (const f of ['cloudflare-worker-deploy.yml', 'merge-control-deploy.yml', 'meeting-bot-deploy.yml', 'archive-observer-deploy.yml']) assert.equal(env(f, 'deploy'), 'production', f);
  assert.equal(env('backup-d1.yml', 'backup'), 'production-ops');
  assert.equal(env('dr-drill.yml', 'drill'), 'production-ops');
  assert.equal(env('file-recovery.yml', 'snapshot'), 'production-ops');
  assert.equal(env('dr-drill.yml', 'independent-file-drill'), 'production-ops', 'the synthetic drill reads the outside copy keys');
  assert.equal(env('file-recovery.yml', 'synthetic-proof'), 'production-ops');
});

// Fixtures: invented workflows, so each rule is shown failing on its own.
const wf = (jobs, top = '') => `name: x\non: workflow_dispatch\n${top}jobs:\n${jobs}`;

test('D8069 rule: a cloud credential outside an environment is refused; inside one it passes', () => {
  const bare = wf('  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        env:\n          T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n');
  assert.deepEqual(problems('x.yml', bare), ['x.yml › a reads CLOUDFLARE_API_TOKEN without naming an environment']);
  const keys = wf('  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        env:\n          K: ${{ secrets[\'FILE_DR_COPY_SECRET_ACCESS_KEY\'] }}\n');
  assert.equal(problems('x.yml', keys).length, 1, 'an S3-style key counts, in bracket form too');
  const inside = wf('  a:\n    environment: production\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        env:\n          T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n');
  assert.deepEqual(problems('x.yml', inside), []);
  const comment = wf('  a:\n    runs-on: ubuntu-latest\n    # secrets.CLOUDFLARE_API_TOKEN is read elsewhere\n    steps:\n      - run: echo "secrets.CLOUDFLARE_API_TOKEN"\n');
  assert.deepEqual(problems('x.yml', comment), [], 'a comment or plain text is not a read');
  const bareIf = wf("  a:\n    runs-on: ubuntu-latest\n    steps:\n      - if: secrets.CLOUDFLARE_API_TOKEN != ''\n        run: echo\n");
  assert.equal(problems('x.yml', bareIf).length, 1, 'a bare if: expression is a read');
});

test('D8069 rule: no long-lived AWS or Azure key, even inside an environment', () => {
  for (const name of FORBIDDEN_KEYS) {
    const job = wf(`  a:\n    environment: production\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        env:\n          K: \${{ secrets.${name} }}\n`);
    assert.ok(problems('x.yml', job).some((p) => p.includes(`reads ${name}: use an OIDC login`)), name);
  }
});

test('D8069 rule: id-token: write needs an OIDC login in the same job, or a called workflow that has one', () => {
  const idle = wf('  a:\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n    steps:\n      - run: echo\n');
  assert.deepEqual(problems('x.yml', idle), ['x.yml › a holds id-token: write with no OIDC login step']);
  const inherited = wf('  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n', 'permissions:\n  id-token: write\n');
  assert.equal(problems('x.yml', inherited).length, 1, 'a top-level grant counts for every job without its own');
  const aws = wf('  a:\n    environment: production\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n    steps:\n      - uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000\n');
  assert.deepEqual(problems('x.yml', aws), []);
  const caller = wf('  a:\n    permissions:\n      id-token: write\n    uses: ./.github/workflows/callee.yml\n');
  const callee = wf('  b:\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n    steps:\n      - run: echo "$ACTIONS_ID_TOKEN_REQUEST_URL"\n');
  assert.deepEqual(problems('x.yml', caller, (n) => (n === 'callee.yml' ? callee : null)), []);
  assert.equal(problems('x.yml', caller, () => wf('  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n')).length, 1);
  const pinned = wf('  a:\n    permissions:\n      id-token: write\n    uses: AxalNetwork/StudioOS/.github/workflows/callee.yml@' + 'a'.repeat(40) + '\n');
  assert.deepEqual(problems('x.yml', pinned, (n) => (n === 'callee.yml' ? callee : null)), [], 'this repository\'s workflow pinned at a commit is followed');
  const foreign = wf('  a:\n    permissions:\n      id-token: write\n    uses: someone/else/.github/workflows/callee.yml@' + 'a'.repeat(40) + '\n');
  assert.equal(problems('x.yml', foreign, (n) => (n === 'callee.yml' ? callee : null)).length, 1, 'another repository\'s workflow is never read from this tree');
  const unpinned = wf('  a:\n    permissions:\n      id-token: write\n    uses: AxalNetwork/StudioOS/.github/workflows/callee.yml@main\n');
  assert.equal(problems('x.yml', unpinned, (n) => (n === 'callee.yml' ? callee : null)).length, 1, 'a branch ref is not a reviewed pin');
  const capacity = wf('  a:\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n    env:\n      AUD: ${{ vars.CI_CAPACITY_AUDIENCE }}\n    steps:\n      - run: node scripts/ci/capacity-executor.mjs admit\n');
  assert.deepEqual(problems('x.yml', capacity), [], 'the capacity client requests the token for its audience (D7909)');
});

test('D8069 rule: the preview environment never reads the generic token name', () => {
  const job = wf('  a:\n    environment: preview\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        env:\n          T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n');
  assert.equal(problems('x.yml', job).length, 1);
});

test('D8069 rule: a named deploy workflow grants nothing at the top and declares permissions per job', () => {
  const topGrant = wf('  a:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: echo\n', 'permissions:\n  contents: read\n');
  assert.deepEqual(problems('backup-d1.yml', topGrant), ['backup-d1.yml grants permissions at the top; declare them per job and set `permissions: {}`']);
  const missing = wf('  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n', 'permissions: {}\n');
  assert.deepEqual(problems('backup-d1.yml', missing), ['backup-d1.yml › a declares no permissions']);
  assert.deepEqual(problems('other.yml', topGrant), [], 'other workflows are not held to the per-job rule here (#8072 owns CI)');
});
