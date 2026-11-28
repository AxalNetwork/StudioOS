/**
 * #9209: the image's apt packages come from one fixed Debian snapshot, so two
 * builds of one commit install the same packages.
 *
 * Reads `Dockerfile` and fails when an apt install (`apt-get install`, `apt
 * install` or `playwright install-deps`) runs in a stage before the snapshot
 * source is written, unless every package it names carries `=<version>`; when
 * `playwright install --with-deps` is used (it installs from whatever source
 * is configured, and hides the step); when the snapshot date is not a fixed
 * timestamp; or when the installed list is not written to its known path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DOCKERFILE = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const PACKAGE_LIST = '/usr/share/meeting-bot/apt-packages.txt';

interface Instruction { line: number; op: string; args: string }

function instructions(text: string): Instruction[] {
  const out: Instruction[] = [];
  let buffer = '';
  let start = 0;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trimEnd();
    if (line.trim().startsWith('#') || (!buffer && line.trim() === '')) return;
    if (!buffer) start = index + 1;
    buffer += `${line.replace(/\\$/, '')} `;
    if (line.endsWith('\\')) return;
    const match = /^\s*(\w+)\s+([\s\S]*)$/.exec(buffer);
    if (match) out.push({ line: start, op: match[1].toUpperCase(), args: match[2].trim() });
    buffer = '';
  });
  return out;
}

const INSTRUCTIONS = instructions(DOCKERFILE);
const commandsOf = (run: Instruction): string[] => run.args.split(/&&|;/).map((c) => c.trim());

function snapshotDate(): string | undefined {
  for (const i of INSTRUCTIONS) {
    const m = i.op === 'ARG' ? /^DEBIAN_SNAPSHOT=(\S+)$/.exec(i.args) : null;
    if (m) return m[1];
  }
  return undefined;
}

/** A command that replaces the apt source with the snapshot for the fixed date. */
function writesSnapshotSource(command: string, date: string): boolean {
  const stamp = `(?:\\$\\{DEBIAN_SNAPSHOT\\}|${date})`;
  return new RegExp(`URIs: http://snapshot\\.debian\\.org/archive/debian/${stamp}["' ]`).test(command)
    && new RegExp(`URIs: http://snapshot\\.debian\\.org/archive/debian-security/${stamp}["' ]`).test(command)
    && !/deb\.debian\.org/.test(command)
    && />\s*\/etc\/apt\/sources\.list\.d\/debian\.sources$/.test(command);
}

const INSTALL = /\bapt(?:-get)?\s+(?:-\S+\s+)*install\b|\bplaywright\s+install-deps\b/;

function versioned(command: string): boolean {
  const m = /\bapt(?:-get)?\s+(?:-\S+\s+)*install\s+(.*)$/.exec(command);
  if (!m) return false;
  const packages = m[1].split(/\s+/).filter((word) => word && !word.startsWith('-'));
  return packages.length > 0 && packages.every((name) => /^[a-z0-9][a-z0-9+.-]*=\S+$/.test(name));
}

interface Install { line: number; command: string; pinned: boolean }

/** Each apt install, and whether its stage had replaced the apt source before it. */
function installs(date: string): Install[] {
  const stagePinned = new Map<string, boolean>();
  const found: Install[] = [];
  let stage = '';
  let pinned = false;
  let replacesListFile = false;
  for (const i of INSTRUCTIONS) {
    if (i.op === 'FROM') {
      const [image, , name] = i.args.split(/\s+/);
      pinned = stagePinned.get(image) ?? false;
      stage = name ?? '';
      stagePinned.set(stage, pinned);
      continue;
    }
    if (i.op !== 'RUN') continue;
    const commands = commandsOf(i);
    replacesListFile = commands.some((c) => /^rm -f \/etc\/apt\/sources\.list$/.test(c));
    for (const command of commands) {
      if (INSTALL.test(command)) found.push({ line: i.line, command, pinned: pinned || versioned(command) });
      if (writesSnapshotSource(command, date) && replacesListFile) pinned = true;
    }
    stagePinned.set(stage, pinned);
  }
  return found;
}

test('the snapshot date is a fixed timestamp, not a moving suite', () => {
  const date = snapshotDate();
  assert.ok(date, 'Dockerfile declares ARG DEBIAN_SNAPSHOT=<YYYYMMDDTHHMMSSZ>');
  assert.match(date, /^\d{8}T\d{6}Z$/);
});

test('snapshot Release files are accepted past their Valid-Until', () => {
  assert.match(DOCKERFILE, /'Acquire::Check-Valid-Until "false";'.*> \/etc\/apt\/apt\.conf\.d\/\S+/);
});

test('every apt install runs from the snapshot source or names versioned packages', () => {
  const all = installs(snapshotDate() ?? 'missing');
  assert.ok(all.length >= 2, 'the image installs Playwright\'s dependencies and the runtime packages through apt');
  for (const install of all) {
    assert.ok(install.pinned, `Dockerfile:${install.line} \`${install.command}\` runs before the apt snapshot source is set`);
  }
  assert.ok(all.some((i) => /playwright\s+install-deps\s+chromium$/.test(i.command)), 'Playwright\'s system packages install through the pinned source');
});

test('Playwright never installs system packages through --with-deps', () => {
  assert.doesNotMatch(DOCKERFILE, /--with-deps/);
});

test('the installed package list is written to its known path after the last install', () => {
  const last = INSTRUCTIONS.filter((i) => i.op === 'RUN' && INSTALL.test(i.args)).at(-1);
  assert.ok(last, 'an apt install exists');
  const commands = commandsOf(last);
  const lastInstall = commands.map((c) => INSTALL.test(c)).lastIndexOf(true);
  const list = commands.findIndex((c) => c === `dpkg-query -W > ${PACKAGE_LIST}`);
  assert.ok(list > lastInstall, `\`dpkg-query -W > ${PACKAGE_LIST}\` follows the last apt install in the same RUN`);
});
