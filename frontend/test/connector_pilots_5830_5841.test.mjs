/** #5830/#5841: real mounted actions, owner-only controls, dated values, private review and venture changes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { mutationCheck } from './_form_d695.mjs';
import { readFileSync } from 'node:fs';
import ConnectorPilotSection from '../src/pages/account/ConnectorPilotSection.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { accountCompaniesApi } from '../src/lib/api/accountCompanies.js';
import { connectorsApi } from '../src/lib/api/connectors.js';
import { searchConsoleApi } from '../src/lib/api/searchConsole.js';
import SearchConsoleResults, { SearchConsoleReport } from '../src/pages/cycles/distribution/SearchConsoleResults.jsx';
import TypeformJourney from '../src/pages/cycles/TypeformJourney.jsx';
import { mappingInput, typeformCount } from '../src/pages/cycles/typeformJourneyModel.js';
import { searchCtr, searchFreshness, searchNumber, searchReadFailure } from '../src/pages/cycles/distribution/searchConsoleModel.js';

const h = React.createElement;
const week = { week_start: '2026-10-05', week_end: '2026-10-11', clicks: 0, impressions: 100, ctr: 0, complete: false, incomplete_reason: '2 of 7 days not fetched', days_reported: 5, days_not_returned: 0, days_not_fetched: 2, top_pages: { rows: [{ page: 'https://example.invalid/fixture', clicks: 99, impressions: 990, ctr: .1 }], complete: false, truncated: true } }; // Immutable synthetic provider dates
const report = { property: { site_url: 'sc-domain:example.invalid', property_kind: 'domain', access_state: 'ok' }, last_status: 'partial', last_success_at: '2026-10-12T00:00:00Z', fetched_through: '2026-10-09', weeks: [week] }; // Immutable source snapshot, explicitly stale
const searchApi = (overrides = {}) => ({ properties: async () => ({ capability: { can_bind: true }, binding: { own: true, site_url: report.property.site_url, access_state: 'ok' }, choices: [{ ...report.property, usable: true, permission_level: 'siteOwner' }] }), results: async () => report, sync: async () => ({}), select: async () => ({}), check: async () => ({}), ...overrides });
const survey = { capability: { can_bind: true }, binding: { own: true, form_id: 'FormFixture', access_state: 'ok', fields: [{ id: 'q1', type: 'yes_no', ref: 'intent' }] }, forms: { items: [{ id: 'FormFixture', title: 'Synthetic survey' }], page_count: 1 } };
const surveyApi = (overrides = {}) => ({ forms: async () => survey, syncStatus: async () => ({ status: { state: 'ok', completed: 3, qualifying: 2, checkpoint: '2026-10-09', needs_remap: [] } }), reviews: async () => ({ counts: { confirmed_signals: 1 }, rows: [{ id: 7, status: 'pending', hypothesis_id: 6, mapping_version: 2, direction: 'supports', private_answer: 'SYNTHETIC PRIVATE QUOTE' }] }), mappings: async () => ({ items: [] }), sync: async () => ({ outcome: 'ok' }), prepare: async () => ({}), decide: async () => ({}), select: async () => ({}), check: async () => ({}), ...overrides }); // Synthetic source date
async function mounted(Component, api) { const m = await mountContracts(h(Component, { projectId: 41, api }), '/grow/distribution/results?project_id=41', { id: 10, role: 'founder' }); await m.flush(); await m.flush(); return m; }

test('organic property totals preserve zero, weighted CTR, Pacific dates and partial coverage without adding top-page detail', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(SearchConsoleReport, { data: report })));
  assert.match(html, /Pacific Time/); assert.match(html, /2026-10-05/); assert.match(html, /Partial week/);
  assert.match(html, />0<\/td><td>100<\/td><td>0%/);
  assert.match(html, /Truncated by provider/); assert.match(html, /detail only/);
  assert.match(html, /Stale: last-good/); assert.match(html, /not paid campaigns, leads, customers or revenue/);
  assert.equal(searchNumber(null, 'Not recorded: missing'), 'Not recorded: missing'); assert.equal(searchNumber(0), '0');
  assert.equal(searchCtr(null, 'No impressions: CTR is undefined'), 'No impressions: CTR is undefined');
  assert.match(searchReadFailure({ data: { error: 'not_your_binding' } }), /Only the member/);
  assert.equal(searchFreshness({ last_success_at: null }), 'Not recorded: no successful sync');
});

test('readers see the report but cannot sync or replace a teammate binding', async () => {
  let writes = 0;
  const m = await mounted(SearchConsoleResults, searchApi({ properties: async () => ({ capability: { can_bind: false }, binding: { own: false }, served_by: {} }), sync: async () => { writes++; } }));
  try { assert.match(m.text(), /sc-domain:example.invalid/); assert.doesNotMatch(m.text(), /Sync search results|Choose property|Unlink property/); assert.match(m.text(), /Only that member can sync/); assert.equal(writes, 0); }
  finally { await m.unmount(); }
});

test('search sync is explicit; a failed refresh keeps dated last-good data, never a fabricated zero or raw exception', async () => {
  let reads = 0, syncs = 0;
  const m = await mounted(SearchConsoleResults, searchApi({ results: async () => { if (++reads > 1) throw { data: { error: 'SECRET SQL FIXTURE' } }; return report; }, sync: async () => { syncs++; return {}; } }));
  try {
    assert.equal(syncs, 0); await m.click('Sync search results'); await m.flush(); await m.flush();
    assert.equal(syncs, 1); assert.match(m.text(), /Dated last-good results/); assert.match(m.text(), /sc-domain:example.invalid/); assert.doesNotMatch(m.text(), /SECRET SQL/);
  } finally { await m.unmount(); }
});

test('a late prior-venture search read cannot appear after switching venture', async () => {
  let complete;
  const api = searchApi({ results: p => p === 41 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ property: null, reason: 'Not recorded: other venture', weeks: [] }) });
  let change;
  function Host() { const [id, setId] = useState(41); change = setId; return h(SearchConsoleResults, { projectId: id, api }); }
  const m = await mountContracts(h(Host), '/grow/distribution/results?project_id=41', { id: 10, role: 'founder' });
  try { await act(async () => change(42)); await m.flush(); await act(async () => complete(report)); await m.flush(); assert.match(m.text(), /other venture/); assert.doesNotMatch(m.text(), /sc-domain:example.invalid/); }
  finally { await m.unmount(); }
});

test('Typeform shows distinct counts, never renders private text until opened and requires explicit accept', async () => {
  const actions = [];
  const m = await mounted(TypeformJourney, surveyApi({ decide: async (project, id, action) => { actions.push({ project, id, action }); return {}; } }));
  try {
    assert.match(m.text(), /Completed submissions3Qualifying answers2Confirmed evidence1/);
    assert.doesNotMatch(m.text(), /SYNTHETIC PRIVATE QUOTE/); assert.equal(actions.length, 0);
    await m.click('Review private quotation'); assert.match(m.text(), /SYNTHETIC PRIVATE QUOTE/); await m.click('Cancel');
    await m.click('Accept as evidence'); assert.equal(actions.length, 0); assert.match(m.text(), /sharing requires a separate permission/);
    const accept = m.nodes().filter(n => n.tagName === 'BUTTON' && m.props(n)?.children === 'Accept as evidence').at(-1);
    await act(async () => { await m.props(accept).onClick(); });
    assert.deepEqual(actions, [{ project: 41, id: 7, action: 'confirm' }]);
  } finally { await m.unmount(); }
});

test('binding-owner denial and unavailable reads never look like an empty survey; no import on mount', async () => {
  let imports = 0;
  const m = await mounted(TypeformJourney, surveyApi({ forms: async () => ({ binding: { own: false }, capability: { can_bind: false } }), sync: async () => { imports++; } }));
  try { assert.doesNotMatch(m.text(), /Import responses|Prepare review queue|Map question/); assert.match(m.text(), /Only the member/); assert.equal(imports, 0); }
  finally { await m.unmount(); }
  const unavailable = await mounted(TypeformJourney, surveyApi({ forms: async () => { throw { data: { error: 'typeform_unavailable', detail: 'RAW PRIVATE ERROR' } }; } }));
  try { assert.match(unavailable.text(), /unavailable until its app is approved/); assert.doesNotMatch(unavailable.text(), /no completed submissions|RAW PRIVATE/); }
  finally { await unavailable.unmount(); }
});

test('a repeated import displays server counts unchanged; mapping preview stores only supported explicit rules', async () => {
  let imports = 0;
  const m = await mounted(TypeformJourney, surveyApi({ sync: async () => { imports++; return { outcome: 'ok' }; } }));
  try { await m.click('Import responses'); await m.flush(); await m.flush(); await m.click('Import responses'); await m.flush(); await m.flush(); assert.equal(imports, 2); assert.match(m.text(), /Completed submissions3Qualifying answers2Confirmed evidence1/); }
  finally { await m.unmount(); }
  assert.equal(mappingInput({ id: 'email', type: 'email' }, { kind: 'would_pay' }), null);
  assert.equal(mappingInput({ id: 'score', type: 'number' }, { kind: 'would_pay', min: '' }), null);
  assert.deepEqual(mappingInput({ id: 'score', type: 'number' }, { kind: 'would_pay', min: '0' }), { field_id: 'score', kind: 'would_pay', keep_text: false, min: 0 });
  assert.deepEqual(mappingInput({ id: 'choice', type: 'multiple_choice' }, { kind: 'waitlist', choices: 'yes, yes, no' }), { field_id: 'choice', kind: 'waitlist', keep_text: false, choices: ['yes', 'no'] });
  assert.equal(typeformCount(null), 'Not recorded'); assert.equal(typeformCount(0), '0');
});

test('mutations: missing as zero, unsupported field, blank threshold and stale success are rejected', async () => {
  let path = 'pages/cycles/typeformJourneyModel.js';
  await mutationCheck(readFileSync(new URL('../src/' + path, import.meta.url), 'utf8'), path, mod => {
    assert.equal(mod.typeformCount(null), 'Not recorded');
    assert.equal(mod.mappingInput({ id: 'email', type: 'email' }, { kind: 'would_pay' }), null);
    assert.equal(mod.mappingInput({ id: 'n', type: 'number' }, { kind: 'would_pay', min: '' }), null);
    assert.deepEqual(mod.mappingInput({ id: 'n', type: 'number' }, { kind: 'would_pay', min: '0' }).min, 0);
  }, [
    ["Number.isSafeInteger(value) && value >= 0", "value == null || (Number.isSafeInteger(value) && value >= 0)"],
    ["if (!shape || !draft.kind)", "if (!draft.kind)"],
    ["!String(draft.min ?? '').trim() || ", ""],
    ["out.min = Number(draft.min)", "out.min = Number(draft.min) || 1"],
  ]);
  path = 'pages/cycles/distribution/searchConsoleModel.js';
  await mutationCheck(readFileSync(new URL('../src/' + path, import.meta.url), 'utf8'), path, mod => {
    assert.equal(mod.searchNumber(null, 'missing'), 'missing'); assert.equal(mod.searchNumber(0), '0');
    assert.equal(mod.searchCtr(0), '0%'); assert.equal(mod.searchCtr(null, 'no impressions'), 'no impressions');
    assert.match(mod.searchFreshness({ last_status: 'partial', last_success_at: '2026-10-12T00:00:00Z' }, Date.parse('2026-10-12T01:00:00Z')), /^Stale/); // Explicit fixed model clock
  }, [[": reason;", ": '0';"], ["data.last_status !== 'ok' || ", ""]]);
});


test('Account task selects only a real venture of the chosen company and passes fixed OAuth context; an unsafe consent origin is refused', async () => {
 const original={projects:accountCompaniesApi.projects,start:connectorsApi.oauthStart,properties:searchConsoleApi.properties,results:searchConsoleApi.results};
 const calls=[];accountCompaniesApi.projects=async()=>({projects:[{id:41,company_id:77,name:'Venture One'},{id:42,company_id:88,name:'Other company venture'}]});
 connectorsApi.oauthStart=async(...args)=>{calls.push(args);return{authorize_url:'https://unexpected.example.invalid/consent'};};
 searchConsoleApi.properties=searchApi().properties;searchConsoleApi.results=searchApi().results;
 const m=await mountContracts(h(ActiveCompanyContext.Provider,{value:{company:{id:77}}},h(ConnectorPilotSection,{provider:'google_search_console'})),'/account/connectors/google_search_console?project_id=41');
 try{await m.flush();await m.flush();assert.match(m.text(),/Venture One/);assert.doesNotMatch(m.text(),/Other company venture/);
 await m.click('Connect for this venture');assert.deepEqual(calls,[['google_search_console',{return_to:'grow_results',project_id:'41'},{companyId:77}]]);assert.match(m.text(),/Sign-in could not be opened/);
 await m.fill('Venture','42');assert.doesNotMatch(m.text(),/Connect for this venture/);assert.doesNotMatch(m.text(),/Organic web search/);
 }finally{await m.unmount();accountCompaniesApi.projects=original.projects;connectorsApi.oauthStart=original.start;searchConsoleApi.properties=original.properties;searchConsoleApi.results=original.results;}
});

test('grant cancellation/return notices never trust raw provider errors or import/share on return', async () => {
 for (const [Component,api,provider] of [[TypeformJourney,surveyApi(),'typeform'],[SearchConsoleResults,searchApi(),'google_search_console']]) {
  let writes=0;api.sync=async()=>{writes++;return{};};
  const m=await mountContracts(h(Component,{projectId:41,api}),`/validate/customer-research?project_id=41&oauth=error&provider=${provider}&reason=PRIVATE-RAW-ERROR`);
  try{await m.flush();await m.flush();assert.match(m.text(),/Sign-in was cancelled, denied/);assert.doesNotMatch(m.text(),/PRIVATE-RAW-ERROR/);assert.equal(writes,0);
  if(provider==='typeform') assert.match(m.text(),/Accepted evidence and hypothesis links are not automatically unlinked/);
  }finally{await m.unmount();}
 }
});

test('mapping chooses recorded hypothesis/experiment names and preserves an explicit target, with no automatic import or confirmation', async () => {
 const calls=[];const api=surveyApi({targets:async()=>({hypotheses:[{id:6,code:'H1',claim:'Synthetic customer need'}],experiments:[{id:9,hypothesis_id:6,title:'Synthetic intent experiment',status:'planned'},{id:10,hypothesis_id:999,title:'Unrelated experiment',status:'planned'}]}),setMappings:async(...args)=>{calls.push(['rules',...args]);return{items:[{id:12,field_id:'q1'}]};},evidenceMapping:async(...args)=>{calls.push(['target',...args]);return{};}});
 const m=await mounted(TypeformJourney,api);try{await m.click('Map question');await m.flush();assert.match(m.text(),/Synthetic customer need/);await m.fill('Hypothesis','6');assert.match(m.text(),/Synthetic intent experiment/);assert.doesNotMatch(m.text(),/Unrelated experiment/);await m.fill('Experiment (optional)','9');await m.click('Save mapping');assert.deepEqual(calls[1],['target',41,{field_mapping_id:12,hypothesis_id:6,experiment_id:9}]);assert.equal(calls.length,2);
 }finally{await m.unmount();}
});

test('a busy import notice survives the following status reread and cannot be mistaken for a completed new import',async()=>{
 const m=await mounted(TypeformJourney,surveyApi({sync:async()=>({outcome:'busy'})}));
 try{await m.click('Import responses');await m.flush();await m.flush();assert.match(m.text(),/Import outcome: busy/);assert.match(m.text(),/Completed submissions3/);}finally{await m.unmount();}
});
