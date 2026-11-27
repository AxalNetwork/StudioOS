/** D7818 (#7818): owner scope, revision refusal, private receipts, lifecycle and independent route mounts.
 *
 * From cloudflare-worker/test/README.md (moved by #6472):
 * `research_project_subject_notes_7818.test.ts` verifies the D7818 contract against synthetic
 * inputs and the canonical migrated schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router, {
  mount,
  SUBJECT_NOTE_STATUSES,
} from '../src/routes/research_project_subject_notes.ts';
import projects from '../src/routes/research_projects.ts';
import comparisons from '../src/routes/research_project_comparisons.ts';
const SECRET = 'subject-notes-7818-synthetic-test-key';
function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,is_active) VALUES(781801,'7818-owner@example.test','Synthetic owner','founder',1),(781802,'7818-other@example.test','Synthetic other','founder',1);
 INSERT INTO research_projects(id,uid,owner_user_id,title,question,created_by) VALUES(781801,'notes-project',781801,'Synthetic project','Synthetic question?',781801);
 INSERT INTO research_project_subjects(id,project_id,owner_user_id,kind,directory_uid,name,created_by) VALUES(781801,781801,781801,'company','company-7818','Synthetic company',781801),(781802,781801,781801,'fund','fund-7818','Synthetic fund',781801); PRAGMA foreign_keys=ON;`);
  const app = new Hono()
    .route(mount.path, router)
    .route(mount.path, comparisons)
    .route(mount.path, projects);
  app.onError((e, c) =>
    c.json(
      { detail: e.message === 'Unauthorized' ? 'Unauthorized' : 'Unavailable' },
      e.message === 'Unauthorized' ? 401 : 500,
    ),
  );
  return {
    db,
    app,
    env: {
      DB: d1Over(db),
      JWT_SECRET: SECRET,
      ENVIRONMENT: 'development',
    } as any,
  };
}
async function call(
  f: ReturnType<typeof fixture>,
  method: string,
  suffix = '',
  body?: any,
  who: number | null = 781801,
  support = false,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (who)
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, ...(support ? { impersonated_by: 781802 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  const r = await f.app.request(
    `/api/research/projects/notes-project/subject-notes${suffix}`,
    {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    f.env,
  );
  return { status: r.status, body: (await r.json()) as any };
}
test('both kinds persist, notes are keyed by kind/uid, and receipts never contain text', async () => {
  const f = fixture();
  try {
    for (const [kind, uid] of [
      ['company', 'company-7818'],
      ['fund', 'fund-7818'],
    ]) {
      const result = await call(f, 'PUT', `/${kind}/${uid}`, {
        expected_revision: 0,
        rationale: 'PRIVATE_REASON',
        private_note: 'PRIVATE_NOTE',
        status: 'shortlisted',
        next_action: 'PRIVATE_ACTION',
        due_day: '2026-12-02',
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.item.revision, 1);
    }
    const read = await call(f, 'GET');
    assert.equal(read.status, 200);
    assert.equal(
      read.body.notes.company['company-7818'].private_note,
      'PRIVATE_NOTE',
    );
    assert.equal(read.body.notes.fund['fund-7818'].due_day, '2026-12-02');
    const receipts = f.db
      .prepare(
        `SELECT * FROM activity_logs WHERE action='research_project_subject_notes_saved'`,
      )
      .all();
    assert.equal(receipts.length, 2);
    assert.doesNotMatch(JSON.stringify(receipts), /PRIVATE_/);
    assert.equal(
      (
        await call(f, 'PUT', '/company/company-7818', {
          expected_revision: 1,
          next_action: 'Changed',
        })
      ).status,
      200,
    );
    assert.equal(
      (await call(f, 'GET')).body.notes.company['company-7818'].rationale,
      'PRIVATE_REASON',
    );
  } finally {
    f.db.close();
  }
});
test('stale/new-copy collisions write neither note nor receipt; invalid status/date/length are refused', async () => {
  const f = fixture();
  try {
    const path = '/company/company-7818';
    assert.equal(
      (await call(f, 'PUT', path, { expected_revision: 0 })).status,
      200,
    );
    const before = JSON.stringify(
      f.db.prepare('SELECT * FROM research_project_subject_notes').all(),
    );
    for (const expected_revision of [0, 2])
      assert.equal(
        (
          await call(f, 'PUT', path, {
            expected_revision,
            private_note: 'Must not save',
          })
        ).status,
        409,
      );
    assert.equal(
      JSON.stringify(
        f.db.prepare('SELECT * FROM research_project_subject_notes').all(),
      ),
      before,
    );
    assert.equal(
      f.db
        .prepare(
          `SELECT COUNT(*) n FROM activity_logs WHERE action='research_project_subject_notes_saved'`,
        )
        .get()!.n,
      1,
    );
    for (const body of [
      { status: 'reviewed' },
      { due_day: '2026-02-30' },
      { private_note: 'x'.repeat(10001) },
      { due_day: 'bad' },
    ])
      assert.equal(
        (await call(f, 'PUT', path, { expected_revision: 1, ...body })).status,
        400,
      );
    assert.ok(SUBJECT_NOTE_STATUSES.every((s) => !s.includes('review')));
  } finally {
    f.db.close();
  }
});
test('other owners and unauthenticated callers cannot read/write; archives and support sessions refuse writes', async () => {
  const f = fixture();
  try {
    for (const method of ['GET', 'PUT']) {
      const path = method === 'PUT' ? '/company/company-7818' : '';
      assert.equal(
        (
          await call(
            f,
            method,
            path,
            method === 'PUT' ? { expected_revision: 0 } : undefined,
            781802,
          )
        ).status,
        404,
      );
      assert.equal((await call(f, method, path, undefined, null)).status, 401);
    }
    assert.equal(
      (
        await call(
          f,
          'PUT',
          '/company/company-7818',
          { expected_revision: 0 },
          781801,
          true,
        )
      ).status,
      403,
    );
    f.db.exec(
      `UPDATE research_projects SET status='archived',archived_at=datetime('now') WHERE uid='notes-project'`,
    );
    assert.equal(
      (await call(f, 'PUT', '/company/company-7818', { expected_revision: 0 }))
        .status,
      409,
    );
    assert.equal((await call(f, 'GET')).status, 200);
    assert.equal(
      f.db
        .prepare('SELECT COUNT(*) n FROM research_project_subject_notes')
        .get()!.n,
      0,
    );
  } finally {
    f.db.close();
  }
});
test('subject removal cascades its note; routing stays within subject-notes and the route alone reads its table', async () => {
  const f = fixture();
  try {
    await call(f, 'PUT', '/fund/fund-7818', {
      expected_revision: 0,
      private_note: 'Private',
    });
    // A study alternative has no ownership of the note. Its saved UID survives subject deletion.
    f.db.exec(
      `CREATE TABLE synthetic_study_alternative(uid TEXT, directory_uid TEXT); INSERT INTO synthetic_study_alternative VALUES('alt','fund-7818'); DELETE FROM research_project_subjects WHERE id=781802;`,
    );
    assert.equal(
      f.db
        .prepare('SELECT COUNT(*) n FROM research_project_subject_notes')
        .get()!.n,
      0,
    );
    assert.equal(
      f.db.prepare('SELECT COUNT(*) n FROM synthetic_study_alternative').get()!
        .n,
      1,
    );
    assert.equal('before' in mount, false);
    assert.ok(router.routes.length > 0);
    assert.ok(
      router.routes.every((r) => r.path.startsWith('/:uid/subject-notes')),
    );
    const src = readFileSync(
      new URL(
        '../src/routes/research_project_subject_notes.ts',
        import.meta.url,
      ),
      'utf8',
    );
    assert.doesNotMatch(src, /research_(?:company|fund)_directory/);
    // Ignore only the generated routing label/import, never SQL in the registry.
    const references: string[] = [];
    function scan(dir: string) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) scan(p);
        else if (
          /\.ts$/.test(p) &&
          /\bresearch_project_subject_notes\b/.test(
            readFileSync(p, 'utf8')
              .replace(
                /file: ['"]research_project_subject_notes['"]/g,
                p.endsWith('/routes/_registry.ts') ? 'file: \"\"' : '$&',
              )
              .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|^import .*$/gm, ''),
          )
        )
          references.push(p);
      }
    }
    scan(resolve(import.meta.dirname, '../src'));
    assert.deepEqual(
      references.map((p) => p.split('/').at(-1)),
      ['research_project_subject_notes.ts'],
    );
    // No study router is on this main revision; assert later static/study mounts keep their own handlers.
    const coexist = new Hono().route(mount.path, router).route(
      mount.path,
      new Hono()
        .get('/with-study', (c) => c.text('study-create'))
        .get('/:uid/study', (c) => c.text('study')),
    );
    assert.equal(
      await (await coexist.request('/api/research/projects/with-study')).text(),
      'study-create',
    );
    assert.equal(
      await (
        await coexist.request('/api/research/projects/notes-project/study')
      ).text(),
      'study',
    );
  } finally {
    f.db.close();
  }
});
