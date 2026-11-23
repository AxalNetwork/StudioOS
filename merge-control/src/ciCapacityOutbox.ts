/** D7973: restart-safe check publication intents; pilot authority is never full-suite authority. */
import type { CapacityStore } from './ciCapacity.ts';
import type { CapacityCompactStore, CapacityCompactFailedStore } from './ciCapacityCompact.ts';
import { pruneCapacityHistory, retainedCapacity } from './ciCapacityHistory.ts';
import { SqlCapacityCorrections } from './ciCapacityCorrections.ts';
import { GithubCapacityPorts } from './ciCapacityGithub.ts';
import type { CapacityApi, CapacityConfig } from './ciCapacityGithub.ts';
import type { Aggregate } from './lib/ciCapacityPolicy.ts';
export const PILOT_CHECK = 'ci-capacity/worker-pilot';
export const FULL_CHECK = 'ci-capacity/full-suite';
type Intent = { requestId: string; mode: 'pilot'|'full-suite'; checkId: number|null; phase: 'new'|'creating'|'known'; sent: string|null; failed: boolean;
  createAttempts?: number; lastCreateAt?: number; absentSince?: number };
/** GitHub has no check-run idempotency key. Retry only a bounded, repeatedly observed absence. */
export const PUBLICATION_CREATE_LIMIT = 2;
export class CapacityOutbox {
  private storage: DurableObjectStorage;private api: CapacityApi;private config: CapacityConfig & {appId:number};private corrections:SqlCapacityCorrections;
  constructor(storage: DurableObjectStorage, api: CapacityApi, config: CapacityConfig & { appId: number }) {
    this.storage=storage;this.api=api;this.config=config;this.corrections=new SqlCapacityCorrections(storage);
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_publications (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_publication_cursor (mode TEXT PRIMARY KEY, last TEXT NOT NULL)');
  }
  async publish(store: CapacityStore, status: (id: string)=>Aggregate|null, mode: Intent['mode']): Promise<boolean> {
    let pending=false;
    const garbage=pruneCapacityHistory(this.storage,'publications');
    const records=store.list(), compactStore=store as CapacityStore & Partial<CapacityCompactStore & CapacityCompactFailedStore>;
    const read=(id:string)=>this.storage.sql.exec<{state:string}>('SELECT state FROM capacity_publications WHERE id=?',id).toArray()[0];
    const sentFailure=(id:string)=>{try{
      const row=read(`${id}:${mode}`),intent=row?JSON.parse(row.state) as Intent:null;
      return intent?.requestId===id&&intent.mode===mode&&intent.phase==='known'
        &&Number.isSafeInteger(intent.checkId)&&intent.checkId!>0&&JSON.parse(intent.sent??'null')?.status==='failure';
    }catch{return false;}};
    const consider=(id:string)=>{
      const compact=compactStore.compact?.(id);
      if(compact?.publicationMode===mode&&compact.failed&&!sentFailure(id))this.corrections.enqueue(id);
    };
    // Full requests are already bounded to 1000. Their stored negative flags cover observations outside the journal.
    for(const record of records){
      if(record.shards.some(shard=>shard.attempts.some(attempt=>attempt.verifiedTestFailure||attempt.phase==='failed'))
        &&!sentFailure(record.submission.requestId)){
        const row=read(`${record.submission.requestId}:${mode}`);
        try{if(row&&JSON.parse(JSON.parse(row.state).sent??'null')?.status)this.corrections.enqueue(record.submission.requestId);}catch{pending=true;}
      }
    }
    const backfill=this.corrections.discover(compactStore,consider);
    const priority=records.filter(r=>{try{const row=read(`${r.submission.requestId}:${mode}`);const intent=row?JSON.parse(row.state) as Intent:null;
      return r.completedAt===null||!intent?.sent||JSON.parse(intent.sent).status==='pending';}catch{return true;}});
    const priorityIds=new Set(priority.map(r=>r.submission.requestId));
    const history=records.filter(r=>!priorityIds.has(r.submission.requestId));
    const cursor=(name:string)=>this.storage.sql.exec<{last:string}>('SELECT last FROM capacity_publication_cursor WHERE mode=?',name).toArray()[0]?.last??'';
    const advance=(name:string,last:string)=>this.storage.sql.exec('INSERT OR REPLACE INTO capacity_publication_cursor(mode,last) VALUES(?,?)',name,last);
    const rotate=(rows:typeof records,key:string)=>{const last=cursor(key);return [...rows.filter(r=>r.submission.requestId>last),...rows.filter(r=>r.submission.requestId<=last)];};
    const hot=rotate(priority,`${mode}:priority`), settled=rotate(history,`${mode}:history`);
    const compactKey=`${mode}:compact`;
    let compact=compactStore.compactPage?.(cursor(compactKey),100)??[];
    if(!compact.length&&cursor(compactKey))compact=compactStore.compactPage?.('',100)??[];
    const eligible=compact.filter(r=>r.publicationMode===mode&&!records.some(full=>full.submission.requestId===r.submission.requestId));
    type Selected={record:Pick<(typeof records)[number],'submission'>;lane:string;compact:boolean;dueSeq?:number};
    const due:Selected[]=[];
    for(const row of this.corrections.page()){
      const full=records.find(r=>r.submission.requestId===row.request_id), compact=compactStore.compact?.(row.request_id);
      if(!full&&!compact){
        if(!retainedCapacity(this.storage,row.request_id))this.corrections.remove(row.seq);
        else pending=true;
        this.corrections.advance(row.seq);continue;
      }
      if((full&&compact)||(compact&&compact.publicationMode!==mode)){pending=true;this.corrections.advance(row.seq);continue;}
      if(!full){try{
        const raw=read(`${row.request_id}:${mode}`),intent=raw?JSON.parse(raw.state) as Intent:null;
        if(!intent||intent.requestId!==row.request_id||intent.mode!==mode||intent.phase!=='known'
          ||!Number.isSafeInteger(intent.checkId)||intent.checkId!<=0)throw new Error('correction_intent_unavailable');
      }catch{pending=true;this.corrections.advance(row.seq);continue;}}
      if(sentFailure(row.request_id)){this.corrections.remove(row.seq);this.corrections.advance(row.seq);continue;}
      due.push({record:full??compact!,compact:!full,lane:'correction',dueSeq:row.seq});
      if(due.length===4)break;
    }
    const dueIds=new Set(due.map(item=>item.record.submission.requestId));
    const hotReady=hot.filter(r=>!dueIds.has(r.submission.requestId));
    const settledReady=settled.filter(r=>!dueIds.has(r.submission.requestId));
    const compactReady=eligible.filter(r=>!dueIds.has(r.submission.requestId));
    const selected:Selected[]=[];
    const add=(record:Selected['record']|undefined,lane:string,isCompact=false)=>{if(record)selected.push({record,lane,compact:isCompact});};
    // The first correction precedes unchanged history; every nonempty ordinary lane still gets one place.
    const first=due.shift();if(first)selected.push(first);
    add(hotReady.shift(),`${mode}:priority`);add(settledReady.shift(),`${mode}:history`);
    for(const record of compactReady.splice(0,first?1:2))add(record,compactKey,true);
    while(selected.length<4&&(due.length||hotReady.length||settledReady.length||compactReady.length)){
      if(due.length)selected.push(due.shift()!);
      else if(hotReady.length)add(hotReady.shift(),`${mode}:priority`);
      else if(settledReady.length)add(settledReady.shift(),`${mode}:history`);
      else add(compactReady.shift(),compactKey,true);
    }
    // A page of other modes/conflicts must not trap this cursor; none is reinterpreted or published.
    if(!eligible.length&&compact.length)advance(compactKey,compact.at(-1)!.submission.requestId);
    for(const item of selected){
      const request=item.record;
      if(item.dueSeq!==undefined)this.corrections.advance(item.dueSeq);
      else advance(item.lane,request.submission.requestId);
      // Duplicate authority is unresolved. Preserve both sides and every existing intent; publish neither.
      if(!item.compact&&compactStore.compact?.(request.submission.requestId)){pending=true;continue;}
      const id=`${request.submission.requestId}:${mode}`, name=mode==='pilot'?PILOT_CHECK:FULL_CHECK;
      const old=read(id);let intent:Intent;
      try{
        if(item.compact&&!old){pending=true;continue;}
        intent=old?JSON.parse(old.state):{requestId:request.submission.requestId,mode,checkId:null,phase:'new',sent:null,failed:false};
        if(intent.requestId!==request.submission.requestId||intent.mode!==mode)throw new Error('publication_identity_conflict');
        if(item.compact&&(intent.phase!=='known'||!Number.isSafeInteger(intent.checkId)||intent.checkId!<=0))throw new Error('correction_intent_unavailable');
      }catch{pending=true;continue;}
      const save=()=>this.storage.sql.exec('INSERT OR REPLACE INTO capacity_publications (id,state) VALUES (?,?)',id,JSON.stringify(intent));
      const result=status(request.submission.requestId);if(!result)continue;
      if(item.dueSeq!==undefined&&result.status!=='failure'){pending=true;continue;}
      // An old, superseded attempt may update its existing check, but may never create a newer check on that SHA.
      if(store.newerParent(request.submission.parentRunId,request.submission.parentAttempt)&&intent.checkId===null)continue;
      let aggregate=result;
      if(result.status==='success'){
        try{if(!await new GithubCapacityPorts(this.api,this.config).parent(request.submission))aggregate={status:'cancelled',reason:'parent_inactive'};}
        catch{aggregate={status:'pending',reason:'parent_evidence_unavailable'};}
      }
      if(mode==='full-suite'&&aggregate.status==='success') {
        const required=['suite (frontend-1-of-2)','suite (frontend-2-of-2)','suite (rest)',...this.config.prerequisiteJobs];
        if(required.some(n=>!this.config.fullSuiteJobs.includes(n)))aggregate={status:'pending',reason:'full_suite_manifest_incomplete'};
        else {
          const jobs: {id:number;name:string;run_id:number;run_attempt:number;head_sha:string;status:string;conclusion:string}[]=[];
          let total:number|undefined;
          for(let page=1;page<=3;page++){
            const data=await this.api('GET',`/repos/${this.config.repository}/actions/runs/${request.submission.parentRunId}/attempts/${request.submission.parentAttempt}/jobs?per_page=100&page=${page}`) as {jobs:typeof jobs;total_count:number};
            if(!Array.isArray(data.jobs)||!Number.isSafeInteger(data.total_count)||data.total_count>300||data.total_count<0||data.jobs.length>100||(total!==undefined&&total!==data.total_count))throw new Error('publication_incomplete_jobs');
            total=data.total_count;jobs.push(...data.jobs);if(jobs.length===total)break;
            if(data.jobs.length!==100||page===3)throw new Error('publication_page_cap');
          }
          if(new Set(jobs.map(j=>j.id)).size!==jobs.length||jobs.length!==total)throw new Error('publication_ambiguous_jobs');
          const selected=this.config.fullSuiteJobs.map(n=>jobs.filter(j=>j.name===n&&j.run_id===request.submission.parentRunId&&j.run_attempt===request.submission.parentAttempt&&j.head_sha===request.submission.sourceSha));
          if(selected.some(rows=>rows.length!==1||rows[0].status!=='completed'))aggregate={status:'pending',reason:'awaiting_full_suite'};
          else if(selected.some(rows=>['failure','timed_out'].includes(rows[0].conclusion)))aggregate={status:'failure',reason:'full_suite_failed'};
          else if(selected.some(rows=>rows[0].conclusion==='cancelled'))aggregate={status:'cancelled',reason:'full_suite_cancelled'};
          else if(selected.some(rows=>rows[0].conclusion!=='success'))aggregate={status:'pending',reason:'full_suite_unknown'};
        }
      }
      if(aggregate.status==='failure'&&!intent.failed){intent.failed=true;save();}
      if(intent.failed)aggregate={status:'failure',reason:'verified_failure'};
      const fingerprint=JSON.stringify(aggregate);
      if(intent.sent===fingerprint){if(aggregate.status==='failure')this.corrections.clear(request.submission.requestId);continue;}
      pending=true;
      try {
        if(intent.phase==='creating'){
          // A landed POST is adopted. A missing POST may recover only after bounded absence observation.
          const data=await this.api('GET',`/repos/${this.config.repository}/commits/${request.submission.sourceSha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`) as {check_runs:{id:number;external_id:string;app:{id:number};name:string;head_sha:string}[];total_count:number};
          if(!Array.isArray(data.check_runs)||data.total_count!==data.check_runs.length||data.total_count>100)throw new Error('publication_incomplete_checks');
          const matches=data.check_runs.filter(c=>c.external_id===id&&c.app?.id===this.config.appId&&c.name===name&&c.head_sha===request.submission.sourceSha);
          if(matches.length>1)continue;
          if(matches.length===0){
            const now=Date.now();intent.createAttempts??=1;intent.lastCreateAt??=now;intent.absentSince??=now;save();
            if(!Number.isSafeInteger(intent.createAttempts)||intent.createAttempts<1||intent.createAttempts>=PUBLICATION_CREATE_LIMIT
              ||!Number.isSafeInteger(intent.lastCreateAt)||!Number.isSafeInteger(intent.absentSince)
              ||now-intent.lastCreateAt<60_000||now-intent.absentSince<15_000)continue;
            intent.phase='new';save();
          }else{intent.checkId=matches[0].id;intent.phase='known';save();}
        }
        if(intent.phase==='new'){
          if((intent.createAttempts??0)>=PUBLICATION_CREATE_LIMIT)continue;
          intent.phase='creating';intent.createAttempts=(intent.createAttempts??0)+1;intent.lastCreateAt=Date.now();delete intent.absentSince;save();
          const created=await this.api('POST',`/repos/${this.config.repository}/check-runs`,{name,head_sha:request.submission.sourceSha,external_id:id,status:'in_progress',output:{title:'Awaiting verified capacity results',summary:'Submission and dispatch are not test success.'}}) as {id:number};
          if(!Number.isSafeInteger(created?.id)||created.id<=0)throw new Error('publication_invalid_id');
          intent.checkId=created.id;intent.phase='known';save();
        }
        await this.api('PATCH',`/repos/${this.config.repository}/check-runs/${intent.checkId}`,{
          status:aggregate.status==='pending'?'in_progress':'completed',...(aggregate.status==='pending'?{}:{conclusion:aggregate.status}),
          output:{title:aggregate.reason,summary:`${mode==='pilot'?'Six Worker shards only; not full-suite authority.':'Full expected suite and prerequisites.'} Request ${request.submission.requestId}; original run ${request.submission.parentRunId}, attempt ${request.submission.parentAttempt}.`},
        });
        intent.sent=fingerprint;save();
        if(aggregate.status==='failure')this.corrections.clear(request.submission.requestId);
      }catch { /* Durable intent remains for the next alarm; never publish guessed success. */ }
    }
    this.corrections.finishLegacy();
    // Keep bounded reconciliation/expiry alive while either representation still owes monitoring.
    return pending||garbage||backfill||this.corrections.pending()||records.length>0||compact.length>0;
  }
}
