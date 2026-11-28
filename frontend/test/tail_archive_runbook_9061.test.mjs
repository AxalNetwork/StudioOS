/**
 * #9061 — the studioos-tail runbook (documentation/operations/TAIL_ARCHIVE.md)
 * stays true to the workflows and the Worker's own config.
 *
 * Its central claim is that no workflow deploys `studioos-tail`, so a merge
 * that touches `cloudflare-worker-tail/` does not ship. That stops being true
 * the day someone adds a deploy job (the owner's option B on #9061), and the
 * runbook would then tell operators to deploy by hand for nothing. Pinned:
 *   1. the "nothing automated" sentence holds exactly while no workflow
 *      deploys with the tail config;
 *   2. the archive-observer workflow it cites still triggers on the tail
 *      folder and still deploys only the observer config;
 *   3. the bindings it lists are the ones in cloudflare-worker-tail/wrangler.toml;
 *   4. the folder README and the operations index point at it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const at = (p) => resolve(process.cwd(), p);
const raw = (p) => readFileSync(at(p), 'utf8');
const RUNBOOK = raw('documentation/operations/TAIL_ARCHIVE.md');
const TAIL_TOML = raw('cloudflare-worker-tail/wrangler.toml');
const WORKFLOWS = readdirSync(at('.github/workflows'))
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ f, body: raw(`.github/workflows/${f}`) }));

/** YAML lines that are not comments: prose about a deploy is not a deploy. */
const code = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** A workflow that runs `wrangler deploy` against the tail Worker's config or folder. */
function deploysTail(body) {
  return code(body).split('\n').some((l) =>
    /wrangler(\.js)?\s+deploy\b/.test(l) && !/--dry-run/.test(l)
    && /cloudflare-worker-tail/.test(l))
    || /working-directory:\s*cloudflare-worker-tail\b/.test(code(body))
    || /cd\s+cloudflare-worker-tail\b[^\n]*&&[^\n]*wrangler\s+deploy/.test(code(body));
}

test('"no workflow deploys studioos-tail" holds exactly while none does', () => {
  const deployers = WORKFLOWS.filter(({ body }) => deploysTail(body)).map(({ f }) => f);
  const saysNone = RUNBOOK.includes('**No workflow deploys `studioos-tail`.**');
  assert.equal(saysNone, deployers.length === 0,
    deployers.length
      ? `${deployers.join(', ')} now deploy(s) studioos-tail: rewrite TAIL_ARCHIVE.md §1 and §3`
      : 'TAIL_ARCHIVE.md must say plainly that no workflow deploys studioos-tail');
  if (saysNone) assert.match(RUNBOOK, /does \*\*not\*\* reach production/);
});

test('the archive-observer workflow triggers on the tail folder but deploys only the observer', () => {
  const wf = raw('.github/workflows/archive-observer-deploy.yml');
  assert.match(wf, /-\s*'cloudflare-worker-tail\/\*\*'/, 'its push paths no longer include the tail folder: fix TAIL_ARCHIVE.md §1');
  const deploys = code(wf).split('\n').filter((l) => /wrangler\s+deploy\b/.test(l) && !/--dry-run/.test(l));
  assert.deepEqual(deploys.map((l) => (l.match(/--config\s+(\S+)/) || [])[1]),
    ['cloudflare-archive-observer/wrangler.jsonc']);
  assert.match(RUNBOOK, /wrangler deploy --config cloudflare-archive-observer\/wrangler\.jsonc/);
});

test('the bindings the runbook lists are the tail config\'s', () => {
  const name = TAIL_TOML.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  const bucket = TAIL_TOML.match(/^bucket_name\s*=\s*"([^"]+)"/m)?.[1];
  const days = TAIL_TOML.match(/^RETENTION_DAYS\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal(name, 'studioos-tail');
  assert.ok(RUNBOOK.includes(`R2 \`LOGS\` → bucket \`${bucket}\``), `runbook must name the bucket ${bucket}`);
  assert.ok(RUNBOOK.includes(`\`RETENTION_DAYS = "${days}"\``), `runbook must give RETENTION_DAYS = "${days}"`);
  // The telemetry the code can read but the config does not declare.
  for (const key of ['ARCHIVE_TELEMETRY', 'ARCHIVE_OBSERVER_SECRET']) {
    assert.ok(!new RegExp(`^${key}\\s*=`, 'm').test(TAIL_TOML),
      `${key} is now declared in the tail config: TAIL_ARCHIVE.md §2 says it is not`);
  }
  for (const cmd of ['rollback <VERSION_ID>', 'deployments list', 'versions list', 'scripts/check-tail-consumer.mjs', 'cloudflare-worker-tail/wrangler.toml']) {
    assert.ok(RUNBOOK.includes(cmd), `runbook must give ${cmd}`);
  }
});

test('the folder README and the operations index point at the runbook', () => {
  assert.match(raw('cloudflare-worker-tail/README.md'), /documentation\/operations\/TAIL_ARCHIVE\.md/);
  assert.match(raw('documentation/operations/README.md'), /^\| `TAIL_ARCHIVE\.md` \|/m);
  assert.match(raw('documentation/README.md'), /\(operations\/TAIL_ARCHIVE\.md\)/);
});
