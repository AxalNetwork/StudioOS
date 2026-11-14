/**
 * D782 (#2114): GitHub feeds Build › Solution design.
 *
 * - The file and byte caps: at most 40 Markdown files and 200 KB per
 *   repository, newest first when the caps bite.
 * - An ADR file is one proposal; a README or docs section headed
 *   Architecture, Design or Decisions is one; nothing else is.
 * - Accept writes one note citing the file, and its ledger row; Dismiss
 *   writes nothing, and a re-sync of the same text does not bring it back.
 *   Changed text proposes again.
 * - The stack (languages by bytes, topics) is written as facts, through the
 *   ledger, and read back as Built with.
 *
 * Real SQL on node:sqlite and real JWT routes; GitHub is stubbed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/github_solution_design_d782.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import integrations from '../src/routes/integrations.ts';
import { syncGithub } from '../src/integrations/providers/github.ts';
import {
  MAX_DESIGN_BYTES, MAX_DESIGN_FILES, chooseDesignFiles, designProposals, firstParagraph, headingAnchor, safeGithubUrl, syncSolutionDesign,
} from '../src/integrations/providers/github/solutionDesign.ts';
import { syncArrivals, syncArrivalsText } from '../src/integrations/githubFeeds.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { addMvpStores } from './_github_mvp_stores.mjs';

const JWT_SECRET = 'x'.repeat(64); // synthetic test fixture
const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); }, m };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, incorporation_meta TEXT, cofounder_decision_meta TEXT, deleted_at TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT, external_account_id TEXT, external_account_name TEXT,
      last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER DEFAULT 1);
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE mvp_features(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, added_value TEXT DEFAULT 'High', effort TEXT DEFAULT 'M', delivery_status TEXT DEFAULT 'Backlog', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pain_groups(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT);
    CREATE TABLE hypotheses(id INTEGER PRIMARY KEY, project_id INTEGER, claim TEXT);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, kanban_status TEXT, sort_order INTEGER DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE okr_column_moves(id INTEGER PRIMARY KEY, project_id INTEGER, okr_id INTEGER, to_status TEXT, moved_at TEXT);
    CREATE TABLE cap_table_holders(id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, name TEXT, shares REAL, ownership_pct REAL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_vesting(id INTEGER PRIMARY KEY, user_id INTEGER, holder_id INTEGER, start_date TEXT, cliff_months INTEGER, total_months INTEGER, vested_shares REAL);
    CREATE TABLE documents(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, template_name TEXT, created_at TEXT);
    CREATE TABLE cofounder_agreement_parties(id INTEGER PRIMARY KEY, document_id INTEGER, user_id INTEGER);
    CREATE TABLE entity_obligations(id INTEGER PRIMARY KEY, entity_id INTEGER, title TEXT, due_date TEXT, status TEXT, kind TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE entities(id INTEGER PRIMARY KEY, jurisdiction TEXT);
    CREATE TABLE incorporations(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, paid_at TEXT, packet_ready_at TEXT, filed_on TEXT, jurisdiction_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_scenarios(id INTEGER PRIMARY KEY, project_id INTEGER, is_variant INTEGER DEFAULT 0, inputs_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE spinout_applications(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, answers_json TEXT);
    CREATE TABLE ritual_runs(id INTEGER PRIMARY KEY, project_id INTEGER, run_date TEXT, state TEXT);
    CREATE TABLE google_oauth_tokens(user_id INTEGER PRIMARY KEY);
    CREATE TABLE microsoft_oauth_tokens(user_id INTEGER PRIMARY KEY);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, founder_id, name, email) VALUES (1, 'founder', 11, 'One', 'one@example.test'), (2, 'founder', 22, 'Two', 'two@example.test'), (4, 'partner', NULL, 'Partner', 'partner@example.test');
    INSERT INTO company_profiles VALUES (10), (20);
    INSERT INTO projects(id, founder_id, company_id) VALUES (101, 11, 10), (202, 22, 20);
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);
  `);
  for (const m of ['441_build_cycle_stores.sql', '445_connector_fed_items.sql', '455_core_systems_workspace.sql', '459_cycle_activity_convention.sql', '461_build_record_stores.sql', '500_github_solution_design.sql']) db.exec(mig(m));
  addMvpStores(db);
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type, config_json)
      VALUES (31, 'gh-one', 1, 'github', 'active', 'oauth2', '${JSON.stringify({ repositories: ['acme/app'], project_id: 101 })}');
    INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (31, 10, 1);`);
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4), RATE_LIMITS: kv() } as any;
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;
  return { db, env, one };
}

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/build', build);
  a.route('/api/connectors', integrations);
  a.onError((e, c) => c.json({ error: e.message }, 500));
  return a;
})();
async function call(env: any, path: string, id = 1, method = 'GET') {
  const token = await new SignJWT({ user_id: id, role: id === 4 ? 'partner' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(path, { method, headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': id === 2 ? '20' : '10', 'Content-Type': 'application/json' } }, env);
  return { status: r.status, body: await r.json() as any };
}
const fromCode = async (env: any, project = 101, id = 1) => (await call(env, `/api/cycles/build/modules/solution-design?project=${project}`, id)).body.parts.from_code;
const decide = (env: any, id: number, how: 'accept' | 'dismiss', user = 1, project = 101) =>
  call(env, `/api/cycles/build/solution-design/proposals/${id}/${how}?project=${project}`, user, 'POST');

// ───────────────────────────────────────────── a stubbed GitHub

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
type Repo = { languages?: Record<string, number>; topics?: string[]; readme?: string | null; files?: Record<string, { text: string; date?: string; size?: number }> };

/**
 * A repository as GitHub's REST API answers it: `/repos/{o}/{r}`, its
 * languages, its README, each directory's listing, a file's contents and its
 * newest commit. Anything else is 404. `calls` is every path asked for.
 */
