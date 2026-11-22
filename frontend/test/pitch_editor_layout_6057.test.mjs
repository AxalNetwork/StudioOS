/** D6057: PS04 inspector, actual section labels and document actions. */
import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MemoryRouter} from 'react-router-dom';
import EditorInspector from '../src/pages/raise/pitch/EditorInspector.jsx';import CardsStrip from '../src/pages/raise/pitch/CardsStrip.jsx';import DeckToolbar from '../src/pages/raise/pitch/DeckToolbar.jsx';import {mountForm,h} from './_form_d695.mjs';
const draw=x=>renderToStaticMarkup(h(MemoryRouter,null,x));
test('PS04 inspector keeps all panes mounted and switching tabs preserves a local draft',async()=>{
 function Draft(){const [v,set]=React.useState('Original');return h('input',{'data-testid':'inspector-draft',value:v,onChange:e=>set(e.target.value)});}
 const m=await mountForm(h(EditorInspector,{design:h(Draft),data:h('p',null,'Recorded sources'),eadwyn:h('p',null,'Existing rail')}));
 try{const input=m.by('inspector-draft');await React.act(async()=>m.props(input).onChange({target:{value:'Unsaved words'}}));await m.click('Data');assert.equal(m.props(m.by('pitch-inspector-design')).hidden,true);assert.equal(m.props(m.by('pitch-inspector-data')).hidden,false);await m.click('Design');assert.equal(m.by('inspector-draft'),input);assert.equal(m.props(input).value,'Unsaved words');assert.equal(m.nodes().filter(n=>m.props(n).role==='tab').length,3);}finally{await m.unmount();}
});
test('PS04 section headings follow real card runs without changing selection indexes',()=>{
 const html=draw(h(CardsStrip,{cards:[{uid:'a',title:'Problem',section:'Story'},{uid:'b',title:'Market',section:'Story'},{uid:'c',title:'Numbers',section:'Appendix'}],sel:1,stale:new Set(),readOnly:true,onSelect(){},move(){}}));
 assert.equal((html.match(/data-testid="pitch-card-section"/g)||[]).length,2);assert.ok(html.indexOf('Story')<html.indexOf('Problem'));assert.ok(html.indexOf('Market')<html.indexOf('Appendix'));assert.match(html,/aria-current="true"/);
});
test('PS04 document toolbar leaves editing tools in the inspector and retains Share/Export gate callbacks',async()=>{
 const calls=[];const m=await mountForm(h(DeckToolbar,{chip:{text:'Saved'},history:{undo:1,redo:0},showMore:false,showExport:true,reviewTo:'/raise/pitch/review?project_id=7',presentTo:'/raise/pitch/present?project_id=7',onAction:id=>calls.push(id)}));
 try{assert.equal(m.by('deck-more-open'),undefined);assert.ok(m.text().includes('Review'));await m.click('Export');assert.deepEqual(calls,['export']);await m.click('Share');assert.ok(m.text().includes('Export…'));}finally{await m.unmount();}
});

test('Export is independent of the optional Review link and unavailable to a reader or phone',()=>{
 const render=props=>draw(h(DeckToolbar,{showExport:true,...props}));
 assert.match(render({}),/data-testid="deck-toolbar-export"/);
 for(const props of [{readOnly:true},{phone:true},{showExport:false,reviewTo:'/review'}]) assert.doesNotMatch(render(props),/data-testid="deck-toolbar-export"/);
});
