/** D5674: recording-ledger projections, privacy, cause-aware routing and recovery qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';import { join } from 'node:path';import { pathToFileURL } from 'node:url';
import { buildBotSourceReceipts,botPrerequisiteReport,readBotSourceEvidence,type BotStageEvidence,type BotHealthWindow } from '../src/services/cloudflareBotHealth.ts';
import { cfRoute } from '../src/services/cloudflareSourceReceipt.ts';
const now=1900000000000;
const run=(patch:Partial<BotStageEvidence>={}):BotStageEvidence=>({key:'private-recording-uid',revision:1,provider:'zoom',status:'recording',created_ms:now-300000,scheduled_ms:now-300000,started_ms:now-250000,
 ended_ms:null,heartbeat_ms:now,callback_ms:now-240000,runtime_error:null,failure_code:null,runtime_version:'a'.repeat(40),processing_ms:null,final_receipt:null,...patch});
const window=(runs:BotStageEvidence[],patch:Partial<BotHealthWindow>={}):BotHealthWindow=>({now,since:now-600000,complete:true,script:'studioos-meeting-bot',enabled:{zoom:true,google_meet:true,teams:false},runs,...patch});

test('idle fleet and disabled provider are counts, not an outage; no recording identity reaches receipts',async()=>{
 const idle=await buildBotSourceReceipts(window([]));assert.equal(idle[0].code,'idle');assert.equal(cfRoute(idle[0]).destination,'activity');
 const disabled=await buildBotSourceReceipts(window([run({provider:'teams',status:'queued'})]));assert.equal(disabled[0].state,'disabled');
 const ordinary=await buildBotSourceReceipts(window([run(),run({revision:1})]));assert.equal(ordinary[0].count,1);assert.doesNotMatch(JSON.stringify(ordinary),/private-recording|session|tenant|participant|https:/);
});

test('startup before callback, missing callback, guest denial, capture/upload/processing and cancellation stay distinct',async()=>{
 const matrix:[Partial<BotStageEvidence>,string,string][]=[
 [{status:'failed',runtime_error:'container_start_failed',callback_ms:null},'startup_failed','health'],
 [{status:'failed',failure_code:'runtime_unavailable',callback_ms:null},'callback_missing','health'],
 [{status:'failed',failure_code:'admission_refused'},'provider_denied','activity'],
 [{heartbeat_ms:now-121000},'capture_stalled','health'],
 [{status:'failed',failure_code:'processing_failed',failure_stage:'upload'},'upload_failed','health'],
 [{status:'processing',ended_ms:now-301000,processing_ms:null},'processing_failed','health'],
 [{status:'stopped'},'cancelled','activity'] ];
 for(const [patch,code,route] of matrix){const r=(await buildBotSourceReceipts(window([run(patch)])))[0];assert.equal(r.code,code);assert.equal(cfRoute(r).destination,route);}
});

test('two sensors/replayed revisions share the existing platform cause and cannot double-count one run',async()=>{
 const r=run({status:'failed',runtime_error:'runtime_health_failed',callback_ms:null});const rows=await buildBotSourceReceipts(window([r,{...r,revision:0},{...r,revision:1}]));
 assert.equal(rows.length,1);assert.equal(rows[0].count,1);assert.equal(cfRoute(rows[0]).subject,'meeting_bot:start_failed');
 const preview=(await buildBotSourceReceipts(window([r],{script:'studioos-meeting-bot-preview'})))[0];assert.equal(cfRoute(preview).destination,'preview');assert.notEqual(cfRoute(preview).subject,'meeting_bot:start_failed');
});

test('only a fresh qualifying final receipt or verified failed stage can recover; deploy/exit/old success cannot',async()=>{
 const episode={component:'upload' as const,provider:'zoom' as const,opened_ms:now-10000,version:'a'.repeat(40)};
 const good=run({status:'done',ended_ms:now-5000,final_receipt:true});
 for(const patch of [{final_receipt:null},{ended_ms:now-11000},{runtime_version:'b'.repeat(40)}])assert.equal((await buildBotSourceReceipts(window([{...good,...patch}],{episodes_complete:true,openEpisodes:[episode]}))).some(r=>r.state==='recovered'),false);
 assert.equal((await buildBotSourceReceipts(window([good],{openEpisodes:[episode]}))).some(r=>r.state==='recovered'),false,'partial episode inventory cannot close an incident');
 assert.equal((await buildBotSourceReceipts(window([good],{episodes_complete:true,openEpisodes:[episode]}))).some(r=>r.state==='recovered'),true);
});

test('shared startup cause cannot close while another affected provider fails or lacks recovery evidence',async()=>{
 const episodes=[{component:'startup' as const,provider:'zoom' as const,opened_ms:now-10000,version:null},{component:'startup' as const,provider:'google_meet' as const,opened_ms:now-10000,version:null}];
 const good=run({status:'done',ended_ms:now-5000,final_receipt:true});const bad=run({key:'second-private-uid',provider:'google_meet',status:'failed',runtime_error:'container_start_failed'});
 for(const runs of [[good],[good,bad]])assert.equal((await buildBotSourceReceipts(window(runs,{episodes_complete:true,openEpisodes:episodes}))).some(r=>r.state==='recovered'),false);
});

test('unreadable/capped ledger remains unknown; preflight contains presence only and does not contact a provider',async()=>{
 const p=botPrerequisiteReport({MEETING_BOT:'on',MEETING_BOT_SECRET:'private-secret-do-not-disclose'.repeat(2),APP_URL:'https://app.axal.vc'} as any);
 assert.equal(p.checks.host_binding,false);assert.equal(p.verification,'presence_only');assert.doesNotMatch(JSON.stringify(p),/private-secret|https:/);
 const report=await readBotSourceEvidence({MEETING_BOT:'on',DB:{prepare(){throw Error('private diagnostic');}}} as any,now);
 assert.equal(report.state,'unknown');assert.equal(report.receipts[0].state,'unknown');assert.doesNotMatch(JSON.stringify(report),/private diagnostic/);
});

test('mutations: denial urgency, duplicate count, final-receipt proof and freshness must protect real journeys',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cf-bot-5674-'));let source=readFileSync(new URL('../src/services/cloudflareBotHealth.ts',import.meta.url),'utf8');
 for(const name of ['meetingBots','meetingBotStartup','cloudflareSourceReceipt'])source=source.replaceAll(`'./${name}'`,JSON.stringify(new URL(`../src/services/${name}.ts`,import.meta.url).href));
 const variants:[string,string,string,(f:typeof buildBotSourceReceipts)=>Promise<void>][]=[
 ['denial',"code:'provider_denied',state:'activity'","code:'provider_denied',state:'firing'",async f=>{assert.equal(cfRoute((await f(window([run({status:'failed',failure_code:'admission_refused'})])))[0]).destination,'activity');}],
 ['duplicates','const rows=[...latest.values()]','const rows=w.runs',async f=>{const r=run();assert.equal((await f(window([r,r])))[0].count,1);}],
 ['proof',"&&r.final_receipt===true",'',async f=>{const r=run({status:'done',ended_ms:now,final_receipt:null});assert.equal((await f(window([r],{episodes_complete:true,openEpisodes:[{component:'upload',provider:'zoom',opened_ms:now-1,version:null}]}))).some(r=>r.state==='recovered'),false);}],
 ['freshness','&&r.ended_ms>=e.opened_ms','',async f=>{const r=run({status:'done',ended_ms:now-100,final_receipt:true});assert.equal((await f(window([r],{episodes_complete:true,openEpisodes:[{component:'upload',provider:'zoom',opened_ms:now-1,version:null}]}))).some(r=>r.state==='recovered'),false);}]
 ];
 try{for(const [label,before,after,journey] of variants){assert.ok(source.includes(before));const p=join(dir,label+'.ts');writeFileSync(p,source.replaceAll(before,after));const broken=(await import(pathToFileURL(p).href)).buildBotSourceReceipts;await assert.rejects(journey(broken),'must kill '+label);}}
 finally{rmSync(dir,{recursive:true,force:true});}
});
