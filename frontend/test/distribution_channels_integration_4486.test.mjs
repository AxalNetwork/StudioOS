// D4486: the real Distribution route mounts Channels; Overview hides only its moved records on desktop and phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { mountContracts } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
import { readFileSync } from 'node:fs';
import { mutationCheck } from './_form_d695.mjs';
const h = React.createElement;
const data = { module: { name: 'Distribution' }, card: { name: 'Distribution', state: 'empty', series: [] }, records: { cols: [{ key: 'name', label: 'Channel' }], rows: [{ id: 'legacy', cells: { name: 'Legacy table row' } }], total: 1, page: 1, page_size: 25 } };
function recordsVisibility(Component) {
  const render = (showRecords) => renderToStaticMarkup(h(MemoryRouter, null, h(Component, { cycle: 'grow', slug: 'distribution', data, status: 'ready', header: null, showRecords }, h('p', null, 'Retained module part'))));
  assert.match(render(undefined), /Legacy table row/);
  assert.doesNotMatch(render(false), /Legacy table row|records-empty|phone-module-empty|role="search"/);
  assert.match(render(false), /Retained module part/);
}
test('desktop record visibility defaults on; hiding the moved table preserves module parts', async () => {
  const path = 'pages/cycles/CycleModulePage.jsx'; const src = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  await mutationCheck(src, path, (m) => recordsVisibility(m.default), [['{showRecords && <RecordsTable', '{true && <RecordsTable']]);
});
test('phone record visibility defaults on; hiding rows also hides their search and paging controls', async () => {
  const path = 'pages/cycles/PhoneModulePage.jsx'; const src = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  await mutationCheck(src, path, (m) => recordsVisibility(m.default), [['{showRecords && <>', '{true && <>']]);
});
async function mountedChannels(Component) {
  const before = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => {
    const path = String(url); calls.push(path);
    const result = path.includes('/auth/me') ? { id: 1, role: 'founder' }
      : path.includes('/grow/channels?') ? { can_write: true, members: [], connections: [{ key: 'linkedin', name: 'LinkedIn', status: 'not_offered', reason: 'Needs LinkedIn’s approval', href: null }], channels: [{ uid: 'one', name: 'Mounted channel', status: 'active', owner: null, purpose: null, last_activity: null, results: null, campaigns: [] }] }
        : path.includes('/rail/proposals') ? { proposals: [] } : {};
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let m;
  try {
    m = await mountContracts(h(AuthProvider, null, h(RailPageProvider, { role: 'founder' }, h(Component, { cycle: 'grow', slug: 'distribution', tab: 'channels' }))), '/grow/distribution/channels?project_id=7', { id: 1, role: 'founder' });
    await m.flush(); assert.match(m.text(), /Mounted channel/); assert.match(m.text(), /Needs LinkedIn’s approval/);
    assert.doesNotMatch(m.text(), /Coming in this module soon/);
    assert.ok(calls.some((p) => p.includes('/grow/channels?project=7')));
    assert.equal(calls.some((p) => p.includes('/cycles/grow/modules/distribution')), false);
    assert.equal(m.nodes().filter((n) => m.props(n)?.['data-testid'] === 'distribution-ask').length, 1);
  } finally { if (m) await m.unmount(); globalThis.fetch = before; __resetEadwynPanelForTest(); }
}
test('Channels mounts inside the real cycle shell with its project read and one shared Ask', async () => {
  const path = 'pages/cycles/CycleRoute.jsx'; const src = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  await mutationCheck(src, path, (m) => mountedChannels(m.default), [["if (distributionTab === 'channels' && projectStatus === 'ready')", "if (false && distributionTab === 'channels' && projectStatus === 'ready')"]]);
});
test('the mount supplies the existing name Ask and refresh callbacks; Overview suppresses the legacy table', () => {
  const src = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  const verify = (text) => {
    assert.match(text, /<ChannelsTab projectId=\{projectId\} refresh=\{reload\} onChanged=\{\(\) => setReload\(\(n\) => n \+ 1\)\} fillFor=\{fillFor\} \/>/);
    assert.match(text, /showRecords=\{!distribution\}/);
  };
  verify(src);
  for (const [from, to] of [['fillFor={fillFor}', 'fillFor={null}'], ['<ChannelsTab projectId={projectId} refresh={reload}', '<ChannelsTab projectId={projectId} refresh={null}'], ['showRecords={!distribution}', 'showRecords={true}'], ['onChanged={() => setReload((n) => n + 1)} fillFor={fillFor}', 'onChanged={() => {}} fillFor={fillFor}']]) {
    assert.ok(src.includes(from)); assert.throws(() => verify(src.replace(from, to)), { name: 'AssertionError' }); verify(src);
  }
});
