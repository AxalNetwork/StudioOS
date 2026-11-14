/**
 * Founder onboarding → project projection.
 *
 * The bug this closes: `onboarding_progress.data` was written on every wizard
 * step and read back by exactly one consumer — the wizard rehydrating itself.
 * Once `completed_at` landed, the answers were unreachable, and the next
 * surface asked for problem / solution / why-now again as empty textareas.
 *
 * The two properties worth defending are (a) the answers actually reach
 * `projects`, and (b) they never overwrite anything a founder has since
 * edited, because onboarding is the weakest source of truth in the system.
 *
 * Run with:  node --experimental-strip-types --test cloudflare-worker/test/onboardingProjection.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSeedFromOnboarding, applyFounderOnboarding } from '../src/services/onboardingProjection';

const ANSWERS = {
  full_name: 'Jane Doe',
  linkedin: 'https://linkedin.com/in/jane',
  journey: 'pre_incorp',
  company_name: 'Acme AI',
  tagline: 'Agents for freight brokers',
  stage: 'Prototype',
  problem: 'Brokers reconcile load documents by hand.',
  solution: 'An agent that reads the documents and books the load.',
  why_now: 'Document models finally clear the accuracy bar.',
  primary_need: 'Capital',
  notes: 'Two technical co-founders.',
};

const FOUNDER = { id: 9, role: 'founder', founder_id: 4, email: 'jane@acme.ai', name: 'Jane Doe' } as any;

// --- the mapping -----------------------------------------------------------

test('maps the wizard answers onto project columns', () => {
  assert.deepEqual(projectSeedFromOnboarding(ANSWERS), {
    name: 'Acme AI',
    tagline: 'Agents for freight brokers',
    problem_statement: 'Brokers reconcile load documents by hand.',
    solution: 'An agent that reads the documents and books the load.',
    why_now: 'Document models finally clear the accuracy bar.',
  });
});

test('the three duplicated questions are the point — they must all map', () => {
  const seed = projectSeedFromOnboarding(ANSWERS)!;
  for (const col of ['problem_statement', 'solution', 'why_now'] as const) {
    assert.ok(seed[col], `${col} must carry across`);
  }
});

test('stage is deliberately not projected', () => {
  // Idea/Prototype/MVP/Revenue/Scaling exists nowhere else in the repo, and
  // `stage` is admin/partner-only on PUT /projects/:id. Mapping it would mean
  // inventing a vocabulary and contradicting the product rule.
  const seed = projectSeedFromOnboarding(ANSWERS) as Record<string, unknown>;
  assert.equal('stage' in seed, false);
  assert.equal(Object.values(seed).includes('Prototype'), false);
});

test('answers with no column stay out of the seed', () => {
  const seed = projectSeedFromOnboarding(ANSWERS) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(seed).sort(),
    ['name', 'problem_statement', 'solution', 'tagline', 'why_now'],
  );
  for (const orphan of ['Jane Doe', 'pre_incorp', 'Capital', 'Two technical co-founders.']) {
    assert.equal(Object.values(seed).includes(orphan), false, `${orphan} has no column`);
  }
});

test('values are trimmed and blanks become null', () => {
  const seed = projectSeedFromOnboarding({
    company_name: '  Acme AI  ', tagline: '   ', problem: '\n', solution: '', why_now: ' x ',
  })!;
  assert.equal(seed.name, 'Acme AI');
  assert.equal(seed.tagline, null);
  assert.equal(seed.problem_statement, null);
  assert.equal(seed.solution, null);
  assert.equal(seed.why_now, 'x');
});

test('no company name means nothing to write — projects.name is NOT NULL', () => {
  assert.equal(projectSeedFromOnboarding({ ...ANSWERS, company_name: undefined }), null);
  assert.equal(projectSeedFromOnboarding({ ...ANSWERS, company_name: '   ' }), null);
  assert.equal(projectSeedFromOnboarding({ ...ANSWERS, company_name: null }), null);
});

test('non-object payloads are tolerated, not thrown on', () => {
  for (const bad of [null, undefined, 'string', 42, [], [ANSWERS]]) {
    assert.equal(projectSeedFromOnboarding(bad as any), null, `input: ${JSON.stringify(bad)}`);
  }
});

// --- the write -------------------------------------------------------------

type Scenario = {
  stored?: string | null;
  project?: Record<string, unknown> | null;
  failOn?: RegExp;
  noTaglineColumn?: boolean;
};

/** D1 double. Matches statements by distinctive fragment, records writes. */
function fakeEnv(s: Scenario) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const guard = (sql: string) => {
    if (s.failOn?.test(sql)) throw new Error('D1 exploded');
    if (s.noTaglineColumn && /INSERT INTO projects/.test(sql) && /tagline/.test(sql)) {
      throw new Error('no such column: tagline');
    }
  };
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first() {
                guard(sql);
                if (/FROM onboarding_progress/.test(sql)) {
                  return s.stored === undefined ? { data: JSON.stringify(ANSWERS) } : { data: s.stored };
                }
                if (/FROM projects/.test(sql)) return s.project ?? null;
                if (/INSERT INTO projects/.test(sql)) { writes.push({ sql, args }); return { id: 77 }; }
                if (/INSERT INTO founders/.test(sql)) return { id: 4 };
                return null;
              },
              async run() { guard(sql); writes.push({ sql, args }); return { success: true }; },
              async all() { guard(sql); return { results: [] }; },
            };
          },
        };
      },
    },
  } as any;
  return { env, writes };
}

