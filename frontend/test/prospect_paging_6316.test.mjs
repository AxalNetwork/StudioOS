/** #6316: mounted pipeline appends only the requested column and preserves cards on a failed page. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import ProspectsTab from '../src/pages/cycles/distribution/ProspectsTab.jsx';
import { PROSPECT_COLUMNS } from '../src/pages/cycles/distribution/prospectsModel';
const card=(uid,status='new')=>({uid,name:uid,status,source:'manual'});

test('second and third pages append independently; failed reads retry without dropping cards',async()=>{
  const calls=[];let fail=true;
  const api={settings:async()=>({settings:null}),suppressions:async()=>({count:0,entries:[]}),list:async params=>{
    calls.push(params);
    if(params.cursor){
      if(fail){fail=false;throw Error('offline');}
      return {available:true,total:250,columns:[{status:'new',count:250,cards:[card(params.cursor==='next'?'Second page':'Third page')],more:params.cursor==='next'?50:0,next_cursor:params.cursor==='next'?'last':null}]};
    }
    return {available:true,total:250,columns:PROSPECT_COLUMNS.map(([status])=>({status,count:status==='new'?250:0,cards:status==='new'?[card('First page')]:[],more:status==='new'?150:0,next_cursor:status==='new'?'next':null}))};
  }};
  const ui=await mountContracts(React.createElement(ProspectsTab,{projectId:7,api,campaignApi:{campaigns:async()=>({campaigns:[]})}}),'/grow/distribution/prospects?project_id=7');
  try{
    await ui.flush();assert.match(ui.text(),/First page/);
    await ui.click('+150 more');await ui.flush();assert.match(ui.text(),/More prospects could not be read/);assert.match(ui.text(),/First page/);
    await ui.click('+150 more');await ui.flush();assert.match(ui.text(),/First page/);assert.match(ui.text(),/Second page/);
    await ui.click('+50 more');await ui.flush();assert.match(ui.text(),/Third page/);assert.doesNotMatch(ui.text(),/\+\d+ more/);
    assert.deepEqual(calls.slice(1).map(c=>c.cursor),['next','next','last']);
    assert.ok(calls.every(c=>c.project===7&&c.per_status===20));
    await ui.click('Website sign-up');await ui.flush();assert.equal(calls.at(-1).source,'website');assert.equal(calls.at(-1).cursor,undefined);assert.doesNotMatch(ui.text(),/Second page|Third page/);
  }finally{await ui.unmount();}
});