function fakeRepo(name: string, repo: Repo) {
  const calls: string[] = [];
  const base = `/repos/${name}`;
  const files = repo.files ?? {};
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const get = async (path: string) => {
    calls.push(path);
    const u = new URL(`https://api.github.com${path}`);
    const p = decodeURIComponent(u.pathname);
    if (p === base) return res({ full_name: name, topics: repo.topics ?? [] });
    if (p === `${base}/languages`) return res(repo.languages ?? {});
    if (p === `${base}/readme`) return repo.readme == null ? res({ message: 'Not Found' }, 404)
      : res({ path: 'README.md', size: Buffer.byteLength(repo.readme), encoding: 'base64', content: b64(repo.readme), html_url: `https://github.com/${name}/blob/main/README.md` });
    if (p === `${base}/commits`) {
      const f = files[u.searchParams.get('path') ?? ''];
      return res(f?.date ? [{ commit: { committer: { date: f.date } } }] : []);
    }
    if (p.startsWith(`${base}/contents/`)) {
      const at = p.slice(`${base}/contents/`.length);
      if (files[at]) return res({ path: at, encoding: 'base64', content: b64(files[at].text) });
      const listing = Object.entries(files).filter(([fp]) => fp.slice(0, fp.lastIndexOf('/')) === at)
        .map(([fp, f]) => ({ type: 'file', path: fp, name: fp.split('/').pop(), size: f.size ?? Buffer.byteLength(f.text), html_url: `https://github.com/${name}/blob/main/${fp}` }));
      return listing.length ? res(listing) : res({ message: 'Not Found' }, 404);
    }
    return res({ message: 'Not Found' }, 404);
  };
  return { get, calls };
}

const README = `# Acme app

Acme runs plans for small teams.

## Architecture

The API is a single Worker in front of D1. Jobs run on a queue.

More detail lives in docs/.

\`\`\`md
## Design
not a heading: inside a code fence
\`\`\`

## Getting started

Run npm install.
`;
const ADR_1 = `# 1. Use D1 for the ledger

We keep one ledger table so a re-sync finds what it wrote.

## Status

Accepted.
`;
const DOC = `# Notes

## Decisions

Queues over cron for anything that retries.
`;

// ───────────────────────────────────────────── pure

