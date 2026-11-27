// D5671: independent read-only heartbeat evaluation; no private provider response, URL or credential is logged.
export function cloudflareHeartbeat(status,now,{maintenance=false,maximumAgeMs=900000,maximumPendingAgeMs=600000}={}) {
  if(maintenance===true)return {state:'maintenance'};
  if(!Number.isFinite(now)||!Number.isFinite(maximumAgeMs)||maximumAgeMs<=0||!Number.isFinite(maximumPendingAgeMs)||maximumPendingAgeMs<=0||status?.enabled!==true)return {state:'unknown'};
  if(!Number.isFinite(status.lastScheduledAt)||status.lastScheduledAt<1||status.lastScheduledAt>now)return {state:'unknown'};
  if(now-status.lastScheduledAt>maximumAgeMs)return {state:'missed_heartbeat'};
  const s=status.summary;if(!s||!Number.isSafeInteger(s.undeliveredIntents)||s.undeliveredIntents<0||!Number.isSafeInteger(s.unbatched)||s.unbatched<0)return {state:'unknown'};
  if(s.undeliveredIntents+s.unbatched>0){if(!Number.isFinite(s.oldestUndeliveredAgeMs)||s.oldestUndeliveredAgeMs<0)return {state:'unknown'};if(s.oldestUndeliveredAgeMs>maximumPendingAgeMs)return {state:'delivery_delayed'}}
  return {state:'healthy'};
}
export async function readCloudflareHeartbeat({url,secret,fetchImpl=fetch,now=Date.now}) {
  let target;try{target=new URL(url)}catch{return {state:'unknown'}}
  if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||target.pathname!=='/status'||!/^[-a-z0-9]+\.[-a-z0-9]+\.workers\.dev$/.test(target.hostname)||typeof secret!=='string'||secret.length<32)return {state:'unknown'};
  try{
    const response=await fetchImpl(target.href,{headers:{'cf-observer-auth':secret},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)return {state:'unknown'};
    const reader=response.body?.getReader();if(!reader)return {state:'unknown'};const chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32000){await reader.cancel();return {state:'unknown'}}chunks.push(value)}
    const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length}
    return cloudflareHeartbeat(JSON.parse(new TextDecoder().decode(bytes)),now());
  }catch{return {state:'unknown'}}
}
