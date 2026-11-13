import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {useFundReport} from '../src/hooks/useFundReport.js';
import {fundReportsApi} from '../src/lib/api';
import {ActiveCompanyContext} from '../src/contexts/ActiveCompanyContext.js';
function makeNode(tag) {
  return {
    tagName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    nodeType: tag === '#text' ? 3 : 1,
    nodeName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    childNodes: [],
    style: {},
    parentNode: null,
    ownerDocument: null,
    textContent: '',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    hasAttribute() { return false; },
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; },
    insertBefore(child, ref) {
      child.parentNode = this;
      const at = this.childNodes.indexOf(ref);
      if (at < 0) this.childNodes.push(child);
      else this.childNodes.splice(at, 0, child);
      return child;
    },
    removeChild(child) {
      const at = this.childNodes.indexOf(child);
      if (at >= 0) this.childNodes.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    contains() { return false; },
    get firstChild() { return this.childNodes[0] || null; },
  };
}

function installDocument() {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    HTMLIFrameElement: globalThis.HTMLIFrameElement,
  };
  globalThis.window = globalThis;
  const document = {
    nodeType: 9,
    nodeName: '#document',
    activeElement: null,
    defaultView: globalThis,
    createElement(tag) {
      const node = makeNode(tag);
      node.ownerDocument = document;
      return node;
    },
    createElementNS(_ns, tag) { return document.createElement(tag); },
    createTextNode(text) {
      const node = makeNode('#text');
      node.textContent = String(text);
      node.ownerDocument = document;
      return node;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body');
  globalThis.document = document;
  globalThis.HTMLElement = function HTMLElement() {};
  globalThis.Element = function Element() {};
  globalThis.Node = function Node() {};
  globalThis.HTMLIFrameElement = function HTMLIFrameElement() {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.getSelection = () => null;
  return () => {
    for (const [key, value] of Object.entries(previous)) globalThis[key] = value;
  };
}



const fund=(id)=>({currency:'USD',can_manage:true,periods:[],fund:{id,name:'Fund '+id,lp_count:0,size_cents:null,gp:{name:null,title:null,entity:null,email:null},providers:{fund_admin:null,auditor:null,legal_counsel:null,custodian:null,valuation_policy:null}},totals:{committed_cents:0,invested_cents:null},lpa:null});
const issued={id:1,period:'Original',period_start:'2026-04-01',period_end:'2026-06-30',status:'issued',narrative:{letter:['Original letter'],developments:[],outlook:[],subsequent:[]}};
test('route/company changes hide old fund data before effects; late responses cannot replace the current scope',async()=>{
 const restore=installDocument();const original={...fundReportsApi};const root=createRoot(document.createElement('div'));let current,phase='initial';const frames=[];let releaseCorrection,releaseFund;
 const correction=new Promise(resolve=>{releaseCorrection=resolve;});const pendingFund=new Promise(resolve=>{releaseFund=resolve;});
 fundReportsApi.fund=async id=>id==='20'?pendingFund:fund(Number(id));
 fundReportsApi.period=async()=>phase==='correction'?correction:{period:issued,can_manage:true};
 function Read(props){current=useFundReport(props.fundId,props.periodId,props.corrects);frames.push({phase,...current});return null;}
 const draw=(props,company=21)=>root.render(React.createElement(ActiveCompanyContext.Provider,{value:{company:{id:company}}},React.createElement(Read,props)));
 try{
  await act(async()=>{draw({fundId:'10',periodId:'1'});});
  assert.equal(current.data.period.id,1);
  phase='correction';await act(async()=>{draw({fundId:'10',periodId:'new',corrects:'1'});});
  assert.ok(frames.filter(f=>f.phase==='correction').every(f=>f.loading&&f.data===null));
  await act(async()=>{releaseCorrection({period:issued,can_manage:true});});
  assert.deepEqual([current.data.period.period,current.data.period.corrects_period_id,current.data.period.narrative.letter],['Original correction',1,['Original letter']]);
  phase='pending';await act(async()=>{draw({fundId:'20'});});assert.equal(current.loading,true);assert.equal(current.data,null);
  phase='current';await act(async()=>{draw({fundId:'30'});});assert.equal(current.data.fund.id,30);
  await act(async()=>{releaseFund(fund(20));});assert.equal(current.data.fund.id,30);
  phase='company';await act(async()=>{draw({fundId:'30'},22);});
  const first=frames.find(f=>f.phase==='company');assert.equal(first.loading,true);assert.equal(first.data,null);assert.equal(current.data.fund.id,30);
  fundReportsApi.period=async()=>({period:{...issued,period:'X'.repeat(100)}});phase='long';
  await act(async()=>{draw({fundId:'30',periodId:'new',corrects:'1'},22);});
  assert.equal(current.data.period.period.length,100);assert.ok(current.data.period.period.endsWith(' correction'));
 }finally{await act(async()=>root.unmount());Object.assign(fundReportsApi,original);restore();}
});
