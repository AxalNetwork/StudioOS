// D1357 (#3572, LinkedIn part 8): relationship intelligence on the page — RI1 sharing, RI2 who knows them, RI3 the ask,
// RI4–RI6 Network › Introductions, RI7 withdraw. Synthetic people only.
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/relationships_ui_3572.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { relationshipsApi } from '../src/lib/api/relationships.js';
import { mailApi } from '../src/lib/api/mail.js';
import WhoKnowsStrip from '../src/pages/relationships/WhoKnowsStrip.jsx';
import SharingCard from '../src/pages/relationships/SharingCard.jsx';
import IntroductionsDesk from '../src/pages/relationships/IntroductionsDesk.jsx';
import {
  NOT_RECORDED, STRIP_EMPTY, STRIP_UNREAD, askReady, followUps, howLine, introSubject, logRows, shareState, stripRows, teamLabelOf, whoKnowsRow,
} from '../src/pages/relationships/relationshipsModel.js';

const h = React.createElement;
const person = (ref, teammate, name = 'Alex Example', extra = {}) => ({
  ref, teammate: { id: ref + 100, name: teammate }, team: { key: 'v:1', label: 'Northwind (co-founders)' },
  person: { name, company: 'Bluefern Capital', title: 'Partner' }, how: { source: 'linkedin_csv', source_label: 'LinkedIn', connected_since: '2021-04-02' }, ...extra,
});

test('a teammate\'s row: who knows whom, how, and the ask — never a contact detail', () => {
  // Mutation checked: the email carried into the detail line → the "@" check fails.
  const r = whoKnowsRow(person(1, 'Lena Hart', 'Alex Example', { person: { name: 'Alex Example', company: 'Bluefern Capital', title: 'Partner', email: 'alex@example.invalid' } }));
  assert.equal(r.knows, 'Lena Hart knows Alex Example');
  assert.equal(r.detail, 'Partner, Bluefern Capital · Northwind (co-founders) · LinkedIn, since 2021');
  assert.equal(r.ask, 'Ask Lena for an introduction');
  assert.equal(JSON.stringify(r).includes('@'), false, 'no email, even when a reply carried one');
  assert.equal(howLine({ source_label: 'LinkedIn', connected_since: null }), 'LinkedIn', 'a date nobody recorded is left out');
  assert.equal(stripRows([1, 2, 3, 4, 5].map((n) => person(n, `Mate ${n}`))).length, 3, 'at most three');
});

test('the ask needs a reason; the log reads Not recorded until an outcome is; follow-ups due first; teams are the member\'s own', () => {
  // Mutation checked: the reason made optional → askReady passes on blank; an outcome-less row read as "No reply" → the cell fails.
  assert.equal(askReady({ reason: '  ', context: '' }), false);
  assert.equal(askReady({ reason: 'A 20-minute call', context: '' }), true);
  assert.equal(askReady({ reason: 'x', context: 'y'.repeat(1001) }), false);
  const read = {
    sent: [{ uid: 'a', status: 'made', created_at: '2026-11-01 10:00:00', team_key: 'v:1', requester: { name: 'Omar Reyes' }, teammate: { name: 'Lena Hart' }, person: { name: 'Alex Example', company: 'Bluefern' }, outcome: { value: null, label: 'Not recorded' }, follow_up: { state: 'snoozed', due_on: '2026-11-02', snoozed_until: '2026-11-10' }, made_at: '2026-10-14 09:00:00' }],
    received: [{ uid: 'b', status: 'accepted', created_at: '2026-11-02 10:00:00', team_key: 'other', requester: { name: 'Sam Okafor' }, teammate: { name: 'Omar Reyes' }, person: { name: 'Ravi Mehta' }, outcome: { value: 'meeting_held', label: 'Meeting held' }, follow_up: { state: 'due', due_on: '2026-11-03' } }],
  };
  const rows = logRows(read, [{ key: 'v:1', label: 'Northwind (co-founders)' }]);
  assert.deepEqual(rows.map((r) => [r.uid, r.who, r.status, r.outcome, r.team, r.followUp]), [
    ['b', 'Sam Okafor → Omar Reyes', 'Accepted', 'Meeting held', 'Your team', 'Due 2026-11-03'],
    ['a', 'Omar Reyes → Lena Hart', 'Made', NOT_RECORDED, 'Northwind (co-founders)', 'Snoozed to 2026-11-10'],
  ]);
  assert.equal(teamLabelOf({ team_key: 'other' }, []), 'Your team', 'another team is never named');
  assert.deepEqual(followUps(read).map((f) => [f.uid, f.state]), [['b', 'due'], ['a', 'snoozed']]);
  assert.match(followUps(read)[1].line, /Lena Hart introduced you on 2026-10-14 · no outcome recorded/);
  assert.equal(introSubject({ person: { name: 'Alex Example', company: 'Bluefern' }, requester: { name: 'Omar Reyes' } }, 'Northwind Labs'), 'Intro: Alex (Bluefern) ↔ Omar (Northwind Labs)');
  assert.deepEqual([shareState({ shared: false }), shareState({ shared: true }), shareState({ shared: false }, true)], ['Off', 'On', 'Turned off just now']);
});

