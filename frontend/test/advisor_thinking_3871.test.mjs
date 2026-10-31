import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, sourceModule, mutationCheck } from './_form_d695.mjs';

const page = readFileSync(new URL('../src/pages/advisor/expertise/ThinkingZone.jsx', import.meta.url), 'utf8');
const kit = readFileSync(new URL('../src/pages/advisor/expertise/kit.jsx', import.meta.url), 'utf8');
const body = kit.slice(kit.indexOf('export function ZoneBody('), kit.indexOf('/** An empty store'));
const source = `import React, { useCallback, useEffect, useState } from 'react';
const Card = ({children}) => <section>{children}</section>;
const Pill = ({children}) => <span>{children}</span>;
const Skeleton = () => <span>Loading</span>;
const Link = ({children}) => <span>{children}</span>;
const ZoneActions = () => null;
const ZoneToolbar = () => null;
const advisorZoneActions = () => [];
const advisorZoneFilters = () => [];
const ZoneHeading = ({title}) => <h2>{title}</h2>;
const NothingYet = ({title}) => <p>{title}</p>;
const StatedLimit = ({children}) => <aside>{children}</aside>;
const Unrecorded = () => <span>Not recorded</span>;
export const control = {error: new Error('The shelf could not be read.'), payload:null};
const api = {async listMyAdvisorThinking() {if(control.error) throw control.error; return control.payload;}};
` + body + page.replace(/^import .*;\n/gm, '');

async function unreadable(module) {
  const f = await mountForm(h(module.default));
  try {
    const failed = f.text();
    assert.deepEqual([failed.includes('Source unavailable'), failed.includes('The shelf could not be read.'), failed.includes('Nothing published or drafted yet'), failed.includes('live on the hub')], [true, true, false, false]);
    module.control.error = null;
    module.control.payload = { items: [{id:1,title:'Recovered writing',status:'published',views:7}], counts: {published:1,drafts:0,best_reach:7,talk_reach:null} };
    await f.click('Try again');
    assert.deepEqual([f.text().includes('Source unavailable'), f.text().includes('Recovered writing'), f.text().includes('7 views')], [false, true, true]);
  } finally { await f.unmount(); }
}
test('the real shelf and ZoneBody show a failed read instead of counts and can retry', async () => {
  await mutationCheck(source, 'pages/advisor/expertise/ThinkingZone.jsx', unreadable, [[
    "error: e?.message || 'Your published thinking could not be read.'", "error: ''",
  ]]);
});
test('a successful empty read shows the existing empty shelf state', async () => {
  const module = await sourceModule(source, 'pages/advisor/expertise/ThinkingZone.jsx');
  module.control.error = null;
  module.control.payload = { items: [], counts: {published:0,drafts:0,best_reach:null,talk_reach:null} };
  const f = await mountForm(h(module.default));
  try {
    assert.deepEqual([f.text().includes('Nothing published or drafted yet'), f.text().includes('Source unavailable')], [true, false]);
  } finally { await f.unmount(); }
});
