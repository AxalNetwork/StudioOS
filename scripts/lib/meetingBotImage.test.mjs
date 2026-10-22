import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { imagePlan, buildImage } from './meetingBotImage.mjs';
const revision = 'a'.repeat(40);

test('image is versioned by full commit, lowercased and scoped to its repository', () => {
  const plan = imagePlan('AxalNetwork/StudioOS', revision);
  assert.equal(plan.image, `ghcr.io/axalnetwork/studioos/meeting-bot:sha-${revision}`);
  assert.ok(plan.args.includes('linux/amd64'));
  assert.ok(plan.args.includes(`org.opencontainers.image.revision=${revision}`));
  assert.ok(plan.args.includes('org.opencontainers.image.source=https://github.com/AxalNetwork/StudioOS'));
  assert.ok(plan.args.includes('--pull'));
  for (const invalid of ['', '../x', 'org/repo;echo x', 'org/repo/name', '-x/repo', 'org/$(x)']) assert.throws(() => imagePlan(invalid, revision), /invalid_repository/);
  for (const invalid of ['', 'main', 'a'.repeat(39), 'A'.repeat(40), `${revision}\n`]) assert.throws(() => imagePlan('org/repo', invalid), /invalid_revision/);
  assert.match(imagePlan('org/repo', revision, true).image, /^meeting-bot-pipeline-fixture:/);
});

test('missing runtime or ignore file and a failed build all fail closed', () => {
  const context = mkdtempSync(join(tmpdir(), 'bot-image-test-'));
  const calls = [];
  const run = (...args) => { calls.push(args); return { status: 0 }; };
  const opts = { context, repository: 'org/repo', revision, run };
  try {
    assert.throws(() => buildImage(opts), /runtime_image_not_ready/);
    writeFileSync(join(context, 'Dockerfile'), 'FROM scratch\n');
    assert.throws(() => buildImage(opts), /runtime_image_not_ready/);
    assert.equal(calls.length, 0);
    writeFileSync(join(context, '.dockerignore'), '*\n!Dockerfile\n');
    assert.equal(buildImage(opts), imagePlan('org/repo', revision).image);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['docker', [...imagePlan('org/repo', revision).args, '--file', join(context, 'Dockerfile'), context]]);
    for (const status of [1, null, undefined]) assert.throws(() => buildImage({ ...opts, run: () => ({ status }) }), /image_build_failed/);
  } finally { rmSync(context, { recursive: true, force: true }); }
});

test('workflow restricts publication and orders a real build before login/push', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/meeting-bot-image.yml', import.meta.url), 'utf8');
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets: inherit|:latest/);
  assert.match(workflow, /needs: validate/);
  const publish = workflow.slice(workflow.indexOf('  publish:'));
  for (const marker of ['node scripts/build-meeting-bot-image.mjs >>', 'docker login', 'docker push']) assert.ok(publish.includes(marker), marker);
  assert.ok(publish.indexOf('node scripts/build-meeting-bot-image.mjs >>') < publish.indexOf('docker login'));
  assert.ok(publish.indexOf('docker login') < publish.indexOf('docker push'));
  assert.match(publish, /--password-stdin/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('  publish:')), /packages: write|secrets\./);
  assert.match(workflow, /--fixture/);
});


test('CLI separates build logs from publish outputs and emits no fixture or failed-build output', () => {
  const root = mkdtempSync(join(tmpdir(), 'bot-cli-test-'));
  const cli = fileURLToPath(new URL('../build-meeting-bot-image.mjs', import.meta.url));
  try {
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'meeting-bot'));
    writeFileSync(join(root, 'bin/docker'), '#!/bin/sh\nprintf "build-log\\n"\nexit "${FAKE_DOCKER_EXIT:-0}"\n', { mode: 0o755 });
    writeFileSync(join(root, 'meeting-bot/Dockerfile'), 'FROM scratch\n');
    writeFileSync(join(root, 'meeting-bot/.dockerignore'), '*\n');
    const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, GITHUB_REPOSITORY: 'org/repo', GITHUB_SHA: revision };
    const call = (args = [], extra = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
    const success = call();
    assert.equal(success.status, 0);
    assert.equal(success.stdout, `image=ghcr.io/org/repo/meeting-bot:sha-${revision}\n`);
    assert.match(success.stderr, /build-log/);
    const fixture = call(['--fixture']);
    assert.equal(fixture.status, 0);
    assert.equal(fixture.stdout, '');
    const failure = call([], { FAKE_DOCKER_EXIT: '7' });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.match(failure.stderr, /image_build_failed/);
    assert.equal(call(['--unknown']).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
