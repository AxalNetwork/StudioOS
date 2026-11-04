// #4418 / W7 #3993 — mounted interactions and the real HTTP client.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { workApi } from '../src/lib/api/work.js';
import { api } from '../src/lib/api.js';
import { workAdapter, WORK_OFF } from '../src/pages/work/workAdapter.js';
import WorkPage, { Board, ItemSheet } from '../src/pages/work/WorkPage.jsx';
const h = React.createElement;
const task = { project: { id: 7 }, uid: 'item-a', title: 'Example task', column: 'ready', assignee: null };
const viewer = { can_manage: true, user_uid: 'person-a' };
async function mount(element) {
 const restore = installDocument(); const container = document.createElement('div'); document.body.appendChild(container);
 const root = createRoot(container);
 const props = n => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
 const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
 const nodes = () => walk(document.body);
 const by = id => nodes().find(n => props(n)['data-testid'] === id);
 const text = n => n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '';
 await act(async () => root.render(element));
 return { by, props, text: () => text(document.body), press: async id => { assert.ok(by(id),id); await act(async () => props(by(id)).onClick()); },
 change: async (id,value) => { await act(async () => props(by(id)).onChange({ target: { value } })); },
 close: async () => { await act(async () => root.unmount()); restore(); } };
}
const routes = [
 ['timeline',[7,12],'GET','/project/7/tasks/12/timeline'],['comment',[7,12,{body:'hello'}],'POST','/project/7/tasks/12/comments'],
 ['editComment',[7,'x/y',{body:'edit'}],'PATCH','/project/7/comments/x%2Fy'],['deleteComment',[7,'x/y'],'DELETE','/project/7/comments/x%2Fy'],
 ['review',[7,12,{decision:'accept'}],'POST','/project/7/tasks/12/review'],['setLabels',[7,12,{labels:['one']}],'PUT','/project/7/tasks/12/labels'],
 ['setMilestone',[7,12,{milestone:'m'}],'PUT','/project/7/tasks/12/milestone'],['drafts',[7],'GET','/project/7/work/drafts'],
 ['acceptDraft',[7,'x/y'],'POST','/project/7/work/drafts/x%2Fy/accept'],['discardDraft',[7,'x/y',{reason:'no'}],'POST','/project/7/work/drafts/x%2Fy/discard'],
 ['labels',[7],'GET','/project/7/work/labels'],['createLabel',[7,{name:'one'}],'POST','/project/7/work/labels'],
 ['updateLabel',[7,'x/y',{name:'two'}],'PATCH','/project/7/work/labels/x%2Fy'],['deleteLabel',[7,'x/y'],'DELETE','/project/7/work/labels/x%2Fy'],
 ['milestones',[7],'GET','/project/7/work/milestones'],['createMilestone',[7,{name:'one'}],'POST','/project/7/work/milestones'],
 ['updateMilestone',[7,'x/y',{name:'two'}],'PATCH','/project/7/work/milestones/x%2Fy'],['deleteMilestone',[7,'x/y'],'DELETE','/project/7/work/milestones/x%2Fy'],
];
test('every W7 client and adapter uses its HTTP route, body and engine-off block',async()=>{
 const restore=installDocument(), previous=globalThis.fetch; const calls=[]; let off=false;
 globalThis.fetch=async(u,o={})=>{calls.push([new URL(String(u),'https://example.test').pathname,o.method||'GET',o.body?JSON.parse(o.body):null]);return new Response(JSON.stringify(off?{error:'agent_engine_off'}:{ok:true}),{status:off?404:200,headers:{'content-type':'application/json'}});};
 try { for(const [name,args,verb,path] of routes){
  off=false; await workApi[name](...args);
  const body=typeof args.at(-1)==='object'?args.at(-1):null;
  assert.deepEqual(calls.at(-1),['/api/teams'+path,verb,body],name);
  assert.deepEqual(await workAdapter[name](...args),{available:true,data:{ok:true}},name);
  off=true; assert.deepEqual(await workAdapter[name](...args),{available:false,reason:WORK_OFF},name);
 }}finally{globalThis.fetch=previous;restore();}
});
test('item sheet Move and Schedule perform writes, and read-only viewers get no Move',async()=>{
 const old={item:workAdapter.item,move:workAdapter.move,schedule:workAdapter.schedule};const calls=[];
 workAdapter.item=async()=>({available:true,data:task});workAdapter.move=async(...args)=>{calls.push(['move',...args]);return {available:true,data:{...task,column:args[1]}};};workAdapter.schedule=async(...args)=>{calls.push(['schedule',...args]);return {available:true,data:task};};
 let m;
 try{m=await mount(h(MemoryRouter,null,h(ItemSheet,{uid:task.uid,projectId:7,viewer,onClose(){}})));
 await m.press('work-item-move');await m.press('work-item-move-done');assert.deepEqual(calls[0],['move','item-a','done']);
 await m.press('work-item-schedule');await m.change('work-schedule-day','2026-11-10');await m.press('work-schedule-save');
 assert.equal(calls[1][0],'schedule');assert.equal(calls[1][1],'item-a');assert.match(calls[1][2].scheduled_start,/2026-11-10/);
 await m.close();m=null;
 m=await mount(h(MemoryRouter,null,h(ItemSheet,{uid:task.uid,projectId:7,viewer:{can_manage:false,user_uid:'other'},onClose(){}})));
 assert.equal(m.by('work-item-move'),undefined);
 }finally{if(m)await m.close();Object.assign(workAdapter,old);}
});
test('Needs-you opens the latest failed run and review filters the board',async()=>{
 const runs=[];const items=[task,{uid:'review',title:'Waiting review',column:'in_review',run:{status:'waiting'}},
 {uid:'older',title:'Old failure',column:'ready',run:{uid:'run-old',status:'failed',ended_at:'2026-11-01T10:00:00Z'}},
 {uid:'newer',title:'New failure',column:'ready',run:{uid:'run-new',status:'failed',ended_at:'2026-11-02T10:00:00Z'}}];
 const m=await mount(h(MemoryRouter,null,h(Board,{items,viewer,onRun:u=>runs.push(u)})));
 try{assert.match(m.text(),/Review 1 item/);await m.press('work-needs-failed');assert.deepEqual(runs,['run-new']);await m.press('work-needs-review');assert.ok(m.by('work-card-review'));assert.equal(m.by('work-card-item-a'),undefined);await m.press('work-review-clear');assert.ok(m.by('work-card-item-a'));}finally{await m.close();}
});
test('?item= opens only this board’s item; a missing uid shows the board and a message',async()=>{
 const old={board:workAdapter.board,burnup:workAdapter.burnup,item:workAdapter.item,run:workAdapter.run};const getProject=api.getProject;const fetch=globalThis.fetch;const reads=[], runs=[];
 api.getProject=async()=>({id:7,name:'Example'});globalThis.fetch=async()=>new Response(JSON.stringify({error:'agent_engine_off'}),{status:404,headers:{'content-type':'application/json'}});
 workAdapter.board=async()=>({available:true,data:{items:[task,{uid:'failure',title:'Failed task',column:'ready',run:{uid:'failed-run',status:'failed',ended_at:'2026-11-01T10:00:00Z'}}],viewer}});workAdapter.burnup=async()=>({available:true,data:{series:[]}});workAdapter.item=async uid=>{reads.push(uid);if(uid==='not-here')throw Object.assign(new Error('Missing'),{status:404});return {available:true,data:task};};
 workAdapter.run=async uid=>{runs.push(uid);return {available:true,data:{detail:{}}};};
 let m;const page=uid=>h(MemoryRouter,{initialEntries:['/projects/7/work?item='+uid]},h(Routes,null,h(Route,{path:'/projects/:id/work',element:h(WorkPage)})));
 try{m=await mount(page('item-a'));assert.ok(m.by('work-item-sheet'));assert.deepEqual(reads,['item-a']);await m.press('work-needs-failed');assert.ok(m.by('work-run-sheet'));assert.deepEqual(runs,['failed-run']);await m.close();m=null;
 m=await mount(page('not-here'));assert.equal(m.by('work-item-sheet'),undefined);assert.ok(m.by('work-board'));assert.match(m.text(),/That task wasn't found\./);assert.deepEqual(reads,['item-a','not-here']);await m.close();m=null;
 workAdapter.board=async()=>({available:true,data:{items:[],viewer}});m=await mount(page('item-a'));assert.ok(m.by('work-item-sheet'));assert.equal(m.by('work-item-missing'),undefined);
 }finally{if(m)await m.close();Object.assign(workAdapter,old);api.getProject=getProject;globalThis.fetch=fetch;}
});


test('a late response from the previous project cannot open its item on the new board', async () => {
 const old={board:workAdapter.board,burnup:workAdapter.burnup,item:workAdapter.item};
 const getProject=api.getProject, fetch=globalThis.fetch;let resolveFirst,navigate;const reads=[];
 api.getProject=async id=>({id,name:'Project '+id});
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'agent_engine_off'}),{status:404,headers:{'content-type':'application/json'}});
 workAdapter.board=id=>String(id)==='7'?new Promise(resolve=>{resolveFirst=resolve;}):Promise.resolve({available:true,data:{items:[{...task,uid:'project-eight'}],viewer}});
 workAdapter.burnup=async()=>({available:true,data:{series:[]}});
 workAdapter.item=async uid=>{reads.push(uid);return {available:true,data:{...task,uid}};};
 function Page(){navigate=useNavigate();return h(WorkPage);}
 let m;
 try {
  m=await mount(h(MemoryRouter,{initialEntries:['/projects/7/work?item=foreign']},h(Routes,null,h(Route,{path:'/projects/:id/work',element:h(Page)}))));
  await act(async()=>navigate('/projects/8/work?item=foreign'));
  await act(async()=>resolveFirst({available:true,data:{items:[{...task,uid:'foreign'}],viewer}}));
  assert.deepEqual(reads,['foreign']);
  assert.equal(m.by('work-item-sheet'),undefined);
  assert.ok(m.by('work-card-project-eight'));
  assert.match(m.text(),/That task wasn't found\./);
 } finally {if(m)await m.close();Object.assign(workAdapter,old);api.getProject=getProject;globalThis.fetch=fetch;}
});


