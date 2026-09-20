/**
 * A ticket whose GitHub mirror failed must not confirm as if it succeeded.
 *
 * `POST /api/tickets` has always returned `github_sync_status` —
 * `synced | failed | not_configured` — and, on a failure, a `github_sync_error`
 * naming the cause. Until task #192, NO FILE IN `frontend/src` READ EITHER.
 *
 * So the only visible difference between a ticket that reached the issue tracker
 * and one that did not was the ABSENCE of a "View on GitHub" link — which reads
 * as "this environment has no GitHub", not as "this one did not make it".
 * Whoever triages by GitHub Issues never sees that ticket, and the person who
 * filed it believes they have been heard. That is the shape of failure this repo
 * calls absent-read-as-empty, in the one place it costs someone an answer.
 *
 * WHY THE TWO STATUSES ARE SAID TO DIFFERENT PEOPLE. `failed` is about THIS
 * ticket and everyone who files one needs it. `not_configured` is a deployment
 * secret that is missing: not a failure of the file, not something a founder can
 * act on, and internal noise on their own support request. An admin can set it,
 * so an admin is told.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PANEL = codeOnly(read('frontend/src/components/advisor/PersonalAdvisor.jsx'));
const ROUTE = read('cloudflare-worker/src/routes/tickets.ts');

test('the route still returns the two fields this page now reads', () => {
  // BOTH DIRECTIONS. If the route stops sending either one, the reader below is
  // dead code that silently says nothing — which is the state this test exists
  // to end, returning by a different door.
  assert.match(ROUTE, /github_sync_status: githubIssue \? 'synced' : \(githubConfigured\(c\.env\) \? 'failed' : 'not_configured'\)/,
    'the create route no longer reports which of the three states it is in');
  assert.match(ROUTE, /github_sync_error: githubSyncError/,
    'the create route no longer returns the reason a sync failed');
});

test('a failed mirror is said to whoever filed the ticket, with its reason', () => {
  assert.match(PANEL, /t\?\.github_sync_status/, 'nothing reads the sync status');
  assert.match(PANEL, /t\?\.github_sync_error/, 'nothing reads the failure reason');
  // ANCHORED TO THE STATEMENT, NOT TO THE STRING. `/status === 'failed'/`
  // passed against an unrelated `r.status === 'failed'` 300 lines up, so
  // stubbing this branch out entirely left the test green — found by mutating
  // the condition to `if (false)` and watching nothing fail.
  assert.match(PANEL, /^ {4}if \(status === 'failed'\) \{$/m,
    'a failed mirror is not distinguished');
  // The ticket IS saved, and that has to be said first — the reader's support
  // request did not vanish, it just will not appear on the board.
  assert.match(PANEL, /has been filed\./, 'the confirmation stopped saying the ticket was filed');
  assert.match(PANEL, /did not reach the GitHub issue tracker/,
    'a failed mirror no longer says the ticket will not appear on the board');
  assert.match(PANEL, /\$\{reason\}/, 'the reason is read but never shown');
});

test('a failed mirror points an admin at where to fix it, and only an admin', () => {
  // D172. `failed` is a WORSE state than `not_configured` — a token that
  // exists and was refused, not one that was never set — and yet its
  // sibling `not_configured` branch already names a secret and a place to
  // set it while this one used to just show the raw GitHub error and stop.
  // Bounded to the `if (status === 'failed')` block only, the same window
  // the test above establishes exists — its own opening line to the next
  // `else if` — so a pointer that actually lives in the `not_configured`
  // branch (which already names GITHUB_ACCESS_TOKEN) cannot satisfy this.
  const start = PANEL.indexOf("if (status === 'failed') {");
  assert.ok(start > 0, 'the failed branch moved or was renamed');
  const nextBranch = PANEL.indexOf("} else if (status === 'not_configured'", start);
  assert.ok(nextBranch > start, 'the not_configured branch moved or was renamed');
  const block = PANEL.slice(start, nextBranch);

  assert.match(block, /Admin Console → GitHub Sync/,
    'a failed mirror gives no admin a pointer to where to fix it');
  assert.match(block, /Test issue creation/,
    'the pointer does not name the control that actually diagnoses the token');

  // Not merely present in the branch: the pointer must sit AFTER a nested
  // role gate within this same block. A pointer any reader sees is noise to
  // a founder who cannot act on it — the same argument this file already
  // makes for `not_configured` two tests down.
  const gateAt = block.indexOf("user?.role === 'admin'");
  assert.ok(gateAt > 0, 'the failed branch is not gated on role at all');
  const pointerAt = block.indexOf('Admin Console → GitHub Sync');
  assert.ok(pointerAt > gateAt,
    'the pointer sentence sits outside the admin gate, so every reader sees it');
});

test('an unconfigured mirror is said only to the person who can configure it', () => {
  assert.match(PANEL, /status === 'not_configured' && user\?\.role === 'admin'/,
    'either every founder is told about a missing deployment secret, or no admin is');
  // Named, because a message that says "not configured" without saying what to
  // set sends the one person who can fix it looking for the switch.
  assert.match(PANEL, /GITHUB_ACCESS_TOKEN/, 'the admin is not told which secret is missing');
  // And the callback must depend on the role it branches on, or a role resolved
  // after the first render is read as undefined for the rest of the session.
  assert.match(PANEL, /\}, \[user\?\.role\]\);/,
    'the confirmation is memoised without the role it branches on');
});

test('a synced mirror still links to the issue, and nothing else claims one', () => {
  assert.match(PANEL, /t\?\.github_issue_url/, 'the GitHub link is gone');
  assert.match(PANEL, /label: 'View on GitHub', route: t\.github_issue_url, external: true/,
    'the issue link no longer opens the issue');
  // The link is conditional on the URL, never on the status: a `synced` status
  // with no URL would otherwise render a link to nothing.
  const at = PANEL.indexOf('View on GitHub');
  const around = PANEL.slice(Math.max(0, at - 200), at);
  assert.doesNotMatch(around, /status === 'synced'/,
    'the link is gated on the status rather than on the URL it needs');
});
