// D9276 (#9276): Eadwyn's command registry and grammar (`frontend/src/lib/commands/`).
// The registry is generated from the cycles' modules and forms; these tests hold it to the code
// (defs, forms, App.jsx's route guards, D9276.md's coverage map) and pin the grammar's answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTIONS, COVERAGE, ENTRIES, EXEMPT_FORMS, HANDLERS, REGISTRY, SCOPES, SECTIONS, SECTION_GUARDS, SHORTCUTS,
  buildRegistry, coverageMarkdown, entriesFor, requiredInputs, visibleTo,
} from '../src/lib/commands/registry.js';
import { parse, search, wordScore } from '../src/lib/commands/grammar.js';
import { MODULES } from '../src/pages/cycles/modules.js';
import { addressFormFor, formsFor } from '../src/pages/cycles/forms.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const founder = { role: 'founder' };
const investor = { role: 'investor' };
const SEGMENT = 'validate.ideal-customer-profile.create-segment';

test('the owner’s example resolves to Create customer segment on Ideal customer profile’s segment form', () => {
  const { entry } = parse('/validate/ideal-customer-profile<create-segment>', { viewer: founder });
  assert.ok(entry, 'an entry');
  assert.equal(entry.id, SEGMENT);
  assert.equal(entry.section, 'validate');
  assert.equal(entry.module, 'ideal-customer-profile');
  assert.equal(entry.action, 'create-segment');
  assert.equal(entry.label, 'Create customer segment · Validate › Ideal customer profile');
  assert.equal(entry.form, 'segment');
  assert.equal(entry.handler, 'form');
  assert.deepEqual(entry.scopes, ['project']);
  assert.equal(entry.href({ projectId: 'p 1' }), '/validate/ideal-customer-profile/new?project_id=p%201');
  assert.equal(entry.href(), '/validate/ideal-customer-profile/new');
});

test('/segment, the spaced form and upper case reach the same entry; plain "segment" suggests it first', () => {
  for (const typed of ['/segment', '/validate/ideal-customer-profile create-segment', ' /Validate/Ideal-Customer-Profile < create-segment > ']) {
    assert.equal(parse(typed, { viewer: founder }).entry?.id, SEGMENT, typed);
  }
  const plain = parse('segment', { viewer: founder });
  assert.equal(plain.entry, undefined, 'a bare word is a search, not a command');
  assert.equal(plain.suggestions?.[0]?.id, SEGMENT);
});

test('a typo answers suggestions, not unknown', () => {
  for (const typed of ['/validate/ideal-custmer-profile<create-segment>', '/segmnet', '/validate/ideal-customer-profile<creat-segment>']) {
    const res = parse(typed, { viewer: founder });
    assert.equal(res.entry, undefined, typed);
    assert.equal(res.unknown, undefined, typed);
    assert.equal(res.suggestions[0].id, SEGMENT, typed);
  }
  assert.equal(wordScore('segment', 'segment'), 3);
  assert.equal(wordScore('seg', 'segment'), 2, 'a prefix');
  assert.equal(wordScore('role', 'rule'), 2, 'one typo in a short word');
  assert.equal(wordScore('kpo', 'kpi'), 0, 'no typo allowance under four letters');
  assert.equal(wordScore('segmnetz', 'segment'), 1, 'two typos in a long word');
  assert.deepEqual(parse('/kpis', { viewer: founder }).suggestions?.[0]?.id, 'grow.revenue-and-traction.enter-kpi');
  assert.deepEqual(parse('xyzzy qqq', { viewer: founder }), { unknown: 'xyzzy qqq' });
  assert.deepEqual(parse('   ', { viewer: founder }), { unknown: '' });
});

test('a module path opens the module; a later form carries ?form=', () => {
  const { entry } = parse('/raise/use-of-funds', { viewer: founder });
  assert.equal(entry.kind, 'module');
  assert.equal(entry.handler, 'navigate');
  assert.equal(entry.href({ projectId: 'p1' }), '/raise/use-of-funds?project_id=p1');
  const first = { key: 'a', cta: 'A', fields: [] };
  const second = { key: 'b', cta: 'B', fields: [] };
  const built = buildRegistry({
    modules: { validate: [{ slug: 'm', name: 'M' }] }, formsFor: () => [first, second],
    actions: { 'validate/m#a': { action: 'do-a', label: 'Do A', alias: 'a' }, 'validate/m#b': { action: 'do-b', label: 'Do B', alias: 'b' } },
    shortcuts: [], sections: { validate: 'Validate' },
  });
  const hrefs = built.entries.filter((e) => e.kind === 'action').map((e) => e.href({ projectId: 'p1' }));
  assert.deepEqual(hrefs, ['/validate/m/new?project_id=p1', '/validate/m/new?project_id=p1&form=b']);
});

