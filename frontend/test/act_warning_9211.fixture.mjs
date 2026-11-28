// D9211 (#9211): a test that makes React print real "not wrapped in act" warnings,
// ACT_WARNING_COUNT of them (state updates outside act), for act_warnings_baseline_9211.
// Run only by that test, with ACT_WARNINGS_BASELINE pointing at its own baseline.
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';

test('state updates land after the last act', async () => {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  let set;
  function Counter() { const [n, setN] = useState(0); set = setN; return React.createElement('span', null, String(n)); }
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Counter)));
  for (let i = 1; i <= Number(process.env.ACT_WARNING_COUNT || 0); i += 1) {
    set(i); // outside act: React warns once per update
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await act(async () => root.unmount());
  restore();
});
