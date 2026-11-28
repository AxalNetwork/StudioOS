// D6214: independent cadence failures, readonly HQ and a GP's attributed save.
//
// From frontend/test/README.md (moved by #6472): Reporting settings loading, partial reads,
// read-only defaults and GP save states.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import PortfolioReportingSettings from '../src/pages/portfolio/PortfolioReportingSettings.jsx';
import { portfolioReportingSettingsApi as api } from '../src/lib/api/portfolioReportingSettings.js';
import { mountForm } from './_form_d695.mjs';
const rule={kpi_key:'revenue',name:'Revenue',definition:'Recorded revenue.',unit:'USD',cadence:'monthly',required:1,applies_to:'all',sort_order:0};
const read=(fund,cadence)=>({revision:1,all_rules:[rule],rules:cadence==='monthly'?[rule]:[],can_manage:fund!=='hq',inherited:fund!=='hq',due_days:30,period:cadence==='monthly'?'2026-11':'2026-Q4',effective_from:'0001-01',updated_at:'2026-11-01',updated_by_name:'Recorded actor'});
async function withApi(overrides,run){const old={...api};Object.assign(api,{books:async()=>({items:[{id:10,name:'Recorded fund'}]}),read:async(f,c)=>read(f,c),...overrides});try{await run();}finally{Object.assign(api,old);}}
const change=async(view,label,value)=>{const node=view.nodes().find(n=>view.props(n)['aria-label']===label);assert.ok(node,label);await act(async()=>view.props(node).onChange({target:{value}}));};
test('HQ defaults are readable but no save or edit action is offered',()=>withApi({},async()=>{const view=await mountForm(React.createElement(PortfolioReportingSettings,{onClose(){},onSaved(){}}));try{assert.match(view.text(),/Revenue/);assert.match(view.text(),/Recorded actor/);assert.doesNotMatch(view.text(),/Save rules|Edit Revenue|Add figure/);}finally{await view.unmount();}}));
test('one failed cadence remains visibly unavailable and blocks saving',()=>withApi({read:async(f,c)=>{if(c==='quarterly')throw new Error('failed');return read(f,c);}},async()=>{const view=await mountForm(React.createElement(PortfolioReportingSettings,{onClose(){},onSaved(){}}));try{assert.match(view.text(),/Revenue/);assert.match(view.text(),/Unavailable: these figures could not be read/);assert.doesNotMatch(view.text(),/Save rules|Add figure/);}finally{await view.unmount();}}));
test('a GP edits a selected book and saves its expected revision with an effective-period receipt',()=>withApi({save:async(f,body)=>{assert.equal(f,'10');assert.equal(body.revision,1);assert.equal(body.due_days,12);return{revision:2,effective_month:'2026-11',effective_quarter:'2026-Q4'};}},async()=>{let receipt='';const view=await mountForm(React.createElement(PortfolioReportingSettings,{onClose(){},onSaved(note){receipt=note;}}));try{await change(view,'Reporting book','10');assert.match(view.text(),/Save rules/);await change(view,'Reporting due days','12');await view.click('Save rules');assert.match(receipt,/Rules saved.*2026-11.*2026-Q4/);}finally{await view.unmount();}}));
test('conflicting save keeps edits and offers refresh instead of claiming success',()=>withApi({save:async()=>{throw Object.assign(new Error('conflict'),{status:409});}},async()=>{let saved=false;const view=await mountForm(React.createElement(PortfolioReportingSettings,{onClose(){},onSaved(){saved=true;}}));try{await change(view,'Reporting book','10');await change(view,'Reporting due days','12');await view.click('Save rules');assert.equal(saved,false);assert.match(view.text(),/rules changed.*Your changes are kept/);assert.match(view.text(),/Read latest rules/);const input=view.nodes().find(n=>view.props(n)['aria-label']==='Reporting due days');assert.equal(view.props(input).value,12);}finally{await view.unmount();}}));


test('failed conflict refresh and retry preserve the draft until an explicit comparison choice',()=>{
 let saves=0,conflicting=false,failRead=true;
 return withApi({read:async(f,c)=>{if(conflicting){if(failRead)throw new Error('unreadable');return {...read(f,c),revision:2};}return read(f,c);},save:async(f,body)=>{saves+=1;if(saves===1){conflicting=true;throw Object.assign(new Error('conflict'),{status:409});}assert.equal(body.revision,2);assert.equal(body.due_days,12);return{revision:3,effective_month:'2026-11',effective_quarter:'2026-Q4'};}},async()=>{
  const view=await mountForm(React.createElement(PortfolioReportingSettings,{onClose(){},onSaved(){}}));try{
   await change(view,'Reporting book','10');await change(view,'Reporting due days','12');await view.click('Save rules');
   assert.match(view.text(),/Current rules unavailable/);failRead=false;await view.click('Read latest rules');
   const input=view.nodes().find(n=>view.props(n)['aria-label']==='Reporting due days');assert.equal(view.props(input).value,12);
   await view.click('Keep editing my changes');await view.click('Save rules');assert.equal(saves,2);
  }finally{await view.unmount();}
 });
});

test('historical desk rows use their period requirements; failed rules stay unavailable',async()=>{
 const {withDuties,requiredFiguresLine}=await import('../src/pages/cycles/reporting/deskModel.js');
 const desk={duties:[{uid:'d',kind:'monthly_financials',required_figures:[],kpi_rules_required:[]}],periods:[{uid:'old',duty_uid:'d',kpi_rules_required:['net_burn']},{uid:'new',duty_uid:'d',kpi_rules_required:[]},{uid:'failed',duty_uid:'d',kpi_rules_required:null}]};
 const rows=withDuties(desk);assert.match(requiredFiguresLine(rows[0].duty),/Net burn/);assert.equal(requiredFiguresLine(rows[1].duty),'None');assert.match(requiredFiguresLine(rows[2].duty),/Unavailable/);
 assert.match(requiredFiguresLine({kind:'monthly_financials',required_figures:[],kpi_rules_required:['custom_units']}),/Tracked in company updates: custom units/);
});