test('an ADR is one proposal; only Architecture, Design and Decisions sections are, and a fenced heading is not', () => {
  // Mutation checked: drop the fence tracking → the fenced "## Design" becomes a third README proposal.
  const adr = designProposals('docs/adr/0001-ledger.md', ADR_1, true);
  assert.equal(adr.length, 1);
  assert.deepEqual([adr[0].title, adr[0].extract, adr[0].anchor], ['1. Use D1 for the ledger', 'We keep one ledger table so a re-sync finds what it wrote.', '']);
  const readme = designProposals('README.md', README, false);
  assert.deepEqual(readme.map((p) => p.title), ['Architecture']);
  assert.equal(readme[0].extract, 'The API is a single Worker in front of D1. Jobs run on a queue.', 'the section\'s own first paragraph, no model');
  assert.equal(readme[0].anchor, 'architecture');
  assert.deepEqual(designProposals('docs/notes.md', DOC, false).map((p) => p.title), ['Decisions']);
  assert.deepEqual(designProposals('docs/howto.md', '# How to\n\n## Setup\n\nText.\n', false), [], 'a file with no such section proposes nothing');
  assert.equal(headingAnchor('Design & Decisions (v2)'), 'design--decisions-v2');
  assert.equal(firstParagraph('\n\n## Heading\n\nFirst line\nsecond line\n\nNext.'), 'First line second line');
  // Mutation checked: skip only one-line comments → the hidden lines become the extract.
  assert.equal(firstParagraph('<!-- one line -->\n<!--\nhidden\nlines\n-->\nShown prose.'), 'Shown prose.', 'an HTML comment, one line or many, is not prose');
  assert.ok(firstParagraph('x '.repeat(400)).length <= 400);
});

test('the caps: every file when they fit; otherwise newest first, at most 40 files and 200 KB', () => {
  // Mutation checked: sort oldest first → the newest file is left out; drop the byte check → 210 KB are taken.
  const f = (i: number, size = 100, date: string | null = `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:${String(i % 60).padStart(2, '0')}Z`) => ({ path: `docs/${i}.md`, size, date });
  const few = [f(1), f(2)];
  assert.equal(chooseDesignFiles(few), few);
  const many = Array.from({ length: 45 }, (_, i) => f(i));
  const chosen = chooseDesignFiles(many);
  assert.equal(chosen.length, MAX_DESIGN_FILES);
  const newest = [...many].sort((a, b) => b.date!.localeCompare(a.date!)).slice(0, MAX_DESIGN_FILES);
  assert.deepEqual(chosen.map((x) => x.path), newest.map((x) => x.path));
  const big = chooseDesignFiles([f(1, 150 * 1024, '2026-03-01T00:00:00Z'), f(2, 60 * 1024, '2026-02-01T00:00:00Z'), f(3, 40 * 1024, '2026-01-01T00:00:00Z')]);
  assert.deepEqual(big.map((x) => x.path), ['docs/1.md', 'docs/3.md'], 'the newest that still fit, never over 200 KB');
  assert.ok(big.reduce((n, x) => n + x.size, 0) <= MAX_DESIGN_BYTES);
  assert.equal(chooseDesignFiles([f(1, 10, null), f(2, MAX_DESIGN_BYTES, '2026-01-01T00:00:00Z')])[0].path, 'docs/2.md', 'an undated file goes last');
});

test('a link is drawn only when it is GitHub\'s own https page', () => {
  assert.equal(safeGithubUrl('https://github.com/acme/app/blob/main/README.md#architecture'), 'https://github.com/acme/app/blob/main/README.md#architecture');
  for (const bad of ['javascript:alert(1)', 'http://github.com/acme/app', 'https://evil.example/acme', 'https://user:pw@github.com/x', null]) assert.equal(safeGithubUrl(bad), null, String(bad));
});

// ───────────────────────────────────────────── the sync

