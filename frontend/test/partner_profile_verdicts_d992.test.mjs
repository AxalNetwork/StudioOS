/** D992: Exploring uses the profile canvas's words without putting a person in the address. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminExploring, { ProfileStatus } from '../src/pages/admin/AdminExploring.jsx';
import { adminExploring } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';
const render = (status) => renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(ProfileStatus,{status})));
for (const [status,word,tone] of [['pending','Waiting','amber'],['verified','Verified','emerald'],['rejected','Rejected','destructive'],[null,'Not recorded','border-dashed'],['unexpected','Not recorded','border-dashed']]) {
 test(`profile status ${status} is a linked ${word} pill`,()=>{
  const html=render(status);
  assert.match(html,new RegExp(`>${word}</a>`));assert.match(html,/href="\/admin\/partner-profiles"/);assert.match(html,/rounded-full/);assert.match(html,/dark:/);assert.match(html,new RegExp(tone));assert.match(html,new RegExp(`aria-label="Partner profiles: ${word}"`));
 });
}
test('the mounted Exploring row uses the pill and a person-free profile address',async()=>{
 const previous=adminExploring.list;
 adminExploring.list=async()=>({users:[{id:20,email:'synthetic@example.test',name:'Synthetic member',profile_admin_status:'pending',profiling_answered:3}]});
 const m=await mountContracts(React.createElement(AdminExploring),'/admin/exploring');
 try {await m.flush();const pill=m.nodes().find(n=>m.props(n)?.['data-testid']==='exploring-profile-status');assert.ok(pill);assert.equal(m.props(pill).href,'/admin/partner-profiles');assert.equal(m.props(pill)['aria-label'],'Partner profiles: Waiting');assert.match(m.text(),/3 answered/);assert.match(m.text(),/Waiting/);assert.doesNotMatch(m.text(),/pending/);}finally{await m.unmount();adminExploring.list=previous;}
});
