import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import PipelineSetupStatus from '../src/pages/partner/pipeline/PipelineSetupStatus.jsx';
import { api } from '../src/lib/api.js';
import { usePipelineZone } from '../src/pages/partner/pipeline/usePipelineZone.js';
import { PipelineReadStatus } from '../src/pages/partner/pipeline/PartialRead.jsx';

const h = React.createElement;

test('background refresh exposes loading and stale state while retaining the editor draft', async () => {
  let release;
  let fail = false;
  let cycle = 0;
  let controller;
  function Probe() {
    const [draft, setDraft] = useState('Typed draft');
    controller = usePipelineZone(async () => {
      cycle++;
      if (cycle === 1) return { row: 'Recorded row' };
      await new Promise(resolve => { release = resolve; });
      if (fail) throw new Error('private server detail');
      return { row: 'Fresh row' };
    }, 'The list did not load.');
    return h('div', null,
      h(PipelineReadStatus, { state: controller.state, onRetry: controller.load }),
      h('input', { value: draft, onChange: event => setDraft(event.target.value) }),
      controller.state.data?.row);
  }
  const view = await mountContracts(h(Probe));
  try {
    await act(async () => { void controller.load(); });
    assert.match(view.text(), /Refreshing/);
    assert.match(view.text(), /Recorded row/);
    fail = true;
    await act(async () => { release(); });
    assert.match(view.text(), /Unreadable refresh.*last successful read/);
    assert.match(view.text(), /Recorded row/);
    assert.doesNotMatch(view.text(), /private server detail/);
    const input = view.nodes().find(node => node.tagName === 'INPUT');
    assert.equal(view.props(input).value, 'Typed draft');
    fail = false;
    await act(async () => { void controller.load(); });
    await act(async () => { release(); });
    assert.match(view.text(), /Fresh row/);
    assert.doesNotMatch(view.text(), /Unreadable refresh|Refreshing/);
    assert.equal(view.props(input).value, 'Typed draft');
  } finally { await view.unmount(); }
});

test('empty catalogue and fit-rule reads have distinct setup messages', async () => {
  const originalServices = api.listServiceOfferings;
  const originalRules = api.listPartnerFitRules;
  api.listServiceOfferings = async () => ({ items: [] });
  api.listPartnerFitRules = async () => ({ items: [] });
  let view;
  try {
    view = await mountContracts(h(PipelineSetupStatus));
    assert.match(view.text(), /No active services in your catalogue/);
    assert.match(view.text(), /No active fit rules configured/);
  } finally {
    await view?.unmount();
    api.listServiceOfferings = originalServices;
    api.listPartnerFitRules = originalRules;
  }
});

test('an authorization refusal keeps the draft and identifies the missing permission', async () => {
  let controller;
  function Probe() {
    controller = usePipelineZone(async () => ({ items: [] }), 'Unreadable');
    return h('div', null, h('input', { value: 'Kept draft', readOnly: true }), controller.note?.text);
  }
  const view = await mountContracts(h(Probe));
  try {
    let wrote;
    await act(async () => { wrote = await controller.run(async () => { throw { status: 403 }; }, 'Saved'); });
    assert.equal(wrote, false);
    assert.match(view.text(), /do not have permission to save/);
    const input = view.nodes().find(node => node.tagName === 'INPUT');
    assert.equal(view.props(input).value, 'Kept draft');
  } finally { await view.unmount(); }
});
