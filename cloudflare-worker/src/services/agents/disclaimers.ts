/** D4421 (#4421): shared agent disclaimer copy and exact role/key lookup for Worker instructions and UI. */
export const GENERAL_COUNSEL_DISCLAIMER_KEY = 'agents.general_counsel.disclaimer';
export const AGENT_DISCLAIMERS: Readonly<Record<string, string>> = Object.freeze({
  // counsel wording pending (#3727)
  [GENERAL_COUNSEL_DISCLAIMER_KEY]: 'Not legal advice. Always escalates.',
});

/** A role's identity, never its editable/display name, selects its disclaimer. */
export const disclaimerKeyForRole = (roleKey: unknown): string | undefined =>
  roleKey === 'general_counsel' ? GENERAL_COUNSEL_DISCLAIMER_KEY : undefined;

export function agentDisclaimerText(key: unknown): string | null {
  return typeof key === 'string' && Object.hasOwn(AGENT_DISCLAIMERS, key) ? AGENT_DISCLAIMERS[key] : null;
}
