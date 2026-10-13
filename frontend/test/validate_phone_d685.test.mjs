/**
 * D685 §5.12 (#1589) — Validate's phone focus, below md, from the reads that
 * exist: the focus card's rules, the interviews meter with and without a
 * target, and the seven index rows, each from the raw overview, a missing
 * value "Not recorded", never 0.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_phone_d685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { FIRST_FOCUS, phoneFocus, phoneIndex, phoneMeter } from '../src/pages/cycles/validatePhone.js';
import ValidatePhoneFocus from '../src/pages/cycles/ValidatePhoneFocus.jsx';

const h = React.createElement;
const html = (raw, search = '?project_id=3') => renderToStaticMarkup(h(MemoryRouter, null, h(ValidatePhoneFocus, { raw, search })));
const tag = (out, id) => new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`).exec(out)?.[0] ?? '';

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
  const worker = phoneFocus({ ...RAW, focus: { eyebrow: 'Validate · Next', headline: 'Review the interview with Dana from 12 Oct.', why: 'It is transcribed but not yet placed.', cta: { text: 'Review the interview', href: '/validate/interviews/41' } } });
  assert.equal(worker.headline, 'Review the interview with Dana from 12 Oct.');
  assert.equal(worker.href, '/validate/interviews/41');
  assert.equal(worker.then, null);
});

test('the meter: the count held this month, "No target set" until one is stored, a bar only against a target', () => {
  assert.deepEqual(phoneMeter(RAW), { label: 'Interviews this month', count: 14, target: null, pct: null, unreadable: false });
  assert.deepEqual(phoneMeter({ ...RAW, meter: { target: 20 } }), { label: 'Interviews this month', count: 14, target: 20, pct: 70, unreadable: false });
  assert.equal(phoneMeter({ ...RAW, meter: { target: 0 } }).target, null, 'a zero target is no target');
  assert.equal(phoneMeter({ figures: [{ key: 'interviews_this_month', value: null, state: 'empty' }] }).count, null, 'none recorded: null, never 0');
  assert.equal(phoneMeter({ figures: [{ key: 'interviews_this_month', state: 'unreadable' }] }).unreadable, true);
  const out = html(RAW);
  assert.match(out, /data-testid="phone-meter-value">14(<!-- -->)? <span[^>]*>· No target set<\/span>/);
  assert.doesNotMatch(out, /role="progressbar"/, 'no target, no bar');
  assert.doesNotMatch(out, /\[20\]|of 20/, 'never the canvas\'s placeholder');
  const withTarget = html({ ...RAW, meter: { target: 20 } });
  assert.match(withTarget, /14 of 20/);
  assert.match(withTarget, /aria-valuenow="70"/);
  assert.match(html({ figures: [{ key: 'interviews_this_month', state: 'unreadable' }], cards: RAW.cards }), />Unreadable</);
});

test('the index: the canvas\'s seven rows, each linking to its page, each from the overview, a missing value "Not recorded"', () => {
  const rows = phoneIndex(RAW, '?project_id=3');
  assert.deepEqual(rows.map((r) => r.title), ['Interviews', 'Problem discovery', 'Customer research', 'Ideal customer profile', 'Market intelligence', 'Demand and urgency signals', 'Experiments and evidence']);
  assert.deepEqual(rows.map((r) => r.href), ['/validate/interviews?project_id=3', '/validate/problem-discovery?project_id=3', '/validate/customer-research?project_id=3', '/validate/ideal-customer-profile?project_id=3', '/validate/market-intelligence?project_id=3', '/validate/demand-signals?project_id=3', '/validate/experiments?project_id=3']);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by['problem-discovery'].detail, '9 pain themes · 2 new');
  assert.equal(by['customer-research'].detail, 'Recruiting · 3 booked', 'booked only: booked − done, not the cumulative funnel');
  assert.equal(by['ideal-customer-profile'].detail, '3 segments');
  assert.equal(by['market-intelligence'].value, '$610M');
  assert.equal(by['demand-signals'].detail, 'Waitlist against the bar of 40');
  assert.equal(by.experiments.value, '3 of 7');
  assert.equal(by.interviews.value, null, 'the log\'s count is the Worker\'s index, not on the overview yet');
  const empty = Object.fromEntries(phoneIndex({ figures: [], cards: [] }).map((r) => [r.key, r]));
  for (const r of Object.values(empty)) assert.equal(r.value, null, `${r.key}: Not recorded`);
  assert.equal(empty['problem-discovery'].detail, 'Pain themes');
  assert.equal(empty['customer-research'].detail, 'Recruiting');
  assert.equal(phoneIndex({ ...RAW, figures: [{ key: 'pain_themes', value: 4, delta_30d: -1 }] })[1].detail, '4 pain themes', 'a drop is not "new"');
  assert.equal(phoneIndex({ ...RAW, index: { interviews: 22 } })[0].value, 22, 'the Worker\'s count when it sends one');
  const out = html({ figures: [], cards: [] });
  assert.equal((out.match(/>Not recorded</g) || []).length >= 7, true);
  assert.doesNotMatch(renderedText(out), /\b0 (pain themes|segments|booked)\b/, 'never a zero for a missing value');
});

test('phone only, a full-width CTA, dark pairs; mounted above the Validate overview from the raw read', () => {
  const out = html(RAW);
  assert.match(tag(out, 'validate-phone'), /md:hidden/);
  assert.match(tag(out, 'phone-focus-cta'), /w-full/);
  assert.match(tag(out, 'phone-focus-cta'), /href="\/validate\/customer-research\?project_id=3"/);
  assert.match(out, /dark:bg-gray-900/);
  assert.ok(renderedText(out).includes('Everything else in Validate'));
  const first = html({ cards: [{ slug: 'customer-research', state: 'empty' }] });
  assert.ok(renderedText(first).includes('Then: Write the claim you most need to be true.'));
  assert.match(tag(first, 'phone-focus-cta'), /href="\/validate\/record\?project_id=3"/);
  assert.doesNotMatch(first, /data-testid="phone-meter"/, 'no meter on the first-conversation card, as drawn');
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.match(route, /\{cycle === 'validate' && overviewStatus === 'ready' && rawOverview && projectStatus !== 'unreadable' && <ValidatePhoneFocus raw=\{rawOverview\} search=\{q\} \/>\}/);
  assert.match(route, /setRawOverview\(data\); setOverview\(adaptOverview\(cycle, data\)\)/, 'the raw read, before adapting');
});
