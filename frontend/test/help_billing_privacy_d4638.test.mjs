// D4638: the published Help catalogue describes the real plan and export contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import account from '../src/pages/docs/sections/account.js';
import gettingStarted from '../src/pages/docs/sections/getting-started.js';
const guide=(arr,id)=>arr.subsections.find(g=>g.id===id);
const contents=(g)=>[g.overview,...(g.howto||[]),...(g.tips||[]),...(g.pitfalls||[])].join('\n');
const worker=readFileSync(new URL('../../cloudflare-worker/src/routes/settings.ts', import.meta.url),'utf8');
test('founder plans follow current catalogue names, no old offer labels',()=>{
  const g=contents(guide(account,'tiers'));
  assert.match(g,/Free, Validate \+ Build, and Raise \+ Grow/);
  assert.doesNotMatch(g,/Growth for active founders|Studio for studio operators/);
  assert.match(contents(guide(gettingStarted,'pricing-demo')),/Validate \+ Build and Raise \+ Grow/);
});
test('subscription, AI allowance, tokens, introductions and Perks remain separate',()=>{
  const g=contents(guide(account,'balances'));
  for(const name of ['Subscription/licence','Included AI allowance','Purchased AI tokens','Introduction allowance','Perks credits'])assert.ok(g.includes(name),name);
  assert.match(g,/do not expire/);
  assert.match(g,/An unreadable balance is not zero/);
});
test('export guide matches the Worker JSON endpoint instead of promising every record',()=>{
  const g=contents(guide(account,'privacy'));
  for(const field of ['user: userRow[0]','recent_activity: activity','agents,','LIMIT 500','For a full export across all sub-systems'])assert.ok(worker.includes(field),field);
  assert.match(g,/500 records/);
  assert.match(g,/does not contain the full deals, projects or KYC datasets/);
  assert.match(g,/private relationship notes are not included/);
  assert.doesNotMatch(g,/export everything we hold/);
});
test('privacy labels match effective profile values and Eadwyn scope is permission-specific',()=>{
  const privacy=contents(guide(account,'privacy'));
  assert.match(privacy,/Public, Members only or Hidden/);
  assert.match(privacy,/public, network and private/);
  const help=contents(guide(gettingStarted,'help-and-shortcuts'));
  const ai=contents(guide(gettingStarted,'personal-advisor'));
  assert.match(help,/does not receive blanket access/);
  assert.match(ai,/surface- and permission-specific/);
  assert.doesNotMatch(help,/knows your startups/);
});
