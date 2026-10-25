/** D975 (#2761): the existing roster, exercised through mounted controls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import AdminNetworkProfiles from '../src/pages/admin/AdminNetworkProfiles.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const people = () => [
  { id: 1, name: 'Ada Placeholder', kind: 'mentor', is_active: 1, photo_url: '/api/network/photos/1', skills: [] },
  { id: 2, name: 'Bea Example', kind: 'advisor', is_active: 0, photo_url: '/api/network/photos/2', skills: [] },
  { id: 3, name: 'Pat Sample', kind: 'partner', is_active: 1, skills: [] },
];
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
async function roster({ rows = people(), failRead = false, archive } = {}) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url: String(url), method, body: init.body && JSON.parse(init.body) });
    if (method === 'DELETE' && archive) return archive();
    if (method === 'DELETE') rows = rows.map((p) => p.id === 1 ? { ...p, is_active: 0 } : p);
    return Response.json(method === 'GET' ? (failRead ? { detail: 'read unavailable' } : { profiles: rows }) : {}, { status: failRead && method === 'GET' ? 503 : 200 });
  };
  const m = await mountContracts(React.createElement(AdminNetworkProfiles, { embedded: true }));
  await m.flush();
  const find = (pred) => m.nodes().find((n) => pred(m.props(n) || {}, n));
  return {
    ...m, calls, find,
    async pressTitle(title) { const n = find((p) => p.title === title); assert.ok(n, title); await act(async () => { m.props(n).onClick(); }); },
    input(label) { const n = m.nodes().find((n) => n.tagName === 'LABEL' && text(n).startsWith(label)); return n?.childNodes.find((n) => ['INPUT', 'SELECT'].includes(n.tagName)); },
    async done() { await m.unmount(); globalThis.fetch = previous; },
  };
}

test('the editor defaults to Advisor, offers no Mentor, and creates an advisor', async () => {
  const m = await roster();
  try {
    await m.click('New profile');
    assert.equal(m.props(m.input('Kind')).value, 'advisor');
    assert.deepEqual(m.nodes().filter((n) => n.tagName === 'OPTION').map((n) => m.props(n).value), ['advisor', 'partner', 'investor']);
    await m.fill('Name', 'New Placeholder');
    await m.click('Save');
    const creates = m.calls.filter((c) => c.method === 'POST');
    assert.equal(creates.length, 1);
    assert.equal(creates[0].body.kind, 'advisor');
  } finally { await m.done(); }
});

test('legacy mentors display and edit as Advisors, and join the Advisors tile', async () => {
  const m = await roster();
  try {
    assert.doesNotMatch(m.text(), /[Mm]entor/);
    assert.match(m.text(), /Advisors2/);
    assert.match(m.text(), /Partners1/);
    await m.pressTitle('Edit');
    assert.equal(m.props(m.input('Kind')).value, 'advisor');
    await m.click('Save');
    const update = m.calls.find((c) => c.method === 'PUT');
    assert.equal(update.url, '/api/admin/network-profiles/1');
    assert.equal(update.body.kind, 'advisor');
  } finally { await m.done(); }
});

test('hidden photos use initials in the row and editor; shown photos fall back on failure', async () => {
  const m = await roster();
  try {
    const imgs = () => m.nodes().filter((n) => n.tagName === 'IMG');
    assert.deepEqual(imgs().map((n) => m.props(n).src), ['/api/network/photos/1']);
    assert.match(m.text(), /BE/);
    await act(async () => m.props(imgs()[0]).onError());
    assert.equal(imgs().length, 0);
    assert.match(m.text(), /AP/);
    const edit = m.nodes().filter((n) => m.props(n)?.title === 'Edit')[1];
    await act(async () => m.props(edit).onClick());
    assert.equal(imgs().length, 0, 'the hidden editor must not request the public photo');
    assert.match(m.text(), /BE/);
  } finally { await m.done(); }
});

test('Archive requires its in-page confirmation; Cancel writes nothing, confirmation hides and reloads', async () => {
  const m = await roster();
  try {
    await m.pressTitle('Archive (hide from deck, keep history)');
    const dialog = m.find((p) => p.role === 'dialog');
    assert.ok(dialog);
    assert.equal(m.props(dialog)['aria-modal'], 'true');
    assert.match(m.text(), /Archive Ada Placeholder\?/);
    assert.match(m.text(), /record and photo are kept/);
    assert.match(m.text(), /Show on deck/);
    assert.equal(m.calls.filter((c) => c.method === 'DELETE').length, 0);
    await m.click('Cancel');
    assert.equal(m.find((p) => p.role === 'dialog'), undefined);
    assert.equal(m.calls.filter((c) => c.method === 'DELETE').length, 0);
    await m.pressTitle('Archive (hide from deck, keep history)');
    await m.click('Archive');
    assert.deepEqual(m.calls.filter((c) => c.method === 'DELETE').map((c) => c.url), ['/api/admin/network-profiles/1']);
    assert.equal(m.find((p) => p.role === 'dialog'), undefined);
    assert.ok(m.calls.filter((c) => c.method === 'GET').length >= 2);
    assert.equal(m.nodes().filter((n) => n.tagName === 'IMG').length, 0, 'newly hidden row falls back too');
  } finally { await m.done(); }
});

test('Archive refuses duplicate submission, keeps a failed write in the dialog and retries', async () => {
  let finish;
  let tries = 0;
  const m = await roster({ archive: () => { tries += 1; return tries === 1 ? new Promise((r) => { finish = r; }) : Response.json({}); } });
  try {
    await m.pressTitle('Archive (hide from deck, keep history)');
    const confirm = m.nodes().find((n) => n.tagName === 'BUTTON' && text(n) === 'Archive');
    let pending;
    await act(async () => { pending = m.props(confirm).onClick(); m.props(confirm).onClick(); });
    const submissions = tries;
    const disabled = m.props(confirm).disabled;
    await act(async () => { finish(Response.json({ detail: 'write refused' }, { status: 503 })); await pending; });
    assert.equal(submissions, 1);
    assert.equal(disabled, true);
    assert.ok(m.find((p) => p.role === 'dialog'));
    assert.match(m.text(), /Archive failed:.*write refused.*Try again/s);
    assert.doesNotMatch(m.text(), /Profile archived/);
    await m.click('Archive');
    assert.equal(tries, 2);
    assert.equal(m.find((p) => p.role === 'dialog'), undefined);
  } finally { await m.done(); }
});

test('a failed list stays Unreadable, with retry and without zero tiles or an empty-roster claim', async () => {
  const m = await roster({ failRead: true });
  try {
    assert.match(m.text(), /Unreadable/);
    assert.match(m.text(), /Try again/);
    assert.doesNotMatch(m.text(), /No profiles yet|Advisors0/);
    await m.click('Try again');
    assert.equal(m.calls.filter((c) => c.method === 'GET').length, 2);
  } finally { await m.done(); }
});
