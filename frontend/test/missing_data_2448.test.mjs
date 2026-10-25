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
  assert.ok(view.text().includes('Your requirements could not be read.'));
  assert.ok(!view.text().includes('100'));
  await view.unmount(); view=null;
  api.trustMe=async()=>({role:'founder',obligations:[{obligation_key:'tos_v1',required:true,status:'pending'}]});
  view=await mountContracts(React.createElement(TrustCenterPage,{chromeless:true}),'/trust',{role:'founder'});
  await view.flush();
  assert.ok(!view.text().includes('Your requirements could not be read.'));
 } finally {if(view)await view.unmount();Object.assign(api,originals);}
});

import TrustScoreBadge from '../src/components/TrustScoreBadge.jsx';
import RiskRadar from '../src/components/RiskRadar.jsx';
test('2448: unscored trust badge is neutral; zero and 100 remain recorded scores',()=>{
 const empty=renderToStaticMarkup(React.createElement(TrustScoreBadge,{score:null}));
 assert.ok(empty.includes('Trust score not recorded'));assert.ok(empty.includes('—'));assert.ok(!empty.includes('All required obligations satisfied'));
 for(const score of [0,100]){const html=renderToStaticMarkup(React.createElement(TrustScoreBadge,{score}));assert.ok(html.includes(`data-trust-score="${score}"`));assert.ok(!html.includes('Trust score not recorded'));}
});
test('2448: risk radar leaves missing axes blank instead of plotting zero',()=>{
 const html=renderToStaticMarkup(React.createElement(RiskRadar,{layers:[{key:'founder',label:'Founder',score:null},{key:'market',label:'Market',score:0,band:'high'}]}));
 assert.equal((html.match(/r="3.5"/g)||[]).length,1);assert.ok(html.includes('fill-opacity="0"'));
});

import { scoringInputsOf } from '../src/lib/scoringViewModel.js';
test('2448: cleared and invalid practice fields stay absent; numeric zero is explicit',()=>{
 const form={empty:'',space:'  ',nil:null,absent:undefined,bad:'invalid',zero:0,textZero:'0',value:'12'};
 assert.deepEqual(scoringInputsOf(form,Object.keys(form)),{zero:0,textZero:0,value:12});
});
