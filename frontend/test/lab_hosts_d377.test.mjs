/**
 * D377 — /spinout-lab/office-hours lists only the hosts an admin approved
 * (migration 313). The Worker half is cloudflare-worker/test/lab_hosts_d377.test.ts.
 *
 * This pins the frontend: the page reads the approved-hosts directory (never
 * the whole partner table), maps each host to a bookable entry and books an
 * advisor on the advisor route; a partner or advisor applies from their own
 * page; and an admin decides from Admin · Spin-Out Lab.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lab_hosts_d377.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { hostEntry, hostRole } from '../src/pages/SpinoutLabOfficeHoursPage.jsx';
import { LabHostApplyView, hostStanding } from '../src/components/officehours/LabHostApplyCard.jsx';
import { LabHostsView, decisionsFor } from '../src/pages/admin/AdminLabHosts.jsx';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const PAGE = read('../src/pages/SpinoutLabOfficeHoursPage.jsx');
const API = read('../src/lib/api.js');
const ENTITY = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const text = (h) => h.replace(/<[^>]+>/g, ' ')
  .replace(/&(?:#x27|quot|amp|lt|gt);/g, (e) => ENTITY[e]).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- directory

test('D377: a partner host keeps its partners.id; an advisor host gets an id that cannot collide', () => {
  assert.deepEqual(hostEntry({ kind: 'partner', host_id: 7, uid: 'p-7', name: 'Ada' }),
    { kind: 'partner', host_id: 7, uid: 'p-7', name: 'Ada', id: 7 });
  const a = hostEntry({ kind: 'advisor', host_id: 7, uid: 'a-7', name: 'Bo' });
  assert.equal(a.kind, 'advisor');
  assert.equal(a.id, 'advisor-7');
  assert.equal(a.uid, 'a-7', 'the booking calls need the profile uid');
});

test('D377: a host is tagged with the capacity an admin approved', () => {
  assert.equal(hostRole({ capacity: 'investor', specialization: 'Legal counsel' }), 'Investor');
  assert.equal(hostRole({ capacity: 'advisor', specialization: 'Legal counsel' }), 'Advisor');
  // As a Partner, the partner's own specialization still names what they are.
  assert.notEqual(hostRole({ capacity: 'partner', specialization: 'Legal counsel' }), 'Investor');
  assert.notEqual(hostRole({ capacity: 'partner', specialization: 'Legal counsel' }), 'Advisor');
});

test('D377: the page reads the approved-hosts directory, never the whole partner table', () => {
  assert.match(PAGE, /api\.labHostDirectory\(\)/);
  assert.doesNotMatch(PAGE, /api\.listPartners\(/);
  assert.match(PAGE, /r\.items\.map\(hostEntry\)/);
  assert.match(PAGE, /role: hostRole\(p\)/);
});

test('D377: an empty directory says who can be listed and how, not "no partners"', () => {
  assert.match(PAGE, /No one is approved to host Spin-Out Lab office hours yet\./);
  assert.doesNotMatch(PAGE, /No partner in the network matches/);
});

test('D377: an advisor host is booked on their advisor calendar and route', () => {
  assert.match(PAGE, /partner\.kind === 'advisor'\s*\n?\s*\? await api\.listAdvisorSlots\(partner\.uid, true\)/);
  assert.match(PAGE, /if \(advisor\) \{[\s\S]{0,200}api\.bookAdvisorSlot\(slotId, \{ topic: objective, notes: questions \}\)/);
  // Ratings are partner-keyed; an advisor id must never reach them.
  assert.match(PAGE, /\{p\.kind === 'partner' && <PartnerRating /);
});

test('D377: api.js carries each call, on the Worker paths', () => {
  for (const [name, path] of [
    ['labHostsMe', "'/spinout-lab/hosts/me'"],
    ['labHostApply', "'/spinout-lab/hosts/apply'"],
    ['labHostWithdraw', '`/spinout-lab/hosts/me/${encodeURIComponent(uid)}/withdraw`'],
    ['labHostDirectory', "'/spinout-lab/hosts/directory'"],
    ['adminLabHosts', '`/admin/lab-hosts'],
    ['adminDecideLabHost', '`/admin/lab-hosts/${encodeURIComponent(uid)}/decision`'],
  ]) {
    const at = API.indexOf(`  ${name}: `);
    assert.ok(at > 0, `${name} missing`);
    assert.ok(API.slice(at, at + 260).includes(path), `${name} is not on ${path}`);
  }
});

// ---------------------------------------------------------------- apply card

const PARTNER = { kind: 'partner', id: 3, name: 'Harbor Legal', capacities: ['investor', 'advisor', 'partner'] };
const ADVISOR = { kind: 'advisor', id: 9, name: 'Bo', capacities: ['advisor'] };
const view = (over) => renderToStaticMarkup(createElement(LabHostApplyView, {
  kind: 'partner', profile: PARTNER, applications: [], loadState: 'ok', error: null,
  draft: { capacity: '', statement: '' }, setDraft() {}, busy: false, onApply() {}, onWithdraw() {}, ...over,
}));

test('D377: standing reads the latest application of this profile kind only', () => {
  const apps = [
    { uid: 'b', host_kind: 'advisor', status: 'approved' },
    { uid: 'a', host_kind: 'partner', status: 'rejected' },
  ];
  assert.deepEqual(hostStanding(apps, 'partner'), { latest: apps[1], canApply: true });
  assert.deepEqual(hostStanding(apps, 'advisor'), { latest: apps[0], canApply: false });
  assert.equal(hostStanding([{ host_kind: 'partner', status: 'pending' }], 'partner').canApply, false);
  assert.deepEqual(hostStanding(null, 'partner'), { latest: null, canApply: true });
});

test('D377: a partner applies as Investor, Advisor or Partner; an advisor only as Advisor', () => {
  const p = view();
  assert.match(p, /data-testid="lab-host-apply"/);
  assert.match(text(p), /Apply as Investor Advisor Partner/);
  const a = view({ kind: 'advisor', profile: ADVISOR });
  assert.match(text(a), /Apply as Advisor Apply to host/);
  assert.doesNotMatch(text(a), /Investor|Partner/);
});

test('D377: a pending application can be withdrawn and not duplicated; an approved one says so', () => {
  const pending = view({ applications: [{ uid: 'u1', host_kind: 'partner', capacity: 'investor', status: 'pending' }] });
  assert.match(text(pending), /Investor · pending Waiting for an admin to review\. Withdraw/);
  assert.doesNotMatch(pending, /data-testid="lab-host-apply"/);
  const approved = view({ applications: [{ uid: 'u1', host_kind: 'partner', capacity: 'partner', status: 'approved' }] });
  assert.match(text(approved), /Partner · approved Approved — founders in the Spin-Out Lab see you/);
  assert.doesNotMatch(approved, /Withdraw|data-testid="lab-host-apply"/);
  const rejected = view({ applications: [{ uid: 'u1', host_kind: 'partner', capacity: 'advisor', status: 'rejected', review_note: 'Not yet' }] });
  assert.match(text(rejected), /Admin note: Not yet/);
  assert.match(rejected, /data-testid="lab-host-apply"/);
});

test('D377: no profile, and an unreadable status, are each drawn as themselves', () => {
  const none = view({ profile: null });
  assert.match(none, /data-testid="lab-host-no-profile"/);
  assert.doesNotMatch(none, /Apply to host/);
  const failed = view({ loadState: 'failed', error: 'HTTP 500' });
  assert.match(text(failed), /Couldn't read your Spin-Out Lab host status: HTTP 500/);
  assert.doesNotMatch(failed, /Apply to host/);
  assert.match(text(view({ error: 'This profile already has an application waiting for an admin.' })),
    /This profile already has an application waiting for an admin\./);
});

test('D377: partners apply from Partner office hours, advisors from Practice · Sessions', () => {
  assert.match(read('../src/pages/PartnerOfficeHoursPage.jsx'), /<LabHostApplyCard kind="partner" \/>/);
  assert.match(read('../src/pages/advisor/practice/SessionsZone.jsx'), /<LabHostApplyCard kind="advisor" \/>/);
});

// ---------------------------------------------------------------- admin queue

const ROW = {
  uid: 'u1', host_kind: 'partner', capacity: 'investor', status: 'pending', statement: 'Seed cheques',
  applicant_name: 'Ada', applicant_email: 'ada@example.test', profile_name: 'Harbor Capital', profile_company: 'Harbor',
  created_at: '2026-09-28 10:00:00',
};
const admin = (over) => renderToStaticMarkup(createElement(LabHostsView, {
  status: 'pending', setStatus() {}, loadState: 'ok', error: null, notes: {}, setNote() {}, busyUid: null, onDecide() {},
  data: { items: [ROW], counts: { pending: 1, approved: 2, rejected: 0, withdrawn: 0, revoked: 0 } }, ...over,
}));

test('D377: approve and reject a pending application; revoke an approved one; nothing else', () => {
  assert.deepEqual(decisionsFor('pending'), ['approve', 'reject']);
  assert.deepEqual(decisionsFor('approved'), ['revoke']);
  for (const s of ['rejected', 'withdrawn', 'revoked']) assert.deepEqual(decisionsFor(s), []);
  const pending = admin();
  assert.match(pending, /data-testid="lab-host-approve"/);
  assert.match(pending, /data-testid="lab-host-reject"/);
  assert.doesNotMatch(pending, /lab-host-revoke/);
  const approved = admin({ status: 'approved', data: { items: [{ ...ROW, status: 'approved', reviewed_by_name: 'Root' }], counts: {} } });
  assert.match(approved, /data-testid="lab-host-revoke"/);
  assert.doesNotMatch(approved, /lab-host-approve/);
  assert.match(text(approved), /approved by Root/);
});

test('D377: the queue shows counts per status, the applicant, the capacity, and its empty state', () => {
  const t = text(admin());
  assert.match(t, /Pending 1 Approved 2 Rejected 0 Withdrawn 0 Revoked 0 All/);
  assert.match(t, /Harbor Capital · Harbor · as Investor · partner profile/);
  assert.match(t, /Ada \(ada@example\.test\)/);
  assert.match(text(admin({ data: { items: [], counts: {} } })), /No pending applications\./);
  assert.match(text(admin({ loadState: 'failed', error: 'HTTP 403' })), /Couldn't read the host applications: HTTP 403/);
});

test('D377: the queue is a tab of Admin · Spin-Out Lab', () => {
  const LAB = read('../src/pages/admin/AdminSpinoutLab.jsx');
  assert.match(LAB, /data-testid="tab-hosts"/);
  assert.match(LAB, /section === 'hosts' \? \([\s\S]{0,120}<AdminLabHosts \/>/);
});
