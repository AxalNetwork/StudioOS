/** D6037: founding record and venture-scoped handoffs on desktop and phone.
 *
 * From frontend/test/README.md (moved by #6472): The founding summary, honest missing states and
 * venture-scoped handoffs.
 */
import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MemoryRouter} from 'react-router-dom';import FoundingTeamHome from '../src/pages/cycles/FoundingTeamHome.jsx';
const founder={id:2,name:'Synthetic Founder',role:'Engineering',equity:60,vesting:'4y · no cliff',start:'2026-01-01',cliff:'1 Jan 2026',fully:'1 Jan 2030',vested_pct:20,agreement:'Awaiting',agreement_date:null,filing:{text:'Due 2026-11-29',href:'/build/company-creation/step-7?project=12'}};
const facts={founders:[founder],option_pool_pct:10,option_pool_source:'model',unallocated_pct:30,cofounder_decision:{outcome:'solo',decided_at:'2026-10-01'},agreement_reason:'Individual signing status is not stored.',hiring:{state:'ok',rows:[]},contributions:{state:'ok',rows:[]}};
const draw=f=>renderToStaticMarkup(React.createElement(MemoryRouter,{},React.createElement(FoundingTeamHome,{data:{facts:f},projectId:12,records:{cols:[],rows:[],total:0,page:1,page_size:25},recordsStatus:'ready'})));
const buildDef = (await import('../src/pages/cycles/defs/build.jsx')).default;
test('Build retains both module homes and forwards the founding record and venture', () => {
  assert.equal(typeof buildDef.homes.get('operating-systems'), 'function');
  const home = buildDef.homes.get('founding-team')({ facts }, { projectId: 12 });
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, {}, home.body({ records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 }, recordsStatus: 'ready' })));
  assert.match(html, /Synthetic Founder/);
  assert.match(html, /\/raise\/legal-engine\/founders\?project_id=12/);
});
test('BD31/BD35 expose split, pool provenance, decision and holder-specific filing',()=>{const html=draw(facts);for(const word of ['Unallocated · 30%','Modelled','10%','Co-founder decision','Document a solo path','Awaiting','Signatures · Not recorded','Individual signing status is not stored.','Due 2026-11-29','Vested · 20%','No contributions recorded.'])assert.ok(html.includes(word),word);for(const href of ['/raise/legal-engine/founders?project_id=12','/build/company-creation/step-7?project=12','/grow/team-expansion?project=12'])assert.ok(html.includes(href),href);assert.match(html,/sm:hidden/);assert.match(html,/min-h-\[44px\]/);});
test('unknown split and failed parts never invent percentages or zero counts',()=>{const html=draw({...facts,unallocated_pct:null,option_pool_pct:null,unallocated_reason:'Every holder percentage and the option pool must be recorded.',hiring:{state:'unreadable'},contributions:{state:'unreadable'}});assert.match(html,/Unallocated · Not recorded/);assert.match(html,/Contributions unavailable/);assert.match(html,/Hiring roles unavailable/);assert.doesNotMatch(html,/0 roles recorded|aria-label="Recorded equity split"/);});
