#!/usr/bin/env node
/** D5505 (#5505): full guards and the advisory local preflight share one catalog. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runGuards, validateGuards } from './lib/guardRunner.mjs';

export const GUARDS = JSON.parse(readFileSync(new URL('./guard-commands.json', import.meta.url), 'utf8'));
validateGuards(GUARDS);
export const guardCommands = GUARDS.filter(guard => guard.full !== false).map(guard => guard.command.join(' '));

export async function main(args) {
  if (args.some(arg => arg !== '--preflight')) throw new Error('usage: node scripts/run-guards.mjs [--preflight]');
  const preflight = args.includes('--preflight');
  const guards = GUARDS.filter(guard => preflight ? guard.preflight : guard.full !== false);
  const controller = new AbortController();
  const onInt = () => controller.abort('SIGINT');
  const onTerm = () => controller.abort('SIGTERM');
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  let result;
  try {
    result = await runGuards(guards, { cwd: fileURLToPath(new URL('..', import.meta.url)), controller,
      report: row => console.log(`[guard] ${row.id}: ${row.status}; exit=${row.exitCode ?? '-'}${row.signal ? `; signal=${row.signal}` : ''}${row.blockedBy.length ? `; blockedBy=${row.blockedBy.join(',')}` : ''}\n  ${row.command.join(' ')}`) });
    result.mode = preflight ? 'preflight' : 'full';
    // A fixed repo-relative path makes the artifact available to the failure digest
    // without retaining raw test output, request bodies or machine paths (#5502).
    writeFileSync(new URL(preflight ? '../preflight-results.json' : '../guard-results.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`${result.results.filter(row => row.status === 'passed').length}/${guards.length} guards passed; EXIT=${result.exitCode}`);
    return result.exitCode;
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
