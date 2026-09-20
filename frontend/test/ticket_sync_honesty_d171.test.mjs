/**
 * D171 — the ticket→GitHub mirror must be able to say it failed, and its
 * Test button must be able to fail.
 *
 * WHAT WENT WRONG, so these assertions are not abstract. A ticket filed from
 * the Eadwyn panel never became a GitHub issue. The admin panel's Test button
 * said "Connected to AxalNetwork/StudioOS." the whole time, because it probed
 * `GET /repos/{owner}/{repo}` — repository METADATA. A fine-grained PAT
 * carries Metadata: Read automatically and cannot have it removed, so that
 * probe answers 200 for a token with no Issues permission whatsoever.
 *
 * Measured against production D1 once the fix was live: the mirror DID work,
 * on 16-17 April 2026 -- two tickets became issues #3 and #4, each created
 * within a second of its row -- and then failed on every ticket from 5 July
 * onward, seven in a row over five months. So this is a credential that
 * lapsed behind a probe that could not see it, which is worse than one that
 * was never set: the panel had been green through the whole working period
 * and stayed green through the whole broken one.
 *
 * Each test below pins one of the paths that was silent. They are source
 * assertions rather than live calls because the failure was structural — a
 * probe aimed at the wrong endpoint, a response nobody read, a column that
 * did not exist — and every one of those is visible in the source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from THIS FILE, not from cwd: the drift suite runs from the repo
// root and a direct `node --test` runs from frontend/, and a cwd-relative
// root silently passes in one and fails in the other.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (p) => readFileSync(resolve(root, p), 'utf8');

const ADMIN_GITHUB = 'cloudflare-worker/src/routes/admin_github.ts';
const TICKETS = 'cloudflare-worker/src/routes/tickets.ts';
const SECRETS = 'cloudflare-worker/src/services/cloudflareSecrets.ts';
const SYNC = 'cloudflare-worker/src/services/githubSync.ts';
const MIGRATION = 'cloudflare-worker/sql/migrations/273_ticket_sync_status.sql';
const TICKETS_PAGE = 'frontend/src/pages/TicketsPage.jsx';
const ADMIN_PAGE = 'frontend/src/pages/AdminPage.jsx';
const API = 'frontend/src/lib/api.js';

/** The body of `r.post('/test', …)`, bounded so a neighbouring route's code
 *  cannot satisfy an assertion about this one. */
function testHandler() {
  const src = at(ADMIN_GITHUB);
  const from = src.indexOf("r.post('/test'");
  assert.ok(from > 0, 'the /test route must exist');
  const next = src.indexOf('r.delete(', from);
  return src.slice(from, next > from ? next : src.length);
}

test('the connection test is not satisfied by a metadata read alone', () => {
  const body = testHandler();
  // The original probe, and the whole defect: one GET of the repo root,
  // answered `ok: true, "Connected"`. A fine-grained token always passes it.
  assert.match(body, /\/issues\?per_page=1/, 'the test must read Issues, not only repo metadata');
  assert.match(body, /issues_readable/, 'the Issues read must be reported as its own named verdict');
  assert.doesNotMatch(
    body,
    /detail:\s*`Connected to \$\{repoFull\}\.`/,
    'a metadata 200 must never again be reported as a bare "Connected" — that is the sentence that misled a real operator',
  );
});

test('issue creation is reported as unproven until it is actually exercised', () => {
  const body = testHandler();
  assert.match(body, /can_write:\s*'unproven'/, "the read-only path must say write is unproven rather than implying it works");
  // The only probe that settles it. If this disappears, the panel is back to
  // guessing about the one permission the mirror needs.
  assert.match(body, /method:\s*'POST'[\s\S]{0,400}?title:\s*'StudioOS connection test'/,
    'the write test must create a real issue — nothing weaker proves Issues: Write');
  assert.match(body, /state:\s*'closed'/, 'the write test must close the issue it opened');
  // Each refusal names its own remedy; a bare status number does not tell an
  // admin whether to change a permission, a repo, or a setting.
  assert.match(body, /403[\s\S]{0,200}Issues: Read and write/, '403 must name the missing permission');
  assert.match(body, /410[\s\S]{0,200}Issues are disabled/, '410 must name that Issues are off for the repo');
});

