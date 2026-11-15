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

const prodSiteBinding = '[[env.production.durable_objects.bindings]]\nname = "MEETING_BOT_CONTAINER"\nclass_name = "MeetingBotContainer"\nscript_name = "studioos-meeting-bot"';
const mutations = [
  ['production site points at the preview host', swap('site', prodSiteBinding, prodSiteBinding.replace('"studioos-meeting-bot"', '"studioos-meeting-bot-preview"')), ['production:site_binds_its_own_bot_host']],
  ['preview site points at the production host', swap('site', 'script_name = "studioos-meeting-bot-preview"', 'script_name = "studioos-meeting-bot"'), ['preview:site_binds_its_own_bot_host']],
  ['preview host renamed away from the binding', swap('bot', 'name = "studioos-meeting-bot-preview"', 'name = "studioos-meeting-bot-staging"'), ['preview:site_binds_its_own_bot_host']],
  ['run state moved to the host', swap('site', '[[env.preview.durable_objects.bindings]]\nname       = "MEETING_BOT_RUN"\nclass_name = "MeetingBotRun"', '[[env.preview.durable_objects.bindings]]\nname       = "MEETING_BOT_RUN"\nclass_name = "MeetingBotRun"\nscript_name = "studioos-meeting-bot-preview"'), ['preview:site_has_run_state_object']],
  ['preview FILES bucket missing', swap('site', 'binding     = "FILES"\nbucket_name = "studioos-files-preview"', 'binding     = "UPLOADS"\nbucket_name = "studioos-files-preview"'), ['both:environments_distinct', 'preview:site_has_private_files_bucket']],
  ['preview shares production FILES', swap('site', 'bucket_name = "studioos-files-preview"', 'bucket_name = "studioos-files"'), ['both:environments_distinct']],
  ['Teams switch typo reads silently as off', swap('site', '# D1451 (#5297): Teams joins off, as everywhere.\nMEETING_BOT_TEAMS = "off"', '# D1451 (#5297): Teams joins off, as everywhere.\nMEETING_BOT_TEAMS = "On"'), ['preview:teams_switch_valid']],
  ['bot switch typo', swap('site', '# D886: preview needs its own explicit enablement.\nMEETING_BOT = "off"', '# D886: preview needs its own explicit enablement.\nMEETING_BOT = "disabled"'), ['preview:meeting_bot_switch_valid']],
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
  ['browser installed from the network', swap('dockerfile', 'npx --no-install playwright install --with-deps chromium', 'npx playwright@latest install --with-deps chromium'), ['both:browser_pinned']],
  ['egress turned off', ({ ...base, container: base.container.replace(/enableInternet:true/g, 'enableInternet:false') }), ['both:container_readiness_and_egress']],
  ['readiness probe removed', ({ ...base, container: base.container.replace(/\/healthz/g, '/ready') }), ['both:container_readiness_and_egress']],
  ['production promoted before preview verify', swap('workflow', 'run: node --experimental-strip-types --no-warnings scripts/verify-meeting-bot-preview.mjs\n', 'run: echo skipped\n'), ['both:revision_stamped_and_preview_first']],
  ['production deploy unstamped', swap('workflow', '--env "" --var "MEETING_BOT_VERSION:${GITHUB_SHA}"', '--env ""'), ['both:revision_stamped_and_preview_first']],
];
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
