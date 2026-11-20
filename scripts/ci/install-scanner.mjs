#!/usr/bin/env node
// D5531: reviewed scanner pins and job-private installation; load from trusted base in CI.
import { appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveName, installScanner } from './scanner-acquisition.mjs';
// The pins are part of this module's source, imported with it, never read as
// data at run time, so a release URL is only ever one reviewed with the code.
import pins from './scanner-tools.json' with { type: 'json' };

const [name, mode] = process.argv.slice(2);
try {
  if (process.argv.length > 4 || !['gitleaks', 'codeql'].includes(name) || (mode && mode !== '--metadata')) throw Error('Usage: install-scanner.mjs <gitleaks|codeql> [--metadata]');
  const tool = pins[name];
  const temporary = resolve(process.env.RUNNER_TEMP || tmpdir());
  const cacheDir = join(temporary, 'studioos-scanner-archives');
  const metadata = { key: `scanner-${process.platform}-${process.arch}-${archiveName(tool)}`, 'cache-file': join(cacheDir, archiveName(tool)) };
  if (mode !== '--metadata') {
    const installed = await installScanner({ tool, cacheDir, workDir: join(temporary, 'studioos-scanners'), log: line => console.log(line) });
    metadata.archive = installed.archive;
    console.log(`${name} ${tool.version}: ${installed.source}, SHA256 verified`);
    if (installed.binary && process.env.GITHUB_PATH) await appendFile(process.env.GITHUB_PATH, `${dirname(installed.binary)}\n`);
    // A standalone invocation prints the executable without altering the system PATH.
    if (installed.binary) console.log(`binary=${installed.binary}`);
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(''));
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
}