test('a ticket records whether its mirror worked, so the failure outlives the response', () => {
  const src = at(TICKETS);
  assert.match(src, /github_sync_status\s*=\s*\$\{githubIssue \? 'synced'/,
    'POST /tickets must persist the outcome it already computes');
  assert.match(src, /github_sync_error\s*=\s*\$\{githubSyncError\}/);
  assert.match(src, /github_sync_attempted_at\s*=\s*datetime\('now'\)/);
  // The write is best-effort on purpose: the ticket is already committed, and
  // failing to record a failure must not turn a saved ticket into a 500.
  const from = src.indexOf('RECORD THE ATTEMPT');
  assert.ok(from > 0, 'the reasoning for the best-effort write must stay with it');
  assert.match(src.slice(from, from + 1200), /try \{[\s\S]*?\} catch/, 'the status write must be guarded');
});

test('the sync route can backfill tickets that never mirrored, and reports before it acts', () => {
  const src = at(TICKETS);
  assert.match(src, /WHERE github_issue_number IS NULL/,
    'the backfill must select the rows the old sync silently skipped');
  assert.match(src, /unsynced_count/, 'the count must come back on every call, not only when backfilling');
  assert.match(src, /\?\.backfill/, 'creating issues must need an explicit opt-in');
  // Bounded, because an issue cannot be deleted through the API and one click
  // must not be able to open an unbounded number of them.
  assert.match(src, /\.slice\(0,\s*25\)/, 'the backfill must be bounded per call');
});

test('a Cloudflare 200 is not taken as proof the secret was written', () => {
  const src = at(SECRETS);
  assert.match(src, /parsed\.success === false/,
    'setSecret must read the v4 envelope — a 200 with success:false wrote nothing');
  assert.match(src, /cloudflare refused the write/, 'the refusal must say what happened');
});

test('migration 273 and the runtime bootstrap declare the same columns', () => {
  // The metrics_snapshots collision (#183, #202): a column in one definition
  // and not the other gives a database whose shape depends on which ran
  // first. Derived from the migration rather than typed twice, so adding a
  // column to one file and not the other fails here.
  const cols = [...at(MIGRATION).matchAll(/ALTER TABLE tickets ADD COLUMN (\w+)/g)].map((m) => m[1]);
  assert.ok(cols.length >= 3, `expected the sync-status columns in the migration, found ${cols.join(', ') || 'none'}`);
  const bootstrap = at(SYNC);
  for (const col of cols) {
    assert.match(
      bootstrap,
      new RegExp(`ALTER TABLE tickets ADD COLUMN ${col}\\b`),
      `${col} is in migration 273 but not in ensureTicketSyncSchema — the two definitions must agree`,
    );
  }
  // D1 rejects transaction statements in a migration file (the #26 lesson).
  assert.doesNotMatch(at(MIGRATION), /^\s*(BEGIN|COMMIT)\b/im, 'no BEGIN/COMMIT in a D1 migration');
});

test('the /help ticket form no longer discards the sync outcome', () => {
  const src = at(TICKETS_PAGE);
  assert.doesNotMatch(src, /await api\.createTicket\(form\);\s*\n\s*setShowForm/,
    'the response must be read, not thrown away — that was this surface\'s entire defect');
  assert.match(src, /const res = await api\.createTicket\(form\)/);
  assert.match(src, /github_sync_status/, 'the page must read the status the route has always returned');
  // Two audiences, same split the Eadwyn panel uses: a failed mirror is said
  // to everyone; an unconfigured one names a secret only an admin can set.
  assert.match(src, /status === 'failed'/);
  assert.match(src, /status === 'not_configured' && isAdmin/);
});

test('the admin panel offers the write test and says why the read test is not enough', () => {
  const src = at(ADMIN_PAGE);
  assert.match(src, /data-testid="github-write-test"/, 'the write probe needs a control, or nobody can run it');
  assert.match(src, /Test issue creation/);
  assert.match(src, /Metadata&nbsp;: Read/, 'the panel must explain why reaching the repo proves nothing');
  assert.match(at(API), /adminTestGithub: \(write = false\)/, 'the api client must be able to request the write probe');
});
