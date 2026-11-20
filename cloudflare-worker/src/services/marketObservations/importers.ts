/** D7709 (#7709): the operator importer registry and each adapter's bounded parameter contract. */
import { ingestWorldBank, worldBankParams, WORLD_BANK_IMPORT_LIMITS } from '../researchMarketData';
import { ImportRequestError } from './write';

export const IMPORTERS = Object.freeze({
  'world-bank': { source_id: 'world-bank', parameters: ['from', 'to', 'indicators'] as const,
    limits: WORLD_BANK_IMPORT_LIMITS, validate: worldBankParams, run: ingestWorldBank },
});
export function importerFor(id: unknown) {
  if (typeof id !== 'string' || !Object.hasOwn(IMPORTERS, id)) throw new ImportRequestError('unknown_importer');
  return IMPORTERS[id as keyof typeof IMPORTERS];
}
