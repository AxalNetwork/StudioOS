// #4570 slice 2 (S1 of #4554) — cross-tenant refusals for the signed-in routes
// that name a record and whose ownership check the inventory's reader cannot
// see: it sits in a service the route reaches through a namespace or a factory.
// Each case is a member who is not a party asking for another member's record,
// on the migrated schema: refused as 404, before anything is read for them or
// changed. They are the `verified` entries of scripts/auth-inventory-ledger.json.
//
//   POST /api/relationships/intro-requests/:uid/drafts/intro        introInput  (the teammate asked)
//   POST /api/relationships/intro-requests/:uid/drafts/follow-up    followUpInput (either person)
//   POST /api/channels/whatsapp/link/:uid/confirm                   confirmWhatsAppLink (the member the link waits on)
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/authz_cross_tenant_d4570.test.ts
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { introInput, followUpInput } from '../src/services/relationshipDrafts.ts';
import { confirmWhatsAppLink } from '../src/services/channels/whatsappLink.ts';

const ASKER = 1, TEAMMATE = 2, OUTSIDER = 3;
const REQ = 'b'.repeat(32), LINK = 'c'.repeat(32);
after(removeMigratedDatabases);

function world() {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,uid,name,email,role,is_active) VALUES
    (${ASKER},'u-asker','Asker','asker@example.invalid','founder',1),
    (${TEAMMATE},'u-teammate','Teammate','teammate@example.invalid','founder',1),
    (${OUTSIDER},'u-outsider','Outsider','outsider@example.invalid','founder',1);`);
  db.prepare(`INSERT INTO relationship_interactions (uid, kind, requester_user_id, teammate_user_id, team_key, person_name, status)
    VALUES (?, 'intro_requested', ?, ?, 'team:1', 'Pat Person', 'accepted')`).run(REQ, ASKER, TEAMMATE);
  db.prepare(`INSERT INTO channel_link_codes (uid, code_hash, user_id, provider, expires_at) VALUES (?, ?, ?, 'whatsapp_link', ?)`)
    .run(LINK, 'h'.repeat(64), ASKER, '2099-01-01T00:00:00.000Z');
  const env: any = { DB: d1Over(db) };
  const user = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  const snapshot = () => JSON.stringify([
    db.prepare('SELECT * FROM relationship_interactions ORDER BY id').all(),
    db.prepare('SELECT * FROM channel_link_codes ORDER BY id').all(),
    db.prepare('SELECT COUNT(*) AS n FROM integrations').get(),
  ]);
  return { db, env, user, snapshot };
}

const refusal = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e: any) { return { status: e?.status, code: e?.code }; }
};

test('an introduction request: only the teammate drafts the intro; an outsider is refused 404 and nothing changes', async () => {
  const w = world();
  try {
    const before = w.snapshot();
    // Mutation checked: requestOf's `teammate_user_id = ?` dropped (uid only) → the outsider gets the request's lines and this fails.
    assert.deepEqual(await refusal(introInput(w.env, w.user(OUTSIDER), REQ)), { status: 404, code: 'not_found' });
    assert.deepEqual(await refusal(introInput(w.env, w.user(ASKER), REQ)), { status: 404, code: 'not_found' }, 'the asker does not write the intro');
    const ok = await introInput(w.env, w.user(TEAMMATE), REQ);
    assert.equal(ok.kind, 'intro');
    assert.doesNotMatch(JSON.stringify(await refusal(introInput(w.env, w.user(OUTSIDER), REQ))), /Pat Person/, 'a refusal names nothing of the record');
    assert.equal(w.snapshot(), before, 'a refused draft changes nothing');
  } finally { w.db.close(); }
});

test('a made introduction: either person drafts the follow-up; an outsider is refused 404', async () => {
  const w = world();
  try {
    w.db.prepare("UPDATE relationship_interactions SET status = 'made', made_at = '2026-11-01T00:00:00Z' WHERE uid = ?").run(REQ);
    // Mutation checked: the `? IN (requester_user_id, teammate_user_id)` test dropped → the outsider drafts it and this fails.
    assert.deepEqual(await refusal(followUpInput(w.env, w.user(OUTSIDER), REQ)), { status: 404, code: 'not_found' });
    for (const id of [ASKER, TEAMMATE]) assert.equal((await followUpInput(w.env, w.user(id), REQ)).kind, 'follow_up');
  } finally { w.db.close(); }
});

test("a WhatsApp link waits on one member: another member's confirm is refused 404 and the link is untouched", async () => {
  const w = world();
  try {
    const before = w.snapshot();
    // Mutation checked: memberLinkClaim's `user_id = ?` dropped → the outsider reaches the asker's claim (409 link_not_claimed) and this fails.
    assert.deepEqual(await refusal(confirmWhatsAppLink(w.env, OUTSIDER, LINK)), { status: 404, code: 'link_not_found' });
    assert.equal(w.snapshot(), before, 'the asker\'s link row and integrations are unchanged');
    // The owner reaches their own claim (not yet claimed from WhatsApp): refused for that reason, not as not-found.
    assert.equal((await refusal(confirmWhatsAppLink(w.env, ASKER, LINK)))?.code, 'link_not_claimed');
  } finally { w.db.close(); }
});

/**
 * The historical classes #4570 names, each with the regression test that proves its fix still holds.
 * Closing an issue is not proof of coverage: this register is, while each file exists and runs in test:drift.
 */
const HISTORICAL = [
  { issue: 2419, cls: 'a member route that published activity and identity to the public repository', tests: ['activity_no_github_2419.test.ts'] },
  { issue: 2435, cls: 'investors and Operating Partners editing, sharing or publishing any founder\'s deck or landing page', tests: ['project_content_access_2435.test.ts'] },
  { issue: 2438, cls: 'Operating Partners managing any venture; team-only updates reaching investors', tests: ['partner_access_d889.test.ts'] },
  { issue: 2439, cls: 'investors reading internal risk, unapproved scores and any member\'s trust score', tests: ['score_access_2439.test.ts', 'trust_score_scope_d1074.test.ts'] },
  { issue: 2440, cls: 'an admin\'s calendar sync carrying every member\'s meetings; check-ins on any member\'s calendar', tests: ['calendar_privacy_2440.test.ts'] },
  { issue: 3010, cls: 'legacy cap-table routes giving any admin full read and write', tests: ['captableAccess.test.ts'] },
];

test('every historical authorization class has its regression test, and each holds a test', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  for (const h of HISTORICAL) {
    for (const f of h.tests) {
      const path = new URL(`./${f}`, import.meta.url);
      // Mutation checked: a file renamed away → this fails, naming the class that lost its proof.
      assert.ok(existsSync(path), `#${h.issue} (${h.cls}): ${f} is missing`);
      assert.match(readFileSync(path, 'utf8'), /\btest\(/, `#${h.issue}: ${f} holds no test`);
    }
  }
  assert.deepEqual(HISTORICAL.map((h) => h.issue), [2419, 2435, 2438, 2439, 2440, 3010]);
});
