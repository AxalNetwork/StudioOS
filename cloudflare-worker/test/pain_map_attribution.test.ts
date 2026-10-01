/**
 * The pain map learns which interviews are behind a theme.
 *
 * THE REFUSAL THIS REPLACES, in its own words. Three of `/validate/pain-map`'s
 * four chips carried the same reason: *"a theme carries its phrases and not the
 * interviews they came from, so no mention can be traced to a conversation whose
 * ICP fit is recorded"*. That was true of the PAYLOAD and never true of the
 * database — `discovery_interviews.icp_fit` has existed since migration 161 and
 * `interview_date` since the baseline, and `getPainGroupsView` simply selected
 * neither. No migration was needed; a column list was.
 *
 * RUN, NOT READ, because every failure worth catching here is a query or a fold
 * that compiles and answers wrongly:
 *
 *   · An ICP count that counts MENTIONS rather than INTERVIEWS reports more
 *     customers than were spoken to, and one talkative interviewee outvotes a
 *     room — the same asymmetry `evidenceFor` exists to hold.
 *   · A NULL fit folded into "not ICP" makes `icp_count` read 0 for every
 *     project logged before migration 161, and a chip narrowing on it then
 *     states "none of your pains come from your customers" on no evidence.
 *     `verdictFor`'s header calls this out as the failure the absent-is-not-empty
 *     rule exists to prevent; it is the same rule and the same trap here.
 *   · `icp_recorded` derived from the theme counts rather than the interview rows
 *     reports "nothing on file" for a project whose only ICP interviewee named no
 *     pain — and the page would then explain an empty chip with the wrong reason.
 *   · Attribution that does not follow a phrase through re-grouping makes the
 *     chip disagree with the map beside it about the same conversation.
 *   · A date taken from the THEME rather than from the interviews behind it moves
 *     when a founder renames a group, so "recent" would mean "recently edited"
 *     instead of "recently said to us".
 *
 * The fixture uses interviews with DIFFERENT fits and DIFFERENT dates, because a
 * fixture where every interview looks the same cannot tell a count of interviews
 * from a count of mentions, nor a max from a first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPainGroupsView, ensurePainGroupsSchema } from '../src/services/painGroups.ts';
import { isIcp } from '../src/routes/_founder_validate_helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');

const PROJECT = 4101;
const OTHER_PROJECT = 4102;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first(col?: string) {
          const r = db.prepare(sql).get(...b) ?? null;
          return col === undefined ? r : ((r as any)?.[col] ?? null);
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

/**
 * `interview_pain_severities` comes FROM MIGRATION 211, not from a copy.
 *
 * It is created here even though nothing in this file writes a severity, because
 * `getPainGroupsView`'s severity read is wrapped in `.catch(() => [])` — a
 * fixture without the table would swallow a real query error and every
 * assertion below would still pass over a broken SELECT.
 */
