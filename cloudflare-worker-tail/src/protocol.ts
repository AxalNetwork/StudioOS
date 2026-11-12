/** D5676: private archive metadata protocol, independent of the R2 archive; no raw event body enters it. */
export type ArchiveNotice={version:1;source:'studioos-tail';batch_id:string;object_key:string;events:number;bytes:number;attempt:number;
 state:'received'|'retry'|'confirmed'|'exhausted';observed_ms:number;lost_events:number;markers:string[]};
export function archiveNotice(value:unknown):ArchiveNotice{
 const n=value as ArchiveNotice;
 if(!n||Object.keys(n).some(k=>!['version','source','batch_id','object_key','events','bytes','attempt','state','observed_ms','lost_events','markers'].includes(k))||n.version!==1||n.source!=='studioos-tail'
  ||!(/^[a-f0-9]{64}$/).test(n.batch_id)||!new RegExp(`^(?:\\d{4}/\\d{2}/\\d{2}/\\d{2}|undated)/${n.batch_id}\\.ndjson$`).test(n.object_key)
  ||!Number.isSafeInteger(n.events)||n.events<1||n.events>1000||!Number.isSafeInteger(n.bytes)||n.bytes<0||n.bytes>4*1024*1024
  ||!Number.isSafeInteger(n.attempt)||n.attempt<0||n.attempt>3||!['received','retry','confirmed','exhausted'].includes(n.state)||!Number.isSafeInteger(n.observed_ms)||n.observed_ms<0
  ||!Number.isSafeInteger(n.lost_events)||n.lost_events<0||n.lost_events>n.events||!Array.isArray(n.markers)||n.markers.length>16||n.markers.some(m=>!(/^[a-f0-9]{32}$/).test(m))||new Set(n.markers).size!==n.markers.length)throw Error('invalid_archive_notice');
 if((n.state==='received'&&n.attempt!==0)||(n.state==='exhausted'&&n.attempt!==3)||(n.state==='retry'&&(n.attempt<1||n.attempt>2))||(n.state==='confirmed'&&n.attempt<1))throw Error('invalid_archive_attempt');
 return n;
}
export async function archiveMac(secret:string,path:string,body:string,at:number){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`archive-v1:${at}:POST:${path}:${body}`));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function validArchiveMac(secret:string,headers:Headers,path:string,body:string,now=Date.now()){
 const ts=headers.get('x-archive-timestamp')||'',sig=headers.get('x-archive-signature')||'';
 if(secret.length<32||!/^\d{13}$/.test(ts)||Math.abs(now-Number(ts))>300000||!(/^[a-f0-9]{64}$/).test(sig))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,Uint8Array.from(sig.match(/../g)!,s=>parseInt(s,16)),new TextEncoder().encode(`archive-v1:${ts}:POST:${path}:${body}`));
}
export async function boundedArchiveText(input:{body:ReadableStream<Uint8Array>|null},max=2048){
 if(!input.body)throw Error('archive_body_missing');const r=input.body.getReader();let n=0;const chunks:Uint8Array[]=[];
 try{for(;;){const x=await r.read();if(x.done)break;n+=x.value.length;if(n>max){await r.cancel();throw Error('archive_body_limit');}chunks.push(x.value);}}finally{r.releaseLock();}
 const all=new Uint8Array(n);let at=0;for(const c of chunks){all.set(c,at);at+=c.length;}return new TextDecoder().decode(all);
}
