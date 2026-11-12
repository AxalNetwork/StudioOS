#!/usr/bin/env node
/** D5676: independent external metadata check; provider/query failure is unknown. Shared #5665/#5668 infrastructure owns delivery and missed-process fallback. */
import { writeFileSync } from 'node:fs';
import { cfHash,parseCfReceipt } from '../cloudflare-worker/src/services/cloudflareSourceReceipt.ts';
import { archiveMac,boundedArchiveText } from '../cloudflare-worker-tail/src/protocol.ts';
const path='/check',raw=JSON.stringify({opened_ms:null}),now=Date.now();let report;
try{
 const target=new URL(process.env.ARCHIVE_OBSERVER_ORIGIN||''),secret=process.env.ARCHIVE_READER_SECRET||'';
 if(target.protocol!=='https:'||target.username||target.password||!/^studioos-archive-observer\.[a-z0-9-]+\.workers\.dev$/.test(target.hostname)||target.pathname!=='/'||target.search||target.hash||secret.length<32)throw Error('observer_unconfigured');
 const response=await fetch(target.origin+path,{method:'POST',body:raw,redirect:'error',headers:{'x-archive-timestamp':String(now),'x-archive-signature':await archiveMac(secret,path,raw,now)},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('observer_unavailable');report=JSON.parse(await boundedArchiveText(response,65536));
 if(!['firing','activity','recovered','unknown'].includes(report.state)||!Array.isArray(report.receipts))throw Error('observer_invalid');
 const receipts=report.receipts.map(parseCfReceipt);if(receipts.some(r=>r.script!=='studioos-tail'||r.family!=='archive'))throw Error('observer_scope_invalid');
 report={state:report.state,receipts,last_independently_verified_ms:Number.isSafeInteger(report.last_independently_verified_ms)?report.last_independently_verified_ms:null,coverage:['window_and_unverified','unverifiable'].includes(report.coverage)?report.coverage:'unverifiable'};
 if(report.state==='firing'||report.state==='unknown')process.exitCode=1;
}catch{const episode_key=await cfHash(['cf','prod','studioos-tail','archive']);report={state:'unknown',receipts:[parseCfReceipt({version:1,id:await cfHash([episode_key,'external-unknown',now]),script:'studioos-tail',audience:'prod',family:'archive',component:'archive',state:'unknown',code:'telemetry_unavailable',occurred_ms:now,observed_ms:now,count:0,denominator:0,window_start_ms:now,window_end_ms:now,versions:[],source:'unknown',github:null,revision:null,episode_key,owner:'storage_oncall'})]};process.exitCode=1;}
writeFileSync(process.env.ARCHIVE_CHECK_RESULT||'/tmp/tail-archive-check.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({source:'studioos-tail',state:report.state,coverage:report.coverage||'unverifiable'}));
