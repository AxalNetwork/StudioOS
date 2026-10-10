/** D669: rendered consent and evidence descriptions, each mutation checked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import * as consent from '../src/pages/connect/ConnectAssistantPage.jsx';
import * as model from '../src/pages/connect/assistantConsentModel.js';
import * as review from '../src/pages/founder/InterviewReview.jsx';
const actual={consent,model,review};
const request={client_name:'Claude',redirect_uri:'https://evil.example/callback/path',verified_assistant:null,scopes:['validate:read'],companies:[{id:7,name:'Actual project'}]};
const markup=(Component,props)=>renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(Component,props)));
const render=(Component,props)=>renderedText(markup(Component,props));
const checks={
 destination(m){const html=markup(m.consent.ConsentView,{request});const text=renderedText(html);const uri=html.match(/data-testid="consent-redirect-host"[^]*?<div class="break-all[^"]*">([^<]*)<\/div>/)?.[1];assert.deepEqual([uri,text.includes('Unverified assistant'),text.includes('Claude wants to connect'),text.includes('keeps your earlier connections')],[request.redirect_uri,true,true,true]);},
 scopes(m){const text=render(m.consent.ConsentView,{request});assert.deepEqual([text.includes('Read your Validate context'),text.includes('Submit interviews for your review')],[true,false]);},
 evidence(m){const p={kind:'evidence',payload:{hypothesis_id:31,pain_group_id:41,direction:'supports',strength:'pattern'},evidence_context:{hypothesis:{id:31,code:'H4',claim:'Finance leads reconcile weekly'},pain_group:{id:41,title:'Manual close'}}};
  assert.deepEqual(m.review.placementText(p),'Supports H4 · Finance leads reconcile weekly through Manual close · Pattern');},
};
for(const [name,check]of Object.entries(checks))test('D669 rendered '+name,()=>check(actual));
const files={consent:'frontend/src/pages/connect/ConnectAssistantPage.jsx',model:'frontend/src/pages/connect/assistantConsentModel.js',review:'frontend/src/pages/founder/InterviewReview.jsx'};
async function altered(kind,old,replacement,index){
 const path=files[kind];let source=readFileSync(path,'utf8');if(!source.includes(old))throw Error('Stale D669 rendered mutation: '+old);source=source.replace(old,replacement);
 const {code}=await transformWithOxc(source,resolve(path),{jsx:{runtime:'automatic'}});const req=createRequire(pathToFileURL(resolve(path)));
 const js=code.replace(/from (['"])([^'"]+)\1/g,(all,q,spec)=>{let target;try{target=spec.startsWith('.')?resolve(dirname(path),spec):req.resolve(spec);}catch{return all;}return 'from '+q+pathToFileURL(target).href+q;});
 const url='data:text/javascript;base64,'+Buffer.from(js+'\n// d669 '+index).toString('base64');
 const mod=await import(url);if(kind==='model'){
   const view=readFileSync(files.consent,'utf8').replace("from './assistantConsentModel.js'","from '"+url+"'");
   const transformed=await transformWithOxc(view,resolve(files.consent),{jsx:{runtime:'automatic'}});
   const viewReq=createRequire(pathToFileURL(resolve(files.consent)));
   const rendered=transformed.code.replace(/from (['"])([^'"]+)\1/g,(all,q,spec)=>spec.startsWith('data:')?all:'from '+q+pathToFileURL(spec.startsWith('.')?resolve(dirname(files.consent),spec):viewReq.resolve(spec)).href+q);
   return {...actual,model:mod,consent:await import('data:text/javascript;base64,'+Buffer.from(rendered).toString('base64'))};
 }
 return {...actual,[kind]:mod};
}
const probes=[
 ['destination','consent',"request.verified_assistant || 'Unverified assistant'","request.client_name"],
 ['destination','model','request?.redirect_uri','request?.redirect_host'],
 ['destination','consent','keeps your earlier connections','ends your earlier connections'],
 ['scopes','model','new Set(request?.scopes || [])',"new Set(['validate:read','validate:write'])"],
 ['evidence','review','h.code','h.id'],
 ['evidence','review','h.claim',"'Not recorded'"],
 ['evidence','review','g?.title',"'Not recorded'"],
];
for(const [index,[name,kind,old,replacement]]of probes.entries())test('D669 rendered mutation/restoration '+index,async()=>{
 const mutant=await altered(kind,old,replacement,index);await assert.rejects(async()=>checks[name](mutant),assert.AssertionError);checks[name](actual);
});
