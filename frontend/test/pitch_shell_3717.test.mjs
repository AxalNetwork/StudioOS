/** #3717: real pitch frames over synthetic reads; no accounts or live writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { routeBlock } from './_routes.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { api } from '../src/lib/api.js';
import { cyclesApi } from '../src/lib/api/cycles.js';
import { deckEditorApi } from '../src/lib/api/deckEditor.js';
import { deckSourcesApi } from '../src/lib/api/deckSources.js';
import { newDeckApi } from '../src/lib/api/newDeck.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { SHARED_FULL_BLEED_PREFIXES } from '../src/sidebarConfig.js';
import { CYCLE_GUTTER } from '../src/pages/cycles/cyclePaths.js';
import PitchPage from '../src/pages/raise/pitch/PitchPage.jsx';
import PitchStudio from '../src/pages/raise/pitch/PitchStudio.jsx';
import NewDeck from '../src/pages/raise/pitch/NewDeck.jsx';
import PitchEditor from '../src/pages/raise/pitch/PitchEditor.jsx';

const h=React.createElement;
const read=(path)=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const MODEL={grid:{cols:12,rows:6},max_blocks:24,notes_max:4000,layouts:[{id:'statement',label:'Statement',blocks:[]}],block_kinds:['text'],chart_types:[],chart_ranges:[],text_styles:['heading'],image_tags:[],video_ratios:[],audiences:['seed_fund'],themes:['brand']};
const SLIDES=Array.from({length:8},(_,i)=>({title:`Synthetic card ${i+1}`,headline:'Synthetic heading',fields:[]}));
const DECK={id:31,project_id:7,version:3,title:'Synthetic deck',audience:'seed_fund',slides:SLIDES,created_at:'2026-10-30 10:00:00'};
const USER={id:2,role:'founder',founder_id:20,name:'Synthetic Founder'};
const SOURCES={project_id:7,items:[],coverage:{slots:0,filled:0,by_grade:{},not_recorded:0,unreadable:0}};
const groups={api,cyclesApi,deckEditorApi,deckSourcesApi,newDeckApi};

async function mount(Component,url,over={}) {
  const originals=Object.fromEntries(Object.entries(groups).map(([key,value])=>[key,{...value}]));
  Object.assign(api,{getMe:async()=>USER,listProjects:async()=>[{id:7,name:'Synthetic venture'}],
    deckListVersions:async()=>({versions:[{id:31,version:3,is_current:true}],proposal:{id:77,slides:SLIDES,outline:{rows:[]},kept:[]}}),
    deckGet:async()=>DECK,deckEngagement:async()=>({views:[],totals:null}),deckMethods:async()=>({methods:[]}),deckRecommend:async()=>({}),...over});
  cyclesApi.module=async()=>({card:{},records:[]});
  Object.assign(deckEditorApi,{model:async()=>MODEL,brandKit:async()=>({kit:null}),chartSeries:async()=>({series:[]})});
  Object.assign(deckSourcesApi,{list:async()=>SOURCES,refresh:async()=>({rows:[]})});
  Object.assign(newDeckApi,{context:async()=>({audiences:[{id:'seed_fund',label:'Seed fund'}],lengths:[{id:'standard',label:'Standard'}],cards:[],standard:{},round:null,averages:{},prompt_max:500}),quote:async()=>({ai:false,reason:'synthetic'})});
  const fetchBefore=globalThis.fetch;
  const restore=installDocument();
  globalThis.fetch=async()=>Response.json({});
  localStorage.setItem('user',JSON.stringify(USER));
  localStorage.setItem('pitch-editor:first-run','1');
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  const settle=()=>act(async()=>{for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,0));});
  await act(async()=>{root.render(h(MemoryRouter,{initialEntries:[url]},h(AuthProvider,null,h(Component))));});
  await settle();
  const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];
  const pr=n=>Object.entries(n||{}).find(([key])=>key.startsWith('__reactProps$'))?.[1]||{};
  const text=n=>(!n?'':n.nodeType===3?n.textContent||'':n.childNodes?.length?n.childNodes.map(text).join(' '):n.textContent||'').replace(/\s+/g,' ').trim();
  return {container,walk,pr,text,settle,by:id=>walk(container).find(n=>pr(n)['data-testid']===id),
    async close(){await act(async()=>root.unmount());restore();globalThis.fetch=fetchBefore;for(const [key,value]of Object.entries(groups))Object.assign(value,originals[key]);}};
}

test('pitch routes own their one page frame and keep the existing access boundaries',()=>{
  const app=codeOnly(read('App.jsx'));
  for(const path of ['/raise/pitch','/raise/pitch/new','/raise/pitch/edit','/raise/pitch/analytics','/raise/pitch/review','/raise/pitch/notes']) {
    const block=routeBlock(app,path);
    assert.ok(block,path);
    assert.doesNotMatch(block,/founderEditor\(|founderWorkspace\(/,path);
    assert.match(block,/guard\(/,path);
  }
  assert.match(routeBlock(app,'/raise/pitch'),/PitchBoundary/);
  assert.match(routeBlock(app,'/raise/pitch/present'),/founderEditor\(<PitchPresent/);
});

test('all pitch children use the shared full-width shell rule',()=>{
  assert.ok(SHARED_FULL_BLEED_PREFIXES.includes('/raise/pitch/'));
  for(const path of ['/raise/pitch/new','/raise/pitch/edit','/raise/pitch/analytics','/raise/pitch/review','/raise/pitch/notes'])assert.ok(SHARED_FULL_BLEED_PREFIXES.some(prefix=>path.startsWith(prefix)),path);
});

test('the common frame is outermost, with the cycle gutter and responsive back paths',()=>{
  const out=renderToStaticMarkup(h(MemoryRouter,{initialEntries:['/raise/pitch/new?project_id=7']},h(PitchPage,{rail:h('aside',null,'Synthetic rail'),crumb:{trail:'New deck'},testId:'synthetic-frame'},'Synthetic body')));
  assert.match(out,/^<div class="fwr-frame pitch-page-frame" data-rail="true"/);
  assert.equal((out.match(/aria-label="Breadcrumb"/g)||[]).length,1);
  assert.match(out,/href="\/raise\?project_id=7"/);
  assert.match(out,/href="\/raise\/pitch\?project_id=7"/);
  assert.match(out,/min-h-\[44px\][^"]*sm:hidden/);
  assert.match(out,/dark:text-gray-400/);
  assert.match(out,/@container\/cycle/);
  assert.match(read('pages/raise/pitch/PitchPage.css'),/\[data-app-main\]:has\(> \.pitch-page-frame\)/);
  assert.match(read('pages/raise/pitch/PitchPage.css'),/flex: 1 0 auto/);
  assert.ok(out.includes(CYCLE_GUTTER));
  assert.match(read('pages/cycles/CycleRoute.jsx'),/className=\{CYCLE_GUTTER\}/);
  assert.match(read('pages/raise/pitch/PitchPage.jsx'),/\$\{CYCLE_GUTTER\}/);
  assert.match(read('pages/raise/pitch/PitchPage.jsx'),/className="shrink-0 lg:hidden">\s*<EadwynButton/);
});

test('studio, New deck and editor render one crumb, no nested founder frame, and one rail',async()=>{
  for(const [Component,url,id,current,links]of [
    [PitchStudio,'/raise/pitch?project_id=7','pitch-studio','Pitch deck',['/raise?project_id=7']],
    [NewDeck,'/raise/pitch/new?project_id=7&proposal=77','pitch-new','New deck',['/raise?project_id=7','/raise/pitch?project_id=7']],
    [PitchEditor,'/raise/pitch/edit?project_id=7','pitch-editor','Synthetic venture · v3',['/raise?project_id=7','/raise/pitch?project_id=7']],
  ]) {
    const m=await mount(Component,url);
    try {
      const nodes=m.walk(m.container),crumbs=nodes.filter(n=>m.pr(n)['aria-label']==='Breadcrumb');
      assert.equal(crumbs.length,1,id);
      assert.equal(m.text(m.walk(crumbs[0]).find(n=>m.pr(n)['aria-current']==='page')),current,id);
      assert.deepEqual(m.walk(crumbs[0]).filter(n=>n.tagName==='A').map(n=>m.pr(n).href),links,id);
      assert.equal(m.container.childNodes.find(n=>n.nodeType===1)===m.by(id),true,id);
      assert.match(m.pr(m.by(id)).className,/^fwr-frame/);
      assert.equal(m.pr(m.by(id))['data-rail'],'true');
      assert.equal(nodes.filter(n=>m.pr(n)['data-testid']==='worker-rail-frame').length,1);
      assert.doesNotMatch(m.text(m.container),/‹ Pitch deck studio|Get capital, stay legal/);
      assert.equal(nodes.some(n=>['founder-module-back','founder-workspace-raise','heading-founder-raise'].includes(m.pr(n)['data-testid'])),false);
      if(id==='pitch-editor') {
        assert.ok(m.by('pitch-editor-rail'));
        const bar=m.by('pitch-editor-bar');
        const title=m.walk(bar).find(n=>String(m.pr(n).className).includes('truncate text-[15px]'));
        assert.equal(m.text(title),current);
        const grid=nodes.find(n=>String(m.pr(n).className).includes('lg:grid-cols-[180px_minmax(0,1fr)]'));
        assert.match(m.pr(grid).className,/2xl:grid-cols-\[200px_minmax\(0,1fr\)_320px\]/);
        assert.ok(nodes.some(n=>String(m.pr(n).className).includes('lg:col-start-2 2xl:col-start-auto')));
      }
      if(id==='pitch-new') {
        const proposal=m.by('pitch-new-proposal');
        assert.ok(proposal);
        const list=m.walk(proposal).find(n=>n.tagName==='OL');
        assert.match(m.pr(list).className,/sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4/);
        assert.doesNotMatch(m.pr(proposal.parentNode).className,/grid-cols-\[minmax\(0,1fr\)_minmax/);
      }
      if(id==='pitch-studio') {
        const grid=nodes.find(n=>String(m.pr(n).className).includes('2xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]'));
        assert.ok(grid);
        const aside=nodes.find(n=>m.pr(n)['aria-label']==='Readers');
        assert.match(m.pr(aside).className,/md:grid-cols-2 2xl:grid-cols-1/);
      }
    } finally {await m.close();}
  }
});


test('editor keeps the same frame, dock and moved notice when its deck finishes loading',async()=>{
  let resolveDeck;
  const pending=new Promise(resolve=>{resolveDeck=resolve;});
  const m=await mount(PitchEditor,'/raise/pitch/edit?project_id=7&moved=pitch-workspace',{deckGet:()=>pending});
  try {
    const frame=m.by('pitch-editor'),dock=m.by('worker-rail-frame'),notice=m.by('pitch-moved');
    assert.ok(m.by('pitch-editor-loading'));
    assert.ok(dock);
    assert.ok(notice);
    await act(async()=>{resolveDeck(DECK);});
    await m.settle();
    assert.ok(m.by('pitch-editor-bar'));
    assert.equal(m.by('pitch-editor')===frame,true);
    assert.equal(m.by('worker-rail-frame')===dock,true);
    assert.equal(m.by('pitch-moved')===notice,true);
    assert.match(m.text(m.by('pitch-crumb')),/Synthetic venture · v3/);
  } finally {await m.close();}
});
