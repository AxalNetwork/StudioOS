// D4641 (#4641): source-truthful content ownership without manufactured verification dates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS } from '../src/pages/docs/sections/index.js';
import { PRIORITY_HELP_REVIEW, guideReviewFor, contentReviewItems } from '../src/pages/docs/guideGovernance.js';

test('every priority entry names an existing guide and a responsible team',()=>{
  const anchors=new Set(SECTIONS.flatMap(s=>s.subsections.map(g=>`${s.id}/${g.id}`)));
  for(const [anchor,meta] of Object.entries(PRIORITY_HELP_REVIEW)){
    assert.ok(anchors.has(anchor),anchor);
    assert.ok(meta.owner.startsWith('Axal VC '),anchor);
    assert.equal(meta.lastVerifiedAt,null,'do not invent verification dates');
    assert.equal(guideReviewFor(anchor).status,'Verification pending');
  }
  assert.equal(guideReviewFor('unknown/guide').owner,'Unassigned');
});

test('negative answers become assigned review candidates without inventing completed tasks',()=>{
  const view={guides:[{anchor:'account/privacy',title:'Privacy',no:3,yes:1},{anchor:'account/tiers',title:'Plans',no:1,yes:7},{anchor:'changelog/release-notes',title:'Release notes',no:0,yes:8}],missing:[{anchor:'account/privacy',text:'Need export scope'}]};
  const q=contentReviewItems(view);
  assert.deepEqual(q.map(x=>x.anchor),['account/privacy','account/tiers']);
  assert.equal(q[0].owner,'Axal VC Privacy & Support');
  assert.equal(q[0].negativeAnswers,3);
  assert.equal(q[0].missingNotes,1);
  assert.equal(q[0].status,'Verification pending');
  assert.equal(contentReviewItems(null),null,'unreadable feedback is not an empty queue');
});

test('PRs require a Help impact decision even when no documentation change is needed',()=>{
  const template=readFileSync(new URL('../../.github/pull_request_template.md',import.meta.url),'utf8');
  assert.match(template,/## Help impact/);
  assert.match(template,/Link the updated Help guide\(s\)/);
  assert.match(template,/OR say "None" and explain why/);
  const signals=readFileSync(new URL('../src/pages/docs/HelpSignals.jsx',import.meta.url),'utf8');
  assert.match(signals,/contentReviewItems\(v\)/);
  assert.match(signals,/guideReviewFor\(g.anchor\).owner/);
});
