/** D7909: default-off capacity service; deployment, permissions and activation remain held. */
import { DurableObject } from 'cloudflare:workers';
import { CiCapacity, SqlCapacityStore, CAPACITY_RETENTION_MS } from './ciCapacity.ts';
import { authenticateCapacity, capacityBearer, capacityBody, capacityPlatformFetch } from './ciCapacityAuth.ts';
import { capacityGithubClient, capacityInventoryClient, GithubCapacityPorts } from './ciCapacityGithub.ts';
import type { CapacityConfig, CapacityExecutionResultReader } from './ciCapacityGithub.ts';
import { CapacityOutbox } from './ciCapacityOutbox.ts';
import { CapacityTransport, capacityIdentityLane } from './ciCapacityTransport.ts';
import { publicationSettled, publicationConsumer } from './ciCapacityRetention.ts';
import { pruneCapacityHistory } from './ciCapacityHistory.ts';
import { CI_CAPACITY_BUDGETS, validateCapacityPolicy } from './lib/ciCapacityPolicy.ts';
import { CapacityIssuerKeys, CapacityRequestBudget } from './lib/ciCapacityAuthPolicy.ts';
import type { CapacityBudgetStore, CapacityBudgetWindow } from './lib/ciCapacityAuthPolicy.ts';
import { CapacityReconciliation } from './ciCapacityReconciliation.ts';
import { ownerAuthorized } from './webhook.ts';
import type { Env } from './types.ts';
import { SqlCapacityResults } from './lib/ciCapacityResults.ts';
import { SqlCapacityCorrections } from './ciCapacityCorrections.ts';
/** Default-off service contract. Checked-in configuration does not grant live access or activate work. */
export type CapacityEnv = Pick<Env,'REPOSITORY'|'GITHUB_APP_ID'|'GITHUB_INSTALLATION_ID'|'GITHUB_APP_PRIVATE_KEY'> & {
  CAPACITY_OWNER_TOKEN?: string; CAPACITY_AUDIENCE?: string; CAPACITY_ENABLED?: string;
  CAPACITY_CONFIG?: string;
  CAPACITY_PUBLICATION?: string;
  CAPACITY_INVENTORY_TOKEN?: string;
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
  /** Inactive trusted-code port. No environment flag, request field or candidate artifact can supply it. */
  protected executionResultReader?: CapacityExecutionResultReader;
  private serial: Promise<unknown> = Promise.resolve();
  private store: SqlCapacityStore;
  private keys: CapacityIssuerKeys;
  private budget: CapacityRequestBudget;
  private results: SqlCapacityResults;
  private corrections:SqlCapacityCorrections;
  constructor(ctx: DurableObjectState, env: CapacityEnv) {
    super(ctx,env);
    this.results = new SqlCapacityResults(ctx.storage);
    this.corrections=new SqlCapacityCorrections(ctx.storage);
    const mode=()=>{try{const config=this.settings();
      new GithubCapacityPorts(async()=>{throw new Error('capacity_validation_only');},config);
      validateCapacityPolicy(this.policy(config));return config.publication;
    }catch{return null;}};
    const guard=publicationSettled(ctx.storage,mode),consumer=publicationConsumer(ctx.storage,mode);
    this.store=new SqlCapacityStore(ctx.storage,
      (request,superseded)=>this.results.pendingFailure(request.submission.requestId)?'owed':guard(request,superseded),
      {mode,evidence:(record,superseded)=>this.results.pendingFailure(record.submission.requestId)?'owed':consumer.evidence(record,superseded)});
    if(this.store.compactCount()===0)this.corrections.completeLegacy();
    this.keys = new CapacityIssuerKeys(capacityPlatformFetch);
    this.budget = new CapacityRequestBudget(new SqlCapacityBudgetStore(ctx.storage));
  }
  private ordered<T>(fn:()=>Promise<T>):Promise<T>{const result=this.serial.then(fn);this.serial=result.catch(()=>undefined);return result;}
  private async enabled(){return this.env.CAPACITY_ENABLED==='true'&&(await this.ctx.storage.get<boolean>('capacity-kill'))===false&&this.corrections.legacyReady();}
  private settings():Settings {
    const settings=JSON.parse(this.env.CAPACITY_CONFIG??'null') as Settings|null;
    if(!settings||settings.repository!==this.env.REPOSITORY||!Number.isSafeInteger(settings.appId)||settings.appId<=0||!['pilot','full-suite'].includes(settings.publication))throw new Error('capacity_configuration_missing');
    if(this.env.CAPACITY_PUBLICATION==='pilot'&&settings.publication!=='pilot')throw new Error('capacity_pilot_publication_only');
    if(settings.publication==='pilot'&&settings.maxIncludedWorkerShards!==0)throw new Error('capacity_pilot_included_disabled');
    return settings;
  }
  private policy(config:Settings){return {version:1 as const,maxExternalWorkerShards:config.maxExternalWorkerShards,
    maxIncludedWorkerShards:config.maxIncludedWorkerShards,minimumHostedWorkerShards:1,approvedGroupId:config.approvedGroupId,
    maxActiveRequests:config.publication==='pilot'?1:8,budgets:{...CI_CAPACITY_BUDGETS}};}
  private async components() {
    const config=this.settings(), api=await capacityGithubClient(this.env,capacityPlatformFetch);
    const inventoryApi=this.env.CAPACITY_INVENTORY_TOKEN?capacityInventoryClient(this.env,capacityPlatformFetch):undefined;
    const ports=new GithubCapacityPorts(api,config,Date.now,this.executionResultReader??(async(receipt,job)=>this.results.read(receipt,job,Date.now())),inventoryApi,config.publication==='pilot');
    const parent=ports.parent.bind(ports),dispatch=ports.dispatch.bind(ports);
    ports.parent=async input=>await this.enabled()?parent(input):false;
    ports.dispatch=async attempt=>{if(!await this.enabled())throw new Error('capacity_disabled');return dispatch(attempt);};
    const capacity=new CiCapacity(this.store,ports,this.env.REPOSITORY,this.policy(config),Date.now,id=>this.results.pendingFailure(id),id=>this.corrections.enqueue(id));
    return {capacity,config,ports,transport:new CapacityTransport(capacity,config,()=>this.enabled(),()=>this.ctx.storage.setAlarm(Date.now()+1000))};
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
      if((path==='/capacity/publications'&&request.method==='GET')||(path==='/capacity/reconcile'&&request.method==='POST')){
        if(!ownerAuthorized(request,this.env.CAPACITY_OWNER_TOKEN))return new Response('unauthorized',{status:401});
        const url=new URL(request.url);
        const input=request.method==='POST'?JSON.parse(new TextDecoder().decode(await capacityBody(request.body,1024))):null;
        return await this.ordered(async()=>{
          const config=this.settings();
          const review=new CapacityReconciliation(this.ctx.storage,this.store,this.results,config);
          if(request.method==='GET'){
            const id=url.searchParams.get('requestId');
            return Response.json(id===null?review.counts(url.searchParams.get('after')??''):review.inspect(id));
          }
          if(!input||input.mode!==config.publication||typeof input.requestId!=='string'||typeof input.fingerprint!=='string'
            ||!Number.isSafeInteger(input.checkId)||input.checkId<=0)return new Response('invalid reconciliation',{status:400});
          if(await this.ctx.storage.get<boolean>('capacity-kill')!==true)return new Response('drain required',{status:409});
          if(String(config.appId)!==this.env.GITHUB_APP_ID)return new Response('publication App mismatch',{status:409});
          const api=await capacityGithubClient(this.env,capacityPlatformFetch);
          await this.ctx.storage.setAlarm(Date.now()+1000);
          const adopted=await review.adopt(input.requestId,input.fingerprint,input.checkId,api);
          if(adopted)console.info(JSON.stringify({component:'ci-capacity',event:'check-adopted',requestId:input.requestId,mode:input.mode,checkId:input.checkId,fingerprint:input.fingerprint}));
          return Response.json({adopted},{status:adopted?200:409});
        });
      }
      if(path==='/capacity/status'&&request.method==='GET'){
        if(!ownerAuthorized(request,this.env.CAPACITY_OWNER_TOKEN))return new Response('unauthorized',{status:401});
        return await this.ordered(async()=>Response.json({enabled:await this.enabled(),pending:this.store.pending().length}));
      }
      if(request.method!=='POST'||!['/capacity/submit','/capacity/receipt','/capacity/outcome'].includes(path))return new Response('not found',{status:404});
      if(path!=='/capacity/outcome'&&this.env.CAPACITY_ENABLED!=='true')return Response.json({error:'capacity_disabled'},{status:503});
      const token=capacityBearer(request),config=this.settings();
      // Admission precedes body reads and ordered work, so unauthenticated waits cannot queue ahead of alarms.
      const result=await this.budget.run(
        async()=>{
          if(path!=='/capacity/outcome'&&!(await this.enabled()))throw new Error('capacity_disabled');
          return authenticateCapacity(request,this.env.CAPACITY_AUDIENCE??'',this.env.REPOSITORY,capacityPlatformFetch,Date.now,this.keys);
        },
        identity=>{
          const lane=capacityIdentityLane(identity,config);
          if(config.publication==='pilot'&&lane==='submit'&&identity.event_name!=='push')return null;
          return (path===`/capacity/${lane}`||(path==='/capacity/outcome'&&lane==='receipt'))?lane:null;
        },
        async identity=>{
          if(path!=='/capacity/outcome'&&!(await this.enabled()))throw new Error('capacity_disabled');
          const bodyLimit=path.endsWith('/submit')?9*1024*1024:(path.endsWith('/outcome')?8192:4096);
          const body=JSON.parse(new TextDecoder().decode(await capacityBody(request.body,bodyLimit)));
          return this.ordered(async()=>{
            if(path!=='/capacity/outcome'&&!(await this.enabled()))throw new Error('capacity_disabled');
            const {transport,ports}=await this.components();
            if(path.endsWith('/submit'))return transport.submit(body,identity);
            if(path.endsWith('/outcome'))return transport.outcome(body,identity,ports,this.results);
            return transport.receipt(body,identity);
          });
        },
        path==='/capacity/receipt'?{
          token,
          ownedReceipt:result=>('active' in result&&result.active===true&&result.receipt!==null),
        }:undefined,
      );
      return Response.json(result);
    }catch(error){
      if(error instanceof Error&&error.message==='capacity_disabled'){
        return Response.json({error:'capacity_disabled'},{status:503});
      }
      if(error instanceof Error&&/^capacity_(?:auth|work)_limited$/.test(error.message)){
        return new Response('rate limited',{status:429});
      }
      console.error(JSON.stringify({component:'ci-capacity',event:'request-refused'}));
      return Response.json({error:'capacity_evidence_unavailable'},{status:403});
    }
  }
  alarm():Promise<void>{return this.ordered(async()=>{
    // The alarm survives an exception or eviction, including during publication or an ambiguous dispatch.
    await this.ctx.storage.setAlarm(Date.now()+15000);
    const garbage=this.results.prune();
    // Pending negative authority fences both full and compact expiry before replay reaches it.
    this.store.prune(Date.now()-CAPACITY_RETENTION_MS);
    if(this.store.count()===0&&this.store.compactCount()===0){
      const publications=pruneCapacityHistory(this.ctx.storage,'publications');
      for(const row of this.corrections.page()){
        if(!this.results.pendingFailure(row.request_id))this.corrections.remove(row.seq);
        this.corrections.advance(row.seq);
      }
      if(!garbage&&!publications&&!this.corrections.pending())await this.ctx.storage.deleteAlarm();return;
    }
    const {capacity,config}=await this.components();
    const outbox=new CapacityOutbox(this.ctx.storage,await capacityGithubClient(this.env,capacityPlatformFetch),config);
    const failures=await this.results.replayFailures((receipt,jobId)=>capacity.recordExecutionFailure(receipt,jobId));
    const next=await capacity.tick();
    const publication=await outbox.publish(this.store,id=>capacity.status(id),config.publication);
    if(next===null&&!publication&&!failures&&!garbage)await this.ctx.storage.deleteAlarm();
  });}
}
