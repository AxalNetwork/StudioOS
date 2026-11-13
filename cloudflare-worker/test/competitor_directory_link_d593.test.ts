/**
 * D593 — a saved competitor links to its company directory profile when
 * exactly one directory company has its site, or, failing that, its name.
 * Anything ambiguous, and a hand-typed name with no profile, stays unlinked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DIRECTORY_CANDIDATE_ROWS_SQL, hostOf, linkCandidatesToDirectory, matchDirectory, nameKey,
} from '../src/services/competitorDirectoryLink.ts';

const routes = readFileSync(new URL('../src/routes/competitors.ts', import.meta.url), 'utf8');

const ROWS = [
  { uid: 'q1', name: 'Thinking Machines Lab', website: 'https://thinkingmachines.ai/' },
  { uid: 'q2', name: 'Noble Mobile', website: 'https://noblemobile.com' },
  { uid: 'q3', name: 'Twin A', website: 'https://www.shared.example' },
  { uid: 'q4', name: 'Twin B', website: 'http://shared.example/about' },
  { uid: 'q5', name: 'Same Name', website: 'https://one.example' },
  { uid: 'q6', name: 'same  name', website: 'https://two.example' },
];

test('a host is read from a URL or a bare domain, without www. or a path', () => {
  assert.equal(hostOf('https://www.Thinkingmachines.ai/careers'), 'thinkingmachines.ai');
  assert.equal(hostOf('thinkingmachines.ai'), 'thinkingmachines.ai');
  assert.equal(hostOf('www.noblemobile.com/'), 'noblemobile.com');
  assert.equal(hostOf(''), null);
  assert.equal(hostOf(null), null);
  assert.equal(hostOf('not a site'), null);
});

test('a name is compared without case or repeated spacing', () => {
  assert.equal(nameKey('  Noble   Mobile '), 'noble mobile');
  assert.equal(nameKey(''), null);
  assert.equal(nameKey(undefined), null);
});

test('one directory company on the same site links, whatever the name says', () => {
  const m = matchDirectory([{ id: 'a', name: 'TML', domain: 'www.thinkingmachines.ai' }], ROWS);
  assert.equal(m.get('a'), 'q1');
  const byUrl = matchDirectory([{ id: 'b', name: 'Other', url: 'https://noblemobile.com/pricing' }], ROWS);
  assert.equal(byUrl.get('b'), 'q2');
});

test('two directory companies on one site link neither, and the name is not tried', () => {
  const m = matchDirectory([{ id: 'a', name: 'Twin A', domain: 'shared.example' }], ROWS);
  assert.equal(m.get('a'), null);
});

test('with no site match, exactly one name links; two of the same name link neither', () => {
  const one = matchDirectory([{ id: 'a', name: 'noble mobile', domain: 'elsewhere.example' }], ROWS);
  assert.equal(one.get('a'), 'q2');
  const two = matchDirectory([{ id: 'b', name: 'Same Name' }], ROWS);
  assert.equal(two.get('b'), null);
});

test('a hand-typed name with no profile stays unlinked', () => {
  const m = matchDirectory([{ id: 'helios', name: 'Helios', domain: null }], ROWS);
  assert.equal(m.get('helios'), null);
  assert.equal(m.size, 1);
});

function fakeDb(rows: unknown[] | Error) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          calls.push({ sql, binds });
          return { all: async () => { if (rows instanceof Error) throw rows; return { results: rows }; } };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

test('the read binds the names and hosts as JSON arrays, never into the SQL', async () => {
  const { db, calls } = fakeDb(ROWS);
  const out = await linkCandidatesToDirectory(db, [
    { id: 'a', name: 'TML', domain: 'thinkingmachines.ai' },
    { id: 'b', name: 'Helios' },
  ]);
  assert.equal(out.status, 'read');
  assert.equal(out.byId.get('a'), 'q1');
  assert.equal(out.byId.get('b'), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, DIRECTORY_CANDIDATE_ROWS_SQL);
  assert.deepEqual(calls[0].binds, [JSON.stringify(['tml', 'helios']), JSON.stringify(['thinkingmachines.ai'])]);
  assert.doesNotMatch(calls[0].sql, /thinkingmachines|helios/i);
});

test('a failed directory read links nothing and says it was unreadable', async () => {
  const { db } = fakeDb(new Error('no such table'));
  const out = await linkCandidatesToDirectory(db, [{ id: 'a', name: 'TML', domain: 'thinkingmachines.ai' }]);
  assert.equal(out.status, 'unreadable');
  assert.equal(out.byId.get('a'), null);
});

test('no name and no site means no read at all', async () => {
  const { db, calls } = fakeDb(ROWS);
  const out = await linkCandidatesToDirectory(db, [{ id: 'a', name: '  ' }]);
  assert.equal(calls.length, 0);
  assert.equal(out.status, 'read');
  assert.equal(out.byId.get('a'), null);
});

test('every full analysis read carries each competitor\'s directory uid and the read\'s status', () => {
  const at = routes.indexOf('async function loadAnalysis(');
  const body = routes.slice(at, routes.indexOf('\nfunction mapCandidate(', at));
  assert.match(body, /linkCandidatesToDirectory\(env\.DB, candidates\)/);
  assert.match(body, /directory_uid: directory\.byId\.get\(String\(row\.id\)\) \?\? null/);
  assert.match(body, /directory_match: directory\.status/);
  // Read, never stored: nothing in the loader writes.
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE)\b/);
});