test('creates the project when the founder has none', async () => {
  const { env, writes } = fakeEnv({ project: null });
  const out = await applyFounderOnboarding(env, FOUNDER);
  assert.equal(out.status, 'created');
  assert.equal((out as any).projectId, 77);

  const insert = writes.find((w) => /INSERT INTO projects/.test(w.sql))!;
  assert.ok(insert, 'a project must be inserted');
  assert.match(insert.sql, /problem_statement/);
  assert.deepEqual(insert.args, [
    'Acme AI',
    'Agents for freight brokers',
    'Brokers reconcile load documents by hand.',
    'An agent that reads the documents and books the load.',
    'Document models finally clear the accuracy bar.',
    4, // founder_id — ownership, not the acting user id
  ]);
});

test('the created project is owned by the founder profile, not the user row', async () => {
  const { env, writes } = fakeEnv({ project: null });
  await applyFounderOnboarding(env, { ...FOUNDER, id: 9, founder_id: 4 });
  const insert = writes.find((w) => /INSERT INTO projects/.test(w.sql))!;
  assert.equal(insert.args.at(-1), 4);
  assert.equal(insert.args.includes(9), false, 'user id must not be used as founder_id');
});

test('fills only the blank columns of an existing project', async () => {
  const { env, writes } = fakeEnv({
    project: {
      id: 12,
      tagline: 'Founder wrote this later',
      problem_statement: null,
      solution: '   ',
      why_now: '',
    },
  });
  const out = await applyFounderOnboarding(env, FOUNDER);
  assert.equal(out.status, 'filled');
  assert.deepEqual((out as any).fields, ['problem_statement', 'solution', 'why_now']);

  const update = writes.find((w) => /UPDATE projects/.test(w.sql))!;
  assert.doesNotMatch(update.sql, /tagline/, 'a non-blank column must be left alone');
  assert.equal(update.args.includes('Founder wrote this later'), false);
  assert.equal(update.args.at(-1), 12);
});

test('never clobbers answers a founder has since edited', async () => {
  const edited = {
    id: 12,
    tagline: 'edited tagline',
    problem_statement: 'edited problem',
    solution: 'edited solution',
    why_now: 'edited why now',
  };
  const { env, writes } = fakeEnv({ project: edited });
  const out = await applyFounderOnboarding(env, FOUNDER);
  assert.equal(out.status, 'noop');
  assert.equal(writes.some((w) => /UPDATE projects/.test(w.sql)), false, 'no write at all');
});

test('re-running after a full fill is a noop, so /complete stays idempotent', async () => {
  const filled = {
    id: 12,
    tagline: ANSWERS.tagline,
    problem_statement: ANSWERS.problem,
    solution: ANSWERS.solution,
    why_now: ANSWERS.why_now,
  };
  const { env, writes } = fakeEnv({ project: filled });
  assert.equal((await applyFounderOnboarding(env, FOUNDER)).status, 'noop');
  assert.equal(writes.length, 0);
});

