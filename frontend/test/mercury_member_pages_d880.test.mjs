/**
 * D880 (#2553) — the member Connectors pages show only the member's own
 * Mercury; Axal VC's own accounts (the four entity connections) are HQ's.
 *
 * The guard reads the source, so a later edit cannot quietly bring the entity
 * UI back to a member page:
 *   - no file under `pages/account/` imports the admin Mercury API, HQ's
 *     fund administration or consoles, or an entity helper (`ENTITY_KEYS`, `entityRows`,
 *     `isEntityRow`, the entity sheet);
 *   - a Mercury file under `pages/account/` says "entity" only as the
 *     Worker's refusal code `mercury_entity_account`, which a member can meet
 *     when they try Axal VC's own organization;
 *   - HQ's Bank accounts console and fund administration draw the entity UI
 *     from `pages/admin/fundAdmin/`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mercury_member_pages_d880.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'frontend/src');
const ACCOUNT = join(ROOT, 'pages/account');
const read = (f) => readFileSync(f, 'utf8');
function files(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...files(f));
    else if (/\.(jsx?|mjs)$/.test(n)) out.push(f);
  }
  return out;
}
const accountFiles = files(ACCOUNT);

test('no pages/account file imports the admin Mercury API, HQ\'s fund administration, or an entity helper', () => {
  assert.ok(accountFiles.length > 20, 'the folder was read');
  const banned = [
    [/from\s+['"][^'"]*lib\/api\/adminMercury[^'"]*['"]/, 'adminMercury'],
    [/from\s+['"][^'"]*\/admin\/(fundAdmin|consoles)\/[^'"]*['"]/, 'HQ\'s fund administration or consoles'],
    [/\bENTITY_KEYS\b/, 'ENTITY_KEYS'],
    [/\bentityRows?\b/, 'entityRows'],
    [/\bisEntityRow\b/, 'isEntityRow'],
    [/\bMercuryEntity[A-Za-z]*\b/, 'the entity sheet'],
    [/\bFUND_ADMIN_GROUP\b/, 'FUND_ADMIN_GROUP'],
    [/mercury_entity_connections/, 'the entity row\'s source'],
  ];
  for (const f of accountFiles) {
    const src = read(f);
    for (const [re, what] of banned) assert.doesNotMatch(src, re, `${relative(ROOT, f)} names ${what}`);
  }
});

test('a Mercury file under pages/account says "entity" only as the Worker\'s refusal code', () => {
  const mercuryFiles = accountFiles.filter((f) => /mercury/i.test(read(f)));
  assert.ok(mercuryFiles.length >= 5, 'the Mercury files were found');
  for (const f of mercuryFiles) {
    const stray = (read(f).match(/[A-Za-z_]*entit[A-Za-z_']*/gi) || [])
      .filter((w) => w !== 'mercury_entity_account' && !/^identit/i.test(w) && !/^entityType$/.test(w));
    // AccountProfile's "Signing entity" is a member's own corporate profile, not Mercury.
    const allowed = /AccountProfile\.jsx$|accountCenterModel\.js$/.test(f) ? [] : stray;
    assert.deepEqual(allowed, [], relative(ROOT, f));
  }
});

test('HQ draws the entity UI from pages/admin/fundAdmin, and nothing there is lost', () => {
  const bank = read(join(ROOT, 'pages/admin/consoles/BankAccountsConsole.jsx'));
  assert.match(bank, /from '\.\.\/fundAdmin\/MercuryEntitySheet'/);
  assert.match(bank, /from '\.\.\/fundAdmin\/mercuryEntityModel'/);
  assert.match(read(join(ROOT, 'pages/admin/fundAdmin/BankingTabs.jsx')), /from '\.\/MercuryEntitySheet'/);
  assert.match(read(join(ROOT, 'pages/admin/fundAdmin/OverviewTab.jsx')), /from '\.\/mercuryEntityModel'/);
  const sheet = read(join(ROOT, 'pages/admin/fundAdmin/MercuryEntitySheet.jsx'));
  for (const name of ['MercuryEntitySheet', 'MercuryEntityConnections']) assert.match(sheet, new RegExp(`export function ${name}\\b`), name);
  // Connect, replace, disconnect and sync stay on the console's sheet.
  for (const id of ['mercury-connect-', 'mercury-replace-', 'mercury-disconnect-', 'mercury-sync-']) assert.ok(sheet.includes(id), id);
  const model = read(join(ROOT, 'pages/admin/fundAdmin/mercuryEntityModel.js'));
  assert.match(model, /export const ENTITY_KEYS = \['holdings', 'management', 'gp', 'fund'\];/);
});