/** Stubs on the shared clients; every call is kept. */
function stubs(answers) {
  const calls = [];
  const saved = { r: { ...relationshipsApi }, m: { ...mailApi } };
  for (const [k, fn] of Object.entries(answers)) {
    const [group, name] = k.split('.');
    const target = group === 'mail' ? mailApi : relationshipsApi;
    target[name] = async (...a) => { calls.push([k, ...a]); return fn(...a); };
  }
  return { calls, restore: () => { Object.assign(relationshipsApi, saved.r); Object.assign(mailApi, saved.m); } };
}
const by = (m, id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
const press = async (m, id, arg) => { const n = by(m, id); assert.ok(n, `missing ${id}`); m.props(n).onClick?.(arg); await m.flush(); await m.flush(); };
const type = async (m, id, value) => { const n = by(m, id); assert.ok(n, `missing ${id}`); m.props(n).onChange({ target: { value } }); await m.flush(); };

test('the strip: up to three teammates who shared, no count of anyone else; the ask needs a reason and sends to the teammate only', async () => {
  // Mutation checked: Send enabled with no reason → the blank send is made; the context sent as the reason → the body check fails.
  const s = stubs({
    'r.whoKnows': async () => ({ query: { kind: 'company' }, people: [1, 2, 3, 4].map((n) => person(n, ['Lena Hart', 'Sam Okafor', 'Priya Nair', 'Dev Testcase'][n - 1])) }),
    'r.requestIntro': async (b) => ({ request: { uid: 'u1', status: 'pending', ...b } }),
  });
  const m = await mountContracts(h(WhoKnowsStrip, { query: { company: 'Bluefern Capital' }, subject: 'someone at Bluefern Capital', testId: 'wk' }), '/raise/capital-relationships');
  try {
    await m.flush();
    const text = m.text();
    assert.match(text, /Teammates who chose to share that they know someone at Bluefern Capital\./);
    assert.ok(by(m, 'wk-row-0') && by(m, 'wk-row-2') && !by(m, 'wk-row-3'), 'three rows');
    assert.doesNotMatch(text, /Dev Testcase|\b4\b|more|hidden|locked/i, 'the fourth is not hinted at');
    assert.equal(text.includes('@'), false, 'no contact detail');
    await press(m, 'wk-ask-0');
    assert.equal(m.props(by(m, 'wk-sheet-send')).disabled, true, 'a reason is required');
    assert.match(m.text(), /Axal sends your request to Lena only\. Nobody contacts Alex unless Lena does\./);
    // #4740 (S1 audit): part 8b merged — "Ask Eadwyn to draft from this record" is live, not disabled.
    assert.equal(m.props(by(m, 'wk-sheet-draft')).disabled, false, 'Eadwyn\'s draft is live now 8b merged');
    await type(m, 'wk-sheet-reason', 'A 20-minute call to see if it fits.');
    await type(m, 'wk-sheet-context', 'We lead logistics software.');
    await press(m, 'wk-sheet-send');
    const sent = s.calls.filter((c) => c[0] === 'r.requestIntro');
    assert.deepEqual(sent.map((c) => c[1]), [{ teammate: 101, ref: 1, note: 'A 20-minute call to see if it fits.', context_note: 'We lead logistics software.' }]);
    assert.ok(by(m, 'wk-sheet-sent'));
    assert.match(m.text(), /Request sent/);
  } finally { s.restore(); await m.unmount(); }
});

test('the strip\'s empty and unreadable states say so, and name nobody', async () => {
  let s = stubs({ 'r.whoKnows': async () => ({ people: [] }) });
  let m = await mountContracts(h(WhoKnowsStrip, { query: { company: 'Halyard' }, subject: 'someone at Halyard', testId: 'wk' }));
  try { await m.flush(); assert.equal(m.text().includes(STRIP_EMPTY), true); } finally { s.restore(); await m.unmount(); }
  s = stubs({ 'r.whoKnows': async () => { throw new Error('down'); } });
  m = await mountContracts(h(WhoKnowsStrip, { query: { company: 'Halyard' }, subject: 'someone at Halyard', testId: 'wk' }));
  try { await m.flush(); assert.equal(m.text().includes(STRIP_UNREAD), true); } finally { s.restore(); await m.unmount(); }
});

test('the sharing setting: off by default, on in one press, off only after the confirmation, then "Turned off just now"', async () => {
  // Mutation checked: turning off without the confirmation → setTeamSharing(false) is called on the first press.
  let teams = [{ key: 'v:1', label: 'Northwind (co-founders)', kind: 'venture', shared: false }, { key: 's:1', label: 'Studio staff', kind: 'studio', shared: true }];
  const s = stubs({
    'r.sharing': async () => ({ opted_in: false, teams }),
    'r.setTeamSharing': async (key, share) => { teams = teams.map((t) => (t.key === key ? { ...t, shared: share } : t)); return { opted_in: share, teams }; },
  });
  const m = await mountContracts(h(SharingCard, { testId: 'sh' }));
  try {
    await m.flush();
    assert.match(m.text(), /Let my team see who I know/);
    assert.match(m.text(), /Their email and phone/);
    assert.equal(m.props(by(m, 'sh-switch-v:1'))['aria-checked'], false);
    await press(m, 'sh-switch-v:1');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'r.setTeamSharing').map((c) => c.slice(1)), [['v:1', true]]);
    await press(m, 'sh-switch-s:1');
    assert.equal(s.calls.filter((c) => c[0] === 'r.setTeamSharing').length, 1, 'off waits for the confirmation');
    assert.match(m.text(), /Stop sharing with Studio staff\?/);
    assert.match(m.text(), /Requests already sent stay in your inbox\./);
    await press(m, 'sh-stop');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'r.setTeamSharing').at(-1).slice(1), ['s:1', false]);
    assert.equal(m.props(by(m, 'sh-state-s:1')).children, 'Turned off just now');
  } finally { s.restore(); await m.unmount(); }
});

