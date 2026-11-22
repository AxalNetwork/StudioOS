#!/usr/bin/env node
/** D7909: trusted listener bridge over the exact S09 supervisor; authenticated delivery never enters candidate code. */
import { constants, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateDirectory } from '../local-files.mjs';
import { main as execute, ownedPaths, runStepDeadline } from './runner-execution.mjs';
import { main as admit, receiptIdentity } from './runner-admission.mjs';
import { trustedAuthority } from './executor-authority.mjs';
import { githubOidcToken, reportExecutionResult } from './capacity-client.mjs';
import { recoveryStore, defaultRecoveryRoot } from './runners/recovery-store.mjs';
import { isolationFor } from './runners/executor-isolation.mjs';
import { JobContainer } from './runners/job-container.mjs';
import { createTraceExporter } from './runners/trace-exporter.mjs';
const need=(ok,reason)=>{if(!ok)throw Error(reason);};
const SHA=/^[a-f0-9]{40}$/,ID=/^[1-9][0-9]{0,14}$/;
const same=(a,b)=>JSON.stringify(receiptIdentity(a))===JSON.stringify(receiptIdentity(b))&&(a.childWorkflowSha??a.executorSha)===(b.childWorkflowSha??b.executorSha);
/** Fixed listener-private state, outside disposable run paths; never an environment/workflow path. */
export const resultRoot=()=>join(dirname(defaultRecoveryRoot()),'capacity-results');
export function resultStore(root,run){
 need(ID.test(String(run)),'result_run_invalid');privateDirectory(root);need(realpathSync(root)===root,'result_root_link');
 const file=join(root,`${run}-1.json`);
 const sync=()=>{const fd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(fd);}finally{closeSync(fd);}};
 const readOne=path=>{
  let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  try{const st=fstatSync(fd);need(st.isFile()&&st.nlink===1&&st.uid===process.getuid?.()&&(st.mode&0o077)===0&&st.size<=16384,'result_state_invalid');return JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
 };
 const eligible=(value,name)=>value?.receipt?.childAttempt===1&&`${value.receipt.childRunId}-1.json`===name&&value.removed===true&&value.result?.cleanupConfirmed===true&&typeof value.ack==='string'&&value.ack===JSON.stringify(value.result);
 const retire=path=>{const value=readOne(path);if(eligible(value,path.slice(root.length+1))){rmSync(path);sync();return true;}return false;};
 // At most 128 child journals. Reclaim only durable acknowledgements with independently verified cleanup.
 // The current single-writer job keeps its own journal until cleanup; unreadable/uncertain evidence is retained.
 const names=readdirSync(root);need(names.length<=256,'result_state_bound');
 for(const name of names)if(/^[1-9][0-9]{0,14}-1\.json$/.test(name)&&name!==`${run}-1.json`){try{retire(join(root,name));}catch{/* Preserve unreadable evidence. */}}
 const read=()=>readOne(file);
 return {read,retire:()=>retire(file),write(value){
  need(read()!==null||readdirSync(root).length<128,'result_state_bound');const bytes=JSON.stringify(value);need(Buffer.byteLength(bytes)<=16384,'result_state_bound');
  const pending=join(root,`${run}-1.pending`),fd=openSync(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(pending,file);sync();
 }};
}
/** Typed values are captured from S09's private local output descriptor plus its actual exporter/store ports. */
export function supervisorResult(values,{observedTest,removed,exportedAt,exportDeadline,observedCaptured=false,receiptDeadline=Infinity,now=Date.now}={}){
 need(values&&['success','test_failure','cancelled','timed_out','infrastructure','incomplete_cleanup'].includes(values.category)
  &&['complete','none','failed','unverified','unknown'].includes(values.cleanup)&&['complete','failed','skipped_no_budget','not_configured','not_run'].includes(values.export),'supervisor_shape');
 const categories={success:'success',test_failure:'test_failure',cancelled:'cancelled',timed_out:'timed_out',cleanup_failure:'incomplete_cleanup',export_failure:'infrastructure',install_failure:'infrastructure',infrastructure:'infrastructure',deadline_overrun:'infrastructure',unknown:'infrastructure'};
 need(categories[values.result]===values.category,'supervisor_category_mismatch');
 if(observedTest?.status==='success')need(String(values.test_exit)==='0','supervisor_test_truth');
 const failure=observedTest?.status==='failure'&&Number.isSafeInteger(observedTest.exitCode)&&observedTest.exitCode>0&&String(observedTest.exitCode)===String(values.test_exit);
 need((values.category==='test_failure')===failure,'supervisor_test_truth');
 const cleanupConfirmed=values.cleanup==='complete'&&removed===true;
 const exportComplete=values.export==='complete'&&Number.isSafeInteger(exportedAt)&&Number.isSafeInteger(exportDeadline)&&exportedAt<exportDeadline&&exportedAt<=now();
 const testStep=failure?'failure':observedTest?.status==='success'&&observedTest.exitCode===0?'success':observedTest?.status==='not_run'||(observedCaptured&&observedTest===null)?'not_run':'unknown';
 if(values.category==='success')need(values.result==='success'&&testStep==='success'&&cleanupConfirmed&&exportComplete,'supervisor_success_unproven');
 const executionOutcome=(values.category==='timed_out'||values.result==='deadline_overrun'||(values.category==='success'&&now()>=receiptDeadline))?'timed_out':!cleanupConfirmed?'cleanup_failure':!exportComplete?'export_failure':testStep==='success'||failure?'completed':'setup_failure';
 return {testStep,executionOutcome,cleanupConfirmed,exportComplete};
}
function outputValues(path){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const st=fstatSync(fd);need(st.isFile()&&st.nlink===1&&st.uid===process.getuid?.()&&st.size<=4096,'supervisor_output_bound');
  const values={};for(const line of readFileSync(fd,'utf8').trim().split('\n')){const match=/^(category|result|test_exit|cleanup|export)=([a-z_]*|[0-9]+)$/.exec(line);need(match&&!Object.hasOwn(values,match[1]),'supervisor_output_invalid');values[match[1]]=match[2];}return values;
 }finally{closeSync(fd);}
}
export async function main(mode,env=process.env,ports={}){
 const context={repository:env.GITHUB_REPOSITORY,executorSha:env.EXECUTOR_SHA,childWorkflowSha:env.CHILD_WORKFLOW_SHA,childWorkflowPath:'.github/workflows/runner-executor.yml',childRunId:env.GITHUB_RUN_ID,childAttempt:env.GITHUB_RUN_ATTEMPT};
 need(context.repository==='AxalNetwork/StudioOS'&&SHA.test(context.executorSha??'')&&SHA.test(context.childWorkflowSha??'')&&context.childWorkflowSha===env.GITHUB_WORKFLOW_SHA&&ID.test(context.childRunId??'')&&context.childAttempt==='1','supervisor_context');
 const state=ports.results??resultStore(resultRoot(),context.childRunId),store=ports.store??recoveryStore({create:mode==='run'});
 let record=state.read();
 if(record)need(same(record.receipt,{...record.receipt,executorSha:context.executorSha,childWorkflowSha:context.childWorkflowSha,childRunId:Number(context.childRunId),childAttempt:1})&&record.receipt.repository===context.repository,'result_context_changed');
 const save=()=>state.write(record);
 // Persist the original Run-process bound; a cleanup process must never reopen it with a fresh timeOrigin.
 const fenceLateSuccess=()=>{
  if(record?.result?.testStep==='success'&&record.result.executionOutcome==='completed'
    &&Date.now()>=Math.min(record.receipt.executionDeadline,record.completionDeadline??record.receipt.executionDeadline)){
   record.result={...record.result,executionOutcome:'timed_out'};save();
  }
 };
 const report=async()=>{
  fenceLateSuccess();
  if(!record?.result||record.ack===JSON.stringify(record.result))return;
  const delivered=structuredClone(record.result);
  const value=await (ports.report??((receipt,result)=>reportExecutionResult(receipt,result,{url:env.CI_CAPACITY_URL,audience:env.CI_CAPACITY_AUDIENCE,oidcToken:githubOidcToken(env)})))(record.receipt,delivered);
  need(value?.accepted===true,'result_delivery_unacknowledged');record.ack=JSON.stringify(delivered);save();
  // A late ACK cannot acknowledge a later timeout correction. Cleanup retries that dirty journal.
  fenceLateSuccess();
 };
 const verifyRemoved=ports.verifyRemoved??(owned=>JobContainer.isRemoved(owned));
 const removed=async owned=>{
  const proof=await verifyRemoved(owned);
  if(proof===true&&record?.container?.id===owned.id&&record.container.owner===owned.owner){record.removed=true;if(record.result)record.result.cleanupConfirmed=true;save();}
  return proof;
 };
 const reconcileIntent=async intent=>{
  const outcome=await (ports.recoverIntent??(value=>JobContainer.recoverIntent(value)))(intent);
  const receipt=record?.receipt;
  if(['absent','removed'].includes(outcome)&&receipt&&record.container===null&&intent.owner===`${receipt.childRunId}-${receipt.childAttempt}-${receipt.generation}`){
   record.removed=true;if(record.result)record.result.cleanupConfirmed=true;save();
  }
  return outcome;
 };
 const executeMode=ports.execute??execute;
 if(mode==='prepare'||mode==='cleanup'){
  let failure;try{await executeMode(mode,env,{store,recover:ports.recover??(owned=>JobContainer.recover(owned)),verifyRemoved:removed,recoverIntent:reconcileIntent});}catch(e){failure=e;}
  // Retry only this job's outcome. Exact canonical create-intent reconciliation may prove absence;
  // an absent result/ID record alone never proves cleanup, and no other job's OIDC is minted.
  if(mode==='cleanup')try{await report();}catch(e){failure??=e;}
  if(failure)throw failure;if(mode==='cleanup')state.retire?.();return 0;
 }
 const authority=ports.authority??await trustedAuthority(env),isolation=ports.isolation??isolationFor(env.PROFILE??JSON.parse(env.ADMITTED_JSON??'null')?.identity?.profile);
 need(typeof authority.readReceipt==='function'&&isolation,'supervisor_authority_unconfigured');
 let canonical=null;
 const readReceipt=async args=>{
  const envelope=await authority.readReceipt(args),receipt=envelope?.receipt;
  need(envelope?.active===true&&receipt?.executorSha===context.executorSha&&(receipt.childWorkflowSha??receipt.executorSha)===context.childWorkflowSha,'supervisor_receipt_identity');
  if(canonical)need(same(canonical,receipt),'supervisor_receipt_changed');canonical=structuredClone(receipt);return envelope;
 };
 const executionIsolation=async args=>{
  // The S09 before-install and before-test boundary checks also refresh current receipt authority.
  await readReceipt({request:{requestId:args.receipt.requestId,shard:args.receipt.logicalShard,generation:args.receipt.generation,profile:args.receipt.profile},context,phase:'execute',signal:args.signal});
  return await isolation.executionIsolation?.(args)===true;
 };
 const deps={...authority,...isolation,readReceipt,executionIsolation,store};
 if(mode==='admit')return await (ports.admit??admit)(env,{...deps,verifyIsolation:isolation.admissionIsolation});
 if(mode==='verify-plan')return await executeMode(mode,env,deps);
 need(mode==='run'&&isolation.job,'supervisor_boundary_unavailable');
 need(record===null,'supervisor_run_already_recorded');
 const paths=ownedPaths({runnerTemp:env.RUNNER_TEMP,workspace:env.GITHUB_WORKSPACE,childRunId:env.GITHUB_RUN_ID,childAttempt:env.GITHUB_RUN_ATTEMPT});
 mkdirSync(paths.temp,{recursive:true,mode:0o700});const out=join(paths.temp,'supervisor-values');
 // Never use a candidate path or the public log as outcome authority. No bearer is persisted.
 const fd=openSync(out,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);closeSync(fd);
 const observedStore={...store,write(owned){store.write(owned);need(canonical,'supervisor_receipt_missing');record={receipt:canonical,completionDeadline:Math.min(canonical.executionDeadline,runStepDeadline()),container:{...owned},removed:false,ack:null,result:null};save();},remove(owner){store.remove(owner);if(record?.container?.owner===owner){record.removed=true;if(record.result)record.result.cleanupConfirmed=true;save();}}};
 const exporter=ports.exporter??createTraceExporter({stagingRoot:join(paths.temp,'trace-export'),engine:isolation.job.engine});
 let observedTest=null,observedCaptured=false,exportedAt=null,exportDeadline=null;
 const observedExport=async args=>{
  if(observedCaptured)need(JSON.stringify(observedTest)===JSON.stringify(args.observedTest),'supervisor_phase_changed');
  observedCaptured=true;observedTest=structuredClone(args.observedTest);exportDeadline=args.deadline;
  if(args.signal?.aborted||Date.now()>=args.deadline)return {state:'failed',reason:'supervisor_export_budget'};
  const result=await exporter(args);
  if(args.signal?.aborted||Date.now()>=args.deadline)return {state:'failed',reason:'supervisor_export_budget'};
  if(result.state==='complete')exportedAt=Date.now();return result;
 };
 const phase=isolation.job.runCandidateInterruptible;
 isolation.job.runCandidateInterruptible=async args=>{
  const outcome=await phase.call(isolation.job,args);
  if(args.phase==='test'){observedCaptured=true;observedTest=structuredClone(outcome);}
  else if(args.phase==='install'&&outcome.status!=='success'){observedCaptured=true;observedTest={phase:'test',status:'not_run',exitCode:null,signal:null};}
  if(record&&observedCaptured){
   record.observedTest=observedTest;
   // Persist proved negative truth before export or potentially failing cleanup. No success is inferred here.
   if(observedTest?.status==='failure'&&Number.isSafeInteger(observedTest.exitCode)&&observedTest.exitCode>0)record.result={testStep:'failure',executionOutcome:'cleanup_failure',cleanupConfirmed:false,exportComplete:false};
   save();
  }
  return outcome;
 };
 let code;
 try{code=await executeMode('run',{...env,GITHUB_OUTPUT:out},{...deps,store:observedStore,exporter:observedExport});
  need(canonical,'supervisor_receipt_missing');record??={receipt:canonical,completionDeadline:Math.min(canonical.executionDeadline,runStepDeadline()),removed:false,container:null,ack:null,result:null};
  const failed=record.result?.testStep==='failure';let mapped;
  try{mapped=supervisorResult(outputValues(out),{observedTest,removed:record.removed,exportedAt,exportDeadline,observedCaptured,receiptDeadline:record.completionDeadline??canonical.executionDeadline});}
  catch(error){if(!failed)throw error;mapped={testStep:'failure',executionOutcome:'cleanup_failure',cleanupConfirmed:record.removed===true,exportComplete:false};}
  // Later metadata cannot erase a phase failure already captured in durable listener state.
  record.result={...mapped,testStep:failed?'failure':mapped.testStep};save();await report();
 }finally{isolation.job.runCandidateInterruptible=phase;rmSync(out,{force:true});}
 return code===0&&record?.result?.executionOutcome==='timed_out'?124:code;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{process.exitCode=await main(process.argv[2]);}catch{console.error('capacity_supervisor_refused_or_delivery_pending');process.exitCode=1;}
}
