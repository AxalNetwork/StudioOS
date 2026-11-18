/**
 * D5074 part 6 (#5074): the cap table scenarios' capabilities, computed once from who the caller is on the venture.
 *
 * Scenarios are the venture's own saved models (D1018, D1023): they are not part of the record, so the record's
 * map (`capTableCapabilities.ts`) does not cover them. `GET /api/captable/scenarios/by-project/:projectId/today`,
 * which every Scenarios page reads before it draws, returns this map beside Today. Every scenario write in
 * `routes/captable.ts` (create a variant, save, rename, attach, delete) is refused by the same gate the map is
 * computed from (`canWriteProject`, through `ensureProjectWriteAccess` and `ensureScenarioWriteOr404`), so the page
 * is never shown a control the Worker then refuses.
 *
 * | Capability | Owner | Co-founder (write member) | Reader (advisor, read grant) | Admin, Super Admin |
 * |------------|-------|---------------------------|------------------------------|--------------------|
 * | `edit`     | yes   | yes                       | no                           | no                 |
 * | `plan`     | the caller's own plan (Raise + Grow, `studio`)                                    |
 *
 * An admin never holds the venture's own write gate (`captableAccess.ts`, D1130), so an admin is shown no scenario
 * write: before this map the page drew them from the account's role and the Worker refused each one 403.
 *
 * `plan` is its own key, as on the record: every write also needs the plan, which the Worker refuses with the plan's
 * 402 before it looks at who the caller is. A control is drawn when `edit` and `plan` are both true, and the plan's
 * line when only `plan` is false.
 */
export const SCENARIO_CAPABILITIES = ['edit'] as const;
export type ScenarioCapability = typeof SCENARIO_CAPABILITIES[number];
export type ScenarioCapabilities = Record<ScenarioCapability, boolean> & { plan: boolean };

export type ScenarioStanding = {
  /** The venture's own write gate (`canWriteProject`): the owner, or a member with write access. Never an admin. */
  writes: boolean;
  /** The caller's plan includes the Raise + Grow tools (`userMeetsTier(user, 'studio')`). */
  plan: boolean;
};

/** The map, from the standing alone. Pure: the read and the writes ask the same gate. */
export function scenarioCapabilities(s: ScenarioStanding): ScenarioCapabilities {
  return { edit: s.writes === true, plan: s.plan === true };
}

/** True only for a `true` in the map: no map, an unknown key or any other value allows nothing. */
export const scenarioCan = (caps: Partial<Record<string, unknown>> | null | undefined, key: ScenarioCapability | 'plan') => caps?.[key] === true;
