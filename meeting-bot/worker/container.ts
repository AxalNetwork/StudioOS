/** D886 B8: private container host. B1 alone owns consent, billing and status. */
import type { Env } from '../../cloudflare-worker/src/types';
import { runtimeHeaders, runtimeKey, runtimeOrigin, runtimeUid, type RuntimeStart } from '../../cloudflare-worker/src/services/meetingBotRuntime';

interface Lease { uid: string; deadline: number; funded: number; fingerprint: string; started: boolean; stopped: boolean; stopAt?:number }
const reply = (status: number, code: string) => Response.json({code},{status});
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const pause = () => new Promise(resolve=>setTimeout(resolve,100));
export class MeetingBotContainer implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  constructor(state: DurableObjectState, env: Env) { this.state=state; this.env=env; }
  async fetch(request: Request): Promise<Response> {
    const result = await this.state.blockConcurrencyWhile(async(): Promise<Response | (() => Promise<Response>)>=>{
      try {
        const container=this.state.container;
        if (!container) return reply(503,'container_unavailable');
        const path=new URL(request.url).pathname;
        if (request.method==='GET' && path==='/health') return Response.json({running:container.running});
        if (request.method!=='POST' || !['/start','/stop','/heartbeat'].includes(path)) return reply(404,'not_found');
        const raw=await request.text();
        if (raw.length>16_384) return reply(413,'invalid_command');
        let body;
        try { body=JSON.parse(raw); } catch { return reply(400,'invalid_command'); }
        if (!body || !runtimeUid(body.uid)) return reply(400,'invalid_command');
        let lease=await this.state.storage.get<Lease>('lease');
        if (lease && lease.uid!==body.uid) return reply(409,'run_mismatch');
        if (path==='/stop') {
          lease=lease ?? {uid:body.uid,deadline:Date.now(),funded:Date.now(),fingerprint:'',started:false,stopped:false};
          // Tombstone first: a delayed/replayed start can never undo Stop.
          lease.stopped=true;
          lease.stopAt ??= Date.now()+30_000;
          await this.state.storage.put('lease',lease);
          if (container.running) {
            await this.state.storage.setAlarm(lease.stopAt);
            return async () => {
              try { await this.command('/stop',{uid:body.uid},1000); } catch { /* SIGTERM is the fallback. */ }
              // SIGTERM uses B2's same bounded leave/upload drain, never a hard kill.
              container.signal(15);
              return reply(200,'stop_requested');
            };
          }
          return reply(200,'stop_requested');
        }
        if (lease?.stopped) return reply(409,'run_stopped');
        if (lease && Date.now()>=Math.min(lease.deadline,lease.funded)+30_000) {
          await this.destroy(lease); return reply(409,'run_expired');
        }
        if (path==='/heartbeat') {
          if (!lease?.started || !container.running) return reply(409,'runtime_lost');
          if (body.deadline_at!==lease.deadline || !integer(body.budget_deadline_at) || body.budget_deadline_at<=Date.now()
            || body.budget_deadline_at<lease.funded || body.budget_deadline_at>lease.deadline) return reply(400,'invalid_lease');
          lease.funded=body.budget_deadline_at;
          await this.state.storage.put('lease',lease);
          await this.arm(lease); return reply(200,'alive');
        }
        if (!['zoom','google_meet','teams'].includes(body.platform) || ![30,120].includes(body.limit_minutes)
          || !integer(body.deadline_at) || body.deadline_at<=Date.now() || body.deadline_at>Date.now()+body.limit_minutes*60_000
          || !integer(body.budget_deadline_at) || body.budget_deadline_at<=Date.now() || body.budget_deadline_at>body.deadline_at
          || typeof body.meeting_url!=='string' || body.meeting_url.length>2048 || typeof body.notice!=='string' || body.notice.length>4096
          || !(body.venture_name===null || typeof body.venture_name==='string' && body.venture_name.length<=500)) return reply(400,'invalid_command');
        const input: RuntimeStart={uid:body.uid,platform:body.platform,meeting_url:body.meeting_url,limit_minutes:body.limit_minutes,
          deadline_at:body.deadline_at,budget_deadline_at:body.budget_deadline_at,notice:body.notice,venture_name:body.venture_name};
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
        const fingerprint=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
        if (lease) {
          if (lease.fingerprint!==fingerprint) return reply(409,'run_mismatch');
          // Restart would reset B2's sequence/capture cursor. Refuse it until a
          // persisted resume contract exists, including after DO reconstruction.
          return lease.started && container.running ? reply(200,'already_started') : reply(409,'runtime_lost');
        }
        if (container.running) return reply(409,'runtime_busy');
        const image=container.images.runtime;
        if (!image) return reply(503,'image_unavailable');
        const key=await runtimeKey(this.env.MEETING_BOT_SECRET ?? '',body.uid),origin=runtimeOrigin(this.env);
        lease={uid:body.uid,deadline:body.deadline_at,funded:body.budget_deadline_at,fingerprint,started:false,stopped:false};
        await this.state.storage.put('lease',lease);
        try {
          container.start({image,instance:'standard-2',enableInternet:true,
            env:{MEETING_BOT_SECRET:key,MEETING_BOT_CALLBACK_ORIGIN:origin,PORT:'8080'}});
          this.state.waitUntil(container.monitor().catch(()=>{}));
          await this.arm(lease);
          // Boot/HTTP waits must run outside the critical section so Stop can
          // persist its tombstone immediately, even while the process is cold.
          return async () => {
            try {
              await this.command('/start',input,7500);
              return await this.state.blockConcurrencyWhile(async () => {
                const current=await this.state.storage.get<Lease>('lease');
                if (!current || current.stopped) return reply(409,'run_stopped');
                current.started=true;await this.state.storage.put('lease',current);
                return reply(202,'started');
              });
            } catch {
              await this.state.blockConcurrencyWhile(async()=>{
                const current=await this.state.storage.get<Lease>('lease');
                if (current && !current.stopped) await this.destroy(current);
              });
              return reply(503,'runtime_unavailable');
            }
          };
        } catch { await this.destroy(lease); return reply(503,'runtime_unavailable'); }
      } catch { return reply(503,'runtime_unavailable'); }
    });
    return typeof result === 'function' ? result() : result;
  }
  private async command(path: string, body: {uid:string}, timeout: number) {
    const port=this.state.container!.getTcpPort(8080),raw=JSON.stringify(body);
    const key=await runtimeKey(this.env.MEETING_BOT_SECRET ?? '',body.uid),until=Date.now()+timeout;
    do {
      if (path==='/start' && (await this.state.storage.get<Lease>('lease'))?.stopped) throw new Error('command_refused');
      try {
        const response=await port.fetch(new Request(`http://runtime.internal${path}`,{method:'POST',body:raw,
          headers:await runtimeHeaders(key,path,raw),signal:AbortSignal.timeout(Math.max(1,Math.min(750,until-Date.now())))}));
        if (response.ok) return;
        // A command refusal (including unpublished notice) is final, not cold start.
        throw new Error('command_refused');
      } catch (e) {
        if (e instanceof Error && e.message==='command_refused') throw e;
        if (Date.now()>=until) break;
        await pause();
      }
    } while (Date.now()<until);
    throw new Error('runtime_unavailable');
  }
  private async arm(lease: Lease) {
    const end=Math.min(lease.deadline,lease.funded)+30_000;
    await this.state.storage.setAlarm(end);
    await this.state.container!.setInactivityTimeout(Math.max(1,Math.min(120_000,end-Date.now())));
  }
  private async destroy(lease: Lease) {
    await this.state.storage.put('lease',{...lease,stopped:true});
    await this.state.container?.destroy();
  }
  async alarm() {
    await this.state.blockConcurrencyWhile(async()=>{
      const lease=await this.state.storage.get<Lease>('lease');
      if (!lease) return;
      if (lease.stopped || Date.now()>=Math.min(lease.deadline,lease.funded)+30_000) await this.destroy(lease);
      else await this.arm(lease);
    });
  }
}
