/**
 * D1000 (#2815), Persona segments part 3: the segment profile store
 * (migration 559), its routes, the status rules sign-up and retag follow, and
 * the needs read.
 *
 * What this file holds the Worker to:
 *   · the seed is the twelve as code describes them, once, with a history row each;
 *   · reads are any admin's, writes the Super Admin's on HQ, each write
 *     version-checked and recorded with what it changed;
 *   · a write names only stores that exist, and a need only offers the segment has;
 *     sidebar links, events and the sign-up questions are not written here;
 *   · sign-up offers only Active segments; a member keeps one they hold; an
 *     admin may place a member in a Draft segment, never a Retired one;
 *   · the needs read: admins out, 1 to 4 suppressed, what is met and what is a
 *     gap, events from each event's audience rule, links' reach by profile, and
 *     a block that cannot be read never reads as none.
 *
 * The real `routes/persona_segments.ts` and `routes/personas.ts` over HTTP, on
 * node:sqlite with schema_baseline.sql and migration 559.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/segment_profiles_d1000.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import segmentsRoute from '../src/routes/persona_segments.ts';
import personasRoute from '../src/routes/personas.ts';
import { PERSONAS } from '../src/personas.ts';
import { eventAdmits } from '../src/services/segmentProfiles.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const SECRET = 'segment-test-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../sql/migrations/559_segment_profiles.sql', import.meta.url), 'utf8');
const PROGRAMS = (() => {
  const src = readFileSync(new URL('../sql/migrations/560_program_registry.sql', import.meta.url), 'utf8');
  const at = src.indexOf('CREATE TABLE IF NOT EXISTS programs (');
  return src.slice(at, src.indexOf(');', at) + 2);
})();

const app = new Hono<any>();
app.route('/api/personas/segments', segmentsRoute);
app.route('/api/personas', personasRoute);
app.onError((err, c) => c.json({ detail: err.message }, AUTH_ERROR_STATUSES[err.message] ?? 500));

const ADMIN = 10, SUPER = 11, MEMBER = 20;
const NOW = Date.now();
const ahead = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_personas', 'events', 'perks', 'articles', 'admin_audit_log', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(PROGRAMS);
  db.exec(MIGRATION);
  const user = db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)`);
  user.run(ADMIN, 'admin@example.test', 'Synthetic admin', 'admin');
  user.run(SUPER, 'hq@example.test', 'Synthetic HQ', 'admin');
  user.run(MEMBER, 'member@acmevc.example', 'Synthetic member', 'investor');
  db.prepare(`INSERT INTO super_admins (user_id) VALUES (?)`).run(SUPER);
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}

async function call(env: any, as: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as !== null) {
    const role = as === MEMBER ? 'investor' : 'admin';
    headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: as, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  }
  const res = await app.request('/api/personas' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body: json };
}

const version = (db: DatabaseSync, key: string) => (db.prepare('SELECT version FROM segment_profiles WHERE key = ?').get(key) as any).version;

/* ------------------------------------------------------------------ *
 * The seed
 * ------------------------------------------------------------------ */

test('the seed is the twelve as code describes them, Active, once, each with one seeded history row', () => {
  const { db } = fixture();
  try {
    const rows = db.prepare('SELECT key, name, profile, status, who, typical_json, needs_json, offers_json, version FROM segment_profiles ORDER BY key').all() as any[];
    assert.equal(rows.length, PERSONAS.length);
    for (const p of PERSONAS) {
      const r = rows.find((x) => x.key === p.id);
      assert.ok(r, p.id);
      assert.equal(r.name, p.label);
      assert.equal(r.profile, p.profile, 'D998\'s profile');
      assert.equal(r.who, p.short_description);
      assert.equal(r.status, 'active', 'what sign-up offered before this store');
      assert.equal(r.typical_json, '[]');
      assert.equal(r.needs_json, '[]', 'no need is invented');
      assert.deepEqual(JSON.parse(r.offers_json), { programs: [], perks: [], content: [] });
      assert.equal(r.version, 1);
    }
    db.exec(MIGRATION);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM segment_profiles').get() as any).n, 12, 'applying it again adds nothing');
    const seeded = db.prepare(`SELECT segment_key, action, version FROM segment_profile_history`).all() as any[];
    assert.equal(seeded.length, 12, 'one seeded row each, not one per application');
    assert.ok(seeded.every((h) => h.action === 'seeded' && h.version === 1));
  } finally { db.close(); }
});

