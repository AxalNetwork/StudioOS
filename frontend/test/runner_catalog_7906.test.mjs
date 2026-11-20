/** D7906: exercise the actual bootstrap catalog at the executor boundary, including unverified groups. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveCatalogProfile} from '../../scripts/ci/runners/catalog.mjs';
import {executionTarget} from '../../scripts/ci/runner-admission.mjs';
const catalog=()=>JSON.parse(readFileSync(new URL('../../scripts/ci/runners/profiles.json',import.meta.url),'utf8'));
test('real hosted catalog supplies exact pins and all six shards to the executor',()=>{
 const p=resolveCatalogProfile('hosted');assert.equal(executionTarget(p),'ubuntu-latest');assert.equal(p.nodeVersion,catalog().profiles.hosted.node_version);assert.equal(p.pythonVersion,catalog().profiles.hosted.python_version);assert.equal(p.eligibleShards.length,6);assert.equal(p.approvedGroupId,null);
});
test('real self-hosted catalog stays denied until numeric group approval is recorded',()=>{
 for(const id of ['linux-x64','macos-arm64'])assert.throws(()=>resolveCatalogProfile(id),/approved_group_unverified/);
});
test('reviewed group and native labels map consistently without widening the Mac shard set',()=>{
 const c=catalog();c.self_hosted_group_id=123;
 for(const id of ['linux-x64','macos-arm64']){const p=resolveCatalogProfile(id,c);assert.equal(p.approvedGroupId,123);assert.deepEqual(executionTarget(p),{group:c.self_hosted_group,labels:c.profiles[id].labels});}
 assert.deepEqual(resolveCatalogProfile('macos-arm64',c).eligibleShards,['worker-1-of-6']);
 c.profiles['macos-arm64'].eligibleShards.push('worker-2-of-6');assert.throws(()=>resolveCatalogProfile('macos-arm64',c),/unverified_mac_shards/);
});
test('malformed authority, groups, runtime pins, shard sets and target labels cannot pass translation',()=>{
 for(const mutate of [c=>c.repository='elsewhere/repo',c=>c.self_hosted_group_id=0,c=>c.self_hosted_group_id='123',c=>c.profiles['linux-x64'].node_version='latest',c=>c.profiles['linux-x64'].labels=['self-hosted'],c=>c.profiles['linux-x64'].eligibleShards=[],c=>c.profiles['linux-x64'].eligibleShards=['worker-7-of-6'],c=>c.profiles['linux-x64'].pool='github-hosted']){const c=catalog();c.self_hosted_group_id=123;mutate(c);assert.throws(()=>resolveCatalogProfile('linux-x64',c));}
 assert.throws(()=>resolveCatalogProfile('__proto__'),/unknown_profile/);
});
