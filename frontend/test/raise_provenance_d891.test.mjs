/** D891: the mounted page cannot promise more than the Worker's room gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { FilledMark } from '../src/pages/SpinoutLabMarketPage.jsx';
import FounderRaiseDataRoom from '../src/pages/founder/FounderRaiseDataRoom.jsx';
import { accessNow, noAccessReason, roomStats } from '../src/pages/raise/dataRoomRead.js';
import { api } from '../src/lib/api.js';
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
 assert.equal(roomStats({grants:[{...g,expires_at:'2000-01-01'}]})[2].v,'0');
});
test('the founder matrix refuses hidden files and file activity excludes blocked and room-open events',async()=>{
 const prior={listProjects:api.listProjects,dataRoom:api.dataRoom};
 const g={uid:'g',status:'active',investor_name:'Synthetic investor',nda_signed:false,committed:false};
 api.listProjects=async()=>[{id:1,uid:'synthetic-venture',name:'Synthetic venture'}];
 api.dataRoom=async()=>({files:[
  {uid:'private',name:'Private file',visibility:'open',access_tier:'nobody'},
  {uid:'expired',name:'Expired file',visibility:'open',access_expires_at:'2000-01-01'},
  {uid:'committed',name:'Committed file',visibility:'open',access_tier:'committed'},
  {uid:'public',name:'Downloadable file',visibility:'open',access_tier:'invited'},
  {uid:'private-nda',name:'Private NDA file',visibility:'nda',access_tier:'nobody'},
  {uid:'expired-nda',name:'Expired NDA file',visibility:'nda',access_expires_at:'2000-01-01'},
  {uid:'committed-nda',name:'Committed NDA file',visibility:'nda',access_tier:'committed'},
  {uid:'only-nda',name:'NDA only file',visibility:'nda',access_tier:'invited'},
 ],grants:[g,{...g,uid:'expired-grant',expires_at:'2000-01-01'}],folders:[],recent_access:[
  {action:'blocked',file_name:'Private file'},{action:'blocked',file_name:'Private file'},
  {action:'open_room',file_name:'Private file'},{action:'download',file_name:'Downloadable file'},
 ]});
 const m=await mountContracts(React.createElement(FounderRaiseDataRoom),'/raise/data-room?project_id=1');
 try {await m.flush();const nodeText=n=>n.nodeType===3?n.textContent:n.childNodes?.map(nodeText).join('')||n.textContent||'';
  const row=id=>m.nodes().find(n=>m.props(n)?.['data-testid']===`row-data-room-file-${id}`);
  for(const id of ['private','expired','committed','private-nda','expired-nda','committed-nda']){assert.match(nodeText(row(id)),/None/);assert.doesNotMatch(nodeText(row(id)),/Granted/);}
  assert.match(nodeText(row('public')),/Granted/);
  assert.match(nodeText(row('only-nda')),/NDA gated/);assert.doesNotMatch(nodeText(row('only-nda')),/Granted/);
  const stat=m.nodes().find(n=>n.tagName==='DIV' && n.className==='fr-capital-stat-strip');
  // The label and count travel together in the same mounted tile.
  const tiles=m.nodes().filter(n=>m.props(n)?.className?.includes('fr-capital-stat'));
  const activity=tiles.find(n=>/^Items viewed/.test(nodeText(n)));assert.ok(activity);assert.match(nodeText(activity),/^Items viewed1/);
  const most=tiles.find(n=>/^Most viewed/.test(nodeText(n)));assert.ok(most);assert.match(nodeText(most),/Downloadable file/);assert.doesNotMatch(nodeText(most),/Private file/);
 }finally {await m.unmount();Object.assign(api,prior);}
});
