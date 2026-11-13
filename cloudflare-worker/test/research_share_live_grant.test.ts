/**
 * A share to an advisor is only as live as the grant it was made under.
 *
 * `advisor_client_document_shares` is additive to `advisor_client_grants`
 * (migration 218): a founder pushes a document to an advisor who holds a grant
 * on their project. The library's list and `readableDoc()` read the share, so
 * they must also require a live grant. Live means `status = 'active'` and not
 * past `expires_at`, held by that advisor over a project of the document's
 * owner. Otherwise revoking or expiring the grant would leave every document
 * shared under it listed and downloadable.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_share_live_grant.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import research from '../src/routes/research.ts';
import researchClientPrep from '../src/routes/research_client_prep.ts';
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';

// Brief notes live in research_client_prep.ts, mounted ahead of research.ts (D4574-p8).
const app = new Hono().route('/api/research', researchClientPrep).route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, 500));
const SECRET = 'unit-research-share-live-grant-secret-0123456789';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

const OWNER = 901;          // the founder's user, who owns the document
const OWNER_FOUNDER = 5001; // the founders row: deliberately not equal to OWNER
const OTHER = 904;          // another founder's user
const OTHER_FOUNDER = 5004;
const ADVISOR = 902;
const PROJECT = 71;
const OTHER_PROJECT = 72;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  for (const t of ['users', 'projects', 'activity_logs']) {
    const at = baseline.indexOf(`CREATE TABLE ${t} (`);
    db.exec(baseline.slice(at, baseline.indexOf(';', at) + 1));
  }
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/218_advisor_client_grants.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/222_research_brief_notes.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  db.exec(`INSERT INTO users (id,email,name,role,founder_id) VALUES
    (${OWNER},'owner@example.test','Owner','founder',${OWNER_FOUNDER}),
    (${OTHER},'other@example.test','Other','founder',${OTHER_FOUNDER}),
    (${ADVISOR},'advisor@example.test','Advisor','advisor',NULL)`);
  db.exec(`INSERT INTO projects (id,uid,name,founder_id) VALUES
    (${PROJECT},'p-verwood','Verwood',${OWNER_FOUNDER}), (${OTHER_PROJECT},'p-elsewhere','Elsewhere',${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state)
           VALUES (1,'doc-shared',${OWNER},'Teardown','r/1','indexed')`);
  db.exec(`INSERT INTO advisor_client_document_shares (uid,document_id,advisor_user_id,shared_by_user_id,status)
           VALUES ('s-1',1,${ADVISOR},${OWNER},'active')`);
  const env: any = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    KEK_R2: 'unit-kek-0123456789abcdef',
    SIGNED_URLS: { put: async () => undefined, get: async () => null, delete: async () => undefined },
    FILES: { get: async () => null },
  };
  return { db, env };
}

const grant = (f: ReturnType<typeof fixture>, project: number, status: string, expiresAt: string | null) =>
  f.db.prepare(`INSERT INTO advisor_client_grants (uid,advisor_user_id,project_id,granted_by_user_id,status,expires_at,scope_project)
                VALUES (?,?,?,?,?,?,1)`).run(`g-${project}-${status}`, ADVISOR, project, OWNER, status, expiresAt);

async function call(f: ReturnType<typeof fixture>, who: number, path: string) {
  const token = await new SignJWT({ user_id: who, role: who === ADVISOR ? 'advisor' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const response = await app.request(`/api/research${path}`, { headers: { Authorization: `Bearer ${token}` } }, f.env);
  return { status: response.status, body: await response.json() as any };
}

const listed = async (f: ReturnType<typeof fixture>) =>
  (await call(f, ADVISOR, '/documents')).body.items.map((i: any) => i.uid);

test('a live grant: the share is listed with its project and opens', async () => {
  const f = fixture();
  grant(f, PROJECT, 'active', null);
  const list = await call(f, ADVISOR, '/documents');
  assert.deepEqual(list.body.items.map((i: any) => i.uid), ['doc-shared']);
  // The owner is matched through users.founder_id, so the chip names the project
  // even though the founders row id differs from the owner's user id.
  assert.equal(list.body.items[0].source, 'client');
  assert.match(JSON.stringify(list.body.items[0]), /Verwood/);
  assert.equal((await call(f, ADVISOR, '/documents/doc-shared/download')).status, 200);
});

test('a grant expiring in the future still opens', async () => {
  const f = fixture();
  grant(f, PROJECT, 'active', '2999-01-01 00:00:00');
  assert.deepEqual(await listed(f), ['doc-shared']);
  assert.equal((await call(f, ADVISOR, '/documents/doc-shared/download')).status, 200);
});

for (const [name, setup] of [
  ['the grant was revoked', (f: ReturnType<typeof fixture>) => grant(f, PROJECT, 'revoked', null)],
  ['the grant has expired', (f: ReturnType<typeof fixture>) => grant(f, PROJECT, 'active', '2000-01-01 00:00:00')],
  ['there was never a grant', () => undefined],
  ['the only live grant is over another founder\'s project', (f: ReturnType<typeof fixture>) => grant(f, OTHER_PROJECT, 'active', null)],
] as const) {
  test(`an active share is neither listed nor opened when ${name}`, async () => {
    const f = fixture();
    setup(f);
    assert.deepEqual(await listed(f), []);
    const refused = await call(f, ADVISOR, '/documents/doc-shared/download');
    const missing = await call(f, ADVISOR, '/documents/no-such-doc/download');
    assert.equal(refused.status, 404);
    // The same body as a document that does not exist: the refusal says nothing
    // about whose document it is.
    assert.deepEqual(refused.body, missing.body);
    // The owner's own read is untouched.
    assert.equal((await call(f, OWNER, '/documents/doc-shared/download')).status, 200);
  });
}

test('brief notes follow the same grant: open while live, refused once it has expired', async () => {
  const live = fixture();
  grant(live, PROJECT, 'active', '2999-01-01 00:00:00');
  assert.equal((await call(live, ADVISOR, '/brief-notes?project=p-verwood')).status, 200);
  const expired = fixture();
  grant(expired, PROJECT, 'active', '2000-01-01 00:00:00');
  const refused = await call(expired, ADVISOR, '/brief-notes?project=p-verwood');
  assert.equal(refused.status, 404);
  assert.deepEqual(refused.body, (await call(expired, ADVISOR, '/brief-notes?project=no-such-project')).body);
});
