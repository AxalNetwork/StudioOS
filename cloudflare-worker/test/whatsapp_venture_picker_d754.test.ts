/**
 * D754 way B, "Send to Axal" part 3 (#1939) — the venture a linked member's
 * WhatsApp recordings go to. On the SQLite D1 harness, Graph mocked.
 *
 * What these prove:
 *   · Migration 504: one choice per link, gone with its link, cleared when the
 *     venture is deleted; the file runs twice.
 *   · PUT /whatsapp/link/venture: only a linked member; only a whole positive
 *     id or null; a venture the member cannot write (missing, another member's,
 *     deleted) is 403 with one body; their own is recorded and read back by GET.
 *   · A capture opens in the chosen venture, else in the most recently updated
 *     one; changing the choice later never moves a capture already open.
 *   · DELETE, STOP and the purge's lapse each clear the choice, so a relink
 *     starts with none.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/whatsapp_venture_picker_d754.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AXAL_PNID, ME, OTHER, PROJECT, SENDER, call, link, mig, mockGraph, now, waHook, waText, world } from './_whatsapp_axal_fixture.ts';
import { purgeExpired } from '../src/services/channels/threads.ts';

/** ME's older second venture, and OTHER's own. */
const SECOND = 501, THEIRS = 502, OTHER_FOUNDER = 71;

function ventures(db: any) {
  db.exec(`INSERT INTO founders (id, user_id) VALUES (${OTHER_FOUNDER}, ${OTHER});
    UPDATE users SET founder_id = ${OTHER_FOUNDER} WHERE id = ${OTHER};
    UPDATE projects SET updated_at = '2026-10-19 12:00:00' WHERE id = ${PROJECT};
    INSERT INTO projects (id, name, founder_id, updated_at) VALUES (${SECOND}, 'Payroll pilot', 70, '2026-09-01 12:00:00'),
      (${THEIRS}, 'Not mine', ${OTHER_FOUNDER}, '2026-10-19 12:00:00');`);
}

let msgId = 0;
const voice = (mediaId: string, from = SENDER) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '3000002', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '15550009999', phone_number_id: AXAL_PNID },
    contacts: [{ profile: { name: 'Dana Ruiz' }, wa_id: from }],
    messages: [{ from, id: `wamid.VP${++msgId}`, timestamp: String(now()), type: 'audio', audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus', voice: true } }],
  } }] }],
});
const settings = (db: any) => db.prepare('SELECT integration_id, project_id FROM whatsapp_link_settings').all().map((r: any) => ({ ...r }));
const captureVentures = (db: any) => db.prepare('SELECT project_id FROM whatsapp_captures ORDER BY id').all().map((r: any) => r.project_id);

test('504: one choice per link, gone with its link, cleared by a deleted venture; the file runs twice', () => {
  const { db } = world();
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(mig('504_whatsapp_link_settings.sql'));
  db.exec(`INSERT INTO integrations (id, uid, user_id, provider_key, auth_type) VALUES (9, 'u9', ${ME}, 'whatsapp_link', 'none');
    INSERT INTO whatsapp_link_settings (integration_id, project_id) VALUES (9, ${PROJECT});`);
  assert.throws(() => db.exec(`INSERT INTO whatsapp_link_settings (integration_id, project_id) VALUES (9, ${PROJECT})`), /UNIQUE|PRIMARY/);
  db.exec(`DELETE FROM projects WHERE id = ${PROJECT}`);
  assert.deepEqual(settings(db), [{ integration_id: 9, project_id: null }], 'a deleted venture clears the choice');
  db.exec('DELETE FROM integrations WHERE id = 9');
  assert.deepEqual(settings(db), [], 'the choice goes with its link');
});