/* ------------------------------------------------------------------ *
 * Reads and writes
 * ------------------------------------------------------------------ */

test('reads are any admin\'s; a write is the Super Admin\'s, names its version, and is recorded with what it changed', async () => {
  const { db, env } = fixture();
  try {
    assert.equal((await call(env, null, 'GET', '/segments')).status, 401);
    assert.equal((await call(env, MEMBER, 'GET', '/segments')).status, 403, 'a member reads no profile');
    const list = await call(env, ADMIN, 'GET', '/segments');
    assert.equal(list.status, 200);
    assert.equal(list.body.segments.length, 12);
    const angel = list.body.segments.find((s: any) => s.key === 'angel_scout');
    assert.deepEqual(angel.offers.sidebar_links, PERSONAS.find((p) => p.id === 'angel_scout')!.nav_extras, 'sidebar links are code\'s');
    assert.equal(angel.sign_up_questions, 4);
    assert.equal(angel.code_profile, 'investor');

    const one = await call(env, ADMIN, 'GET', '/segments/angel_scout');
    assert.equal(one.status, 200);
    assert.equal(one.body.history.length, 1);
    assert.equal(one.body.history[0].action, 'seeded');
    assert.equal((await call(env, ADMIN, 'GET', '/segments/nobody_here')).status, 404);

    const edit = { expected_version: 1, name: 'Angel / Scout', who: 'Individual angels writing early checks.', typical: ['Writes 3 to 5 checks a year.'], reason: 'Sharper words' };
    const refused = await call(env, ADMIN, 'PATCH', '/segments/angel_scout', edit);
    assert.equal(refused.status, 403, 'a plain Admin writes no profile');
    assert.equal(version(db, 'angel_scout'), 1);

    const saved = await call(env, SUPER, 'PATCH', '/segments/angel_scout', edit);
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.changed.sort(), ['typical', 'who'], 'the unchanged name is not a change');
    assert.equal(saved.body.segment.version, 2);
    assert.equal(saved.body.segment.who, 'Individual angels writing early checks.');
    const hist = db.prepare(`SELECT version, action, fields_json, before_json, after_json, reason, actor_user_id FROM segment_profile_history WHERE segment_key = 'angel_scout' ORDER BY id DESC`).get() as any;
    assert.equal(hist.action, 'edited');
    assert.equal(hist.version, 2);
    assert.deepEqual(JSON.parse(hist.fields_json).sort(), ['typical', 'who']);
    assert.equal(JSON.parse(hist.before_json).who, PERSONAS.find((p) => p.id === 'angel_scout')!.short_description);
    assert.deepEqual(JSON.parse(hist.after_json).typical, ['Writes 3 to 5 checks a year.']);
    assert.equal(hist.reason, 'Sharper words');
    assert.equal(hist.actor_user_id, SUPER);
    assert.equal((await call(env, ADMIN, 'GET', '/segments/angel_scout')).body.history[0].by, 'Synthetic HQ');

    const stale = await call(env, SUPER, 'PATCH', '/segments/angel_scout', { expected_version: 1, who: 'Someone else\'s words.' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'segment_changed');
    assert.equal(version(db, 'angel_scout'), 2, 'a stale write changes nothing');
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM segment_profile_history WHERE segment_key = 'angel_scout'`).get() as any).n, 2, 'and writes no history');

    const noop = await call(env, SUPER, 'PATCH', '/segments/angel_scout', { expected_version: 2, who: 'Individual angels writing early checks.' });
    assert.deepEqual(noop.body.changed, []);
    assert.equal(version(db, 'angel_scout'), 2, 'nothing changed, no new version');
    assert.equal((await call(env, SUPER, 'PATCH', '/segments/angel_scout', { who: 'x' })).body.code, 'expected_version_required');
    assert.equal((await call(env, SUPER, 'PATCH', '/segments/nobody_here', { expected_version: 1, who: 'x' })).status, 404);
  } finally { db.close(); }
});

test('a write names only stores that exist and offers the segment has; sidebar links, events and limits are refused', async () => {
  const { db, env } = fixture();
  try {
    db.exec(`INSERT INTO programs (key, grp, name, status, position) VALUES ('refer_earn', 'Network and referrals', 'Refer & Earn', 'live', 1), ('co_invest', 'Access', 'Co-invest club', 'not_built', 2)`);
    db.exec(`INSERT INTO perks (uid, partner_name, category, offer, status) VALUES ('perk-diligence', 'Partner A', 'tools', 'Diligence tools', 'live')`);
    db.exec(`INSERT INTO articles (slug, title, status, author_user_id) VALUES ('diligence-checklist', 'Diligence checklist', 'published', ${SUPER})`);
    const write = (body: Record<string, unknown>) => call(env, SUPER, 'PATCH', '/segments/angel_scout', { expected_version: version(db, 'angel_scout'), ...body });

    assert.equal((await write({ offers: { programs: ['nope'] } })).body.code, 'unknown_program');
    assert.equal((await write({ offers: { perks: ['nope'] } })).body.code, 'unknown_perk');
    assert.equal((await write({ offers: { content: ['nope'] } })).body.code, 'unknown_content');
    assert.equal((await write({ offers: { sidebar_links: [{ to: '/x', label: 'X' }] } })).body.code, 'read_only', 'sidebar links are code\'s');
    assert.equal((await write({ sidebar_links: [] })).body.code, 'read_only');
    assert.equal((await write({ events: 3 })).body.code, 'read_only', 'events are each event\'s audience');
    assert.equal((await write({ status: 'archived' })).body.code, 'invalid_status');
    assert.equal((await write({ profile: 'wizard' })).body.code, 'invalid_profile');
    assert.equal((await write({ who: 'x'.repeat(281) })).body.code, 'invalid_who');
    assert.equal((await write({ typical: ['a', 'b', 'c', 'd', 'e'] })).body.code, 'invalid_typical', 'up to 4');
    assert.equal((await write({ needs: Array.from({ length: 7 }, (_, i) => ({ text: `Need ${i}` })) })).body.code, 'invalid_needs', 'up to 6');
    assert.equal((await write({ needs: [{ text: 'Deal flow', answered_by: [{ kind: 'program', ref: 'refer_earn' }] }] })).body.code, 'answer_not_offered', 'a need answers from the segment\'s own offers');
    assert.equal((await write({ needs: [{ text: 'Deal flow', answered_by: [{ kind: 'sidebar_link', ref: '/nowhere' }] }] })).body.code, 'answer_not_offered');
    assert.equal(version(db, 'angel_scout'), 1, 'no refused write changed anything');

    const ok = await write({
      offers: { programs: ['refer_earn', 'co_invest'], perks: ['perk-diligence'], content: ['diligence-checklist'] },
      needs: [
        { id: 'flow', text: 'Early deal flow that fits their thesis.', answered_by: [{ kind: 'sidebar_link', ref: '/deals' }, { kind: 'events' }] },
        { id: 'coinvest', text: 'Co-invest next to the studio.', answered_by: [{ kind: 'program', ref: 'co_invest' }] },
        { id: 'diligence', text: 'Quick, light diligence on a deal.', answered_by: [{ kind: 'content', ref: 'diligence-checklist' }, { kind: 'perk', ref: 'perk-diligence' }] },
        { id: 'paid', text: 'Get paid for the founders they bring.', answered_by: [{ kind: 'program', ref: 'refer_earn' }] },
      ],
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.segment.needs.map((n: any) => n.id), ['flow', 'coinvest', 'diligence', 'paid'], 'in HQ\'s order');
    const dropped = await write({ offers: { programs: ['co_invest'] } });
    assert.equal(dropped.body.code, 'answer_not_offered', 'an offer a need still names cannot be taken away');
  } finally { db.close(); }
});

/* ------------------------------------------------------------------ *
 * The status rules
 * ------------------------------------------------------------------ */

test('sign-up offers only Active segments under HQ\'s name; a member keeps one they hold; retag takes Draft, never Retired', async () => {
  const { db, env } = fixture();
  try {
    const set = (key: string, status: string) => db.prepare(`UPDATE segment_profiles SET status = ? WHERE key = ?`).run(status, key);
    set('gp_external', 'draft');
    set('corporate_vc', 'retired');
    db.prepare(`UPDATE segment_profiles SET name = 'Angels and scouts', who = 'HQ words.' WHERE key = 'angel_scout'`).run();

    const tax = await call(env, null, 'GET', '/taxonomy');
    assert.equal(tax.status, 200);
    const ids = tax.body.personas.map((p: any) => p.id);
    assert.equal(ids.length, 10);
    assert.ok(!ids.includes('gp_external') && !ids.includes('corporate_vc'), 'Draft and Retired are not offered');
    const angel = tax.body.personas.find((p: any) => p.id === 'angel_scout');
    assert.equal(angel.label, 'Angels and scouts', 'HQ\'s name');
    assert.equal(angel.short_description, 'HQ words.');
    assert.equal(angel.follow_up_questions.length, 4, 'the questions stay code\'s');

    // The email-domain heuristic suggests gp_external ('vc'); a Draft segment is not suggested.
    const classified = await call(env, MEMBER, 'POST', '/classify', { first_message: 'I run a fund.' });
    assert.equal(classified.status, 200);
    assert.equal(classified.body.persona_id, null);
    assert.equal(classified.body.needs_disambiguation, true);
    assert.ok(classified.body.alternatives.every((a: any) => !['gp_external', 'corporate_vc'].includes(a.persona_id)));

    const draft = await call(env, MEMBER, 'POST', '/finalize', { persona_id: 'gp_external', source: 'self_select' });
    assert.equal(draft.status, 409);
    assert.equal(draft.body.code, 'segment_not_offered');
    assert.equal((await call(env, MEMBER, 'POST', '/finalize', { persona_id: 'corporate_vc', source: 'self_select' })).body.code, 'segment_not_offered');
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM user_personas WHERE user_id = ?`).get(MEMBER) as any).n, 0, 'nothing written');

    // A member already in a segment that is retired later keeps it.
    db.prepare(`INSERT INTO user_personas (user_id, persona_id, confidence, source, is_primary) VALUES (?, 'corporate_vc', 1, 'self_select', 1)`).run(MEMBER);
    assert.equal((await call(env, MEMBER, 'POST', '/finalize', { persona_id: 'corporate_vc', source: 'self_select' })).status, 200, 'their own segment');

    const toDraft = await call(env, ADMIN, 'POST', `/admin/${MEMBER}/retag`, { persona_id: 'gp_external' });
    assert.equal(toDraft.status, 200, 'an admin places members in a Draft segment');
    set('lp_individual', 'retired');
    const toRetired = await call(env, ADMIN, 'POST', `/admin/${MEMBER}/retag`, { persona_id: 'lp_individual' });
    assert.equal(toRetired.status, 409);
    assert.equal(toRetired.body.code, 'segment_retired');
    assert.equal(toRetired.body.detail, 'LP — Individual is retired, so it takes no new members.');
    assert.equal((db.prepare(`SELECT persona_id FROM user_personas WHERE user_id = ? AND is_primary = 1`).get(MEMBER) as any).persona_id, 'gp_external', 'the refused move changed nothing');

    db.exec('DROP TABLE segment_profiles');
    const down = await call(env, null, 'GET', '/taxonomy');
    assert.equal(down.status, 503, 'an unreadable store is not the full twelve');
    assert.equal(down.body.code, 'segments_unreadable');
    assert.equal((await call(env, MEMBER, 'POST', '/finalize', { persona_id: 'angel_scout', source: 'self_select' })).status, 503);
  } finally { db.close(); }
});

