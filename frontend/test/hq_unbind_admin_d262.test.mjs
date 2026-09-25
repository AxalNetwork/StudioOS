/**
 * D262 — HQ's Team table can unbind an administrator whose account lives on a
 * branch database, and the H20 card stops saying nothing reaches one.
 *
 * Rendered where rendering can see it (which controls an admin hit draws,
 * through the exported `MoveHit`), read as source where it cannot (the
 * submit handler and the gate on the button, which exist only once the form
 * is open). The worker half — the branch's refusals, the HQ route's gates, the
 * cool-off and termination — is branch_unbind_admin_d262.test.ts and
 * hq_unbind_admin_d262.test.ts.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_unbind_admin_d262.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { MoveHit } from '../src/pages/hq/HqTeamTable.jsx';
import { HQ_ONLY_ACTIONS } from '../src/pages/hq/HqTeamActions.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const TEAM = codeOnly(raw('frontend/src/pages/hq/HqTeamTable.jsx'));
const API = codeOnly(raw('frontend/src/lib/api.js'));
const INDEX = raw('cloudflare-worker/src/index.ts');
const ROUTES = raw('cloudflare-worker/src/routes/admin_support_sessions.ts');

const ADMIN = { id: 7, name: 'Paul Principal', email: 'paul@fr.example', role: 'admin', is_active: 1, created_at: '2026-09-01 10:00:00' };
const FOUNDER = { ...ADMIN, id: 8, name: 'Fleur Founder', role: 'founder' };
const render = (hit, props = {}) => renderToStaticMarkup(React.createElement('ul', null,
  React.createElement(MoveHit, { hit, from: 'fr', destinations: ['de'], onMoved() {}, ...props })));

function moveHit() {
  const a = TEAM.indexOf('export function MoveHit(');
  assert.ok(a >= 0, 'MoveHit is gone');
  const b = TEAM.indexOf('\nfunction ', a + 1);
  return TEAM.slice(a, b > a ? b : TEAM.length);
}

test('D262: api.hqUnbindAdmin posts the reason to the branch-admin unbind route, which the Worker mounts', () => {
  const at = API.indexOf('hqUnbindAdmin:');
  assert.ok(at >= 0, 'api.hqUnbindAdmin is gone');
  const method = API.slice(at, API.indexOf('}),', at) + 3);
  assert.match(method, /\/admin\/branches\/\$\{encodeURIComponent\(code\)\}\/admins\/\$\{encodeURIComponent\(userId\)\}\/unbind/);
  assert.match(method, /method: 'POST'/);
  assert.match(method, /body: JSON\.stringify\(\{ reason \}\)/);
  assert.match(ROUTES, /r\.post\('\/branches\/:code\/admins\/:userId\/unbind'/, 'the Worker route is not there');
  assert.match(INDEX, /'\/api\/admin\/branches\/:code\/admins\/:userId\/unbind'/, 'the route is not in the recovery cool-off');
});

test('D262: an active admin hit draws Unbind and no Move; an ordinary hit draws Move and no Unbind', () => {
  const admin = render(ADMIN);
  assert.match(admin, /data-testid="hq-team-unbind-toggle"/, 'an administrator\'s hit has no Unbind');
  assert.doesNotMatch(admin, />Move</, 'Move is drawn on an administrator, which the branch refuses (D133)');
  const founder = render(FOUNDER);
  assert.doesNotMatch(founder, /hq-team-unbind-toggle/, 'Unbind is drawn on an account that is not an administrator');
  assert.match(founder, />Move</);
});

test('D262: Support stays on an admin hit — the branch refuses only a super_admins row', () => {
  assert.match(render(ADMIN), /data-testid="hq-team-support-toggle"/);
});

test('D262: Unbind is not drawn under the view-as overlay, nor on a deactivated administrator', () => {
  assert.doesNotMatch(render(ADMIN, { viewAs: 'fr' }), /hq-team-unbind-toggle/);
  assert.doesNotMatch(render({ ...ADMIN, is_active: 0 }), /hq-team-unbind-toggle/);
});

test('D262: the unbind form sends the trimmed reason, waits for ten characters, and shows a refusal in words', () => {
  const src = moveHit();
  assert.match(src, /await api\.hqUnbindAdmin\(from, hit\.id, unbindReason\.trim\(\)\)/);
  assert.match(src, /disabled=\{unbindBusy \|\| unbindReason\.trim\(\)\.length < 10\}/);
  assert.match(src, /setUnbindErr\(branchRefusal\(ex, /);
  assert.match(src, /const canUnbind = !viewAs && isAdminHit && Number\(hit\.is_active\) === 1;/);
});

test('D262: the H20 card no longer says nothing reaches a branch administrator, and names what does', () => {
  const card = HQ_ONLY_ACTIONS.find((a) => a.key === 'demote_deactivate');
  assert.ok(card, 'the demote/deactivate card is gone');
  const said = `${card.gate} ${card.where}`;
  assert.doesNotMatch(said, /Neither reaches an admin whose account lives on a branch database/,
    'the card still says a branch administrator cannot be reached');
  assert.match(said, /unbound/i, 'the card does not say a branch administrator is unbound');
  assert.match(said, /Unbind on/, 'the card does not say where Unbind is');
  assert.match(said, /terminating the licence unbinds every administrator/,
    'the card does not say termination reaches the branch');
});
