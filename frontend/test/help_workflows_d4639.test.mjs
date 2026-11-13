// D4639: the new workflow guides must be reachable, role-scoped, discoverable and source-grounded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS, filterSectionsForRole } from '../src/pages/docs/sections/index.js';
import { GUIDE_PLACEMENT } from '../src/pages/docs/guidePlacement.js';
import { buildDocsRecords } from '../src/lib/docs/search.js';
const app=readFileSync(new URL('../src/App.jsx', import.meta.url),'utf8');
const workflow=SECTIONS.find(s=>s.id==='workflows');
const map=Object.fromEntries((workflow?.subsections||[]).map(g=>[g.id,g]));

test('eight documented workflows are registered, placed, and indexed',()=>{
  assert.ok(workflow);
  const ids=['research','email','record-discovery','introductions','build-week','grow','connector-recovery','connected-assistants'];
  assert.deepEqual(Object.keys(map),ids);
  for(const id of ids) {
    assert.ok(GUIDE_PLACEMENT[`workflows/${id}`],id);
    assert.ok(buildDocsRecords('founder').some(r=>r.anchor===`workflows/${id}`),id);
    const g=map[id];
    assert.ok(g.howto.length>=4,id+' needs a task and recovery procedure');
    assert.ok(g.howto.some(s=>s.includes('Outcome:')),id+' needs a recorded task outcome');
    assert.ok(g.pitfalls.length>0,id+' needs a recovery/limitation');
  }
});

test('role-specific research, email, Validate and Grow guides do not broaden permissions',()=>{
  const visible=role=>new Set(filterSectionsForRole(SECTIONS,role).flatMap(s=>s.subsections.map(g=>`${s.id}/${g.id}`)));
  assert.ok(visible('founder').has('workflows/research'));
  assert.ok(visible('investor').has('workflows/email'));
  assert.ok(!visible('investor').has('workflows/record-discovery'));
  assert.ok(!visible('exploring').has('workflows/research'));
  assert.ok(visible('exploring').has('workflows/email'));
  assert.ok(!visible('partner').has('workflows/build-week'));
});

test('task entry routes match mounted current code',()=>{
  for(const p of ['/research/ask','/research/markets','/research/geographies','/research/companies','/research/funds','/research/library','/email','/validate/record','/validate/inbox','/network/introductions','/build/this-week','/build/board','/build/roadmap','/build/cadence','/build/kpi','/grow/focus','/grow/talent','/grow/customers','/grow/partnerships','/grow/launch']){
    assert.ok(app.includes(`path="${p}"`),p+' missing route');
  }
});

test('documentation distinguishes unavailable and unknown states rather than promising success',()=>{
  assert.match(map.email.howto.join(' '),/Failed or Unknown/);
  assert.match(map['record-discovery'].howto.join(' '),/consent/);
  assert.match(map.introductions.howto.join(' '),/NDA/);
  assert.match(map.research.pitfalls.join(' '),/unreadable/);
  assert.match(map['connector-recovery'].howto.join(' '),/Daily limit/);
  assert.match(map['connected-assistants'].howto.join(' '),/Revoke/);
});
