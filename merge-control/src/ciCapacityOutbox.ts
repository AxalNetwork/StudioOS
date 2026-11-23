/** D7973: restart-safe check publication intents; pilot authority is never full-suite authority. */
import type { CapacityStore } from './ciCapacity.ts';
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
  private storage: DurableObjectStorage;private api: CapacityApi;private config: CapacityConfig & {appId:number};
  constructor(storage: DurableObjectStorage, api: CapacityApi, config: CapacityConfig & { appId: number }) {
    this.storage=storage;this.api=api;this.config=config;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_publications (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_publication_cursor (mode TEXT PRIMARY KEY, last TEXT NOT NULL)');
  }
  async publish(store: CapacityStore, status: (id: string)=>Aggregate|null, mode: Intent['mode']): Promise<boolean> {
    let pending=false;
    this.storage.sql.exec('DELETE FROM capacity_publications WHERE substr(id, 1, 36) NOT IN (SELECT id FROM ci_capacity_requests)');
    const records=store.list();
    const intents=new Map(this.storage.sql.exec<{id:string;state:string}>('SELECT id,state FROM capacity_publications').toArray().map(row=>[row.id,JSON.parse(row.state) as Intent]));
    const priority=records.filter(r=>{const sent=intents.get(`${r.submission.requestId}:${mode}`)?.sent;return r.completedAt===null||!sent||JSON.parse(sent).status==='pending';});
    const candidates=priority.length?priority:records;
    const cursor=this.storage.sql.exec<{last:string}>('SELECT last FROM capacity_publication_cursor WHERE mode = ?',mode).toArray()[0]?.last??'';
    const after=candidates.filter(r=>r.submission.requestId>cursor);
    const rotated=priority.length?[...after,...candidates.filter(r=>r.submission.requestId<=cursor)]:(after.length?after:candidates);
    // At most four publications per alarm. A durable cursor prevents retained history or a failed intent monopolizing the API budget.
    for(const request of rotated.slice(0,4)) {
      this.storage.sql.exec('INSERT OR REPLACE INTO capacity_publication_cursor (mode,last) VALUES (?,?)',mode,request.submission.requestId);
      const id=`${request.submission.requestId}:${mode}`, name=mode==='pilot'?PILOT_CHECK:FULL_CHECK;
      const old=this.storage.sql.exec<{state:string}>('SELECT state FROM capacity_publications WHERE id = ?',id).toArray()[0];
      const intent: Intent=old?JSON.parse(old.state):{requestId:request.submission.requestId,mode,checkId:null,phase:'new',sent:null,failed:false};
      const save=()=>this.storage.sql.exec('INSERT OR REPLACE INTO capacity_publications (id,state) VALUES (?,?)',id,JSON.stringify(intent));
      const result=status(request.submission.requestId);if(!result)continue;
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
      if(intent.sent===fingerprint)continue;
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
      }catch { /* Durable intent remains for the next alarm; never publish guessed success. */ }
    }
    return pending||rotated.length>4;
  }
}
