// #2181 (D691 follow-up) — a role's compensation band on the public jobs
// board, when its founder chooses. Open a role and Edit draw one switch under
// the band, only once a band is typed, off unless ticked; the public role page
// draws the canvas's Compensation fact from the read's `compensation` alone.
// Every amount is made up.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/job_comp_public_2181.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { EDITS, FORMS } from '../src/pages/cycles/forms.js';
import { JobBody } from '../src/pages/jobs/PublicJobDetailPage.jsx';
import { compensationText, jobFacts } from '../src/lib/siteNetwork2.js';
import { h, mountForm } from './_form_d695.mjs';

const P = 7;
const SWITCH = 'Show the band on the jobs board';

async function mount(form, { id = null } = {}) {
  const calls = [];
  const grow = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return { id: 1 }; } });
  const onSubmit = (v) => (id == null ? form.submit({ grow }, P, v) : form.submit({ grow }, P, id, v));
  const ui = await mountForm(h(FormLightbox, { form, current: id == null ? null : {}, cycle: 'grow', slug: 'team-expansion', search: '', onSubmit, onClose() {} }));
  return { ...ui, calls };
}

test('the words: a band in its currency, one end alone, then equity', () => {
  // Mutation checked: join the ends with a hyphen → the en dash assertion fails.
  assert.equal(compensationText({ min_cents: 9_000_000, max_cents: 12_000_000, currency: 'usd', equity_pct: null }), '$90,000–$120,000');
  assert.equal(compensationText({ min_cents: 9_000_000, max_cents: 12_000_000, currency: 'usd', equity_pct: 0.5 }), '$90,000–$120,000 · 0.5% equity');
  assert.equal(compensationText({ min_cents: 9_000_000, max_cents: null, currency: 'usd' }), '$90,000');
  assert.equal(compensationText({ min_cents: null, max_cents: 12_000_000, currency: 'eur' }), '€120,000');
  assert.equal(compensationText({ min_cents: 9_500_000, max_cents: 9_500_000, currency: 'usd' }), '$95,000', 'one figure reads once');
  assert.equal(compensationText({ min_cents: null, max_cents: null, equity_pct: 1 }), null);
  assert.equal(compensationText(undefined), null);
  assert.equal(jobFacts({ seniority: 'lead' }).some((f) => f.k === 'Compensation'), false);
});

test('the role page draws Compensation only when the read sends the object', () => {
  // Mutation checked: draw the fact from the stored columns (`comp_min_cents`) → the switched-off role shows a band.
  const base = { id: 9, slug: 'a-role', title: 'A role', employment_type: 'full_time', seniority: 'lead', remote: true, created_at: '2026-08-01 09:00:00' };
  const draw = (job) => renderToStaticMarkup(h(MemoryRouter, null, h(JobBody, { job, related: null, onApply() {} })));
  const shown = draw({ ...base, compensation: { min_cents: 9_000_000, max_cents: 12_000_000, currency: 'usd', equity_pct: 0.5 } });
  assert.match(shown, /<dt class="ax-lbl-q">Compensation<\/dt><dd>\$90,000–\$120,000 · 0\.5% equity<\/dd>/);
  const hidden = draw({ ...base, comp_min_cents: 9_000_000, comp_max_cents: 12_000_000 });
  assert.doesNotMatch(hidden, /Compensation/, 'no object, no row, whatever else the row carries');
});

test('Open a role: the switch appears once a band is typed, is off by default, and sends comp_public', async () => {
  // Mutation checked: tick the switch by default → the first body carries comp_public: 1.
  const form = FORMS.grow['team-expansion'][0];
  const ro = await mount(form);
  try {
    assert.ok(!ro.text().includes(SWITCH), 'no band, no switch');
    await ro.input('title', 'Staff engineer');
    await ro.submit();
    assert.equal('comp_public' in ro.calls[0][2], false, 'no band sends no switch');
    await ro.input('band', '90,000–120,000');
    assert.ok(ro.text().includes(SWITCH));
    await ro.submit();
    assert.equal(ro.calls[1][2].comp_public, 0, 'off unless ticked');
    await ro.choose('comp_public', 'show');
    await ro.submit();
    assert.equal(ro.calls[2][2].comp_public, 1);
  } finally { await ro.unmount(); }
});

test('Edit role: the switch is sent with a typed band, and never without one', async () => {
  const edit = EDITS.grow['team-expansion'];
  const ro = await mount(edit, { id: 5 });
  try {
    await ro.choose('team', 'Product');
    await ro.submit();
    assert.deepEqual(ro.calls[0], ['roleUpdate', P, 5, { team: 'Product' }], 'no band typed: the stored switch is left alone');
    // Mutation checked: send the switch only when ticked → an Edit can never turn it off.
    await ro.input('band', '$90k–$120k');
    await ro.submit();
    assert.equal(ro.calls[1][3].comp_public, 0, 'a typed band with the switch off turns it off');
    await ro.choose('comp_public', 'show');
    await ro.submit();
    assert.equal(ro.calls[2][3].comp_public, 1);
  } finally { await ro.unmount(); }
});
