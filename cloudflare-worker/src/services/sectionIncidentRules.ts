/** Route bounded, trusted section events to a single operational destination (#5980). */

// Canonical audience and section codes from D5677 and D5682's destination inventory.
const sections = {
  superadmin: ['home', 'licences', 'programs', 'funds-oversight', 'fund-admin', 'contracts', 'team',
    'revenue', 'content', 'platform', 'ai-agents', 'integration-keys', 'support', 'security', 'settings'],
  admin: ['studio', 'accounts', 'approvals', 'programs', 'community', 'contracts', 'fund-admin', 'insights', 'licences'],
  founder: ['studio', 'spin-out-lab', 'validate', 'build', 'raise', 'grow', 'trust', 'network', 'research', 'profile'],
  investor: ['studio', 'spin-out-lab', 'deals', 'axal-vc-fund', 'fund', 'trust', 'network', 'research', 'portfolio', 'due-diligence'],
  partner: ['studio', 'spin-out-lab', 'pipeline', 'delivery', 'offers', 'trust', 'network', 'research', 'due-diligence'],
  advisor: ['studio', 'spin-out-lab', 'practice', 'cohorts', 'expertise', 'trust', 'network', 'research', 'due-diligence'],
  explorer: ['studio', 'spin-out-lab', 'email'],
  all: ['account', 'usage', 'connectors', 'trust-center', 'portfolio', 'billing', 'perks', 'calendar', 'events',
    'learning', 'help-center', 'pricing', 'companies', 'projects', 'licences', 'influencer'],
} as const;

const sources = ['server_operation', 'verified_profile', 'subsystem'] as const;
const outcomes = ['ok', 'expected_4xx', 'failure', 'confirmed_impact', 'recovery'] as const;
const TRIAGE = 'axalvc-superadmin-platform';
const MAX_COUNT = 1_000_000;

type Audience = keyof typeof sections;
type Source = (typeof sources)[number];
type Outcome = (typeof outcomes)[number];
type Slug = { [A in Audience]: `axalvc-${A}-${(typeof sections)[A][number]}` }[Audience];
type TrustedEvent = {
  source: Source;
  slug: Slug;
  unmapped: boolean;
  outcome: Outcome;
  occurrences: number;
  browserOccurrences: number;
};

export type SectionIncidentDecision =
  | { action: 'drop' }
  | { action: 'count_only'; event: TrustedEvent }
  | { action: 'episode'; stage: 'impact' | 'recovery'; event: TrustedEvent };

const scopes = new Map<string, Slug>(
  Object.entries(sections).flatMap(([audience, keys]) =>
    keys.map(section => [`${audience}:${section}`, `axalvc-${audience}-${section}` as Slug])),
);

function code<T extends string>(codes: readonly T[], value: unknown): T | undefined {
  return codes.find(candidate => candidate === value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, MAX_COUNT) : 0;
}

/**
 * Call from trusted server producers after authenticating the operation or verifying the profile.
 * Only a count already correlated to that event may come from browser telemetry.
 */
export function normalizeSectionIncident(
  observed: { source?: unknown; audience?: unknown; section?: unknown; outcome?: unknown; occurrences?: unknown } | null,
  corroboratingBrowserCount?: unknown,
): TrustedEvent | null {
  const source = code(sources, observed?.source);
  const outcome = code(outcomes, observed?.outcome);
  const occurrences = count(observed?.occurrences);
  if (!source || !outcome || !occurrences) return null;

  const { audience, section } = observed!;
  const slug = typeof audience === 'string' && typeof section === 'string' && audience.length <= 10 && section.length <= 20
    ? scopes.get(`${audience}:${section}`)
    : undefined;
  return {
    source, outcome, occurrences, slug: slug ?? TRIAGE, unmapped: slug === undefined,
    browserOccurrences: outcome === 'failure' || outcome === 'confirmed_impact' ? count(corroboratingBrowserCount) : 0,
  };
}

export function decideSectionIncident(
  observed: Parameters<typeof normalizeSectionIncident>[0],
  corroboratingBrowserCount?: unknown,
): SectionIncidentDecision {
  const event = normalizeSectionIncident(observed, corroboratingBrowserCount);
  if (!event) return { action: 'drop' };
  if (event.outcome === 'confirmed_impact') return { action: 'episode', stage: 'impact', event };
  if (event.outcome === 'recovery') return { action: 'episode', stage: 'recovery', event };
  if (event.outcome === 'ok' && !event.unmapped) return { action: 'drop' };
  return { action: 'count_only', event };
}
