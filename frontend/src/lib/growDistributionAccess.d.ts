/** Types for `growDistributionAccess.js` (#9024), so the Worker's typecheck can import it. */
export const GROW_DISTRIBUTION_ROLES: readonly string[];
export function opensGrowDistribution(role: string | null | undefined, held?: readonly string[]): boolean;
