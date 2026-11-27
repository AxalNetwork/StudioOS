import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ResearchContext, { ResearchContextBody } from '../src/pages/research/ResearchContext.jsx';

const h = React.createElement;
const data = { item: { uid: 'project-1', title: 'GPU research', status: 'in_progress' }, evidence: [{ in_ask: true }, { in_ask: false }] };
const compared = { status: 'ok', value: { comparisons: [{ uid: 'set-1', title: 'Cloud providers', members: [{ name: 'Northwind' }, { name: 'Aster' }] }] } };
const findings = { status: 'ok', value: { items: [{ uid: 'f1', kind: 'conclusion' }], proposals: [{ answer_uid: 'p1' }] } };
const render = (component, props = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(component, { data, compared, findings, ...props })));

test('context shows this project, its evidence, saved findings and comparison members', () => {
  const html = render(ResearchContextBody);
  assert.match(html, /GPU research/);
  assert.match(html, /1 of 2 sources answerable in Ask/);
  assert.match(html, /Eadwyn 0 · Yours 1/);
  assert.match(html, /\/research\/projects\/project-1\/comparisons#cmp-set-1/);
  assert.match(html, /Northwind · Aster/);
  assert.match(html, /<details>/);
});

test('context distinguishes unreadable from an empty comparison set and uses the phone sheet', () => {
  const html = render(ResearchContext, { overlay: true, compared: { status: 'failed' } });
  assert.match(html, /data-phone="sheet"/);
  assert.match(html, /Could not be read/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /No saved comparisons/);
  assert.match(render(ResearchContextBody, { compared: { status: 'ok', value: { comparisons: [] } } }), /No saved comparisons yet/);
});
