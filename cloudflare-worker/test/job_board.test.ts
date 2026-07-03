/**
 * Task #68 — Public Job Board: pure-helper unit tests.
 *
 * Locks the taxonomy/slug/serialization invariants in
 * `src/services/jobBoardCommon.ts` that the routes depend on:
 *
 *   - jobSlugify produces URL-safe slugs (lowercase, hyphenated, stripped,
 *     length-capped) with a non-empty fallback.
 *   - normalizeEmploymentType / normalizeSeniority clamp unknown input to the
 *     safe default instead of trusting caller values.
 *   - shapeJobPosting NEVER leaks applicant PII, and only exposes admin/owner
 *     operational fields under includePrivate.
 *   - shapeJobApplication derives has_resume from resume_key (never inlines the
 *     resume) and only attaches a member object once the applicant has an
 *     account.
 *   - ensureUniqueJobSlug appends -2/-3/… until the candidate is free.
 *
 * jobBoardCommon.ts's only import is `import type { Env }` (erased by the
 * strip-types loader), so it loads cleanly under `node --test`.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/job_board.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPLOYMENT_TYPES,
  SENIORITIES,
  JOB_STATUSES,
  jobSlugify,
  ensureUniqueJobSlug,
  normalizeEmploymentType,
  normalizeSeniority,
  shapeJobPosting,
  shapeJobApplication,
} from '../src/services/jobBoardCommon.ts';

test('taxonomy constants stay in the documented shape', () => {
  assert.deepEqual([...EMPLOYMENT_TYPES], ['full_time', 'part_time', 'intern', 'contract']);
  assert.deepEqual([...SENIORITIES], ['intern', 'junior', 'mid', 'senior', 'lead', 'executive']);
  assert.deepEqual([...JOB_STATUSES], ['draft', 'pending_review', 'published', 'rejected', 'closed']);
});

test('jobSlugify lowercases, hyphenates and strips unsafe characters', () => {
  assert.equal(jobSlugify('Senior Software Engineer (Remote!)'), 'senior-software-engineer-remote');
  assert.equal(jobSlugify('  Lead   Designer  '), 'lead-designer');
  assert.equal(jobSlugify('Data/ML Engineer @ Axal'), 'dataml-engineer-axal');
  assert.equal(jobSlugify('under_score me'), 'under-score-me');
  assert.equal(jobSlugify('--already--hyphened--'), 'already-hyphened');
});

test('jobSlugify caps length at 64 characters', () => {
  const long = 'a'.repeat(200);
  assert.equal(jobSlugify(long).length, 64);
});

test('jobSlugify falls back to a role- prefix for empty / symbol-only input', () => {
  assert.match(jobSlugify(''), /^role-[0-9a-f]{8}$/);
  assert.match(jobSlugify('!!!'), /^role-[0-9a-f]{8}$/);
  assert.match(jobSlugify(null as unknown as string), /^role-[0-9a-f]{8}$/);
});

test('normalizeEmploymentType clamps unknown values to full_time', () => {
  assert.equal(normalizeEmploymentType('contract'), 'contract');
  assert.equal(normalizeEmploymentType('intern'), 'intern');
  assert.equal(normalizeEmploymentType('permanent'), 'full_time');
  assert.equal(normalizeEmploymentType(undefined), 'full_time');
  assert.equal(normalizeEmploymentType(42), 'full_time');
});

test('normalizeSeniority clamps unknown values to mid', () => {
  assert.equal(normalizeSeniority('executive'), 'executive');
  assert.equal(normalizeSeniority('junior'), 'junior');
  assert.equal(normalizeSeniority('principal'), 'mid');
  assert.equal(normalizeSeniority(null), 'mid');
});

test('shapeJobPosting returns null for a missing row', () => {
  assert.equal(shapeJobPosting(null), null);
  assert.equal(shapeJobPosting(undefined), null);
});

test('shapeJobPosting coerces remote and mirrors project_name into startup_name', () => {
  const shaped = shapeJobPosting({
    id: 7, slug: 'eng', title: 'Engineer', status: 'published',
    project_name: 'Acme', remote: 1, employment_type: 'contract', seniority: 'senior',
    created_at: 't0', updated_at: 't1',
  }) as Record<string, unknown>;
  assert.equal(shaped.remote, true);
  assert.equal(shaped.startup_name, 'Acme');
  assert.equal(shaped.project_name, 'Acme');
  assert.equal(shaped.employment_type, 'contract');
  assert.equal(shaped.seniority, 'senior');

  const notRemote = shapeJobPosting({ id: 1, slug: 's', title: 'T', status: 'draft', remote: 0 }) as Record<string, unknown>;
  assert.equal(notRemote.remote, false);
});

test('shapeJobPosting hides operational fields unless includePrivate is set', () => {
  const row = {
    id: 1, slug: 's', title: 'T', status: 'pending_review',
    admin_published: 1, review_notes: 'looks good',
  };
  const publicShape = shapeJobPosting(row) as Record<string, unknown>;
  assert.equal('admin_published' in publicShape, false);
  assert.equal('review_notes' in publicShape, false);

  const privateShape = shapeJobPosting(row, { includePrivate: true }) as Record<string, unknown>;
  assert.equal(privateShape.admin_published, true);
  assert.equal(privateShape.review_notes, 'looks good');
});

test('shapeJobPosting NEVER leaks applicant PII even if present on the row', () => {
  const shaped = shapeJobPosting(
    {
      id: 1, slug: 's', title: 'T', status: 'published',
      // Adversarial: applicant PII accidentally joined onto the posting row.
      email: 'applicant@example.com',
      resume_key: 'r2/secret.pdf',
      cover_note: 'hire me',
      linkedin_url: 'https://linkedin.com/in/x',
    },
    { includePrivate: true },
  ) as Record<string, unknown>;
  for (const leak of ['email', 'resume_key', 'cover_note', 'linkedin_url', 'portfolio_url']) {
    assert.equal(leak in shaped, false, `posting projection must not expose ${leak}`);
  }
});

test('shapeJobPosting only includes application_count when the row carries it', () => {
  const withCount = shapeJobPosting({ id: 1, slug: 's', title: 'T', status: 'published', application_count: '3' }) as Record<string, unknown>;
  assert.equal(withCount.application_count, 3);
  const without = shapeJobPosting({ id: 1, slug: 's', title: 'T', status: 'published' }) as Record<string, unknown>;
  assert.equal('application_count' in without, false);
});

test('shapeJobApplication derives has_resume and never inlines the resume', () => {
  const withResume = shapeJobApplication({
    id: 5, posting_id: 2, email: 'a@b.com', resume_key: 'r2/a.pdf', resume_name: 'a.pdf', status: 'submitted', created_at: 't',
  }) as Record<string, unknown>;
  assert.equal(withResume.has_resume, true);
  assert.equal(withResume.resume_name, 'a.pdf');
  assert.equal('resume_key' in withResume, false, 'resume_key (R2 path) must not be returned');

  const noResume = shapeJobApplication({ id: 6, posting_id: 2, email: 'c@d.com', status: 'submitted', created_at: 't' }) as Record<string, unknown>;
  assert.equal(noResume.has_resume, false);
});

test('shapeJobApplication attaches member only once the applicant has an account', () => {
  const anon = shapeJobApplication({ id: 1, posting_id: 1, email: 'x@y.com', status: 'submitted', created_at: 't', user_id: null }) as Record<string, unknown>;
  assert.equal(anon.member, null);

  const member = shapeJobApplication({
    id: 2, posting_id: 1, email: 'x@y.com', status: 'submitted', created_at: 't',
    user_id: 42, member_name: 'Ada', member_email: 'ada@axal.vc', member_role: 'founder',
  }) as Record<string, unknown>;
  assert.deepEqual(member.member, { id: 42, name: 'Ada', email: 'ada@axal.vc', role: 'founder' });
});

test('ensureUniqueJobSlug appends a numeric suffix until the slug is free', async () => {
  const makeEnv = (taken: Set<string>) => ({
    DB: {
      prepare(_sql: string) {
        const state: { args: unknown[] } = { args: [] };
        return {
          bind(...args: unknown[]) { state.args = args; return this; },
          async first() {
            const candidate = String(state.args[0]);
            return taken.has(candidate) ? { id: 1 } : null;
          },
        };
      },
    },
  }) as any;

  assert.equal(await ensureUniqueJobSlug(makeEnv(new Set()), 'Engineer'), 'engineer');
  assert.equal(await ensureUniqueJobSlug(makeEnv(new Set(['engineer'])), 'Engineer'), 'engineer-2');
  assert.equal(await ensureUniqueJobSlug(makeEnv(new Set(['engineer', 'engineer-2'])), 'Engineer'), 'engineer-3');
});
