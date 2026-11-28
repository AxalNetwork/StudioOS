/** D6017: V9 cards render observations only from the venture read.
 *
 * From frontend/test/README.md (moved by #6472): V9 experiment state cards, missing reads and
 * result actions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ValidateExperiments from '../src/pages/cycles/ValidateExperiments.jsx';
const draw = (part, canWrite = true) => renderToStaticMarkup(React.createElement(MemoryRouter, {}, React.createElement(ValidateExperiments, { part, canWrite })));
test('V9 distinguishes every state and keeps a hypothesis action for each experiment', () => {
 const html = draw({ state: 'ok', rows: ['planned','running','result_needed','completed','stopped'].map((status,id) => ({ id, status, code: 'H2', title: 'Synthetic test '+id, href: '/validate/experiments/2?project=1', observed: status==='completed' ? '3 sign-ups' : null, direction: status==='completed' ? 'contradicts' : null })) });
 for (const word of ['Planned','Running','Result needed','Completed with result','Stopped','Record the result','3 sign-ups','↓ Contradicts','Not recorded','doesn’t count as evidence']) assert.ok(html.includes(word), word);
 assert.equal((html.match(/href="\/validate\/experiments\/2\?project=1"/g)||[]).length,5);
 assert.doesNotMatch(draw({state:'ok',rows:[{id:1,status:'result_needed',href:'/validate/experiments/2?project=1'}]},false),/Record the result/);
});
test('V9 failed and empty reads stay different', () => {
 assert.match(draw({state:'unreadable',rows:null}),/Experiments unavailable/);
 assert.doesNotMatch(draw({state:'unreadable',rows:null}),/No experiments yet/);
 assert.match(draw({state:'ok',rows:[]}),/No experiments yet/);
});