test('an investor sees none of Validate’s founder actions; a Spin-Out Lab investor does, as labRoles admits', () => {
  const seen = entriesFor(investor);
  assert.equal(seen.filter((e) => e.section === 'validate').length, 0);
  assert.equal(parse('/validate/ideal-customer-profile<create-segment>', { viewer: investor }).entry, undefined);
  assert.equal(parse('/segment', { viewer: investor }).entry, undefined);
  const hinted = parse('/validate/ideal-customer-profile<create-segment>', { viewer: investor });
  assert.ok(!(hinted.suggestions || []).some((e) => e.section === 'validate'), 'not even as a suggestion');
  const lab = { role: 'investor', spinoutLabActive: true };
  assert.equal(parse('/segment', { viewer: lab }).entry?.id, SEGMENT);
  // Grow's routes are a plain guard: a lab investor is not admitted there.
  assert.equal(entriesFor(lab).filter((e) => e.section === 'grow').length, 0);
  assert.equal(visibleTo(ENTRIES[0], null), false);
  assert.equal(parse('/explain', { viewer: investor }).entry?.id, 'shortcut.explain');
});

test('a typed path resolves only to a listed entry, never to an address of its own', () => {
  for (const typed of ['/api/admin/users', '/validate/ideal-customer-profile<../../api/users>', '/validate/ideal-customer-profile/new',
    '/validate/ideal-customer-profile<create-segment>?x=1', '/validate/nope<create-segment>']) {
    assert.equal(parse(typed, { viewer: founder }).entry, undefined, typed);
  }
  for (const e of ENTRIES) {
    const href = e.href({ projectId: 'p1' });
    if (href === null) continue;
    assert.ok(!href.startsWith('/api'), e.id);
    assert.ok(href.startsWith(e.kind === 'shortcut' ? e.result.split('?')[0] : `/${e.section}/${e.module}`), e.id);
  }
});

test('the five shortcuts, each with its handler', () => {
  const byName = Object.fromEntries(['record', 'task', 'ticket', 'team', 'explain'].map((n) => [n, parse(`/${n}`, { viewer: founder }).entry]));
  assert.deepEqual(Object.values(byName).map((e) => e?.handler), ['record', 'task', 'ticket', 'team', 'explain']);
  assert.equal(byName.record.href({ projectId: 'p1' }), '/validate/record?project_id=p1');
  assert.equal(byName.task.href({ projectId: 'p1' }), '/studio/tickets/new?type=task');
  assert.equal(byName.team.coverage, 'unavailable');
  assert.match(byName.team.unavailable, /#9282/);
  assert.equal(byName.team.href(), null);
});

test('parity: every module and form has its entry, no row is stale, no name is used twice', () => {
  assert.deepEqual(REGISTRY.missing, []);
  assert.deepEqual(REGISTRY.stale, []);
  assert.deepEqual(REGISTRY.duplicates, []);
  for (const [section, mods] of Object.entries(MODULES)) {
    assert.ok(Object.hasOwn(SECTIONS, section), section);
    for (const mod of mods) {
      assert.ok(ENTRIES.some((e) => e.kind === 'module' && e.id === `${section}.${mod.slug}`), `${section}/${mod.slug}`);
      for (const form of formsFor(section, mod.slug)) {
        const key = `${section}/${mod.slug}#${form.key}`;
        assert.ok(Object.hasOwn(EXEMPT_FORMS, key) || ENTRIES.some((e) => e.section === section && e.module === mod.slug && e.form === form.key), key);
      }
    }
  }
  assert.equal(Object.keys(ACTIONS).length, ENTRIES.filter((e) => e.kind === 'action').length);
});

test('parity fails when a form is added without an entry, or an entry outlives its form', () => {
  const added = { key: 'brand-new', cta: 'Add it', fields: [] };
  const withExtra = (s, m) => (s === 'validate' && m === 'ideal-customer-profile' ? [...formsFor(s, m), added] : formsFor(s, m));
  assert.deepEqual(buildRegistry({ formsFor: withExtra }).missing, ['validate/ideal-customer-profile#brand-new']);
  const without = (s, m) => (s === 'validate' && m === 'ideal-customer-profile' ? [] : formsFor(s, m));
  assert.deepEqual(buildRegistry({ formsFor: without }).stale, ['validate/ideal-customer-profile#segment']);
  const exempted = buildRegistry({ formsFor: withExtra, exempt: { ...EXEMPT_FORMS, 'validate/ideal-customer-profile#brand-new': 'a reason' } });
  assert.deepEqual(exempted.missing, []);
  assert.ok(!exempted.entries.some((e) => e.form === 'brand-new'), 'an exempt form has no entry');
  const twice = { ...ACTIONS, 'validate/problem-discovery#theme': { ...ACTIONS['validate/problem-discovery#theme'], alias: 'segment' } };
  assert.deepEqual(buildRegistry({ actions: twice }).duplicates, ['/segment']);
});

test('the registry reads every cycle the defs draw', () => {
  const defs = readdirSync(resolve(ROOT, 'frontend/src/pages/cycles/defs')).filter((f) => f.endsWith('.jsx'));
  assert.deepEqual(defs.map((f) => f.replace(/\.jsx$/, '')).sort(), Object.keys(SECTIONS).sort());
  for (const f of defs) {
    const cycle = f.replace(/\.jsx$/, '');
    assert.match(read(`frontend/src/pages/cycles/defs/${f}`), new RegExp(`modules: MODULES\\.${cycle},`), f);
  }
});

test('each exemption names a form that exists', () => {
  for (const key of Object.keys(EXEMPT_FORMS)) {
    const [path, formKey] = key.split('#');
    const [section, slug] = path.split('/');
    assert.ok(addressFormFor(section, slug, formKey) || formsFor(section, slug).some((f) => f.key === formKey), key);
    assert.ok(EXEMPT_FORMS[key].length > 20, `${key} says why`);
  }
});

test('who sees an entry is the route guard in App.jsx', () => {
  const app = read('frontend/src/App.jsx');
  const guardOf = (path) => {
    const m = new RegExp(`<Route path="${path.replace(/[?]/g, '\\?')}" element=\\{guard\\((labRoles\\()?\\[([^\\]]*)\\]`).exec(app);
    assert.ok(m, path);
    return { roles: m[2].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean), labRoles: Boolean(m[1]) };
  };
  for (const section of Object.keys(SECTIONS)) {
    for (const path of [`/${section}/:slug`, `/${section}/:slug/new`]) assert.deepEqual(guardOf(path), SECTION_GUARDS[section], path);
  }
  for (const s of SHORTCUTS.filter((x) => x.href)) {
    assert.deepEqual(guardOf(s.href.split('?')[0]), { roles: s.roles, labRoles: s.labRoles }, s.name);
  }
});

