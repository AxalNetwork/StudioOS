/**
 * D6888 (#6888): Eadwyn's covering-note proposal for the shareable statement (D6217 PF-13a, PF-13h).
 *
 *   - `statementDate`: only a completed quarter-end is a statement date;
 *   - `statementCoverMaterial`: page 1 (summary, coverage, at cost) and page 2 (Funded after) for the date, in the
 *     sheet's own formats, and nothing else; a failed read or a date with no book is [];
 *   - the route, executed: `POST /api/research/drafts` with surface `portfolio/statement` reads the statement's own
 *     two reads for the date, hands the model only figures those reads carry, keeps nothing, refuses before the model
 *     when there is nothing to cover, and answers `assist_off` when Eadwyn is switched off on the page;
 *   - the option runs the numbers job D6212's notes run.
 *
 * Synthetic records only; Workers AI is a stub that keeps its prompt. No test reads the real clock: the builder's
 * dates are passed in, and the route's requests run with the Worker's clock pinned (`NOW`).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/statement_cover_note_d6888.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';
import {
  STATEMENT_COVER_INSTRUCTION, STATEMENT_COVER_SURFACE, day, fundedAfter, money, multiple, rate,
  statementCoverMaterial, statementDate,
} from '../src/services/statementCoverNote.ts';
import { railOptionJob } from '../src/services/ai/textJobs.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { withGuard } from './_guard_stub.mjs';

// ------------------------------------------------------------------ the date

test('a statement date is a completed quarter-end: before the Worker\'s date, never on it', () => {
  assert.equal(statementDate('2026-09-30', '2026-11-16'), '2026-09-30');
  assert.equal(statementDate('2025-12-31', '2026-11-16'), '2025-12-31');
  assert.equal(statementDate('2026-09-30', '2026-09-30'), null, 'a quarter is not complete on its last day');
  assert.equal(statementDate('2026-12-31', '2026-11-16'), null, 'a quarter-end still to come');
  assert.equal(statementDate('2026-08-31', '2026-11-16'), null, 'not a quarter-end');
  assert.equal(statementDate('2026-09-30T00:00:00Z', '2026-11-16'), null);
  assert.equal(statementDate('', '2026-11-16'), null);
  assert.equal(statementDate(null, '2026-11-16'), null);
});

// ------------------------------------------------------------------ the material

/** The two reads' bodies for 30 Sep 2026, in the shapes `routes/positions.ts` answers. */
const ANALYTICS = {
  as_of: '2026-09-30', paid_in: 7000000, distributed: 0, nav: 11100000, total_value: 11100000,
  tvpi: 1.5857, dpi: 0, rvpi: 1.5857, irr: 0.213,
  returns: {
    tvpi: { state: 'ok', value: 1.5857 }, dpi: { state: 'ok', value: 0 }, rvpi: { state: 'ok', value: 1.5857 },
    irr: { state: 'ok', value: 0.213 },
  },
  position_count: 8, unmarked_position_count: 3, unusable_mark_count: 1, mark_coverage: 0.63,
};
const POSITIONS = {
  items: [
    { project_id: 1, project: { name: 'Northwind' }, total_invested: 2000000, rounds: 2, latest_date: '2025-06-01', vintage: 2024 },
    { project_id: 9, project: { name: 'Halcyon' }, total_invested: 750000, rounds: 1, latest_date: '2026-10-12', vintage: 2026 },
    { project_id: 4, project: { name: 'Larkspur' }, total_invested: 400000, rounds: 1, latest_date: '2026-03-02', vintage: 2026 },
    // A follow-on after the date on a company first funded before it: held at the date, so not Funded after.
    { project_id: 5, project: { name: 'Corvid' }, total_invested: 900000, rounds: 2, latest_date: '2026-10-20', vintage: 2025 },
  ],
};

test('page 1 and page 2 for the date, each line naming its page, in the sheet\'s formats', () => {
  const lines = statementCoverMaterial('2026-09-30', ANALYTICS, POSITIONS);
  assert.equal(lines[0], 'Statement as of 30 Sep 2026 (2026-09-30). Every figure is gross of fees and carry; net returns are Not recorded.');
  assert.ok(lines.includes('Page 1, summary: NAV as of 30 Sep 2026: $11,100,000.'));
  assert.ok(lines.includes('Page 1, summary: Paid-in to 30 Sep 2026: $7,000,000.'));
  assert.ok(lines.includes('Page 1, summary: Distributed to 30 Sep 2026: $0.'));
  assert.ok(lines.includes('Page 1, summary: TVPI as of 30 Sep 2026: 1.59×.'));
  assert.ok(lines.includes('Page 1, summary: IRR to 30 Sep 2026: 21.3%.'));
  assert.ok(lines.includes('Page 1, coverage: 5 of 8 positions held at 30 Sep 2026 carry a usable recorded mark.'));
  assert.ok(lines.includes('Page 1, at cost: 3 positions are carried at cost (2 with no mark, 1 whose recorded mark cannot be used). A position at cost has not been revalued.'));
  // Halcyon's only cheque is after the date; Northwind, Larkspur and Corvid (a later follow-on) are held at it.
  assert.deepEqual(lines.filter((l) => l.startsWith('Page 2')),
    ['Page 2, Funded after 30 Sep 2026: Halcyon, $750,000 invested. The page 1 summary does not count it.']);
});

