// #4118 (Roster R2): every persona in the Worker's catalogue has its three
// portrait files in frontend/public/agents/, and every file there belongs to a
// persona. The test checks that the files exist and their sizes; it does not
// judge the art.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const personas = readFileSync(here('../../cloudflare-worker/src/services/agents/personas.ts'), 'utf8');
const KEYS = [...personas.matchAll(/^\s+key: '([a-z]+)', name: '/gm)].map((m) => m[1]);
const DIR = here('../public/agents/');

const pngSize = (file) => {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test('the catalogue has the 16 personas', () => {
  assert.equal(KEYS.length, 16);
  assert.equal(new Set(KEYS).size, 16);
  assert.match(personas, /avatar: `\/agents\/\$\{s\.key\}\.webp`/, 'the avatar path is the file this folder holds');
});

test('every persona has its 1024 png, 512 webp and 256 webp', () => {
  for (const k of KEYS) {
    for (const f of [`${k}.png`, `${k}.webp`, `${k}_256.webp`]) {
      assert.ok(existsSync(DIR + f), `frontend/public/agents/${f} is missing`);
      assert.ok(statSync(DIR + f).size > 1000, `${f} is empty`);
    }
    assert.deepEqual(pngSize(DIR + `${k}.png`), [1024, 1024], `${k}.png is 1024×1024`);
    assert.ok(statSync(DIR + `${k}.png`).size <= 500 * 1024, `${k}.png is under the 500 KB size gate`);
  }
});

test('every file in the folder belongs to a persona', () => {
  const allowed = new Set(['README.md', ...KEYS.flatMap((k) => [`${k}.png`, `${k}.webp`, `${k}_256.webp`])]);
  for (const f of readdirSync(DIR)) assert.ok(allowed.has(f), `frontend/public/agents/${f} belongs to no persona`);
});
