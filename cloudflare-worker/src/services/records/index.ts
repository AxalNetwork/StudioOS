/** D690 — later cycle PRs register their own module specs here. */
import type { Cycle, ModuleSpec, RecordRegistry } from './types';

export const RECORD_SPECS: RecordRegistry = {};

export function hasRecords(cycle: string, registry: RecordRegistry = RECORD_SPECS): boolean {
  const specs = registry[cycle as Cycle];
  return !!specs && Object.keys(specs).length > 0;
}

export function specFor(cycle: string, slug: string, registry: RecordRegistry = RECORD_SPECS): ModuleSpec | null {
  return registry[cycle as Cycle]?.[slug] ?? null;
}