test('each entry carries what the composer needs, from the closed vocabularies', () => {
  const ids = new Set();
  for (const e of ENTRIES) {
    assert.ok(!ids.has(e.id), `${e.id} once`);
    ids.add(e.id);
    assert.ok(HANDLERS.includes(e.handler), e.id);
    assert.ok(COVERAGE.includes(e.coverage), e.id);
    assert.ok(e.scopes.length && e.scopes.every((s) => SCOPES.includes(s)), e.id);
    assert.ok(Array.isArray(e.inputs) && Array.isArray(e.aliases), e.id);
    assert.ok(e.roles === null || e.roles.length > 0, e.id);
    assert.equal(e.coverage === 'unavailable', Boolean(e.unavailable), e.id);
    for (const k of ['preview', 'writer', 'result', 'errors']) assert.ok(Object.hasOwn(e, k), `${e.id} ${k}`);
    if (e.kind === 'action') {
      assert.match(e.action, /^[a-z0-9]+(-[a-z0-9]+)*$/, e.id);
      assert.equal(e.aliases.length, 1, `${e.id}: one short alias`);
      assert.equal(e.coverage, 'draftable', e.id);
    }
  }
});

test('an action’s required inputs are its form’s required fields', () => {
  const segmentForm = formsFor('validate', 'ideal-customer-profile')[0];
  const entry = ENTRIES.find((e) => e.id === SEGMENT);
  assert.deepEqual(entry.inputs, segmentForm.fields.filter((f) => f.required === true).map((f) => f.name));
  assert.ok(entry.inputs.length > 0);
  assert.deepEqual(requiredInputs({ fields: [{ name: 'a', required: true }, { name: 'b' }, { fields: [{ name: 'c', required: true }] }] }), ['a', 'c']);
  assert.deepEqual(requiredInputs(null), []);
});

test('search ranks an exact alias above a near one and caps the list', () => {
  assert.equal(search('kpi', ENTRIES)[0].id, 'grow.revenue-and-traction.enter-kpi');
  assert.ok(search('add', ENTRIES).length <= 5);
  assert.deepEqual(search('', ENTRIES), []);
});

test('D9276.md carries the coverage map the registry generates', () => {
  const doc = read('documentation/architecture/decisions/D9276.md');
  const m = /<!-- coverage:begin -->\n([\s\S]*?)\n<!-- coverage:end -->/.exec(doc);
  assert.ok(m, 'the coverage block');
  assert.equal(m[1], coverageMarkdown(), 'regenerate it: node -e "import(\'./frontend/src/lib/commands/registry.js\').then((r) => console.log(r.coverageMarkdown()))"');
});