function tableFromMigration(name: string, table: string): string {
  const src = readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
  const at = src.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(at >= 0, `${table} is no longer created by migration ${name}`);
  return src.slice(at, src.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      interviewee_name TEXT, icp_fit TEXT, interview_date TEXT, pains_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  db.exec(tableFromMigration('211_founder_validate_evidence', 'interview_pain_severities'));
  return db;
}

type Iv = { id: number; pains: string[]; fit?: string | null; date?: string | null; project?: number };
const addInterview = (db: any, iv: Iv) =>
  db.prepare('INSERT INTO discovery_interviews (id, project_id, icp_fit, interview_date, pains_json) VALUES (?,?,?,?,?)')
    .run(iv.id, iv.project ?? PROJECT, iv.fit ?? null, iv.date ?? null, JSON.stringify(iv.pains));

async function env(db: InstanceType<typeof DatabaseSync>) {
  const e = { DB: makeD1(db) } as any;
  await ensurePainGroupsSchema(e);
  return e;
}

/** A curated theme with the wordings that belong to it. */
function curate(db: any, title: string, phrases: string[], project = PROJECT) {
  const r = db.prepare('INSERT INTO pain_groups (project_id, title, sort_order) VALUES (?,?,?)')
    .run(project, title, 0);
  const gid = Number(r.lastInsertRowid);
  for (const p of phrases) {
    db.prepare('INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (?,?,?,?)')
      .run(project, gid, p, p);
  }
  return gid;
}

test('the rule for who counts as ICP is the one the verdict uses', () => {
  // NOT A RESTATEMENT — this asserts the shared function, because the whole
  // value of importing `isIcp` into the service is that the map and the
  // hypothesis verdict cannot drift about who is a customer. A copy in
  // `painGroups.ts` would pass its own tests and disagree with the board.
  assert.equal(isIcp('strong'), true);
  assert.equal(isIcp('partial'), true, 'partial fit must count — the verdict counts it');
  assert.equal(isIcp('none'), false, 'a recorded non-customer is not ICP');
  assert.equal(isIcp(null), false, 'an unrecorded fit is not ICP either — it is counted apart');
});

test('icp_count and fit_unrecorded_count are counts of INTERVIEWS, split three ways', async () => {
  const db = freshDb();
  const e = await env(db);
  curate(db, 'Onboarding', ['slow setup']);
  addInterview(db, { id: 1, pains: ['slow setup'], fit: 'strong' });
  addInterview(db, { id: 2, pains: ['slow setup'], fit: 'partial' });
  addInterview(db, { id: 3, pains: ['slow setup'], fit: 'none' });
  addInterview(db, { id: 4, pains: ['slow setup'], fit: null });
  addInterview(db, { id: 5, pains: ['slow setup'] });

  const v = await getPainGroupsView(e, PROJECT);
  const g = v.groups.find((x) => x.title === 'Onboarding')!;
  assert.equal(g.count, 5, 'five interviews named it');
  assert.equal(g.icp_count, 2, 'strong and partial are the two that count');
  assert.equal(g.fit_unrecorded_count, 2, 'the two NULL fits are counted apart, not as ICP and not as none');
  // THE RECORDED `none` IS IN NEITHER, and that is the point of three buckets:
  // "we checked, they were not our customer" is a finding, and folding it in
  // with "we never looked" loses it.
  assert.equal(g.count - g.icp_count - g.fit_unrecorded_count, 1, 'the recorded `none` is not in its own place');
});

test('one interviewee naming a theme three ways is one interview in every number', async () => {
  const db = freshDb();
  const e = await env(db);
  curate(db, 'Onboarding', ['slow setup', 'takes weeks', 'ramp is long']);
  addInterview(db, { id: 1, pains: ['slow setup', 'takes weeks', 'ramp is long'], fit: 'strong', date: '2026-05-01' });

  const v = await getPainGroupsView(e, PROJECT);
  const g = v.groups.find((x) => x.title === 'Onboarding')!;
  assert.equal(g.count, 1, 'three wordings counted as three interviews');
  assert.equal(g.icp_count, 1, 'three wordings counted as three ICP customers');
  assert.equal(g.phrases.length, 3, 'the wordings themselves are still all there');
  // The three-wordings-one-person case is exactly what the page's percentage got
  // wrong by dividing `phrases.length` by the interview total.
  assert.ok(g.count <= v.interview_total, 'a theme cannot be named by more interviews than exist');
});

test('last_mention_at is the latest date among the interviews that named the theme', async () => {
  const db = freshDb();
  const e = await env(db);
  curate(db, 'Billing', ['billing is manual']);
  curate(db, 'Reporting', ['no dashboards']);
  addInterview(db, { id: 1, pains: ['billing is manual'], date: '2026-03-04' });
  addInterview(db, { id: 2, pains: ['billing is manual'], date: '2026-07-19' });
  // A LATER INTERVIEW THAT DID NOT NAME IT. If the fold took the project's max
  // rather than the theme's, Billing would read 2026-09-30 and the ordering
  // would be by "most recent conversation" rather than "most recently named".
  addInterview(db, { id: 3, pains: ['no dashboards'], date: '2026-09-30' });

  const v = await getPainGroupsView(e, PROJECT);
  assert.equal(v.groups.find((x) => x.title === 'Billing')!.last_mention_at, '2026-07-19');
  assert.equal(v.groups.find((x) => x.title === 'Reporting')!.last_mention_at, '2026-09-30');
});

test('last_mention_at is the LATEST date, not the last row read', async () => {
  const db = freshDb();
  const e = await env(db);
  // FOUND BY MUTATION, AND THE ESCAPE IS THE ARGUMENT FOR THIS TEST. Replacing
  // the max-comparison with a bare `a.lastMentionAt = d` — last one wins —
  // passed every other assertion in this file, because they all insert
  // interviews in ascending date order, where "the last row read" and "the
  // latest date" are the same value. They are not the same thing: a founder
  // typing up an older conversation after a newer one would drag the theme's
  // date backwards and reorder the whole map.
  //
  // So the ids ascend while the dates DESCEND. Nothing about the rows' order
  // agrees with the answer.
  curate(db, 'Billing', ['billing is manual']);
  addInterview(db, { id: 1, pains: ['billing is manual'], date: '2026-08-20' });
  addInterview(db, { id: 2, pains: ['billing is manual'], date: '2026-04-02' });
  addInterview(db, { id: 3, pains: ['billing is manual'], date: '2026-01-15' });

  const v = await getPainGroupsView(e, PROJECT);
  assert.equal(v.groups.find((x) => x.title === 'Billing')!.last_mention_at, '2026-08-20',
    'the fold took the last row rather than the latest date');
});

test('an undated interview cannot erase a date another interview gave the theme', async () => {
  const db = freshDb();
  const e = await env(db);
  // The other half of the same escape. A guard written as `if (d || !a.lastMentionAt)`
  // — or one that assigns unconditionally — lets an interview with no date null
  // out a real one, and the theme drops to the bottom of the recency order for a
  // reason nobody can see. The undated row is LAST so it gets the chance.
  curate(db, 'Billing', ['billing is manual']);
  addInterview(db, { id: 1, pains: ['billing is manual'], date: '2026-05-05' });
  addInterview(db, { id: 2, pains: ['billing is manual'], date: null });

  const v = await getPainGroupsView(e, PROJECT);
  const g = v.groups.find((x) => x.title === 'Billing')!;
  assert.equal(g.last_mention_at, '2026-05-05', 'an undated interview overwrote a recorded date');
  assert.equal(g.count, 2, 'both interviews still count as mentions');
});

test('a theme whose interviews carry no date has no date, even when others do', async () => {
  const db = freshDb();
  const e = await env(db);
  curate(db, 'Billing', ['billing is manual']);
  curate(db, 'Reporting', ['no dashboards']);
  addInterview(db, { id: 1, pains: ['billing is manual'], date: null });
  addInterview(db, { id: 2, pains: ['no dashboards'], date: '2026-09-30' });

  const v = await getPainGroupsView(e, PROJECT);
  // NULL, NOT THE OTHER THEME'S DATE AND NOT TODAY. `created_at` is deliberately
  // not the fallback: a batch of old interviews typed up this morning would all
  // read as this morning, and "recent" would mean "recently entered".
  assert.equal(v.groups.find((x) => x.title === 'Billing')!.last_mention_at, null);
  assert.equal(v.groups.find((x) => x.title === 'Reporting')!.last_mention_at, '2026-09-30');
  assert.equal(v.dates_recorded, true, 'a project with one dated interview reports no dates on file');
});

test('icp_recorded comes from the interviews, not from the theme counts', async () => {
  const db = freshDb();
  const e = await env(db);
  curate(db, 'Billing', ['billing is manual']);
  // THE CASE THAT SEPARATES THE TWO SOURCES: the only ICP interviewee named no
  // pain at all, so every theme sits at `icp_count: 0` while the field is
  // plainly in use. Derived from the counts, this would say "no ICP fit on file"
  // and the page would explain an empty `ICP only` chip with the wrong reason.
  addInterview(db, { id: 1, pains: ['billing is manual'], fit: null });
  addInterview(db, { id: 2, pains: [], fit: 'strong' });

  const v = await getPainGroupsView(e, PROJECT);
  assert.equal(v.groups.find((x) => x.title === 'Billing')!.icp_count, 0);
  assert.equal(v.icp_recorded, true, 'derived from the counts rather than the rows');
});

test('a project with no fits and no dates reports both absent', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, { id: 1, pains: ['pricing unclear'] });

  const v = await getPainGroupsView(e, PROJECT);
  assert.equal(v.icp_recorded, false);
  assert.equal(v.dates_recorded, false);
  // AND ABSENT IS NOT ZERO. The counts are 0 either way; these two flags are the
  // only thing that lets the page say "nothing is on file" instead of stating a
  // finding about the customers.
  assert.equal(v.ungrouped[0].icp_count, 0);
  assert.equal(v.ungrouped[0].fit_unrecorded_count, 1, 'an unrecorded fit must still be counted somewhere');
});

