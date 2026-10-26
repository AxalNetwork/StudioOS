/** D1237 (#3250): deal access is explicit, room changes are confirmed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement as h} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { DealRoomsList } from '../src/components/deals/DealRoomsPanel.jsx';
import { JoinLeaveButton } from '../src/components/deals/DealRoomJoin.jsx';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';
const quota={quota:{used:0,cap:1,tier:'free',full:false}};
const by=(v,id)=>v.nodes().find(n=>v.props(n)?.['data-testid']===id);
const press=async(v,id)=>{const n=by(v,id);assert.ok(n,'missing '+id);assert.equal(Boolean(v.props(n).disabled),false);await act(async()=>{await v.props(n).onClick({stopPropagation(){}});});};

test('only an explicit readable deal is a door; membership and unknown access never substitute',()=>{
  const deals=[
    {id:1,project_name:'Request only',status:'active',is_member:1,can_read:false},
    {id:2,project_name:'Invited',status:'active',is_member:0,can_read:true},
    {id:3,project_name:'Committed',status:'active',is_member:1,can_read:true},
    {id:4,project_name:'Access unread',status:'active',is_member:1},
    {id:5,project_name:'Malformed access',status:'active',can_read:'true'},
  ];
  const html=renderToStaticMarkup(h(MemoryRouter,null,h(DealRoomsList,{dealsState:{loading:false,deals},quotaState:quota})));
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1]),['/deals/2','/deals/3']);
  for(const d of deals)assert.ok(html.includes(d.project_name));
  assert.match(html,/An invitation or commitment is needed to open this deal\./);
  assert.match(html,/Deal access could not be confirmed\./);
});

test('requesting opens the explanation first; Back writes nothing and confirmation writes once',async()=>{
  const original=api.dealroomJoin;const calls=[];let reloads=0;
  api.dealroomJoin=async id=>{calls.push(id);return {requested:true};};
  const v=await mountContracts(h(JoinLeaveButton,{dealId:101,member:false,quotaState:quota,onChanged:()=>{reloads++;}}));
  try {
    await press(v,'dr-join');assert.deepEqual(calls,[]);assert.ok(by(v,'dr-request-dialog'));
    assert.match(v.text(),/Nobody is notified automatically/);assert.match(v.text(),/does not grant access/);
    await press(v,'dr-request-back');assert.deepEqual(calls,[]);assert.equal(by(v,'dr-request-dialog'),undefined);
    await press(v,'dr-join');await press(v,'dr-request-confirm');
    assert.deepEqual(calls,[101]);assert.equal(reloads,1);assert.equal(by(v,'dr-request-dialog'),undefined);
    assert.match(v.text(),/invitation request is recorded/);assert.match(v.text(),/Access starts after an invitation or commitment/);
  } finally {await v.unmount();api.dealroomJoin=original;}
});

test('leaving is confirmed; a refusal stays in the dialog and a successful retry re-reads the page',async()=>{
  const original=api.dealroomLeave;const calls=[];let reloads=0;
  api.dealroomLeave=async id=>{calls.push(id);if(calls.length===1)throw new Error('Synthetic refusal');return {ok:true};};
  const v=await mountContracts(h(JoinLeaveButton,{dealId:101,member:true,quotaState:quota,onChanged:()=>{reloads++;}}));
  try {
    await press(v,'dr-leave');assert.deepEqual(calls,[]);assert.match(v.text(),/does not withdraw a commitment/);
    await press(v,'dr-request-confirm');assert.deepEqual(calls,[101]);assert.ok(by(v,'dr-request-dialog'));
    assert.match(v.text(),/Synthetic refusal/);assert.equal(reloads,0);
    await press(v,'dr-request-confirm');assert.deepEqual(calls,[101,101]);assert.equal(reloads,1);assert.equal(by(v,'dr-request-dialog'),undefined);
  } finally {await v.unmount();api.dealroomLeave=original;}
});

test('a full allowance prevents another request, and the copy describes the existing access rule',async()=>{
  const v=await mountContracts(h(JoinLeaveButton,{dealId:101,member:false,quotaState:{quota:{used:1,cap:1,tier:'free',full:true}}}));
  try {assert.equal(v.props(by(v,'dr-join')).disabled,true);assert.match(v.text(),/Your Free plan is full/);}finally{await v.unmount();}
  const client=readFileSync('frontend/src/lib/api.js','utf8');
  assert.match(client,/scope='mine'[\s\S]{0,150}invited or committed/);
  const source=readFileSync('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx','utf8');
  const note=source.match(/note="([^"]+)"/)?.[1];assert.ok(note);assert.doesNotMatch(note,/\b(advice|recommendations?|fiduciary)\b/i);assert.match(note,/Eadwyn drafts only when you ask/);
});
