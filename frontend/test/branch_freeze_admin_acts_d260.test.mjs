/**
 * D260 — the branch freeze reaches the admin acts that decide an account's
 * access, and HQ's Team table can see which of them an account is waiting on.
 *
 * The worker half — five writes answering 423 on a suspended branch and
 * writing nothing, 200 on an active one, 401 to nobody, a no-op on HQ, and the
 * revoke left open — is driven through the bundled Worker in
 * cloudflare-worker/test/branch_freeze_admin_acts_d260.test.ts. This file holds
 * what S7 draws about it (`lib/branchFreeze.js`) and what a branch hit shows.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/branch_freeze_admin_acts_d260.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { FROZEN, FREEZE_RULE } from '../src/lib/branchFreeze.js';
import { MoveHit, branchHitStates } from '../src/pages/hq/HqTeamTable.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const row = (name) => {
  const r = FROZEN.find((f) => f.row === name);
  assert.ok(r, `S7 has no ${name} row`);
  return r;
};

/** Every approval lane's label, from the one list Approvals reads (D215). */
function laneLabels() {
  const src = raw('cloudflare-worker/src/services/approvalSources.ts');
  return [...src.matchAll(/key: '([a-z_]+)',\s*\n\s*label: '([^']+)'/g)].map((m) => ({ key: m[1], label: m[2] }));
}

// ── What S7 draws ────────────────────────────────────────────────────────────

test('D260: S7 has an Access row naming admin.ts and kyc.ts, and it says the revoke still works', () => {
  const access = row('Access');
  assert.deepEqual([...access.gatedIn].sort(), ['admin.ts', 'kyc.ts']);
  assert.match(access.note, /KYC verdict/);
  assert.match(access.note, /limited access/);
  assert.match(access.note, /Spin-Out Lab/);
  assert.match(access.note, /Revoking limited access still works/,
    'the takedown half is the one that is easy to lose, and FREEZE_RULE promises it');
  assert.match(FREEZE_RULE, /Taking something down still works/);
});

test('D260: Approvals no longer claims every queue is frozen — it names the frozen lanes and the ones that are not', () => {
  const approvals = row('Approvals');
  assert.doesNotMatch(approvals.note, /Every queue/i, 'eleven lanes, four ungated: "every queue" is false');
  assert.ok(approvals.gatedIn.includes('kyc.ts'), 'KYC is an Approvals lane and its verdicts now freeze');
  assert.match(approvals.note, /KYC/);
  // The four lanes with no gate, by the labels Approvals itself uses. If one
  // of them gains a gate, this list and the note must both change.
  const labels = laneLabels();
  assert.ok(labels.length >= 11, `approvalSources.ts lists ${labels.length} lanes; D215 made it eleven`);
  const ungated = ['partner_profiles', 'exploring', 'best_fit', 'due_diligence'];
  for (const key of ungated) {
    const lane = labels.find((l) => l.key === key);
    assert.ok(lane, `approvalSources.ts has no ${key} lane — this list is stale`);
    const word = lane.label.split(' ')[0];
    assert.ok(approvals.note.toLowerCase().includes(word.toLowerCase()),
      `the Approvals row does not say ${lane.label} is not frozen`);
  }
  assert.match(approvals.note, /are not frozen\.$/);
});

test('D260: Programs names the second door into the cohort queue, and its evidence includes admin.ts', () => {
  const programs = row('Programs');
  assert.match(programs.note, /application decide/);
  assert.ok(programs.gatedIn.includes('admin.ts') && programs.gatedIn.includes('admin_cohort.ts'));
  assert.match(programs.note, /its week decisions are not frozen/, 'the running cohort\'s carve-out was lost');
});

test('D260: the access-level gate is conditional on the grant, in the handler itself', () => {
  // Behaviour is held by the Worker test (the revoke answers 200 while
  // suspended); this pins WHERE the condition lives, so a refactor that moves
  // the gate above the body parse — and so freezes the revoke — reads as one.
  const src = codeOnly(raw('cloudflare-worker/src/routes/admin.ts'));
  const at = src.indexOf("admin.patch('/users/:user_id/access-level'");
  assert.ok(at > 0, 'the access-level route moved');
  const body = src.slice(at, src.indexOf('admin.post(', at));
  const gates = body.match(/await requireBranchNotSuspended\(c\)/g) || [];
  assert.equal(gates.length, 1, 'the access-level handler must carry exactly one freeze gate');
  assert.match(body, /if \(newLevel === 'limited'\) await requireBranchNotSuspended\(c\);/,
    'the gate must apply to the grant only');
});