const ASK = {
  uid: 'r1', status: 'pending', created_at: '2026-11-02 10:00:00', team_key: 'v:1', note: 'Bluefern leads at seed.', context_note: 'We lead logistics software.',
  requester: { id: 4, name: 'Omar Reyes' }, teammate: { id: 2, name: 'Lena Hart' }, person: { name: 'Alex Example', company: 'Bluefern Capital' },
  outcome: { value: null, label: 'Not recorded' }, follow_up: null,
};

test('Network › Introductions: Accept, Not now with a note, the log\'s Not recorded, and the filters on the member\'s own teams', async () => {
  // Mutation checked: Not now sending "accepted" → the decide call fails; the team filter not sent → the filtered read fails.
  let received = [ASK];
  const s = stubs({
    'r.introRequests': async () => ({ sent: [], received, follow_ups_due: 0 }),
    'r.sharing': async () => ({ teams: [{ key: 'v:1', label: 'Northwind (co-founders)', shared: true }] }),
    'r.decideIntro': async (uid, d, note) => { received = received.map((r) => (r.uid === uid ? { ...r, status: d, decision_note: note ?? null } : r)); return { request: {} }; },
  });
  const m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions');
  try {
    await m.flush(); await m.flush();
    assert.match(m.text(), /Omar Reyes asks you to introduce them to Alex Example · Bluefern Capital/);
    assert.match(m.text(), /“Bluefern leads at seed\.”/);
    assert.equal(m.props(by(m, 'in-outcome-r1')).children, NOT_RECORDED);
    await press(m, 'in-notnow-r1');
    await type(m, 'in-decline-r1-note', 'Not investing this quarter.');
    await press(m, 'in-decline-r1-send');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'r.decideIntro').map((c) => c.slice(1)), [['r1', 'declined', 'Not investing this quarter.']]);
    received = [{ ...ASK, uid: 'r2', status: 'pending' }];
    const filter = by(m, 'in-filter-team');
    m.props(filter).onChange({ target: { value: 'v:1' } }); await m.flush(); await m.flush();
    assert.deepEqual(s.calls.filter((c) => c[0] === 'r.introRequests').at(-1)[1], { team: 'v:1', status: undefined });
    await press(m, 'in-accept-r2');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'r.decideIntro').at(-1).slice(1), ['r2', 'accepted']);
  } finally { s.restore(); await m.unmount(); }
});

