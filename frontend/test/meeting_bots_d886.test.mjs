import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import MeetingBotsPage, { BotOperationsPanel } from '../src/pages/hq/MeetingBotsPage.jsx';
import { adminMeetingBotsApi } from '../src/lib/api/adminMeetingBots.js';
import { mountContracts } from './_contracts_dom.mjs';

const period = (runs) => ({ runs,bot_minutes:90,measured_runtime_runs:runs,recorded_minutes:null,measured_minutes_runs:0,
  financials:{terminal_runs:runs,measured_cost_runs:0,charged_microusd:251100,provider_cost_microusd:null,cost_per_bot_hour_microusd:null,realised_markup_bps:null,realised_margin_bps:null},
  platforms:['zoom','google_meet','teams'].map(platform=>({platform,runs:platform==='zoom'?runs:0,statuses:{done:platform==='zoom'?runs:0,failed:0,queued:0}})),failures:[] });
const data = {operations:{state:'ok',today:period(1),days7:period(7),days30:period(30),alerts:[],heartbeat_unknown_runs:0},
  pricing:{bot_per_minute_microusd:2790,supplier_per_minute_microusd:2231.6,note:'Canary ceiling; transcription billed separately.',audio_note:'Per-run audio measurements not recorded.'}};
const textOf = n => n.nodeType===3 ? n.textContent||'' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent||'';

test('D886 markup, gross margin, cost ceilings and missing audio are distinct in the rendered screen', () => {
  const html = renderToStaticMarkup(React.createElement(BotOperationsPanel,{report:data.operations,pricing:data.pricing,range:'days7',setRange(){}}));
  for (const phrase of ['Bot minutes','Audio minutes','Not recorded','Realised markup','25% of supplier cost','Gross margin','20% of charged price','Canary price ceiling','$0.00279','Supplier cost / bot-hour','No alerts among the available measurements']) assert.ok(html.includes(phrase),phrase);
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  const unknown = renderToStaticMarkup(React.createElement(BotOperationsPanel,{report:{state:'unreadable',reason:'Read failed'},range:'days7',setRange(){}}));
  assert.ok(unknown.includes('Unreadable')); assert.ok(!unknown.includes('No runs recorded'));
  const unrecorded = renderToStaticMarkup(React.createElement(BotOperationsPanel,{report:{state:'not_recorded',reason:'No store'},range:'days7',setRange(){}}));
  assert.ok(unrecorded.includes('Not recorded')); assert.ok(!unrecorded.includes('Unreadable'));
});

test('D886 page switches windows and sends only the entered link and owned session; response links never render',async () => {
  const original={...adminMeetingBotsApi},calls=[];
  adminMeetingBotsApi.read=async()=>structuredClone(data);
  adminMeetingBotsApi.startTest=async(...args)=>{
    calls.push(args);
    return {test:{uid:'00000000-0000-0000-0000-000000000001',platform:'zoom',status:'done',failure_code:null,
      stages:[{stage:'queued',elapsed_ms:0,duration_ms:1200},{stage:'done',elapsed_ms:1200,duration_ms:null}],timing_basis:'Worker receipt times',meeting_url:'SYNTHETIC_PRIVATE_MARKER'}};
  };
  const m=await mountContracts(React.createElement(MeetingBotsPage),'/admin/platform/meeting-bots');
  const settle=async()=>{for(let i=0;i<4;i++) await m.flush();};
  try {
    await settle();
    const button=m.nodes().find(n=>n.tagName==='BUTTON'&&textOf(n)==='30 days');
    await act(async()=>m.props(button).onClick()); await settle();
    assert.equal(m.props(button)['aria-pressed'],true);
    const inputs=m.nodes().filter(n=>n.tagName==='INPUT');
    await act(async()=>{m.props(inputs[0]).onChange({target:{value:'42'}});m.props(inputs[1]).onChange({target:{value:'https://meet.google.com/abc-defg-hij'}});});
    const form=m.nodes().find(n=>n.tagName==='FORM');
    await act(async()=>m.props(form).onSubmit({preventDefault(){}})); await settle();
    assert.deepEqual(calls,[[42,'https://meet.google.com/abc-defg-hij']]);
    assert.equal(m.props(inputs[1]).value,'');
    const text=textOf(m.nodes().find(n=>m.props(n)?.['data-testid']==='meeting-bots-page'));
    assert.ok(text.includes('Reached +1.2s'));assert.equal(text.includes('SYNTHETIC_PRIVATE_MARKER'),false);
  } finally {await m.unmount();Object.assign(adminMeetingBotsApi,original);}
});

test('D886 page is HQ gated, mounted once, and supplies dark surfaces without wide fixed layouts',()=>{
  const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.ok(app.includes('path="/admin/platform/meeting-bots" element={guard([\'admin\'], hqOnly(<HqMeetingBotsPage />))}'));
  const page=readFileSync(new URL('../src/pages/hq/MeetingBotsPage.jsx',import.meta.url),'utf8');
  assert.ok(page.includes('dark:text-white')&&page.includes('dark:bg-amber-950')&&page.includes('dark:text-red-300'));
  assert.ok(page.includes('flex-wrap')&&page.includes('grid-cols-1'));
});
