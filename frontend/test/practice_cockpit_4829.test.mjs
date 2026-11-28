/** D4829: canonical records drive the Practice cockpit; failed or partial reads never become reassuring zeroes.
 *
 * From frontend/test/README.md (moved by #6472): D4829: source isolation, canonical counts,
 * timezone boundaries, pagination, record destinations, retry and Client Sheet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { cockpitModel, calendarDay, recordLink } from '../src/pages/advisor/practice/practiceCockpit.js';
import { PracticeCockpit, cockpitReads } from '../src/pages/advisor/practice/PracticeOverview.jsx';
import { recordTarget } from '../src/pages/advisor/practice/PracticeRecordFocus.jsx';

export const NOW = Date.parse('2026-11-07T12:00:00Z');
const list = (items, totals = {}) => ({ state: 'read', data: { items, complete: true, total: items.length, first: { totals } } });
export function fixture() {
  return {
    availability: { state: 'read', data: { timezone: 'UTC' } },
    bookings: list([
      { id: 1, client_user_id: 10, client_name: 'Acme', topic: 'Strategy review', status: 'confirmed', slot_starts_at: '2026-11-07T14:00:00Z', slot_ends_at: '2026-11-07T15:00:00Z', created_at: '2026-11-01T12:00:00Z' },
      { id: 2, client_user_id: 20, client_name: 'Kite Labs', topic: 'Intro call', status: 'confirmed', slot_starts_at: '2026-11-07T16:30:00Z', created_at: '2026-11-02T12:00:00Z' },
      { id: 3, client_user_id: 30, client_name: 'Northstar', topic: 'New request', status: 'pending', slot_starts_at: '2026-11-09T14:00:00Z', created_at: '2026-11-05T12:00:00Z' },
      { id: 4, client_user_id: 40, client_name: 'Lumen Robotics', topic: 'Completed session', status: 'completed', slot_starts_at: '2026-11-06T14:00:00Z', created_at: '2026-11-01T12:00:00Z' },
      { id: 5, client_user_id: 40, client_name: 'Expired request', status: 'pending', slot_starts_at: '2026-11-06T14:00:00Z', created_at: '2026-11-01T12:00:00Z' },
    ]),
    engagements: list([
      { id: 11, founder_user_id: 10, client_name: 'Acme', scope_label: 'Growth strategy retainer', lane: 'renewal_due', term_ends_at: '2026-11-07', updated_at: '2026-11-07T10:00:00Z' },
      { id: 12, founder_user_id: 30, client_name: 'Northstar', scope_label: 'Pricing sprint', lane: 'signed', term_ends_at: '2027-01-01', updated_at: '2026-11-07T11:00:00Z' },
      { id: 13, founder_user_id: 40, client_name: 'Lumen Robotics', scope_label: 'Board prep', lane: 'ended', updated_at: '2026-11-01T10:00:00Z' },
    ], { active: 2 }),
    deliverables: list([
      { id: 21, client_user_id: 30, client_name: 'Northstar', title: 'Pricing model', due_date: '2026-11-07', ready_version: 2, latest_version: { version: 2, ready_at: '2026-11-07T10:00:00Z' }, versions: [{ version: 2, ready_at: '2026-11-07T10:00:00Z' }, { version: 1, sent_at: '2026-11-06 12:00:00' }], updated_at: '2026-11-07T11:00:00Z' },
      { id: 22, client_user_id: 10, client_name: 'Acme', title: 'Strategy memo', latest_version: { version: 1, sent_at: '2026-11-01T10:00:00Z' }, versions: [{ version: 1, sent_at: '2026-11-01T10:00:00Z' }], updated_at: '2026-11-01T10:00:00Z' },
    ]),
    ledger: { state: 'read', data: { totals: { gross_cents: 840000, cut_cents: 0, net_cents: 840000, sessions: 12, priced_sessions: 12, unpriced_sessions: 1 }, states: { billed: { gross_cents: 270000, sessions: 4 }, collected: { gross_cents: 570000, sessions: 8 }, written_off: { gross_cents: 0, sessions: 0 } } } },
  };
}
const markup = src => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(PracticeCockpit, { sources: src, onRetry() {}, now: NOW })));

test('attention rows name the urgent record, keep pending requests distinct from expired, and never count sessions as delivery', () => {
  const m = cockpitModel(fixture(), NOW);
  assert.deepEqual(m.queue.map(r => r.key), ['requests', 'renewals', 'sessions', 'ready', 'money']);
  assert.match(m.queue[0].title, /^1 request waiting$/);
  assert.match(m.queue[0].detail, /Oldest 2 days/);
  assert.equal(m.queue[0].to, '/practice/opportunities?record=request&id=3');
  assert.equal(m.queue.find(r => r.key === 'ready').to, '/practice/delivery?record=delivery&id=21');
  assert.match(m.queue.find(r => r.key === 'money').title, /\$2,700/);
  assert.equal(m.health.find(h => h.key === 'active').value, 2);
  assert.equal(m.health.find(h => h.key === 'upcoming').value, 2);
  assert.equal(m.health.find(h => h.key === 'sent').value, 2, 'two versions were sent, not the completed booking');
  assert.equal(m.health.find(h => h.key === 'billed').value, '$8,400.00');
  assert.match(m.health.find(h => h.key === 'billed').basis, /All time/);
  assert.ok(m.today.some(r => r.key === 'due-21'));
  assert.ok(m.today.some(r => r.key === 'term-11'));
  assert.ok(!m.today.some(r => r.title === 'Completed session'));
});
test('each unreadable source loses only its facts, with retry and no invented zero', () => {
  for (const key of Object.keys(fixture())) {
    const src = fixture(); src[key] = { state: 'unreadable' };
    const out = markup(src);
    assert.match(out, /could not be read/); assert.match(out, /Try again/);
    if (key !== 'ledger') assert.match(out, /\$2,700/);
    if (key === 'bookings') assert.ok(!cockpitModel(src, NOW).queue.some(r => r.key === 'sessions' || r.key === 'requests'));
    for (const h of cockpitModel(src, NOW).health.filter(h => h.source === key)) assert.equal(h.state, 'unreadable');
  }
  const src = fixture(); src.availability.data.timezone = 'Invalid/Zone';
  assert.equal(cockpitModel(src, NOW).health.find(h => h.key === 'sent').state, 'unreadable');
});
test('calendar boundaries use the practice timezone and preserve date-only deadlines', () => {
  const now = Date.parse('2026-11-01T00:30:00Z'), src = fixture(); src.availability.data.timezone = 'America/Los_Angeles';
  assert.equal(calendarDay(now, 'America/Los_Angeles'), '2026-10-31');
  src.bookings.data.items = [{ id: 7, client_name: 'Local client', status: 'confirmed', slot_starts_at: '2026-11-01T01:00:00Z' }];
  src.deliverables.data.items = [{ id: 8, title: 'Today due', due_date: '2026-10-31', versions: [{ sent_at: '2026-11-01T00:00:00Z' }] }];
  const m = cockpitModel(src, now);
  assert.equal(m.day, '2026-10-31');
  assert.ok(m.today.some(t => t.key === 'session-7'));
  assert.ok(m.today.some(t => t.key === 'due-8'));
  assert.equal(m.health.find(h => h.key === 'sent').value, 1, 'UTC November stamp belongs to local October');
});
test('partial reads state their bound; same-name clients never share an account identity', () => {
  const src = fixture(); src.bookings.data.complete = false; src.bookings.data.total = 7000;
  assert.equal(cockpitModel(src, NOW).health.find(h => h.key === 'upcoming').value, '2+');
  assert.match(markup(src), /Loaded 5 of 7000/);
  src.engagements.data.items[0].client_name = 'Same Name';src.engagements.data.items[1].client_name = 'Same Name';
  const m = cockpitModel(src, NOW);
  assert.ok(m.clients.some(c => c.id === 10)); assert.ok(m.clients.some(c => c.id === 30));
  assert.equal(m.clients.find(c => c.id === 10).engagement, 'Growth strategy retainer');
  assert.equal(m.clients.find(c => c.id === 30).engagement, 'Pricing sprint');
  assert.match(m.clients.find(c => c.id === 30).next, /Pricing model v2 ready to send/);
  src.engagements.data.complete = false;
  assert.equal(cockpitModel(src, NOW).clients.find(c => c.id === 20).relationship, 'Relationship partially read');
  src.engagements = list([]); src.bookings = list([src.bookings.data.items.find(b => b.status === 'completed')]); src.deliverables = list([]);
  assert.equal(cockpitModel(src, NOW).clients[0].relationship, 'Client');
  src.bookings.data.items=[];src.bookings.data.complete=false;src.bookings.data.total=7000;src.ledger.data.states.billed={gross_cents:0,sessions:0};
  const partialEmpty=markup(src);assert.match(partialEmpty,/Partial view/);assert.match(partialEmpty,/Loaded 0 of 7000/);assert.doesNotMatch(partialEmpty,/Nothing needs attention/);
});
test('empty, loading and unreadable are visibly distinct; provenance is behind a disclosure', () => {
  const src = fixture(); for (const key of ['bookings', 'engagements', 'deliverables']) src[key] = list([]);
  src.ledger.data.states.billed = { gross_cents: 0, sessions: 0 };
  const empty = markup(src);
  assert.match(empty, /Nothing needs attention/); assert.match(empty, /No clients with linked accounts/);
  assert.match(empty, /<details[^>]*><summary>Where these figures come from/);
  assert.match(empty, /href="\/practice\/engagements\?new=1"/);
  assert.match(empty, /href="\/practice\/sessions#booking-links"/);
  assert.match(markup({}), /Loading requests and sessions/);
  assert.doesNotMatch(markup({}), /Nothing needs attention/);
});
test('existing scoped API methods page through every source and malformed responses fail instead of becoming empty', async () => {
  const calls=[];const read=cockpitReads({
    listMyAdvisorBookings:async (status,page)=>{calls.push([status,page.offset]);return {items:[{id:page.offset+1}],page:{total:2,next_offset:page.offset===0?1:null}};},
    listMyAdvisorEngagements:async()=>({}),listMyAdvisorDeliverables:async()=>({items:[]}),
    getMyAdvisorLedger:async()=>({}),getMyAdvisorAvailability:async()=>null,
  });
  assert.deepEqual((await read.bookings()).items,[{id:1},{id:2}]);assert.deepEqual(calls,[[undefined,0],[undefined,1]]);
  await assert.rejects(read.engagements);await assert.rejects(read.ledger);await assert.rejects(read.availability);
  assert.deepEqual((await read.deliverables()).items,[]);
});
test('record destinations are scoped to the correct zone and reject injected selectors', () => {
  assert.equal(recordLink('session', 1), '/practice/sessions?record=session&id=1');
  assert.equal(recordTarget('/practice/sessions', '?record=session&id=1'), 'lifecycle-1');
  assert.equal(recordTarget('/practice/engagements', '?record=session&id=1'), null);
  assert.equal(recordTarget('/practice/sessions', '?record=session&id=1%22%5D'), null);
  assert.equal(recordLink('session', '1junk'), '/practice');
});
test('mounted source retry names only the failed source, and linked clients open the shared Client Sheet', async () => {
  const restore=installDocument('', {focus:true});const originalMedia=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});document.querySelectorAll=()=>[];const create=document.createElement.bind(document);document.createElement=tag=>{const n=create(tag);n.querySelector=()=>null;n.querySelectorAll=()=>[];n.offsetParent={};return n;};const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('{}');
  const box=document.createElement('div');document.body.appendChild(box);const root=createRoot(box);
  const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];const props=n=>Object.entries(n||{}).find(([k])=>k.startsWith('__reactProps$'))?.[1]||{};
  const text=n=>n?.childNodes?.length?n.childNodes.map(text).join(''):n?.textContent||'';const calls=[];const {api}=await import('../src/lib/api.js');const original={...api};const data=fixture();api.listMyAdvisorEngagements=async()=>({items:data.engagements.data.items});api.listMyAdvisorBookings=async()=>({items:data.bookings.data.items});api.listMyAdvisorDeliverables=async()=>({items:data.deliverables.data.items});api.advisorClientsSharedWithMe=async()=>({items:[]});api.listMyAdvisorAccessLog=async()=>({items:[]});
  try{
    const src=fixture();src.bookings={state:'unreadable'};
    await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(PracticeCockpit,{sources:src,now:NOW,onRetry:key=>calls.push(key)}))));
    const retry=walk(box).find(n=>n.tagName==='BUTTON'&&text(n)==='Try again');assert.ok(retry);
    await act(async()=>props(retry).onClick());assert.deepEqual(calls,['bookings']);
    const client=walk(box).find(n=>n.tagName==='BUTTON'&&text(n).includes('Northstar'));assert.ok(client);
    await act(async()=>props(client).onClick());
    const dialog=walk(box).find(n=>props(n).role==='dialog');assert.ok(dialog,'shared Client Sheet opened');assert.match(text(dialog),/Northstar/);assert.match(text(dialog),/Pricing sprint/);assert.doesNotMatch(text(dialog),/Growth strategy retainer/);
    const close=walk(dialog).find(n=>props(n)['aria-label']==='Close');assert.ok(close);await act(async()=>props(close).onClick());assert.ok(!walk(box).some(n=>props(n).role==='dialog'));
  }finally{await act(async()=>root.unmount());globalThis.fetch=originalFetch;globalThis.matchMedia=originalMedia;Object.assign(api,original);restore();}
});
test('the mounted overview retries only its failed ledger and a late older retry cannot replace newer figures', async () => {
  const restore=installDocument();const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('{}');
  const {api}=await import('../src/lib/api.js');const original={...api};const data=fixture();const calls={};const counted=(key,fn)=>async(...args)=>{calls[key]=(calls[key]||0)+1;return fn(...args);};
  const never=()=>new Promise(()=>{});for(const method of ['getMyAdvisor','listMyAdvisorSessionTypes','listMyAdvisorSlots','listMyAdvisorBookingLinks','getMyAdvisorPayoutAccount']) api[method]=never;
  api.listMyAdvisorEngagements=counted('engagements',()=>({items:data.engagements.data.items,totals:{active:2}}));api.listMyAdvisorBookings=counted('bookings',()=>({items:data.bookings.data.items}));api.listMyAdvisorDeliverables=counted('deliverables',()=>({items:data.deliverables.data.items}));api.getMyAdvisorAvailability=counted('availability',()=>({timezone:'UTC'}));
  let older;api.getMyAdvisorLedger=counted('ledger',()=>{if(calls.ledger===1)throw Error('synthetic failure');if(calls.ledger===2)return new Promise(resolve=>{older=resolve;});return {...data.ledger.data,totals:{...data.ledger.data.totals,gross_cents:910000}};});
  const {default:Overview}=await import('../src/pages/advisor/practice/PracticeOverview.jsx');const box=document.createElement('div');document.body.appendChild(box);const root=createRoot(box);
  const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];const props=n=>Object.entries(n||{}).find(([k])=>k.startsWith('__reactProps$'))?.[1]||{};const text=n=>n?.childNodes?.length?n.childNodes.map(text).join(''):n?.textContent||'';
  try{
    await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(Overview))));
    assert.match(text(box),/Recorded earnings could not be read/);const retry=walk(box).find(n=>n.tagName==='BUTTON'&&text(n)==='Try again');assert.ok(retry);
    await act(async()=>{props(retry).onClick();props(retry).onClick();});assert.match(text(box),/\$9,100.00/);
    await act(async()=>older(data.ledger.data));assert.match(text(box),/\$9,100.00/);assert.doesNotMatch(text(box),/\$8,400.00/);
    assert.deepEqual(calls,{bookings:1,engagements:1,deliverables:1,ledger:3,availability:1});
  }finally{await act(async()=>root.unmount());Object.assign(api,original);globalThis.fetch=originalFetch;restore();}
});
test('the cockpit New engagement address opens the existing form, while a normal zone visit keeps it closed',async()=>{
  const restore=installDocument();const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('{"items":[]}');const {api}=await import('../src/lib/api.js');const original={...api};const data=fixture();
  api.listMyAdvisorEngagements=async()=>({items:data.engagements.data.items,totals:{active:2}});api.listMyAdvisorBookings=async()=>({items:data.bookings.data.items});api.listMyAdvisorDeliverables=async()=>({items:data.deliverables.data.items});
  const {default:Zone}=await import('../src/pages/advisor/practice/EngagementsZone.jsx');const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];const text=n=>n?.childNodes?.length?n.childNodes.map(text).join(''):n?.textContent||'';
  try{for(const open of [false,true]){const box=document.createElement('div');document.body.appendChild(box);const root=createRoot(box);try{
    await act(async()=>root.render(React.createElement(MemoryRouter,{initialEntries:[`/practice/engagements${open?'?new=1':''}`]},React.createElement(Zone))));
    assert.equal(walk(box).some(n=>n.tagName==='BUTTON'&&text(n)==='Add to Drafting'),open);
  }finally{await act(async()=>root.unmount());}}}finally{Object.assign(api,original);globalThis.fetch=originalFetch;restore();}
});

test('sent history retains its original recipient after relinking; legacy recipients are unknown, never the new client',()=>{
  const src=fixture();src.bookings=list([]);src.engagements=list([]);
  src.deliverables=list([{id:71,client_user_id:30,client_name:'New client',title:'Historical memo',updated_at:'2026-11-07T11:00:00Z',versions:[{version:1,sent_at:'2026-11-07T10:00:00Z',recipient_user_id:91,recipient_name:'Original client'},{version:2,sent_at:'2026-11-07T11:00:00Z'}]}]);
  const m=cockpitModel(src,NOW);assert.equal(m.today.find(r=>r.key==='sent-71-1').client,'Original client');assert.equal(m.today.find(r=>r.key==='sent-71-2').client,'Recipient not recorded');
  assert.ok(m.clients.some(c=>c.id===91),'historical recipient remains a recent client');
  assert.equal(m.clients.find(c=>c.id===91).name,'Original client');assert.equal(m.clients.find(c=>c.id===91).relationship,'Client');assert.equal(m.clients.find(c=>c.id===30).name,'New client');
});

test('Today shows client opens and acceptance on their own day without counting them as new deliveries',()=>{
 const src=fixture();src.bookings=list([]);src.engagements=list([]);src.deliverables=list([{id:81,client_user_id:30,client_name:'Current client',title:'Earlier memo',versions:[{version:1,recipient_user_id:91,recipient_name:'Recorded recipient',sent_at:'2026-10-28T10:00:00Z',opened_at:'2026-11-07T10:00:00Z',signed_off_at:'2026-11-07T11:00:00Z'}]}]);
 const m=cockpitModel(src,NOW);assert.deepEqual(m.today.map(r=>[r.state,r.client]),[['Opened','Recorded recipient'],['Accepted','Recorded recipient']]);assert.equal(m.health.find(h=>h.key==='sent').value,0);
});
