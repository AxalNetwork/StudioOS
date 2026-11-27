/** D1115: counts from uncapped paged rows, truthful failures, waiting sort and review words. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {installDocument} from './_contracts_dom.mjs';
import {createRoot} from 'react-dom/client';
import AdminEventsPage from '../src/pages/admin/AdminEventsPage.jsx';
import EventPage from '../src/pages/admin/events/EventPage.jsx';
import {filteredRows,readQuery} from '../src/pages/admin/events/allEventsModel.js';
import {reviewFacts} from '../src/pages/admin/events/reviewModel.js';
import {refusalText,listCounts,countsFor} from '../src/pages/admin/events/eventsDeskModel.js';
const h=React.createElement,ready=data=>({status:'ready',data});
const ev=(id,extra={})=>({id,title:'Synthetic event '+id,starts_at:'2099-01-12T17:30:00Z',ends_at:null,timezone:'Europe/Lisbon',status:'published',visibility:'private',capacity:100,seats_taken:2,attended:0,waitlisted:0,price_cents:0,...extra});
const text=n=>n?.nodeType===3?n.textContent:n?.childNodes?.length?n.childNodes.map(text).join(''):n?.textContent||'';
const byId=(v,id)=>v.nodes().find(n=>v.props(n)?.['data-testid']===id);
async function mounted(url,items){
 const old={fetch:globalThis.fetch,matchMedia:globalThis.matchMedia};const requests=[];
 globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 globalThis.fetch=async input=>{const u=new URL(String(input),'http://local.test');requests.push(u.pathname+u.search);
  let body={};if(u.pathname==='/api/admin/events'){const rows=u.searchParams.get('status')==='pending_review'?[]:items;const offset=Number(u.searchParams.get('offset'));body={events:rows.slice(offset,offset+200),total:rows.length};}
  if(u.pathname.endsWith('/analytics'))return new Response('{}',{status:503});
  return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
 };
 let v;const restore=installDocument('',{focus:true});const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
 try{localStorage.setItem('user',JSON.stringify({id:1,role:'admin'}));await act(async()=>root.render(h(MemoryRouter,{initialEntries:[url]},h(AdminEventsPage))));
 const nodes=()=>{const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];return walk(container);};const props=n=>Object.entries(n).find(([k])=>k.startsWith('__reactProps$'))?.[1];
 v={nodes,props,text:()=>text(container),async flush(){await act(async()=>{await new Promise(r=>setTimeout(r,0));});},async unmount(){await act(async()=>root.unmount());restore();}};
 for(let i=0;i<10;i++)await v.flush();}
 catch(e){globalThis.fetch=old.fetch;globalThis.matchMedia=old.matchMedia;throw e;}
 return {...v,requests,async close(){await v.unmount();globalThis.fetch=old.fetch;globalThis.matchMedia=old.matchMedia;}};
}
test('All events and Calendar retain counts beyond row 200 without reading analytics',async()=>{
 const items=Array.from({length:205},(_,i)=>ev(i+1,{seats_taken:i===204?73:2}));
 const all=await mounted('/admin/events/all?sort=taken',items);
 try{assert.ok(all.requests.some(u=>u.includes('offset=200')));assert.equal(all.requests.some(u=>u.includes('/analytics')),false);assert.match(all.text(),/Synthetic event 205/);assert.doesNotMatch(all.text(),/Not in this read|Seat counts could not be read/);assert.match(all.text(),/73/);}
 finally{await all.close();}
 const cal=await mounted('/admin/events/calendar?month=2099-01&view=month',items);
 try{const more=byId(cal,'events-cal-more-2099-01-12');assert.ok(more);await act(async()=>cal.props(more).onClick());const chip=byId(cal,'events-cal-chip-205');assert.ok(chip);await act(async()=>cal.props(chip).onClick());assert.match(cal.text(),/Seats 73 \/ 100/);assert.equal(cal.requests.some(u=>u.includes('/analytics')),false);}
 finally{await cal.close();}
});
test('the event page first tiles use its own summary, with an independent unreadable state',()=>{
 const event=ev(205),base={event:ready({event}),agenda:ready({agenda:[]}),history:ready({history:{items:[]}}),reload(){}};
 const render=summary=>renderToStaticMarkup(h(MemoryRouter,null,h(EventPage,{id:'205',reads:{...base,summary:ready(summary)},now:Date.parse('2099-02-01T00:00:00Z')})));
 const good=render({registrations:{available:true,seats_taken:73,by_status:{attended:7,waitlisted:5}}});
 const tile=(html,key)=>html.split(`data-testid="events-event-tile-${key}"`)[1]?.split('</div>')[0]||'';
 assert.match(tile(good,'taken'),/>73<\/span>/);assert.match(tile(good,'waitlist'),/>5<\/span>/);
 const bad=render({registrations:{available:false,unreadable:true}});assert.match(bad,/Seat counts could not be read/);assert.doesNotMatch(bad,/Not in this read/);assert.match(tile(bad,'taken'),/Could not be read/);
});
test('Waiting time sorts longest first and leaves non-waiting or unknown waits last',()=>{
 const items=[ev(5,{status:'pending_review',waiting_hours:null}),ev(4,{waiting_hours:999}),ev(3,{status:'pending_review',waiting_hours:0}),ev(1,{status:'pending_review',waiting_hours:2}),ev(2,{status:'pending_review',waiting_hours:75})];
 assert.equal(readQuery('?sort=waiting').sort,'waiting');
 const got=filteredRows(items,{query:readQuery('?sort=waiting'),join:null,now:Date.now()}).map(e=>e.id);
 assert.deepEqual(got.slice(0,3),[2,1,3]);assert.deepEqual(new Set(got.slice(3)),new Set([4,5]));
});
test('Review puts the viewer time below Starts and ends, retaining the event zone',()=>{
 const old=process.env.TZ;process.env.TZ='America/Los_Angeles';
 try{const f=reviewFacts(ev(1,{starts_at:'2026-07-12T17:30:00Z',ends_at:'2026-07-12T19:00:00Z'})).find(x=>x.key==='when');assert.match(f.value,/18:30–20:00.*Europe\/Lisbon/);assert.match(f.sub,/Your time.*10:30–12:00.*America\/Los_Angeles/);}
 finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test('Unpublish and Cancel conflicts have their own fixed sentences',()=>{
 for(const [code,line] of [['not_published','This event is no longer published. Refresh to see its current state.'],['already_cancelled','This event is already cancelled. Refresh to see its current state.']])assert.equal(refusalText({status:409,data:{error:code}}),line);
});

test('paged count states preserve true zero, missing values and a failed read independently',()=>{
 assert.equal(listCounts(ready([])).state,'ready');
 assert.equal(listCounts({status:'error'}).state,'unreadable');
 assert.equal(listCounts({status:'loading'}).state,'loading');
 assert.equal(listCounts(ready({})).state,'unreadable');
 assert.deepEqual(countsFor(listCounts(ready([{id:1,seats_taken:0,attended:null,waitlisted:2}])),1),{state:'ready',taken:0,attended:null,waitlisted:2});
});
