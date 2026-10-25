import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ConnectorPanel } from '../src/pages/account/ConnectorSheet.jsx';
import { signInKind, SIGN_IN_LABEL } from '../src/pages/account/discoverModel.js';
import { ConnectorBody, ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import { buildCatalogue, cardAction, toolGroups, authKind } from '../src/pages/account/connectorsModel.js';
import { pageAction } from '../src/pages/account/connectorPageModel.js';
import { CONNECTOR_PAGES } from '../../cloudflare-worker/src/integrations/connectorPages.ts';
import { getDescriptor, publicDescriptor } from '../../cloudflare-worker/src/integrations/registry.ts';
const h=React.createElement;
test('Lovable directory explains future no-sign-in tools, reads nothing and offers no connect action on desktop or phone',()=>{
 const row=getDescriptor('lovable');const p=publicDescriptor(row,{role:'founder',hq:true,venture:true});
 const catalogue=buildCatalogue({providers:[p],items:[]});const lovable=catalogue.find(p=>p.key==='lovable');
 assert.equal(signInKind(lovable),'none');assert.equal(SIGN_IN_LABEL[signInKind(lovable)],'Works without signing in');
 assert.equal(lovable.available,true);assert.equal(cardAction(lovable),'browse');assert.equal(authKind(lovable),'none');assert.equal(toolGroups([lovable]).total,0);assert.deepEqual(pageAction(lovable),{kind:'none'});
 const panel=renderToStaticMarkup(h(MemoryRouter,null,h(ConnectorPanel,{p:lovable,view:'pre',setView(){},onChanged(){},onClose(){}})));
 assert.match(panel,/No account is connected/);assert.match(panel,/Open page/);assert.doesNotMatch(panel,/Sign in|Connect to Axal VC|type="password"/);
 const body=CONNECTOR_PAGES.lovable;
 for(const phone of [false,true]){
  const html=renderToStaticMarkup(h(MemoryRouter,null,h(ConnectorPageView,{data:{status:'ready',catalogue,items:[],reload(){}},connectorKey:'lovable',phone,body:{state:'ready',connector:{...p,...body}}})));
  assert.match(html,/Works without signing in/);assert.match(html,/What Axal VC never does/);assert.match(html,/<h2[^>]*>It reads<\/h2>/);assert.match(html,/Not built yet/);
  assert.doesNotMatch(html,/data-testid="connector-page-(?:oauth|key-submit|connect|action)"/);
 }
 const html=renderToStaticMarkup(h(ConnectorBody,{connector:{...p,...body},p}));
 assert.match(html,/No prompt sent by the Worker/);assert.match(html,/Nothing built or published for you/);
});
