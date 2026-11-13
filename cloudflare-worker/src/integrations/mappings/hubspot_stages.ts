/**
 * Task #2 — HubSpot deal-stage mapping.
 *
 * StudioOS deal `status` values (from the schema CHECK constraint):
 *   applied | scored | active | funded | rejected
 *
 * HubSpot deal `dealstage` is per-pipeline; the values below are the
 * default IDs from HubSpot's "Sales Pipeline" (pipeline_id = "default").
 * Customers on a custom pipeline override this map by setting
 * `config.dealstage_map` on the integration row (see hubspot.ts
 * `action('list_pipelines')` + the frontend pipeline picker).
 *
 * If a stage cannot be mapped in either direction the bridge falls back
 * to the closest match and emits an integration_logs entry so the user
 * can fix the mapping in the UI without losing the sync attempt.
 */
export type StudioStage = 'applied' | 'scored' | 'active' | 'funded' | 'rejected';

export interface DealstageMap {
  pipeline_id: string;
  /** StudioOS status → HubSpot dealstage ID. */
  forward: Record<StudioStage, string>;
  /** HubSpot dealstage ID → StudioOS status. */
  reverse: Record<string, StudioStage>;
}

/** HubSpot's out-of-the-box "Sales Pipeline" stage IDs. */
export const DEFAULT_DEALSTAGE_MAP: DealstageMap = {
  pipeline_id: 'default',
  forward: {
    applied:  'appointmentscheduled',
    scored:   'qualifiedtobuy',
    active:   'presentationscheduled',
    funded:   'closedwon',
    rejected: 'closedlost',
  },
  reverse: {
    appointmentscheduled:  'applied',
    qualifiedtobuy:        'scored',
    presentationscheduled: 'active',
    decisionmakerboughtin: 'active',
    contractsent:          'active',
    closedwon:             'funded',
    closedlost:            'rejected',
  },
};

/**
 * Build a runtime DealstageMap from whatever the integration row stored.
 * `config_json` may carry `pipeline_id` + `dealstage_map` (forward only —
 * we derive reverse). Anything missing falls back to defaults.
 */
export function loadDealstageMap(config: Record<string, unknown> | null | undefined): DealstageMap {
  if (!config) return DEFAULT_DEALSTAGE_MAP;
  const pipeline_id = typeof config.pipeline_id === 'string' && config.pipeline_id.length
    ? (config.pipeline_id as string)
    : DEFAULT_DEALSTAGE_MAP.pipeline_id;
  const fwdRaw = (config.dealstage_map && typeof config.dealstage_map === 'object')
    ? config.dealstage_map as Record<string, string>
    : null;
  if (!fwdRaw) return { ...DEFAULT_DEALSTAGE_MAP, pipeline_id };
  const forward: Record<StudioStage, string> = { ...DEFAULT_DEALSTAGE_MAP.forward };
  for (const k of Object.keys(forward) as StudioStage[]) {
    if (typeof fwdRaw[k] === 'string' && fwdRaw[k].length) forward[k] = fwdRaw[k];
  }
  const reverse: Record<string, StudioStage> = { ...DEFAULT_DEALSTAGE_MAP.reverse };
  for (const [k, v] of Object.entries(forward)) reverse[v] = k as StudioStage;
  return { pipeline_id, forward, reverse };
}

export function studioStageToHubspot(map: DealstageMap, status: string): string {
  return map.forward[status as StudioStage] || map.forward.applied;
}

export function hubspotStageToStudio(map: DealstageMap, dealstage: string): StudioStage | null {
  return map.reverse[dealstage] || null;
}
