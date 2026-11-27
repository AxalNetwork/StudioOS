import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { Editor } from '../src/pages/hq/aiAgents/HqAiAgentsPage.jsx';
import { adminHqSkillsApi as api } from '../src/lib/api/adminHqSkills.js';
test('skill detail fetches full content and retries failed reads', async () => {
 const old=api.get;let failed=true;const seen=[];
 api.get=async uid=>{seen.push(uid);if(failed)throw Error('private');return {skill:{uid,name:'Owner resolution',purpose:'Resolve owners from records',steps:['Match named owners'],tools:['records.read'],output_kind:'proposal',status:'draft'},cases:[],evals:{pass:0,total:0},review:{approved:false,history:[]},versions:[]};};
 const ui=await mountContracts(React.createElement(Editor,{view:{skill:'skill1'}}));
 try {await ui.flush();assert.match(ui.text(),/could not be read/);assert.doesNotMatch(ui.text(),/private|No steps recorded/);failed=false;await ui.click('Try again');await ui.flush();assert.match(ui.text(),/Resolve owners from records/);assert.match(ui.text(),/Match named owners/);assert.match(ui.text(),/records.read/);assert.match(ui.text(),/Golden cases/);assert.doesNotMatch(ui.text(),/Not switched on yet/);assert.deepEqual(seen,['skill1','skill1']);}
 finally {await ui.unmount();api.get=old;}
});
