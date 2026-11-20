/** D7906: translate the trusted bootstrap catalog into executor/coordinator profiles; no caller-supplied targets. */
import { readFileSync } from 'node:fs';
import { executionTarget } from '../runner-admission.mjs';
const SHARD=/^worker-[1-6]-of-6$/;
const requireThat=(ok,reason)=>{if(!ok)throw new Error(reason);};
export function resolveCatalogProfile(id,catalog=JSON.parse(readFileSync(new URL('./profiles.json',import.meta.url),'utf8'))){
 requireThat(catalog?.schema_version===1&&catalog.repository==='AxalNetwork/StudioOS'&&catalog.organization==='AxalNetwork','invalid_profile_catalog');
 requireThat(['hosted','linux-x64','macos-arm64'].includes(id),'unknown_profile');
 const row=catalog.profiles?.[id];
 requireThat(row&&Array.isArray(row.eligibleShards)&&row.eligibleShards.length>0&&new Set(row.eligibleShards).size===row.eligibleShards.length&&row.eligibleShards.every(shard=>SHARD.test(shard)),'invalid_profile_shards');
 const hosted=id==='hosted';
 requireThat(row.pool===(hosted?'github-hosted':'self-hosted'),'invalid_profile_pool');
 if(!hosted)requireThat(Number.isSafeInteger(catalog.self_hosted_group_id)&&catalog.self_hosted_group_id>0,'approved_group_unverified');
 const result={id,platform:row.github_os==='Linux'?'linux':row.github_os==='macOS'?'darwin':null,arch:row.github_arch==='X64'?'x64':row.github_arch==='ARM64'?'arm64':null,nodeVersion:row.node_version,pythonVersion:row.python_version,eligibleShards:[...row.eligibleShards],target:hosted?row.runs_on:{group:catalog.self_hosted_group,labels:[...(row.labels??[])]},approvedGroupId:hosted?null:catalog.self_hosted_group_id};
 executionTarget(result);
 return result;
}
