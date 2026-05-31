/**
 * Task #1 (Articles) — canonical sector taxonomy.
 *
 * Single source of truth for sector tagging on articles + (future)
 * shared surfaces. Imported by `routes/articles.ts` for server-side
 * validation and surfaced to the FE via `GET /api/articles/sectors`.
 *
 * Keep the list short and curated — these become facet filter chips
 * on the public reader. Add via PR review, not ad-hoc per author.
 */
export interface SectorDef {
  key: string;
  label: string;
}

export const SECTORS: SectorDef[] = [
  { key: 'ai',          label: 'AI / Machine learning' },
  { key: 'blockchain',  label: 'Blockchain / Web3' },
  { key: 'quantum',     label: 'Quantum' },
  { key: 'infra',       label: 'Digital infrastructure' },
  { key: 'frontier_sw', label: 'Frontier software' },
  { key: 'fintech',     label: 'Fintech' },
  { key: 'healthtech',  label: 'Healthtech' },
  { key: 'climate',     label: 'Climate / Energy' },
  { key: 'devtools',    label: 'Developer tools' },
  { key: 'saas',        label: 'SaaS' },
  { key: 'consumer',    label: 'Consumer' },
  { key: 'deeptech',    label: 'Deep tech' },
  { key: 'robotics',    label: 'Robotics' },
  { key: 'cybersecurity', label: 'Cybersecurity' },
  { key: 'defense',     label: 'Defense' },
  { key: 'bio',         label: 'Bio' },
  { key: 'other',       label: 'Other' },
];

export const SECTOR_KEYS: Set<string> = new Set(SECTORS.map((s) => s.key));

export function isValidSector(k: string | null | undefined): boolean {
  if (!k) return false;
  return SECTOR_KEYS.has(k);
}