test('Write the intro: the Email composer from the member\'s own mailbox, and the send carries the request so Made is recorded', async () => {
  // Mutation checked: the send without intro_uid → the body check fails.
  const s = stubs({
    'r.introRequests': async () => ({ sent: [], received: [{ ...ASK, status: 'accepted' }], follow_ups_due: 1 }),
    'r.sharing': async () => ({ teams: [] }),
    'mail.accounts': async () => ({ accounts: [{ uid: 'acc-1', address: 'lena@example.invalid', can_send: true }] }),
    'mail.confirmSend': async () => ({ nonce: 'n-1' }),
    'mail.send': async (b) => ({ sent: { uid: 's-1', intro_uid: b.intro_uid } }),
  });
  const m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions');
  try {
    await m.flush(); await m.flush();
    assert.match(m.text(), /Follow-ups due · 1/);
    assert.match(m.text(), /Axal sends nothing itself/);
    await press(m, 'in-write-r1');
    await m.flush();
    assert.equal(m.props(by(m, 'record-compose-subject')).value, 'Intro: Alex (Bluefern Capital) ↔ Omar');
    assert.equal(Boolean(by(m, 'record-compose-trigger')), false, 'no Eadwyn trigger until 8b');
    await type(m, 'record-compose-to', 'alex@example.invalid');
    await press(m, 'record-compose-send');
    await press(m, 'record-compose-confirm-send');
    const sent = s.calls.find((c) => c[0] === 'mail.send');
    assert.ok(sent, 'sent');
    assert.equal(sent[1].intro_uid, 'r1');
    assert.equal(sent[1].account_uid, 'acc-1');
  } finally { s.restore(); await m.unmount(); }
});

test('where it lives: Network › Relationships and Introductions, the LinkedIn connector page, an investor and a Deal flow company', () => {
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  assert.match(read('workspaces/NetworkWorkspace.jsx'), /slug === 'introductions' && <Suspense fallback=\{null\}><IntroductionsDesk \/>/);
  assert.match(read('workspaces/NetworkWorkspace.jsx'), /slug === 'relationships' && <Suspense fallback=\{null\}><SharingCard testId="network-sharing" \/>/);
  assert.match(read('pages/account/LinkedInSection.jsx'), /<SharingCard testId="linkedin-sharing" \/>/);
  assert.match(read('pages/raise/caprel/CapRelPipeline.jsx'), /<WhoKnowsStrip query=\{prospect\.email \? \{ person: prospect\.email \} : \{ company: prospect\.firm \}\}/);
  assert.match(read('pages/investor/dealflow/PeekDrawer.jsx'), /<WhoKnowsStrip query=\{\{ company: row\.name \}\}/);
  // Phone: the log scrolls sideways inside its card; dark: every surface carries its dark: class (check-dark-mode).
  assert.match(read('pages/relationships/IntroductionsDesk.jsx'), /overflow-x-auto[\s\S]*min-w-\[720px\]/);
});
