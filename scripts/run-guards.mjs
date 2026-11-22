#!/usr/bin/env node
/** D5505 (#5505): full guards, local preflight and single-guard repro from one ordered catalog. */
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runGuards, selectGuards } from './lib/guardRunner.mjs';
import { GUARDS, guardCommands } from './lib/guardCatalog.mjs';
export { GUARDS, guardCommands };
export async function main(args) {
  if (!(args.length === 0 || args.length === 1 && args[0] === '--preflight' || args.length === 2 && args[0] === '--guard' && /^[a-z][a-z0-9-]*$/.test(args[1]))) throw new Error('usage: run-guards.mjs [--preflight | --guard <id>]');
  const preflight = args[0] === '--preflight'; const id = args[0] === '--guard' ? args[1] : null;
  const guards = selectGuards(GUARDS, { preflight, id }); const controller = new AbortController();
  const onInt = () => controller.abort('SIGINT'), onTerm = () => controller.abort('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  const output = new URL(preflight || id ? '../preflight-results.json' : '../guard-results.json', import.meta.url);
  rmSync(output, { force: true });
  try {
    const result = await runGuards(guards, { cwd: fileURLToPath(new URL('..', import.meta.url)), controller,
      report: row => console.log(`[guard] ${row.id}: ${row.status}; exit=${row.exitCode ?? '-'}${row.signal ? `; signal=${row.signal}` : ''}${row.blockedBy.length ? `; blockedBy=${row.blockedBy.join(',')}` : ''}\n  ${row.command.join(' ')}`) });
    result.mode = preflight ? 'preflight' : id ? 'single' : 'full';
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`${result.results.filter(row => row.status === 'passed').length}/${guards.length} guards passed; EXIT=${result.exitCode}`);
    return result.exitCode;
  } finally { process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => { console.error('Guard runner configuration or report write failed.'); process.exitCode = 1; });
}
