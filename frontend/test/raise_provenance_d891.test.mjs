/** D891: the mounted page cannot promise more than the Worker's room gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { FigureTile } from '../src/pages/cycles/CycleOverview.jsx';
import PhoneCycleRoot from '../src/pages/cycles/PhoneCycleRoot.jsx';
import { FilledMark } from '../src/pages/SpinoutLabMarketPage.jsx';
import { accessNow, noAccessReason } from '../src/pages/raise/dataRoomRead.js';
import { grantOn } from '../src/pages/raise/dataroom/filesModel.js';
import { mountContracts } from './_contracts_dom.mjs';
const now=Date.parse('2026-10-24T12:00:00Z');
test('a fill keeps citations and cost but never displays its model, even in its tooltip',async()=>{
 const m=await mountContracts(React.createElement(FilledMark,{fill:{model:'SYNTHETIC_MODEL_SECRET_LABEL',edited:true,proposed_value:'Prior',citation:{kind:'library',title:'Synthetic source',quote:'Recorded quote'},run:null}}));
 try {const mark=m.nodes().find(n=>m.props(n)?.['data-testid']==='filled-mark');assert.ok(mark);const title=m.props(mark).title;assert.match(title,/Synthetic source/);assert.match(title,/Recorded quote/);assert.match(title,/Run: not recorded/);assert.doesNotMatch(title,/SYNTHETIC_MODEL_SECRET_LABEL|Model:/);assert.match(m.text(),/Eadwyn · edited/);}
 finally {await m.unmount();}
});
test('access requires an unexpired readable grant as well as file tier, expiry and NDA',()=>{
 const g={uid:'g',status:'active',committed:true,nda_signed:true};const f={visibility:'nda',access_tier:'committed'};
 assert.equal(accessNow(f,[g],now).length,1);
 for(const expires_at of ['2000-01-01','2026-10-24 11:59:59','2026-10-24T11:59:59Z','unreadable']) {
  assert.deepEqual(accessNow(f,[{...g,expires_at}],now),[]);assert.match(noAccessReason(f,[{...g,expires_at}],now),/not shared/);
 }
 assert.equal(accessNow(f,[{...g,expires_at:'2026-10-25'}],now).length,1);
 for(const hidden of [{access_tier:'nobody'},{access_expires_at:'2000-01-01'}]) assert.deepEqual(accessNow({...f,...hidden},[g],now),[]);
 assert.deepEqual(accessNow(f,[{...g,committed:false}],now),[]);assert.deepEqual(accessNow(f,[{...g,nda_signed:false}],now),[]);
});
// D1109 (#2989): the access view (FounderRaiseDataRoom) is retired; its matrix is the tool's Access,
// where every cell is `grantOn`. A file no investor may open is never "Can open", and an ended grant opens nothing.
// (Activity's words, where a refusal is never an open, are held by data_room_d1108.)
test('the founder matrix refuses hidden files and an ended grant',()=>{
 const g={uid:'g',status:'active',investor_name:'Synthetic investor',nda_signed:false,committed:false,folders:null};
 const room={files:[],folders:[],grants:[g]};
 const files=[
  {uid:'private',visibility:'open',access_tier:'nobody'},{uid:'expired',visibility:'open',access_expires_at:'2000-01-01'},
  {uid:'committed',visibility:'open',access_tier:'committed'},{uid:'private-nda',visibility:'nda',access_tier:'nobody'},
  {uid:'expired-nda',visibility:'nda',access_expires_at:'2000-01-01'},{uid:'committed-nda',visibility:'nda',access_tier:'committed'},
 ];
 for(const f of files) assert.equal(grantOn(room,f,g,now).open,false,f.uid);
 assert.equal(grantOn(room,{uid:'public',visibility:'open',access_tier:'invited'},g,now).open,true);
 assert.equal(grantOn(room,{uid:'only-nda',visibility:'nda',access_tier:'invited'},g,now).open,false);
 assert.equal(grantOn(room,{uid:'public',visibility:'open',access_tier:'invited'},{...g,expires_at:'2000-01-01'},now).open,false);
});


test('commitment breakdown is visible on desktop and phone, including a missing firm total',()=>{
 const detail='Soft: $100,000 · Signed: $200,000 · Received: $300,000 · Status not recorded: $400,000';
 const fig={key:'committed',label:'Signed or received against target',value:[500000,1000000],unit:'of',state:'ok',reason:detail,delta_30d:null,spark:[],source:'raise_prospects'};
 const desktop=renderToStaticMarkup(React.createElement(FigureTile,{fig}));
 for(const words of ['Soft: $100,000','Signed: $200,000','Received: $300,000','Status not recorded: $400,000']) assert.ok(desktop.includes(words));
 const focus={rule:'card',eyebrow:'Raise',headline:'Review the raise',why:'Recorded evidence',cta:{label:'Open pipeline',href:'/raise/capital-relationships?project=1'},then:null};
 const meter={key:'committed',label:'Signed or received',count:500000,target:1000000,target_reason:null,display:'$500k of $1M',detail};
 const phone=m=>renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(PhoneCycleRoot,{cycle:'raise',raw:{focus,meter:m,index:[],cards:[]},search:'?project_id=1'})));
 assert.ok(phone(meter).includes(detail));
 const missing=phone({...meter,count:null,target:null,display:null});
 assert.match(missing,/Not recorded/);assert.ok(missing.includes('Status not recorded: $400,000'));
 const desktopMissing=renderToStaticMarkup(React.createElement(FigureTile,{fig:{...fig,value:null,state:'not_recorded'}}));
 assert.ok(desktopMissing.includes('Status not recorded: $400,000'));
});
