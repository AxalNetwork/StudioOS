import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewModeProvider } from '../src/contexts/ViewModeContext.js';
import { request, rawRequestHeaders } from '../src/lib/api.js';
import { installDocument } from './_contracts_dom.mjs';

test('the Investor preview tab sends the restriction on writes and offers Return to HQ on refusal', async () => {
  const restore = installDocument();
  const events = new EventTarget();
  const { dispatchEvent, fetch } = globalThis;
  window.addEventListener = events.addEventListener.bind(events);
  window.removeEventListener = events.removeEventListener.bind(events);
  window.dispatchEvent = events.dispatchEvent.bind(events);
  const header = 'X-Axal-Preview-Shell';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (node) => [node, ...node.childNodes.flatMap(walk)];
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1];
  let viewMode = 'investor';
  let returns = 0;
  const render = (extras = {}) => root.render(React.createElement(ViewModeProvider, {
    value: {
      superAdmin: true,
      isImpersonating: false,
      viewMode,
      exitPreview() {
        returns++;
        viewMode = 'admin';
        render();
      },
      ...extras,
    },
  }));
  const rejectWrite = async (code) => {
    globalThis.fetch = async (_url, { headers }) => {
      assert.equal(headers[header], 'investor');
      return Response.json({ code, message: 'Return to HQ to make this change.' }, { status: 403 });
    };
    await act(async () => {
      await assert.rejects(request('/deals/100/commitments', { method: 'POST', body: '{}' }), { code });
    });
  };
  try {
    await act(async () => render());
    assert.equal(rawRequestHeaders('PATCH')[header], 'investor');
    assert.equal(rawRequestHeaders('GET')[header], undefined);

    await rejectWrite('kyc_required');
    assert.equal(walk(container).some((node) => props(node)?.role === 'dialog'), false);
    await rejectWrite('investor_preview_read_only');
    const button = walk(container).find((node) => node.tagName === 'BUTTON' && props(node)?.children === 'Return to HQ');
    assert.ok(button);
    await act(async () => props(button).onClick());
    assert.equal(returns, 1);
    assert.equal(rawRequestHeaders('POST')[header], undefined);
    assert.equal(walk(container).some((node) => props(node)?.role === 'dialog'), false);

    viewMode = 'investor';
    await act(async () => render({ isImpersonating: true }));
    assert.equal(rawRequestHeaders('POST')[header], undefined);
    await act(async () => render({ superAdmin: false }));
    assert.equal(rawRequestHeaders('POST')[header], undefined);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, { dispatchEvent, fetch });
    restore();
  }
});
