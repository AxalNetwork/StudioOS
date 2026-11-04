/** D4481: synthetic Learning home actions through the existing clients, on desktop and phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import LearningHome from '../src/pages/learning/LearningHome.jsx';
import MyPrograms from '../src/pages/learning/MyPrograms.jsx';
import { homeRefusal } from '../src/pages/learning/LearningHomeActions.jsx';

const h = React.createElement;
const props = (node) => Object.entries(node || {}).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
const text = (node) => node?.nodeType === 3 ? node.textContent : node?.childNodes?.length ? node.childNodes.map(text).join('') : node?.textContent || '';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
async function mounted(element, phone = false) {
  const restore = installDocument(), previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const find = (id) => nodes().find((node) => props(node)['data-testid'] === id);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/learning'] }, element)); await settle(); });
  return { nodes, find, props: (id) => props(find(id)), text: () => text(document.body),
    async click(id) { const node = find(id); assert.ok(node, `control ${id} exists`); assert.ok(!props(node).disabled, 'control enabled'); await act(async () => { await props(node).onClick({ button: 0, preventDefault() {} }); await settle(); }); },
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = previous; restore(); } };
}
function server({ full = false, holdRegistration = false, holdJoin = false, me = [], unknownSeats = false } = {}) {
  let registered = false, joined = false;
  const releases = [], calls = [];
  const webinar = { uid: 'w1', title: 'Synthetic webinar', starts_at: '2099-11-06T14:00:00Z', ends_at: '2099-11-06T15:00:00Z', status: 'published', ...(unknownSeats ? {} : { capacity: 3, registered_count: registered ? 2 : 1, seats_left: registered ? 1 : 2 }) };
  const program = { uid: 'p1', name: 'Synthetic program', region: 'Lisbon', status: 'published', enrolment: 'open' };
  const contents = [{ subject_kind: 'course', subject_uid: 'c1', title: 'Course', status: 'published' }, { subject_kind: 'item', subject_uid: 'v1', title: 'Video', status: 'published' }];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'https://synthetic.test').pathname, method = init.method || 'GET'; calls.push([method, path]);
    if (path === '/api/learning/catalog') return json({ items: [], sources: {}, limit: 24, offset: 0 });
    if (path === '/api/learning/me') return json({ in_progress: me, completed: [] });
    if (path === '/api/learning/me/stats') return json({});
    if (path === '/api/learning/webinars') return json({ webinars: [{ ...webinar, registered }] });
    if (path === '/api/learning/webinars/w1/registration') {
      if (full) return json({ error: 'full', message: 'This session has no seats left. Choose another webinar.' }, 409);
      if (holdRegistration) await new Promise((resolve) => releases.push(resolve));
      registered = true; return json({ registration: { registered: true } });
    }
    if (path === '/api/learning/webinars/w1') return json({ webinar: { ...webinar, registered_count: 2, seats_left: 1 }, registration: { registered } });
    if (path === '/api/learning/programs/enrolled') return json({ programs: joined ? [{ ...program, contents, my_completion: [] }] : [] });
    if (path === '/api/learning/programs') return json({ programs: [{ ...program, enrolled: joined }] });
    if (path === '/api/learning/programs/p1/enrol') {
      if (holdJoin) await new Promise((resolve) => releases.push(resolve));
      joined = true; return json({ enrolment: { program_uid: 'p1', status: 'active' } });
    }
    throw Error(`Unexpected synthetic request ${method} ${path}`);
  };
  return { fetch, calls, allowRegistration: () => { full = false; }, release: () => releases.splice(0).forEach((resolve) => resolve()) };
}
async function withHome(options, run, element = h(LearningHome, { gated: false })) {
  const fixture = server(options), original = globalThis.fetch; globalThis.fetch = fixture.fetch;
  let page;
  try { page = await mounted(element, !!options.phone); await run(page, fixture); }
  finally { fixture.release(); if (page) await page.close(); globalThis.fetch = original; }
}

test('Register writes once under a same-frame double click, stays busy, then shows Registered and fresh seats', async () => {
  for (const phone of [false, true]) await withHome({ holdRegistration: true, phone }, async (page, fixture) => {
    const node = page.find('home-webinar-register-w1'); assert.ok(node, 'home Register is a button');
    const handler = props(node).onClick; let writes = [];
    try {
      await act(async () => { writes = [handler(), handler()]; await settle(); });
      assert.equal(fixture.calls.filter(([method, path]) => method === 'POST' && path.endsWith('/registration')).length, 1);
      assert.equal(page.props('home-webinar-register-w1').disabled, true);
      assert.match(page.text(), /Registering…/);
      await act(async () => { fixture.release(); await Promise.all(writes); await settle(); });
      assert.match(text(page.find('home-webinar-w1')), /Registered/);
      assert.match(text(page.find('home-webinar-w1')), /1 seat left/);
      assert.equal(fixture.calls.filter(([method, path]) => method === 'GET' && path === '/api/learning/webinars/w1').length, 1);
    } finally { fixture.release(); await Promise.allSettled(writes); }
  });
});

test('a full refusal stays in its webinar row in the route’s words', async () => {
  for (const phone of [false, true]) await withHome({ full: true, phone }, async (page) => {
    await page.click('home-webinar-register-w1');
    assert.equal(text(page.find('home-webinar-error-w1')), 'This session has no seats left. Choose another webinar.');
    assert.doesNotMatch(text(page.find('home-webinar-w1')), /Registered/);
  });
});

test('Join writes once while busy and rereads the enrolled row with known progress', async () => {
  await withHome({ holdJoin: true }, async (page, fixture) => {
    const node = page.find('button-join-p1'), handler = props(node).onClick; let writes = [];
    try {
      await act(async () => { writes = [handler(), handler()]; await settle(); });
      assert.equal(fixture.calls.filter(([method, path]) => method === 'POST' && path.endsWith('/enrol')).length, 1);
      assert.equal(page.props('button-join-p1').disabled, true);
      await act(async () => { fixture.release(); await Promise.all(writes); await settle(); });
      assert.match(page.text(), /None of 2 complete yet/);
      assert.equal(page.find('button-join-p1'), undefined);
    } finally { fixture.release(); await Promise.allSettled(writes); }
  }, h(MyPrograms));
});

test('empty Continue offers Browse courses and selects the Courses tab', async () => {
  await withHome({}, async (page) => {
    assert.match(page.text(), /No course in progress\./);
    await page.click('learning-browse-courses');
    assert.equal(page.props('tab-courses')['aria-selected'], true);
    assert.match(page.text(), /You are not in a program yet\./);
  });
});

test('phone primary opens the newest in-progress course, skipping a video', async () => {
  const me = [{ subject_kind: 'item', subject_uid: 'v1', item_kind: 'video', title: 'Video' },
    { subject_kind: 'course', subject_uid: 'c1', course_slug: 'newest', title: 'Newest course' },
    { subject_kind: 'course', subject_uid: 'c2', course_slug: 'older', title: 'Older course' }];
  await withHome({ phone: true, me }, async (page) => {
    assert.equal(page.props('learning-phone-primary').href, '/learning/courses/newest');
    assert.equal(text(page.find('learning-phone-primary')), 'Continue Newest course');
    assert.match(page.props('learning-phone-primary').className, /min-h-\[44px\]/);
  });
});

test('empty phone primary browses courses and never adds an AI rail', async () => {
  await withHome({ phone: true }, async (page) => {
    assert.equal(text(page.find('learning-phone-primary')), 'Browse courses');
    assert.match(page.text(), /Your programs/);
    assert.match(text(page.find('learning-phone-programs')), /Open to join.*Join/);
    await page.click('learning-phone-primary');
    assert.equal(page.props('tab-courses')['aria-selected'], true);
    assert.doesNotMatch(page.text(), /Eadwyn AI|Ask Eadwyn/);
  });
});

test('an unknown seat figure stays Seats not recorded, never zero', async () => {
  for (const phone of [false, true]) await withHome({ unknownSeats: true, phone }, async (page) => {
    assert.match(text(page.find('home-webinar-w1')), /Seats not recorded/);
    assert.doesNotMatch(text(page.find('home-webinar-w1')), /0 seats/);
  });
});

test('home refusals use structured route text and do not disclose Error.message', () => {
  const internal = Object.assign(Error('Internal transport detail'), { data: { message: 'The route refused this action.' } });
  assert.equal(homeRefusal(internal, 'Could not confirm.'), 'The route refused this action.');
  assert.equal(homeRefusal(Error('Internal transport detail'), 'Could not confirm.'), 'Could not confirm.');
});


test('a recorded course with no usable link is not called an empty course record', async () => {
  await withHome({ phone: true, me: [{ subject_kind: 'course', subject_uid: 'c-gone', title: 'Recorded course' }] }, async (page) => {
    assert.equal(text(page.find('learning-phone-primary')), 'Course link not recorded');
    assert.equal(page.props('learning-phone-primary').disabled, true);
    assert.doesNotMatch(text(page.find('learning-phone-continue')), /No course in progress/);
  });
});


test('retry clears a prior route refusal while pending and stays clear after success', async () => {
  for (const phone of [false, true]) await withHome({ full: true, holdRegistration: true, phone }, async (page, fixture) => {
    await page.click('home-webinar-register-w1');
    assert.match(text(page.find('home-webinar-error-w1')), /This session has no seats left/);
    fixture.allowRegistration();
    let write;
    try {
      await act(async () => { write = page.props('home-webinar-register-w1').onClick(); await settle(); });
      assert.equal(Boolean(page.find('home-webinar-error-w1')), false);
      await act(async () => { fixture.release(); await write; await settle(); });
      assert.match(text(page.find('home-webinar-w1')), /Registered.*1 seat left|1 seat left.*Registered/);
      assert.doesNotMatch(text(page.find('home-webinar-w1')), /This session has no seats left/);
      assert.equal(fixture.calls.filter(([method, path]) => method === 'POST' && path.endsWith('/registration')).length, 2);
    } finally { fixture.release(); await Promise.allSettled([write]); }
  });
});
