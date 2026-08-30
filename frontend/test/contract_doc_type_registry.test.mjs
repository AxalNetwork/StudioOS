/**
 * The doc-type registry above templates: every contract type is fully declared.
 *
 * A template is a *version of* a thing — `v3.1` of a Subsidiary Licence. The
 * THING is the doc type, and the Contracts · Super canvas is organised around
 * it: each type has a layer, a party pair, and a version history beneath it.
 *
 * The registry turned out to be complete already. `CONTRACT_DOC_TYPES` lists 33
 * canonical contract types, and all 33 carry a title and layer in `TEMPLATES`
 * and a party pair in `DOC_TYPE_PARTY_ROLES`. What was missing is anything
 * MAKING that true — a 34th type could be added to `CONTRACT_DOC_TYPES` alone
 * and nothing would notice. The consequences are quiet and specific:
 *
 *   · `row.doc_type_label = TEMPLATES[dt]?.title || dt` renders the raw slug
 *     as the contract's name in Admin › Contracts.
 *   · `GET /admin/contracts/templates/:doc_type` falls through to the D1 store
 *     and 404s `unknown_template` when no row exists there.
 *   · The type is absent from every layer-grouped view, since it has no layer.
 *
 * A NOTE ON THE PARSER, because it cost two wrong conclusions while this was
 * being written. Two titles use DOUBLE quotes — "Voting & Investors' Rights
 * Agreement" and "Finder's Fee / Intro Agreement" — because they contain an
 * apostrophe. A `title: '[^']*'` regex silently drops exactly those two and
 * reports them as unregistered. Both patterns are matched below, and the last
 * test fails if a title style appears that neither handles, so this cannot
 * quietly under-report again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_contracts.ts'), 'utf8');

const block = (a, b) => {
  const i = src.indexOf(a);
  assert.ok(i > -1, `could not find ${a}`);
  const j = src.indexOf(b, i);
  assert.ok(j > -1, `could not find the end of ${a}`);
  return src.slice(i, j);
};

const canonBlock = block('export const CONTRACT_DOC_TYPES', ']);');
const CANON = [...new Set([...canonBlock.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]))];

const tplBlock = block('const TEMPLATES: Record<string, { title: string; layer: string }> = {', '\n};');
/** Both quote styles — see the note above. */
const TPL_ENTRY = /^\s+([a-z0-9_]+): \{ title: (?:'[^']*'|"[^"]*"), layer: '([a-z]+)' \}/gm;
const TEMPLATES = Object.fromEntries([...tplBlock.matchAll(TPL_ENTRY)].map((m) => [m[1], m[2]]));

const rolesBlock = block('export const DOC_TYPE_PARTY_ROLES', '\n};');
const ROLES = new Set([...rolesBlock.matchAll(/^\s+([a-z0-9_]+):/gm)].map((m) => m[1]));

const layersBlock = block('const TEMPLATE_LAYERS', '\n};');
const LAYERS = new Set([...layersBlock.matchAll(/^\s+([a-z]+): \{ label:/gm)].map((m) => m[1]));

test('the three maps parse, at the sizes the registry actually has', () => {
  assert.equal(CANON.length, 33, `CONTRACT_DOC_TYPES parsed as ${CANON.length}`);
  assert.equal(Object.keys(TEMPLATES).length, 33, `TEMPLATES parsed as ${Object.keys(TEMPLATES).length}`);
  assert.ok(ROLES.size >= 33, `DOC_TYPE_PARTY_ROLES parsed as ${ROLES.size}`);
  assert.deepEqual([...LAYERS].sort(), ['compliance', 'fund', 'gp', 'portfolio']);
});

test('every contract doc type has a title and a layer', () => {
  const missing = CANON.filter((t) => !TEMPLATES[t]);
  assert.deepEqual(missing, [],
    'these would render as a raw slug in Admin › Contracts and 404 on their template detail');
});

test('every contract doc type has a party pair', () => {
  const missing = CANON.filter((t) => !ROLES.has(t));
  assert.deepEqual(missing, [],
    'these cannot be filtered by party role — the filter would silently exclude them');
});

test('every layer a type claims is a declared layer', () => {
  const unknown = [...new Set(Object.values(TEMPLATES))].filter((l) => !LAYERS.has(l));
  assert.deepEqual(unknown, [],
    'TEMPLATE_LAYERS[layer]?.label falls back to the raw key, so the UI would show "gp2"');
});

test('no layer is declared and then used by nothing', () => {
  // A layer with no members is a heading over an empty list.
  const used = new Set(Object.values(TEMPLATES));
  const empty = [...LAYERS].filter((l) => !used.has(l));
  assert.deepEqual(empty, [], 'these layers would render as empty groups');
});

test('the parser handles every title style present', () => {
  // The guard against the mistake that produced two wrong conclusions while
  // this file was written: a title quoted some third way would be dropped by
  // TPL_ENTRY and silently under-report coverage.
  const titles = [...tplBlock.matchAll(/^\s+[a-z0-9_]+: \{ title: (.)/gm)].map((m) => m[1]);
  const styles = [...new Set(titles)];
  assert.deepEqual(styles.sort(), ['"', "'"],
    `a title quote style appeared that TPL_ENTRY does not match: ${styles.join(' ')}`);
  assert.equal(titles.length, Object.keys(TEMPLATES).length,
    'TPL_ENTRY matched fewer entries than there are titles — it is under-reporting');
});
