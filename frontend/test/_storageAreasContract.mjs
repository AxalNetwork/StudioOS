/**
 * #5507 — THE contract for the storage-area catalogue (D5507). Written by
 * hand, never derived from `services/storageUsage.ts`, `usageModel.js`'s
 * STORAGE_AREAS or `storagePageModel.js`'s AREA_PLACE, so a registry and a
 * renderer that agree on the same mistake still fail.
 *
 * What is contractual (D642, D1169, D1170, D1411, D1580, D1590, D5332, D4557):
 *   - membership: every store `GET /api/usage/storage` counts, no more, no
 *     less. Each is listed on the Usage card (visibility) and has a place on
 *     the Storage page's largest files (access: where Open goes, or null when
 *     no page opens it). ROUTE_MAP's D642 section names every key (docs).
 *   - kind: the bucket each area counts in, and the six kinds' canvas order.
 *   - order of areas is NOT contractual: the Worker groups by kind and the
 *     Usage card lists in its own order.
 *
 * Owned by `storage_areas_contract_5507.test.mjs` (frontend renderers and
 * docs) and `cloudflare-worker/test/usage_storage_d1169.test.ts` (the read
 * itself). WHO UPDATES IT: the task that adds or retires a storage area adds
 * or removes its one row here in the same PR, deliberately. No other suite
 * lists the catalogue.
 *
 * From frontend/test/README.md (moved by #6472): D5507: THE contract for the storage areas: key,
 * kind and where its file opens, written by hand; read by the two suites below and the Worker's
 * `usage_storage_d1169`.
 */

/** [key, kind, where Open goes on the Storage page (null: no page opens it)]. */
export const STORAGE_AREA_CONTRACT = Object.freeze([
  ['data_room', 'data_room', '/raise/data-room/files'],
  ['data_room_versions', 'data_room', '/raise/data-room/files'],
  ['diligence_files', 'documents', '/due-diligence'],
  ['research_library', 'documents', '/research/library'],
  ['validate_evidence', 'documents', '/validate/demand-signals'],
  ['build_proofs', 'documents', '/build'],
  ['grow_minutes', 'documents', '/grow'],
  ['agent_compute', 'documents', null],
  ['interview_recordings', 'recordings', '/validate/customer-research'],
  ['session_audio', 'recordings', '/validate/customer-research'],
  ['grow_voice_notes', 'recordings', '/grow/distribution/prospects'],
  ['deck_rehearsals', 'recordings', '/raise/pitch/present'],
  ['deck_recordings', 'recordings', '/raise/pitch/present'],
  ['deck_reviews', 'decks_exports', '/raise/pitch/review'],
  ['brand_files', 'brand', '/account'],
  ['csv_imports', 'other', null],
  ['articles', 'other', '/articles/draft'],
  ['work_graph_media', 'other', null],
].map((row) => Object.freeze(row)));

/** The keys, sorted: compare as a set. */
export const STORAGE_AREA_KEYS = Object.freeze(STORAGE_AREA_CONTRACT.map(([key]) => key).sort());

/** key → kind. */
export const STORAGE_AREA_KIND = Object.freeze(Object.fromEntries(STORAGE_AREA_CONTRACT.map(([key, kind]) => [key, kind])));

/** The canvas's six kinds, in palette order (this order IS contractual). */
export const STORAGE_KIND_ORDER = Object.freeze(['data_room', 'documents', 'recordings', 'decks_exports', 'brand', 'other']);