test('the material carries only figures the statement prints for the date', () => {
  const lines = statementCoverMaterial('2026-09-30', ANALYTICS, POSITIONS).join('\n');
  // Every figure the statement prints for the date, formatted as the sheet formats it.
  const a = ANALYTICS;
  const printed = new Set([
    money(a.nav), money(a.paid_in), money(a.distributed), money(a.nav + a.distributed),
    multiple(a.tvpi), multiple(a.dpi), multiple(a.rvpi), rate(a.irr),
    ...POSITIONS.items.filter((p) => fundedAfter(p, '2026-09-30')).map((p) => money(p.total_invested)),
  ]);
  const found = lines.match(/\$[\d,]+(?:\.\d+)?|\d+\.\d+×|-?\d+(?:\.\d)?%/g) || [];
  assert.ok(found.length >= 8);
  for (const f of found) assert.ok(printed.has(f), `${f} is not a figure the statement prints`);
  // The counts are page 1's, and the only date is the statement's.
  const counts = (lines.match(/\b\d+ (?:of \d+ |positions? |with no mark|whose)/g) || []).map((s) => Number(s.split(' ')[0]));
  for (const n of counts) assert.ok([8, 5, 3, 2, 1].includes(n), `${n} is not a page 1 count`);
  assert.deepEqual([...new Set(lines.match(/\d{4}-\d{2}-\d{2}/g))], ['2026-09-30']);
  assert.deepEqual([...new Set(lines.match(/\d{1,2} [A-Z][a-z]{2} \d{4}/g))], [day('2026-09-30')]);
  // Nothing from a row the date holds: Northwind's and Larkspur's invested are not figures on page 1.
  assert.doesNotMatch(lines, /Northwind|Larkspur|Corvid|\$2,000,000|\$400,000|\$900,000/);
});

test('an unavailable return is named, never a number; no Funded after row says so', () => {
  const lines = statementCoverMaterial('2026-09-30', {
    ...ANALYTICS, irr: null, returns: { ...ANALYTICS.returns, irr: { state: 'unavailable', reason: 'no_rate' } },
  }, { items: [] });
  assert.ok(lines.includes('Page 1, summary: IRR to 30 Sep 2026: Unavailable (page 1 prints no figure).'));
  assert.ok(lines.includes('Page 2 marks no company as Funded after 30 Sep 2026.'));
});

test('a failed read, or a date with no book, is nothing to cover', () => {
  assert.deepEqual(statementCoverMaterial('2026-09-30', null, POSITIONS), []);
  assert.deepEqual(statementCoverMaterial('2026-09-30', ANALYTICS, null), []);
  assert.deepEqual(statementCoverMaterial('2026-09-30', ANALYTICS, { detail: 'Forbidden' }), []);
  assert.deepEqual(statementCoverMaterial('2026-09-30', { ...ANALYTICS, position_count: 0 }, POSITIONS), []);
});

test('the instruction forbids a forecast, a computed figure, advice and any other date', () => {
  assert.match(STATEMENT_COVER_INSTRUCTION, /from the lines below and nothing else/);
  assert.match(STATEMENT_COVER_INSTRUCTION, /Compute no figure/);
  assert.match(STATEMENT_COVER_INSTRUCTION, /Do not forecast/);
  assert.match(STATEMENT_COVER_INSTRUCTION, /do not tell the reader what to do/);
  assert.match(STATEMENT_COVER_INSTRUCTION, /Mention no other date/);
});

// ------------------------------------------------------------------ the route, executed