/* ------------------------------------------------------------------ *
 * The needs read
 * ------------------------------------------------------------------ */

test('event admission follows the event\'s own rule: everyone, the segment named, or its profile named; never invite-only', () => {
  assert.equal(eventAdmits('{}', 'angel_scout', 'investor'), true, 'no rule is everyone');
  assert.equal(eventAdmits('{"mode":"everyone"}', 'angel_scout', 'investor'), true);
  assert.equal(eventAdmits('{"mode":"selected","personas":["angel_scout"]}', 'angel_scout', 'investor'), true);
  assert.equal(eventAdmits('{"mode":"selected","roles":["investor"]}', 'angel_scout', 'investor'), true);
  assert.equal(eventAdmits('{"mode":"selected","roles":["founder"],"personas":["founder_new"]}', 'angel_scout', 'investor'), false);
  assert.equal(eventAdmits('{"mode":"invite_only"}', 'angel_scout', 'investor'), false);
});

test('the needs read: admins out, 1 to 4 suppressed, met and gaps by kind, links\' reach by profile, and an unread block is never none', async () => {
  const { db, env } = fixture();
  try {
    db.exec(`INSERT INTO programs (key, grp, name, status, position) VALUES ('refer_earn', 'Network and referrals', 'Refer & Earn', 'live', 1), ('co_invest', 'Access', 'Co-invest club', 'not_built', 2)`);
    db.exec(`INSERT INTO perks (uid, partner_name, category, offer, status) VALUES ('perk-diligence', 'Partner A', 'tools', 'Diligence tools', 'paused')`);
    db.exec(`INSERT INTO articles (slug, title, status, author_user_id) VALUES ('diligence-checklist', 'Diligence checklist', 'published', ${SUPER})`);
    const ev = db.prepare(`INSERT INTO events (slug, host_user_id, title, starts_at, visibility, status, audience_rules_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    ev.run('a', SUPER, 'Open to all', ahead(5), 'public', 'published', '{}');
    ev.run('b', SUPER, 'Investors only', ahead(6), 'unlisted', 'published', '{"mode":"selected","roles":["investor"]}');
    ev.run('c', SUPER, 'Founders only', ahead(7), 'public', 'published', '{"mode":"selected","personas":["founder_new"]}');
    ev.run('d', SUPER, 'Invite only', ahead(8), 'public', 'published', '{"mode":"invite_only"}');
    ev.run('e', SUPER, 'Past', ahead(-3), 'public', 'published', '{}');
    ev.run('f', SUPER, 'Private', ahead(9), 'private', 'published', '{}');
    ev.run('g', SUPER, 'Draft', ahead(9), 'public', 'draft', '{}');

    // Members of Angel / Scout: 7 investors and 2 founders (the sidebar reaches the 7), plus one admin who is not counted.
    const user = db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)`);
    const tag = db.prepare(`INSERT INTO user_personas (user_id, persona_id, confidence, source, is_primary) VALUES (?, ?, 1, 'self_select', 1)`);
    let id = 100;
    for (const role of ['investor', 'investor', 'investor', 'investor', 'investor', 'investor', 'investor', 'founder', 'founder', 'admin']) { user.run(id, `m${id}@example.test`, `M${id}`, role); tag.run(id, 'angel_scout'); id += 1; }
    // Three members of LP — Institutional: a small cell.
    for (let i = 0; i < 3; i += 1) { user.run(id, `m${id}@example.test`, `M${id}`, 'investor'); tag.run(id, 'lp_institutional'); id += 1; }
    // GP — External Fund: 6 investors and 5 partners, both cells shown.
    for (const role of ['investor', 'investor', 'investor', 'investor', 'investor', 'investor', 'partner', 'partner', 'partner', 'partner', 'partner']) { user.run(id, `m${id}@example.test`, `M${id}`, role); tag.run(id, 'gp_external'); id += 1; }

    const save = await call(env, SUPER, 'PATCH', '/segments/angel_scout', {
      expected_version: 1,
      offers: { programs: ['refer_earn', 'co_invest'], perks: ['perk-diligence'], content: ['diligence-checklist'] },
      needs: [
        { id: 'flow', text: 'Early deal flow.', answered_by: [{ kind: 'sidebar_link', ref: '/deals' }, { kind: 'events' }] },
        { id: 'coinvest', text: 'Co-invest next to the studio.', answered_by: [{ kind: 'program', ref: 'co_invest' }] },
        { id: 'diligence', text: 'Quick diligence.', answered_by: [{ kind: 'perk', ref: 'perk-diligence' }, { kind: 'content', ref: 'diligence-checklist' }] },
        { id: 'paid', text: 'Get paid for referrals.', answered_by: [{ kind: 'program', ref: 'refer_earn' }] },
      ],
    });
    assert.equal(save.status, 200);

    assert.equal((await call(env, MEMBER, 'GET', '/segments/coverage')).status, 403);
    const cov = await call(env, ADMIN, 'GET', '/segments/coverage');
    assert.equal(cov.status, 200);
    const angel = cov.body.segments.find((s: any) => s.key === 'angel_scout');
    assert.deepEqual(angel.members, { count: 9, suppressed: false }, 'the admin is not counted');
    assert.equal(angel.needs.recorded, true);
    assert.equal(angel.needs.total, 4);
    assert.equal(angel.needs.met, 3, 'flow (link, events), diligence (published content), paid (live program)');
    assert.deepEqual(angel.needs.gaps.map((g: any) => g.id), ['coinvest'], 'a program not built answers nothing');
    assert.deepEqual(angel.gap_kinds, ['program', 'perk'], 'the paused perk and the unbuilt program are gaps of their kind');
    assert.deepEqual(angel.offers.programs, { available: true, count: 2, live: 1 });
    assert.deepEqual(angel.offers.perks, { available: true, count: 1, live: 0 });
    assert.equal(angel.offers.events.count, 2, 'open to all, and investors by role; not founders-only, invite-only, past, private or draft');
    // The 2 founders the link does not reach are under 5, and 7 of 9 would give them away, so the 7 is hidden too.
    assert.deepEqual(angel.offers.sidebar_links.reach, { reached: { count: null, suppressed: true }, of: { count: 9, suppressed: false } });
    assert.equal(angel.offers.sidebar_links.code_profile, 'investor');

    const gp = cov.body.segments.find((s: any) => s.key === 'gp_external');
    assert.deepEqual(gp.offers.sidebar_links.reach, { reached: { count: 6, suppressed: false }, of: { count: 11, suppressed: false } }, 'the 5 partners are not reached: the link needs the Investor profile');

    const lp = cov.body.segments.find((s: any) => s.key === 'lp_institutional');
    assert.deepEqual(lp.members, { count: null, suppressed: true }, '3 is under 5');
    assert.equal(lp.needs.recorded, false, 'no needs written is "Not recorded", not 0 of 0');
    assert.equal(lp.needs.total, undefined);
    assert.deepEqual(lp.offers.sidebar_links.reach.reached, { count: null, suppressed: true });
    const empty = cov.body.segments.find((s: any) => s.key === 'press_analyst');
    assert.deepEqual(empty.members, { count: 0, suppressed: false }, 'a real zero is 0');
    assert.equal(empty.offers.sidebar_links.reach, null, 'no link, no reach');

    db.exec('DROP TABLE perks');
    const partial = await call(env, ADMIN, 'GET', '/segments/coverage');
    assert.equal(partial.status, 200, 'one block failing leaves the rest');
    const again = partial.body.segments.find((s: any) => s.key === 'angel_scout');
    assert.equal(again.offers.perks.unreadable, true);
    assert.equal(again.needs.met, 3, 'diligence is still met by its content');
    assert.ok(!again.gap_kinds.includes('perk'), 'an unread perk is not a gap');

    db.exec('DROP TABLE user_personas');
    assert.equal((await call(env, ADMIN, 'GET', '/segments/coverage')).status, 503, 'members unread: no figures at all');
  } finally { db.close(); }
});
