// #4661: a saved application stays visibly submitted, and a submit that may not have landed is settled before another press.
// The real page is mounted; only the network is stubbed. Every name and answer is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { h, mountForm, propsOf } from './_form_d695.mjs';
import SpinoutLabApplyPage from '../src/pages/SpinoutLabApplyPage.jsx';

const APPLICATION = { id: 41, company_name: 'Synthetic Robotics', status: 'pending', created_at: '2026-11-07 10:00:00', decided_at: null };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

function network(handlers) {
  const before = globalThis.fetch;
  const log = [];
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    log.push(`${method} ${path}`);
    const handler = handlers[`${method} ${path}`] ?? handlers[path];
    if (!handler) return reply({}, 404);
    return handler(opts);
  };
  return { log, restore: () => { globalThis.fetch = before; } };
}

const settle = (m) => m.flush().then(() => m.flush());
const text = (m) => m.text();

const NONE = () => reply({ admitted: false, applicant: null, application: null });
const REVIEW = () => reply({ admitted: false, application: APPLICATION, applicant: { application_id: 41, status: 'pending', submitted_at: '2026-11-07 10:00:00', decided_at: null, withdrawn_at: null, answers: null, answers_recorded: true, pool: null, note: null, interview: null, reapply: null } });
const DRAFT = () => reply({ draft: null });

async function mountApply(handlers) {
  const net = network({ 'GET /spinout-lab/apply/draft': DRAFT, ...handlers });
  const m = await mountForm(h(SpinoutLabApplyPage));
  await settle(m);
  const press = async (id) => { const node = m.by(id); assert.ok(node, `no ${id}`); await act(async () => propsOf(node).onClick?.({ preventDefault() {} })); await settle(m); };
  const type = async (id, value) => { const node = m.by(id); assert.ok(node, `no ${id}`); await act(async () => propsOf(node).onChange({ target: { value } })); };
  const fillToSubmit = async () => {
    await type('apply-company', 'Synthetic Robotics'); await type('apply-idea', 'A synthetic idea for the test.'); await press('apply-continue');
    await press('origin-independent'); await press('apply-continue');
    await type('apply-team-size', '2'); await press('apply-continue');
    await press('apply-continue');
    await type('apply-why', 'Synthetic reason.');
    assert.ok(m.by('apply-submit'), 'the last step has Submit');
  };
  return { m, net, press, type, fillToSubmit, posts: () => net.log.filter((l) => l === 'POST /spinout-lab/apply').length, states: () => net.log.filter((l) => l === 'GET /spinout-lab/state').length,
    async close() { await m.unmount(); net.restore(); } };
}

test('a saved application stays visibly submitted when the status read after it fails, and the read can be retried', async () => {
  let reads = 0;
  const t = await mountApply({
    'GET /spinout-lab/state': () => { reads += 1; return reads === 1 ? NONE() : reads === 2 ? Promise.reject(new TypeError('network down')) : REVIEW(); },
    'POST /spinout-lab/apply': () => reply({ ok: true, emailed: false, application: APPLICATION }, 201),
  });
  try {
    await t.fillToSubmit();
    await t.press('apply-submit');
    assert.equal(t.posts(), 1);
    assert.equal(t.m.by('apply-submit'), undefined, 'the form is gone: the application is submitted');
    assert.ok(t.m.by('apply-refresh-failed'), 'a failed status read is its own notice');
    assert.doesNotMatch(t.m.text(), /was not submitted/, 'never says it was not submitted');
    assert.equal(t.m.by('apply-error'), undefined);
    assert.match(t.m.text(), /Synthetic Robotics/, 'the committed application is what the page shows');
    await t.press('apply-refresh-retry');
    assert.equal(t.m.by('apply-refresh-failed'), undefined, 'the retry read it');
    assert.equal(t.posts(), 1, 'retrying the read never submits again');
  } finally { await t.close(); }
});

test('a status read that comes back empty after a commit is not believed: the submitted page stays', async () => {
  let reads = 0;
  const t = await mountApply({
    'GET /spinout-lab/state': () => { reads += 1; return NONE(); },
    'POST /spinout-lab/apply': () => reply({ ok: true, application: APPLICATION }, 201),
  });
  try {
    await t.fillToSubmit();
    await t.press('apply-submit');
    assert.equal(t.m.by('apply-submit'), undefined, 'not sent back to an empty form');
    assert.ok(t.m.by('apply-refresh-failed'));
  } finally { await t.close(); }
});

