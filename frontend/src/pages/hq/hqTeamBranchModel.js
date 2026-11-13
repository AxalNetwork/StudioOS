/**
 * D5041 (#5041) — what HQ Team says about branches, as pure functions.
 *
 * Five facts, never mapped onto one another because it is convenient:
 *
 *   not_asked          a binding exists and no search was run: ready to search
 *   ok                 asked, answered
 *   unreadable         asked, did not answer (the only one with a retry)
 *   not_deployed       a deployment row but no service binding on this Worker
 *   registry unreadable  HQ cannot establish the deployment set at all
 *
 * "This is the whole team" is a claim about the set of branches, and is made only when HQ has
 * positively established it is empty (`registry_available` and `no_branches` both true from the
 * Worker). An older payload with neither field makes no such claim.
 */

/** The short state beside a branch code. */
export function branchStateText(b) {
  if (b.status === 'ok') {
    const n = (b.data?.results || []).length;
    const when = b.as_of ? ` · as of ${String(b.as_of).slice(0, 19).replace('T', ' ')}` : '';
    return `${n} matched${b.data?.truncated ? ' (more exist)' : ''}${when}`;
  }
  if (b.status === 'not_asked') return 'Ready to search';
  if (b.status === 'not_deployed') return 'Not deployed';
  if (b.status === 'unreadable') return 'Could not be read';
  return 'State not recorded';
}

/** True only when HQ has established that no branch exists. */
export const wholeTeamEstablished = (team) => Boolean(team) && team.registry_available !== false && team.no_branches === true;

/** The registry could not be read: the set of branches is unknown. */
export const registryUnreadable = (team) => Boolean(team) && team.registry_available === false;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * One sentence of coverage, for the page footer and the rail. Null when there is
 * nothing to say (no coverage on the payload).
 */
export function branchCoverageLine(team) {
  if (!team) return null;
  if (registryUnreadable(team)) return 'Deployment registry: unreadable, so the set of branches is not established';
  if (wholeTeamEstablished(team)) return 'No branch is provisioned, so every administrator is HQ-held';
  const c = team.branches_coverage;
  if (!c) return null;
  const notDeployed = (c.not_deployed || []).length;
  const tail = notDeployed ? `; ${notDeployed} not deployed` : '';
  if (!team.searched) {
    const ready = (c.not_asked || []).length;
    return `${plural(ready, 'branch', 'branches')} ready to search; none asked yet${tail}`;
  }
  const failed = (c.unreadable || []).length;
  return `Of ${plural(c.asked ?? 0, 'branch', 'branches')} asked, ${c.answered ?? 0} answered${failed ? `; ${failed} could not be read` : ''}${tail}`;
}
