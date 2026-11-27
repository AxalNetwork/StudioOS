// D5671: authenticated, bounded Cloudflare ingress; only server-registered metadata reaches durable delivery.
import { cfAudience, cfReceiptSchema, cfRoute, parseCfReceipt } from '../cloudflare-worker/src/services/cloudflareSourceReceipt.ts';

export const BOT_RECEIPT_PATH = '/webhooks/cloudflare/meeting-bot';
const MAX_PAYLOAD_BYTES = 64000;
const hex = x => /^[a-f0-9]{32}$/.test(x || '');
const scripts = new Set(['studioos','studioos-meeting-bot','studioos-meeting-bot-preview','studioos-tail']);
const botScripts = new Set(['studioos-meeting-bot', 'studioos-meeting-bot-preview']);
const botStageSchema = cfReceiptSchema.pick({ component: true, code: true, provider: true });
const components = new Set(['runtime','http','latency','cron','queue-job','queue-agent','dlq-job','dlq-agent','workflow','d1','r2','do','recording','archive']);
const digest = async x => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)))].map(v=>v.toString(16).padStart(2,'0')).join('');
export async function authentic(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof header !== 'string' || header.length > 512) return false;
  const [a,b]=await Promise.all([digest(header),digest(secret)]); let mismatch=0;
  for(let i=0;i<a.length;i++) mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
  return mismatch===0;
}
export async function normalizeCloudflare(payload, config, now=Date.now()) {
  if (!hex(config?.accountId) || config.reviewed !== true || !Number.isFinite(now)) throw Error('registry_unapproved');
  const p=config.policies?.[payload.policy_id];
  if (!hex(payload.policy_id) || payload.account_id!==config.accountId || !p || p.summaryApproved!==true || p.sourceScopeVerified!==true || p.sensitivity!=='operational' || p.alertType!==payload.alert_type || !scripts.has(p.script) || !components.has(p.component) || !['prod','preview'].includes(p.environment) || (p.script==='studioos-meeting-bot-preview')!==(p.environment==='preview')) throw Error('source_unapproved');
  const phase=p.phaseMap?.[payload.alert_event];
  if (!['firing','repeat','recovery','observation'].includes(phase) || !hex(payload.alert_correlation_id) || !Number.isSafeInteger(payload.ts) || payload.ts<1 || payload.ts*1000>now+300000) throw Error('source_state_unknown');
  const episode=await digest(JSON.stringify([payload.policy_id,payload.alert_correlation_id]));
  return {schema:1,episode,key:await digest(JSON.stringify([episode,phase,payload.ts])),source:'cloudflare',script:p.script,environment:p.environment,component:p.component,phase,sourceAt:payload.ts*1000,observedAt:now,owner:p.environment==='preview'?'preview-owner':'platform-on-call',version:'not_recorded'};
}
export async function receiveCloudflare(request,{secret,config,accept,now=Date.now}) {
  if(request.method!=='POST') return new Response('method not allowed',{status:405});
  if(!await authentic(request.headers.get('cf-webhook-auth'),secret)) return new Response('unauthorized',{status:401});
  if(!request.headers.get('content-type')?.startsWith('application/json')) return new Response('unsupported payload',{status:415});
  let payload;
  try { payload = await readJson(request); }
  catch (error) {
    if (error.message === 'missing_payload') return new Response('missing payload', { status: 400 });
    if (error.message === 'payload_too_large') return new Response('payload too large', { status: 413 });
    return new Response('invalid notification', { status: 422 });
  }
  // Cloudflare Save and Test has only text: acknowledge connectivity without enqueueing or claiming Slack delivery.
  if(payload&&Object.keys(payload).length===1&&typeof payload.text==='string'&&payload.text.length<=1024)return Response.json({accepted:false,probe:true});
  let event;try{event=await normalizeCloudflare(payload,config,now())}catch{return new Response('unregistered or invalid notification',{status:422})}
  // Queue acceptance is not a Slack receipt. Fail visibly when durable acceptance fails.
  try{await accept(event)}catch{return new Response('durable delivery unavailable',{status:503})}
  return Response.json({accepted:true,key:event.key},{status:202});
}
async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw Error('missing_payload');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PAYLOAD_BYTES) {
      await reader.cancel();
      throw Error('payload_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function refusal(status, code) {
  return Response.json({ accepted: false, code }, { status });
}

/** D6734: project a signed recording receipt into D5671's existing delivery lanes. */
export async function receiveBotReceipt(request, { prodSecret, previewSecret, accept, now = Date.now }) {
  if (request.method !== 'POST') return refusal(405, 'method_not_allowed');
  const auth = request.headers.get('cf-webhook-auth');
  const [prod, preview] = await Promise.all([authentic(auth, prodSecret), authentic(auth, previewSecret)]);
  if (prod === preview) return refusal(401, 'unauthorized');
  if (!request.headers.get('content-type')?.startsWith('application/json')) return refusal(415, 'unsupported_payload');

  let payload;
  try { payload = await readJson(request); }
  catch (error) {
    if (error.message === 'missing_payload') return refusal(400, 'missing_payload');
    if (error.message === 'payload_too_large') return refusal(413, 'payload_too_large');
    return refusal(422, 'invalid_bot_receipt');
  }
  let receipt;
  try { receipt = parseCfReceipt(payload?.receipt); }
  catch { return refusal(422, 'invalid_bot_receipt'); }
  if (cfAudience(receipt.script) !== (prod ? 'prod' : 'preview')) return refusal(403, 'bot_audience_mismatch');
  if (receipt.family !== 'recording' || !botScripts.has(receipt.script)) {
    return refusal(422, 'unsupported_bot_receipt_source');
  }

  const route = cfRoute(receipt);
  if (Object.keys(payload).length !== Object.keys(route).length ||
      Object.entries(route).some(([key, value]) => key !== 'receipt' && payload[key] !== value)) {
    return refusal(422, 'invalid_bot_receipt_route');
  }

  const phase = receipt.state === 'firing' ? 'firing' : receipt.state === 'recovered' ? 'recovery' : 'observation';
  let event;
  try {
    event = validateCloudflare({
      schema: 1, key: receipt.id, episode: receipt.episode_key, source: 'cloudflare',
      script: receipt.script, environment: receipt.audience, component: 'recording',
      phase, sourceAt: receipt.occurred_ms, observedAt: now(),
      owner: prod ? 'platform-on-call' : 'preview-owner', version: 'not_recorded',
      botStage: { component: receipt.component, code: receipt.code, provider: receipt.provider },
    });
  } catch { return refusal(422, 'invalid_bot_receipt'); }

  try { await accept(event); }
  catch { return refusal(503, 'durable_delivery_unavailable'); }
  return Response.json({ accepted: true, key: event.key }, { status: 202 });
}

export function validateCloudflare(e) {
  if(e?.schema!==1 || !/^[a-f0-9]{64}$/.test(e.key||'') || !/^[a-f0-9]{64}$/.test(e.episode||'') || e.source!=='cloudflare' || !scripts.has(e.script) || !components.has(e.component) || !['prod','preview'].includes(e.environment) || (e.script==='studioos-meeting-bot-preview')!==(e.environment==='preview') || !['firing','repeat','recovery','observation'].includes(e.phase) || !Number.isSafeInteger(e.sourceAt) || e.sourceAt<1 || e.sourceAt>8640000000000000 || !Number.isFinite(e.observedAt) || e.observedAt<1 || e.observedAt>8640000000000000 || e.version!=='not_recorded' || e.owner!==(e.environment==='preview'?'preview-owner':'platform-on-call')) throw Error('event_invalid');
  if(Object.keys(e).some(k=>!['schema','episode','key','source','script','environment','component','phase','sourceAt','observedAt','owner','version','botStage'].includes(k)))throw Error('event_fields_refused');
  if (Object.hasOwn(e, 'botStage') &&
      (e.component !== 'recording' || !botScripts.has(e.script) || !botStageSchema.safeParse(e.botStage).success)) throw Error('invalid_bot_stage');
  return e;
}
export function cloudflareRow(e) {
  validateCloudflare(e);
  const stage = e.botStage ? ` stage:${e.botStage.component} outcome:${e.botStage.code} provider:${e.botStage.provider}` : '';
  return `[cf][${e.environment}][${e.script}][${e.component}][${e.phase}] source:cloudflare UTC:${new Date(e.sourceAt).toISOString()} version:${e.version} owner:${e.owner} count:not_recorded last-good:not_recorded${stage} event:${e.key}`;
}