const JWT_SECRET = 'unit-test-jwt-secret-d6888-0123456789abcdef';
const ADMIN = 1;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, 'admin', NULL, 'Ada', 'ada@axal.example', 1, 'free', 'active')`).run(ADMIN);
  // Venture Six is held at 30 Jun 2025 and marked twice: once on the date, once after it.
  // Venture Seven's only cheque lands after the date: the positions read cut at the date (D6887) leaves it out,
  // so page 2 has no Funded after row and the note never names it.
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (6, 'p6', 'Venture Six', 60), (7, 'p7', 'Venture Seven', 70);
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by) VALUES
      ('pos6', NULL, 6, 'Seed', 600, 6, '2025-02-01', ${ADMIN}),
      ('pos7', NULL, 7, 'Seed', 500, 5, '2025-08-10', ${ADMIN});
    INSERT INTO portfolio_marks (uid, fund_id, project_id, as_of_date, fmv, basis) VALUES
      ('m6a', NULL, 6, '2025-06-30', 900, 'gp_estimate'),
      ('m6b', NULL, 6, '2025-09-30', 1200, 'round_price');
  `);
  return db;
}

/** The Worker's clock, pinned for each request, so "a completed quarter-end" never depends on when the test runs. */
const NOW = Date.parse('2026-11-16T12:00:00.000Z');

async function draft(db: DatabaseSync, scopeKey: string) {
  test.mock.timers.enable({ apis: ['Date'], now: NOW });
  try { return await draftAt(db, scopeKey); } finally { test.mock.timers.reset(); }
}

async function draftAt(db: DatabaseSync, scopeKey: string) {
  const prompts: string[] = [];
  const AI = withGuard({
    run: async (_model: string, payload: any) => {
      const messages = payload?.messages || [];
      prompts.push(String(messages[messages.length - 1]?.content ?? ''));
      return { response: 'Attached is my statement.' };
    },
  });
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await research.fetch(new Request('http://x/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ surface: STATEMENT_COVER_SURFACE, scope_key: scopeKey, page: '/portfolio' }),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  return { status: res.status, body: await res.json().catch(() => null), prompts };
}

const drafts = (db: DatabaseSync) => Number((db.prepare('SELECT COUNT(*) AS n FROM research_zone_drafts').get() as any).n);

test('the route drafts from the statement\'s own reads for the date, and keeps nothing', async () => {
  const db = fixture();
  try {
    const r = await draft(db, '2025-06-30');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.item, {
      uid: null, surface: 'portfolio/statement', scope_key: '2025-06-30', body: 'Attached is my statement.', kept: false, accepted: false,
    });
    assert.equal(drafts(db), 0, 'a cover note is never stored');
    assert.equal(r.prompts.length, 1);
    const p = r.prompts[0];
    // Page 1 at 30 Jun 2025: Venture Six alone, at its June mark.
    assert.match(p, /Page 1, summary: NAV as of 30 Jun 2025: \$900\./);
    assert.match(p, /Page 1, summary: Paid-in to 30 Jun 2025: \$600\./);
    assert.match(p, /Page 1, summary: TVPI as of 30 Jun 2025: 1\.50×\./);
    assert.match(p, /Page 1, coverage: 1 of 1 position held at 30 Jun 2025 carry a usable recorded mark\./);
    assert.match(p, /Page 1, at cost: 0 positions are carried at cost/);
    // Page 2: the read cut at the date (D6887) leaves Venture Seven out, so no company is Funded after.
    assert.match(p, /Page 2 marks no company as Funded after 30 Jun 2025\./);
    assert.doesNotMatch(p, /Venture Seven|\$500/);
    // Nothing after the date reaches the model as a figure for it: not the September mark, not the summed book.
    assert.doesNotMatch(p, /\$1,200|\$1,100|2025-09-30|30 Sep 2025/);
  } finally { db.close(); }
});

test('nothing to cover is refused before the model: a date that is not a completed quarter-end, or one with no book', async () => {
  const db = fixture();
  try {
    for (const scope of ['2025-08-31', '2024-12-31', '2026-12-31', 'latest', '']) {
      const r = await draft(db, scope);
      assert.equal(r.status, 409, scope);
      assert.equal(r.body.detail, 'nothing_to_draft', scope);
      assert.equal(r.prompts.length, 0, `${scope}: the model was called`);
    }
  } finally { db.close(); }
});

test('Eadwyn switched off on the page: 403 assist_off, no run and nothing kept', async () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO ai_rail_preferences (uid, user_id, section, task, mode) VALUES ('pref-1', ?, 'portfolio', '', 'manual')").run(ADMIN);
    const r = await draft(db, '2025-06-30');
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'assist_off');
    assert.equal(r.prompts.length, 0);
    assert.equal(drafts(db), 0);
  } finally { db.close(); }
});

test('the option runs the numbers job D6212\'s notes run', () => {
  assert.equal(railOptionJob('Investor · Portfolio', 'draft:statement-cover-note'), 'IN5');
  assert.equal(railOptionJob('Investor · Portfolio', 'draft:statement-cover-note'), railOptionJob('Investor · Portfolio', 'draft:portfolio-read'));
});
