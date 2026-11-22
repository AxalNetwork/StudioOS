/** D7973: real bounded GitHub capacity ports; absent/incomplete evidence never grants execution. */
import { createPrivateKey, sign } from 'node:crypto';
import { boundedJson } from './ciCapacityAuth.ts';
import type { CapacityPorts } from './ciCapacity.ts';
import type { CiSubmission, CiAttempt, ExecutionReceipt, CiProvenance, ChildObservation, CapacityInventory, SelfHostedProfile } from './lib/ciCapacityPolicy.ts';
export type CapacityApi = (method: string, path: string, body?: unknown) => Promise<unknown>;
export type CapacityConfig = {
  repository: string; repositoryId: number; executorSha: string; approvedGroupId: number;
  prerequisiteJobs: string[]; fullSuiteJobs: string[];
  /** Linux milestone only; broadening profiles requires a separate reviewed cutover. */
  selfHostedProfiles: SelfHostedProfile[];
};
type Row = Record<string, any>; // External GitHub JSON is validated at each authority boundary.
const SHA = /^[a-f0-9]{40}$/;
const CI = '.github/workflows/ci.yml';
const EXECUTOR = '.github/workflows/runner-executor.yml';
const SHARDS = Array.from({ length: 6 }, (_, i) => `worker-${i+1}-of-6`);
const queueBranch = /^gh-readonly-queue\/main\/pr-([1-9][0-9]*)-([a-f0-9]{40})$/;
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
export async function capacityGithubClient(env: { REPOSITORY: string; GITHUB_APP_ID?: string; GITHUB_INSTALLATION_ID?: string; GITHUB_APP_PRIVATE_KEY?: string }, fetcher: typeof fetch = fetch): Promise<CapacityApi> {
  need(/^[\w.-]+\/[\w.-]+$/.test(env.REPOSITORY) && /^[1-9]\d*$/.test(env.GITHUB_APP_ID ?? '') && /^[1-9]\d*$/.test(env.GITHUB_INSTALLATION_ID ?? '') && env.GITHUB_APP_PRIVATE_KEY, 'capacity_app_unconfigured');
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now()/1000);
  const payload = `${enc({alg:'RS256',typ:'JWT'})}.${enc({iat:now-30,exp:now+540,iss:env.GITHUB_APP_ID})}`;
  const jwt = `${payload}.${sign('RSA-SHA256', Buffer.from(payload), createPrivateKey(env.GITHUB_APP_PRIVATE_KEY!)).toString('base64url')}`;
  const auth = await boundedJson(await fetcher(`https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${jwt}`,Accept:'application/vnd.github+json','User-Agent':'StudioOS-Capacity'},
    body:JSON.stringify({repositories:[env.REPOSITORY.split('/')[1]],permissions:{actions:'write',checks:'write',contents:'read',organization_self_hosted_runners:'read'}}),
  }), 16*1024) as Row;
  need(typeof auth.token==='string' && auth.token.length>0, 'capacity_app_token_missing');
  let calls=0; const deadline=Date.now()+60000;
  return async(method,path,body)=>{
    need(++calls<=100 && Date.now()<deadline && ['GET','POST','PATCH'].includes(method), 'capacity_api_budget');
    const repo=`/repos/${env.REPOSITORY}/`, org=`/orgs/${env.REPOSITORY.split('/')[0]}/actions/runner-groups/`;
    need((path.startsWith(repo)||path.startsWith(org)) && /^[\w./?=&%_-]+$/.test(path) && !path.includes('\\')
      && (!path.includes('..') || new RegExp(`^${repo}compare/[a-f0-9]{40}\\.\\.\\.[a-f0-9]{40}\\?per_page=100$`).test(path)), 'capacity_api_path');
    const response=await fetcher(`https://api.github.com${path}`,{method,redirect:'error',signal:AbortSignal.timeout(Math.min(10000,deadline-Date.now())),headers:{Authorization:`Bearer ${auth.token}`,Accept:'application/vnd.github+json','User-Agent':'StudioOS-Capacity','X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===204||response.status===202)return null;
    return boundedJson(response,2*1024*1024);
  };
}
export class GithubCapacityPorts implements CapacityPorts {
  readonly api: CapacityApi; readonly config: CapacityConfig; readonly now: () => number;
  constructor(api: CapacityApi, config: CapacityConfig, now: () => number = Date.now) {
    this.api=api;this.config=config;this.now=now;
    need(/^[\w.-]+\/[\w.-]+$/.test(config.repository)&&Number.isSafeInteger(config.repositoryId)&&config.repositoryId>0&&SHA.test(config.executorSha)&&config.approvedGroupId===5,'capacity_config_refused');
    need(Array.isArray(config.selfHostedProfiles)&&config.selfHostedProfiles.length===1&&config.selfHostedProfiles[0]==='linux-x64','capacity_linux_milestone_policy');
    need(Array.isArray(config.prerequisiteJobs)&&config.prerequisiteJobs.length>0&&config.prerequisiteJobs.length<=16&&new Set(config.prerequisiteJobs).size===config.prerequisiteJobs.length&&config.prerequisiteJobs.every(n=>typeof n==='string'&&n.length>0&&n.length<=120),'capacity_prerequisites_refused');
    need(Array.isArray(config.fullSuiteJobs)&&config.fullSuiteJobs.length<=32&&new Set(config.fullSuiteJobs).size===config.fullSuiteJobs.length&&config.fullSuiteJobs.every(n=>typeof n==='string'&&n.length>0&&n.length<=120),'capacity_full_suite_manifest_refused');
  }
  private path(path: string) { return `/repos/${this.config.repository}/${path}`; }
  private get(path: string) { return this.api('GET',this.path(path)) as Promise<Row>; }
  private repo(repo: Row) { return repo?.full_name===this.config.repository&&repo?.id===this.config.repositoryId; }
  async pages(path: string,key: string): Promise<Row[]> {
    const rows: Row[]=[];let total: number|undefined;
    for(let page=1;page<=3;page++){
      const data=await this.api('GET',`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`) as Row;
      need(Array.isArray(data?.[key])&&Number.isSafeInteger(data.total_count)&&data.total_count>=0&&data.total_count<=300,'capacity_incomplete_page');
      if(total===undefined)total=data.total_count;
      need(total===data.total_count&&data[key].length<=100,'capacity_page_changed');
      rows.push(...data[key]);
      if(rows.length===total){need(new Set(rows.map(row=>row.id)).size===rows.length,'capacity_duplicate_rows');return rows;}
      need(data[key].length===100&&rows.length<total!,'capacity_incomplete_page');
    }
    throw new Error('capacity_page_cap');
  }
  private parentIdentity(run: Row,s: CiSubmission): boolean {
    return run?.id===s.parentRunId&&run.run_attempt===s.parentAttempt&&run.workflow_id===s.parentWorkflowId&&run.path===CI
      &&run.head_sha===s.sourceSha&&run.event===s.event&&this.repo(run.repository)&&this.repo(run.head_repository)
      &&(s.event==='push'?run.head_branch==='main':queueBranch.test(run.head_branch??''));
  }
  async parent(s: CiSubmission): Promise<boolean> {
    const run=await this.get(`actions/runs/${s.parentRunId}`);
    if(!this.parentIdentity(run,s))return false;
    const attempt=await this.get(`actions/runs/${s.parentRunId}/attempts/${s.parentAttempt}`);
    if(!this.parentIdentity(attempt,s))return false;
    if(s.event==='merge_group'){
      try {const ref=await this.get(`git/ref/heads/${run.head_branch}`);if(ref.ref!==`refs/heads/${run.head_branch}`||ref.object?.sha!==s.sourceSha)return false;}
      catch(error){if((error as {status?:number}).status===404)return false;throw error;}
    }
    return [run,attempt].every(r=>['queued','in_progress','waiting','pending','requested'].includes(r.status)&&r.conclusion===null||r.status==='completed'&&r.conclusion==='success');
  }
  private async proveQueue(s: CiSubmission,parent: Row,main: string) {
    const comparison=await this.get(`compare/${main}...${s.sourceSha}?per_page=100`);
    need(comparison.status==='ahead'&&comparison.behind_by===0&&comparison.base_commit?.sha===main&&comparison.merge_base_commit?.sha===main
      &&Number.isInteger(comparison.total_commits)&&comparison.total_commits>0&&comparison.total_commits<=100&&comparison.ahead_by===comparison.total_commits
      &&Array.isArray(comparison.commits)&&comparison.commits.length===comparison.total_commits,'capacity_queue_comparison');
    const commits=new Map<string,Row>();
    for(const c of comparison.commits){need(SHA.test(c.sha??'')&&!commits.has(c.sha)&&Array.isArray(c.parents)&&c.parents.length>=1&&c.parents.length<=2&&c.parents.every((p:Row)=>SHA.test(p.sha??''))&&new Set(c.parents.map((p:Row)=>p.sha)).size===c.parents.length,'capacity_queue_graph');commits.set(c.sha,c);}
    const covered=new Set<string>(),chain=new Set([main]),prs=new Set<string>();
    const cover=(sha:string,visiting=new Set<string>())=>{
      if(!commits.has(sha)||covered.has(sha))return;need(!visiting.has(sha),'capacity_queue_cycle');visiting.add(sha);
      for(const p of commits.get(sha)!.parents)cover(p.sha,visiting);visiting.delete(sha);covered.add(sha);
    };
    let sha=s.sourceSha;
    while(sha!==main){
      need(chain.size<=32&&!chain.has(sha),'capacity_queue_chain');chain.add(sha);
      const c=commits.get(sha);need(c,'capacity_queue_parent_missing');
      const runs=sha===s.sourceSha?[parent]:await this.pages(this.path(`actions/runs?event=merge_group&head_sha=${sha}`),'workflow_runs');
      const selected=runs.filter(r=>r.path===CI&&r.event==='merge_group'&&r.head_sha===sha);
      need(selected.length>0,'capacity_queue_runs_missing');
      const identities=selected.map(r=>{const branch=queueBranch.exec(r.head_branch??'');need(branch&&branch[2]===c.parents[0].sha&&this.repo(r.repository)&&this.repo(r.head_repository),'capacity_queue_run_identity');return branch[1];});
      need(new Set(identities).size===1&&!prs.has(identities[0]),'capacity_queue_ambiguous');prs.add(identities[0]);
      const pr=await this.get(`pulls/${identities[0]}`);
      need(String(pr.number)===identities[0]&&pr.state==='open'&&pr.base?.ref==='main'&&this.repo(pr.base.repo)&&this.repo(pr.head?.repo)&&SHA.test(pr.head.sha??''),'capacity_queue_fork');
      if(c.parents.length===2){need(c.parents[1].sha===pr.head.sha,'capacity_queue_pr_changed');cover(pr.head.sha);}
      covered.add(sha);sha=c.parents[0].sha;
    }
    need(covered.size===commits.size&&chain.has(s.queueBaseSha!),'capacity_queue_uncovered');
    const final=await this.get('git/ref/heads/main');need(final.object?.sha===main,'capacity_main_changed');
  }
  async verify(s: CiSubmission): Promise<CiProvenance> {
    need(s.executorSha===this.config.executorSha&&s.shards.length===6&&SHARDS.every(name=>s.shards.includes(name))
      &&JSON.stringify([...s.prerequisites].sort())===JSON.stringify([...this.config.prerequisiteJobs].sort()),'capacity_manifest_refused');
    const run=await this.get(`actions/runs/${s.parentRunId}`);
    need(this.parentIdentity(run,s)&&await this.parent(s),'capacity_parent_refused');
    const main=await this.get('git/ref/heads/main');need(main.ref==='refs/heads/main'&&main.object?.type==='commit'&&SHA.test(main.object.sha??''),'capacity_main_unreadable');
    const comparison=await this.get(`compare/${s.executorSha}...${main.object.sha}?per_page=100`);
    need(['identical','ahead'].includes(comparison.status)&&comparison.base_commit?.sha===s.executorSha&&comparison.merge_base_commit?.sha===s.executorSha,'capacity_executor_not_main');
    if(s.event==='push'){
      const artifacts=await this.pages(this.path(`actions/runs/${s.parentRunId}/artifacts?name=suite-plan`),'artifacts');
      const plans=artifacts.filter(a=>a.name==='suite-plan'&&a.expired===false);
      need(plans.length===1&&plans[0].id===s.planArtifactId&&plans[0].workflow_run?.id===s.parentRunId&&plans[0].workflow_run.head_sha===s.sourceSha&&plans[0].workflow_run.repository_id===this.config.repositoryId&&plans[0].workflow_run.head_repository_id===this.config.repositoryId,'capacity_plan_refused');
    }else await this.proveQueue(s,run,main.object.sha);
    need(await this.parent(s),'capacity_parent_changed');
    return {...s,parentLive:true,trustedSource:true,executorOnMain:true};
  }
  async inventory(): Promise<CapacityInventory> {
    const org=this.config.repository.split('/')[0],base=`/orgs/${org}/actions/runner-groups/${this.config.approvedGroupId}`;
    const group=await this.api('GET',base) as Row;
    need(group.id===this.config.approvedGroupId&&group.name==='StudioOS Worker Pool'&&group.visibility==='selected'&&group.allows_public_repositories===true&&group.restricted_to_workflows===true,'capacity_group_unapproved');
    need(Array.isArray(group.selected_workflows)&&group.selected_workflows.length===1&&group.selected_workflows[0]===`${this.config.repository}/${EXECUTOR}@refs/heads/main`,'capacity_group_workflow_unapproved');
    const repositories=await this.pages(`${base}/repositories`,'repositories');need(repositories.length===1&&this.repo(repositories[0]),'capacity_group_repositories');
    const runners=await this.pages(`${base}/runners`,'runners');
    return {observedAt:this.now(),complete:true,runners:runners.flatMap(r=>{
      // Every authority row must be readable, even when it is not eligible for this milestone.
      need(r&&Number.isSafeInteger(r.id)&&r.id>0&&['linux','osx','win'].includes(r.os)
        &&typeof r.busy==='boolean'&&['online','offline'].includes(r.status)
        &&Array.isArray(r.labels)&&r.labels.length<=100
        &&r.labels.every((l:Row)=>l&&typeof l.name==='string'&&l.name.length>0&&l.name.length<=100),'capacity_runner_shape');
      const labels=r.labels.map((l:Row)=>l.name);
      need(new Set(labels).size===labels.length,'capacity_runner_labels');
      const linux=['self-hosted','Linux','X64','studioos-worker-v1'].every(l=>labels.includes(l));
      const mac=['self-hosted','macOS','ARM64','studioos-worker-v1'].every(l=>labels.includes(l));
      need(!(linux&&mac)&&(!linux||r.os==='linux')&&(!mac||r.os==='osx'),'capacity_runner_profile');
      // Well-formed legacy/unsupported members do not erase independently verified Linux capacity.
      if(!linux&&!mac)return [];
      const profile: SelfHostedProfile=linux?'linux-x64':'macos-arm64';
      if(!this.config.selfHostedProfiles.includes(profile))return [];
      return [{id:r.id,profile,groupId:this.config.approvedGroupId,online:r.status==='online',busy:r.busy,draining:labels.includes('studioos-draining')}];
    })};
  }

  async prerequisites(s: CiSubmission) {
    const jobs=await this.pages(this.path(`actions/runs/${s.parentRunId}/attempts/${s.parentAttempt}/jobs`),'jobs');
    return s.prerequisites.map(name=>{
      const matches=jobs.filter(j=>j.name===name&&j.run_id===s.parentRunId&&j.run_attempt===s.parentAttempt&&j.head_sha===s.sourceSha);
      const job=matches.length===1?matches[0]:null;
      return {name,conclusion:(!job?'pending':job.status!=='completed'?'pending':job.conclusion==='success'?'success':'failure') as 'pending'|'failure'|'success'};
    });
  }
  private title(a: Readonly<CiAttempt>|ExecutionReceipt) {return `Worker executor | ${a.requestId} | ${a.logicalShard} | generation ${a.generation}`;}
  private child(run: Row,a: Readonly<CiAttempt>|ExecutionReceipt) {
    return run?.event==='workflow_dispatch'&&run.path===EXECUTOR&&run.head_sha===a.executorSha&&run.head_branch==='main'&&run.run_attempt===1&&this.repo(run.repository)&&this.repo(run.head_repository)&&run.display_title===this.title(a);
  }
  async dispatch(a: Readonly<CiAttempt>): Promise<number> {
    need(a.profile!=='macos-arm64','capacity_profile_disabled');
    const main=await this.get('git/ref/heads/main');need(main.object?.sha===a.executorSha,'capacity_dispatch_main_moved');
    // Dispatch has no retry: a timeout/204 is reconciled through the persisted discovery intent.
    const dispatched=await this.api('POST',this.path('actions/workflows/runner-executor.yml/dispatches'),{ref:'main',inputs:{request_id:a.requestId,generation:String(a.generation),part:a.logicalShard,profile:a.profile}}) as {workflow_run_id?:number}|null;
    if(Number.isSafeInteger(dispatched?.workflow_run_id)&&dispatched!.workflow_run_id!>0)return dispatched!.workflow_run_id!;
    throw new Error('capacity_dispatch_discovery_required');
  }
  async discover(a: Readonly<CiAttempt>): Promise<number|null> {
    const runs=await this.pages(this.path(`actions/workflows/runner-executor.yml/runs?event=workflow_dispatch&head_sha=${a.executorSha}`),'workflow_runs');
    const matches=runs.filter(r=>this.child(r,a));return matches.length===1?matches[0].id:null;
  }
  async observe(receipt: ExecutionReceipt): Promise<ChildObservation|null> {
    const run=await this.get(`actions/runs/${receipt.childRunId}`);
    if(run.id!==receipt.childRunId||!this.child(run,receipt))return null;
    const jobs=await this.pages(this.path(`actions/runs/${receipt.childRunId}/attempts/1/jobs`),'jobs');
    if(jobs.some(j=>j.run_id!==receipt.childRunId||j.run_attempt!==1||j.head_sha!==receipt.executorSha))return null;
    const selected=jobs.filter(j=>j.name==='Admitted Worker shard');if(selected.length!==1)return null;
    const job=selected[0], steps=Array.isArray(job.steps)?job.steps.filter((s:Row)=>s.name==='Run admitted Worker shard'):[];
    if(steps.length!==1||!['queued','in_progress','completed'].includes(run.status))return null;
    const step=steps[0];
    const labels=Array.isArray(job.labels)?job.labels:[];
    const profile=receipt.profile;
    const target=profile==='hosted'?labels.includes('ubuntu-latest')&&!labels.includes('self-hosted')
      :profile==='github-8'?labels.includes('studioos-bench-linux-8')&&!labels.includes('self-hosted')
      :['self-hosted','studioos-worker-v1',profile==='linux-x64'?'Linux':'macOS',profile==='linux-x64'?'X64':'ARM64'].every(l=>labels.includes(l));
    if(!target)return null;
    const outcome=(v:unknown)=>['success','failure','cancelled','timed_out'].includes(String(v))?v as 'success'|'failure'|'cancelled'|'timed_out':null;
    const testStep=step.status==='completed'&&step.conclusion==='failure'?'failure':step.status==='completed'&&step.conclusion==='success'?'success':step.status==='completed'&&step.conclusion==='skipped'?'not_run':step.status==='queued'?'not_run':'unknown';
    return {receipt,workflowPath:EXECUTOR,workflowAttempt:1,jobId:job.id,runnerProfile:profile,status:run.status,conclusion:outcome(run.conclusion),jobConclusion:outcome(job.conclusion),testStep,startedAt:Number.isFinite(Date.parse(job.started_at))?Date.parse(job.started_at):null};
  }
  async cancel(receipt: ExecutionReceipt): Promise<void> {
    const run=await this.get(`actions/runs/${receipt.childRunId}`);need(run.id===receipt.childRunId&&this.child(run,receipt),'capacity_cancel_identity');
    if(run.status!=='completed')await this.api('POST',this.path(`actions/runs/${receipt.childRunId}/cancel`));
  }
}