test('a sync proposes an ADR and the README\'s Architecture section, and writes the stack as facts through the ledger', async () => {
  const { env, one, db } = fixture();
  const gh = fakeRepo('acme/app', {
    languages: { TypeScript: 9000, CSS: 1000 }, topics: ['saas', 'workers'], readme: README,
    files: { 'docs/adr/0001-ledger.md': { text: ADR_1 }, 'docs/notes.md': { text: DOC }, 'docs/howto.md': { text: '# How\n\nNothing here.\n' } },
  });
  const counts = await syncSolutionDesign(env, 31, 101, gh.get, ['acme/app'], 1000);
  assert.deepEqual(counts, { design_proposals: 3, stacks: 1 });
  const rows = db.prepare('SELECT source_key, title, status, url FROM solution_design_proposals ORDER BY source_key').all() as any[];
  assert.deepEqual(rows.map((r) => [r.source_key, r.status]), [
    ['acme/app:README.md#architecture', 'pending'], ['acme/app:docs/adr/0001-ledger.md', 'pending'], ['acme/app:docs/notes.md#decisions', 'pending'],
  ]);
  assert.equal(rows[0].url, 'https://github.com/acme/app/blob/main/README.md#architecture');
  assert.equal(one("SELECT COUNT(*) AS n FROM connector_fed_items WHERE module = 'solution_design' AND kind = 'design_note'").n, 0, 'a proposal is not fed until it is accepted');
  assert.equal(one('SELECT COUNT(*) AS n FROM solution_design_notes').n, 0, 'nothing is written without Accept');
  const stack = one('SELECT * FROM solution_design_stack');
  assert.deepEqual([JSON.parse(stack.languages_json), JSON.parse(stack.topics_json)], [[{ name: 'TypeScript', bytes: 9000 }, { name: 'CSS', bytes: 1000 }], ['saas', 'workers']]);
  const ledger = one("SELECT * FROM connector_fed_items WHERE kind = 'stack'");
  assert.deepEqual([ledger.module, ledger.local_table, ledger.local_id, ledger.external_id], ['solution_design', 'solution_design_stack', stack.id, 'stack:101:acme/app']);
  assert.equal(syncArrivalsText(syncArrivals({ ...counts, issues: 0 })), '0 issues → Product roadmap, 3 architecture proposals → Solution design, 1 repository stack → Solution design');

  // A re-sync with a new language updates the stack row; it is never duplicated.
  const again = fakeRepo('acme/app', { languages: { TypeScript: 9000, Go: 5000 }, topics: ['saas'], readme: README,
    files: { 'docs/adr/0001-ledger.md': { text: ADR_1 }, 'docs/notes.md': { text: DOC } } });
  assert.deepEqual(await syncSolutionDesign(env, 31, 101, again.get, ['acme/app'], 1000), { design_proposals: 0, stacks: 1 }, 'the same text proposes nothing new');
  assert.equal(one('SELECT COUNT(*) AS n FROM solution_design_stack').n, 1);
  assert.equal(one("SELECT COUNT(*) AS n FROM connector_fed_items WHERE kind = 'stack'").n, 1);
  assert.deepEqual(JSON.parse(one('SELECT languages_json FROM solution_design_stack').languages_json).map((l: any) => l.name), ['TypeScript', 'Go']);
});

test('the sync reads no more than 40 files and 200 KB of a repository, the newest first', async () => {
  // Mutation checked: read every listed file → 45 contents reads; skip the dates → the oldest files are read.
  const { env } = fixture();
  const files: Record<string, { text: string; date: string }> = {};
  for (let i = 0; i < 45; i += 1) files[`docs/${String(i).padStart(2, '0')}.md`] = { text: `# D${i}\n\n## Design\n\nFile ${i}.\n`, date: `2026-02-${String(1 + Math.floor(i / 2)).padStart(2, '0')}T00:00:0${i % 2}Z` };
  const gh = fakeRepo('acme/app', { files });
  const counts = await syncSolutionDesign(env, 31, 101, gh.get, ['acme/app'], 1000);
  const reads = gh.calls.filter((c) => /\/contents\/docs\/\d+\.md$/.test(c));
  assert.equal(reads.length, MAX_DESIGN_FILES);
  assert.equal(counts.design_proposals, MAX_DESIGN_FILES);
  assert.ok(!reads.some((c) => /\/(00|01|02|03|04)\.md$/.test(c)), 'the five oldest are the ones left out');

  const heavy = fakeRepo('acme/app', { files: {
    'docs/a.md': { text: `## Design\n\n${'a'.repeat(150 * 1024)}\n`, date: '2026-03-03T00:00:00Z' },
    'docs/b.md': { text: `## Design\n\n${'b'.repeat(100 * 1024)}\n`, date: '2026-03-02T00:00:00Z' },
    'docs/c.md': { text: '## Design\n\nsmall\n', date: '2026-03-01T00:00:00Z' },
  } });
  await syncSolutionDesign(env, 31, 202, heavy.get, ['acme/app'], 1000);
  assert.deepEqual(heavy.calls.filter((c) => /\/contents\/docs\/[abc]\.md$/.test(c)).map((c) => c.slice(-4)), ['a.md', 'c.md'], 'b would pass 200 KB');

  // A listing that understates its sizes: what is read is what counts against the cap.
  const fresh = fixture();
  const fibbing = fakeRepo('acme/app', { files: {
    'docs/x.md': { text: `## Design\n\n${'x'.repeat(150 * 1024)}\n`, size: 1024 },
    'docs/y.md': { text: `## Design\n\n${'y'.repeat(100 * 1024)}\n`, size: 1024 },
  } });
  await syncSolutionDesign(fresh.env, 31, 101, fibbing.get, ['acme/app'], 1000);
  assert.deepEqual(fresh.db.prepare('SELECT path FROM solution_design_proposals').all().map((r: any) => r.path), ['docs/x.md'], 'y would pass 200 KB read');
});

