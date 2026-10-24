/** B8 release isolation: these regressions reproduce the reverted site coupling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSections, bindings } from '../check-wrangler-binding-parity.mjs';
import { withMeetingBotBinding } from './meetingBotBinding.mjs';
import { renderBranchConfig, checkRendered } from './branchConfig.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const site=read('wrangler.toml'),bot=read('wrangler.meeting-bot.toml');
function isolated(source,workflow,branch,pkg){
  assert.doesNotMatch(source,/\[\[(?:env\.\w+\.)?containers\]\]/);
  for(const text of [workflow,branch,pkg])assert.doesNotMatch(text,/preflight-meeting-bot|build-meeting-bot|dry-run-meeting-bot/);
}
test('site deploys have no image dependency; the previous coupling is detected',()=>{
  const workflow=read('.github/workflows/cloudflare-worker-deploy.yml'),branch=read('.github/workflows/branch-provision.yml'),pkg=read('package.json');
  isolated(site,workflow,branch,pkg);
  for(const index of [0,1,2,3]){
    const args=[site,workflow,branch,pkg];args[index]+=index===0?'\n[[containers]]':'\nnode scripts/build-meeting-bot-image.mjs';
    assert.throws(()=>isolated(...args));isolated(site,workflow,branch,pkg);
  }
});
function remote(source){
  const sections=parseSections(source);
  for(const [prefix,script] of [['','studioos-meeting-bot'],['env.production.','studioos-meeting-bot'],['env.preview.','studioos-meeting-bot-preview']]){
    const row=sections.find(s=>s.name===prefix+'durable_objects.bindings'&&s.kv.get('name')==='"MEETING_BOT_CONTAINER"');
    assert.ok(row);assert.equal(row.kv.get('class_name'),'"MeetingBotContainer"');assert.equal(row.kv.get('script_name'),JSON.stringify(script));
  }
}
test('site bindings target the separate production and preview host, never a local class',()=>{
  const configured=withMeetingBotBinding(site);
  assert.equal(withMeetingBotBinding(configured),configured);
  assert.doesNotMatch(site,/MEETING_BOT_CONTAINER/);
  remote(configured);assert.throws(()=>remote(configured.replace('script_name = "studioos-meeting-bot"','script_name = "studioos"')));remote(configured);
  const sections=parseSections(bot),root=bindings(sections,''),preview=bindings(sections,'env.preview.');
  assert.deepEqual(preview,root);
  assert.match(bot,/workers_dev = false/);assert.match(bot,/preview_urls = false/);
  assert.match(read('meeting-bot/worker/index.ts'),/status: 404/);
});
test('branches cannot accidentally call the HQ bot host with their own callbacks or key',()=>{
  const fixture=JSON.parse(read('infra/branches/_example.json'));
  const output=renderBranchConfig(withMeetingBotBinding(site),fixture);
  assert.doesNotMatch(output,/MEETING_BOT_CONTAINER/);assert.deepEqual(checkRendered(withMeetingBotBinding(site),fixture,output),[]);
});
test('independent bot deployment is main-only, owner-gated, builds first and never migrates site D1',()=>{
  const workflow=read('.github/workflows/meeting-bot-deploy.yml');
  assert.match(workflow,/branches: \[main\]/);assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/vars.MEETING_BOT_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow,/secrets.MEETING_BOT_CLOUDFLARE_API_TOKEN/);
  assert.ok(workflow.indexOf('node scripts/build-meeting-bot-image.mjs')<workflow.indexOf('wrangler deploy --config wrangler.meeting-bot.toml'));
  assert.doesNotMatch(workflow,/migrate-d1|npm run deploy|--config wrangler.toml/);
});
