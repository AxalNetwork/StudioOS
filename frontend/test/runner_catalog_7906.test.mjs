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
test('real self-hosted catalog resolves the operator-verified group and native targets',()=>{
 const expected={
  'linux-x64':{labels:['self-hosted','Linux','X64','studioos-worker-v1'],shards:Array.from({length:6},(_,i)=>`worker-${i+1}-of-6`)},
  'macos-arm64':{labels:['self-hosted','macOS','ARM64','studioos-worker-v1'],shards:['worker-1-of-6']}
 };
 for(const [id,{labels,shards}] of Object.entries(expected)){
  const p=resolveCatalogProfile(id);
  assert.equal(p.approvedGroupId,5);
  assert.deepEqual(executionTarget(p),{group:'StudioOS Worker Pool',labels});
  assert.deepEqual(p.eligibleShards,shards);
 }
});
test('missing or invalid group approval still refuses both self-hosted profiles',()=>{
 for(const groupId of [null,undefined,0,-1,5.5,'5']){
  const c=catalog();
  if(groupId===undefined)delete c.self_hosted_group_id;
  else c.self_hosted_group_id=groupId;
  for(const id of ['linux-x64','macos-arm64'])assert.throws(()=>resolveCatalogProfile(id,c),/approved_group_unverified/);
 }
});
test('recording the group does not widen the Mac shard set',()=>{
 const c=catalog();
 c.profiles['macos-arm64'].eligibleShards.push('worker-2-of-6');assert.throws(()=>resolveCatalogProfile('macos-arm64',c),/unverified_mac_shards/);
});
test('malformed authority, groups, runtime pins, shard sets and target labels cannot pass translation',()=>{
 for(const mutate of [c=>c.repository='elsewhere/repo',c=>c.self_hosted_group_id=0,c=>c.self_hosted_group_id='123',c=>c.profiles['linux-x64'].node_version='latest',c=>c.profiles['linux-x64'].labels=['self-hosted'],c=>c.profiles['linux-x64'].eligibleShards=[],c=>c.profiles['linux-x64'].eligibleShards=['worker-7-of-6'],c=>c.profiles['linux-x64'].pool='github-hosted']){const c=catalog();c.self_hosted_group_id=123;mutate(c);assert.throws(()=>resolveCatalogProfile('linux-x64',c));}
 assert.throws(()=>resolveCatalogProfile('__proto__'),/unknown_profile/);
});
