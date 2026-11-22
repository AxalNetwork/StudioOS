/** D6018: V10/V11 snapshots never choose a founder decision. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import VerdictHome from '../src/pages/cycles/VerdictHome.jsx';
import {verdictForm} from '../src/pages/cycles/verdictForm.js';
const snapshot={state:'ok',supporting:3,contradicting:1,fit_unrecorded:1,missing_results:1,hypotheses_without_evidence:1,experiments_done:2,results_recorded:1,current:null,coverage:{counted:4,bar:5,state:'withheld',interviews:2,organizations:null}};
const draw=(p,writer=true)=>renderToStaticMarkup(React.createElement(MemoryRouter,{},React.createElement(VerdictHome,{data:{parts:{evidence_state:p,can_write:writer}},projectId:9,records:{cols:[],rows:[],total:0,page:1,page_size:25},recordsStatus:'ready'})));
test('V10: no choice is selected or silently serialized; a rationale is required',()=>{
 assert.equal(verdictForm.fields.find(f=>f.name==='decision').initial,'');
 assert.equal(verdictForm.toBody({}).decision,null);
 assert.equal(verdictForm.fields.find(f=>f.name==='reasoning').required,true);
});
test('V10: missing evidence leads with review, counts are labelled, and history remains available',()=>{
 const html=draw(snapshot);
 for(const word of ['Material evidence is missing','Review evidence','Record a decision anyway','Evidence snapshot','interview relationships','Distinct sources','1 of 2','No decision recorded','Decision history','Not recorded organizations'])assert.ok(html.includes(word),word);
 assert.ok(html.indexOf('verdict-missing')<html.indexOf('verdict-evidence-title'));
 assert.match(html,/\/validate\/experiments\?project=9/);
 assert.doesNotMatch(draw(snapshot,false),/Record a decision anyway/);
});
test('V11: Stop keeps the record and reopens through a new decision, without a Build CTA',()=>{
 const html=draw({...snapshot,current:{id:12,decision:'stop',date:'2026-10-02',reasoning:'Budget did not materialise',evidence:5}});
 for(const word of ['Stop','Budget did not materialise','Review the record','Reopen…','This direction is stopped'])assert.ok(html.includes(word),word);
 assert.doesNotMatch(html,/Plan the build|\/build\/plan/);
 assert.match(draw({...snapshot,current:{id:12,decision:'proceed'}}),/\/build\/plan\?project_id=9/);
 assert.doesNotMatch(draw({...snapshot,current:{id:12,decision:'pivot'}}),/Plan the build/);
});
test('V13: an unreadable snapshot is neither no decision nor no missing evidence',()=>{
 const html=draw({state:'unreadable'});
 assert.match(html,/Evidence snapshot unavailable/);assert.match(html,/Current decision unavailable/);
 assert.doesNotMatch(html,/No decision recorded|Material evidence is missing/);
});
