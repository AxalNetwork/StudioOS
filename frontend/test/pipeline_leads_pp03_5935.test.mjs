/**
 * #5935 (D4838, boards PP03, PP03b, PP03m) — Pipeline · Leads redrawn to the Pipeline v2 canvas: reasons before
 * the score, the five views, a strip whose zeros carry a population, and a structured pass dialog whose reasons
 * are the Worker's own list.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pipeline_leads_pp03_5935.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import PartnerLeadsZone from '../src/pages/partner/pipeline/LeadsZone.jsx';
import {
  PASS_REASONS, fitLine, leadReasons, leadStrip, periodStart, recentFirst, whyThisScore,
} from '../src/pages/partner/pipeline/leadsModel.js';

const h = React.createElement;
const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

function stub(methods) {
  const saved = {};
  for (const [k, v] of Object.entries(methods)) { saved[k] = api[k]; api[k] = v; }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete api[k]; else api[k] = v; } };
}
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const buttons = (m, label) => m.nodes().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
const press = async (m, label, i = 0) => {
  const n = buttons(m, label)[i];
  assert.ok(n, `Missing button: ${label}`);
  await act(async () => { m.props(n).onClick({ stopPropagation() {} }); });
};
const byTestId = (m, id) => m.nodes().filter((n) => m.props(n)?.['data-testid'] === id);

const lead = (id, who, over = {}) => ({
  need_id: id, who, title: `${who} wants a build`, source_label: 'Marketplace need', days_old: 3,
  budget_min: null, budget_max: null, timeline: null, need: null, score: 75, excluded_by: null, score_note: null,
  receipts: [{ label: 'Web build · match', kind: 'hit' }, { label: 'Below your floor', kind: 'miss' }, { label: 'No budget floor stated', kind: 'gap' }],
  ...over,
});
const STRONG = lead(1, 'Lumen Pay', { score: 100, receipts: [{ label: 'SaaS · match', kind: 'hit' }, { label: 'At or above your floor', kind: 'hit' }], budget_min: 15000, budget_max: 20000 });
const PARTIAL = lead(2, 'Bramble Health', { score: 50, days_old: 12 });
const UNSCORED = lead(3, 'Orchard AI', { score: null, receipts: [{ label: 'No capability listed to match against', kind: 'gap' }], score_note: 'Nothing this firm has written down applies to this lead.', days_old: 1 });
const EXCLUDED = lead(4, 'Tidal Freight', { score: null, excluded_by: 'We do not do brand work.', receipts: [{ label: 'brand · excluded', kind: 'miss' }], days_old: 30 });
const body = (items, extra = {}) => ({
  items, passed: [], open_count: items.length, strong_fit_count: 1, excluded_count: 1, passed_count: 0, scoring: 'fit_rules', ...extra,
});

/* ─────────────────────────────── the model ─────────────────────────────── */

