/** #5830/#5841: fixed internal return targets sealed into the existing signed, single-use OAuth state. */
const TASKS: Record<string, { provider: string; path: string }> = {
  grow_results: { provider: 'google_search_console', path: '/grow/distribution/results' },
  validate_research: { provider: 'typeform', path: '/validate/customer-research' },
};
export function pilotReturn(provider: unknown, task: unknown, project: unknown): { path: string; projectId: number } | null {
  if (typeof task !== 'string' || !Object.hasOwn(TASKS, task) || TASKS[task].provider !== provider) return null;
  const id = Number(project);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { path: TASKS[task].path, projectId: id };
}
