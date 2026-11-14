import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CallReadState } from '../src/pages/founder/roundCallParts.jsx';
import { RoundCallList } from '../src/pages/founder/RoundCallPage.jsx';
import { renderedText } from './_renderedText.mjs';

const h = React.createElement;
const render = (component, props) => renderToStaticMarkup(h(MemoryRouter, null, h(component, props)));

test('a round-call refusal gives a destination or reason and only transient failures offer retry', () => {
  const state = (status, code, index = true) => render(CallReadState, { read: { error: { status, code } }, index });
  const verification = state(403, 'verified_investor_required');
  assert.match(verification, /Verify your identity/);
  assert.match(verification, /href="\/kyc"/);
  const project = state(400, 'invalid_project');
  assert.match(project, /Choose a venture/);
  assert.match(project, /href="\/raise"/);
  assert.match(state(404, 'project_not_found'), /Venture not found/);
  assert.match(state(404, 'call_not_found', false), /Round call not found/);
  assert.match(state(503, 'round_calls_disabled'), /Coming soon/);
  for (const refusal of [verification, project, state(404, 'project_not_found'), state(404, 'call_not_found', false),
    state(401), state(403), state(429), state(503, 'round_calls_disabled')]) {
    assert.doesNotMatch(refusal, /Try again/);
  }
  for (const transient of [state(500), state(503, 'round_calls_unreadable'), state(undefined)]) {
    assert.match(renderedText(transient), /Unreadable. Try again/);
  }
});

test('the index translates the recorded call states and preserves founder links', () => {
  const calls = ['sent', 'awaiting_counsel', 'closed', 'draft'].map((state) => ({ uid: state, state, name: state }));
  const html = render(RoundCallList, { calls, projectId: '1' });
  for (const [state, word] of [['sent', 'Open'], ['awaiting_counsel', 'Paused'], ['closed', 'Closed'], ['draft', 'Draft']]) {
    assert.ok(renderedText(html).includes(`${state} · ${word}`));
  }
  assert.match(html, /href="\/raise\/capital-relationships\/calls\/sent"/);
  assert.match(html, /href="\/round-calls\/draft"/);
});

test('both round-call routes use Deals chrome only for investors', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /const investorRoundCall = \(Component\) => \(\s*user\?\.role === 'investor' && effectiveRole === 'investor'\s*\? investorWorkspace\('deals', <Component embedded \/>\)/);
  assert.match(app, /path="\/round-calls"[^\n]+investorRoundCall\(RoundCallIndex\)/);
  assert.match(app, /path="\/round-calls\/:uid"[^\n]+investorRoundCall\(RoundCallPage\)/);
});