test('an empty-string fit is unrecorded, not a value', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, { id: 1, pains: ['pricing unclear'], fit: '' });

  const v = await getPainGroupsView(e, PROJECT);
  // A blank is what a cleared form field writes. Treating it as recorded would
  // make `icp_recorded` true for a project nobody has assessed — the exact
  // false-confidence this pair of flags exists to prevent. It is NOT ICP either,
  // so it belongs in neither bucket on the theme.
  assert.equal(v.icp_recorded, false, 'a blank fit reported as recorded');
  assert.equal(v.ungrouped[0].icp_count, 0);
});

test('attribution follows a phrase into its curated theme', async () => {
  const db = freshDb();
  const e = await env(db);
  curate(db, 'Onboarding', ['slow setup', 'takes weeks to start']);
  addInterview(db, { id: 1, pains: ['slow setup'], fit: 'strong', date: '2026-02-02' });
  addInterview(db, { id: 2, pains: ['takes weeks to start'], fit: 'partial', date: '2026-06-06' });

  const v = await getPainGroupsView(e, PROJECT);
  const g = v.groups.find((x) => x.title === 'Onboarding')!;
  // Two wordings, one theme: the counts travel with the phrases exactly as the
  // mention count and the severity already do. A fold that attributed by phrase
  // instead of by theme would split this into two halves that each look weaker.
  assert.equal(g.count, 2);
  assert.equal(g.icp_count, 2);
  assert.equal(g.last_mention_at, '2026-06-06');
});