test('a sync stops inside its budget and says so', async () => {
  const { env } = fixture();
  const gh = fakeRepo('acme/app', { readme: README });
  const counts = await syncSolutionDesign(env, 31, 101, gh.get, ['acme/app', 'acme/two'], 12);
  assert.equal(counts.partial, true);
  assert.equal(counts.stacks, 1, 'the first repository was read; the second did not fit');
  assert.ok(!gh.calls.some((c) => c.startsWith('/repos/acme/two')));
});

// ───────────────────────────────────────────── Accept and Dismiss

async function synced() {
  const f = fixture();
  const gh = fakeRepo('acme/app', { languages: { TypeScript: 3 }, readme: README, files: { 'docs/adr/0001-ledger.md': { text: ADR_1 } } });
  await syncSolutionDesign(f.env, 31, 101, gh.get, ['acme/app'], 1000);
  const id = (key: string) => (f.one('SELECT id FROM solution_design_proposals WHERE source_key = ?', key) as any).id as number;
  return { ...f, adr: id('acme/app:docs/adr/0001-ledger.md'), arch: id('acme/app:README.md#architecture') };
}

test('Accept writes one note citing the file, and its ledger row; the fed count counts it with the stack', async () => {
  // Mutation checked: skip the ledger row → fed counts 1; accept twice → a second note.
  const { env, one, adr } = await synced();
  const r = await decide(env, adr, 'accept');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const note = one('SELECT * FROM solution_design_notes');
  assert.deepEqual([note.project_id, note.title, note.body, note.source_path, note.source_url], [101, '1. Use D1 for the ledger',
    'We keep one ledger table so a re-sync finds what it wrote.', 'acme/app/docs/adr/0001-ledger.md', 'https://github.com/acme/app/blob/main/docs/adr/0001-ledger.md']);
  const ledger = one("SELECT * FROM connector_fed_items WHERE kind = 'design_note'");
  assert.deepEqual([ledger.module, ledger.local_table, ledger.local_id, ledger.project_id], ['solution_design', 'solution_design_notes', note.id, 101]);
  assert.equal(one('SELECT note_id FROM solution_design_proposals WHERE id = ?', adr).note_id, note.id);
  assert.equal(one("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'build_design_note_accepted' AND entity_type = 'build.solution-design'").n, 1);
  assert.equal((await decide(env, adr, 'accept')).status, 409, 'a decided proposal is not accepted twice');
  assert.equal((await decide(env, adr, 'dismiss')).status, 409, 'nor dismissed once accepted');
  assert.equal(one('SELECT status FROM solution_design_proposals WHERE id = ?', adr).status, 'accepted');
  assert.equal(one('SELECT COUNT(*) AS n FROM solution_design_notes').n, 1);
  const fed = await call(env, '/api/connectors/gh-one/fed');
  const sd = fed.body.modules.find((m: any) => m.module === 'solution_design');
  assert.deepEqual([sd.count, sd.linked, sd.label, sd.href], [2, 2, 'Solution design', '/build/solution-design'], 'one accepted note and one stack');
});

