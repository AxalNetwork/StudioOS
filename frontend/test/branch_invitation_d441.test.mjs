/**
 * D441 — the join page spends the invitation on a click, and a branch
 * account is described as told.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/branch_invitation_d441.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isPublicPath } from '../src/lib/api.js';
import { INVITATION_TOKEN } from '../src/pages/JoinBranchPage.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = read('frontend/src/App.jsx');
const PAGE = read('frontend/src/pages/JoinBranchPage.jsx');
const ROUTE = read('cloudflare-worker/src/routes/branch_invitations.ts');

const TOKEN = `invt_${'ab'.repeat(32)}`;

test('/join/:token is the join page, and /invite/:token stays the events page', () => {
  const at = APP.indexOf('path="/join/:token"');
  assert.ok(at > 0, '/join/:token is not a route');
  const element = APP.slice(at, at + 80);
  assert.match(element, /element=\{<JoinBranchPage \/>\}/);
  assert.ok(!/RequireAuth/.test(element), '/join/:token is behind RequireAuth, so the invitee is bounced to sign in');

  const invite = APP.indexOf('path="/invite/:token"');
  assert.match(APP.slice(invite, invite + 80), /InviteRsvpPage/,
    '/invite/:token no longer renders the events page');
});

test('a well-formed invitation link is public, and /join is not a prefix', () => {
  assert.equal(isPublicPath(`/join/${TOKEN}`), true,
    'a background settings/me 401 bounces the invitee to /login');
  assert.equal(isPublicPath('/join'), false);
  assert.equal(isPublicPath('/join/'), false);
  assert.equal(isPublicPath('/join/invt_abcd'), false,
    '/join is matched as a prefix');
  assert.equal(INVITATION_TOKEN.test(TOKEN), true);
  const worker = ROUTE.match(/export const INVITATION_TOKEN = (\/.*\/);/);
  const page = PAGE.match(/export const INVITATION_TOKEN = (\/.*\/);/);
  assert.ok(worker && page && worker[1] === page[1],
    'the page and the route disagree about what a token is');
});

test('the page accepts on a click, and the preview effect does not spend the token', () => {
  assert.equal((PAGE.match(/useEffect\(/g) || []).length, 1);
  const effect = PAGE.slice(PAGE.indexOf('useEffect(() => {'), PAGE.indexOf('}, [token, tokenOk]'));
  assert.match(effect, /branchInvitationPreview/);
  assert.doesNotMatch(effect, /branchInvitationAccept/,
    'the preview effect spends the token, so a preload burns it');
  const acceptAt = PAGE.indexOf('const accept = async');
  const acceptFn = PAGE.slice(acceptAt, PAGE.indexOf('\n  return (', acceptAt));
  assert.match(acceptFn, /if \(busy\) return;/);
  assert.match(acceptFn, /api\.branchInvitationAccept\(token\)/);
  assert.match(PAGE, /onClick=\{accept\}/);
  assert.doesNotMatch(PAGE, /localStorage/, 'the page stores a session');
  assert.match(PAGE, /to="\/login"/);
  assert.match(PAGE, /message === 'Branch only'/);
  assert.match(PAGE, /<Unreadable/);
});
