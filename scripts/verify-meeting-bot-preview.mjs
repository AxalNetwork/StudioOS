#!/usr/bin/env node
/** D5675: gate normal promotion on an authenticated receipt from the exact deployed preview revision; never sends Slack or starts a meeting. */
import { writeFileSync } from 'node:fs';
import { randomBytes,randomUUID } from 'node:crypto';
import { previewOrigin,previewKey,validPreviewReceipt,previewPromotionEligible } from '../meeting-bot/worker/previewCanary.ts';
import { signRequest } from '../meeting-bot/src/callback.ts';
const started=Date.now(),output=process.env.PREVIEW_CANARY_RECEIPT||'/tmp/meeting-bot-preview-receipt.json';
const revision=process.env.GITHUB_SHA||'';
const mode = process.argv[2];
const settingsOnly = mode === '--check-settings';
const preflight = settingsOnly || mode === '--preflight';
let evidence={version:1,audience:'preview',script:'studioos-meeting-bot-preview',revision:/^[a-f0-9]{40}$/.test(revision)?revision:null,state:'fail',stage:'preflight',elapsed_ms:0};
try{
 const origin=previewOrigin(process.env.MEETING_BOT_PREVIEW_ORIGIN),root=process.env.MEETING_BOT_PREVIEW_SECRET||'';
 if (process.argv.length > 3 || (mode !== undefined && !preflight)) throw Error('invalid_arguments');
 // Before candidate admission GitHub supplies only the presence of the signing secret.
 // Preflight on an admitted candidate and the live canary both require the actual key.
 const invalidSettings = [];
 if (!origin) invalidSettings.push('MEETING_BOT_PREVIEW_ORIGIN');
 if (settingsOnly ? process.env.MEETING_BOT_PREVIEW_SECRET_PRESENT !== 'true' : root.length < 32) {
   invalidSettings.push('MEETING_BOT_PREVIEW_SECRET');
 }
 if (process.env.MEETING_BOT_PREVIEW_ROUTE_VERIFIED !== 'true') invalidSettings.push('MEETING_BOT_PREVIEW_ROUTE_VERIFIED');
 if (!evidence.revision) invalidSettings.push('GITHUB_SHA');
 if (invalidSettings.length) {
   evidence.invalid_settings = invalidSettings;
   console.error('Missing or invalid settings: ' + invalidSettings.join(', ') + '. See the owner-only deployment instructions in documentation/architecture/PRODUCTION.md.');
   throw Error('preview_prerequisite_missing');
 }
 if (preflight) {
   console.log(settingsOnly ? 'Preview settings present; signing key validation follows candidate admission.' : 'Preview prerequisites verified; no fixture started');
 } else {
 const job={version:1,audience:'preview',script:'studioos-meeting-bot-preview',id:randomUUID(),nonce:randomBytes(16).toString('hex'),revision,created_ms:Date.now(),op:'run'};
 const raw=JSON.stringify(job),headers=await signRequest(await previewKey(root,job,'run'),'/canary/run',raw,Date.now());
 evidence.stage='transport';const response=await fetch(origin+'/canary/run',{method:'POST',body:raw,headers:{...headers,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(180000)});
 if(!response.body)throw Error('preview_receipt_missing');let body='';const reader=response.body.getReader();
 try{for(;;){const x=await reader.read();if(x.done)break;body+=new TextDecoder().decode(x.value);if(body.length>2048){await reader.cancel();throw Error('preview_receipt_invalid');}}}finally{reader.releaseLock();}
 const receipt=await validPreviewReceipt(response.headers,body,root,job);if(!receipt)throw Error('preview_receipt_invalid');
 // The workflow artifact omits nonce/id/keys/headers/origin. A real Slack delivery receipt still belongs to #5665/#5671.
 evidence={version:1,audience:receipt.audience,script:receipt.script,revision:receipt.revision,state:receipt.state,stage:receipt.stage,elapsed_ms:receipt.elapsed_ms,image_digest:receipt.image_digest,cleaned:receipt.cleaned};
 if(!response.ok||!previewPromotionEligible(receipt))throw Error('preview_fixture_failed');
 console.log('[cf][preview][studioos-meeting-bot-preview][canary][recovered] exact revision verified; synthetic instance stopped');
 }
}catch{
 evidence.state='fail';evidence.elapsed_ms=Date.now()-started;process.exitCode=1;
 console.error('[cf][preview][studioos-meeting-bot-preview][canary][firing] normal promotion blocked; inspect restricted fixture evidence');
}finally{if(!preflight||process.exitCode===1)writeFileSync(output,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});}