// ── What a branch hit shows (the search half) ────────────────────────────────

const BASE = { id: 7, name: 'Fleur Founder', email: 'fleur@fr.example', role: 'founder', is_active: 1, created_at: '2026-09-01 10:00:00' };
const render = (hit) => renderToStaticMarkup(React.createElement('ul', null,
  React.createElement(MoveHit, { hit, from: 'fr', destinations: [], onMoved() {} })));

test('D260: a branch hit names its KYC, access and Lab state as the branch sent them', () => {
  assert.deepEqual(
    branchHitStates({ ...BASE, kyc_status: 'approved', access_level: 'limited', spinout_lab_active: 1, spinout_lab_admitted: 1 }),
    ['KYC approved', 'limited access', 'in the Lab'],
  );
  assert.deepEqual(
    branchHitStates({ ...BASE, kyc_status: 'pending', access_level: null, spinout_lab_active: 0, spinout_lab_admitted: 1 }),
    ['KYC pending', 'admitted to the Lab'],
  );
  assert.deepEqual(
    branchHitStates({ ...BASE, kyc_status: 'rejected', access_level: null, spinout_lab_active: 0, spinout_lab_admitted: 0 }),
    ['KYC rejected'],
  );
  const html = render({ ...BASE, kyc_status: 'approved', access_level: 'limited', spinout_lab_active: 0, spinout_lab_admitted: 1 });
  assert.match(html, /data-testid="hq-team-hit-states"[^>]*>KYC approved · limited access · admitted to the Lab</);
});

test('D260: a state the branch did not send, or holds as null, is said — never drawn as "not started"', () => {
  // A branch still on the build before D260 sends none of the three fields.
  assert.equal(branchHitStates(BASE), null);
  assert.match(render(BASE), /KYC, access and Lab state not sent by this branch’s build/);
  // NULL on the branch is "not recorded", which is not the same as not started.
  assert.deepEqual(
    branchHitStates({ ...BASE, kyc_status: null, access_level: null, spinout_lab_active: 0, spinout_lab_admitted: 0 }),
    ['KYC not recorded'],
  );
  assert.doesNotMatch(render({ ...BASE, kyc_status: null, access_level: null, spinout_lab_active: 0, spinout_lab_admitted: 0 }),
    /not started/);
});

test('D260: the states are read-only — the hit draws no control on them', () => {
  const html = render({ ...BASE, kyc_status: 'pending', access_level: null, spinout_lab_active: 0, spinout_lab_admitted: 0 });
  const states = html.slice(html.indexOf('data-testid="hq-team-hit-states"'));
  const line = states.slice(0, states.indexOf('</span>'));
  assert.doesNotMatch(line, /<button|<a /, 'a state became a control; deciding it is the branch admin\'s');
});

// ── The four sentences that said a branch hit lacked them ─────────────────────

test('D260: no screen still says a branch search returns only a role and an active state', () => {
  const dir = resolve(process.cwd(), 'frontend/src');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : /\.(jsx?|tsx?)$/.test(e.name) ? [join(d, e.name)] : []);
  for (const f of walk(dir)) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /returns a role and an active state|carries a role and an active state;|not KYC, access or Lab state/,
      `${f} still says a branch hit carries no KYC, access or Lab state`);
  }
  const accounts = raw('frontend/src/pages/hq/AccountsPage.jsx');
  assert.match(accounts, /A branch hit shows its KYC, access and Lab state \(D260\), read-only\./);
  assert.match(accounts, /it can still revoke limited access/);
  const team = raw('frontend/src/pages/hq/HqTeamTable.jsx');
  assert.match(team, /A branch hit carries a role, an active state and its KYC, access and Lab state, read-only/);
});
