// D4574 (#4574, H5): warm the module cache with every cycle step CycleRoute loads
// through `lazyStep`, read from CycleRoute.jsx itself so a new lazy step is covered.
// D5615 (#5615): each cycle's own steps are declared in its `defs/<cycle>.jsx`,
// so those four files are read too, each spec resolved against its own file.
//
// A suite that mounts CycleRoute and settles it with a fixed number of ticks
// imports this first (`import './_cycleSteps.mjs';`). In a browser the step's
// chunk arrives over the network; here its first import is a transpile that can
// outlast those ticks. With the module already loaded, the lazy step resolves in
// a microtask and the page draws as it did when the step was a static import.
// The lazy boundary itself, skeleton first, is cycle_route_lazy_steps_d4574's.
import { readFileSync } from 'node:fs';

const ROUTE = new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url);
const FILES = [ROUTE, ...['validate', 'raise', 'grow', 'build'].map((c) => new URL(`../src/pages/cycles/defs/${c}.jsx`, import.meta.url))];
const steps = new Map();
for (const file of FILES) {
  for (const m of readFileSync(file, 'utf8').matchAll(/^const \w+ = lazyStep\(\(\) => import\('([^']+)'\)/gm)) {
    const url = new URL(m[1].endsWith('.jsx') ? m[1] : `${m[1]}.jsx`, file).href;
    steps.set(url, m[1]);
  }
}
if (!steps.size) throw new Error('_cycleSteps: CycleRoute.jsx names no lazy step');
await Promise.all([...steps.keys()].map((url) => import(url)));
export const CYCLE_STEP_MODULES = [...new Set(steps.values())];
