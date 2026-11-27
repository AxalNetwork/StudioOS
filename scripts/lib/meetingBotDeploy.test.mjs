/** B8 release isolation: these regressions reproduce the reverted site coupling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSections, bindings } from '../check-wrangler-binding-parity.mjs';
import { withMeetingBotBinding, withMeetingBotTopology, botBindingProblem, BOT_HOSTS } from './meetingBotBinding.mjs';
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
  for(const {prefix,script,optional} of BOT_HOSTS){
    const row=sections.find(s=>s.name===prefix+'durable_objects.bindings'&&s.kv.get('name')==='"MEETING_BOT_CONTAINER"');
    // D7147 part 2: staging (preview) may carry no bot binding while its bot is off.
    if(optional&&!row){assert.equal(botBindingProblem(sections,prefix),null);continue;}
    assert.ok(row);assert.equal(row.kv.get('class_name'),'"MeetingBotContainer"');assert.equal(row.kv.get('script_name'),JSON.stringify(script));
    assert.equal(botBindingProblem(sections,prefix),null);
  }
}
test('site bindings target production\'s own host; preview binds none (bot off) or only the preview host, never a local class',()=>{
  const configured=withMeetingBotBinding(site);
  assert.equal(withMeetingBotBinding(configured),configured);
  // Provisioned (2026-10-28, after both bot hosts deployed): the site carries exactly the configured bindings.
  assert.equal(site,configured);
  remote(configured);assert.throws(()=>remote(configured.replace('script_name = "studioos-meeting-bot"','script_name = "studioos"')));remote(configured);
  // D7147 part 2: staging has no bot binding, by owner decision, and its bot stays off.
  assert.doesNotMatch(configured.split('[env.preview]')[1],/MEETING_BOT_CONTAINER/);
  assert.equal(botBindingProblem(parseSections(configured),'env.preview.'),null);
  const sections=parseSections(bot),root=bindings(sections,''),preview=bindings(sections,'env.preview.');
  const onlyPreview=new Set(['CF_BOT_AUDIENCE','PREVIEW_CANARY_ENABLED','PREVIEW_CANARY_ORIGIN']);
  assert.deepEqual(new Set([...preview.get('vars')].filter(k=>!onlyPreview.has(k))),root.get('vars'));
  for(const key of onlyPreview){assert.ok(preview.get('vars').has(key));assert.equal(root.get('vars').has(key),false);}
  preview.set('vars',root.get('vars'));assert.deepEqual(preview,root);
  assert.match(bot,/workers_dev = false/);assert.match(bot,/preview_urls = false/);
  assert.match(read('meeting-bot/worker/index.ts'),/status: 404/);
});
const PREVIEW_DO='[[env.preview.durable_objects.bindings]]\nname       = "PIPELINE_ROOM"';
const BOT_OFF='# D886: preview needs its own explicit enablement.\nMEETING_BOT = "off"';
const once=(text,from,to)=>{assert.equal(text.split(from).length,2,`anchor must occur once: ${from}`);return text.replace(from,to);};
const previewBinding=script=>`[[env.preview.durable_objects.bindings]]\nname = "MEETING_BOT_CONTAINER"\nclass_name = "MeetingBotContainer"${script?`\nscript_name = "${script}"`:''}\n\n${PREVIEW_DO}`;
const previewProblem=source=>botBindingProblem(parseSections(source),'env.preview.');
test('D7147 part 2: preview binds nothing while its bot is off, or only the preview host',()=>{
  // No binding, bot off: allowed (staging today), and provisioning never adds one back.
  assert.equal(previewProblem(site),null);remote(site);assert.equal(withMeetingBotBinding(site),site);
  // No binding, bot on: refused.
  for(const on of ['canary','on']){
    const bad=once(site,BOT_OFF,BOT_OFF.replace('"off"',`"${on}"`));
    assert.equal(previewProblem(bad),'bot_on_without_binding');assert.throws(()=>remote(bad));
    assert.throws(()=>withMeetingBotBinding(bad),/bot_on_without_binding/);
  }
  // No MEETING_BOT at all reads as unsafe, not off.
  assert.equal(previewProblem(once(site,BOT_OFF,'')),'bot_on_without_binding');
  // The separate preview host: allowed, and provisioning keeps it.
  const own=once(site,PREVIEW_DO,previewBinding('studioos-meeting-bot-preview'));
  assert.equal(previewProblem(own),null);remote(own);assert.equal(withMeetingBotBinding(own),own);
  // Production's host: refused.
  const prod=once(site,PREVIEW_DO,previewBinding('studioos-meeting-bot'));
  assert.equal(previewProblem(prod),'wrong_bot_host');assert.throws(()=>remote(prod));
  assert.throws(()=>withMeetingBotBinding(prod),/conflicting_bot_binding/);
  // A local class: refused.
  const local=once(site,PREVIEW_DO,previewBinding(null));
  assert.equal(previewProblem(local),'local_bot_class');assert.throws(()=>remote(local));
  assert.throws(()=>withMeetingBotBinding(local),/conflicting_bot_binding/);
  // Another class on the preview host: refused.
  const otherClass=once(site,PREVIEW_DO,previewBinding('studioos-meeting-bot-preview').replace('class_name = "MeetingBotContainer"','class_name = "MeetingBotRun"'));
  assert.equal(previewProblem(otherClass),'wrong_bot_class');assert.throws(()=>remote(otherClass));
  // Production must bind its own host: dropping it is refused.
  const prodBinding='[[env.production.durable_objects.bindings]]\nname = "MEETING_BOT_CONTAINER"\nclass_name = "MeetingBotContainer"\nscript_name = "studioos-meeting-bot"\n';
  const noProd=once(site,prodBinding,'');
  assert.equal(botBindingProblem(parseSections(noProd),'env.production.'),'missing_bot_binding');assert.throws(()=>remote(noProd));
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
  assert.match(workflow,/wrangler deploy --config wrangler\.meeting-bot\.toml --env preview/);
  assert.match(workflow,/wrangler deploy --config wrangler\.meeting-bot\.toml --env ""/);
  for(const path of ['cloudflare-worker/src/util/doNamespace.ts','cloudflare-worker/src/types.ts'])assert.ok(workflow.includes(path));
  assert.ok(workflow.indexOf('node scripts/build-meeting-bot-image.mjs')<workflow.indexOf('wrangler deploy --config wrangler.meeting-bot.toml'));
  assert.doesNotMatch(workflow,/migrate-d1|npm run deploy|--config wrangler.toml/);
});

test('owner provisioning also updates the HQ-only catalogue and refuses conflicting definitions',()=>{
  const source=read('cloudflare-worker/src/services/topology.ts');
  const output=withMeetingBotTopology(source);
  assert.match(output,/name: 'MEETING_BOT_CONTAINER'.*hq: 'MeetingBotContainer'.*branch: \(\) => null.*hqOnly: true/);
  assert.equal(withMeetingBotTopology(output),output);
  assert.throws(()=>withMeetingBotTopology(output.replace("hq: 'MeetingBotContainer'","hq: 'WrongHost'")),/conflicting_bot_topology/);
  assert.throws(()=>withMeetingBotTopology(''),/missing_binding_catalogue/);
  assert.throws(()=>withMeetingBotBinding(withMeetingBotBinding(site).replace('script_name = "studioos-meeting-bot"','script_name = "wrong-host"')),/conflicting_bot_binding/);
});
