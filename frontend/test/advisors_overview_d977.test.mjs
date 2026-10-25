import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {installDocument} from './_contracts_dom.mjs';
import {apOverviewFixture, recorded} from './_ap_overview_fixture.mjs';
import AdvisorsPartners from '../src/pages/admin/advisors/AdvisorsPartners.jsx';
import {AuthProvider} from '../src/hooks/useAuthSync.jsx';
import {overviewBlocks, overviewNeeds, overviewTiles, stageChart, sessionsChart} from '../src/pages/admin/advisors/apOverviewModel.js';
const h=React.createElement;
const ready = data => ({status:'ready',data});
const error = {available:false,reason:'Synthetic source failure'};
async function mount(data=apOverviewFixture(), {user={id:1,role:'admin'}, initial='/admin/advisors-partners', hold=false, fail=false}={}) {
  const restore=installDocument();const before=globalThis.fetch;
  localStorage.setItem('user',JSON.stringify(user));
  const calls=[];let bad=fail;let answer=data;let release;
  globalThis.fetch=async(input)=>{const path=new URL(String(input),'https://example.test').pathname;calls.push(path);
    if(path==='/api/auth/me')return Response.json(user);
    if(path==='/api/admin/network/overview') {
      if(hold)return new Promise(r=>{release=()=>r(Response.json(answer));});
      return Response.json(bad?{detail:'Synthetic failure'}:answer,{status:bad?503:200});
    }
    return Response.json({});
  };
  const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
  const flush=()=>act(async()=>{for(let i=0;i<6;i++)await new Promise(r=>setTimeout(r,0));});
  await act(async()=>root.render(h(MemoryRouter,{initialEntries:[initial]},h(AuthProvider,null,h(AdvisorsPartners)))));await flush();
  const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];
  const props=n=>Object.entries(n||{}).find(([k])=>k.startsWith('__reactProps$'))?.[1]||{};
  const node=id=>walk(container).find(n=>props(n)['data-testid']===id);
  const text=n=>n?.nodeType===3?n.textContent:n?.childNodes?.length?n.childNodes.map(text).join(''):n?.textContent||'';
  return {calls,node,props,ids:()=>walk(container).map(n=>props(n)['data-testid']).filter(Boolean),tags:(id,tag)=>walk(node(id)).filter(n=>n.tagName===tag),text:(id)=>text(id?node(id):container),flush,
    async click(id){assert.ok(node(id),id);await act(async()=>props(node(id)).onClick());await flush();},
    async retry(){const button=walk(container).find(n=>n.tagName==='BUTTON'&&text(n)==='Try again');assert.ok(button);bad=false;await act(async()=>props(button).onClick());await flush();},
    async release(){await act(async()=>release());await flush();},
    async close(){await act(async()=>root.unmount());globalThis.fetch=before;restore();},
  };
}

test('explicit blocks distinguish missing, unreadable, loading and recorded zero; stages and partial weeks are preserved',()=>{
  const d=apOverviewFixture();let r=ready(d);const b=overviewBlocks(r);
  assert.equal(b.sessions.state,'ready');assert.equal(overviewTiles(b,r).find(t=>t.key==='sessions').text,'17');
  const stages=stageChart(b.stages);assert.equal(stages.rows[0].parts[0].value,2);assert.equal(stages.rows[2].parts.at(-1).value,2);
  const chart=sessionsChart(b.sessions);assert.equal(chart.currentIndex,1);assert.equal(chart.series[2].dash,true);assert.deepEqual(chart.series[0].values,[0,3]);
  d.sessions=recorded({this_month:0,weeks:[]});assert.equal(overviewTiles(overviewBlocks(r),r).find(t=>t.key==='sessions').text,'0');
  d.sessions=error;assert.equal(overviewBlocks(r).sessions.state,'unreadable');
  d.sessions={available:true,recorded:false,reason:'No store'};assert.equal(overviewBlocks(r).sessions.state,'notrecorded');
  assert.equal(overviewBlocks({status:'loading'}).sessions.state,'loading');
  d.sessions=recorded({this_month:null,weeks:[]});assert.equal(overviewBlocks(r).sessions.state,'unreadable');
  d.needs_you.unattached_partners=error;assert.match(overviewTiles(overviewBlocks(r),r).find(t=>t.key==='partners').sub,/Unreadable/);
});

