/**
 * Task #4 — Salesforce field mappings.
 *
 * StudioOS deal `status` values map to Salesforce Opportunity `StageName`
 * values from the out-of-the-box default sales process. Customers on
 * custom processes override via `config.stage_map` on the integration row.
 *
 * Field overrides let admins remap which StudioOS column writes to which
 * Salesforce field — useful when the org has e.g. renamed `Amount` to a
 * custom currency field. Validated by `validateConfig` (see
 * providers/salesforce.ts) so config_json never accumulates arbitrary
 * keys.
 */

export type StudioStage = 'applied' | 'scored' | 'active' | 'funded' | 'rejected';

/** Default StudioOS deal status → SF Opportunity StageName. */
export const DEFAULT_STAGE_MAP: Record<StudioStage, string> = {
  applied:  'Prospecting',
  scored:   'Qualification',
  active:   'Proposal/Price Quote',
  funded:   'Closed Won',
  rejected: 'Closed Lost',
};

/** Reverse map (case-insensitive) for inbound polling. Custom stage names
 * fall back to nearest StudioOS bucket via `inferStudioStage`. */
const DEFAULT_REVERSE: Array<[string, StudioStage]> = [
  ['prospecting',           'applied'],
  ['qualification',         'scored'],
  ['needs analysis',        'scored'],
  ['value proposition',     'scored'],
  ['id. decision makers',   'active'],
  ['perception analysis',   'active'],
  ['proposal/price quote',  'active'],
  ['negotiation/review',    'active'],
  ['closed won',            'funded'],
  ['closed lost',           'rejected'],
];

/** Resolve effective forward+reverse maps from optional integration config. */
export interface StageMaps {
  forward: Record<StudioStage, string>;
  reverse: Map<string, StudioStage>;
}

export function loadStageMaps(config: Record<string, unknown> | null | undefined): StageMaps {
  const forward: Record<StudioStage, string> = { ...DEFAULT_STAGE_MAP };
  const reverse = new Map<string, StudioStage>();
  for (const [k, v] of DEFAULT_REVERSE) reverse.set(k, v);
  const override = config && typeof config.stage_map === 'object' && config.stage_map !== null
    ? config.stage_map as Record<string, unknown>
    : null;
  if (override) {
    for (const k of Object.keys(forward) as StudioStage[]) {
      const v = override[k];
      if (typeof v === 'string' && v.length) {
        forward[k] = v;
        reverse.set(v.toLowerCase(), k);
      }
    }
  }
  return { forward, reverse };
}

export function studioStageToSf(maps: StageMaps, status: string): string {
  return maps.forward[status as StudioStage] || maps.forward.applied;
}

/** Map an arbitrary SF stage name to a StudioOS bucket. Returns null when
 * we have no plausible match — caller decides whether to skip or default. */
export function sfStageToStudio(maps: StageMaps, sfStage: string): StudioStage | null {
  if (!sfStage) return null;
  const hit = maps.reverse.get(sfStage.toLowerCase());
  return hit ?? null;
}

// ─────────────────────────────────────────────────────────── field mappings

/** Salesforce object → field map. Each entry is `studio_source → sf_field`.
 * The `value()` resolver lets us shape strings (e.g. "$ amount") without
 * forcing every override to ship a JS function. */
export interface FieldMap { [studioSource: string]: string }

export const DEFAULT_OPPORTUNITY_FIELDS: FieldMap = {
  // studio source key → Salesforce field API name
  project_name: 'Name',
  amount:       'Amount',
  status:       'StageName',
  deal_id:      'Axal_Deal_Id__c',  // optional custom field; create or omit per-org
};

export const DEFAULT_ACCOUNT_FIELDS: FieldMap = {
  project_name: 'Name',
  description:  'Description',
  sector:       'Industry',
  project_id:   'Axal_Project_Id__c',
};

export const DEFAULT_CONTACT_FIELDS: FieldMap = {
  email:        'Email',
  first_name:   'FirstName',
  last_name:    'LastName',
};

export interface FieldMapBundle {
  opportunity: FieldMap;
  account:     FieldMap;
  contact:     FieldMap;
}

export const DEFAULT_FIELD_MAPS: FieldMapBundle = {
  opportunity: DEFAULT_OPPORTUNITY_FIELDS,
  account:     DEFAULT_ACCOUNT_FIELDS,
  contact:     DEFAULT_CONTACT_FIELDS,
};

/** Merge a partial override bundle from `config.field_map` over defaults. */
export function loadFieldMaps(config: Record<string, unknown> | null | undefined): FieldMapBundle {
  const override = config && typeof config.field_map === 'object' && config.field_map !== null
    ? config.field_map as Record<string, unknown>
    : null;
  if (!override) return DEFAULT_FIELD_MAPS;
  const merge = (def: FieldMap, ov: unknown): FieldMap => {
    if (!ov || typeof ov !== 'object' || Array.isArray(ov)) return def;
    const out: FieldMap = { ...def };
    for (const [k, v] of Object.entries(ov as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length && v.length <= 80) out[k] = v;
    }
    return out;
  };
  return {
    opportunity: merge(DEFAULT_OPPORTUNITY_FIELDS, override.opportunity),
    account:     merge(DEFAULT_ACCOUNT_FIELDS,     override.account),
    contact:     merge(DEFAULT_CONTACT_FIELDS,     override.contact),
  };
}

/** Apply a FieldMap to a source row, dropping null/undefined values so we
 * don't blank-out existing Salesforce data on PATCH. Custom-field targets
 * (`Axal_*__c`) that don't exist on the org will surface as a 400 from
 * Salesforce; callers strip those by inspecting the error and retrying. */
export function applyFieldMap(
  map: FieldMap,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [studioKey, sfField] of Object.entries(map)) {
    const v = source[studioKey];
    if (v !== undefined && v !== null && v !== '') out[sfField] = v;
  }
  return out;
}
