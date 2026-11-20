/** GR22/26: meeting steps use the stored record; reader controls cannot mutate it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import DurableCompanyRecord,{readonlyCompanyRecord} from '../src/pages/cycles/DurableCompanyRecord.jsx';
import {RecordPhoneProvider} from '../src/pages/cycles/RecordView.jsx';
const record={id:'51',title:'Synthetic board meeting',parts:{meeting:true},facts:[{label:'Due',value:'2026-12-01'},{label:'Owner',action:'pick-owner'}],actions:[{key:'mark-held',label:'Mark held',kind:'form'}],next:{key:'mark-held'},pills:[],activity:[],main:[{key:'agenda',title:'Agenda',action:'add-agenda',rows:[{a:'Approve budget',actions:[{key:'edit-agenda'}]}]},{key:'past-meetings',title:'Past meetings',rows:[{a:'1 Nov',b:'minutes stored',action:{key:'open-minutes'}}]}],side:[{key:'documents',title:'Documents',rows:[{a:'Minutes',b:'Recorded'}]}]};
const render=(r,readOnly,phone)=>renderToStaticMarkup(React.createElement(RecordPhoneProvider,{phone},React.createElement(DurableCompanyRecord,{record:r,readOnly,cycleName:'Grow',moduleName:'Company'})));
test('meeting progression and Pack absence use stored history at desktop and phone widths',()=>{for(const phone of [false,true]){const html=render(record,false,phone);assert.match(html,/Meeting record/);assert.match(html,/1 recorded/);assert.match(html,/Recorded in past meetings/);assert.match(html,/Current due:.*2026-12-01/);assert.match(html,/data-platform-state="not_recorded"/);assert.match(html,/saved meeting pack/);assert.match(html,/Approve budget/);}});
test('reader transformation removes every edit entry without mutating the original record',()=>{const r=readonlyCompanyRecord(record);assert.deepEqual(r.actions,[]);assert.equal(r.next,null);assert.equal(r.facts[1].action,undefined);assert.equal(r.main[0].action,undefined);assert.equal(r.main[0].rows[0].actions,undefined);assert.equal(r.main[1].rows[0].action,undefined);assert.equal(record.main[0].action,'add-agenda');const html=render(record,true,true);assert.match(html,/Read only/);assert.match(html,/Approve budget/);assert.doesNotMatch(html,/<button[^>]*>Mark held/);});
test('a filing never claims to have a board-meeting pack or meeting progression',()=>{const html=render({...record,parts:{meeting:false}},true,false);assert.doesNotMatch(html,/Meeting record|Meeting pack|Current due:/);assert.match(html,/Read only/);});

test('module reader gets checklist and reporting history without writer or cash controls',async()=>{
 const {default:grow}=await import('../src/pages/cycles/defs/grow.jsx');const {mountForm}=await import('./_form_d695.mjs');
 const data={parts:{checklist:[{key:'bank',label:'Bank account',done:false,ticks:'hand'}],updates:[]}};
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({connected:false,items:[],proposals:[]}));
 const ui=await mountForm(grow.parts.get('durable-company-building')(data,{projectId:21,canWrite:false,openAction(){},reload(){}}));
 try{
  // UpdatesHistory is lazy: wait for its content rather than one timer tick.
  const deadline=performance.now()+10000;
  while(!ui.text().includes('Open Reporting')&&performance.now()<deadline)await ui.flush();
  assert.match(ui.text(),/Open Reporting/);assert.match(ui.text(),/only the venture’s team/);assert.doesNotMatch(ui.text(),/Share an update/);assert.equal(ui.by('checklist-tick-bank'),undefined);assert.equal(ui.by('checklist-na-bank'),undefined);}finally{await ui.unmount();globalThis.fetch=oldFetch;}
});
