/**
 * Every brand-template bunfig must keep Bun's install cooldown at Semgrep's
 * 7-day floor (`package_managers.bun.bun-missing-minimum-release-age`).
 *
 * 86400 (one day) is a valid Bun setting and was what the Lovable kits
 * shipped. The rule still opens an alert for any value below 604800, which
 * is how #4615–#4630 landed. Pin the number here so a kit refresh cannot
 * silently walk it back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'brandtemplates');
const FLOOR = 604800;

function bunfigs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...bunfigs(full));
    else if (name === 'bunfig.toml' || name === '.bunfig.toml') out.push(full);
  }
  return out;
}

test('every brandtemplate bunfig waits at least seven days before a new package version', () => {
  const files = bunfigs(ROOT);
  assert.ok(files.length >= 16, `expected the sixteen kits, found ${files.length}`);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const m = text.match(/minimumReleaseAge\s*=\s*(\d+)/);
    assert.ok(m, `${file} has no numeric minimumReleaseAge`);
    assert.ok(
      Number(m[1]) >= FLOOR,
      `${file} sets minimumReleaseAge = ${m[1]} (Semgrep's floor is ${FLOOR})`,
    );
  }
});
