// D4574 (#4574, H5): warm the module cache with every cycle step CycleRoute loads
// through `lazyStep`, read from CycleRoute.jsx itself so a new lazy step is covered.
//
// A suite that mounts CycleRoute and settles it with a fixed number of ticks
// imports this first (`import './_cycleSteps.mjs';`). In a browser the step's
// chunk arrives over the network; here its first import is a transpile that can
// outlast those ticks. With the module already loaded, the lazy step resolves in
// a microtask and the page draws as it did when the step was a static import.
// The lazy boundary itself, skeleton first, is cycle_route_lazy_steps_d4574's.
import { readFileSync } from 'node:fs';

const ROUTE = new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url);
const specs = [...new Set([...readFileSync(ROUTE, 'utf8').matchAll(/^const \w+ = lazyStep\(\(\) => import\('([^']+)'\)/gm)].map((m) => m[1]))];
if (!specs.length) throw new Error('_cycleSteps: CycleRoute.jsx names no lazy step');
await Promise.all(specs.map((spec) => import(new URL(spec.endsWith('.jsx') ? spec : `${spec}.jsx`, ROUTE))));
export const CYCLE_STEP_MODULES = specs;
