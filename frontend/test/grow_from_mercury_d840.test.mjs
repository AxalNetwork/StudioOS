/**
 * D840 part 3 (#2348) — a Grow module's "From Mercury" part: the founder's own
 * Mercury figures for the team, the sentence for anyone else, the partner
 * proposal's Accept and Dismiss (the founder's only), and Delete on a figure.
 * The words are `growFromMercury.js`'s; this holds them, the part and the
 * three calls.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_from_mercury_d840.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import GrowFromMercury from '../src/pages/cycles/GrowFromMercury.jsx';
import { mercuryView, money, monthLabel, runwayText } from '../src/pages/cycles/growFromMercury.js';
import { cyclesWrite } from '../src/lib/api/cycles.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

const h = React.createElement;
const draw = (slug, part) => renderToStaticMarkup(h(GrowFromMercury, { slug, part, projectId: 101, reload() {} }));
const AS_OF = 'From Mercury, as of 2026-10-21';

const DURABLE = { state: 'ok', source: AS_OF,
  cash: { id: 1, cents: 610000, source: AS_OF }, treasury: { id: 2, cents: 1000000, source: AS_OF }, runway: { id: 3, months: 0.8, reason: null, source: AS_OF } };
const TEAM = { state: 'ok', source: AS_OF, payroll: [{ id: 4, month: '2026-09', cents: 800000 }],
  hires_affordable: { value: null, reason: 'Not recorded: no one is on the team roster', cost_per_head_cents: null, kind: 'computed',
    words: 'A computed figure, not a plan: people at last month’s payroll cost per head that fit while keeping twelve months of runway.' } };
const PARTNERS = { state: 'ok', can_decide: true, proposals: [
  { id: 9, state: 'pending', partner_company: 'Brightlane Advisory LLC', sentence: 'You paid Brightlane Advisory LLC $1,500 since 2026-08-03: link to this partnership?', source: AS_OF },
  { id: 10, state: 'accepted', partner_company: 'Twin Co', growth_partner_name: 'Twin Co', sentence: null, source: AS_OF },
] };

test('words: money in dollars, a missing figure Not recorded and never $0, months and runway', () => {
  assert.equal(money(610000), '$6,100');
  assert.equal(money(-150), '-$1.5');
  assert.equal(money(null), 'Not recorded');
  assert.equal(money(0), '$0', 'a recorded zero stays zero');
  assert.equal(monthLabel('2026-09'), 'Sep 2026');
  assert.equal(runwayText({ months: 1 }), '1 month');
  assert.equal(runwayText({ months: null, reason: 'Not burning' }), 'Not burning');
});

test('a reader outside the founder\'s company sees the sentence and no figure; nothing is drawn with no part', () => {
  // Mutation checked: draw the figures for team_only → the "$" assert fails; drop the sentence → the match fails.
  const html = draw('durable-company-building', { state: 'team_only', reason: 'From the founder’s Mercury: only the venture’s team sees these figures.' });
  assert.match(html, /only the venture’s team sees these figures/);
  assert.doesNotMatch(html, /\$/);
  assert.equal(draw('durable-company-building', undefined), '');
  assert.match(draw('team-expansion', { state: 'unreadable', reason: 'Unreadable: the Mercury figures could not be read' }), /Unreadable: the Mercury figures/);
  assert.equal(mercuryView({ state: 'something else' }).empty, true);
});

test('durable: cash, treasury and runway, each from Mercury with its date', () => {
  const html = draw('durable-company-building', DURABLE);
  assert.match(html, /\$6,100/);
  assert.match(html, /\$10,000/);
  assert.match(html, /0\.8 months/);
  assert.equal(html.split(AS_OF).length - 1, 4, 'the header and each of the three figures');
});

test('team expansion: payroll by month and hires affordable, labelled computed and not a plan', () => {
  const html = draw('team-expansion', TEAM);
  assert.match(html, /Sep 2026/);
  assert.match(html, /\$8,000/);
  assert.match(html, /Hires affordable at current runway · computed/);
  assert.match(html, /not a plan/);
  assert.match(html, /Not recorded: no one is on the team roster/);
});

test('partner network: Accept and Dismiss only on a pending proposal, and only for the founder', () => {
  // Mutation checked: draw the buttons when can_decide is false → the second doesNotMatch fails.
  const html = draw('partner-network', PARTNERS);
  assert.match(html, /link to this partnership\?/);
  assert.match(html, /mercury-accept-9/);
  assert.doesNotMatch(html, /mercury-accept-10/, 'an accepted proposal has no buttons');
  assert.match(html, /Linked to Twin Co/);
  assert.doesNotMatch(draw('partner-network', { ...PARTNERS, can_decide: false }), /mercury-accept-/);
});

async function mount(slug, part, reload) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(GrowFromMercury, { slug, part, projectId: 101, reload })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const click = (id) => act(async () => { props(by(id)).onClick(); await new Promise((r) => setTimeout(r, 0)); });
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { by, click, text, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('Accept, Dismiss and Delete each call their route once, then reload; a refusal is said', async () => {
  // Mutation checked: Dismiss calls accept → the dismiss call never comes; drop reload → the reload count fails.
  const saved = { ...cyclesWrite.grow };
  const calls = [];
  let reloads = 0;
  cyclesWrite.grow.acceptMercuryPartner = async (project, id) => { calls.push(['accept', project, id]); return { ok: true }; };
  cyclesWrite.grow.dismissMercuryPartner = async (project, id) => { calls.push(['dismiss', project, id]); throw new Error('That proposal was already decided'); };
  cyclesWrite.grow.deleteMercuryFact = async (project, id) => { calls.push(['delete', project, id]); return { ok: true }; };
  const p = await mount('partner-network', PARTNERS, () => { reloads += 1; });
  try {
    await p.click('mercury-accept-9');
    assert.deepEqual(calls, [['accept', 101, 9]]);
    assert.equal(reloads, 1);
    await p.click('mercury-dismiss-9');
    assert.deepEqual(calls[1], ['dismiss', 101, 9]);
    assert.equal(reloads, 1, 'a refused Dismiss does not reload');
    assert.equal(p.text(p.by('mercury-error')), 'That proposal was already decided');
  } finally { await p.unmount(); }
  const d = await mount('durable-company-building', DURABLE, () => { reloads += 1; });
  try {
    await d.click('mercury-delete-3');
    assert.deepEqual(calls[2], ['delete', 101, 3]);
    assert.equal(reloads, 2);
  } finally { await d.unmount(); Object.assign(cyclesWrite.grow, saved); }
});

test('the three calls go to the Worker\'s routes, and every fed module mounts the part', async () => {
  const sent = [];
  const w = makeCycleWrites(async (path, init) => { sent.push([path, init?.method, init?.body ?? null]); return {}; });
  await w.grow.acceptMercuryPartner(101, 9);
  await w.grow.dismissMercuryPartner(101, 10);
  await w.grow.deleteMercuryFact(101, 3);
  assert.deepEqual(sent, [
    ['/cycles/grow/mercury/partner-proposals/9/accept', 'POST', JSON.stringify({ project: 101 })],
    ['/cycles/grow/mercury/partner-proposals/10/dismiss', 'POST', JSON.stringify({ project: 101 })],
    ['/cycles/grow/mercury/facts/3?project=101', 'DELETE', null],
  ]);
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  for (const slug of ['revenue-and-traction', 'durable-company-building', 'team-expansion', 'distribution', 'partner-network']) {
    assert.ok(route.includes(`fromMercury('${slug}', data, ctx)`), slug);
  }
  assert.ok(!route.includes("fromMercury('market-expansion'"), 'Mercury holds nothing Market expansion reads');
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_grow.ts', import.meta.url), 'utf8');
  assert.ok(worker.includes("r.post('/mercury/partner-proposals/:id/accept'"));
  assert.ok(worker.includes("r.post('/mercury/partner-proposals/:id/dismiss'"));
  assert.ok(worker.includes("r.delete('/mercury/facts/:id'"));
});
