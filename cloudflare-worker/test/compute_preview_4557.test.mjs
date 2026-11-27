/** D4557 part 3: execute the real preview renderer with synthetic configuration, never cloud credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const template = readFileSync(new URL('../../wrangler.agent-compute.toml', import.meta.url), 'utf8');
const renderer = fileURLToPath(new URL('../../scripts/render-agent-compute-preview.py', import.meta.url));
const account = 'a'.repeat(32), digest = 'b'.repeat(64);
const values = {
  SCHEDULING_POLICY: 'durable_object', CLOUDFLARE_ACCOUNT_ID: account,
  SOURCE_IMAGE_REF: `ghcr.io/axalnetwork/studioos-agent-compute@sha256:${digest}`,
  IMAGE_REF: `registry.cloudflare.com/${account}/studioos-agent-compute@sha256:${digest}`,
  IMAGE_SIGNER_WORKFLOW: 'AxalNetwork/StudioOS/.github/workflows/approved-compute-image.yml',
  HOST_NAME: 'studioos-synthetic-compute-preview', BROKER_NAME: 'studioos-synthetic-broker-preview',
};
function render(changes = {}, config = template) {
  const dir = mkdtempSync(join(tmpdir(), 'compute-preview-4557-'));
  try {
    const source = join(dir, 'template.toml'), output = join(dir, 'approved.json');
    writeFileSync(source, config);
    const run = spawnSync('python3', [renderer, '--config', source, '--output', output], {
      encoding: 'utf8', env: { PATH: process.env.PATH, ...values, ...changes },
    });
    return { status: run.status, text: run.stdout + run.stderr,
      output: existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('approved preview uses the same pinned mirrored image for both disabled SQLite applications', () => {
  const result = render(); assert.equal(result.status, 0, result.text);
  const config = result.output, preview = config.env.preview;
  assert.deepEqual(Object.keys(config.env), ['preview']);
  assert.equal(preview.name, values.HOST_NAME);
  assert.deepEqual(preview.services, [{ binding: 'BROKER', service: values.BROKER_NAME }]);
  for (const settings of [config.vars, preview.vars]) {
    assert.equal(settings.COMPUTE_ENABLED, 'off');
    assert.equal(settings.COMPUTE_SCHEDULING_POLICY, 'durable_object');
  }
  assert.equal(preview.workers_dev, false); assert.equal(preview.preview_urls, false);
  assert.deepEqual(preview.containers, ['PythonComputeContainer', 'DocumentComputeContainer'].map(class_name => ({
    class_name, scheduling_policy: 'durable_object', images: { runtime: { image: values.IMAGE_REF } },
  })));
  assert.deepEqual(preview.migrations[0].new_sqlite_classes, ['PythonComputeContainer', 'DocumentComputeContainer']);
  assert.deepEqual(preview.durable_objects.bindings, [
    { name: 'COMPUTE_PYTHON', class_name: 'PythonComputeContainer' },
    { name: 'COMPUTE_DOCUMENTS', class_name: 'DocumentComputeContainer' },
  ]);
});

for (const [name, changes] of [
  ['old policy', { SCHEDULING_POLICY: 'default' }],
  ['missing decision', { SCHEDULING_POLICY: '' }],
  ['wrong account', { CLOUDFLARE_ACCOUNT_ID: 'c'.repeat(32) }],
  ['floating source', { SOURCE_IMAGE_REF: 'ghcr.io/axalnetwork/studioos-agent-compute:latest' }],
  ['wrong source repository', { SOURCE_IMAGE_REF: `ghcr.io/another/compute@sha256:${digest}` }],
  ['unmirrored image', { IMAGE_REF: values.SOURCE_IMAGE_REF }],
  ['wrong mirrored digest', { IMAGE_REF: values.IMAGE_REF.replace(digest, 'c'.repeat(64)) }],
  ['foreign signer', { IMAGE_SIGNER_WORKFLOW: 'another/repo/.github/workflows/image.yml' }],
  ['production host', { HOST_NAME: 'studioos' }],
  ['production broker', { BROKER_NAME: 'studioos-production' }],
  ['same host and broker', { HOST_NAME: values.BROKER_NAME }],
]) test(`preview renderer refuses ${name} before writing deployment config`, () => {
  const result = render(changes);
  assert.equal(result.status, 1, result.text); assert.equal(result.output, null);
  assert.equal(result.text.trim(), 'compute preview configuration refused');
});

for (const [name, change] of [
  ['enabled admission', s => s.replace('COMPUTE_ENABLED = "off"', 'COMPUTE_ENABLED = "on"')],
  ['mixed policies', s => s.replace('scheduling_policy = "durable_object"', 'scheduling_policy = "default"')],
  ['legacy application cap', s => s.replace('class_name = "PythonComputeContainer"\nscheduling_policy', 'class_name = "PythonComputeContainer"\nmax_instances = 2\nscheduling_policy')],
  ['unexpected Dockerfile', s => s.replace('dockerfile = "./agent-compute/Dockerfile"', 'dockerfile = "./unreviewed/Dockerfile"')],
  ['public host', s => s.replace('workers_dev = false', 'workers_dev = true')],
  ['missing SQLite class', s => s.replace('"PythonComputeContainer", "DocumentComputeContainer"', '"PythonComputeContainer"')],
  ['unexpected broker', s => s.replace('service = "studioos-preview"', 'service = "studioos"')],
  ['production environment', s => s + '\n[env.production]\nname = "studioos"\n'],
]) test(`preview renderer refuses ${name} in source config`, () => {
  const result = render({}, change(template));
  assert.equal(result.status, 1, result.text); assert.equal(result.output, null);
});
