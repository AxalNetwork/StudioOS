/** D886 B2: B1's signed, monotonically sequenced event stream and one-use uploads.
 * All callers share one queue. A lost answer replays the same seq/body before
 * later events can pass it. No provider response text becomes an error/log.
 */
import type { BotEvent, CallbackTransport, FailureCode, StatusReport } from './types.ts';

export const CALLBACK_PATHS = Object.freeze({ events: 'events' });
export const REQUEST_TIMEOUT_MS = 10_000;
export class TransportError extends Error {
  readonly status: number;
  constructor(status: number) { super(`callback_${status}`); this.name='TransportError'; this.status=status; }
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function signRequest(key: string, path: string, body: string, nowMs: number): Promise<Record<string,string>> {
  const ts=String(Math.trunc(nowMs));
  const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(`v1:${ts}:POST:${path}:${body}`));
  return {'x-meeting-bot-timestamp':ts,'x-meeting-bot-signature':hex(sig)};
}
export interface HttpTransportOptions {
  /** Worker origin and exact /api/meeting-bots/<uuid>/ base, never a meeting URL. */
  readonly baseUrl: string; readonly runId: string; readonly key: string;
  readonly fetch?: typeof fetch; readonly now?: ()=>number; readonly timeoutMs?: number;
}
const failures: Record<FailureCode,string> = {
  not_admitted:'admission_refused',meeting_ended:'meeting_ended',link_invalid:'runtime_failed',
  platform_blocked:'runtime_failed',obf_unavailable:'runtime_failed',notice_failed:'notice_failed',processing_failed:'processing_failed',
};
type Pending = { seq: number; body: string; result?: Record<string,any> };
export function httpTransport(opts: HttpTransportOptions): CallbackTransport {
  let base: URL;
  try { base=new URL(opts.baseUrl); } catch {throw new TransportError(0);}
  if (!/^[a-f0-9-]{36}$/i.test(opts.runId) || opts.key.length<32 || base.protocol!=='https:' || base.username || base.password
    || base.search || base.hash || base.pathname!==`/api/meeting-bots/${opts.runId}/`) throw new TransportError(0);
  const doFetch=opts.fetch??fetch, now=opts.now??Date.now, timeout=opts.timeoutMs??REQUEST_TIMEOUT_MS;
  const endpoint=new URL(CALLBACK_PATHS.events,base);
  const closed=new AbortController();
  const operations=new Map<string,Pending>(), order: Pending[]=[];
  let recorded=false;
  let seq=0, heartbeat=0, tail: Promise<unknown>=Promise.resolve();
  const send=async(url: URL,init: RequestInit) => {
    let res: Response;
    try {res=await doFetch(url,{...init,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(timeout),closed.signal])});}catch{throw new TransportError(0);}
    return res;
  };
  const transmit=async(op: Pending, replay=false): Promise<Record<string,any>> => {
    if (op.result && !replay) return op.result;
    const headers={'content-type':'application/json',...await signRequest(opts.key,endpoint.pathname,op.body,now())};
    const response=await send(endpoint,{method:'POST',headers,body:op.body});
    let data: any;
    try {data=await response.json();}catch{throw new TransportError(response.ok?0:response.status);}
    // Only B1's explicit acknowledgement of an already-used chunk ticket is
    // success. An arbitrary 409 or a response to another event is not one.
    if (!response.ok && !(response.status===409 && JSON.parse(op.body).type==='chunk' && data?.code==='chunk_already_uploaded')) throw new TransportError(response.status);
    if (!data || typeof data!=='object') throw new TransportError(0);
    op.result=data;
    if(JSON.parse(op.body).type!=='chunk')op.body='';
    return data;
  };
  const event=(payload: Record<string,unknown>, key: string, replay=false) => {
    let op=operations.get(key);
    if (!op) {op={seq:++seq,body:JSON.stringify({seq,...payload})};operations.set(key,op);order.push(op);}
    const selected=op;
    const work=tail.then(async()=>{
      // Do not let a different payload reuse a seq whose acknowledgement was lost.
      for (const pending of order) {if (!pending.result) await transmit(pending);if(pending===selected) break;}
      return transmit(selected,replay);
    });
    tail=work.catch(()=>{});
    return work;
  };
  const lease=(data: Record<string,any>) => {
    const value=data.budget_deadline_at;
    if (!Number.isSafeInteger(value) || value<=now()) throw new TransportError(402);
    return value as number;
  };
  return {
    close(){closed.abort();},
    async status(report: StatusReport) {
      // B6 owns done after assembly; the runtime ends at processing after its
      // queued audio/events have been acknowledged.
      const status=report.reason==='interrupted'?'failed':report.state==='left'?(recorded?'processing':'stopped'):report.state;
      const failure_code=report.reason==='interrupted'?'runtime_failed':report.code?failures[report.code]:null;
      const data=await event({type:'status',status,failure_code},`status:${status}:${failure_code}`);
      if (status==='recording') recorded=true;
      return ['failed','processing','stopped'].includes(status)||data.duplicate===true&&data.budget_deadline_at==null?undefined:lease(data);
    },
    async heartbeat() {return lease(await event({type:'heartbeat'},`heartbeat:${++heartbeat}`));},
    async events(batch: readonly BotEvent[]) {
      for (const e of batch) {
        const payload=e.type==='roster'?{type:e.type,participants:e.participants.map(p=>({id:p.id,name:p.name,joined_ms:p.joined_ms,left_ms:p.left_ms}))}
          :{type:e.type,participant_id:e.participant_id,at_ms:e.at_ms};
        await event(payload,`event:${e.n}`);
      }
    },
    async putChunk(chunkSeq: number,wav: Uint8Array<ArrayBuffer>,startMs=0) {
      const key=`chunk:${chunkSeq}`;
      const data=await event({type:'chunk',chunk_seq:chunkSeq,size_bytes:wav.byteLength,start_ms:startMs},key,operations.has(key));
      if (data.code==='chunk_already_uploaded') return;
      let target: URL;
      try {target=new URL(data.upload_path,base);}catch{throw new TransportError(0);}
      if (target.origin!==base.origin || target.pathname!==`/api/meeting-bots/${opts.runId}/chunks/${chunkSeq}`
        || target.username || target.password || target.hash || !target.searchParams.get('token')) throw new TransportError(0);
      const response=await send(target,{method:'PUT',headers:{'content-type':'audio/wav','content-length':String(wav.byteLength)},body:wav});
      if (!response.ok) throw new TransportError(response.status);
    },
  };
}