test('PUT: a linked member chooses one of their own ventures; anything else is refused, and GET reads it back', async () => {
  // Mutation checked: drop the founder join from WRITABLE_VENTURE_SQL → another member's venture is accepted (200).
  const { env, db } = world();
  ventures(db);
  const g = mockGraph();
  try {
    assert.deepEqual([(await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: PROJECT })).body.code], ['whatsapp_not_linked']);
    assert.equal((await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: PROJECT })).status, 409);
    await link(env);
    assert.equal((await call(env, ME, 'GET', '/whatsapp/link')).body.venture, null, 'no choice yet');
    for (const bad of [{}, { project_id: String(PROJECT) }, { project_id: 0 }, { project_id: -1 }, { project_id: 1.5 }])
      assert.equal((await call(env, ME, 'PUT', '/whatsapp/link/venture', bad)).status, 400, JSON.stringify(bad));
    const theirs = await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: THEIRS });
    const missing = await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: 9999 });
    assert.deepEqual([theirs.status, missing.status], [403, 403]);
    assert.deepEqual(theirs.body, missing.body, 'another member\'s venture and a missing one read the same');
    assert.equal(theirs.body.code, 'venture_not_yours');
    assert.deepEqual(settings(db), [], 'nothing recorded for a refusal');
    const ok = await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: SECOND });
    assert.deepEqual([ok.status, ok.body.venture], [200, { project_id: SECOND, name: 'Payroll pilot' }]);
    assert.deepEqual((await call(env, ME, 'GET', '/whatsapp/link')).body.venture, { project_id: SECOND, name: 'Payroll pilot' });
    // A deleted venture is refused, and a choice whose venture is later deleted reads as none.
    db.exec(`UPDATE projects SET deleted_at = datetime('now') WHERE id = ${SECOND}`);
    assert.equal((await call(env, ME, 'GET', '/whatsapp/link')).body.venture, null);
    assert.equal((await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: SECOND })).status, 403);
    assert.deepEqual((await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: PROJECT })).body.venture, { project_id: PROJECT, name: 'Ledger tool' });
    const cleared = await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: null });
    assert.deepEqual([cleared.status, cleared.body.venture, settings(db).length], [200, null, 0], 'null clears the choice');
  } finally { g.restore(); }
});

test('PUT is refused while way B is off', async () => {
  const { env } = world({ axal: { WHATSAPP_AXAL_DISPLAY_NUMBER: '' } });
  assert.equal((await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: PROJECT })).status, 503);
});

test('a capture opens in the chosen venture, else the most recent; a later change never moves it', async () => {
  // Mutation checked: drop the chosen-venture subquery from the capture's COALESCE → the first capture opens in PROJECT.
  const { env, db } = world();
  ventures(db);
  const g = mockGraph();
  try {
    await link(env);
    await waHook(env, voice('MEDIA-1'));
    assert.deepEqual(captureVentures(db), [PROJECT], 'no choice: the most recently updated venture');
    db.exec("UPDATE whatsapp_captures SET status = 'declined'");
    assert.equal((await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: SECOND })).status, 200);
    await waHook(env, voice('MEDIA-2'));
    assert.deepEqual(captureVentures(db), [PROJECT, SECOND], 'the chosen venture, though another is more recent');
    assert.equal((await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: PROJECT })).status, 200);
    assert.deepEqual(captureVentures(db), [PROJECT, SECOND], 'a capture already open keeps its venture');
    // A choice whose venture is gone falls back, never to nowhere.
    db.exec("UPDATE whatsapp_captures SET status = 'declined'");
    assert.equal((await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: SECOND })).status, 200);
    db.exec(`UPDATE projects SET deleted_at = datetime('now') WHERE id = ${SECOND}`);
    await waHook(env, voice('MEDIA-3'));
    assert.deepEqual(captureVentures(db), [PROJECT, SECOND, PROJECT]);
  } finally { g.restore(); }
});

test('DELETE, STOP and the purge\'s lapse each clear the choice, so a relink starts with none', async () => {
  // Mutation checked: drop the settings DELETE from unlinkMember → the relinked member reads Payroll pilot.
  const { env, db } = world();
  ventures(db);
  const g = mockGraph();
  try {
    const choose = async () => {
      await link(env);
      assert.equal((await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: SECOND })).status, 200);
      assert.equal(settings(db).length, 1);
    };
    await choose();
    assert.equal((await call(env, ME, 'DELETE', '/whatsapp/link')).status, 200);
    assert.deepEqual(settings(db), [], 'DELETE');
    await link(env);
    assert.equal((await call(env, ME, 'GET', '/whatsapp/link')).body.venture, null, 'relinked with no choice');
    assert.equal((await call(env, ME, 'PUT', '/whatsapp/link/venture', { project_id: SECOND })).status, 200);
    await waHook(env, waText('STOP'));
    assert.deepEqual(settings(db), [], 'STOP');
    await choose();
    db.exec("UPDATE integrations SET last_synced_at = '2020-01-01 00:00:00', updated_at = '2020-01-01 00:00:00' WHERE provider_key = 'whatsapp_link'");
    const purged = await purgeExpired(env);
    assert.equal(purged.lapsed, 1);
    assert.deepEqual(settings(db), [], 'the lapse');
  } finally { g.restore(); }
});
