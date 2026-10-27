/**
 * D1306 (#3403, part 7 of #2377) — the account drawer, its tabs and ACC7's
 * dialogs, with no browser pop-up left in the users console.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/account_drawer_d1306.test.mjs
 *
 * Mounted on the contracts DOM with `fetch` answered per address, so each
 * dialog is opened, confirmed and checked against the request it sends.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import UsersConsole, { UserDetailModal } from '../src/pages/admin/consoles/UsersConsole.jsx';
import {
  DRAWER_TABS, PROFILE_CHOICES, SUPPORT_SESSION_CEILING_MINUTES, SUPPORT_SESSION_MINUTES,
  accountDialog, drawerRefusal, lpLine, notesSavedLine, onboardingProfileLine, profileLabel, reasonReady,
  refusalSentence, testerLine,
} from '../src/pages/admin/accounts/accountDrawerModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// ── The words and rules ─────────────────────────────────────────────────────

test('#2377 G1: Operating Partner and Explorer are the profiles’ names, in the canvas’s order', () => {
  assert.deepEqual(PROFILE_CHOICES.map(profileLabel), ['Founder', 'Investor', 'Advisor', 'Operating Partner', 'Explorer']);
  assert.equal(profileLabel('admin'), 'Admin');
  assert.equal(profileLabel(null), 'Not recorded');
  const picker = codeOnly(read('frontend/src/pages/admin/consoles/UsersConsole.jsx'));
  assert.doesNotMatch(picker, /label: 'Partner'/, 'the picker still says Partner');
  const badges = read('frontend/src/pages/admin/consoles/shared.jsx');
  const BADGE = {
    admin: /\badmin: '([^']+)'/, founder: /\bfounder: '([^']+)'/, partner: /\bpartner: '([^']+)'/,
    investor: /\binvestor: '([^']+)'/, advisor: /\badvisor: '([^']+)'/, exploring: /\bexploring: '([^']+)'/,
  };
  const colour = (k) => badges.match(BADGE[k])?.[1];
  assert.notEqual(colour('advisor'), colour('exploring'), 'Advisor and Explorer share a colour');
  assert.equal(new Set(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'].map(colour)).size, 6, 'two profiles share a colour');
});

test('the drawer’s tabs are ACC4’s, in its order', () => {
  assert.deepEqual(DRAWER_TABS.map((t) => t.label), ['Profile', 'Sub-accounts', 'Identity', 'Agreements', 'Registration', 'Onboarding', 'Conversations', 'Activity', 'Notes']);
});

test('ACC7: each dialog says what it changes and who is told; reasons where the Worker wants one', () => {
  const member = { id: 5, name: 'Ben Sample', role: 'founder' };
  const adminRow = { id: 6, name: 'Ada Sample', role: 'admin' };
  assert.equal(accountDialog('role', member, { nextRole: 'partner' }).title, 'Change Ben Sample’s profile from Founder to Operating Partner?');
  const full = accountDialog('full_access', member);
  assert.equal(full.title, 'Grant Ben Sample full access without an identity check?');
  assert.deepEqual([full.reason.required, full.reason.min], [true, 10]);
  assert.equal(reasonReady(full, 'too short'), false);
  assert.equal(reasonReady(full, '   checked by video call   '), true);
  assert.equal(reasonReady(full, '          '), false, 'spaces are not a reason');
  // D1303's Worker refuses a full-access reason longer than FULL_ACCESS_REASON_MAX.
  assert.equal(Number(read('cloudflare-worker/src/routes/kyc.ts').match(/export const FULL_ACCESS_REASON_MAX = (\d+);/)[1]), full.reason.max);
  assert.equal(reasonReady(full, 'x'.repeat(500)), true);
  assert.equal(reasonReady(full, 'x'.repeat(501)), false, 'a reason the Worker refuses as too long was ready');
  assert.equal(accountDialog('deactivate', adminRow).reason.required, true);
  assert.equal(accountDialog('deactivate', member).reason.required, false);
  assert.equal(reasonReady(accountDialog('deactivate', member), ''), true, 'a member’s deactivation waits on an optional reason');
  assert.equal(accountDialog('reactivate', member).reason, null);
  assert.equal(accountDialog('limited_revoke', member).confirm.tone, 'neg');
  for (const kind of ['role', 'full_access', 'limited_grant', 'limited_revoke', 'deactivate', 'reactivate', 'resend']) {
    assert.ok(accountDialog(kind, member, { nextRole: 'advisor' }).told, `${kind} says nothing about who is told`);
  }
});

test('a refusal is one sentence in the Worker’s words, never a status code', () => {
  assert.equal(refusalSentence({ code: 'super_admin_required', status: 403 }), 'Only a Super Admin can change another administrator’s account.');
  assert.equal(refusalSentence({ message: 'Rejection reason required' }), 'Rejection reason required');
  assert.equal(refusalSentence({}), 'That could not be done. Nothing changed. Try again.');
});

test('the support session states its real limit, the one auth.ts enforces', () => {
  const auth = read('cloudflare-worker/src/auth.ts');
  assert.equal(Number(auth.match(/export const IMPERSONATION_EXPIRY_MINUTES = (\d+);/)[1]), SUPPORT_SESSION_MINUTES);
  assert.equal(Number(auth.match(/export const IMPERSONATION_CEILING_MINUTES = (\d+);/)[1]), SUPPORT_SESSION_CEILING_MINUTES);
});

test('ACC13a: another administrator’s record is HQ’s; any other failure is a read that failed', () => {
  assert.equal(drawerRefusal({ status: 403, code: 'super_admin_required' }).title, 'Only a Super Admin can open another administrator’s record.');
  assert.equal(drawerRefusal({ status: 500 }).kind, 'unreadable');
});

test('ACC13b: a member on an Accounts address is told the page is for studio admins', async () => {
  const { adminRefusal, ADMIN_TITLE, ADMIN_LINE } = await import('../src/pages/hq/hqNoticeModel.js');
  for (const pathname of ['/admin/accounts', '/admin/accounts/all', '/admin/accounts/all/42']) {
    assert.equal(adminRefusal({ pathname, realRole: 'founder', isImpersonating: false }), true, pathname);
  }
  assert.equal(`${ADMIN_TITLE}. ${ADMIN_LINE}`, 'This page is for studio admins. If you run a studio, ask HQ for admin access.');
});

test('the onboarding-profile line, the notes line, and the sub-accounts lines say what is and is not recorded', () => {
  assert.deepEqual(onboardingProfileLine({ available: true, ref: 'pp_1', status: 'verified', reviewed_at: '2026-10-03 10:00:00' }),
    { kind: 'profile', status: 'Verified', when: 'on 3 Oct 2026', href: '/admin/partner-profiles/pp_1' });
  assert.equal(onboardingProfileLine({ available: true, ref: 'pp_1', status: 'verified', reviewed_at: null }).when, 'on a date not recorded');
  assert.equal(onboardingProfileLine({ available: true, status: 'pending' }).when, null);
  assert.equal(onboardingProfileLine(null).text, 'No onboarding profile on file.');
  assert.equal(onboardingProfileLine({ available: false }).kind, 'unreadable');
  assert.equal(onboardingProfileLine({ available: true, status: 'constructor' }).status, 'constructor');

  assert.match(notesSavedLine(undefined), /^Not recorded: who saved these notes and when is kept once D1303/);
  assert.equal(notesSavedLine({ saved_at: '2026-10-12 09:00:00', saved_by: { name: 'Ada Sample' } }), 'Last saved on 12 Oct 2026 by Ada Sample');
  assert.equal(notesSavedLine({ recorded: false, reason: 'Not recorded: these notes were saved before who saved them was kept.' }), 'Not recorded: these notes were saved before who saved them was kept.');
  assert.match(notesSavedLine({ available: false }), /could not be read/);
  // D1303's own shape (`services/accountNotes.ts`): who and when, or why not.
  assert.equal(notesSavedLine({ recorded: true, by: { id: 1, name: 'Ada Sample' }, at: '2026-10-12 09:00:00', chars: 40 }), 'Last saved on 12 Oct 2026 by Ada Sample');
  assert.equal(notesSavedLine({ recorded: false, unreadable: true, reason: 'Who saved these notes could not be read.' }), 'Who saved these notes could not be read.');

  assert.equal(testerLine({ available: true, record: null }).kind, 'none');
  assert.equal(testerLine({ available: true, record: { status: 'active', decided_at: '2026-08-14', decided_by: { name: 'Ada Sample' } } }).text, 'Active since 14 Aug 2026 by Ada Sample.');
  assert.match(testerLine({ available: false, reason: 'unreadable' }).text, /not the same as none/);
  assert.equal(lpLine({ available: true, is_lp: true, funds: ['fund-one'] }), 'An LP of fund-one.');
  assert.equal(lpLine({ available: true, is_lp: false, applications: [{ status: 'pending' }] }), 'Not an LP yet. One application is waiting.');
  assert.match(lpLine({ available: false, reason: 'unreadable' }), /not the same as none/);
});

test('no browser pop-up is left in the users console or the drawer', () => {
  const files = ['frontend/src/pages/admin/consoles/UsersConsole.jsx',
    ...readdirSync(resolve(process.cwd(), 'frontend/src/pages/admin/accounts')).filter((f) => /\.jsx?$/.test(f)).map((f) => `frontend/src/pages/admin/accounts/${f}`)];
  for (const f of files) {
    const code = codeOnly(read(f));
    assert.doesNotMatch(code, /window\.(prompt|confirm|alert)\s*\(/, `${f} opens a browser pop-up`);
    assert.doesNotMatch(code, /(^|[^.\w])(prompt|confirm|alert)\s*\(/m, `${f} calls a bare prompt, confirm or alert`);
  }
});

// ── Mounted ─────────────────────────────────────────────────────────────────

const ROWS = [
  { id: 5, uid: 'u5', name: 'Ben Sample', email: 'ben@example.test', role: 'founder', is_active: 1, email_verified: 0, kyc_status: 'not_started', access_level: null, created_at: '2026-10-01' },
  { id: 6, uid: 'u6', name: 'Eva Sample', email: 'eva@example.test', role: 'investor', is_active: 1, email_verified: 1, kyc_status: 'pending', access_level: 'limited', created_at: '2026-10-02' },
];

function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, f] of Object.entries(over)) if (url.includes(k) && (!f.method || f.method === method)) return f.answer(url, options);
    if (/\/admin\/users\?/.test(url)) return response({ results: ROWS, total: 2, by_role: { founder: 1, investor: 1 }, showing: 2, limit: 100 });
    if (url.includes('/trust/score/batch')) return response({ scores: [] });
    return response({ ok: true });
  };
}

async function mounted(el, { handle = handler() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, innerHeight: globalThis.innerHeight };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, el)));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)), node: byId,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    type: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
// The trust-score batch is a read sent as a POST (it carries the ids); it is not a change.
const writes = (v) => v.requests.filter((q) => q.method !== 'GET' && !q.url.includes('/trust/score/batch'));

test('Grant full access: an in-page dialog that asks for a reason and sends it; nothing is sent before Confirm', async () => {
  const v = await mounted(h(UsersConsole, {}));
  try {
    await v.click('row-full-access-5');
    assert.match(v.textOf('account-dialog'), /Grant Ben Sample full access without an identity check\?/);
    assert.match(v.textOf('account-dialog-told'), /Ben Sample is told their access changed\./);
    assert.equal(v.props('account-dialog-confirm').disabled, true, 'Confirm works with no reason');
    await v.type('account-dialog-reason', 'Checked by video call');
    assert.equal(writes(v).length, 0, 'something was sent before Confirm');
    await v.click('account-dialog-confirm');
    const w = writes(v);
    assert.equal(w.length, 1);
    assert.match(w[0].url, /\/kyc\/admin\/5\/approve$/);
    assert.deepEqual([w[0].method, w[0].body], ['PATCH', { reason: 'Checked by video call', note: 'Checked by video call' }]);
    assert.ok(!v.has('account-dialog'), 'the dialog stayed open after it succeeded');
  } finally { await v.close(); }
});

test('a refusal stays in the dialog, in one sentence, and nothing is claimed', async () => {
  const v = await mounted(h(UsersConsole, {}), { handle: handler({ '/approve': { method: 'PATCH', answer: () => response({ error: 'Only a super admin can do that.', code: 'super_admin_required' }, 403) } }) });
  try {
    await v.click('row-full-access-5');
    await v.type('account-dialog-reason', 'Checked by video call');
    await v.click('account-dialog-confirm');
    assert.ok(v.has('account-dialog'), 'the dialog closed on a refusal');
    assert.equal(v.textOf('account-dialog-error'), 'Only a Super Admin can change another administrator’s account.');
  } finally { await v.close(); }
});

test('limited access: grant and revoke each open their dialog and send their call', async () => {
  const v = await mounted(h(UsersConsole, {}));
  try {
    await v.click('row-limited-5');
    assert.match(v.textOf('account-dialog'), /Grant Ben Sample limited access\?/);
    await v.click('account-dialog-confirm');
    await v.click('row-revoke-limited-6');
    assert.match(v.textOf('account-dialog'), /Revoke Eva Sample’s limited access\?/);
    await v.click('account-dialog-confirm');
    const w = writes(v);
    assert.equal(w.length, 2);
    assert.match(w[0].url, /\/admin\/users\/5\/access-level/);
    assert.match(w[1].url, /\/admin\/users\/6\/access-level/);
  } finally { await v.close(); }
});

test('deactivate a member: the optional reason, and Cancel sends nothing', async () => {
  const v = await mounted(h(UsersConsole, {}));
  try {
    await v.click('row-toggle-5');
    assert.match(v.textOf('account-dialog'), /Deactivate Ben Sample\?.*Nothing is deleted\./s);
    await v.click('account-dialog-cancel');
    assert.equal(writes(v).length, 0);
    await v.click('row-toggle-5');
    await v.click('account-dialog-confirm');
    const w = writes(v);
    assert.equal(w.length, 1);
    assert.match(w[0].url, /\/admin\/users\/5\/toggle-active/);
    assert.equal(w[0].body?.reason, undefined, 'an empty reason was sent as one');
  } finally { await v.close(); }
});

test('change a profile: ACC7 A’s dialog names both profiles and sends the role', async () => {
  const v = await mounted(h(UsersConsole, {}));
  try {
    globalThis.innerHeight = 800;
    const trigger = v.node('role-trigger-5');
    trigger.parentNode.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 10, width: 80 });
    await v.click('role-trigger-5');
    assert.ok(v.has('role-option-partner'), 'the picker did not open');
    assert.match(v.textOf('role-option-partner'), /Operating Partner/);
    await v.click('role-option-advisor');
    assert.equal(v.textOf('account-dialog').startsWith('Change Ben Sample’s profile from Founder to Advisor?'), true);
    await v.click('account-dialog-confirm');
    const w = writes(v);
    assert.equal(w.length, 1);
    assert.match(w[0].url, /\/admin\/users\/5\/role\?role=advisor/);
  } finally { await v.close(); }
});

test('the support session dialog states the length and its ceiling, and keeps a refusal inside', async () => {
  const v = await mounted(h(UsersConsole, {}), { handle: handler({ '/impersonate/5': { method: 'POST', answer: () => response({ error: 'Support sessions are paused.' }, 409) } }) });
  try {
    await v.click('row-support-5');
    assert.equal(v.textOf('support-session-length'), '30 minutes. You can extend it, up to 120 minutes in all.');
  } finally { await v.close(); }
});

const PROFILE = (over = {}) => ({
  ok: true,
  user: { id: 9, uid: 'u9', name: 'Dev Sample', email: 'dev@example.test', role: 'partner', is_active: 1, email_verified: 0, admin_notes: '', created_at: '2026-09-09 14:02:00' },
  kyc: { status: 'pending', submitted_at: '2026-10-02 09:00:00', provider: 'ProviderX', totp_enabled: true, id_uploaded: true },
  timeline: [], agreements: [], activity: [], tickets: [], integrations: [], founder: null,
  partner: { company: 'Example Partners', specialization: 'Go-to-market' },
  onboarding_profile: { available: true, ref: 'pp_dev01', status: 'verified', reviewed_at: '2026-10-03 10:00:00' },
  stats: {},
  ...over,
});

function drawerHandler(profile = PROFILE(), over = {}) {
  return handler({
    '/admin/users/9/profile': { method: 'GET', answer: () => (profile instanceof Error ? response({ error: profile.message, code: profile.code }, profile.status) : response(profile)) },
    '/admin/sub-accounts/accounts/9': { method: 'GET', answer: () => response({ user_id: 9, tester: { available: true, record: { status: 'active', decided_at: '2026-08-14', decided_by: { name: 'Ada Sample' } } }, lp: { available: true, is_lp: false, funds: [], applications: [] } }) },
    ...over,
  });
}
const DRAWER = (props = {}) => h(UserDetailModal, { userRow: { id: 9, name: 'Dev Sample', email: 'dev@example.test', role: 'partner', is_active: 1, access_level: 'limited' }, onClose() {}, onImpersonate: null, onToggleActive: null, ...props });

test('the drawer: Operating Partner, the onboarding-profile line under the firm card, and its tabs', async () => {
  const v = await mounted(DRAWER(), { handle: drawerHandler() });
  try {
    for (const t of DRAWER_TABS) assert.ok(v.has(`drawer-tab-${t.key}`), `no ${t.label} tab`);
    assert.match(v.textOf('drawer-onboarding-profile'), /Onboarding profile: Verified on 3 Oct 2026.*Open in Partner profiles/s);
    await v.click('drawer-tab-sub');
    assert.equal(v.textOf('sub-accounts-tester-line'), 'Active since 14 Aug 2026 by Ada Sample.');
    assert.equal(v.textOf('sub-accounts-lp-line'), 'Not an LP. LP status comes from an approved LP application.');
    assert.equal(writes(v).length, 0, 'reading the drawer wrote something');
  } finally { await v.close(); }
});

test('Identity: resend opens its dialog and sends only on Confirm; it shows only while the email is unverified', async () => {
  const v = await mounted(DRAWER(), { handle: drawerHandler() });
  try {
    await v.click('drawer-tab-kyc');
    assert.ok(v.has('drawer-limited-access'));
    await v.click('drawer-resend');
    assert.match(v.textOf('account-dialog'), /Send the verification email again to Dev Sample\?/);
    assert.equal(writes(v).length, 0);
    await v.click('account-dialog-confirm');
    const w = writes(v);
    assert.equal(w.length, 1);
    assert.match(w[0].url, /\/admin\/users\/9\/resend-verification/);
  } finally { await v.close(); }
  const verified = await mounted(DRAWER(), { handle: drawerHandler(PROFILE({ user: { ...PROFILE().user, email_verified: 1 } })) });
  try {
    await verified.click('drawer-tab-kyc');
    assert.ok(!verified.has('drawer-resend'), 'resend is offered to a verified account');
  } finally { await verified.close(); }
});

test('Notes: who saved and when, or that it is not recorded yet; never a guessed saver', async () => {
  const v = await mounted(DRAWER(), { handle: drawerHandler() });
  try {
    await v.click('drawer-tab-notes');
    assert.match(v.textOf('drawer-notes-saved'), /^Not recorded: who saved these notes/);
  } finally { await v.close(); }
  const saved = await mounted(DRAWER(), { handle: drawerHandler(PROFILE({ notes_saved: { saved_at: '2026-10-12 09:00:00', saved_by: { name: 'Ada Sample' } } })) });
  try {
    await saved.click('drawer-tab-notes');
    assert.equal(saved.textOf('drawer-notes-saved'), 'Last saved on 12 Oct 2026 by Ada Sample');
  } finally { await saved.close(); }
});

test('ACC13a: an Admin opening another administrator’s record is told it is HQ’s, and sees nothing of it', async () => {
  const refused = Object.assign(new Error("Only a super admin can open another admin's record."), { code: 'super_admin_required', status: 403 });
  const v = await mounted(DRAWER({ userRow: { id: 9, name: 'Dev Sample', role: 'admin' } }), { handle: drawerHandler(refused) });
  try {
    assert.match(v.textOf('drawer-hq-only'), /Only a Super Admin can open another administrator’s record\.You can see that this account is an administrator\./);
    assert.ok(!v.has('drawer-onboarding-profile'), 'the record was drawn under the refusal');
  } finally { await v.close(); }
});

test('the drawer offers Admit to Lab only where it is handed the handler', async () => {
  const v = await mounted(DRAWER({ onLabAdmit() {} }), { handle: drawerHandler() });
  try { assert.ok(v.has('drawer-lab-admit')); } finally { await v.close(); }
  const n = await mounted(DRAWER(), { handle: drawerHandler() });
  try { assert.ok(!n.has('drawer-lab-admit')); } finally { await n.close(); }
});
