/** D690 — later cycle PRs register their own module specs here. */
import type { Cycle, ModuleSpec, RecordRegistry } from './types';
import { BUILD_SPECS } from './build';
import { GROW_RECORDS } from './grow';
import { RAISE_RECORDS } from './raise';
import { VALIDATE_SPECS } from './validate';

export const RECORD_SPECS: RecordRegistry = {
  validate: VALIDATE_SPECS,
  build: BUILD_SPECS,
  raise: RAISE_RECORDS, // D691 (#1699)
  grow: GROW_RECORDS, // D691 (#1698)
};

export function hasRecords(cycle: string, registry: RecordRegistry = RECORD_SPECS): boolean {
  const specs = registry[cycle as Cycle];
  return !!specs && Object.keys(specs).length > 0;
}

export function specFor(cycle: string, slug: string, registry: RecordRegistry = RECORD_SPECS): ModuleSpec | null {
  return registry[cycle as Cycle]?.[slug] ?? null;
}
