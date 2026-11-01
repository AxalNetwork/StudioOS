/**
 * #3953 (agent skills B, D1612): the Axal starter skill library. Each skill is
 * a SKILL.md file in `src/services/agents/skills/<slug>.md`, in #3951's format,
 * with one golden case in `skills/cases/<slug>.json` for part D (#3954).
 *
 * Every file is parsed here as data, never executed, and held to the catalogue:
 *   - every role is a role key in `services/agents/catalogue.ts`;
 *   - every taxonomy key is a `skills.slug` from migrations 089/090, and every
 *     level is one of aware, working, proficient, advanced and expert;
 *   - every tool ends in `.read`, and names a read the catalogue grants (a
 *     `READ_KEYS` entry under the same source: `stripe.read` → `stripe.revenue`);
 *   - each skill has at least one numbered step, a case, version 1 and no
 *     duplicate slug; the file name is its slug.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_skill_library_d1612.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { READ_KEYS, ROLES } from '../src/services/agents/catalogue.ts';

const DIR = new URL('../src/services/agents/skills/', import.meta.url);
const LEVELS = ['aware', 'working', 'proficient', 'advanced', 'expert'];
const OUTPUTS = ['draft', 'record_change', 'brief'];
const MAX_BYTES = 32 * 1024;

const TAXONOMY = new Set([...readFileSync(new URL('../sql/migrations/090_seed_skills_values_taxonomy.sql', import.meta.url), 'utf8')
  .matchAll(/^\s*\('([a-z_]+)',\s*'([a-z_]+)',/gm)].filter((m) => m[2] !== m[1]).map((m) => m[1]));
const ROLE_KEYS = new Set(ROLES.map((r) => r.key));
const READ_SOURCES = new Set(READ_KEYS.map((k) => k.split('.')[0]));

type Skill = { file: string; front: Record<string, string>; steps: string[]; raw: string };

/** #3951's SKILL.md: a `---` frontmatter of `key: value` lines, then an ordered list. Parsed as data only. */
export function parseSkill(file: string, raw: string): Skill {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  assert.ok(m, `${file}: no frontmatter`);
  const front: Record<string, string> = {};
  for (const line of m![1].split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    assert.ok(kv, `${file}: a frontmatter line is not key: value (${line})`);
    assert.ok(!(kv![1] in front), `${file}: ${kv![1]} twice`);
    front[kv![1]] = kv![2].trim();
  }
  const steps = m![2].split('\n').filter((l) => l.trim()).map((l) => {
    const s = /^(\d+)\.\s+(\S.*)$/.exec(l);
    assert.ok(s, `${file}: a body line is not a numbered step (${l})`);
    return s![2];
  });
  return { file, front, steps, raw };
}
const list = (v: string) => { const m = /^\[(.*)\]$/.exec(v); assert.ok(m, `not a [list]: ${v}`); return m![1].split(',').map((x) => x.trim()).filter(Boolean); };
const map = (v: string) => {
  const m = /^\{(.*)\}$/.exec(v); assert.ok(m, `not a {map}: ${v}`);
  return Object.fromEntries(m![1].split(',').map((p) => p.split(':').map((x) => x.trim())).filter((p) => p[0]));
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
const skills = files.map((f) => parseSkill(f, readFileSync(new URL(f, DIR), 'utf8')));

test('the library holds about twelve skills, one file each, named by slug, none twice', () => {
  assert.ok(skills.length >= 10 && skills.length <= 16, `${skills.length} skills`);
  const names = skills.map((s) => s.front.name);
  assert.equal(new Set(names).size, names.length, 'a duplicate slug');
  for (const s of skills) {
    assert.match(s.front.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, s.file);
    assert.equal(`${s.front.name}.md`, s.file, `${s.file}: the file is not named by its slug`);
    assert.ok(Buffer.byteLength(s.raw) <= MAX_BYTES, `${s.file}: over 32 KB`);
    assert.doesNotMatch(s.raw, /<[a-z!/][^>]*>/i, `${s.file}: HTML in a skill`);
  }
});

test('every skill has its frontmatter: description, roles, tools, output, taxonomy, version 1', () => {
  for (const s of skills) {
    for (const k of ['name', 'description', 'roles', 'tools', 'output', 'taxonomy', 'version']) assert.ok(s.front[k], `${s.file}: no ${k}`);
    assert.deepEqual(Object.keys(s.front).sort(), ['description', 'name', 'output', 'roles', 'taxonomy', 'tools', 'version'], `${s.file}: an unknown key`);
    assert.equal(s.front.version, '1', s.file);
    assert.ok(OUTPUTS.includes(s.front.output), `${s.file}: output ${s.front.output}`);
    assert.ok(s.front.description.length >= 20 && s.front.description.length <= 200, `${s.file}: description length`);
  }
});

test('every role is a catalogue role, and every taxonomy slug and level exists', () => {
  assert.ok(TAXONOMY.size > 100, 'the taxonomy seed was read');
  for (const s of skills) {
    const roles = list(s.front.roles);
    assert.ok(roles.length >= 1, `${s.file}: no role`);
    for (const r of roles) assert.ok(ROLE_KEYS.has(r), `${s.file}: unknown role ${r}`);
    const tax = map(s.front.taxonomy);
    assert.ok(Object.keys(tax).length >= 1, `${s.file}: no taxonomy tag`);
    for (const [slug, level] of Object.entries(tax)) {
      assert.ok(TAXONOMY.has(slug), `${s.file}: unknown taxonomy slug ${slug}`);
      assert.ok(LEVELS.includes(level), `${s.file}: unknown level ${level}`);
    }
  }
});

test('every tool is a read: it ends in .read and names a source the catalogue grants', () => {
  for (const s of skills) {
    const tools = list(s.front.tools);
    assert.ok(tools.length >= 1, `${s.file}: no tool`);
    for (const t of tools) {
      assert.match(t, /^[a-z_]+\.read$/, `${s.file}: ${t} is not a read tool`);
      assert.ok(READ_SOURCES.has(t.slice(0, -'.read'.length)), `${s.file}: ${t} names no read the catalogue grants`);
    }
  }
});

test('each skill has numbered steps, says "Not recorded" for a missing figure, and proposes rather than acts', () => {
  for (const s of skills) {
    assert.ok(s.steps.length >= 1, `${s.file}: no step`);
    assert.ok(s.steps.length <= 12, `${s.file}: too many steps`);
    const body = s.steps.join(' ');
    assert.match(body, /Not recorded|No record found|No change recorded|No due date recorded|stop and propose nothing/, `${s.file}: never says what is missing`);
    assert.match(body, /Propose/, `${s.file}: never proposes`);
    // A step is a read, a write-up or a proposal: none begins by acting on the world.
    for (const step of s.steps) assert.doesNotMatch(step, /^(Send|Publish|Post|Approve|Reject|Delete|Pay|Sign|File|Invite|Share)\b/, `${s.file}: a step that acts (${step})`);
  }
});

test('each skill has one golden case, naming the skill, its output and what the proposal must say', () => {
  const cases = readdirSync(new URL('cases/', DIR)).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(cases, files.map((f) => f.replace(/\.md$/, '.json')), 'a skill without a case, or a case without a skill');
  for (const s of skills) {
    const c = JSON.parse(readFileSync(new URL(`cases/${s.front.name}.json`, DIR), 'utf8'));
    assert.equal(c.skill, s.front.name);
    assert.equal(c.version, 1);
    assert.equal(c.expect.output, s.front.output, `${s.file}: the case expects another output`);
    assert.ok(c.input && typeof c.input.records === 'object' && Object.keys(c.input.records).length, `${s.file}: a case with no input records`);
    assert.ok(Array.isArray(c.expect.must_include) && c.expect.must_include.length, `${s.file}: nothing the proposal must say`);
    for (const k of ['must_say_not_recorded', 'must_not_include']) assert.ok(Array.isArray(c.expect[k]), `${s.file}: ${k}`);
    // The case's records come from reads the skill is given (catalogue read keys, by source).
    const sources = new Set(list(s.front.tools).map((t) => t.slice(0, -'.read'.length)));
    for (const key of Object.keys(c.input.records)) assert.ok(sources.has(key.split('.')[0]), `${s.file}: the case feeds ${key}, which the skill does not read`);
    assert.doesNotMatch(JSON.stringify(c), /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/, `${s.file}: an email address in a case`);
  }
});
