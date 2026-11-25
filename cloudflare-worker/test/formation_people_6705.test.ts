import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router from '../src/routes/formation_case_people.ts';
import { sharingAllowed, deliverPersonNotice, personRequirements } from '../src/services/formationPeople.ts';
import { screenFormationCase, decideScreening } from '../src/services/formationScreening.ts';

function setup() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,role,name) VALUES(801,'a@example.test','founder','Test Founder'),(802,'b@example.test','admin','Test Reviewer');
    INSERT INTO partners(id,name,email) VALUES(801,'Test firm','firm@example.test'),(802,'Other firm','other@example.test');
    INSERT INTO formation_cases(id,uid,user_id,intent,stage,track,hq_owner_user_id,partner_id)
    VALUES(801,'fixture',801,'new_company','details','v2',802,801);
    INSERT INTO formation_case_people(id,case_id,name,ownership_bps,is_entity,notice_email,residence_country)
    VALUES(801,801,'Invented Subject',8000,0,'notice@example.test','US');
    INSERT INTO formation_case_person_roles VALUES(801,'director');`);
  const env: any = {
    DB: d1Over(db),
    JWT_SECRET: randomUUID(),
    TOKENS: {
      get: async (key: string) => [
        {
          source: key.split(':').at(-1),
          name: 'invented subject',
          aliases: [],
          ref: 'synthetic',
          dob: null,
          nationality: null,
        },
      ],
    },
  };
  return { db, env };
}
test('a case cannot quote incomplete ownership and returns the unsatisfied sourced resident-director fact', async () => {
  const { db, env } = setup();
  assert.throws(
    () => db.exec("UPDATE formation_cases SET stage='quoted' WHERE id=801"),
    /ownership_incomplete/,
  );
  db.exec(`INSERT INTO formation_catalogue_versions(id,version) VALUES(801,801);
    INSERT INTO formation_jurisdictions(id,version_id,country) VALUES(801,801,'DE');
    INSERT INTO formation_entity_forms(id,version_id,jurisdiction_id,form_key,label) VALUES(801,801,801,'fixture','Fixture');
    INSERT INTO formation_sources(id,kind,title) VALUES(801,'counsel','Fixture');
    INSERT INTO formation_form_facts(version_id,form_id,fact_key,value,status,blocking,source_id,checked_on)
    VALUES(801,801,'resident_director','1','recorded',1,801,'2026-11-01');
    UPDATE formation_cases SET form_key='fixture',catalogue_version_id=801 WHERE id=801`);
  assert.deepEqual((await personRequirements(env, 801)).needs, [
    { requirement: 'resident_director', source_id: 801, checked_on: '2026-11-01', partner_covers: false },
  ]);
  db.exec("UPDATE formation_case_people SET ownership_bps=10000,residence_country='DE' WHERE id=801");
  assert.deepEqual((await personRequirements(env, 801)).needs, []);
  db.exec("UPDATE formation_cases SET stage='quoted' WHERE id=801");
  const cols = db
    .prepare('PRAGMA table_info(formation_case_people)')
    .all()
    .map((x) => String(x.name));
  assert.ok(
    cols.includes('verification_reference') && !cols.some((x) => /document|passport|file_id/.test(x)),
  );
});
test('accountless match holds a case and requires assigned HQ review before decline', async () => {
  const { db, env } = setup();
  assert.deepEqual(await screenFormationCase(env, 801, 'offer', 802), { held: true });
  const state = () => ({
    ...db.prepare('SELECT waiting_on,closed_at,close_reason FROM formation_cases WHERE id=801').get(),
  });
  assert.deepEqual(state(), { waiting_on: 'hq', closed_at: null, close_reason: null });
  const id = Number(db.prepare('SELECT id FROM formation_case_screenings WHERE person_id=801').get()!.id);
  assert.equal(await decideScreening(env, 'fixture', id, 801, false, 'decline', 'Private fixture'), false);
  assert.equal(await decideScreening(env, 'fixture', id, 802, false, 'decline', 'Private fixture'), true);
  assert.equal(state().close_reason, 'declined');
});
test('delivery and partner-specific consent both gate access and withdrawal is immediate', async () => {
  const { db, env } = setup();
  db.exec(`INSERT INTO formation_case_consents(case_id,kind,partner_id,scope,text_hash,lawful_basis_key,given_by) VALUES(801,'share_with_partner',801,'people','fixture','test',801);
    INSERT INTO formation_case_screenings(person_id,person_revision,checkpoint,provider_lists,severity,matches) VALUES(801,1,'offer','[]','none','[]')`);
  const can = (partner = 801) => sharingAllowed(env, 801, partner, 'people', false);
  assert.equal(await can(), false);
  assert.equal(await deliverPersonNotice(env, 801, 801, 801, null), 'awaiting_counsel');
  const copy = (p: string) => 'Synthetic approved notice for ' + p;
  assert.equal(await deliverPersonNotice(env, 801, 801, 801, copy, async () => false), 'undelivered');
  assert.equal(await can(), false);
  assert.equal(
    await deliverPersonNotice(
      env,
      801,
      801,
      801,
      copy,
      async (_env, to, body) => to === 'notice@example.test' && body.includes('Test firm'),
    ),
    'sent',
  );
  assert.equal(await can(), true);
  db.exec('UPDATE formation_cases SET partner_id=802 WHERE id=801');
  assert.equal(await can(802), false);
  db.exec(
    'UPDATE formation_cases SET partner_id=801 WHERE id=801; UPDATE formation_case_consents SET withdrawn_at=CURRENT_TIMESTAMP WHERE case_id=801',
  );
  assert.equal(await can(), false);
});
test('founder endpoint confines records to their owner and omits the screening reason and delivery address', async () => {
  const { env, db } = setup();
  const token = async (user_id: number) =>
    new SignJWT({ user_id })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(env.JWT_SECRET));
  const call = async (who: number, action: string, body?: object) =>
    router.request(
      '/fixture/' + action,
      {
        method: body ? 'POST' : 'GET',
        headers: { authorization: 'Bearer ' + (await token(who)), 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      },
      env,
    );
  assert.equal((await call(802, 'people')).status, 404);
  const add = await call(801, 'add', {
    revision: 0,
    name: 'Test Person',
    notice_email: 'new@example.test',
    ownership_bps: 2000,
    is_entity: false,
    roles: ['director', 'shareholder'],
  });
  assert.equal(add.status, 200, await add.text());
  const list = await call(801, 'people');
  const text = await list.text();
  assert.equal(list.status, 200, text);
  assert.equal(/notice@example.test|new@example.test|hq_reason/.test(text), false);
  assert.deepEqual(JSON.parse(text).people[1].roles, ['director', 'shareholder']);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM activity_logs WHERE user_id=801 AND action='formation_people_add'")
      .get()!.n,
    1,
  );
});

test('a new check after human clearance uses the same evidence and holds again on a changed match', async () => {
  const { db, env } = setup();
  await screenFormationCase(env, 801, 'payment', 802);
  const id = Number(db.prepare('SELECT id FROM formation_case_screenings WHERE person_id=801').get()!.id);
  assert.equal(await decideScreening(env, 'fixture', id, 802, false, 'clear', 'Different individual'), true);
  assert.deepEqual(await screenFormationCase(env, 801, 'payment', 802), { held: false });
  env.TOKENS = {
    get: async (key: string) => [
      {
        source: key.split(':').at(-1),
        name: 'invented subject',
        aliases: [],
        ref: 'new-list-entry',
        dob: null,
        nationality: null,
      },
    ],
  };
  assert.deepEqual(await screenFormationCase(env, 801, 'payment', 802), { held: true });
  assert.equal(
    db.prepare('SELECT count(*) n FROM formation_case_screenings WHERE decision IS NULL').get()!.n,
    1,
  );
});
test('missing provider evidence cannot pass screening or produce a clean result', async () => {
  const { db, env } = setup();
  env.TOKENS = { get: async () => [] };
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  try {
    await assert.rejects(() => screenFormationCase(env, 801, 'submission', 802), /Screening not completed/);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM formation_case_screenings').get()!.n, 0);
});
test('owner may grant and withdraw consent after payment, but cannot edit participants or capital', async () => {
  const { db, env } = setup();
  db.exec(
    "INSERT INTO formation_partners(partner_id,status) VALUES(801,'verified');UPDATE formation_case_people SET ownership_bps=10000 WHERE id=801;UPDATE formation_cases SET stage='paid' WHERE id=801",
  );
  const auth = await new SignJWT({ user_id: 801 })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(env.JWT_SECRET));
  const post = (action: string, body: object) =>
    router.request(
      '/fixture/' + action,
      {
        method: 'POST',
        headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      env,
    );
  assert.equal(
    (await post('capital', { revision: 0, amount_minor: 100, currency: 'USD', share_count: 10 })).status,
    409,
  );
  assert.equal((await post('remove', { revision: 0, id: 801 })).status, 409);
  const r = await post('consent', {
    revision: 0,
    kind: 'share_with_partner',
    partner_id: 801,
    scope: 'people',
    text_hash: 'a'.repeat(64),
    lawful_basis_key: 'test',
  });
  assert.equal(r.status, 200, await r.text());
  const id = db.prepare('SELECT id FROM formation_case_consents WHERE case_id=801').get()!.id;
  assert.equal((await post('withdraw', { revision: 1, id })).status, 200);
  assert.ok(db.prepare('SELECT withdrawn_at FROM formation_case_consents WHERE id=?').get(id)!.withdrawn_at);
});
