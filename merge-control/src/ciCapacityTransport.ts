/** D7973: authenticated planner/child boundary around the durable coordinator. */
import { createHash } from 'node:crypto';
import type { CapacityIdentity } from './ciCapacityAuth.ts';
import type { CiCapacity } from './ciCapacity.ts';
import type { CapacityConfig } from './ciCapacityGithub.ts';
import type { CiSubmission } from './lib/ciCapacityPolicy.ts';
export class CapacityTransport {
  private capacity:CiCapacity;private config:CapacityConfig;private enabled:()=>Promise<boolean>;private wake:()=>Promise<void>;
  constructor(capacity: CiCapacity, config: CapacityConfig, enabled: ()=>Promise<boolean>, wake: ()=>Promise<void>) {this.capacity=capacity;this.config=config;this.enabled=enabled;this.wake=wake;}
  async submit(body: {submission:CiSubmission;plan:string}, identity: CapacityIdentity & {job_workflow_ref?:string;job_workflow_sha?:string}) {
    if(!await this.enabled())throw new Error('capacity_disabled');
    const s=body?.submission;
    if(!s||!Array.isArray(s.shards)||!Array.isArray(s.prerequisites)||identity.repository!==this.config.repository
      ||Number(identity.repository_id)!==this.config.repositoryId||Number(identity.run_id)!==s.parentRunId||Number(identity.run_attempt)!==s.parentAttempt
      ||identity.event_name!==s.event||identity.sha!==s.sourceSha
      ||identity.workflow_ref!==`${this.config.repository}/.github/workflows/ci.yml@${identity.ref}`
      ||identity.job_workflow_ref!==`${this.config.repository}/.github/workflows/capacity-planner.yml@${this.config.executorSha}`
      ||identity.job_workflow_sha!==this.config.executorSha
      ||(s.event==='push'?identity.ref!=='refs/heads/main':!/^refs\/heads\/gh-readonly-queue\/main\/pr-[1-9][0-9]*-[a-f0-9]{40}$/.test(identity.ref)))throw new Error('capacity_planner_identity');
    if(typeof body.plan!=='string'||Buffer.byteLength(body.plan)>8*1024*1024||`sha256:${createHash('sha256').update(body.plan).digest('hex')}`!==s.planDigest)throw new Error('capacity_plan_digest');
    const plan=JSON.parse(body.plan);
    if(!Array.isArray(plan.parts)||s.shards.some(name=>plan.parts.filter((p:{name:string;script:string})=>p.name===name&&p.script==='test:worker').length!==1))throw new Error('capacity_plan_shards');
    // Arm recovery BEFORE durable acceptance; crash after acceptance cannot strand a request.
    await this.wake();
    return this.capacity.submit(s);
  }
  async receipt(body:{requestId:string;shard:string;generation:number;profile:string},identity: CapacityIdentity) {
    if(!await this.enabled())return {active:false,receipt:null};
    if(identity.repository!==this.config.repository||Number(identity.repository_id)!==this.config.repositoryId||identity.event_name!=='workflow_dispatch'
      ||identity.ref!=='refs/heads/main'||identity.workflow_ref!==`${this.config.repository}/.github/workflows/runner-executor.yml@refs/heads/main`
      ||identity.sha!==this.config.executorSha||identity.workflow_sha!==this.config.executorSha||identity.run_attempt!=='1'
      ||!body||typeof body.requestId!=='string'||body.requestId.length>100||!/^worker-[1-6]-of-6$/.test(body.shard)||!Number.isSafeInteger(body.generation))throw new Error('capacity_child_identity');
    const receipt=await this.capacity.receipt(body.requestId,body.shard,Number(identity.run_id),Number(identity.run_attempt));
    if(!receipt||receipt.executorSha!==identity.workflow_sha||receipt.generation!==body.generation||receipt.profile!==body.profile)return {active:false,receipt:null};
    return {active:true,receipt};
  }
}