test('ungrouped phrases carry the same attribution as themes', async () => {
  const db = freshDb();
  const e = await env(db);
  addInterview(db, { id: 1, pains: ['no audit trail'], fit: 'strong', date: '2026-01-09' });
  addInterview(db, { id: 2, pains: ['no audit trail'], fit: null, date: '2026-04-11' });

  const v = await getPainGroupsView(e, PROJECT);
  const u = v.ungrouped.find((x) => x.display_phrase === 'no audit trail')!;
  // An uncurated phrase is its own theme and the page draws it in the same list,
  // so a chip that narrowed only the curated half would hide evidence.
  assert.equal(u.count, 2);
  assert.equal(u.icp_count, 1);
  assert.equal(u.fit_unrecorded_count, 1);
  assert.equal(u.last_mention_at, '2026-04-11');
});

/**
 * A `discovery_interviews` with no `icp_fit`, and a switch for whether the
 * bootstrap is allowed to add it.
 *
 * `ensureDiscoveryIcpFitColumn` ALTERs the column in and reports whether it is
 * usable, so the ordinary missing-column case heals itself. The case that does
 * NOT heal — and the one its own docblock is written for — is an ALTER that
 * fails: it returns false so "a caller can degrade to 'ICP fit unavailable'
 * instead of emitting SQL that would fail with `no such column`". `blockAlter`
 * produces exactly that, by refusing the one statement.
 */
