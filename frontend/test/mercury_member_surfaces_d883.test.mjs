/**
 * D883 (#2556) — the guard that keeps Axal VC's own Mercury accounts off
 * member surfaces (`scripts/check-mercury-member-surfaces.mjs`).
 *
 *   1. A clean tree passes; each way an entity line could come back fails,
 *      naming its file and line.
 *   2. Comments and HQ's own files are never findings; a string such as
 *      `'/api/*'` does not hide what follows it.
 *   3. A file the guard reads that is missing is a finding, not a pass.
 *   4. The repository itself is clean (D879–D881, #2552–#2554, on `main`).
 *
 * The fixture files are synthetic: they carry the shapes the guard reads,
 * never the real pages.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mercury_member_surfaces_d883.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { codeOnly, scanMemberSurfaces } from '../../scripts/check-mercury-member-surfaces.mjs';

const REPO = resolve(import.meta.dirname, '../..');

const CLEAN = {
  'frontend/src/pages/account/ConnectorPage.jsx': [
    "import { isPersonalMercury } from './connectorsModel';",
    '// Axal VC\'s entity accounts moved to HQ (D880); see MercuryEntitySheet there.',
    '/* adminMercury is HQ\'s, never read here. */',
    "export default function ConnectorPage({ p }) { return <section>{/* the Axal entities are HQ's */}{p.name}</section>; }",
  ].join('\n'),
  'frontend/src/pages/account/connectorsModel.js': [
    "export const isPersonalMercury = (p) => p?.key === 'mercury';",
    "export const GLOB = '/api/*';",
    "export const label = 'Your own Mercury account';",
  ].join('\n'),
  'frontend/src/pages/admin/fundAdmin/MercuryEntitySheet.jsx':
    "import { adminMercuryApi } from '../../../lib/api/adminMercury';\nexport const title = 'The four Axal entities';",
  'cloudflare-worker/src/integrations/registry.ts': [
    "const DOCS = 'https://docs.mercury.com/*';",
    'export const PROVIDERS = [',
    '  {',
    "    key: 'mercury', display_name: 'Mercury',",
    "    description: 'Your own Mercury account, read-only, for Grow and Raise.',",
    "    preview_roles: ['admin'], personal_roles: ['founder', 'partner', 'investor'],",
    '  },',
    '];',
    'export const CONNECTOR_METADATA = {',
    "  mercury: { pulls: [], sends: [], permissions: ['Sign in with Mercury: read your own accounts.'] },",
    '};',
  ].join('\n'),
  'cloudflare-worker/src/integrations/connectorPages.ts': [
    "type MercuryVariant = 'founder' | 'partner' | 'investor';",
    'function mercuryPage(variant: MercuryVariant) {',
    "  return { tagline: 'Credits from your own Mercury account.' };",
    '}',
  ].join('\n'),
  'cloudflare-worker/src/routes/integrations.ts': "export const connect = () => ({ error: 'not_connectable' });",
  'cloudflare-worker/src/routes/mercury_personal.ts': "export const personal = () => 'your own Mercury';",
};

