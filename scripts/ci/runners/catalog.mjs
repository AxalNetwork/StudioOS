/** D7906: translate the trusted bootstrap catalog into executor/coordinator profiles; no caller-supplied targets. */
import { readFileSync } from 'node:fs';
import { executionTarget } from '../runner-admission.mjs';
const SHARD=/^worker-[1-6]-of-6$/;
const requireThat=(ok,reason)=>{if(!ok)throw new Error(reason);};
// D7907: github-8 is GitHub-hosted included compute in its own group, never an alias of the self-hosted pool.
const POOLS={hosted:'github-hosted','github-8':'github-hosted-included','linux-x64':'self-hosted','macos-arm64':'self-hosted'};
export function resolveCatalogProfile(id,catalog=JSON.parse(readFileSync(new URL('./profiles.json',import.meta.url),'utf8'))){
 requireThat(catalog?.schema_version===1&&catalog.repository==='AxalNetwork/StudioOS'&&catalog.organization==='AxalNetwork','invalid_profile_catalog');
 requireThat(Object.hasOwn(POOLS,id),'unknown_profile');
 const row=Object.hasOwn(catalog.profiles??{},id)?catalog.profiles[id]:null;
 requireThat(row&&Array.isArray(row.eligibleShards)&&row.eligibleShards.length>0&&new Set(row.eligibleShards).size===row.eligibleShards.length&&row.eligibleShards.every(shard=>SHARD.test(shard)),'invalid_profile_shards');
 requireThat(row.pool===POOLS[id],'invalid_profile_pool');
 const hosted=id==='hosted',included=id==='github-8';
 if(included)requireThat(Number.isSafeInteger(row.runner_group_id)&&row.runner_group_id>0&&row.runner_group!==catalog.self_hosted_group,'included_group_unverified');
 else if(!hosted)requireThat(Number.isSafeInteger(catalog.self_hosted_group_id)&&catalog.self_hosted_group_id>0,'approved_group_unverified');
 const target=hosted?row.runs_on:included?{group:row.runner_group,labels:[row.runner_label]}:{group:catalog.self_hosted_group,labels:[...(row.labels??[])]};
 const result={id,platform:row.github_os==='Linux'?'linux':row.github_os==='macOS'?'darwin':null,arch:row.github_arch==='X64'?'x64':row.github_arch==='ARM64'?'arm64':null,nodeVersion:row.node_version,pythonVersion:row.python_version,eligibleShards:[...row.eligibleShards],target,approvedGroupId:hosted?null:included?row.runner_group_id:catalog.self_hosted_group_id};
 executionTarget(result);
 return result;
}