function dbWithoutIcpFit(blockAlter: boolean) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      interview_date TEXT, pains_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  db.exec(tableFromMigration('211_founder_validate_evidence', 'interview_pain_severities'));
  const real = makeD1(db);
  const DB = blockAlter
    ? {
      ...real,
      prepare(sql: string) {
        if (/ALTER TABLE discovery_interviews ADD COLUMN icp_fit/i.test(sql)) {
          const api: any = {
            bind: () => api,
            async first() { throw new Error('attempt to write a readonly database'); },
            async all() { throw new Error('attempt to write a readonly database'); },
            async run() { throw new Error('attempt to write a readonly database'); },
          };
          return api;
        }
        return real.prepare(sql);
      },
    }
    : real;
  return { db, env: { DB } as any };
}

test('a missing icp_fit is bootstrapped, and the map comes back whole', async () => {
  const { db, env: e } = dbWithoutIcpFit(false);
  await ensurePainGroupsSchema(e);
  curate(db, 'Billing', ['billing is manual']);
  db.prepare('INSERT INTO discovery_interviews (id, project_id, interview_date, pains_json) VALUES (?,?,?,?)')
    .run(1, PROJECT, '2026-06-06', JSON.stringify(['billing is manual']));

  const v = await getPainGroupsView(e, PROJECT);
  const g = v.groups.find((x) => x.title === 'Billing');
  assert.ok(g, 'the map came back with no themes on a healable schema');
  assert.equal(g!.count, 1);
  assert.equal(g!.last_mention_at, '2026-06-06');
  // The ALTER ran, so the column is there and every interview reads as
  // fit-unrecorded rather than as anything.
  assert.equal(g!.fit_unrecorded_count, 1);
  assert.equal(v.icp_recorded, false);
});

test('when the icp_fit ALTER fails, the map still draws — it does not go blank', async () => {
  // THE REGRESSION THIS PINS, and it took two attempts to pin properly. The
  // first version of this test built the table without the column and let the
  // bootstrap add it, so an unconditional `SELECT … icp_fit …` passed just as
  // well — the mutation walked straight through. The failure only exists when the
  // ALTER cannot run, which is the state `ensureDiscoveryIcpFitColumn` returns
  // false for, so that is what this sets up.
  //
  // What goes wrong without the guard: `getPainGroupsView`'s interview read is
  // wrapped in `.catch(() => [])`, so `no such column: icp_fit` is not an error
  // anybody sees — it is NO INTERVIEWS, and the entire pain map renders empty.
  // A feature that only adds a chip would have blanked the page it sits on.
  const { db, env: e } = dbWithoutIcpFit(true);
  await ensurePainGroupsSchema(e);
  curate(db, 'Billing', ['billing is manual']);
  db.prepare('INSERT INTO discovery_interviews (id, project_id, interview_date, pains_json) VALUES (?,?,?,?)')
    .run(1, PROJECT, '2026-06-06', JSON.stringify(['billing is manual']));
  db.prepare('INSERT INTO discovery_interviews (id, project_id, interview_date, pains_json) VALUES (?,?,?,?)')
    .run(2, PROJECT, '2026-07-07', JSON.stringify(['billing is manual']));

  const v = await getPainGroupsView(e, PROJECT);
  const g = v.groups.find((x) => x.title === 'Billing');
  assert.ok(g, 'the pain map went blank — the SELECT named a column that is not there and the catch hid it');
  assert.equal(g!.count, 2, 'the mention counts did not survive the degradation');
  assert.equal(g!.last_mention_at, '2026-07-07', 'the dates did not survive it either');
  assert.equal(v.interview_total, 2);
  // ATTRIBUTION UNAVAILABLE, STATED AS SUCH. Every mention is fit-unrecorded and
  // `icp_recorded` is false, so the page says "no ICP fit recorded on any
  // interview yet" — which is the honest reading of a column that cannot be read.
  assert.equal(g!.icp_count, 0);
  assert.equal(g!.fit_unrecorded_count, 2);
  assert.equal(v.icp_recorded, false);
  assert.equal(v.dates_recorded, true, 'the date flag must not be collateral damage');
});

