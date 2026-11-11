// D4421: disclaimer rendered on actual rule-book, queue, proposal and Ask surfaces; answered pills removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {installDocument} from './_contracts_dom.mjs';
import {renderedText} from './_renderedText.mjs';
import {GENERAL_COUNSEL_DISCLAIMER_KEY as KEY} from '../../cloudflare-worker/src/services/agents/disclaimers.ts';
import {RulebookView,isCounsel} from '../src/pages/team/RulebooksTab.jsx';
import {ProposalSheet,ApprovalsBoard} from '../src/pages/team/ApprovalsTab.jsx';
import AgentsCard from '../src/pages/team/AgentsCard.jsx';
import TeamSettingsTab from '../src/pages/team/TeamSettingsTab.jsx';
import AddAgentSheet from '../src/pages/team/AddAgentSheet.jsx';
import AskPanel from '../src/ui/AskPanel.jsx';
import {proposalCard,RUN_CHIPS} from '../src/ui/askPanelModel.js';
const h=React.createElement;
const TEXT='Not legal advice. Always escalates.';
const item={uid:'proposal-4421',title:'Synthetic draft',draft:'Synthetic proposal',payload:{text:'Synthetic proposal'},status:'proposed',agent:{uid:'agent-4421',role_key:'general_counsel',first_name:'Synthetic'},disclaimer_key:KEY,cost:{available:false}};
const render=el=>renderedText(renderToStaticMarkup(h(MemoryRouter,null,el)));
const json=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
async function mount(el,answer){
 const restore=installDocument();const old=globalThis.fetch;
 globalThis.fetch=async (u,o={})=>answer(new URL(String(u),'http://localhost'),o)??json({});
 const box=document.createElement('div');document.body.appendChild(box);const root=createRoot(box);
 const props=n=>Object.entries(n||{}).find(([k])=>k.startsWith('__reactProps$'))?.[1]||{};
 const nodes=()=>{const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];return walk(document.body);};
 const by=id=>nodes().find(n=>props(n)['data-testid']===id);
 const text=(n=box)=>n.nodeType===3?n.textContent:(n.childNodes||[]).map(text).join('')||n.textContent||'';
 const settle=async()=>{for(let i=0;i<8;i++)await act(async()=>{await new Promise(r=>setTimeout(r,0));});};
 await act(async()=>root.render(h(MemoryRouter,null,el)));await settle();
 return{by,props,text,settle,async press(id){assert.ok(by(id),id);await act(async()=>props(by(id)).onClick({preventDefault(){}}));await settle();},async close(){await act(async()=>root.unmount());globalThis.fetch=old;restore();}};
}
test('rule book and each open/decided queue entry use the copy; names alone never select it',()=>{
 const book={role_key:'general_counsel',effective:{},versions:[],diff:[]};
 const counsel=render(h(RulebookView,{book,role:{key:'general_counsel',disclaimer_key:KEY},onBack(){}}));
 assert.ok(counsel.includes(TEXT));assert.match(counsel,/counsel wording pending/);
 assert.equal(isCounsel({key:'cfo',name:'General counsel'}),false);
 const other=render(h(RulebookView,{book:{...book,role_key:'cfo'},role:{key:'cfo',name:'General counsel'},onBack(){}}));
 assert.equal(other.includes(TEXT),false);assert.doesNotMatch(other,/pending owner/);
 const queue=render(h(ApprovalsBoard,{value:{items:[item],decided:[{...item,uid:'history-4421',status:'accepted'}]},onOpen(){}}));
 assert.equal(queue.split(TEXT).length-1,2);assert.doesNotMatch(queue,/pending owner|owner call/);
 const proposal=render(h(ProposalSheet,{item,onClose(){}}));assert.ok(proposal.includes(TEXT));
 const regular=render(h(ProposalSheet,{item:{...item,disclaimer_key:undefined,agent:{role_key:'cfo',first_name:'General counsel'}},onClose(){}}));
 assert.equal(regular.includes(TEXT),false);
});
test('answered payment and plan questions have no pending pill; Add agent reaches the payment step',async()=>{
 const settings=render(h(TeamSettingsTab,{scope:{kind:'project',project:{id:7}},agentsBlock:{available:true,value:{agents:[]}},canManage:false}));
 assert.match(settings,/Who pays/);assert.doesNotMatch(settings,/pending owner/);
 const plan=render(h(AgentsCard,{kind:'project',planLocked:true,block:{available:false,locked:'plan'}}));
 assert.match(plan,/paid Founder plan/);assert.doesNotMatch(plan,/pending owner/);
 const m=await mount(h(AddAgentSheet,{scope:{kind:'project',project:{id:7,name:'Synthetic project'}},roles:[{key:'ceo',default_rules:{}}],models:[],onClose(){}}),u=>{
  if(u.pathname.endsWith('/personas'))return json({personas:[{key:'synthetic',name:'Synthetic',tagline:'Synthetic test',natural_fit:[]}],values:[],areas:[]});
  if(u.pathname.endsWith('/tools'))return json({servers:[]});
  return json({skills:[],areas:[]});
 });
 try{await m.press('agent-pick-synthetic');await m.press('add-agent-next');await m.press('add-agent-next');assert.match(m.text(),/Model and cap for Synthetic/);assert.match(m.text(),/paid from your AI tokens/);assert.doesNotMatch(m.text(),/pending owner/);}finally{await m.close();}
});
test('Ask proposal retains trusted disclaimer metadata and renders it; model payload cannot spoof it',async()=>{
 assert.equal(proposalCard({...item,payload:{text:'Synthetic draft',disclaimer_key:'spoof'}}).disclaimer_key,KEY);
 assert.equal(proposalCard({uid:'regular',payload:{text:'Other',disclaimer_key:KEY}}).disclaimer_key,undefined);
 const m=await mount(h(AskPanel,{page:'Founder · Raise',options:[{key:RUN_CHIPS[0],label:'Synthetic action'}]}),u=>{
  if(u.pathname==='/api/eadwyn/conversations')return json({conversations:[{uid:'conversation-4421'}]});
  if(u.pathname.includes('/eadwyn/conversations/'))return json({messages:[]});
  if(u.pathname.includes('/rail/proposals'))return json({proposals:[item]});
  return json({});
 });
 try{assert.ok(m.by('ask-card-proposal-4421'));assert.ok(m.text().includes(TEXT));}finally{await m.close();}
});
