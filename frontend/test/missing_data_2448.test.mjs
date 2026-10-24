import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Deck_yc_seed } from '../src/decks/templates/yc_seed.tsx';
import { Deck_sequoia_classic } from '../src/decks/templates/sequoia_classic.tsx';
import { Deck_minimal_seed } from '../src/decks/templates/minimal_seed.tsx';
import { Deck_series_a_growth_app } from '../src/decks/templates/series_a_growth_app.tsx';
import { Deck_series_b_diligence_app } from '../src/decks/templates/series_b_diligence_app.tsx';
for (const [name,Comp] of Object.entries({Deck_yc_seed,Deck_sequoia_classic,Deck_minimal_seed,Deck_series_a_growth_app,Deck_series_b_diligence_app})) {
 test('2448: '+name+' renders missing and recorded use of funds honestly',()=>{
   for (const data of [{}, {use_of_funds:[]}]) {
     const html=renderToStaticMarkup(React.createElement(Comp,{data}));
     assert.ok(html.includes('Use of funds not recorded'));
   }
   const html=renderToStaticMarkup(React.createElement(Comp,{data:{use_of_funds:[{label:'Synthetic allocation 2448',pct:37}]}}));
   assert.ok(html.includes('Synthetic allocation 2448'));
   assert.ok(!html.includes('Use of funds not recorded'));
 });
}

import TrustCenterPage from '../src/pages/TrustCenterPage.jsx';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';
test('2448: desktop failed trust read shows unreadable without a perfect score', async()=>{
 const originals={...api}; let view;
 try {
  for (const k of Object.keys(api)) if(typeof api[k]==='function') api[k]=async()=>({items:[]});
  api.trustMe=async()=>{throw new Error('synthetic read failure');};
  view=await mountContracts(React.createElement(TrustCenterPage,{chromeless:true}),'/trust',{role:'founder'});
  await view.flush();
  assert.ok(view.text().includes('Trust score unreadable'));
  assert.ok(!view.text().includes('100'));
  await view.unmount(); view=null;
  api.trustMe=async()=>({role:'founder',obligations:[{obligation_key:'tos_v1',required:true,status:'pending'}]});
  view=await mountContracts(React.createElement(TrustCenterPage,{chromeless:true}),'/trust',{role:'founder'});
  await view.flush();
  assert.ok(!view.text().includes('Trust score unreadable'));
 } finally {if(view)await view.unmount();Object.assign(api,originals);}
});
