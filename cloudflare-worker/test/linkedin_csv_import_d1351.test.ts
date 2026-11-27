/**
 * D1351 (#3566, part 2 of #3564) — the member's contact import from LinkedIn's
 * Connections.csv, on the server: parse, normalise, conservative matching
 * against the member's own records only, the suggestions they decide, and
 * notes and follow-ups. The migrated schema in memory (652 with the rest),
 * the route mounted on a bare Hono, synthetic people only.
 *
 * What #3566 says must be tested, each below by name: LinkedIn's real header
 * shape with the notes preamble; empty emails; quoted commas; preview before
 * commit; an exact URL match; an exact email match; name plus company only a
 * suggestion; Merge keeps both sources; another member's rows are never read;
 * the job counts; the size cap.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/linkedin_csv_import_d1351.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import contactImports from '../src/routes/contact_imports.ts';
import {
  MAX_CSV_BYTES, nameCompanyKey, normaliseConnectedOn, normaliseEmail, normaliseProfileUrl, parseConnectionsCsv,
} from '../src/services/linkedinCsvImport.ts';
import { deleteLinkedinOnly } from '../src/services/linkedinConnections.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const SECRET = 'synthetic-d1351-only-not-a-real-credential'.repeat(2);
const ME = 2, OTHER = 3, PARTNER = 4;

/** LinkedIn's export as it arrives: a BOM, the "Notes:" preamble, then the header. */
const PREAMBLE = '﻿Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address."\n\n';
const HEADER = 'First Name,Last Name,URL,Email Address,Company,Position,Connected On\n';
const CSV = PREAMBLE + HEADER + [
  'Ada,Lovelace,https://www.linkedin.com/in/Ada-L/,,Analytical Engines,Engineer,12 Mar 2024', // exact URL → my book row 21
  'Grace,Hopper,https://www.linkedin.com/in/grace-h,GRACE@Navy.example,Navy,"Rear Admiral, Retd",01 Jan 2023', // exact email → my typed row 22
  'Alan,Turing,https://www.linkedin.com/in/alan-t,,Bletchley,Mathematician,05 Feb 2022', // name + company → suggestion on my row 23
  'Katherine,Johnson,,kj@orbit.example,Orbit Labs,Analyst,07 Jul 2021', // email → my raise prospect: suggestion
  'Mary,Jackson,https://www.linkedin.com/in/mary-j,mary@nasa.example,NASA,Engineer,09 Sep 2020', // only the other member has her: new
  ',,https://www.linkedin.com/in/no-name,,Nowhere,,', // no name: an error
  'Ada,Lovelace,https://www.linkedin.com/in/ada-l,,Analytical Engines,Engineer,12 Mar 2024', // repeat of row 1: skipped
  'Dorothy,Vaughan,https://www.linkedin.com/in/dorothy-v,,"Acme, Inc.",Supervisor,03 Apr 2019', // quoted comma; empty email: new
].join('\n') + '\n';

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'Me','me@example.test'),(202,'Other','other@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (${ME},'Me','me@example.test','founder',101,1),(${OTHER},'Other','other@example.test','founder',202,1),(${PARTNER},'Partner','p@example.test','partner',NULL,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (701,'p-me','Mine',101),(702,'p-other','Theirs',202);
    INSERT INTO network_connections(id,user_id,name,email,company,title,linkedin_url,source) VALUES
      (21,${ME},'Ada Lovelace',NULL,NULL,'Countess','https://www.linkedin.com/in/ada-l','typed'),
      (22,${ME},'Grace Hopper','grace@navy.example','Typed Co',NULL,NULL,'typed'),
      (23,${ME},'Alan Turing',NULL,'Bletchley',NULL,NULL,'typed'),
      (31,${OTHER},'Mary Jackson','mary@nasa.example','NASA',NULL,'https://www.linkedin.com/in/mary-j','typed'),
      (32,${OTHER},'Dorothy Vaughan',NULL,'Acme, Inc.',NULL,NULL,'typed');
    INSERT INTO raise_prospects(id,uid,project_id,name,email,firm) VALUES (41,'rp-me',701,'K. Johnson','kj@orbit.example','Orbit'),(42,'rp-other',702,'Dorothy Vaughan','dv@acme.example','Acme, Inc.');
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route('/api/contacts', contactImports);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const token = (who: number, extra: Record<string, unknown> = {}) => new SignJWT({ user_id: who, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
  async function upload(who: number, csv: string | null, { preview = false, extra = {} as Record<string, unknown>, name = 'Connections.csv' } = {}) {
    const fd = new FormData();
    if (csv != null) fd.append('file', new File([csv], name, { type: 'text/csv' }));
    const res = await app.request(`https://unit.test/api/contacts/import/linkedin-csv${preview ? '?preview=1' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${await token(who, extra)}` }, body: fd }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  async function call(who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
    const res = await app.request(`https://unit.test/api/contacts${path}`, { method, headers: { Authorization: `Bearer ${await token(who, extra)}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  const count = (sql: string, ...b: unknown[]) => Number((db.prepare(sql).get(...(b as any[])) as any).n);
  return { db, env, upload, call, count };
}

test('the parser: LinkedIn’s header after its notes preamble and BOM, quoted commas, empty emails, a quoted newline; a file that is not LinkedIn’s', () => {
  const p = parseConnectionsCsv(CSV);
  assert.equal(p.header, true);
  assert.equal(p.rows.length, 8);
  assert.deepEqual(p.rows[0], { line: 5, first: 'Ada', last: 'Lovelace', url: 'https://www.linkedin.com/in/Ada-L/', email: '', company: 'Analytical Engines', position: 'Engineer', connected_on: '12 Mar 2024' });
  assert.equal(p.rows[1].position, 'Rear Admiral, Retd', 'a quoted comma stays in its field');
  assert.equal(p.rows[7].company, 'Acme, Inc.');
  assert.equal(p.rows[3].url, '', 'an empty column stays empty');
  const multi = parseConnectionsCsv(HEADER + 'Ann,Lee,,,"Line one\nline two",CTO,01 Jan 2020\nBo,Ng,,,X,,\n');
  assert.deepEqual(multi.rows.map((r) => [r.line, r.first, r.company]), [[2, 'Ann', 'Line one\nline two'], [4, 'Bo', 'X']]);
  assert.equal(parseConnectionsCsv('He said ""hi""\nname,email\nA,a@b.c\n').header, false, 'a plain two-column file is not Connections.csv');
  assert.equal(parseConnectionsCsv('').header, false);
  // A BOM straight before the header, with no preamble: the first column is still First Name.
  assert.equal(parseConnectionsCsv('\uFEFF' + HEADER + 'Ann,Lee,,,,,\n').rows[0].first, 'Ann');
  // An export with no Email Address column is still LinkedIn's.
  const noEmail = parseConnectionsCsv('First Name,Last Name,URL,Company,Position,Connected On\nAnn,Lee,https://www.linkedin.com/in/ann,Acme,CTO,01 Jan 2020\n');
  assert.deepEqual([noEmail.header, noEmail.rows[0].email, noEmail.rows[0].company], [true, '', 'Acme']);
});

test('normalising: the profile URL, the email, LinkedIn’s date and the name-and-company key', () => {
  assert.equal(normaliseProfileUrl('https://www.linkedin.com/in/Ada-L/?trk=x'), 'https://www.linkedin.com/in/ada-l');
  assert.equal(normaliseProfileUrl('linkedin.com/in/ada-l'), 'https://www.linkedin.com/in/ada-l');
  assert.equal(normaliseProfileUrl('https://uk.linkedin.com/in/ada-l'), 'https://www.linkedin.com/in/ada-l');
  assert.equal(normaliseProfileUrl('https://evil.example/in/ada-l'), null);
  assert.equal(normaliseProfileUrl('https://www.linkedin.com/company/acme'), null);
  assert.equal(normaliseProfileUrl(''), null);
  assert.equal(normaliseEmail(' GRACE@Navy.example '), 'grace@navy.example');
  assert.equal(normaliseEmail('not an email'), null);
  assert.equal(normaliseConnectedOn('12 Mar 2024'), '2024-03-12');
  assert.equal(normaliseConnectedOn('5 September 2019'), '2019-09-05');
  assert.equal(normaliseConnectedOn('2021-07-07'), '2021-07-07');
  assert.equal(normaliseConnectedOn('yesterday'), null);
  assert.equal(nameCompanyKey('  Alan   Turing ', 'BLETCHLEY'), 'alan turing|bletchley');
  assert.equal(nameCompanyKey('Alan Turing', ''), null, 'a name alone is never a key');
});

test('preview before commit: the counts and a sample, and nothing written', async () => {
  const f = fixture();
  const before = [f.count('SELECT COUNT(*) n FROM network_connections'), f.count('SELECT COUNT(*) n FROM contact_import_jobs'), f.count('SELECT COUNT(*) n FROM contact_sources'), f.count('SELECT COUNT(*) n FROM contact_match_reviews')];
  const r = await f.upload(ME, CSV, { preview: true });
  assert.equal(r.status, 200);
  const p = r.body.preview;
  assert.deepEqual([p.rows, p.new, p.duplicates, p.suggestions, p.skipped, p.errors], [8, 2, 2, 2, 1, 1]);
  assert.deepEqual(p.sample.map((s: any) => [s.line, s.kind, s.reason ?? s.why ?? null]), [
    [5, 'duplicate', 'url'], [6, 'duplicate', 'email'], [7, 'suggestion', 'name_company'], [8, 'suggestion', 'email'],
    [9, 'new', null], [10, 'error', 'no_name'], [11, 'skipped', 'repeat_in_file'], [12, 'new', null],
  ]);
  assert.equal(p.sample[3].with, 'raise_prospects');
  assert.doesNotMatch(JSON.stringify(p), /@/, 'the preview never echoes an email');
  assert.deepEqual([f.count('SELECT COUNT(*) n FROM network_connections'), f.count('SELECT COUNT(*) n FROM contact_import_jobs'), f.count('SELECT COUNT(*) n FROM contact_sources'), f.count('SELECT COUNT(*) n FROM contact_match_reviews')], before);
});

test('commit: an exact URL and an exact email match fill only blanks; name plus company is only a suggestion; the job counts; one source per row', async () => {
  const f = fixture();
  const r = await f.upload(ME, CSV);
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.job.created, r.body.job.matched, r.body.job.skipped, r.body.job.errors, r.body.job.suggestions], [4, 2, 1, 1, 2]);
  const job = f.db.prepare('SELECT * FROM contact_import_jobs WHERE uid = ?').get(r.body.job.uid) as any;
  assert.deepEqual([job.owner_user_id, job.source, job.status, job.rows_total, job.rows_created, job.rows_matched, job.rows_skipped, job.rows_errors], [ME, 'linkedin_csv', 'done', 8, 4, 2, 1, 1]);
  // Exact URL: Ada's row keeps the title the member typed, and gains the date.
  const ada = f.db.prepare('SELECT * FROM network_connections WHERE id = 21').get() as any;
  assert.deepEqual([ada.title, ada.company, ada.connected_on, ada.linkedin_url], ['Countess', 'Analytical Engines', '2024-03-12', 'https://www.linkedin.com/in/ada-l']);
  // Exact email, lowercased: Grace's company stays as typed; her URL is filled.
  const grace = f.db.prepare('SELECT * FROM network_connections WHERE id = 22').get() as any;
  assert.deepEqual([grace.company, grace.title, grace.linkedin_url], ['Typed Co', 'Rear Admiral, Retd', 'https://www.linkedin.com/in/grace-h']);
  assert.equal(f.count("SELECT COUNT(*) n FROM network_connections WHERE user_id = ? AND name IN ('Ada Lovelace', 'Grace Hopper')", ME), 2, 'an exact match makes no second row');
  // Name plus company: a new row, and a review, never a merge.
  const alans = f.db.prepare("SELECT id, source FROM network_connections WHERE user_id = ? AND name = 'Alan Turing' ORDER BY id").all(ME) as any[];
  assert.equal(alans.length, 2);
  assert.equal(alans[1].source, 'linkedin_csv');
  const reviews = f.db.prepare('SELECT contact_id, candidate_table, candidate_id, reason, status FROM contact_match_reviews WHERE owner_user_id = ? ORDER BY id').all(ME) as any[];
  assert.deepEqual(reviews.map((x) => [x.candidate_table, x.candidate_id, x.reason, x.status]), [['network_connections', 23, 'name_company', 'pending'], ['raise_prospects', 41, 'email', 'pending']]);
  // Empty email and a quoted comma, new.
  const dorothy = f.db.prepare("SELECT * FROM network_connections WHERE user_id = ? AND name = 'Dorothy Vaughan'").get(ME) as any;
  assert.deepEqual([dorothy.email, dorothy.company, dorothy.connected_on], [null, 'Acme, Inc.', '2019-04-03']);
  // One source row per written row: created for the four, matched for the two.
  const src = f.db.prepare('SELECT contact_id, created_row FROM contact_sources WHERE owner_user_id = ? AND job_id = ? ORDER BY contact_id').all(ME, job.id) as any[];
  assert.equal(src.length, 6);
  assert.deepEqual(src.filter((s) => s.created_row === 0).map((s) => s.contact_id), [21, 22]);
  // Audited by count, never by email.
  const audit = JSON.stringify(f.db.prepare('SELECT * FROM integration_audit_log').all());
  assert.match(audit, /4 created, 2 matched, 1 skipped/);
  assert.doesNotMatch(audit, /@/);
});

test('another member’s rows are never read: their Mary Jackson and Dorothy Vaughan match nothing of mine, and their book and prospects are untouched', async () => {
  const f = fixture();
  const theirs = JSON.stringify(f.db.prepare('SELECT * FROM network_connections WHERE user_id = ? ORDER BY id').all(OTHER));
  const r = await f.upload(ME, CSV);
  assert.equal(r.status, 201);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM network_connections WHERE user_id = ? ORDER BY id').all(OTHER)), theirs);
  assert.equal(f.count("SELECT COUNT(*) n FROM network_connections WHERE user_id = ? AND name = 'Mary Jackson'", ME), 1, 'a new row in my own book');
  assert.equal(f.count('SELECT COUNT(*) n FROM contact_match_reviews WHERE candidate_id IN (31, 32, 42)'), 0, 'no suggestion points at another member’s record');
  assert.equal(f.count('SELECT COUNT(*) n FROM contact_sources WHERE owner_user_id = ?', OTHER), 0);
  // The other member's own import sees only their own: my rows never suggest.
  const other = await f.upload(OTHER, PREAMBLE + HEADER + 'Alan,Turing,,,Bletchley,,\n', { preview: true });
  assert.deepEqual([other.body.preview.new, other.body.preview.suggestions], [1, 0]);
  // Their reviews, notes and tasks are not mine to read or decide.
  const mine = (f.db.prepare('SELECT uid FROM contact_match_reviews WHERE owner_user_id = ? LIMIT 1').get(ME) as any).uid;
  assert.equal((await f.call(OTHER, 'POST', `/import/reviews/${mine}/dismiss`)).status, 404);
  assert.deepEqual((await f.call(OTHER, 'GET', '/import/reviews')).body.reviews, []);
  assert.equal((await f.call(ME, 'GET', '/book/31/notes')).status, 404);
  assert.equal((await f.call(ME, 'POST', '/book/31/tasks', { title: 'Call' })).status, 404);
});

test('a partner’s book and the member’s recruiting and interviews are their own records too', async () => {
  const f = fixture();
  f.db.exec(`
    INSERT INTO partner_book_contacts(uid, owner_user_id, name, email, organization) VALUES ('pb1', ${PARTNER}, 'Hedy Lamarr', 'hedy@film.example', 'MGM');
    INSERT INTO job_postings(id, slug, host_user_id, project_id, title) VALUES (51, 'eng', ${ME}, 701, 'Engineer'), (52, 'eng-2', ${OTHER}, 702, 'Engineer');
    INSERT INTO job_applications(id, posting_id, name, email, linkedin_url) VALUES (61, 51, 'Linus T', 'linus@kernel.example', 'https://www.linkedin.com/in/linus-t'), (62, 52, 'Ken T', 'ken@unix.example', NULL);
    INSERT INTO discovery_interviews(id, project_id, interviewee_name, interviewee_company) VALUES (71, 701, 'Margaret Hamilton', 'MIT');
  `);
  const csv = PREAMBLE + HEADER + [
    'Hedy,Lamarr,,HEDY@film.example,MGM,,', 'Linus,Torvalds,https://linkedin.com/in/Linus-T,,,,', 'Margaret,Hamilton,,,MIT,,', 'Ken,Thompson,,ken@unix.example,,,',
  ].join('\n');
  const partner = await f.upload(PARTNER, csv, { preview: true });
  assert.deepEqual(partner.body.preview.sample.map((s: any) => [s.kind, s.with ?? null]), [['suggestion', 'partner_book_contacts'], ['new', null], ['new', null], ['new', null]]);
  const me = await f.upload(ME, csv, { preview: true });
  assert.deepEqual(me.body.preview.sample.map((s: any) => [s.kind, s.reason ?? null, s.with ?? null]), [
    ['new', null, null], ['suggestion', 'url', 'job_applications'], ['suggestion', 'name_company', 'discovery_interviews'], ['new', null, null],
  ], 'another host’s applicant (Ken) is not mine');
});

test('Merge keeps both sources (the merged one as matched), fills only blanks, moves notes, and survives a later LinkedIn delete; Keep both and Dismiss change no contact; a decision is made once', async () => {
  const f = fixture();
  await f.upload(ME, CSV);
  const listed = (await f.call(ME, 'GET', '/import/reviews')).body.reviews;
  assert.equal(listed.length, 2);
  const alan = listed.find((x: any) => x.candidate.table === 'network_connections');
  const kj = listed.find((x: any) => x.candidate.table === 'raise_prospects');
  assert.deepEqual([alan.can_merge, alan.reason, alan.candidate.id, alan.candidate.name, alan.imported.name], [true, 'name_company', 23, 'Alan Turing', 'Alan Turing']);
  assert.deepEqual([kj.can_merge, kj.candidate.name], [false, 'K. Johnson']);
  assert.doesNotMatch(JSON.stringify(listed), /@/, 'a suggestion never carries an email');
  // A typed source on the row already there, and a note on the imported one.
  f.db.prepare("INSERT INTO contact_sources (owner_user_id, contact_table, contact_id, source, created_row) VALUES (?, 'network_connections', 23, 'typed', 1)").run(ME);
  await f.call(ME, 'POST', `/book/${alan.imported.id}/notes`, { body: 'Met at the codebreakers dinner.' });
  const m = await f.call(ME, 'POST', `/import/reviews/${alan.uid}/merge`);
  assert.deepEqual([m.status, m.body.status, m.body.contact_id], [200, 'merged', 23]);
  assert.equal(f.count('SELECT COUNT(*) n FROM network_connections WHERE id = ?', alan.imported.id), 0, 'the imported row folds into the one already there');
  const kept = f.db.prepare('SELECT * FROM network_connections WHERE id = 23').get() as any;
  assert.deepEqual([kept.company, kept.title, kept.linkedin_url, kept.connected_on], ['Bletchley', 'Mathematician', 'https://www.linkedin.com/in/alan-t', '2022-02-05']);
  const sources = f.db.prepare('SELECT source, created_row FROM contact_sources WHERE contact_id = 23 ORDER BY id').all() as any[];
  assert.deepEqual(sources.map((s) => [s.source, s.created_row]), [['linkedin_csv', 0], ['typed', 1]], 'both provenance rows stay; LinkedIn did not make this row');
  assert.equal(f.count('SELECT COUNT(*) n FROM network_contact_notes WHERE contact_id = 23'), 1, 'the note moved with it');
  // Decided once.
  assert.deepEqual([(await f.call(ME, 'POST', `/import/reviews/${alan.uid}/keep`)).status], [409]);
  // A record outside the book cannot be merged; Keep both changes nothing.
  const bad = await f.call(ME, 'POST', `/import/reviews/${kj.uid}/merge`);
  assert.deepEqual([bad.status, bad.body.error], [409, 'cannot_merge']);
  const keep = await f.call(ME, 'POST', `/import/reviews/${kj.uid}/keep`);
  assert.equal(keep.body.status, 'kept_both');
  // A suggestion already kept as two is not merged afterwards, and nothing changes.
  const later = (f.db.prepare("SELECT uid, contact_id FROM contact_match_reviews WHERE owner_user_id = ? AND status = 'pending' AND candidate_table = 'raise_prospects'").get(ME) as any);
  assert.equal(later, undefined);
  const book = f.count('SELECT COUNT(*) n FROM network_connections WHERE user_id = ?', ME);
  assert.deepEqual([(await f.call(ME, 'POST', `/import/reviews/${kj.uid}/merge`)).status], [409]);
  assert.equal(f.count('SELECT COUNT(*) n FROM network_connections WHERE user_id = ?', ME), book);
  assert.equal(f.count("SELECT COUNT(*) n FROM network_connections WHERE user_id = ? AND name = 'Katherine Johnson'", ME), 1);
  assert.equal((await f.call(ME, 'POST', `/import/reviews/${kj.uid}/sideways`)).status, 400);
  assert.deepEqual((await f.call(ME, 'GET', '/import/reviews')).body.reviews, []);
  // Disconnect's delete takes only what LinkedIn alone made: never the merged row.
  await deleteLinkedinOnly(f.env, ME);
  assert.equal(f.count('SELECT COUNT(*) n FROM network_connections WHERE id = 23'), 1);
  assert.equal(f.count("SELECT COUNT(*) n FROM network_connections WHERE user_id = ? AND name = 'Mary Jackson'", ME), 0, 'a LinkedIn-only row goes');
});

test('Dismiss leaves both rows; two rows already in the book can be merged only while both are there', async () => {
  const f = fixture();
  await f.upload(ME, CSV);
  const alan = (await f.call(ME, 'GET', '/import/reviews')).body.reviews.find((x: any) => x.can_merge);
  f.db.prepare('DELETE FROM network_connections WHERE id = 23').run();
  assert.equal((await f.call(ME, 'POST', `/import/reviews/${alan.uid}/merge`)).status, 404, 'the row it would merge into is gone');
  const d = await f.call(ME, 'POST', `/import/reviews/${alan.uid}/dismiss`);
  assert.equal(d.body.status, 'dismissed');
  assert.equal(f.count('SELECT COUNT(*) n FROM network_connections WHERE id = ?', alan.imported.id), 1);
});

test('a suggestion kept as two rows is never merged afterwards', async () => {
  const f = fixture();
  await f.upload(ME, CSV);
  const alan = (await f.call(ME, 'GET', '/import/reviews')).body.reviews.find((x: any) => x.can_merge);
  assert.equal((await f.call(ME, 'POST', `/import/reviews/${alan.uid}/keep`)).body.status, 'kept_both');
  const m = await f.call(ME, 'POST', `/import/reviews/${alan.uid}/merge`);
  assert.deepEqual([m.status, m.body.error], [409, 'decided']);
  assert.equal(f.count('SELECT COUNT(*) n FROM network_connections WHERE id IN (23, ?)', alan.imported.id), 2, 'both rows stay');
  assert.equal(f.count("SELECT COUNT(*) n FROM contact_sources WHERE contact_id = 23 AND source = 'linkedin_csv'"), 0);
});

test('the size cap, no file, a file that is not LinkedIn’s, and a support session', async () => {
  const f = fixture();
  const big = HEADER + 'x'.repeat(MAX_CSV_BYTES + 1);
  const r = await f.upload(ME, big);
  assert.deepEqual([r.status, r.body.error], [413, 'file_too_large']);
  assert.equal(f.count('SELECT COUNT(*) n FROM contact_import_jobs'), 0);
  assert.deepEqual([(await f.upload(ME, null)).status, (await f.upload(ME, null)).body.error], [400, 'no_file']);
  const plain = await f.upload(ME, 'name,email\nAda,ada@example.test\n');
  assert.deepEqual([plain.status, plain.body.error], [422, 'not_linkedin_csv']);
  // A support session may look, never write.
  assert.equal((await f.upload(ME, CSV, { preview: true, extra: { impersonated_by: 99 } })).status, 200);
  const s = await f.upload(ME, CSV, { extra: { impersonated_by: 99 } });
  assert.deepEqual([s.status, s.body.error], [403, 'support_session']);
  assert.equal(f.count('SELECT COUNT(*) n FROM contact_import_jobs'), 0);
  // Signed out.
  const app = new Hono<any>().route('/api/contacts', contactImports);
  assert.equal((await app.request('https://unit.test/api/contacts/import/reviews', {}, f.env)).status, 401);
});

test('notes and follow-ups on the member’s own contact', async () => {
  const f = fixture();
  assert.deepEqual((await f.call(ME, 'GET', '/book/22/notes')).body.notes, []);
  assert.equal((await f.call(ME, 'POST', '/book/22/notes', { body: '' })).status, 400);
  const n = await f.call(ME, 'POST', '/book/22/notes', { body: 'Prefers email.' });
  assert.deepEqual([n.status, n.body.notes.map((x: any) => x.body)], [201, ['Prefers email.']]);
  assert.equal((await f.call(ME, 'POST', '/book/22/tasks', { title: 'Send the deck', due_on: '28/11/2026' })).status, 400);
  const t = await f.call(ME, 'POST', '/book/22/tasks', { title: 'Send the deck', due_on: '2026-11-28' });
  assert.equal(t.status, 201);
  const uid = t.body.tasks[0].uid;
  const done = await f.call(ME, 'PATCH', `/book/22/tasks/${uid}`, { done: true });
  assert.ok(done.body.tasks[0].done_at);
  assert.equal((await f.call(ME, 'PATCH', `/book/22/tasks/${uid}`, { done: 'yes' })).status, 400);
  assert.equal((await f.call(ME, 'PATCH', `/book/23/tasks/${uid}`, { done: false })).status, 404, 'a task is found on its own contact only');
  assert.equal((await f.call(OTHER, 'GET', '/book/22/tasks')).status, 404);
  assert.equal((await f.call(ME, 'POST', '/book/22/notes', { body: 'x' }, { impersonated_by: 99 })).status, 403);
});

test('the raw-SQL budget: no interpolated SQL in the import files', () => {
  for (const file of ['src/routes/contact_imports.ts', 'src/services/linkedinCsvImport.ts']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/prepare\(\s*`([^`]*)`/g)) assert.doesNotMatch(m[1], /\$\{/, `${file}: ${m[1].slice(0, 60)}`);
  }
});
