/**
 * Title, authority and economics are three axes — and the test that keeps them
 * from collapsing back into one.
 *
 * `user_company_links` carried a single `role_in_company` string. The Team ·
 * Authority design is built on the observation that this collapse IS the bug,
 * because it forces three independent facts to agree. Its own cases:
 *
 *   · A Venture Partner SPONSORs — outranking a Vice President's FLAG — while
 *     being part-time with no GP ownership.
 *   · A Vice President is senior to an Associate and holds the SAME authority.
 *   · An Operating Partner is a partner by title and VIEW by authority.
 *
 * The failure mode this guards is subtle and severe: if authority were derived
 * from title, renaming someone would grant or revoke power silently. So
 * `authorityForTitle()` returns a DEFAULT for pre-filling a picker, the stored
 * column is independent, and the server must never call one from the other.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const service = read('cloudflare-worker/src/services/teamAuthority.ts');
const route = read('cloudflare-worker/src/routes/company.ts');
const migration = read('cloudflare-worker/sql/migrations/191_team_authority.sql');
const page = read('frontend/src/pages/CompanySettingsPage.jsx');

test('the migration adds three columns and drops nothing', () => {
  for (const col of ['title TEXT', 'authority TEXT', 'carry_bps INTEGER']) {
    assert.ok(migration.includes(`ADD COLUMN ${col}`), `missing ${col}`);
  }
  assert.doesNotMatch(migration, /\bDROP\b/i);
  // role_in_company still backs canEdit(); retiring an access check in the same
  // migration that adds its replacement is how a permissions bug ships.
  assert.doesNotMatch(migration, /role_in_company\s*=/i, 'the migration must not rewrite the old axis');
  assert.match(route, /\['Owner', 'Admin', 'Founder'\]\.includes\(link\.role_in_company\)/);
});

test('carry is basis points, integer, and bounded', () => {
  assert.match(service, /normalizeCarryBps/);
  assert.match(service, /Number\.isInteger\(n\)/);
  assert.match(service, /n < 0 \|\| n > 10000/);
  // A float would be the same mistake cents exists to prevent.
  assert.doesNotMatch(service, /parseFloat/);
  assert.match(migration, /basis points/i);
});

test('the five authority levels are ordered, and each says what it means', () => {
  assert.match(service, /AUTHORITY_LEVELS = \['VIEW', 'WORK', 'FLAG', 'SPONSOR', 'VOTE'\]/);
  // The two most misread levels must carry the design's own wording.
  assert.match(service, /Not a veto — a stop/);
  assert.match(service, /Brings a deal to committee\. Cannot decide it\./);
  assert.match(service, /The only level that does/);
});

test('the ladder is complete and in seniority order', () => {
  const order = ['Analyst', 'Associate', 'Senior Associate', 'Vice President',
    'Principal', 'Venture Partner', 'Partner / GP'];
  let at = -1;
  for (const t of order) {
    const i = service.indexOf(`title: '${t}'`);
    assert.ok(i > -1, `ladder is missing ${t}`);
    assert.ok(i > at, `${t} is out of seniority order`);
    at = i;
  }
});

test('the three cases that prove the axes are independent still hold', () => {
  const rung = (t) => {
    const i = service.indexOf(`title: '${t}'`);
    return service.slice(i, service.indexOf('},', i));
  };
  // A Venture Partner outranks a Vice President in authority, not in title.
  assert.match(rung('Venture Partner'), /defaultAuthority: 'SPONSOR'/);
  assert.match(rung('Vice President'), /defaultAuthority: 'FLAG'/);
  // A VP and an Associate share an authority despite differing seniority.
  assert.match(rung('Associate'), /defaultAuthority: 'FLAG'/);
  // An Operating Partner is a partner by title and VIEW by authority.
  const op = service.slice(service.indexOf("name: 'Operating Partner'"));
  assert.match(op.slice(0, 200), /defaultAuthority: 'VIEW'/);
});

test('the server never derives authority from title', () => {
  // This is the whole point. If the route called authorityForTitle(), a rename
  // would silently change what a person may do.
  //
  // Read the CODE. The route carries a comment saying authorityForTitle() is
  // deliberately NOT called here, and matching the file would fire on that
  // sentence — the third time in this branch a guard nearly passed or failed on
  // prose describing the very thing it checks for.
  assert.doesNotMatch(codeOnly(route), /authorityForTitle/,
    'company.ts must store authority as given, never compute it from title');
  // And the explanation must survive, so the next reader knows it was a choice.
  assert.match(route, /authorityForTitle\(\) exists to pre-fill a picker/);
  assert.match(service, /A default, never a derivation|DEFAULT, not a derivation/);
});

test('the route validates all three, and rejects an unknown level', () => {
  assert.match(route, /if \(!isTitle\(body\.title\)\)/);
  assert.match(route, /if \(!isAuthority\(body\.authority\)\)/);
  assert.match(route, /normalizeCarryBps\(body\.carry_bps\)/);
  assert.match(route, /VIEW, WORK, FLAG, SPONSOR or VOTE/);
});

test('null means NOT RECORDED, not a default', () => {
  // A member added before migration 191 has no title. Showing them as an
  // Analyst on VIEW would invent a fact about a real person.
  assert.match(route, /title: \(lnk as any\)\.title \?\? null/);
  assert.match(route, /authority: \(lnk as any\)\.authority \?\? null/);
  assert.match(route, /carry_bps: \(lnk as any\)\.carry_bps \?\? null/);
  assert.match(page, /Title — not recorded/);
});

test('the picker reads the vocabulary rather than hardcoding it', () => {
  assert.match(route, /r\.get\('\/company\/team-vocabulary'/);
  assert.match(page, /api\.teamVocabulary\(\)/);
  // A hardcoded ladder in the page is the drift this endpoint exists to stop.
  assert.doesNotMatch(page, /'Senior Associate'/);
  assert.doesNotMatch(page, /'SPONSOR'/);
});

test('the literal route is registered before /company/:uid', () => {
  // Otherwise the param route claims uid="team-vocabulary" — the same trap
  // /company/memberships carries a comment about.
  const vocab = route.indexOf("r.get('/company/team-vocabulary'");
  const param = route.indexOf("r.get('/company/:uid'");
  assert.ok(vocab > -1, 'no vocabulary route');
  if (param > -1) assert.ok(vocab < param, 'the param route would shadow it');
});

test('selecting a title pre-fills authority only when none is set', () => {
  // The suggestion must never overwrite an explicit choice — that would be
  // derivation wearing a different hat.
  assert.match(page, /if \(title && rung && !m\.authority\) patch\.authority = rung\.defaultAuthority;/);
});