test('PASS_REASONS is the Worker’s list, in its order', () => {
  const worker = raw('cloudflare-worker/src/routes/partner_pipeline.ts');
  const list = worker.slice(worker.indexOf('const PASS_REASONS = ['), worker.indexOf('];', worker.indexOf('const PASS_REASONS = [')));
  assert.deepEqual(PASS_REASONS.map(([k]) => k), [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  // The brief's six (PP03b) are the same six, in the same order.
  const canvas = raw('design/incoming/Pipeline v2 Page.dc.html');
  const dlg = canvas.slice(canvas.indexOf('const passDlg'), canvas.indexOf('.map((r, i)', canvas.indexOf('const passDlg')));
  assert.deepEqual(PASS_REASONS.map(([, label]) => label), [...dlg.matchAll(/'([A-Z][a-z ]+)'/g)].map((m) => m[1]));
});

test('fit state: an excluded lead and an unscored one carry no number', () => {
  assert.deepEqual(fitLine(STRONG), { state: 'strong', text: 'Strong fit', score: 100 });
  assert.deepEqual(fitLine(PARTIAL), { state: 'partial', text: 'Partial fit', score: 50 });
  assert.deepEqual(fitLine(UNSCORED), { state: 'unscored', text: 'Unscored', score: null });
  assert.deepEqual(fitLine(EXCLUDED), { state: 'excluded', text: 'Excluded · no score', score: null });
  assert.equal(fitLine(lead(9, 'X', { score: 80 })).state, 'strong', '80 is the strong line');
  assert.equal(fitLine(lead(9, 'X', { score: 79 })).state, 'partial');
});

test('reasons are met and missed rules; Why this score? lists every receipt and its sum', () => {
  assert.deepEqual(leadReasons(PARTIAL), [{ met: true, label: 'Web build · match' }, { met: false, label: 'Below your floor' }]);
  const why = whyThisScore(PARTIAL);
  assert.deepEqual(why.receipts.map((r) => r.word), ['Met', 'Missed', 'Not measured']);
  assert.match(why.sum, /^1 of 2 rules measured are met, so the score is 50\./);
  assert.equal(whyThisScore(UNSCORED), null);
  assert.equal(whyThisScore(EXCLUDED), null);
});

test('the strip prints a zero only over its population, and a partial read is Not recorded', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const full = leadStrip({ ...body([STRONG, PARTIAL, UNSCORED, EXCLUDED]), passed_count: 2, passed: [
    { passed_at: '2026-11-03 09:00:00' }, { passed_at: '2026-10-28T09:00:00Z' },
  ] }, { now });
  assert.deepEqual(full.map((t) => [t.label, t.value]), [
    ['Open leads', '4'], ['Strong fit', '1'], ['Unscored', '1'], ['Passed this period', '1'],
  ]);
  assert.equal(full[3].note, 'Since 1 Nov · 2 in all');
  assert.equal(full[1].note, 'Score ≥ 80 · of 4 open');

  const empty = leadStrip({ items: [], passed: [], open_count: 0, strong_fit_count: 0, passed_count: 0 }, { now });
  assert.deepEqual(empty.map((t) => t.value), ['None open', 'No open leads', 'No open leads', 'None yet']);

  const noRules = leadStrip({ ...body([UNSCORED]), strong_fit_count: null }, { now });
  assert.equal(noRules[1].value, null);
  assert.equal(noRules[1].note, 'no rule to score against yet');

  const partial = leadStrip({ ...body([STRONG]), open_count: 5, complete: false, passed_count: 3, passed: [] }, { now });
  assert.equal(partial[2].value, null, 'Unscored over some of the leads is not a count');
  assert.equal(partial[2].note, 'not every open lead loaded');
  assert.equal(partial[3].value, null);
  assert.equal(periodStart(now).label, '1 Nov');
});

test('Recent is the last seven days, newest first', () => {
  assert.deepEqual(recentFirst([STRONG, PARTIAL, UNSCORED, EXCLUDED]).map((r) => r.need_id), [3, 1]);
  assert.deepEqual(recentFirst([lead(5, 'A', { days_old: null })]), []);
});

/* ─────────────────────────────── the zone ─────────────────────────────── */

async function mountZone(payload, extra = {}) {
  const restore = stub({ listPartnerLeads: async () => payload, ...extra });
  const m = await mountContracts(h(PartnerLeadsZone));
  await m.flush();
  return { m, restore };
}
const cardNames = (m) => byTestId(m, 'lead-card').map((c) => textOf(c.childNodes[0].childNodes[0].childNodes[0]));

test('cards follow the canvas order: name, provenance, reasons, fit, budget, need, action', async () => {
  const { m, restore } = await mountZone(body([STRONG]));
  try {
    const card = byTestId(m, 'lead-card')[0];
    const text = textOf(card);
    const at = (s) => { const i = text.indexOf(s); assert.ok(i >= 0, `missing ${s}`); return i; };
    const order = [at('Lumen Pay'), at('Marketplace need'), at('SaaS · match'), at('Strong fit · 100'), at('Budget'), at('$15K–$20K'), at('Need'), at('Pass')];
    assert.deepEqual([...order].sort((a, b) => a - b), order, `out of order: ${text}`);
    assert.equal(buttons(m, 'Accept').length, 0);
    assert.equal(buttons(m, 'Draft proposal').length, 0, 'no Draft proposal until the owner answers');
    const pass = buttons(m, 'Pass')[0];
    assert.match(m.props(pass).className, /min-h-\[44px\]/);
    assert.match(m.props(pass).className, /\bw-full\b/, 'full width on a phone');
  } finally { await m.unmount(); restore(); }
});

test('an excluded lead shows its rule and no number; an unscored one says so', async () => {
  const { m, restore } = await mountZone(body([UNSCORED, EXCLUDED]));
  try {
    const [u, x] = byTestId(m, 'lead-card').map(textOf);
    assert.match(u, /Unscored/);
    assert.match(u, /Nothing this firm has written down applies/);
    assert.match(x, /Excluded · no score/);
    assert.match(x, /We do not do brand work\./);
    for (const t of [u, x]) assert.doesNotMatch(byTestId(m, 'lead-fit').map(textOf).join(' '), /\d/, `a number: ${t}`);
    assert.equal(buttons(m, 'Why this score? ▾').length, 0, 'no score, nothing to explain');
  } finally { await m.unmount(); restore(); }
});

test('Why this score? opens every receipt', async () => {
  const { m, restore } = await mountZone(body([PARTIAL]));
  try {
    assert.equal(byTestId(m, 'lead-why').length, 0);
    await press(m, 'Why this score? ▾');
    const why = textOf(byTestId(m, 'lead-why')[0]);
    for (const s of ['Met · Web build · match', 'Missed · Below your floor', 'Not measured · No budget floor stated']) {
      assert.ok(why.includes(s), `missing ${s}`);
    }
  } finally { await m.unmount(); restore(); }
});

test('each view narrows the list, and an empty view names the population', async () => {
  const { m, restore } = await mountZone(body([STRONG, PARTIAL, UNSCORED, EXCLUDED]));
  try {
    const chip = (label) => m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim().startsWith(label));
    const pick = async (label) => { await act(async () => { m.props(chip(label)).onClick({}); }); };
    assert.deepEqual(cardNames(m), ['Lumen Pay', 'Bramble Health', 'Orchard AI', 'Tidal Freight']);
    await pick('Strong fit'); assert.deepEqual(cardNames(m), ['Lumen Pay']);
    await pick('Unscored'); assert.deepEqual(cardNames(m), ['Orchard AI']);
    await pick('Excluded'); assert.deepEqual(cardNames(m), ['Tidal Freight']);
    await pick('Recent'); assert.deepEqual(cardNames(m), ['Orchard AI', 'Lumen Pay']);
    await pick('All'); assert.equal(cardNames(m).length, 4);
  } finally { await m.unmount(); restore(); }

  const two = await mountZone(body([PARTIAL]));
  try {
    const chip = two.m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim().startsWith('Strong fit'));
    await act(async () => { two.m.props(chip).onClick({}); });
    assert.equal(textOf(byTestId(two.m, 'lead-view-empty')[0]), 'No open lead scores 80 or above. 1 open in total.');
  } finally { await two.m.unmount(); two.restore(); }
});