// S1's four confirmed findings: exercise the controls through the mounted UI.
async function withProject(stubs, run) {
 const old = Object.fromEntries(Object.keys(stubs).map(k => [k, workAdapter[k]]));
 const getProject = api.getProject, fetch = globalThis.fetch;
 api.getProject = async () => ({ id: 7, name: 'Example' });
 globalThis.fetch = async () => new Response(JSON.stringify({ error: 'agent_engine_off' }), { status: 404, headers: { 'content-type': 'application/json' } });
 Object.assign(workAdapter, stubs);
 let m;
 try {
  m = await mount(h(MemoryRouter, { initialEntries: ['/projects/7/work?item=item-a'] }, h(Routes, null, h(Route, { path: '/projects/:id/work', element: h(WorkPage) }))));
  await run(m);
 } finally { if (m) await m.close(); Object.assign(workAdapter, old); api.getProject = getProject; globalThis.fetch = fetch; }
}
test('S1 finding 1: a hidden linked item stays open with its schedule notice across board reload', async () => {
 let reads = 0;
 await withProject({
  board: async () => ({ available: true, data: { items: [], viewer } }),
  burnup: async () => ({ available: true, data: { series: [] } }),
  item: async () => { if (++reads > 2) throw new Error('Recheck unavailable'); return { available: true, data: task }; },
  schedule: async () => ({ available: true, data: task }),
 }, async m => {
  const sheet = m.by('work-item-sheet');
  await m.press('work-item-schedule');
  await m.change('work-schedule-day', '2026-11-10');
  await m.press('work-schedule-save');
  assert.ok(m.by('work-item-sheet') === sheet, 'the confirmed sheet must not remount');
  assert.match(m.text(), /is scheduled\./);
  assert.equal(reads, 2, 'reload must not recheck an already confirmed linked item');
 });
});
test('S1 finding 2: review proposals includes waiting runs in Backlog and excludes completed runs', async () => {
 const items = [
  { ...task, uid: 'waiting-backlog', column: 'backlog', run: { status: 'waiting', proposals: 3 } },
  { ...task, uid: 'completed-review', column: 'in_review', run: { status: 'completed', proposals: 8 } },
 ];
 const m = await mount(h(MemoryRouter, null, h(Board, { items, viewer })));
 try {
  assert.match(m.text(), /Review 3 proposals/);
  await m.press('work-needs-review');
  assert.ok(m.by('work-card-waiting-backlog'));
  assert.equal(m.by('work-card-completed-review'), undefined);
 } finally { await m.close(); }
});
test('S1 finding 3: sheet Move and Schedule each refresh the burn-up', async () => {
 let burnReads = 0;
 await withProject({
  board: async () => ({ available: true, data: { items: [task], viewer } }),
  burnup: async () => { burnReads++; return { available: true, data: { series: [] } }; },
  item: async () => ({ available: true, data: task }),
  move: async () => ({ available: true, data: { ...task, column: 'done' } }),
  schedule: async () => ({ available: true, data: task }),
 }, async m => {
  await m.press('work-item-schedule');
  await m.change('work-schedule-day', '2026-11-10');
  await m.press('work-schedule-save');
  assert.equal(burnReads, 2, 'Schedule must refresh the chart');
  await m.press('work-item-move');
  await m.press('work-item-move-done');
  assert.equal(burnReads, 3, 'Move must refresh the chart');
 });
});
test('S1 finding 4: a successful Move clears an earlier refusal notice', async () => {
 const old = { item: workAdapter.item, move: workAdapter.move }; let moves = 0, m;
 workAdapter.item = async () => ({ available: true, data: task });
 workAdapter.move = async () => ++moves === 1 ? { available: false, reason: 'Move refused by Worker.' } : { available: true, data: { ...task, column: 'done' } };
 try {
  m = await mount(h(MemoryRouter, null, h(ItemSheet, { uid: task.uid, projectId: 7, viewer, onClose() {} })));
  await m.press('work-item-move');
  await m.press('work-item-move-done');
  assert.match(m.text(), /Move refused by Worker/);
  await m.press('work-item-move-done');
  assert.doesNotMatch(m.text(), /Move refused by Worker/);
 } finally { if (m) await m.close(); Object.assign(workAdapter, old); }
});