test('a refused submit (a definite 4xx) keeps every answer, shows the Worker\'s words and does not re-read the status', async () => {
  const t = await mountApply({
    'GET /spinout-lab/state': NONE,
    'POST /spinout-lab/apply': () => reply({ error: 'answers_incomplete', message: 'Some required answers are missing.' }, 400),
  });
  try {
    await t.fillToSubmit();
    const before = t.states();
    await t.press('apply-submit');
    assert.ok(t.m.by('apply-error'));
    assert.ok(t.m.by('apply-submit'), 'still on the form');
    assert.equal(t.m.by('apply-unconfirmed'), undefined, 'a refusal is not ambiguous');
    assert.equal(t.states(), before, 'nothing to reconcile');
    assert.equal(propsOf(t.m.by('apply-why')).value, 'Synthetic reason.', 'the answers are still there');
  } finally { await t.close(); }
});

test('a submit with no answer is settled before another press: not received → the form stays, answers kept', async () => {
  let reads = 0;
  const t = await mountApply({
    'GET /spinout-lab/state': () => { reads += 1; return NONE(); },
    'POST /spinout-lab/apply': () => Promise.reject(new TypeError('network down')),
  });
  try {
    await t.fillToSubmit();
    await t.press('apply-submit');
    assert.equal(t.posts(), 1);
    assert.ok(reads >= 2, 'the status was read to find out');
    assert.match(t.m.text(), /Your application was not received/);
    assert.equal(propsOf(t.m.by('apply-submit')).disabled, false, 'known not to have landed: pressing again is safe');
    assert.equal(propsOf(t.m.by('apply-why')).value, 'Synthetic reason.');
  } finally { await t.close(); }
});

test('a submit with no answer whose status cannot be read shuts Submit until the member checks; the check finds it landed', async () => {
  let reads = 0;
  const t = await mountApply({
    'GET /spinout-lab/state': () => { reads += 1; return reads === 1 ? NONE() : reads === 2 ? Promise.reject(new TypeError('still down')) : REVIEW(); },
    'POST /spinout-lab/apply': () => Promise.reject(new TypeError('network down')),
  });
  try {
    await t.fillToSubmit();
    await t.press('apply-submit');
    assert.ok(t.m.by('apply-unconfirmed'), 'it says it cannot tell');
    assert.equal(propsOf(t.m.by('apply-submit')).disabled, true, 'no second press while the first is unsettled');
    assert.doesNotMatch(t.m.text(), /was not (submitted|received)/, 'never claims either way');
    await t.press('apply-check');
    assert.equal(t.m.by('apply-unconfirmed'), undefined);
    assert.equal(t.m.by('apply-submit'), undefined, 'it had landed: the submitted page shows');
    assert.equal(t.posts(), 1, 'one POST in all');
  } finally { await t.close(); }
});

test('a 409 ("already in review") is reconciled, not shown as a failure', async () => {
  let reads = 0;
  const t = await mountApply({
    'GET /spinout-lab/state': () => { reads += 1; return reads === 1 ? NONE() : REVIEW(); },
    'POST /spinout-lab/apply': () => reply({ error: 'You already have an application in review' }, 409),
  });
  try {
    await t.fillToSubmit();
    await t.press('apply-submit');
    assert.equal(t.m.by('apply-submit'), undefined, 'the application that exists is shown');
    assert.equal(t.m.by('apply-error'), undefined);
  } finally { await t.close(); }
});

test('a 5xx on the submit is as ambiguous as no answer: the status is read, and Submit stays shut if it cannot be', async () => {
  let reads = 0;
  const t = await mountApply({
    'GET /spinout-lab/state': () => { reads += 1; return reads === 1 ? NONE() : Promise.reject(new TypeError('down')); },
    'POST /spinout-lab/apply': () => reply({ error: 'server_error' }, 503),
  });
  try {
    await t.fillToSubmit();
    await t.press('apply-submit');
    assert.ok(t.m.by('apply-unconfirmed'), 'a 503 may have committed');
    assert.equal(propsOf(t.m.by('apply-submit')).disabled, true);
    assert.equal(t.posts(), 1);
  } finally { await t.close(); }
});
