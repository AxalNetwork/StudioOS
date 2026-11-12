/** D5673: bounded metadata-only API reconciliation of exact script deployments/version uploads; no publish or application-health inference. */
import { CF_SCRIPTS, cfAudience, cfHash, parseCfReceipt, type CfReceipt, type CfScript, type CfSourceStore } from './cloudflareSourceReceipt';
type Deployment = { id:string; created_on:string; source?:string; versions:{version_id:string;percentage:number}[] };
type Version = { id:string; metadata:{created_on:string;source?:string} };
export type ReadCfApi = (path:string, query:Record<string,string|number>)=>Promise<{ result:unknown; result_info?:{total_pages?:number;total_count?:number} }>;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const time=(v:unknown)=>typeof v==='string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN;
const source=(s:unknown): CfReceipt['source']=>['wrangler','api','dashboard','rollback'].includes(String(s)) ? s as CfReceipt['source'] : 'unknown';
export const CF_REPLAY_MS=60*60_000, CF_FIRST_WINDOW_MS=24*60*60_000, CF_MAX_PAGES=20;
export function cfReadApi(account: string, token: string, transport: typeof fetch=fetch): ReadCfApi {
  if (!/^[a-f0-9]{32}$/.test(account) || !token.trim()) throw Error('cf_read_prerequisite_missing');
  const end=Date.now()+45000;
  return async(path,query)=>{
    if(Date.now()>=end)throw Error('cf_poll_budget_exhausted');
    if (!/^\/workers\/scripts\/(studioos|studioos-meeting-bot|studioos-meeting-bot-preview|studioos-tail)\/(deployments|versions)$/.test(path)) throw Error('cf_source_not_allowed');
    const url=new URL(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`);
    for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));
    const response=await transport(url,{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok||!response.body)throw Error('cf_source_unavailable');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    try { for(;;){const r=await reader.read();if(r.done)break;length+=r.value.byteLength;if(length>1024*1024){await reader.cancel();throw Error('cf_source_limit');}chunks.push(r.value);} }
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const data=JSON.parse(new TextDecoder().decode(bytes));if(data.success!==true)throw Error('cf_source_unavailable');return data;
  };
}
export async function reconcileCfScript(input:{script:CfScript;now:number;readApi:ReadCfApi;store:CfSourceStore;
  attribution?:(script:CfScript,deploymentId:string)=>Promise<CfReceipt['github']>}) {
  if(!CF_SCRIPTS.includes(input.script)||!Number.isSafeInteger(input.now)||input.now<0)throw Error('invalid_cf_source');
  const {script,now,readApi,store}=input,key=`deployments:${script}`,cursor=await store.read(key);
  if(cursor.through_ms>now)throw Error('cf_clock_regression');
  const since=Math.max(0,(cursor.through_ms || now-CF_FIRST_WINDOW_MS)-CF_REPLAY_MS),out:CfReceipt[]=[];
  const receipt=async (id:unknown,patch:Partial<CfReceipt>)=>parseCfReceipt({version:1,id:await cfHash([script,id]),script,audience:cfAudience(script),family:'deployment',component:'release',state:'observed',
    code:'not_verified',occurred_ms:now,observed_ms:now,count:1,denominator:null,window_start_ms:since,window_end_ms:now,versions:[],source:'unknown',github:null,revision:null,
    episode_key:await cfHash(['cf',cfAudience(script),script,'release',id]),owner:'release_engineering',...patch});
  let activeId=cursor.active_id,activeVersions=cursor.active_versions;
  try {
    const deployments:Deployment[]=[],versions:Version[]=[];
    const current=await readApi(`/workers/scripts/${script}/deployments`,{page:1,per_page:1});
    const head=(current.result as any)?.deployments?.[0] as Deployment|undefined;
    if(!head||!UUID.test(head.id)||!Number.isSafeInteger(time(head.created_on)))throw Error('cf_active_unknown');
    for(const kind of ['deployments','versions'] as const){
      let complete=false;const seen=new Set<string>();let lastPageTime=Infinity;
      for(let page=1;page<=CF_MAX_PAGES;page++){
        const q:Record<string,string|number>={page,per_page:100};if(kind==='deployments'){q.since=new Date(since).toISOString();q.until=new Date(now).toISOString();}
        const response=await readApi(`/workers/scripts/${script}/${kind}`,q);
        const rows=(response.result as any)?.[kind==='deployments'?'deployments':'items'];
        if(!Array.isArray(rows)||rows.length>100)throw Error('cf_source_invalid');
        let entirelyOld=rows.length>0;
        for(const row of rows){
          const at=time(kind==='deployments'?row.created_on:row.metadata?.created_on);
          if(!UUID.test(row.id)||!Number.isSafeInteger(at)||at>now+60000||seen.has(row.id))throw Error('cf_source_invalid');seen.add(row.id);
          if(at>=since){entirelyOld=false;(kind==='deployments'?deployments:versions).push(row);}
        }
        // Version pages have no time-range filter; only a verified descending page can finish on age.
        const times=rows.map(r=>time(kind==='deployments'?r.created_on:r.metadata?.created_on));
        if((times.length&&times[0]>lastPageTime)||times.some((t,i)=>i>0&&t>times[i-1]))throw Error('cf_source_order_unknown');
        if(times.length)lastPageTime=times[times.length-1];
        if(rows.length<100||response.result_info?.total_pages===page||(kind==='versions'&&entirelyOld)){complete=true;break;}
      }
      if(!complete)throw Error('cf_history_gap');
    }
    if(!deployments.some(d=>d.id===head.id))deployments.push(head);
    deployments.sort((a,b)=>time(a.created_on)-time(b.created_on)||a.id.localeCompare(b.id));
    const seenVersions=new Set<string>();let previousVersions:string[]=[];
    for(const d of deployments){
      if(!Array.isArray(d.versions)||!d.versions.length||d.versions.length>10||d.versions.some(v=>!UUID.test(v.version_id)||!Number.isFinite(v.percentage)||v.percentage<0||v.percentage>100)
        || Math.abs(d.versions.reduce((n,v)=>n+v.percentage,0)-100)>.001||new Set(d.versions.map(v=>v.version_id)).size!==d.versions.length)throw Error('cf_traffic_invalid');
      const github=await input.attribution?.(script,d.id)??null;
      if(time(d.created_on)>cursor.through_ms)for(const id of cursor.active_versions)seenVersions.add(id);
      const serving=d.versions.filter(v=>v.percentage>0).map(v=>v.version_id);
      const oldReturn=serving.length===1&&seenVersions.has(serving[0])&&previousVersions.length>0&&!previousVersions.includes(serving[0]);
      const code=d.source==='rollback'||oldReturn?'rollback':github?'traffic_changed':'unattributed';
      out.push(await receipt(['deploy',d.id],{code,occurred_ms:time(d.created_on),source:source(d.source),github,versions:d.versions.map(v=>({id:v.version_id,weight:v.percentage}))}));
      activeId=d.id;activeVersions=serving.sort();previousVersions=serving;for(const id of serving)seenVersions.add(id);
    }
    for(const v of versions)out.push(await receipt(['version',v.id],{code:'version_uploaded',occurred_ms:time(v.metadata.created_on),source:source(v.metadata.source),versions:[{id:v.id,weight:null}]}));
    const finalHead=await readApi(`/workers/scripts/${script}/deployments`,{page:1,per_page:1});
    if((finalHead.result as any)?.deployments?.[0]?.id!==head.id)throw Error('cf_snapshot_changed');
    activeId=head.id;activeVersions=head.versions.filter(v=>v.percentage>0).map(v=>v.version_id).sort();
    // No receipt claims probe, callback, Container readiness, archive success or exact intermediate traffic history.
    const saved=await store.commit(key,cursor.revision,{through_ms:now,active_id:activeId,active_versions:activeVersions},out);
    return {state:saved?'observed' as const:'raced' as const,receipts:saved?out.length:0};
  } catch(error) {
    const code=error instanceof Error&&error.message==='cf_history_gap'?'history_gap':'provider_unavailable';
    const gap=await receipt(['gap',cursor.revision,code],{component:'coverage',state:'unknown',code,episode_key:await cfHash(['cf',script,'release-observation'])});
    if(!await store.commit(key,cursor.revision,{through_ms:cursor.through_ms,active_id:cursor.active_id,active_versions:cursor.active_versions},[gap]))return {state:'raced' as const,receipts:0};
    return {state:'unknown' as const,receipts:1};
  }
}
