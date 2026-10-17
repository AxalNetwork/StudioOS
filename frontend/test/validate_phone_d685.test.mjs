/**
 * D685 §5.12 (#1589) — Validate's phone focus, from the reads that exist: the
 * focus card's rules, the interviews meter with and without a target, and the
 * index rows, a missing value "Not recorded", never 0. Since D703 (#1665's
 * PR 1b) it is `PhoneCycleRoot` with `cycle: 'validate'`, drawn by
 * `CycleRoute` below 1024px, and the index is the Worker's rows.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_phone_d685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { FIRST_FOCUS, phoneFocus, phoneIndex, phoneMeter, targetValue } from '../src/pages/cycles/validatePhone.js';
import PhoneCycleRoot from '../src/pages/cycles/PhoneCycleRoot.jsx';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';

const h = React.createElement;
const html = (raw, search = '?project_id=3') => renderToStaticMarkup(h(MemoryRouter, null, h(PhoneCycleRoot, { cycle: 'validate', raw, search })));
const tag = (out, id) => {
  const at = out.indexOf(`data-testid="${id}"`);
  return at < 0 ? '' : out.slice(out.lastIndexOf('<', at), out.indexOf('>', at) + 1);
};

const RAW = {
  figures: [
    { key: 'interviews_this_month', value: 14, state: 'ok' },
    { key: 'pain_themes', value: 9, delta_30d: 2, state: 'ok' },
    { key: 'hypotheses_supported', value: 3, unit: 'of 7', state: 'ok' },
  ],
  cards: [
    { slug: 'problem-discovery', name: 'Problem discovery', state: 'ok', series: {}, next: null },
    { slug: 'customer-research', name: 'Customer research', state: 'ok', series: { funnel: { lead: 20, invited: 12, booked: 8, done: 5 } }, next: { text: 'Book the 2 invited leads with no slot yet', href: '/validate/customer-research?project_id=3' }, reason: null },
    { slug: 'ideal-customer-profile', name: 'Ideal customer profile', state: 'ok', series: { segments: [{ id: 1 }, { id: 2 }, { id: 3 }] } },
    { slug: 'market-intelligence', name: 'Market intelligence', state: 'ok', series: { sam: { value: 610000000 } } },
    { slug: 'demand-signals', name: 'Demand and urgency signals', state: 'ok', series: { bar: 40 } },
  ],
};

test('the focus: no interview gives the canvas\'s first-conversation card; otherwise the first card\'s next; the Worker\'s own focus when it sends one', () => {
  const first = phoneFocus({ cards: [{ slug: 'customer-research', state: 'empty', next: { text: 'Record your first session', href: '/validate/record?project_id=3' } }] }, '?project_id=3');
  assert.deepEqual(first, { ...FIRST_FOCUS, href: '/validate/record?project_id=3' });
  assert.equal(FIRST_FOCUS.why, 'Validate starts with one interview. Everything else in the venture builds on what it finds.', 'word for word');
  assert.equal(FIRST_FOCUS.then, 'Write the claim you most need to be true.');
  const next = phoneFocus(RAW);
  assert.equal(next.headline, 'Book the 2 invited leads with no slot yet.');
  assert.equal(next.href, '/validate/customer-research?project_id=3');
  assert.equal(next.cta, 'Open Customer research');
  assert.equal(next.then, null, 'no "Then" line without a stored rule behind it');
  assert.equal(phoneFocus({ cards: [{ slug: 'x', next: { text: 'Go', href: 'https://evil.example' } }] }), null, 'only in-app paths');
  assert.equal(phoneFocus({ cards: [] }), null);
  // #1609's shape: { rule, eyebrow, headline, why, cta: { label, href }, then }.
  const worker = phoneFocus({ ...RAW, focus: { rule: 'review', eyebrow: 'Validate · Next', headline: 'Review the interview with Dana from 12 Oct.', why: 'It is transcribed but not yet placed.', cta: { label: 'Review the interview', href: '/validate/interviews/41' }, then: null } });
  assert.equal(worker.headline, 'Review the interview with Dana from 12 Oct.');
  assert.equal(worker.cta, 'Review the interview');
  assert.equal(worker.href, '/validate/interviews/41');
  assert.equal(worker.then, null);
});

test('the meter: the count held this month, "No target set" until one is stored, a bar only against a target', () => {
  assert.deepEqual(phoneMeter(RAW), { label: 'Interviews this month', count: 14, target: null, pct: null, unreadable: false, display: '14', target_reason: 'No target set' });
  assert.deepEqual(phoneMeter({ ...RAW, meter: { target: 20 } }), { label: 'Interviews this month', count: 14, target: 20, pct: 70, unreadable: false, display: '14 of 20', target_reason: null });
  assert.equal(phoneMeter({ ...RAW, meter: { target: 0 } }).target, null, 'a zero target is no target');
  assert.equal(phoneMeter({ figures: [{ key: 'interviews_this_month', value: null, state: 'empty' }] }).count, null, 'none recorded: null, never 0');
  assert.equal(phoneMeter({ figures: [{ key: 'interviews_this_month', state: 'unreadable' }] }).unreadable, true);
  // #1609's meter: its count wins (none logged is a counted 0), and its target.
  assert.deepEqual(phoneMeter({ ...RAW, meter: { key: 'interviews_this_month', count: 0, target: 12, target_reason: null } }), { label: 'Interviews this month', count: 0, target: 12, pct: 0, unreadable: false, display: '0 of 12', target_reason: null });
  assert.equal(phoneMeter({ figures: [{ key: 'interviews_this_month', state: 'unreadable' }], meter: { count: null, target: null } }).unreadable, true, 'a null Worker count falls back to the figure');
  assert.equal(phoneMeter({ figures: [{ key: 'interviews_this_month', state: 'unreadable' }], meter: { count: 3, target: null } }).unreadable, false, 'the Worker counted: not unreadable');
  const out = html(RAW);
  assert.match(out, /data-testid="phone-meter-value">14(<!-- -->)? <span[^>]*>· No target set<\/span>/);
  assert.doesNotMatch(out, /role="progressbar"/, 'no target, no bar');
  assert.doesNotMatch(out, /\[20\]|of 20/, 'never the canvas\'s placeholder');
  const withTarget = html({ ...RAW, meter: { target: 20 } });
  assert.match(withTarget, /14 of 20/);
  assert.match(withTarget, /aria-valuenow="70"/);
  assert.match(html({ figures: [{ key: 'interviews_this_month', state: 'unreadable' }], cards: RAW.cards }), />Unreadable</);
});

test('the index: the Worker\'s rows as sent, each linking to its page; with none sent, one "Unreadable" row per card, never a row the browser builds', () => {
  const sent = [
    { key: 'problem-discovery', title: 'Problem discovery', detail: '9 pain themes · 2 new', value: '', href: '/validate/problem-discovery?project_id=3' },
    { key: 'customer-research', title: 'Customer research', detail: 'Recruiting · 3 booked', value: '', href: '/validate/customer-research?project_id=3' },
    { key: 'market-intelligence', title: 'Market intelligence', detail: 'Total, serviceable, obtainable', value: null, href: '/validate/market-intelligence?project_id=3' },
    { key: 'experiments', title: 'Experiments and evidence', detail: 'Hypotheses supported', value: '3 of 7', href: '/validate/experiments?project_id=3' },
  ];
  const rows = phoneIndex({ ...RAW, index: sent }, '?project_id=3');
  assert.deepEqual(rows.map((r) => [r.key, r.detail, r.value, r.href]), sent.map((r) => [r.key, r.detail, r.value, r.href]));
  // None sent (null), or #1609's retired `{ interviews_total, booked }` object: the cards, each "Unreadable".
  for (const index of [null, undefined, { interviews_total: 22, booked: 4 }]) {
    const fallback = phoneIndex({ ...RAW, index }, '?project_id=3');
    assert.deepEqual(fallback.map((r) => r.key), RAW.cards.map((c) => c.slug), String(index));
    assert.ok(fallback.every((r) => r.value === 'Unreadable'), 'no figure is built in the browser');
    assert.deepEqual(fallback.map((r) => r.href), RAW.cards.map((c) => `/validate/${c.slug}?project_id=3`));
  }
  const out = html({ ...RAW, index: sent });
  assert.equal((out.match(/>Not recorded</g) || []).length, 1, 'the one null value');
  assert.doesNotMatch(renderedText(out), /\b0 (pain themes|segments|booked)\b/, 'never a zero for a missing value');
});

test('a full-width CTA, dark pairs; CycleRoute draws the root below 1024px from the raw read', () => {
  const out = html(RAW);
  assert.doesNotMatch(tag(out, 'phone-root'), /md:hidden/, 'no breakpoint of its own: the route picks the page');
  assert.match(tag(out, 'phone-focus-cta'), /w-full/);
  assert.match(tag(out, 'phone-focus-cta'), /href="\/validate\/customer-research\?project_id=3"/);
  assert.match(tag(out, 'phone-focus-cta'), /bg-violet-700[^"]*dark:bg-violet-600/);
  assert.ok(renderedText(out).includes('Everything else in Validate'));
  const first = html({ cards: [{ slug: 'customer-research', state: 'empty' }] });
  assert.match(first, />Then<\/p><p[^>]*>Write the claim you most need to be true\.<\/p>/, '"Then" once, as a label');
  assert.doesNotMatch(renderedText(first), /Then:/);
  assert.match(tag(first, 'phone-focus-cta'), /href="\/validate\/record\?project_id=3"/);
  assert.doesNotMatch(first, /data-testid="phone-meter"/, 'no meter on the first-conversation card, as drawn');
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.ok(route.includes('<PhoneCycleRoot cycle={cycle} raw={rawOverview} status={overviewState} search={q} projectId={projectId}\n        openAction={openAction} onChanged={() => setReload((n) => n + 1)} onRetry={() => setReload((n) => n + 1)} />'),
    'a saved target re-reads the overview');
  assert.match(route, /setRawOverview\(data\); setOverview\(adaptOverview\(cycle, data\)\)/, 'the raw read, before adapting');
});

test('Set a target: a whole number above zero, empty clears it; saved through #1609\'s writer, and the overview read again', async () => {
  assert.deepEqual(targetValue(' 20 '), { value: 20 });
  assert.deepEqual(targetValue(''), { value: null }, 'empty clears the target');
  for (const bad of ['0', '-3', '2.5', 'ten']) assert.match(targetValue(bad).error, /whole number of interviews a month, above zero/, bad);
  const client = readFileSync('frontend/src/lib/api/cycleValidate.js', 'utf8');
  assert.match(client, /setInterviewsTarget: \(projectId, value\) => request\(`\/cycles\/validate\/interviews-target\?\$\{q\(projectId\)\}`, \{ method: 'PUT', body: JSON\.stringify\(\{ value \}\) \}\)/);
  assert.match(readFileSync('cloudflare-worker/src/routes/cycle_validate.ts', 'utf8'), /cycleValidate\.put\('\/interviews-target'/, 'the route it calls is mounted');
  assert.doesNotMatch(html(RAW), /phone-target-open/, 'no venture handed in: no form');

  const calls = [];
  let changed = 0;
  let refuse = null;
  const api = { setInterviewsTarget: async (pid, v) => { calls.push([pid, v]); if (refuse) throw new Error(refuse); return { ok: true }; } };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const render = () => act(async () => { root.render(h(MemoryRouter, null, h(PhoneCycleRoot, { cycle: 'validate', raw: RAW, search: '?project_id=3', projectId: 3, api, onChanged: () => { changed += 1; } }))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const text = () => txt(container).replace(/\s+/g, ' ');
  try {
    await render();
    assert.ok(text().includes('Set a target'));
    await act(async () => { pr(by('phone-target-open')).onClick(); });
    await act(async () => { pr(by('phone-target-input')).onChange({ target: { value: '0' } }); });
    await act(async () => { await pr(by('phone-target-form')).onSubmit({ preventDefault() {} }); });
    assert.deepEqual(calls, [], 'a zero target is never sent');
    assert.ok(text().includes('Enter a whole number of interviews a month, above zero.'));
    refuse = 'The target is a whole number of interviews a month, above zero';
    await act(async () => { pr(by('phone-target-input')).onChange({ target: { value: '25' } }); });
    await act(async () => { await pr(by('phone-target-form')).onSubmit({ preventDefault() {} }); });
    assert.ok(text().includes('The target is a whole number of interviews a month, above zero'), 'the Worker\'s refusal in its words');
    assert.equal(changed, 0);
    refuse = null;
    await act(async () => { await pr(by('phone-target-form')).onSubmit({ preventDefault() {} }); });
    assert.deepEqual(calls.at(-1), [3, 25]);
    assert.equal(changed, 1, 'saved: the overview is read again');
    assert.equal(by('phone-target-form'), undefined, 'and the form closes');
  } finally { await act(async () => root.unmount()); restore(); }
});
