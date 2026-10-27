/** D1113: retire the pitch generator while retaining the counted D911 forward. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route,useLocation} from 'react-router-dom';
import {api} from '../src/lib/api.js';
import {StudioDecks} from '../src/pages/raise/pitch/PitchStudio.jsx';
import {TABS} from '../src/pages/raise/pitch/pitchStudioModel.js';
import PitchPositioningRedirect from '../src/pages/raise/narrative/PitchPositioningRedirect.jsx';
import {NarrativeHome} from '../src/pages/raise/narrative/NarrativeTool.jsx';
import {homeFooter} from '../src/pages/raise/narrative/narrativeModel.js';
import {useRedirectBeacon} from '../src/lib/redirectBeacon.js';
import {installDocument} from './_contracts_dom.mjs';

const h=React.createElement;
const DESTINATION='/raise/investor-narrative/positioning';
const sourceFiles=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sourceFiles(dir+'/'+e.name):/\.[jt]sx?$/.test(e.name)?[dir+'/'+e.name]:[]);

test('the retired page and client method are gone, and remaining pages import no retired component',()=>{
  assert.equal(existsSync('frontend/src/pages/PitchPositioningPage.jsx'),false);
  assert.equal(Object.hasOwn(api,'deckPositioning'),false);
  for(const file of sourceFiles('frontend/src')) assert.doesNotMatch(readFileSync(file,'utf8'),/(?:from\s*|import\(\s*)['"][^'"]*PitchPositioningPage(?:\.jsx)?['"]/,file);
  // D898 group E retired the builder whose tab row this read; the studio's tabs carry no Positioning tab.
  assert.equal(existsSync('frontend/src/pages/PitchWorkspacePage.jsx'),false);
  assert.deepEqual(TABS.map(t=>t.id),['decks','review','analytics','notes']);
  assert.equal(typeof StudioDecks,'function');
});

test('NAR1 starts with the moved sentence while preserving the actual deck-read state',()=>{
  for(const [deck,line] of [[null,'No pitch deck yet, so nothing reads your narrative.'],[{reads_narrative:false},'No card of your pitch deck reads your narrative yet.'],[{reads_narrative:true},'The Pitch deck studio reads your narrative.']]){
    const part={state:'ok',versions:[],newest:null,deck};
    assert.equal(homeFooter(part),'Positioning now lives here. '+line);
    const html=renderToStaticMarkup(h(MemoryRouter,null,h(NarrativeHome,{data:{parts:{narrative:part}},search:'?project_id=3'})));
    assert.match(html,/data-testid="narrative-home-footer">Positioning now lives here\./);
    assert.ok(html.includes(line));
  }
});

test('the old bookmark keeps query/hash and sends one path-only redirect beacon',async()=>{
  const restore=installDocument(),container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
  const sent=[];let where;
  function Shell(){const loc=useLocation();where=loc.pathname+loc.search+loc.hash;useRedirectBeacon(loc.pathname,loc.search,key=>sent.push(key));return h(Routes,null,h(Route,{path:'/raise/pitch/positioning',element:h(PitchPositioningRedirect)}),h(Route,{path:DESTINATION,element:h('p',null,'Narrative positioning')}));}
  try{
    await act(async()=>root.render(h(MemoryRouter,{initialEntries:['/raise/pitch/positioning?project_id=3&version=4&keep=a&keep=b#lines']},h(Shell))));
    assert.equal(where,DESTINATION+'?project_id=3&version=4&keep=a&keep=b&moved=positioning#lines');
    assert.deepEqual(sent,['redirect:/raise/pitch/positioning']);
  }finally{await act(async()=>root.unmount());restore();}
});