test('the toolbar carries Edit capability rules, linked to the fit-rule editor', async () => {
  const { m, restore } = await mountZone(body([STRONG]));
  try {
    const link = m.nodes().find((n) => n.tagName === 'A' && textOf(n).trim() === 'Edit capability rules');
    assert.ok(link, 'no Edit capability rules link');
    assert.equal(m.props(link).href ?? m.props(link).to, '/offers/audience-fit');
  } finally { await m.unmount(); restore(); }
});

test('the pass dialog needs a reason, sends the reason and the note, and closes once it saved', async () => {
  const calls = [];
  const { m, restore } = await mountZone(body([STRONG]), { passPartnerLead: async (id, b) => { calls.push([id, b]); return {}; } });
  try {
    await press(m, 'Pass');
    assert.match(m.text(), /Pass on Lumen Pay\?/);
    assert.match(m.text(), /A pass is not a loss\./);
    const confirm = () => byTestId(m, 'lead-pass-confirm')[0];
    assert.equal(m.props(confirm()).disabled, true, 'no reason, no pass');
    const radios = m.nodes().filter((n) => n.tagName === 'INPUT' && m.props(n).type === 'radio');
    assert.deepEqual(radios.map((r) => m.props(r).value), PASS_REASONS.map(([k]) => k));
    await act(async () => { m.props(radios[2]).onChange({}); });
    assert.equal(m.props(confirm()).disabled, false);
    const note = m.nodes().find((n) => m.props(n)?.['data-testid'] === 'lead-pass-note');
    await act(async () => { m.props(note).onChange({ target: { value: 'Outside our practice' } }); });
    await act(async () => { m.props(confirm()).onClick({}); });
    await m.flush();
    assert.deepEqual(calls, [[1, { reason: 'scope_mismatch', note: 'Outside our practice' }]]);
    assert.equal(byTestId(m, 'lead-pass-dialog').length, 0);
  } finally { await m.unmount(); restore(); }
});

test('Cancel closes the dialog and sends nothing', async () => {
  const calls = [];
  const { m, restore } = await mountZone(body([STRONG]), { passPartnerLead: async (...a) => { calls.push(a); return {}; } });
  try {
    await press(m, 'Pass');
    await press(m, 'Cancel');
    assert.equal(byTestId(m, 'lead-pass-dialog').length, 0);
    assert.deepEqual(calls, []);
  } finally { await m.unmount(); restore(); }
});
