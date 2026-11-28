/** D5815 (#5815): every Teams deployment-matrix row passes on the repo and fails on its own mutation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { teamsMatrix, formatMatrix } from './meetingBotTeamsMatrix.mjs';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const base = {
  site: read('wrangler.toml'), bot: read('wrangler.meeting-bot.toml'),
  workflow: read('.github/workflows/meeting-bot-deploy.yml'), dockerfile: read('meeting-bot/Dockerfile'),
  botPackage: read('meeting-bot/package.json'), container: read('meeting-bot/worker/container.ts'),
};
const failing = input => teamsMatrix(input).filter(r => !r.ok).map(r => `${r.env}:${r.check}`).sort();
const once = (text, from, to) => {
  assert.equal(text.split(from).length, 2, `mutation anchor must occur once: ${from}`);
  return text.replace(from, to);
};
const swap = (field, from, to) => ({ ...base, [field]: once(base[field], from, to) });

test('the repository passes every row', () => {
  assert.deepEqual(failing(base), []);
  assert.ok(teamsMatrix(base).length >= 20);
});

test('D8003: the base image requires a complete digest and retains its Node, slim and stage constraints', () => {
  const digest = '0123456789abcdef'.repeat(4);
  const valid = `FROM node:22-bookworm-slim@sha256:${digest} AS base`;
  const baseFrom = base.dockerfile.split('\n').find(line => line.startsWith('FROM '));
  const withFrom = from => ({ ...base, dockerfile: once(base.dockerfile, baseFrom, from) });
  for (const from of [valid, `FROM node:24-trixie-slim@sha256:${'f'.repeat(64)} AS base`]) {
    assert.deepEqual(failing(withFrom(from)), [], from);
  }
  for (const [name, from] of [
    ['missing digest', 'FROM node:22-bookworm-slim AS base'],
    ['empty digest', valid.replace(digest, '')],
    ['short digest', valid.replace(digest, digest.slice(1))],
    ['long digest', valid.replace(digest, digest + '0')],
    ['uppercase digest', valid.replace(digest, digest.toUpperCase())],
    ['nonhex digest', valid.replace(digest, 'g' + digest.slice(1))],
    ['wrong algorithm', valid.replace('@sha256:', '@sha512:')],
    ['untagged image', `FROM node@sha256:${digest} AS base`],
    ['floating tag', `FROM node:latest@sha256:${digest} AS base`],
    ['floating Node major', valid.replace('node:22-', 'node:latest-')],
    ['Node minor version', valid.replace('node:22-', 'node:22.1-')],
    ['not slim', valid.replace('-slim@', '@')],
    ['different image', valid.replace('FROM node:', 'FROM alpine:')],
    ['different stage', valid.replace(' AS base', ' AS runtime')],
    ['commented instruction', '# ' + valid],
    ['trailing content', valid + ' extra'],
  ]) {
    assert.deepEqual(failing(withFrom(from)), ['both:browser_pinned'], name);
  }
});

const prodSiteBinding = '[[env.production.durable_objects.bindings]]\nname = "MEETING_BOT_CONTAINER"\nclass_name = "MeetingBotContainer"\nscript_name = "studioos-meeting-bot"';
const previewDo = '[[env.preview.durable_objects.bindings]]\nname       = "PIPELINE_ROOM"';
const previewBotOff = '# D886: preview needs its own explicit enablement.\nMEETING_BOT = "off"';
const previewBot = script => `[[env.preview.durable_objects.bindings]]\nname = "MEETING_BOT_CONTAINER"\nclass_name = "MeetingBotContainer"${script ? `\nscript_name = "${script}"` : ''}\n\n${previewDo}`;
const mutations = [
  ['production site points at the preview host', swap('site', prodSiteBinding, prodSiteBinding.replace('"studioos-meeting-bot"', '"studioos-meeting-bot-preview"')), ['production:site_binds_its_own_bot_host']],
  // D7147 part 2: staging has no bot binding; adding one to production's host or a local class fails, and so does the bot on without one.
  ['preview site points at the production host', swap('site', previewDo, previewBot('studioos-meeting-bot')), ['preview:site_binds_its_own_bot_host']],
  ['preview site binds a local bot class', swap('site', previewDo, previewBot(null)), ['preview:site_binds_its_own_bot_host']],
  ['preview bot on without a binding', swap('site', previewBotOff, previewBotOff.replace('"off"', '"canary"')), ['preview:site_binds_its_own_bot_host']],
  ['production site loses its bot binding', swap('site', prodSiteBinding + '\n', ''), ['production:site_binds_its_own_bot_host']],
  ['preview host renamed away from the binding', swap('bot', 'name = "studioos-meeting-bot-preview"', 'name = "studioos-meeting-bot-staging"'), ['preview:site_binds_its_own_bot_host']],
  ['run state moved to the host', swap('site', '[[env.preview.durable_objects.bindings]]\nname       = "MEETING_BOT_RUN"\nclass_name = "MeetingBotRun"', '[[env.preview.durable_objects.bindings]]\nname       = "MEETING_BOT_RUN"\nclass_name = "MeetingBotRun"\nscript_name = "studioos-meeting-bot-preview"'), ['preview:site_has_run_state_object']],
  ['preview FILES bucket missing', swap('site', 'binding     = "FILES"\nbucket_name = "studioos-files-preview"', 'binding     = "UPLOADS"\nbucket_name = "studioos-files-preview"'), ['both:environments_distinct', 'preview:site_has_private_files_bucket']],
  ['preview shares production FILES', swap('site', 'bucket_name = "studioos-files-preview"', 'bucket_name = "studioos-files"'), ['both:environments_distinct']],
  ['Teams switch typo reads silently as off', swap('site', '# D1451 (#5297): Teams joins off, as everywhere.\nMEETING_BOT_TEAMS = "off"', '# D1451 (#5297): Teams joins off, as everywhere.\nMEETING_BOT_TEAMS = "On"'), ['preview:teams_switch_valid']],
  ['bot switch typo', swap('site', '# D886: preview needs its own explicit enablement.\nMEETING_BOT = "off"', '# D886: preview needs its own explicit enablement.\nMEETING_BOT = "disabled"'), ['preview:meeting_bot_switch_valid', 'preview:site_binds_its_own_bot_host']],
  ['Teams on while the bot is off', swap('site', '# D1451 (#5297): Teams joins off, as everywhere.\nMEETING_BOT_TEAMS = "off"', '# D1451 (#5297): Teams joins off, as everywhere.\nMEETING_BOT_TEAMS = "on"'), ['preview:teams_never_wider_than_bot']],
  ['production host calls back to preview', swap('bot', '[vars]\nAPP_URL = "https://app.axal.vc"', '[vars]\nAPP_URL = "https://studioos-preview.guillaumelauzier.workers.dev"'), ['production:host_callback_origin_is_this_site']],
  ['preview host calls back to production', swap('bot', 'APP_URL = "https://studioos-preview.guillaumelauzier.workers.dev"', 'APP_URL = "https://app.axal.vc"'), ['preview:host_callback_origin_is_this_site']],
  ['callback origin carries a path', swap('bot', '[vars]\nAPP_URL = "https://app.axal.vc"', '[vars]\nAPP_URL = "https://app.axal.vc/api"'), ['production:host_callback_origin_is_this_site']],
  ['preview loses its signing audience', swap('bot', 'CF_BOT_AUDIENCE = "preview"', 'CF_BOT_AUDIENCE = "production"'), ['preview:host_signing_audience_scoped']],
  ['production gains the preview audience', swap('bot', '[vars]\nAPP_URL = "https://app.axal.vc"', '[vars]\nAPP_URL = "https://app.axal.vc"\nCF_BOT_AUDIENCE = "preview"'), ['production:host_signing_audience_scoped']],
  ['preview image from another Dockerfile', swap('bot', '[env.preview.containers.images.runtime]\ndockerfile = "./meeting-bot/Dockerfile"', '[env.preview.containers.images.runtime]\ndockerfile = "./meeting-bot/Dockerfile.dev"'), ['preview:host_container_declared']],
  ['production container migration dropped', swap('bot', '[[migrations]]\ntag = "v1-meeting-bot-container"\nnew_sqlite_classes = ["MeetingBotContainer"]', ''), ['production:host_container_declared']],
  ['member OAuth client on the host', swap('bot', '[vars]\nAPP_URL = "https://app.axal.vc"', '[vars]\nAPP_URL = "https://app.axal.vc"\nMICROSOFT_CLIENT_ID = "x"'), ['production:host_holds_no_member_oauth']],
  ['host binds a bucket directly', swap('bot', '[env.preview]\n', '[[env.preview.r2_buckets]]\nbinding = "FILES"\nbucket_name = "x"\n\n[env.preview]\n'), ['preview:host_holds_no_member_oauth']],
  ['hosts share one script', swap('bot', 'name = "studioos-meeting-bot-preview"', 'name = "studioos-meeting-bot"'), ['both:environments_distinct', 'preview:site_binds_its_own_bot_host']],
  ['Playwright floats', swap('botPackage', '"playwright": "1.64.0"', '"playwright": "^1.64.0"'), ['both:browser_pinned']],
  ['browser installed from the network', swap('dockerfile', 'npx --no-install playwright install chromium', 'npx playwright@latest install chromium'), ['both:browser_pinned']],
  ['browser system packages not installed through the pinned apt source (#9209)', swap('dockerfile', 'npx --no-install playwright install-deps chromium', 'true'), ['both:browser_pinned']],
  ['egress turned off', ({ ...base, container: base.container.replace(/enableInternet:true/g, 'enableInternet:false') }), ['both:container_readiness_and_egress']],
  ['readiness probe removed', ({ ...base, container: base.container.replace(/\/healthz/g, '/ready') }), ['both:container_readiness_and_egress']],
  ['production promoted before preview verify', swap('workflow', 'run: node --experimental-strip-types --no-warnings scripts/verify-meeting-bot-preview.mjs\n', 'run: echo skipped\n'), ['both:revision_stamped_and_preview_first']],
  ['production deploy unstamped', swap('workflow', '--env "" --var "MEETING_BOT_VERSION:${GITHUB_SHA}"', '--env ""'), ['both:revision_stamped_and_preview_first']],
];
test('D7147 part 2: preview passes with no binding (bot off) and with a binding to its own host only', () => {
  assert.equal(base.site.split('[env.preview]')[1].includes('MEETING_BOT_CONTAINER'), false);
  assert.deepEqual(failing(base), []);
  assert.deepEqual(failing(swap('site', previewDo, previewBot('studioos-meeting-bot-preview'))), []);
});
for (const [name, input, expected] of mutations) {
  test(`fails exactly its row: ${name}`, () => {
    assert.deepEqual(failing(input), expected);
  });
}

test('the report prints checks and states, never a configured value', () => {
  const text = formatMatrix(teamsMatrix(base));
  for (const secretish of ['app.axal.vc', 'workers.dev', 'studioos-files', '1.64.0', 'standard-2', 'studioos-meeting-bot'])
    assert.equal(text.includes(secretish), false, secretish);
  assert.match(text, /^pass {2}production site_binds_its_own_bot_host$/m);
});

test('the CLI exits 0 on the repository', () => {
  const script = fileURLToPath(new URL('../check-meeting-bot-teams.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /FAIL/);
});
