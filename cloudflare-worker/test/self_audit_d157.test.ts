/**
 * D157 — an admin reads their OWN privileged actions, and only their own.
 *
 * WHY THIS IS A BOUNDED SOURCE GUARD. Every property below is a fact about the
 * statement and the gate, and each is asserted inside the handler's OWN window
 * — sliced from `r.get('/audit/mine'` to the next handler — so it cannot be
 * satisfied by a neighbouring route that happens to have the right shape. That
 * is the mistake `hq_security.test.mjs` and `admin_governance.test.ts` were
 * both written around, and every assertion here was mutation-checked against
 * the handler it names.
 *
 * The thing a scan could not see — that the filter actually filters — is here a
 * STRUCTURAL property rather than a behavioural one: the subject is bound from
 * `adminUser.id` and the query string is never consulted for it, so there is no
 * input that could name somebody else. The assertions below are what pin that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/src/routes/monitoring_analytics.ts'), 'utf8',
);

/** The handler's own window: from its registration to the next one. */
function handler(path: string): string {
  // Any verb, by LITERAL search rather than a regex built from `path`. A
  // `r.get('`-only slicer silently missed a POST handler the sweep walks; and
  // a regex assembled from data is the shape Semgrep has flagged three times
  // in this repo, so the fix takes the literal form rather than escaping it.
  let at = -1;
  for (const verb of ['get', 'post', 'put', 'patch', 'delete']) {
    const i = SRC.indexOf(`r.${verb}('${path}'`);
    if (i > 0) { at = i; break; }
  }
  assert.ok(at > 0, `${path} is no longer registered`);
  const rest = SRC.slice(at + 10);
  const end = rest.search(/\nr\.(get|post|put|patch|delete)\(/);
  return rest.slice(0, end > 0 ? end : rest.length);
}

test('the self-read is admin-gated, and the three cross-admin reads still are not', () => {
  const mine = handler('/audit/mine');
  assert.match(mine, /await requireAdmin\(c\)/, 'the self-read must be reachable by a plain admin');
  assert.doesNotMatch(mine, /requireSuperAdmin/,
    'raising this to the super admin would re-close the question D157 narrowed');
  // D132's refusals are not loosened by this PR — asserted, not assumed.
  for (const p of ['/exports/recent', '/audit', '/audit/export.csv']) {
    assert.match(handler(p), /await requireSuperAdmin\(c\)/,
      `${p} reads other admins by name and must stay super-admin only`);
  }
});

test('the self-read carries no join to users — the line this file\'s header draws', () => {
  const mine = handler('/audit/mine');
  assert.doesNotMatch(mine, /JOIN\s+users/i,
    'a join to users is what makes a read cross-admin, whatever it renders');
  // THE RULE, SWEPT PER HANDLER RATHER THAN COUNTED. A first draft compared
  // two totals — join statements against gate calls — and they are not 1:1:
  // each gated handler runs TWO joined queries, items and count, so the
  // arithmetic was wrong while the rule it meant was right. Walking every
  // handler in the file says the actual thing and catches a fourth added
  // later, which a total never could.
  const paths = [...SRC.matchAll(/\nr\.(?:get|post|put|patch|delete)\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.length > 10, `expected the whole router, found ${paths.length} handlers`);
  let joined = 0;
  for (const p of paths) {
    const body = handler(p);
    if (!/FROM admin_audit_log a[\s\S]{0,120}?LEFT JOIN users u/.test(body)) continue;
    joined += 1;
    assert.match(body, /await requireSuperAdmin\(c\)/,
      `${p} joins admin_audit_log to users and is not super-admin gated`);
  }
  assert.equal(joined, 3, `expected D132's three cross-admin reads, found ${joined}`);
});

test('the subject is bound from the session, and the query string is never consulted for it', () => {
  const mine = handler('/audit/mine');
  assert.match(mine, /const adminUser = await requireAdmin\(c\)/);
  assert.match(mine, /a\.admin_user_id = \$\{adminUser\.id\}/,
    'the subject must come from the session, never from the request');
  assert.doesNotMatch(mine, /admin_user_id['"]?\s*\)/,
    'reading admin_user_id from the query string would make the subject an input');
  assert.doesNotMatch(mine, /c\.req\.query\(['"]admin/,
    'no admin-naming query parameter may reach this handler');
});

test('the self-read admits every action, on HQ\'s precedent and not the monitoring view\'s', () => {
  const mine = handler('/audit/mine');
  assert.doesNotMatch(mine, /ALLOWED_ACTIONS/,
    'showing an admin two of their actions would be a feed wrong about its only subject');
  // The neighbouring /audit DOES filter, deliberately — so this is a real
  // difference between two handlers rather than a property nothing could break.
  assert.match(handler('/audit'), /ALLOWED_ACTIONS/,
    '/audit no longer filters actions — one of these two guards is now wrong');
});

test('the response states whose feed it is', () => {
  const mine = handler('/audit/mine');
  assert.match(mine, /scope: \{ admin_user_id: adminUser\.id, all_actions: true \}/,
    'a feed of privileged actions that does not say whose it is reads as the platform\'s');
});

test('the query rides the index built for it', () => {
  const mine = handler('/audit/mine');
  // `idx_admin_audit_user_ts(admin_user_id, exported_at DESC)` — the ORDER BY
  // must match its second column or the index only half applies.
  assert.match(mine, /ORDER BY a\.exported_at DESC/);
  assert.match(
    readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin.ts'), 'utf8'),
    /idx_admin_audit_user_ts ON admin_audit_log\(admin_user_id, exported_at DESC\)/,
    'the index this query was written for is gone',
  );
});
