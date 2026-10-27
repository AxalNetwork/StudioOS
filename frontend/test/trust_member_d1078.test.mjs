/** D1078 — mounted member page, real API clients over synthetic fetch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { h, mountForm, textOf } from './_form_d695.mjs';
import { useEffect, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import TrustCenterPage, { TrustAdminTools, TrustPhoneView } from '../src/pages/TrustCenterPage.jsx';
import { requirementCounts, signingRequirement } from '../src/pages/trust/memberTrustModel.js';

const row = (key, status = 'pending', required = 1) => ({ obligation_key: key, status, required, created_at: '2026-01-03 12:00:00', source: 'Synthetic evidence source' });
const matrix = (role) => [row('tos_v1','satisfied'), row('privacy_v1','satisfied'), ...({ founder: [row('founder_nda_v1')], investor: [row('investor_nda_v1'),row('kyc_v1','satisfied'),row('accreditation_v1','expired'),row('kyb_v1','pending',0)], advisor: [row('mentor_nda_v1','satisfied'),row('mentor_disclaimer_v1')], partner: [], admin: [], exploring: [] }[role] || [])];
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function Probe() { return h('output',{ 'data-testid': 'url' }, useLocation().search); }
function Boot({ initial, chromeless }) { const navigate=useNavigate(); useEffect(()=>{ if(initial) navigate(initial); },[]); return h('div',null,h(TrustCenterPage,{chromeless}),h(Probe)); }
async function mounted({ role='investor', phone=false, initial, obligations=matrix(role), fails=[], unauth=false, pairs, malformed=false,chromeless=false }={}) {
  const original=globalThis.fetch; const calls=[]; const state={fails:new Set(fails),requested:null};
  globalThis.fetch=async(url,init={})=>{
    const p=new URL(url,'https://fixture.example.test').pathname; const method=init.method||'GET'; calls.push([method,p]);
    if(unauth && p==='/api/trust/me')return response({error:'Unauthorized'},401);
    if(state.fails.has(p)) return response({ error:'synthetic failure' },503);
    if(p==='/api/trust/me' && malformed) return response({role});
    if(p==='/api/trust/me') return response({role,obligations, score:88,previous_score:40,acceptances:[{obligation_key:'tos_v1',accepted_at:'2026-01-03',document_version:'2025-01-01',current_version:'2026-07-08',newer_document:true,surface:'signup'}]});
    if(p==='/api/trust/nda/required') return response({items:[{obligation_key: role==='founder'?'founder_nda_v1':'investor_nda_v1',open:true,evidence_envelope_uuid:'synthetic-envelope'}]});
    if(p==='/api/trust/agreements/synthetic-role/my_signing_url')return response({status:'signed'});
    if(p==='/api/kyc/status') return response({kyc_status:'approved',kyc_data:{legal_first_name:'Synthetic'}});
    if(p==='/api/trust/companies/kyb') return response({items:[{company_id:10,company_name:'Synthetic company',kyb:{status:'in_review'}}]});
    if(p==='/api/trust/pairwise-ndas') return response({items:pairs || [{id:1,party_a_user_id:1,party_b_user_id:2,party_b_name:'Synthetic counterparty',status:'pending',nda_envelope_uuid:'synthetic-pair',created_at:'2026-10-01',signers:[]}]});
    if(p==='/api/trust/agreements') return response({pending_envelopes:[],documents:[{id:1,title:'Synthetic contract',status:'signed'}]});
    if(p==='/api/trust/agreements/synthetic-pair/history') return response({events:[]});
    if(p==='/api/settings') return response({id:1,deletion_requested_at:state.requested});
    if(p==='/api/settings/privacy') return response({matching_opt_in:false});
    if(p==='/api/settings/account/delete-request'){state.requested='2026-10-25 12:00:00';return response({ok:true});}
    if(p==='/api/settings/account/delete-request/cancel'){state.requested=null;return response({ok:true});}
    if(p==='/api/settings/data-export') return new Response('{}',{headers:{'Content-Type':'application/json'}});
    return response({});
  };
  let v;
  try {v=await mountForm(h(Boot,{initial,chromeless}),{phone,modal:true}); await v.flush(); localStorage.setItem('user',JSON.stringify({id:1,role}));return {...v,calls,state,async unmount(){await v.unmount();globalThis.fetch=original;}};}
  catch(e){globalThis.fetch=original;throw e;}
}

for(const role of ['founder','investor','advisor','partner','admin','exploring']) test(`${role}: requirements are counts from the returned matrix, never a score`,async()=>{
  const v=await mounted({role});try{
    const rows=matrix(role);const counts=requirementCounts(rows);
    assert.match(v.text(),new RegExp(`Requirements met: ${counts.done} of ${counts.total}`));
    assert.doesNotMatch(v.text(),/Trust score|of 100|88|40 of/);
    assert.match(v.text(),/Previous requirements count: Not recorded/);
    assert.match(v.text(),/Version: 2025-01-01/);assert.match(v.text(),/A newer version was published/);
    assert.equal(v.calls.some(([,p])=>p.includes('/score/')),false);
    if(role==='founder')assert.match(v.text(),/Synthetic company/);
    if(role==='partner')assert.doesNotMatch(v.text(),/Partner MSA/);
  }finally{await v.unmount();}
});

test('only required records count, and recorded zero and waived rows remain distinct',()=>{
  assert.deepEqual(requirementCounts([row('x','waived'),row('y','pending',0)]),{done:1,total:1});
  assert.deepEqual(requirementCounts([row('x','pending')]),{done:0,total:1});
  assert.deepEqual(requirementCounts([]),{done:0,total:0});
});

for(const phone of [false,true]) test(`requirement has its own URL, scoped facts and Escape closes it (${phone?'phone':'desktop'})`,async()=>{
  const v=await mounted({phone});try{
    await v.click('Details');await v.flush();
    assert.match(v.by('url').textContent,/requirement=investor_nda_v1/);
    assert.match(v.text(),/What this is/);assert.match(v.text(),/Why you are asked/);assert.match(v.text(),/Where it stands/);
    assert.match(v.text(),/3 Jan 2026/);assert.match(v.text(),/Open to sign/);
    assert.match(textOf(v.by('trust-requirement-dialog')),/Synthetic evidence source/);assert.match(textOf(v.by('trust-requirement-dialog')),/Not recorded/);
    await v.escape();await v.flush();assert.equal(!!v.by('trust-requirement-dialog'),false);assert.doesNotMatch(v.by('url').textContent,/requirement=/);
  }finally{await v.unmount();}
});

test('another member or unknown requirement address never reads a foreign requirement',async()=>{
  for(const initial of ['/trust/me?requirement=foreign','/trust/me?requirement=investor_nda_v1&member=999']){
    const v=await mounted({initial});try{assert.match(v.text(),/Only your own requirements/);assert.doesNotMatch(v.text(),/What this is/);assert.equal(v.calls.some(([,p])=>p.includes('999')||p.includes('foreign')),false);}finally{await v.unmount();}
  }
});

test('an unreadable matrix is not an empty success and does not prevent other tabs',async()=>{
  const v=await mounted({fails:['/api/trust/me']});try{
    assert.match(v.text(),/Unreadable.*Your requirements could not be read/s);assert.doesNotMatch(v.text(),/Requirements met: 0|Nothing is asked/);
    await v.click('Agreements');await v.flush();assert.match(v.text(),/Synthetic counterparty/);assert.doesNotMatch(v.text(),/No role-level agreements required/);
    await v.click('Your data');await v.flush();assert.match(v.text(),/Download your data/);
    v.state.fails.clear();await v.click('Overview');await v.click('Try again');await v.flush();assert.match(v.text(),/Requirements met: 3 of 5/);
  }finally{await v.unmount();}
});

test('failed identity and company reads are independent of the requirements',async()=>{
  const v=await mounted({fails:['/api/kyc/status']});try{assert.match(v.text(),/Requirements met: 3 of 5/);await v.click('Verifications');await v.flush();assert.match(v.text(),/Unreadable.*Your identity check/s);}finally{await v.unmount();}
  const f=await mounted({role:'founder',fails:['/api/trust/companies/kyb']});try{assert.match(f.text(),/Requirements met: 2 of 3/);assert.match(f.text(),/Unreadable.*Your companies/s);}finally{await f.unmount();}
});

test('agreement failures stay separate, including an admin’s own scoped pairs',async()=>{
  const v=await mounted({role:'admin',fails:['/api/trust/pairwise-ndas']});try{await v.click('Agreements');await v.flush();assert.match(v.text(),/Unreadable.*Your agreements with other members/s);assert.match(v.text(),/Synthetic contract/);assert.doesNotMatch(v.text(),/No agreements with other members yet/);assert.ok(v.calls.some(([,p])=>p==='/api/trust/pairwise-ndas'));assert.ok(v.nodes().some(n=>n.tagName==='A'&&v.props(n).href==='/admin/contracts?tab=ndas'));}finally{await v.unmount();}
  const f=await mounted({fails:['/api/trust/agreements']});try{await f.click('Agreements');await f.flush();assert.match(f.text(),/Synthetic counterparty/);assert.match(f.text(),/Unreadable.*Your other contracts/s);}finally{await f.unmount();}
});

test('deletion and cancellation require dialogs and read the server’s after-state',async()=>{
  const v=await mounted();try{
    await v.click('Your data');await v.flush();assert.match(v.text(),/You have not opted into matching/);await v.click('Ask to delete');
    assert.equal(v.calls.some(([m])=>m==='POST'),false);assert.match(v.text(),/revokes connected AI assistants/);
    await v.click('Confirm deletion request');await v.flush();await v.flush();assert.match(v.text(),/Deletion requested 25 Oct 2026/);assert.match(v.text(),/Your deletion request is recorded\. This does not mean your account has been deleted\./);
    await v.click('Cancel request');await v.click('Confirm cancellation');await v.flush();await v.flush();assert.match(v.text(),/No open deletion request is recorded/);
    assert.equal(v.calls.filter(([m,p])=>m==='POST'&&p==='/api/settings/account/delete-request').length,1);
    assert.equal(v.calls.filter(([m,p])=>m==='POST'&&p.endsWith('/cancel')).length,1);
  }finally{await v.unmount();}
});

test('failed data reads are not opt-out or no-delete claims; Builder (D1315) is offered to every profile',async()=>{
  const v=await mounted({fails:['/api/settings','/api/settings/privacy']});try{await v.click('Your data');await v.flush();assert.match(v.text(),/Unreadable.*deletion state/s);assert.match(v.text(),/matching consent could not be read/);assert.doesNotMatch(v.text(),/No open deletion|not opted into matching/);assert.equal(v.nodes().some(n=>n.tagName==='A'&&v.props(n).href==='/account/developer'),false);assert.ok(v.nodes().some(n=>n.tagName==='A'&&v.props(n).href==='/account/builder'));assert.ok(v.nodes().some(n=>n.tagName==='A'&&v.props(n).href==='/account/connectors'));}finally{await v.unmount();}
});


test('a successful empty read is distinct from an unreadable read, including agreements', async()=>{
  const v=await mounted({obligations:[],pairs:[]});try{assert.match(v.text(),/Requirements met: 0 of 0/);assert.match(v.text(),/Nothing is asked of you right now/);await v.click('Agreements');await v.flush();assert.match(v.text(),/No agreements with other members yet/);assert.doesNotMatch(v.text(),/Unreadable/);}finally{await v.unmount();}
});

test('requirement variants keep the recorded state and do not invent dates or actions',async()=>{
  for(const [key,status,required] of [['investor_nda_v1','satisfied',1],['investor_nda_v1','in_review',1],['accreditation_v1','expired',1],['kyb_v1','waived',0]]){
    const v=await mounted({initial:'/trust/me?requirement='+key,obligations:[row(key,status,required)]});try{
      assert.match(textOf(v.by('trust-requirement-dialog')),new RegExp(status.replace('_',' ')));
      assert.match(textOf(v.by('trust-requirement-dialog')),/completion date is not returned/);
      if(status==='in_review')assert.doesNotMatch(textOf(v.by('trust-needs-you')),/Investor NDA/);
      if(status==='in_review'||status==='satisfied')assert.doesNotMatch(textOf(v.by('trust-requirement-dialog')),/Open to sign/);
      if(status==='expired')assert.match(textOf(v.by('trust-requirement-dialog')),/Evidence upload is not available/);
      if(!required)assert.match(textOf(v.by('trust-requirement-dialog')),/Not required for your account/);
    }finally{await v.unmount();}
  }
});

test('signed-out state offers sign-in and the public trust center',async()=>{
  const v=await mounted({unauth:true});try{assert.match(v.text(),/Sign in to see what is asked of you/);assert.doesNotMatch(v.text(),/Requirements met:/);assert.ok(v.nodes().some(n=>n.tagName==='A'&&v.props(n).href==='/login'));assert.ok(v.nodes().some(n=>n.tagName==='A'&&v.props(n).href==='/trust'));}finally{await v.unmount();}
});

test('failed deletion remains in the dialog without claiming a successful after-state',async()=>{
  const v=await mounted({fails:['/api/settings/account/delete-request']});try{await v.click('Your data');await v.flush();await v.click('Ask to delete');await v.click('Confirm deletion request');await v.flush();assert.match(v.text(),/This action could not be completed/);assert.doesNotMatch(v.text(),/Your deletion request is recorded/);assert.equal(v.state.requested,null);assert.match(v.text(),/Confirm deletion request/);}finally{await v.unmount();}
});

test('download requires confirmation and releases its temporary URL',async()=>{
  const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;let made=0,revoked=0,clicked=0;
  URL.createObjectURL=()=>{made++;return 'blob:synthetic-export';};URL.revokeObjectURL=()=>{revoked++;};
  const v=await mounted();const create=v.doc.createElement.bind(v.doc);v.doc.createElement=(tag)=>{const node=create(tag);if(tag==='a'){node.click=()=>{clicked++;};node.remove=()=>node.parentNode?.removeChild(node);}return node;};
  try{await v.click('Your data');await v.flush();await v.click('Download');assert.equal(v.calls.some(([,p])=>p.endsWith('/data-export')),false);await v.click('Confirm download');await v.flush();assert.equal(v.calls.filter(([,p])=>p.endsWith('/data-export')).length,1);assert.equal(made,1);assert.equal(clicked,1);assert.equal(revoked,1);assert.match(v.text(),/Your data download is ready/);}finally{await v.unmount();URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
});

test('HQ Super Admin gets the existing public-content editor door', async()=>{
  const v=await mountForm(h(TrustAdminTools,{user:{is_super_admin:1}}));try{assert.match(v.text(),/Public trust center/);assert.match(v.text(),/Manage the public trust center in HQ Security/);assert.ok(v.nodes().some(n=>n.tagName==='A'&&v.props(n).href==='/admin/security/trust-center'));assert.equal(v.nodes().some(n=>n.tagName==='BUTTON'),false);}finally{await v.unmount();}
});


test('stale waived identity rows do not invent a non-investor requirement',async()=>{
  for(const role of ['founder','advisor','partner','admin','exploring']){
    const v=await mounted({role,obligations:[...matrix(role),row('kyc_v1','waived',0)]});
    try{assert.equal(v.nodes().some(n=>v.props(n)['data-testid']==='requirement-kyc_v1'),false);}finally{await v.unmount();}
  }
});

test('malformed successful requirements are unreadable, not zero requirements',async()=>{
  const v=await mounted({malformed:true});try{assert.match(v.text(),/Unreadable.*Your requirements could not be read/s);assert.doesNotMatch(v.text(),/Requirements met: 0|Nothing is asked/);}finally{await v.unmount();}
});

test('unreadable signing requirements do not claim that no envelope was issued',async()=>{
  const v=await mounted({fails:['/api/trust/nda/required']});try{await v.click('Details');await v.flush();assert.match(v.text(),/Unreadable. Signing requirements could not be read/);assert.doesNotMatch(textOf(v.by('trust-requirement-dialog')),/Open to sign|No signing envelope is recorded/);}finally{await v.unmount();}
});


test('partner and advisor envelopes use their matrix evidence even though /nda/required lists only NDAs',async()=>{
  for(const [role,key] of [['partner','partner_msa_v1'],['advisor','mentor_disclaimer_v1']])for(const failed of [false,true]){
    const v=await mounted({role,initial:'/trust/me?requirement='+key,obligations:[{...row(key),evidence_envelope_uuid:'synthetic-role'}],fails:failed?['/api/trust/nda/required']:[]});
    try{assert.match(textOf(v.by('trust-requirement-dialog')),/Open to sign/);assert.doesNotMatch(textOf(v.by('trust-requirement-dialog')),/No signing envelope/);await v.click('Open to sign');await v.flush();assert.ok(v.calls.some(([,p])=>p==='/api/trust/agreements/synthetic-role/my_signing_url'));assert.match(textOf(v.by('trust-requirement-dialog')),/already signed/);assert.ok(v.calls.every(([m])=>m==='GET'));}finally{await v.unmount();}
  }
});


test('non-required or reviewed envelopes are not offered for signing in either surface',()=>{
  for(const [required,status,open] of [[0,'pending',false],[1,'in_review',false],[1,'satisfied',false],[1,'pending',true]]){
    const item={...row('partner_msa_v1',status,required),evidence_envelope_uuid:'synthetic-role'};
    assert.equal(signingRequirement(item,[]).open,open);
    assert.equal(signingRequirement(item,[{...item,open:true}]).open,open);
  }
});


test('the legacy phone view renders a loading skeleton, not an unreadable note',()=>{
  const html=renderToStaticMarkup(h(MemoryRouter,null,h(TrustPhoneView,{status:'loading'})));
  assert.match(html,/data-testid="account-loading"/);assert.doesNotMatch(html,/could not be read/);
});

test('admin own pairs name and search only the counterparty',async()=>{
  const v=await mounted({role:'admin',pairs:[{id:1,party_a_user_id:1,party_a_name:'Synthetic admin',party_b_user_id:2,party_b_name:'Synthetic counterparty',status:'pending',nda_envelope_uuid:'synthetic-pair'}]});
  try{await v.click('Agreements');await v.flush();assert.equal(textOf(v.nodes().find(n=>v.props(n)['data-testid']==='pairwise-title')),'Mutual NDA · Synthetic counterparty');const input=v.nodes().find(n=>n.tagName==='INPUT');await act(async()=>v.props(input).onChange({target:{value:'Synthetic admin'}}));assert.match(v.text(),/No recorded agreements match these filters/);}finally{await v.unmount();}
});


test('the investor’s chromeless phone frame keeps phone gutters and no second heading',async()=>{
  const v=await mounted({phone:true,chromeless:true});try{assert.equal(v.nodes().some(n=>n.tagName==='H1'),false);assert.ok(v.nodes().some(n=>v.props(n).className==='p-4'));assert.match(v.text(),/Requirements met: 3 of 5/);}finally{await v.unmount();}
});


test('a requirement read failure is not presented as a foreign or absent requirement',async()=>{
  const v=await mounted({initial:'/trust/me?requirement=investor_nda_v1',fails:['/api/trust/me']});
  try{assert.match(textOf(v.by('trust-requirement-dialog')),/Unreadable.*Your requirements could not be read/s);assert.doesNotMatch(textOf(v.by('trust-requirement-dialog')),/Only your own|does not identify/);}finally{await v.unmount();}
});