test('targets the oldest project — the one the Lab shows', async () => {
  const { env } = fakeEnv({ project: { id: 3, problem_statement: null } });
  let seen = '';
  const orig = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql: string) => { if (/FROM projects/.test(sql)) seen = sql; return orig(sql); };
  await applyFounderOnboarding(env, FOUNDER);
  // pickLabProject in SpinoutLabStartupPage.jsx ranks own-founder first, then
  // oldest. Filling a different row than the founder sees would look like the
  // answers vanished all over again.
  assert.match(seen, /ORDER BY created_at ASC/);
  assert.match(seen, /deleted_at IS NULL/);
  assert.match(seen, /founder_id = \?/);
});

test('a non-founder is skipped outright', async () => {
  for (const role of ['investor', 'partner', 'admin', 'exploring']) {
    const { env, writes } = fakeEnv({ project: null });
    const out = await applyFounderOnboarding(env, { ...FOUNDER, role });
    assert.equal(out.status, 'skipped', `role: ${role}`);
    assert.equal(writes.length, 0);
  }
});

test('missing, empty or malformed stored answers are skipped, not fatal', async () => {
  for (const stored of [null, '', '   ', '{oops', 'null', '"a string"', '[1,2]']) {
    const { env, writes } = fakeEnv({ stored, project: null });
    const out = await applyFounderOnboarding(env, FOUNDER);
    assert.equal(out.status, 'skipped', `stored: ${JSON.stringify(stored)}`);
    assert.equal(writes.length, 0);
  }
});

test('a founder with no profile row and no email is skipped', async () => {
  // ensureRoleProfile cannot mint a founders row without an email, so there is
  // no founder_id to own the project.
  const { env, writes } = fakeEnv({ project: null });
  const out = await applyFounderOnboarding(env, { ...FOUNDER, founder_id: null, email: '' });
  assert.equal(out.status, 'skipped');
  assert.equal((out as any).reason, 'no founder profile');
  assert.equal(writes.some((w) => /INSERT INTO projects/.test(w.sql)), false);
});

test('a DB failure returns an outcome instead of throwing', async () => {
  // The caller is POST /onboarding/complete — a founder must never be trapped
  // in the wizard because a projection failed.
  const { env } = fakeEnv({ project: null, failOn: /INSERT INTO projects/ });
  const out = await applyFounderOnboarding(env, FOUNDER);
  assert.equal(out.status, 'error');
  assert.match((out as any).reason, /exploded/);
});

test('a DB failure reading the answers is also non-fatal', async () => {
  const { env } = fakeEnv({ failOn: /FROM onboarding_progress/ });
  const out = await applyFounderOnboarding(env, FOUNDER);
  assert.equal(out.status, 'error');
});

test('a dev DB missing projects.tagline still gets the three questions', async () => {
  // tagline arrived in migration 069. Without the retry, one missing column
  // would lose problem/solution/why_now — the whole point of the projection.
  const { env, writes } = fakeEnv({ project: null, noTaglineColumn: true });
  const out = await applyFounderOnboarding(env, FOUNDER);
  assert.equal(out.status, 'created');

  const insert = writes.find((w) => /INSERT INTO projects/.test(w.sql))!;
  assert.doesNotMatch(insert.sql, /tagline/);
  assert.match(insert.sql, /problem_statement/);
  assert.match(insert.sql, /solution/);
  assert.match(insert.sql, /why_now/);
  assert.equal(insert.args.includes('Agents for freight brokers'), false);
});

test('a non-column error does not trigger the tagline retry', async () => {
  // Retrying a genuine failure (constraint, disk, timeout) would write twice.
  const { env, writes } = fakeEnv({ project: null, failOn: /INSERT INTO projects/ });
  const out = await applyFounderOnboarding(env, FOUNDER);
  assert.equal(out.status, 'error');
  assert.equal(writes.filter((w) => /INSERT INTO projects/.test(w.sql)).length, 0);
});