function tree(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'd883-'));
  for (const [rel, body] of Object.entries({ ...CLEAN, ...overrides })) {
    if (body === null) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
function scan(overrides) {
  const root = tree(overrides);
  try { return scanMemberSurfaces(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const said = (findings) => findings.map((f) => `${f.file}:${f.line} ${f.what}`);
const replaceIn = (rel, from, to) => {
  assert.ok(CLEAN[rel].includes(from), `${rel} holds ${from}`);
  return { [rel]: CLEAN[rel].replace(from, to) };
};

test('a clean tree passes: comments, HQ files and glob strings are not findings', () => {
  assert.deepEqual(scan(), []);
});

test('a member page naming the entity accounts, their table, the admin API or the entity sheet fails, at its line', () => {
  const page = 'frontend/src/pages/account/ConnectorPage.jsx';
  const cases = [
    ["import { isPersonalMercury } from './connectorsModel';", "import { adminMercuryApi } from '../../lib/api/adminMercury';", 'names the admin Mercury API'],
    ['{p.name}', "{'The Axal entity accounts'}", 'names an Axal entity'],
    ['{p.name}', '<MercuryEntitySheet p={p} />', 'names the entity sheet'],
    ['{p.name}', "{p.connection_source === 'mercury_entity_connections'}", 'names mercury_entity_connections'],
    ['{p.name}', '{isEntityRow(p)}', 'names the entity helpers'],
  ];
  for (const [from, to, what] of cases) {
    const out = scan(replaceIn(page, from, to));
    assert.equal(out.length >= 1, true, to);
    assert.ok(out.some((f) => f.file === page && f.what.startsWith(what)), `${to}: ${said(out)}`);
    assert.ok(out.every((f) => f.line > 0), 'every finding has its line');
  }
  const line = scan(replaceIn(page, '{p.name}', "{'The Axal entity accounts'}"))[0];
  assert.equal(line.line, 4, 'the line in the file, comments counted');
  const model = scan(replaceIn('frontend/src/pages/account/connectorsModel.js', "'Your own Mercury account'", "'Axal VC entity accounts'"));
  assert.ok(model.some((f) => f.file === 'frontend/src/pages/account/connectorsModel.js' && f.line === 3), said(model));
});

test("the registry's mercury row and metadata, and any routing to the entity table, fail", () => {
  const reg = 'cloudflare-worker/src/integrations/registry.ts';
  const roles = scan(replaceIn(reg, "preview_roles: ['admin'],", "entity_roles: ['admin'],"));
  assert.deepEqual(said(roles), [`${reg}:6 gives the \`mercury\` row \`entity_roles\` again`]);
  const description = scan(replaceIn(reg, "'Your own Mercury account, read-only, for Grow and Raise.'", "'Balances of the Axal entity accounts.'"));
  assert.ok(said(description).some((s) => s.startsWith(`${reg}:5 the \`mercury\` row names an Axal entity`)), said(description));
  const meta = scan(replaceIn(reg, "'Sign in with Mercury: read your own accounts.'", "'Read the entity accounts a Super Admin connects.'"));
  assert.ok(said(meta).some((s) => s.startsWith(`${reg}:10 \`CONNECTOR_METADATA.mercury\` names the entity accounts`)), said(meta));
  const source = scan(replaceIn(reg, '];\nexport const CONNECTOR_METADATA', "];\nconst SOURCE = { mercury: 'mercury_entity_connections' };\nexport const CONNECTOR_METADATA"));
  assert.ok(said(source).some((s) => s === `${reg}:9 routes a connector to \`mercury_entity_connections\``), said(source));
  assert.equal(scan(replaceIn(reg, "preview_roles: ['admin'],", "// entity_roles: ['admin'] went with D879\n    preview_roles: ['admin'],")).length, 0, 'a comment is not a role');
});

test("Mercury's connector pages and the member connect routes fail on an entity variant or refusal", () => {
  const pages = 'cloudflare-worker/src/integrations/connectorPages.ts';
  const variant = scan(replaceIn(pages, "'founder' | 'partner'", "'entity' | 'founder' | 'partner'"));
  assert.deepEqual(said(variant), [`${pages}:1 gives Mercury's pages an \`entity\` variant again`]);
  const tagline = scan(replaceIn(pages, "'Credits from your own Mercury account.'", "'Balances of the Axal entity accounts.'"));
  assert.ok(said(tagline).some((s) => s.startsWith(`${pages}:3 \`mercuryPage\` names`)), said(tagline));
  for (const route of ['cloudflare-worker/src/routes/integrations.ts', 'cloudflare-worker/src/routes/mercury_personal.ts']) {
    const refusal = scan({ [route]: "export const connect = () => ({ error: 'entity_connection_only' });" });
    assert.deepEqual(said(refusal), [`${route}:1 answers a member with the entity refusal (\`entity_connection_only\`) again`]);
  }
});

test('a file the guard reads that is missing is a finding, never a pass', () => {
  const out = scan({ 'cloudflare-worker/src/integrations/connectorPages.ts': null });
  assert.deepEqual(said(out), ['cloudflare-worker/src/integrations/connectorPages.ts:0 is missing, so it cannot be checked']);
  const noRow = scan(replaceIn('cloudflare-worker/src/integrations/registry.ts', "key: 'mercury'", "key: 'mercury_x'"));
  assert.ok(said(noRow).some((s) => s.includes('has no `mercury` provider row to check')), said(noRow));
});

test('codeOnly blanks comments, keeps strings and every line', () => {
  const src = "const a = '/api/*'; // note\n/* block\n line */ const b = \"x // y\";\nconst c = `t /* u */`;";
  const out = codeOnly(src);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(out.includes("'/api/*'") && out.includes('"x // y"') && out.includes('`t /* u */`'));
  assert.equal(/note|block/.test(out), false);
});

test('the repository: no member surface names Axal VC\'s own Mercury accounts (D879–D881 on main)', () => {
  assert.deepEqual(said(scanMemberSurfaces(REPO)), []);
});