test('mounted overview uses the one summary read, all eight tiles, separated settlement directions, six needs first and Show all',async()=>{
  const ui=await mount();try{
    assert.deepEqual(ui.calls.filter(p=>p.includes('/network/')||p.includes('/partners/')||p.includes('assignable')),['/api/admin/network/overview']);
    assert.match(ui.text('ap-tile-sessions'),/17/);assert.match(ui.text('ap-tile-settlements'),/To members \$125\.00.*From members \$40\.00.*across 2/);
    assert.match(ui.text('ap-needs'),/Showing 6 of 9/);assert.equal(ui.ids().filter(id=>id.startsWith('ap-need-')&&!id.startsWith('ap-need-state-')).length,6);assert.doesNotMatch(ui.text('ap-needs'),/Synthetic deck card/);
    await ui.click('ap-needs-all');assert.match(ui.text('ap-needs'),/Showing 9 of 9/);assert.match(ui.text('ap-needs'),/Synthetic deck card.*\$125\.00.*to a member.*\$40\.00.*from a member/);
    assert.equal(ui.props(ui.node('ap-needs-all'))['aria-expanded'],true);assert.equal(ui.ids().filter(id=>id.startsWith('ap-need-')&&!id.startsWith('ap-need-state-')).length,9);
    assert.equal(overviewNeeds(ready(apOverviewFixture())).rows.length,9);
    for(const id of ['c1','c2','c3','c4']) {assert.ok(ui.node(`ap-chart-${id}`));await ui.click(`ap-${id}-table`);assert.equal(ui.props(ui.node(`ap-${id}-table`))['aria-pressed'],true);assert.equal(ui.tags(`ap-chart-${id}`,'TABLE').length,1);}
    assert.match(ui.text('ap-chart-c1'),/Deck-only names.*2/);assert.match(ui.text('ap-chart-c3'),/Synthetic research0Not recorded/);assert.match(ui.text('ap-chart-c4'),/Not recorded/);
    assert.ok(!ui.node('ap-scope-hq'),'ordinary admin has no HQ-only scope line');
  }finally{await ui.close();}
});

test('each chart and the two new tiles can fail independently without turning a sibling into zero',async()=>{
  for(const [field,id] of [['by_stage','c1'],['sessions','c2'],['skills','c3'],['deals','c4'],['settlements','settlements']]) {
    const d=apOverviewFixture();if(field==='by_stage')d.counts.by_stage=error;else d[field]=error;
    const ui=await mount(d);try{assert.match(ui.text(id==='settlements'?'ap-tile-settlements':`ap-chart-${id}`),/Unreadable.*Try again/);assert.match(ui.text('ap-tile-advisors'),/3/);assert.ok(ui.node('ap-needs'));}finally{await ui.close();}
  }
});

test('loading, no-store, empty, whole-read failure and retry never fabricate a value',async()=>{
  let ui=await mount(apOverviewFixture(),{hold:true});try{assert.match(ui.text('ap-chart-c2'),/Reading…/);assert.doesNotMatch(ui.text('ap-tile-sessions'),/\b0\b/);await ui.release();assert.match(ui.text('ap-tile-sessions'),/17/);}finally{await ui.close();}
  const d=apOverviewFixture();d.settlements={available:true,recorded:false,reason:'Settlements are kept by HQ.'};d.counts.people=recorded(0);
  ui=await mount(d);try{assert.match(ui.text('ap-tile-settlements'),/Not recorded.*kept by HQ/);assert.ok(ui.node('ap-network-empty'));assert.match(ui.text('ap-chart-c3'),/Not recorded.*Founder demand has no matching store/);}finally{await ui.close();}
  ui=await mount(apOverviewFixture(),{fail:true});try{assert.match(ui.text('ap-unreadable'),/Nothing here is a zero/);await ui.retry();assert.match(ui.text('ap-tile-sessions'),/17/);}finally{await ui.close();}
});

test('HQ line is for a Super Admin on HQ only; phone targets and dark blocks remain accessible',async()=>{
  for(const scope of ['hq','test-branch']) {const d=apOverviewFixture();d.scope=scope;const ui=await mount(d,{user:{id:1,role:'admin',is_super_admin:true}});try{assert.equal(Boolean(ui.node('ap-scope-hq')),scope==='hq');assert.match(ui.props(ui.node('ap-chart-c1')).className,/dark:bg-gray-900/);assert.match(ui.props(ui.node('ap-c1-table')).className,/min-h-\[44px\]/);assert.match(ui.props(ui.node('ap-tiles')).className,/grid-cols-2.*lg:grid-cols-4/);}finally{await ui.close();}}
});


test('each failed needs queue is named while readable items and known counts survive', async()=>{
 for(const key of ['unattached_partners','missing_advisor_profiles','ending_deals','pending_hosts','missing_deck_photos','settlements']) {
  const d=apOverviewFixture();d.needs_you[key]=error;const ui=await mount(d);
  try{assert.match(ui.text(`ap-need-state-${key}`),/Unreadable.*Try again/);assert.match(ui.text('ap-needs'),/other queues unread/);assert.doesNotMatch(ui.text('ap-needs'),/Nothing needs you/);assert.match(ui.text('ap-tile-sessions'),/17/);}finally{await ui.close();}
 }
});
