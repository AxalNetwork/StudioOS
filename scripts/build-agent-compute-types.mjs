/** D4557: derive isolated host binding types from its own Wrangler config without augmenting the site's Env. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const target = new URL('../agent-compute/worker-configuration.d.ts', import.meta.url);
const command = new URL('../cloudflare-worker/node_modules/wrangler/bin/wrangler.js', import.meta.url);
const result = spawnSync(process.execPath, [command.pathname, 'types', target.pathname, '--config', 'wrangler.agent-compute.toml',
  '--env', 'preview', '--env-interface', 'ComputeBindings', '--include-runtime=false', '--strict-vars=false'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(target, readFileSync(target, 'utf8') + '\nexport type { ComputeBindings };\n');
