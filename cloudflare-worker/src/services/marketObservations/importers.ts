/** D7709 (#7709): the operator importer registry and each adapter's bounded parameter contract. */
import { ingestWorldBank, worldBankParams, WORLD_BANK_IMPORT_LIMITS } from '../researchMarketData';
import { ImportRequestError } from './write';
import { ingestEurostatSbs, sbsParams, SBS_IMPORT_LIMITS } from './eurostatSbs';
import { ingestCensusCbp, cbpParams, CBP_IMPORT_LIMITS } from './censusCbp';

export const IMPORTERS = Object.freeze({
  'world-bank': { source_id: 'world-bank', parameters: ['from', 'to', 'indicators'] as const,
    limits: WORLD_BANK_IMPORT_LIMITS, validate: worldBankParams, run: ingestWorldBank },
  'eurostat-sbs': { source_id: 'eurostat-sbs', parameters: ['from', 'to', 'indicators', 'activities', 'size_classes', 'geographies'] as const,
    limits: SBS_IMPORT_LIMITS, validate: sbsParams, run: ingestEurostatSbs },
  // D7927: national County Business Patterns; its source lands disabled until the owner enables it.
  'census-cbp': { source_id: 'census-cbp', parameters: ['year', 'industries', 'metrics'] as const,
    limits: CBP_IMPORT_LIMITS, validate: cbpParams, run: ingestCensusCbp },
});
export function importerFor(id: unknown) {
  if (typeof id !== 'string' || !Object.hasOwn(IMPORTERS, id)) throw new ImportRequestError('unknown_importer');
  return IMPORTERS[id as keyof typeof IMPORTERS];
}
