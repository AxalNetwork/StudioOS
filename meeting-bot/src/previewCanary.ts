/** D5675: provider-free callback from the actual preview runtime image; no start/join/invite/recording command. */
import { signRequest } from './callback.ts';
export async function runPreviewCallback(input:{target:string;job:Record<string,unknown>;key:string},send:typeof fetch=fetch){
  const u=new URL(input.target),j=input.job;
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||!/^studioos-meeting-bot-preview\.[a-z0-9-]+\.workers\.dev$/.test(u.hostname)
    ||j.audience!=='preview'||j.script!=='studioos-meeting-bot-preview'||j.op!=='callback'||u.pathname!==`/canary/${j.id}/callback`||!(/^[a-f0-9]{64}$/).test(input.key))throw Error('invalid_preview_target');
  const raw=JSON.stringify(j),headers=await signRequest(input.key,u.pathname,raw,Date.now());
  const r=await send(u,{method:'POST',body:raw,headers:{...headers,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok||Number(r.headers.get('content-length')||0)>1024)throw Error('callback_refused');
  if(!r.body)throw Error('callback_refused');const reader=r.body.getReader();let rawAck='';
  try{for(;;){const x=await reader.read();if(x.done)break;rawAck+=new TextDecoder().decode(x.value);if(rawAck.length>1024){await reader.cancel();throw Error('callback_refused');}}}finally{reader.releaseLock();}
  const ack=JSON.parse(rawAck) as {accepted?:unknown};if(ack.accepted!==true)throw Error('callback_refused');
}
if(import.meta.url===`file://${process.argv[1]}`){
  let raw='';try{for await(const b of process.stdin){raw+=b;if(Buffer.byteLength(raw)>2048)throw Error('input_limit');}await runPreviewCallback(JSON.parse(raw));}
  catch{process.exitCode=1;}
}
