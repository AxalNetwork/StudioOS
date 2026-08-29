/**
 * Data room: the gate is real, and the UI does not promise more than the
 * backend does (Wave 4).
 *
 * This is the first NEW surface in the integration — everything before it was
 * wiring a page onto a backend that already existed. So the risk is the
 * opposite one: a UI that describes protections the worker does not implement.
 *
 * Three claims a data room could make and must not:
 *
 *   1. "Watermarked." There is no PDF pipeline. What actually protects a file
 *      is a per-investor, single-use, two-minute link that is logged.
 *   2. "Invitation sent." The worker resolves an existing account and 404s
 *      otherwise. Nothing is mailed.
 *   3. A locked row for an NDA-gated file. A filename is itself information
 *      ("Series B term sheet — Acme.pdf"), so those are withheld, not greyed
 *      out — the investor gets a count.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { apiMethodNames, apiCallsIn } from './_apiMethods.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const PAGE = 'frontend/src/pages/raise/DataRoomPage.jsx';
const ROUTE = 'cloudflare-worker/src/routes/data_room.ts';

test('the NDA gate reads pairwise_ndas, not a second NDA notion', () => {
  const w = read(ROUTE);
  assert.match(w, /FROM pairwise_ndas/, 'the gate must use the existing e-sign NDA table');
  // Migration 025 fixes party_a as the founder. Accepting either ordering
  // would take rows the rest of the system treats as malformed.
  assert.match(w, /party_a_user_id = \? AND party_b_user_id = \?/);
  assert.ok(!/party_b_user_id = \? AND party_a_user_id = \?/.test(w),
    'the reversed ordering must not be accepted');
  assert.match(w, /valid_until IS NULL OR valid_until > datetime\('now'\)/,
    'a lapsed NDA must not open a file');
});

test('the gate is re-checked at download, not inherited from the listing', () => {
  const w = read(ROUTE);
  const dl = w.slice(w.indexOf("r.post('/shared/:projectUid/files/:uid/download'"));
  assert.match(dl, /file\.visibility === 'nda' && !\(await ndaActive\(/,
    'a uid captured while an NDA was live must stop working when it lapses');
});

test('nothing NDA-gated is listed to an investor who cannot open it', () => {
  const w = read(ROUTE);
  const shared = w.slice(w.indexOf("r.get('/shared/:projectUid'"), w.indexOf('function folderUid'));
  assert.match(shared, /const visible = \(v: string\) => v === 'open' \|\| nda/);
  assert.match(shared, /withheld_behind_nda: withheld/,
    'the investor is told SOMETHING is withheld, so the gate is not invisible');
  // …but never the names.
  assert.ok(!/withheld_files|locked_files|hidden_names/.test(shared));
});

test('a room with no grant is indistinguishable from one that does not exist', () => {
  // Otherwise the 404-vs-403 split tells an investor which companies are on
  // the platform.
  const w = read(ROUTE);
  assert.match(w, /if \(!project \|\| !grant\) return c\.json\(\{ detail: 'Data room not found' \}, 404\)/);
});

test('every founder mutation is scoped by project, not by uid alone', () => {
  // A uid-only WHERE lets one founder patch or delete another's row.
  const w = read(ROUTE);
  for (const frag of [
    'UPDATE data_room_folders SET ${sets.join(\', \')} WHERE uid = ? AND project_id = ?',
    'DELETE FROM data_room_folders WHERE uid = ? AND project_id = ?',
    'UPDATE data_room_files SET ${sets.join(\', \')} WHERE uid = ? AND project_id = ?',
  ]) {
    assert.ok(w.includes(frag), `missing project scoping: ${frag}`);
  }
  assert.match(w, /projectOwnerScope/, 'ownership goes through the tenancy module');
});

test('the R2 key is derived, never taken from the request', () => {
  const w = read(ROUTE);
  assert.match(w, /const key = `data-room\/\$\{project\.uid\}\/\$\{uid\}`/);
  assert.ok(!/body\.r2_key|body\.key\b/.test(w),
    'a caller-supplied key is a path-traversal write into another project');
  // And deletion only touches an object inside this project's prefix.
  assert.match(w, /file\.r2_key\.startsWith\(`data-room\/\$\{project\.uid\}\/`\)/);
});

test('the UI does not claim a watermark', () => {
  const s = read(PAGE);
  assert.match(s, /not watermarked/i, 'the absence must be stated, not left to be assumed');
  assert.ok(!/watermark(ed)?[^.]{0,20}(applied|protect)/i.test(s));
  // What DOES protect the file is described instead.
  assert.match(s, /work once|single-use/i);
  assert.match(s, /expire/i);
});

test('sharing does not promise an invitation', () => {
  const s = read(PAGE);
  assert.match(s, /does not send an invitation/i);
  const w = read(ROUTE);
  assert.match(w, /No account with that address/, 'the worker 404s an unknown address');
});

test('the page is routed, role-branched, and never a second root', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/raise\/data-room"/, 'defining the page is not shipping it');
  assert.match(app, /guard\(\['admin', 'founder', 'investor'\], <DataRoomPage/);
  // The persona is a branch inside one route, not a /founder or /investor root.
  assert.ok(!/path="\/investor\/data-room"|path="\/founder\/data-room"/.test(app));
  const s = read(PAGE);
  assert.match(s, /const isFounder = role === 'founder' \|\| role === 'admin'/);
});

test('every api.* the page calls exists on both sides', () => {
  // apiMethodNames parses api.js ONCE and exactly (a top-level property at two
  // spaces of indent). The previous form built a regex per method name, which
  // Semgrep flagged as non-literal-regexp; see _apiMethods.mjs for why that
  // finding was not reachable and why the loop was still the weaker design.
  const called = apiCallsIn(read(PAGE));
  const defined = apiMethodNames(read('frontend/src/lib/api.js'));
  const missing = [...called].filter((m) => !defined.has(m));
  assert.deepEqual(missing, [], `api.js does not define: ${missing.join(', ')}`);
  assert.ok(called.size >= 8, 'the page should exercise most of the route');
});

test('the four tables exist and nothing else creates them', () => {
  const dir = resolve(root, 'cloudflare-worker/sql/migrations');
  const sql = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  for (const t of ['data_room_folders', 'data_room_files', 'data_room_grants', 'data_room_access_log']) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${t}`), `${t} must be created by a migration`);
  }
  // The migration is additive and idempotent — no ALTER, no backfill.
  const mig = read('cloudflare-worker/sql/migrations/184_data_room.sql');
  assert.ok(!/ALTER TABLE|UPDATE |INSERT /i.test(mig), 'migration 184 must be create-only');
});
