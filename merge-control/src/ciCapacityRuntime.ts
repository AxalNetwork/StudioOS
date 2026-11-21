/** D7973: unbound inactive capacity Durable Object entrypoint; deployment/permissions remain #7909. */
import { DurableObject } from 'cloudflare:workers';
import { CiCapacity, SqlCapacityStore } from './ciCapacity.ts';
import { authenticateCapacity, capacityBearer, capacityBody, capacityPlatformFetch } from './ciCapacityAuth.ts';
import { capacityGithubClient, GithubCapacityPorts } from './ciCapacityGithub.ts';
import type { CapacityConfig } from './ciCapacityGithub.ts';
import { CapacityOutbox } from './ciCapacityOutbox.ts';
import { CapacityTransport, capacityIdentityLane } from './ciCapacityTransport.ts';
import { CI_CAPACITY_BUDGETS } from './lib/ciCapacityPolicy.ts';
import { CapacityIssuerKeys, CapacityRequestBudget } from './lib/ciCapacityAuthPolicy.ts';
import type { CapacityBudgetStore, CapacityBudgetWindow } from './lib/ciCapacityAuthPolicy.ts';
import { ownerAuthorized } from './webhook.ts';
import type { Env } from './types.ts';
/** Prepared contract only: no binding, migration, route or live variable is added to wrangler. */
export type CapacityEnv = Pick<Env,'REPOSITORY'|'GITHUB_APP_ID'|'GITHUB_INSTALLATION_ID'|'GITHUB_APP_PRIVATE_KEY'> & {
  CAPACITY_OWNER_TOKEN?: string; CAPACITY_AUDIENCE?: string; CAPACITY_ENABLED?: string;
  CAPACITY_CONFIG?: string;
};
type Settings = CapacityConfig & { maxExternalWorkerShards: number; maxIncludedWorkerShards: number; appId: number; publication: 'pilot'|'full-suite' };
/** D8011: one canonical window, committed atomically before accepting any reservation. */
export class SqlCapacityBudgetStore implements CapacityBudgetStore {
  private storage: Pick<DurableObjectStorage, 'sql'|'transactionSync'>;
  constructor(storage: Pick<DurableObjectStorage, 'sql'|'transactionSync'>) {
    this.storage = storage;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_auth_budget (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)');
  }
  async update(decide: Parameters<CapacityBudgetStore['update']>[0]): Promise<boolean> {
    return this.storage.transactionSync(() => {
      const row = this.storage.sql.exec<{state:string}>('SELECT state FROM capacity_auth_budget WHERE id = 1').toArray()[0];
      const decoded:unknown=row?JSON.parse(row.state):null;
      if(row&&(!decoded||typeof decoded!=='object'||Array.isArray(decoded)))throw new Error('capacity_budget_state_invalid');
      const next = decide(decoded as CapacityBudgetWindow|null);
      this.storage.sql.exec('INSERT INTO capacity_auth_budget (id,state) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state = excluded.state', JSON.stringify(next.state));
      return next.accepted;
    });
  }
}
export class CapacityControl extends DurableObject<CapacityEnv> {
  private serial: Promise<unknown> = Promise.resolve();
  private store: SqlCapacityStore;
  private keys: CapacityIssuerKeys;
  private budget: CapacityRequestBudget;
  constructor(ctx: DurableObjectState, env: CapacityEnv) {
    super(ctx,env); this.store=new SqlCapacityStore(ctx.storage);
    this.keys = new CapacityIssuerKeys(capacityPlatformFetch);
    this.budget = new CapacityRequestBudget(new SqlCapacityBudgetStore(ctx.storage));
  }
  private ordered<T>(fn:()=>Promise<T>):Promise<T>{const result=this.serial.then(fn);this.serial=result.catch(()=>undefined);return result;}
  private async enabled(){return this.env.CAPACITY_ENABLED==='true'&&(await this.ctx.storage.get<boolean>('capacity-kill'))===false;}
  private settings():Settings {
    const settings=JSON.parse(this.env.CAPACITY_CONFIG??'null') as Settings|null;
    if(!settings||settings.repository!==this.env.REPOSITORY||!Number.isSafeInteger(settings.appId)||settings.appId<=0||!['pilot','full-suite'].includes(settings.publication))throw new Error('capacity_configuration_missing');
    return settings;
  }
  private async components() {
    const config=this.settings(), api=await capacityGithubClient(this.env,capacityPlatformFetch),ports=new GithubCapacityPorts(api,config);
    const parent=ports.parent.bind(ports),dispatch=ports.dispatch.bind(ports);
    ports.parent=async input=>await this.enabled()?parent(input):false;
    ports.dispatch=async attempt=>{if(!await this.enabled())throw new Error('capacity_disabled');return dispatch(attempt);};
    const capacity=new CiCapacity(this.store,ports,this.env.REPOSITORY,{version:1,maxExternalWorkerShards:config.maxExternalWorkerShards,maxIncludedWorkerShards:config.maxIncludedWorkerShards,minimumHostedWorkerShards:1,approvedGroupId:config.approvedGroupId,budgets:{...CI_CAPACITY_BUDGETS}});
    return {capacity,config,transport:new CapacityTransport(capacity,config,()=>this.enabled(),()=>this.ctx.storage.setAlarm(Date.now()+1000))};
  }
  async fetch(request:Request):Promise<Response>{
    const path=new URL(request.url).pathname;
    try{
      if(path==='/capacity/switch'&&request.method==='POST'){
        if(!ownerAuthorized(request,this.env.CAPACITY_OWNER_TOKEN))return new Response('unauthorized',{status:401});
        return await this.ordered(async()=>{
          const body=JSON.parse(new TextDecoder().decode(await capacityBody(request.body,1024)));
          if(typeof body?.kill!=='boolean')return new Response('invalid switch',{status:400});
          // Recovery alarm precedes revocation. Once revoked, no receipt lookup or dispatch can pass.
          await this.ctx.storage.setAlarm(Date.now()+1000);await this.ctx.storage.put('capacity-kill',body.kill);
          return Response.json({kill:body.kill,enabled:await this.enabled()});
        });
      }
      if(path==='/capacity/status'&&request.method==='GET'){
        if(!ownerAuthorized(request,this.env.CAPACITY_OWNER_TOKEN))return new Response('unauthorized',{status:401});
        return await this.ordered(async()=>Response.json({enabled:await this.enabled(),pending:this.store.pending().length}));
      }
      if(request.method!=='POST'||!['/capacity/submit','/capacity/receipt'].includes(path))return new Response('not found',{status:404});
      if(this.env.CAPACITY_ENABLED!=='true')return Response.json({error:'capacity_disabled'},{status:503});
      const token=capacityBearer(request),config=this.settings();
      // Admission precedes body reads and ordered work, so unauthenticated waits cannot queue ahead of alarms.
      const result=await this.budget.run(
        async()=>{
          if(!await this.enabled())throw new Error('capacity_disabled');
          return authenticateCapacity(request,this.env.CAPACITY_AUDIENCE??'',this.env.REPOSITORY,capacityPlatformFetch,Date.now,this.keys);
        },
        identity=>{
          const lane=capacityIdentityLane(identity,config);
          return path===`/capacity/${lane}`?lane:null;
        },
        async identity=>{
          if(!await this.enabled())throw new Error('capacity_disabled');
          const body=JSON.parse(new TextDecoder().decode(await capacityBody(request.body,path.endsWith('/submit')?9*1024*1024:4096)));
          return this.ordered(async()=>{
            if(!await this.enabled())throw new Error('capacity_disabled');
            const {transport}=await this.components();
            return path.endsWith('/submit')?transport.submit(body,identity):transport.receipt(body,identity);
          });
        },
        path==='/capacity/receipt'?{token,ownedReceipt:result=>'active' in result&&result.active===true&&result.receipt!==null}:undefined,
      );
      return Response.json(result);
    }catch(error){
      if(error instanceof Error&&error.message==='capacity_disabled')return Response.json({error:'capacity_disabled'},{status:503});
      if(error instanceof Error&&/^capacity_(?:auth|work)_limited$/.test(error.message))return new Response('rate limited',{status:429});
      console.error(JSON.stringify({component:'ci-capacity',event:'request-refused'}));
      return Response.json({error:'capacity_evidence_unavailable'},{status:403});
    }
  }
  alarm():Promise<void>{return this.ordered(async()=>{
    // The alarm survives an exception or eviction, including during publication or an ambiguous dispatch.
    await this.ctx.storage.setAlarm(Date.now()+15000);
    if(this.store.count()===0){await this.ctx.storage.deleteAlarm();return;}
    const {capacity,config}=await this.components();
    const outbox=new CapacityOutbox(this.ctx.storage,await capacityGithubClient(this.env,capacityPlatformFetch),config);
    const next=await capacity.tick();
    const publication=await outbox.publish(this.store,id=>capacity.status(id),config.publication);
    if(next===null&&!publication)await this.ctx.storage.deleteAlarm();
  });}
}
