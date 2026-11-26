#!/usr/bin/env node
/**
 * D8519 (#8519): the model inventory. Writes `documentation/architecture/MODEL_INVENTORY.json`:
 * every model id the Worker can call, its provider, the surfaces that name it and
 * whether a price entry holds it. The rules are in `scripts/lib/modelInventory.mjs`.
 *
 * Generated, never committed (D5612): gitignored, written by
 * `scripts/build-generated.mjs`. No network, no model call; whether a model still
 * exists at its provider is #8508's live layer.
 *
 *   node scripts/build-model-inventory.mjs           write the inventory
 *   node scripts/build-model-inventory.mjs --check   exit 1 when the generator is not deterministic,
 *                                                    git tracks the output, a callable id has no price,
 *                                                    a price entry has no caller, or an allowlist entry is dead
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedOutputProblems } from './lib/generatedOutput.mjs';
import { INVENTORY_REL, buildInventory, inventoryProblems, readSources, renderInventory } from './lib/modelInventory.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const render = (root = ROOT, opts) => renderInventory(buildInventory(readSources(root, opts)));

/** Everything wrong under `root`: determinism, a tracked output, then the two gaps. */
export function modelInventoryProblems(root = ROOT) {
  return [
    ...generatedOutputProblems(root, INVENTORY_REL, (o) => render(root, o)),
    ...inventoryProblems(buildInventory(readSources(root))),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = modelInventoryProblems();
    if (problems.length) {
      for (const p of problems) console.error(`✖ model inventory: ${p}`);
      process.exit(1);
    }
    const n = buildInventory(readSources(ROOT)).models.length;
    console.log(`✓ model inventory: ${n} models; every callable id is priced or allowlisted, every price entry is called or allowlisted.`);
  } else {
    const next = render();
    const file = join(ROOT, INVENTORY_REL);
    let now = null;
    try { now = readFileSync(file, 'utf8'); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
    if (now === next) console.log(`${INVENTORY_REL} is already current.`);
    else { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, next); console.log(`wrote ${INVENTORY_REL}`); }
  }
}
