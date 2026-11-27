/**
 * D4659 (#4659) — one graduation rule and one enrolled venture. Real routes and
 * services over the migrated schema (node:sqlite); every value is invented.
 *
 *   · the view `spinout_lab_graduates` is the catalog's rule, key for key;
 *   · incorporation recorded before weeks 1-3 is not graduation: no credential,
 *     no public listing, not "graduated" in /state; finishing later issues the
 *     credential once, conferred when the last step landed;
 *   · a founder with several projects names the venture; until then no project
 *     proves a milestone, and an older or unrelated project never becomes it;
 *   · rename keeps the venture, deletion asks again, a live venture is never
 *     switched by the founder;
 *   · the certificate and the public list name the venture's company;
 *   · the migration binds from the credential, then the only project, and
 *     records a needs_choice decision for the rest; issued credentials keep
 *     their snapshot.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_graduation_venture_4659.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { insertRow, proveMilestone, GRADUATION_KEYS } from './_lab_evidence.ts';
import spinoutLab from '../src/routes/spinout_lab.ts';
import { MILESTONES, isLabGraduate } from '../src/services/spinoutLabCatalog.ts';
import { resolveVenture, chooseVenture } from '../src/services/labVenture.ts';
import { recordLabMilestone } from '../src/services/labProgress.ts';

afterAll(() => removeMigratedDatabases());
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ONE = 401, MANY = 402, OUTSIDER = 403;
const MIGRATION = readFileSync(new URL('../sql/migrations/202611071800_lab_graduation_venture.sql', import.meta.url), 'utf8');

function world(): DatabaseSync {
  const db = migratedDatabase();
  for (const [id, f] of [[ONE, 4010], [MANY, 4020], [OUTSIDER, 4030]]) {
    db.prepare(`INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active, spinout_lab_week)
                VALUES (?, 'founder', 'Synthetic Founder', ?, 1, ?, 1, 1)`).run(id, `u${id}@example.test`, f);
    db.prepare(`INSERT INTO spinout_lab_enrollments (user_id, kind) VALUES (?, 'legacy')`).run(id);
  }
  insertRow(db, 'projects', { id: 41, founder_id: 4010, name: 'Solo Venture' });
  insertRow(db, 'projects', { id: 42, founder_id: 4020, name: 'Old Side Project' });
  insertRow(db, 'projects', { id: 43, founder_id: 4020, name: 'Lab Venture' });
  insertRow(db, 'projects', { id: 44, founder_id: 4030, name: 'Outsider Co' });
  return db;
}
const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};
const record = (db: DatabaseSync, who: number, keys: string[], at: string) => {
  for (const k of keys) {
    db.prepare(`INSERT OR IGNORE INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at, evidence_kind) VALUES (?, 1, ?, ?, 'saved_work')`).run(who, k, at);
  }
};
async function get(db: DatabaseSync, path: string, who?: number) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const res = await spinoutLab.request(path, { headers }, envOf(db));
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

test('#4659 the view is the catalog\'s rule, key for key', () => {
  const all = MILESTONES.flatMap((w) => w.requiredAll).sort();
  const any = MILESTONES.flatMap((w) => w.requiredAny ?? []).sort();
  // Mutation checked: a key dropped from the view's list → this fails.
  const lists = [...MIGRATION.matchAll(/m\.milestone_key IN \(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' '));
  const parse = (l: string) => [...l.matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]).sort();
  // Every list in the view is one of the two, exactly (the count and the date both read them).
  const parsed = lists.map((l) => JSON.stringify(parse(l)));
  assert.ok(parsed.length >= 4, 'the view names its lists');
  for (const l of parsed) assert.ok(l === JSON.stringify(all) || l === JSON.stringify(any), `a list drifted from the catalog: ${l}`);
  assert.equal(parsed.filter((l) => l === JSON.stringify(all)).length, 2, 'requiredAll, in the count and the date');
  assert.match(MIGRATION, new RegExp(`THEN m\\.milestone_key END\\) = ${all.length}\\b`));
  assert.equal(isLabGraduate(new Set(GRADUATION_KEYS)), true);
  assert.equal(isLabGraduate(new Set(GRADUATION_KEYS.filter((k) => k !== 'okrs_created'))), false);
});

test('#4659 incorporation before weeks 1-3 is not graduation; finishing later issues the credential once', async () => {
  const db = world();
  try {
    record(db, ONE, ['incorporation_completed'], '2026-10-01 09:00:00');
    // Mutation checked: the view back on incorporation_completed alone → ONE is listed and certified here.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM spinout_lab_graduates WHERE user_id = ?').get(ONE) as any).n, 0);
    assert.deepEqual((await get(db, '/graduates')).body, []);
    assert.equal((await quiet(() => get(db, '/state', ONE))).body.graduated, false);
    // The last required step lands through the recorder: the credential follows.
    record(db, ONE, GRADUATION_KEYS.filter((k) => !['incorporation_completed', 'advisor_meeting_booked'].includes(k)), '2026-10-10 09:00:00');
    proveMilestone(db, ONE, 'advisor_meeting_booked');
    const r = await quiet(() => recordLabMilestone(envOf(db), ONE, 'advisor_meeting_booked', 'member'));
    assert.ok(r.ok, JSON.stringify(r));
    const certs = db.prepare(`SELECT project_id, public_company, status FROM spinout_certificates WHERE user_id = ?`).all(ONE).map((x: any) => ({ ...x }));
    assert.deepEqual(certs, [{ project_id: 41, public_company: 'Solo Venture', status: 'issued' }]);
    assert.equal((await quiet(() => get(db, '/state', ONE))).body.graduated, true);
    const list = (await get(db, '/graduates')).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Solo Venture');
    // A replay issues nothing more.
    await quiet(() => recordLabMilestone(envOf(db), ONE, 'advisor_meeting_booked', 'member'));
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM spinout_certificates WHERE user_id = ?').get(ONE) as any).n, 1);
  } finally { db.close(); }
});

test('#4659 several projects: no project proves a milestone until the founder names the venture', async () => {
  const db = world();
  try {
    proveMilestone(db, MANY, 'okrs_created'); // written into whichever project the helper picks (the first: 42)
    const v = await resolveVenture(envOf(db), MANY);
    assert.equal(v.status, 'needs_choice');
    assert.deepEqual((v as any).choices.map((p: any) => p.id), [42, 43]);
    // Mutation checked: evidence over every owned project while unbound → the old project's OKRs count.
    const r = await quiet(() => recordLabMilestone(envOf(db), MANY, 'okrs_created', 'member'));
    assert.deepEqual([r.ok, (r as any).code], [false, 'lab_venture_choice_needed']);
    // A person-level step does not wait for the choice.
    proveMilestone(db, MANY, 'advisor_meeting_booked');
    assert.equal((await quiet(() => recordLabMilestone(envOf(db), MANY, 'advisor_meeting_booked', 'member'))).ok, true);
    // Someone else's project is not a choice.
    assert.deepEqual(await chooseVenture(envOf(db), MANY, 44, `user:${MANY}`).then((x: any) => [x.ok, x.code]), [false, 'project_not_owned']);
    const c = await chooseVenture(envOf(db), MANY, 43, `user:${MANY}`);
    assert.equal(c.ok, true);
    // The old project's OKRs still prove nothing; the venture's own do.
    assert.deepEqual(await quiet(() => recordLabMilestone(envOf(db), MANY, 'okrs_created', 'member')).then((x: any) => x.code), 'milestone_evidence_missing');
    for (let i = 0; i < 3; i++) insertRow(db, 'roadmap_okrs', { project_id: 43, objective: 'Ship' });
    const ok = await quiet(() => recordLabMilestone(envOf(db), MANY, 'okrs_created', 'member'));
    assert.equal((ok as any).evidence?.project_id, 43);
    const ev = db.prepare('SELECT event, project_id, actor FROM spinout_lab_enrollment_events WHERE user_id = ? ORDER BY id').all(MANY).map((x: any) => ({ ...x }));
    assert.deepEqual(ev, [{ event: 'chosen', project_id: 43, actor: `user:${MANY}` }]);
  } finally { db.close(); }
});

test('#4659 the one live project binds itself, once; rename keeps it; deletion asks again; a live venture is never switched', async () => {
  const db = world();
  try {
    const v = await resolveVenture(envOf(db), ONE);
    assert.deepEqual([v.status, (v as any).project?.id], ['bound', 41]);
    await resolveVenture(envOf(db), ONE);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM spinout_lab_enrollment_events WHERE user_id = ?').get(ONE) as any).n, 1, 'bound once');
    db.exec('UPDATE projects SET name = \'Solo Venture, Inc.\' WHERE id = 41');
    assert.equal(((await resolveVenture(envOf(db), ONE)) as any).project.name, 'Solo Venture, Inc.');
    insertRow(db, 'projects', { id: 45, founder_id: 4010, name: 'Second Thing' });
    // Mutation checked: chooseVenture without the bound guard → the founder moves the venture to 45.
    assert.deepEqual(await chooseVenture(envOf(db), ONE, 45, `user:${ONE}`).then((x: any) => [x.ok, x.code]), [false, 'venture_bound']);
    db.exec(`UPDATE projects SET deleted_at = '2026-11-01 00:00:00' WHERE id = 41`);
    const d = await resolveVenture(envOf(db), ONE);
    assert.equal(d.status, 'deleted');
    assert.equal((await chooseVenture(envOf(db), ONE, 45, `user:${ONE}`)).ok, true);
    assert.equal(((await resolveVenture(envOf(db), ONE)) as any).project.id, 45);
  } finally { db.close(); }
});

test('#4659 /state carries the venture and the choices; POST /venture answers the founder\'s own projects only', async () => {
  const db = world();
  try {
    const s = await quiet(() => get(db, '/state', MANY));
    assert.equal(s.body.venture.status, 'needs_choice');
    assert.deepEqual(s.body.venture.choices.map((p: any) => p.name), ['Old Side Project', 'Lab Venture']);
    assert.equal(s.body.venture_unreadable, false);
    const jwt = await new SignJWT({ user_id: MANY, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const post = async (project_id: number) => {
      const res = await spinoutLab.request('/venture', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id }) }, envOf(db));
      return { status: res.status, body: (await res.json()) as any };
    };
    assert.equal((await post(44)).status, 404);
    const ok = await post(43);
    assert.deepEqual([ok.status, ok.body.venture.status, ok.body.venture.project.id], [200, 'bound', 43]);
    assert.equal((await post(42)).status, 409);
  } finally { db.close(); }
});

test('#4659 the public lists name the venture, never an older project, and add no private field', async () => {
  const db = world();
  try {
    await chooseVenture(envOf(db), MANY, 43, `user:${MANY}`);
    record(db, MANY, GRADUATION_KEYS, '2026-10-20 09:00:00');
    const list = (await get(db, '/graduates')).body;
    // Mutation checked: /graduates back on the founder's projects → 'Old Side Project' (lowest id) is listed.
    assert.deepEqual(list.map((g: any) => g.name), ['Lab Venture']);
    const text = JSON.stringify(list);
    assert.doesNotMatch(text, /example\.test|Synthetic Founder|"user_id"/);
  } finally { db.close(); }
});

test('#4659 the migration binds from the credential, then the only project, and records a decision for the rest', () => {
  const db = migratedDatabase();
  try {
    db.exec('DELETE FROM spinout_lab_enrollment_events; DELETE FROM spinout_lab_enrollments');
    for (const [id, f] of [[501, 5010], [502, 5020], [503, 5030]]) {
      db.prepare(`INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, 'founder', 'S', ?, 1, ?)`).run(id, `m${id}@example.test`, f);
      db.prepare(`INSERT INTO spinout_lab_enrollments (user_id, kind) VALUES (?, 'legacy')`).run(id);
    }
    insertRow(db, 'projects', { id: 51, founder_id: 5010, name: 'A1' }); insertRow(db, 'projects', { id: 52, founder_id: 5010, name: 'A2' });
    insertRow(db, 'projects', { id: 53, founder_id: 5020, name: 'B1' });
    insertRow(db, 'projects', { id: 54, founder_id: 5030, name: 'C1' }); insertRow(db, 'projects', { id: 55, founder_id: 5030, name: 'C2' });
    // 501 holds a credential naming A2: that wins over "several projects".
    insertRow(db, 'spinout_certificates', { credential_id: 'AXL-T-501', user_id: 501, project_id: 52, status: 'issued', public_name: 'S', public_company: 'A2 snapshot' });
    const stmts = MIGRATION.split(/;\s*\n/).filter((s) => /^\s*(INSERT INTO spinout_lab_enrollment_events|UPDATE spinout_lab_enrollments)/m.test(s.replace(/^--.*$/gm, '')));
    for (const s of stmts) db.exec(s);
    const bound = db.prepare('SELECT user_id, project_id FROM spinout_lab_enrollments ORDER BY user_id').all().map((r: any) => ({ ...r }));
    assert.deepEqual(bound, [{ user_id: 501, project_id: 52 }, { user_id: 502, project_id: 53 }, { user_id: 503, project_id: null }]);
    const ev = db.prepare('SELECT user_id, event FROM spinout_lab_enrollment_events ORDER BY user_id').all().map((r: any) => ({ ...r }));
    assert.deepEqual(ev, [{ user_id: 501, event: 'bound_from_credential' }, { user_id: 502, event: 'bound_single_project' }, { user_id: 503, event: 'needs_choice' }]);
    // The issued snapshot is untouched.
    assert.equal((db.prepare('SELECT public_company FROM spinout_certificates WHERE user_id = 501').get() as any).public_company, 'A2 snapshot');
  } finally { db.close(); }
});

test('#4659 an issued credential keeps its holder a graduate (a recorded decision), until it is revoked', () => {
  const db = world();
  try {
    record(db, OUTSIDER, ['incorporation_completed'], '2026-08-01 09:00:00');
    insertRow(db, 'spinout_certificates', { credential_id: 'AXL-T-403', user_id: OUTSIDER, project_id: 44, status: 'issued', public_name: 'S' });
    const g = () => db.prepare('SELECT by_rule FROM spinout_lab_graduates WHERE user_id = ?').get(OUTSIDER) as any;
    assert.equal(g()?.by_rule, 0);
    db.exec(`UPDATE spinout_certificates SET status = 'revoked' WHERE user_id = ${OUTSIDER}`);
    assert.equal(g(), undefined);
  } finally { db.close(); }
});