test('another founder\'s interviews reach neither the counts nor the flags', async () => {
  const db = freshDb();
  const e = await env(db);
  curate(db, 'Billing', ['billing is manual']);
  addInterview(db, { id: 1, pains: ['billing is manual'], fit: null });
  // Same pain, same wording, different project, with a fit and a date on it.
  addInterview(db, { id: 2, pains: ['billing is manual'], fit: 'strong', date: '2026-08-08', project: OTHER_PROJECT });

  const v = await getPainGroupsView(e, PROJECT);
  const g = v.groups.find((x) => x.title === 'Billing')!;
  assert.equal(g.count, 1, 'another project\'s interview counted as a mention');
  assert.equal(g.icp_count, 0, 'another project\'s ICP customer counted as ours');
  assert.equal(g.last_mention_at, null, 'another project\'s date reached our theme');
  assert.equal(v.icp_recorded, false, 'another project\'s fit made ours look assessed');
  assert.equal(v.dates_recorded, false, 'another project\'s date made ours look dated');
});

test('a curated theme nobody mentioned counts zero, however many wordings it has', async () => {
  const db = freshDb();
  const e = await env(db);
  // THIS IS THE ROW THAT READ 150%. `analyzePains` seeds every curated alias as
  // a phrase whether or not anyone logged it, so the page dividing
  // `phrases.length` by the interview total drew a bar at 100% for a theme with
  // no mentions at all. `count` was right the whole time and the page read the
  // wrong field; the export's docblock already claimed they agreed.
  curate(db, 'Onboarding', ['slow setup', 'takes weeks', 'ramp is long']);
  addInterview(db, { id: 1, pains: ['pricing unclear'], fit: 'strong', date: '2026-05-05' });
  addInterview(db, { id: 2, pains: ['no integrations'], fit: null, date: '2026-05-06' });

  const v = await getPainGroupsView(e, PROJECT);
  const g = v.groups.find((x) => x.title === 'Onboarding')!;
  assert.equal(g.phrases.length, 3, 'the curated wordings are still listed');
  assert.equal(g.count, 0, 'a theme nobody named has mentions');
  assert.equal(g.icp_count, 0);
  assert.equal(g.fit_unrecorded_count, 0);
  assert.equal(g.last_mention_at, null, 'a theme nobody named has a date');
  assert.equal(v.interview_total, 2);
  // The number the page must divide by the total. 0/2 is 0%, and 3/2 was 150%.
  assert.ok(g.count / v.interview_total <= 1, 'the honest frequency can exceed 100%');
});

test('the counts never exceed the mentions they are drawn from', async () => {
  const db = freshDb();
  const e = await env(db);
  curate(db, 'Onboarding', ['slow setup']);
  addInterview(db, { id: 1, pains: ['slow setup', 'slow setup'], fit: 'strong', date: '2026-03-03' });
  addInterview(db, { id: 2, pains: ['Slow  Setup'], fit: 'none' });

  const v = await getPainGroupsView(e, PROJECT);
  for (const g of [...v.groups, ...v.ungrouped]) {
    // The invariant that makes every badge on the row readable together: each
    // sub-count is of interviews drawn from the same set the mention count is,
    // so a theme can never show more customers than people.
    assert.ok(g.icp_count <= g.count, `${(g as any).title || g.display_phrase}: icp_count exceeds count`);
    assert.ok(g.fit_unrecorded_count <= g.count, 'fit_unrecorded_count exceeds count');
    assert.ok(g.icp_count + g.fit_unrecorded_count <= g.count, 'the two splits overlap');
  }
  const g = v.groups.find((x) => x.title === 'Onboarding')!;
  assert.equal(g.count, 2, 'a duplicate phrase in one interview counted twice');
  assert.equal(g.icp_count, 1);
});