test('Dismiss writes nothing, and a re-sync of the same text does not bring it back; changed text does', async () => {
  // Mutation checked: re-propose whenever a source is seen → the dismissed section returns unchanged.
  const { env, one, arch } = await synced();
  assert.equal((await decide(env, arch, 'dismiss')).status, 200);
  assert.equal(one('SELECT status FROM solution_design_proposals WHERE id = ?', arch).status, 'dismissed');
  assert.equal(one('SELECT COUNT(*) AS n FROM solution_design_notes').n, 0);
  assert.equal(one("SELECT COUNT(*) AS n FROM connector_fed_items WHERE kind = 'design_note'").n, 0);
  const same = fakeRepo('acme/app', { readme: README, files: { 'docs/adr/0001-ledger.md': { text: ADR_1 } } });
  assert.equal((await syncSolutionDesign(env, 31, 101, same.get, ['acme/app'], 1000)).design_proposals, 0);
  assert.equal(one('SELECT status FROM solution_design_proposals WHERE id = ?', arch).status, 'dismissed', 'it stays dismissed');
  assert.ok(!(await fromCode(env)).proposals.some((p: any) => p.id === arch));
  const changed = fakeRepo('acme/app', { readme: README.replace('Jobs run on a queue.', 'Jobs run on Workflows.'), files: { 'docs/adr/0001-ledger.md': { text: ADR_1 } } });
  assert.equal((await syncSolutionDesign(env, 31, 101, changed.get, ['acme/app'], 1000)).design_proposals, 1);
  const back = one('SELECT status, extract FROM solution_design_proposals WHERE id = ?', arch);
  assert.deepEqual([back.status, back.extract], ['pending', 'The API is a single Worker in front of D1. Jobs run on Workflows.'], 'a changed file proposes again');
  assert.equal(one('SELECT COUNT(*) AS n FROM solution_design_proposals').n, 2, 'the same row, not a new one');
});

test('only the venture\'s writers decide; another founder and a partner cannot', async () => {
  const { env, one, adr } = await synced();
  assert.equal((await decide(env, adr, 'accept', 2, 202)).status, 404, 'not in their venture');
  assert.equal((await decide(env, adr, 'accept', 2)).status, 403, 'not their venture');
  assert.equal((await decide(env, adr, 'dismiss', 4)).status, 403);
  assert.equal((await decide(env, 999, 'accept')).status, 404);
  assert.equal((await call(env, '/api/cycles/build/solution-design/proposals/abc/accept?project=101', 1, 'POST')).status, 404);
  assert.equal(one("SELECT COUNT(*) AS n FROM solution_design_proposals WHERE status = 'pending'").n, 2);
});

test('Solution design reads Built with, the proposals and the notes; a failed read leaves the features readable', async () => {
  const { env, db, adr } = await synced();
  await decide(env, adr, 'accept');
  const code = await fromCode(env);
  assert.equal(code.state, 'ok');
  assert.deepEqual(code.built_with, [{ repository: 'acme/app', languages: [{ name: 'TypeScript', bytes: 3, pct: 100 }], topics: [], updated_at: code.built_with[0].updated_at, source_label: 'From GitHub' }]);
  assert.deepEqual(code.proposals.map((p: any) => p.title), ['Architecture']);
  assert.deepEqual(code.notes.map((n: any) => n.title), ['1. Use D1 for the ledger']);
  // A stack whose ledger row is gone is not shown: Built with is read through the ledger.
  db.exec("DELETE FROM connector_fed_items WHERE kind = 'stack'");
  assert.deepEqual((await fromCode(env)).built_with, []);
  db.exec('DROP TABLE solution_design_notes');
  const r = await call(env, '/api/cycles/build/modules/solution-design?project=101');
  assert.equal(r.status, 200);
  assert.equal(r.body.card.state === 'unreadable', false, 'the features and risks still read');
  assert.equal(r.body.parts.from_code.state, 'unreadable');
});

// ───────────────────────────────────────────── the hook

test('the GitHub sync runs Solution design after the issues, pull requests and releases', async () => {
  // Mutation checked: remove the one call in syncGithub → no stack and no design counts.
  const { env, db, one } = fixture();
  const enc = await encryptCredentials(env, 'gh-one', { access_token: 'ghu_fixture' });
  db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = 31').run(enc);
  const gh = fakeRepo('acme/app', { languages: { Go: 10 }, readme: README });
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const u = new URL(String(input));
    if (/\/(issues|pulls|releases|milestones)$/.test(u.pathname)) return new Response('[]', { status: 200 }); // and D782 (#2111)'s milestones
    return gh.get(`${u.pathname}${u.search}`);
  }) as any;
  try {
    const out = await syncGithub(env, one('SELECT * FROM integrations WHERE id = 31'));
    assert.equal(out.counts?.stacks, 1);
    assert.equal(out.counts?.design_proposals, 1);
  } finally { globalThis.fetch = real; }
  assert.equal(one("SELECT COUNT(*) AS n FROM connector_fed_items WHERE kind = 'stack'").n, 1);
});
