// D942 (#2747, part 5 of #2375): no user-facing line names the Admin Console.
//
// D938 retired the console; every tool is a page at its own address. What a
// person reads must name the page they will find, so this guard fails on the
// phrase anywhere in `frontend/src` code once the prose is removed. Comments
// and decision IDs are exempt (`codeOnly`), and so are identifiers and test
// ids, which never put a space between the two words (`FundAdminConsole`,
// `admin-console-retry`).
//
// Three uses are kept on purpose, each pinned below by file and count so the
// list cannot grow quietly:
//   - the moved notice, "The Admin Console has moved: [Page] now lives under
//     [Section]." — #2375's first notice form (SHL3). It tells someone who
//     followed an old link where the tool went, so it names what they knew;
//   - `adminPlacement.js`'s UNPLACED entry for `/admin`, the H35 record of the
//     retired row, which the placement guard pins by value;
//   - `railPages.js`'s two keys for `/admin`, rows marked off-canvas, which no
//     rail draws (and `/admin` itself only redirects).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = 'frontend/src';
const PHRASE = /admin\s+console/gi;
const MOVED = /The Admin Console has moved: /g;

const KEPT = new Map([
  ['frontend/src/lib/adminPlacement.js', 1],
  ['frontend/src/lib/railPages.js', 2],
]);

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(jsx?|tsx?)$/.test(e.name) ? [p] : [];
  });
}

/** Each place `src` names the console in code, the moved notice set aside. */
function namings(src) {
  const code = codeOnly(src).replace(MOVED, '');
  return [...code.matchAll(PHRASE)].map((m) => code.slice(0, m.index).split('\n').length);
}

const FILES = sources(ROOT).map((file) => ({ file: file.split(path.sep).join('/'), src: fs.readFileSync(file, 'utf8') }));

test('no user-facing line under frontend/src names the Admin Console', () => {
  const found = [];
  for (const { file, src } of FILES) {
    const lines = namings(src);
    if (!lines.length) continue;
    if (KEPT.get(file) === lines.length) continue;
    found.push(`${file}:${lines.join(',')}`);
  }
  assert.deepEqual(found, [], `"Admin Console" in user-facing copy — name the page by its new name and address (D938's route map):\n${found.join('\n')}`);
});

test('the kept uses are the ones listed, no more and no fewer', () => {
  for (const [file, count] of KEPT) {
    const entry = FILES.find((f) => f.file === file);
    assert.ok(entry, `${file} is gone; drop it from KEPT`);
    assert.equal(namings(entry.src).length, count, file);
  }
  // The moved notice keeps #2375's sentence: the map's template and the four
  // pages that carry their own copy of it.
  const moved = FILES.filter(({ src }) => codeOnly(src).match(MOVED)).map(({ file }) => file).sort();
  assert.deepEqual(moved, [
    'frontend/src/pages/admin/LegacyContractsRedirect.jsx',
    'frontend/src/pages/admin/lab/labModel.js',
    'frontend/src/pages/admin/payments/payModel.js',
    'frontend/src/pages/admin/profiles/ppModel.js',
  ]);
});

test('the scanner catches copy and lets prose, identifiers and test ids through', () => {
  assert.deepEqual(namings("const a = 'Open Admin Console → Users.';"), [1]);
  assert.deepEqual(namings('<p>\n  on the Admin\n  Console.\n</p>'), [2]);
  assert.deepEqual(namings("const a = 'Loading admin console...';"), [1]);
  assert.deepEqual(namings('// the Admin Console is retired\nconst x = 1;'), []);
  assert.deepEqual(namings('/**\n * the Admin Console\n */\nconst x = 1;'), []);
  assert.deepEqual(namings('<div data-testid="admin-console-retry" />; FundAdminConsole();'), []);
  assert.deepEqual(namings("const n = 'The Admin Console has moved: Payments now lives under Platform.';"), []);
});

test('the lines #2375 item 10 named now say the new name', () => {
  const read = (f) => fs.readFileSync(`${ROOT}/${f}`, 'utf8');
  assert.match(read('pages/admin/consoles/shared.jsx'), /export const CONSOLE_LOADING = 'Loading…';/);
  assert.match(read('pages/hq/HqSupportPage.jsx'), /<Link to="\/admin\/integration-keys#github" className="underline">Integration keys › GitHub Sync<\/Link>/);
  assert.match(read('pages/hq/HqTeamActions.jsx'), /Approve or reject on KYC & KYB, under Approvals,/);
  assert.match(read('pages/hq/HqTeamActions.jsx'), /on All accounts, under Accounts, and on the directory below/);
  assert.match(read('pages/hq/AccountsPage.jsx'), /same table as All accounts, under Accounts\./);
  assert.match(read('pages/docs/sections/admin.js'), /'Open Accounts → All accounts \(\/admin\/accounts\/all\)\.'/);
  assert.match(read('pages/docs/sections/admin.js'), /'Open HQ → Security \(\/admin\/security; Super Admin only\)\.'/);
  assert.match(read('pages/docs/sections/getting-started.js'), /impersonate any user from All accounts, under Accounts,/);
});

test('the guide points its admin articles at mounted pages, not at /admin', async () => {
  const { HELP_SURFACES, GUIDE_PLACEMENT } = await import('../src/pages/docs/guidePlacement.js');
  assert.equal(HELP_SURFACES['/admin'], undefined, '/admin only redirects; a guide cannot send anyone there');
  assert.deepEqual(HELP_SURFACES['/admin/accounts/all'], { label: 'All accounts', roles: ['admin'], lab: false });
  assert.deepEqual(HELP_SURFACES['/admin/security'], { label: 'Security', roles: ['admin'], lab: false });
  const surfaces = Object.fromEntries(Object.entries(GUIDE_PLACEMENT).filter(([k]) => k.startsWith('admin/')).map(([k, v]) => [k, v.surface]));
  assert.deepEqual(surfaces, {
    'admin/overview': '/admin/accounts/all',
    'admin/users': '/admin/accounts/all',
    'admin/trust': '/admin/accounts/all',
    'admin/audit': '/admin/security',
    'admin/feature-flags': null,
    'admin/events-ops': null,
    'admin/assessment-ops': null,
  });
});

test('error reports name the console file, not the retired AdminPage', () => {
  const stale = FILES.filter(({ src }) => /reportError\(\s*['"`]AdminPage:/.test(src)).map(({ file }) => file);
  assert.deepEqual(stale, []);
  const consoles = 'pages/admin/consoles';
  for (const [name, tags] of Object.entries({
    GithubSyncConsole: ['githubConfigLoad'],
    KycConsole: ['loadKycQueue', 'kycRecord'],
    PartnerProfilesConsole: ['loadProfiles', 'partnerProfile'],
    PersonasConsole: ['personas'],
    UsersConsole: ['loadUsers', 'trustScoreBatch', 'loadAdminData'],
    LegalConsole: ['loadContracts', 'forward-log'],
  })) {
    const src = fs.readFileSync(`${ROOT}/${consoles}/${name}.jsx`, 'utf8');
    for (const tag of tags) assert.ok(src.includes(`reportError('${name}:${tag}'`), `${name}:${tag}`);
  }
});
