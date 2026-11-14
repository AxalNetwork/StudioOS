import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { cycleValidateApi } from '../src/lib/api/cycleValidate.js';
import WaitlistBar from '../src/pages/cycles/ValidateWaitlistBar.jsx';

test('writers set and clear a waitlist bar, and a refusal preserves the saved value', async () => {
  const restore = installDocument();
  const host = document.createElement('div');
  const root = createRoot(host);
  const save = cycleValidateApi.setWaitlistTarget;
  const calls = [];
  let value = 20;
  let canWrite = true;
  let error = null;
  let unreadable = false;
  const render = () => root.render(React.createElement(MemoryRouter, null,
    React.createElement(WaitlistBar, { projectId: 42, value, unreadable, canWrite, reload: render })));
  cycleValidateApi.setWaitlistTarget = async (project, target) => {
    calls.push([project, target]);
    if (error) throw new Error(error);
    value = target;
  };
  const walk = (node) => [node, ...node.childNodes.flatMap(walk)];
  const node = (tag, type) => walk(host).find((n) => n.tagName === tag && (!type || props(n).type === type));
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const words = () => walk(host).map((n) => n.textContent).join(' ');
  try {
    await act(async () => render());
    await act(async () => props(node('INPUT')).onChange({ target: { value: '50' } }));
    await act(async () => props(node('FORM')).onSubmit({ preventDefault() {} }));
    assert.match(words(), /50 sign-ups/);
    error = 'Only the venture team may set the waitlist bar.';
    await act(async () => props(node('BUTTON', 'button')).onClick());
    assert.match(words(), /Only the venture team may set the waitlist bar/);
    assert.match(words(), /50 sign-ups/);
    error = null;
    await act(async () => props(node('BUTTON', 'button')).onClick());
    assert.match(words(), /No bar set/);
    unreadable = true;
    await act(async () => render());
    assert.match(words(), /Waitlist bar could not be read/);
    assert.equal(node('FORM') !== undefined, true);
    assert.doesNotMatch(words(), /No bar set/);
    unreadable = false;
    assert.deepEqual(calls, [[42, 50], [42, null], [42, null]]);
    value = 30;
    canWrite = false;
    await act(async () => render());
    assert.match(words(), /30 sign-ups/);
    assert.equal(node('FORM'), undefined);
  } finally {
    await act(async () => root.unmount());
    cycleValidateApi.setWaitlistTarget = save;
    restore();
  }
});
