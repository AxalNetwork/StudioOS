/** D1115: host clock inputs are in the selected event zone, independent of the browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {Routes,Route} from 'react-router-dom';
import {mountContracts} from './_contracts_dom.mjs';
import EventEditorPage from '../src/pages/events/EventEditorPage.jsx';
import {eventLocalInput,eventTimePayload} from '../src/pages/events/eventTimeModel.js';
const h=React.createElement;
test('saved instants display in the event zone and unchanged edits retain seconds and DST occurrence',()=>{
 assert.equal(eventLocalInput('2026-07-12T17:30:00Z','Europe/Lisbon'),'2026-07-12T18:30');
 assert.equal(eventLocalInput('2026-12-12T18:30:00Z','Europe/Lisbon'),'2026-12-12T18:30');
 assert.equal(eventLocalInput('2026-07-12 17:30:00','Europe/Lisbon'),'2026-07-12T18:30');
 assert.equal(eventLocalInput('invalid','Europe/Lisbon'),'');
 const saved={starts_at:'2026-11-01T06:30:19.200Z',ends_at:null,timezone:'America/New_York'};
 const form={starts_at:'2026-11-01T01:30',ends_at:'',timezone:'America/New_York'};
 assert.deepEqual(eventTimePayload(form,saved),saved);
 assert.equal(eventTimePayload({...form,starts_at:'2026-11-02T01:30'},saved).starts_at,'2026-11-02T01:30');
 assert.equal(eventTimePayload({...form,timezone:'UTC'},saved).starts_at,'2026-11-01T01:30');
 assert.equal(eventTimePayload({...form,timezone:'America/Toronto'},saved).starts_at,'2026-11-01T01:30');
 assert.equal(eventTimePayload({starts_at:'2026-07-12T18:30',ends_at:'',timezone:'Europe/Lisbon'},{starts_at:'2026-07-12 17:30:00',ends_at:null,timezone:'Europe/Lisbon'}).starts_at,'2026-07-12T17:30:00Z');
});
test('editing in another browser zone shows the event clock and sends new wall times for Worker conversion',async()=>{
 const oldFetch=globalThis.fetch,oldTZ=process.env.TZ;process.env.TZ='America/Los_Angeles';const writes=[];
 const event={id:1,title:'Synthetic event',status:'draft',starts_at:'2026-07-12T17:30:00Z',ends_at:'2026-07-12T19:00:00Z',timezone:'Europe/Lisbon',visibility:'private',capacity:null};
 globalThis.fetch=async(input,options={})=>{const path=new URL(String(input),'http://local.test').pathname;let body={};
  if(path==='/api/events/1'&&options.method==='PATCH'){writes.push(JSON.parse(options.body));body={event:{...event,starts_at:'2026-07-12T20:00:00.000Z'}};}
  else if(path==='/api/events/1')body={event,agenda:[]};
  else if(path.endsWith('/roster'))body={registrations:[]};
  return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
 };
 let v;try{
  v=await mountContracts(h(Routes,null,h(Route,{path:'/events/:id/edit',element:h(EventEditorPage)})),'/events/1/edit');for(let i=0;i<8;i++)await v.flush();
  const times=v.nodes().filter(n=>v.props(n)?.type==='datetime-local');assert.equal(times.length,2);
  assert.equal(v.props(times[0]).value,'2026-07-12T18:30');assert.equal(v.props(times[1]).value,'2026-07-12T20:00');
  await act(async()=>v.props(times[0]).onChange({target:{value:'2026-07-12T21:00'}}));
  await v.click('Save changes');assert.equal(writes.length,1);assert.equal(writes[0].starts_at,'2026-07-12T21:00');assert.equal(writes[0].ends_at,event.ends_at);assert.equal(writes[0].timezone,'Europe/Lisbon');
 }finally{if(v)await v.unmount();globalThis.fetch=oldFetch;if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ;}
});
