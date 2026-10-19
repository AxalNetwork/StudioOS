/**
 * D782 (#2115) — the words for Founding team's and Company creation's "From
 * GitHub" parts, from each module read's `parts.github`. Pure, so
 * `frontend/test/github_team_company_d782.test.mjs` holds each rule.
 *
 * A login and a commit count are personal data: the Worker sends them only to
 * the project's members, and a non-member's part says how many, never which.
 * Everything here came from GitHub, so it is drawn as text.
 */

/** "Builds: 12 commits in the last 90 days"; one commit reads "1 commit". */
export function buildsText(commits) {
  const n = Number.isFinite(Number(commits)) && Number(commits) > 0 ? Math.floor(Number(commits)) : 0;
  return `Builds: ${n} ${n === 1 ? 'commit' : 'commits'} in the last 90 days`;
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/**
 * Founding team's part, cleaned: each mapped founder with their repositories,
 * each login not yet matched, and the founders a login can be matched to.
 * `empty` is true when GitHub brought no contributor: nothing is drawn.
 */
export function teamView(part) {
  if (!part || typeof part !== 'object') return { state: 'none', empty: true, builds: [], unmatched: [], founders: [] };
  if (part.state === 'unreadable') return { state: 'unreadable', empty: false, reason: part.reason || 'What GitHub brought could not be read.', builds: [], unmatched: [], founders: [] };
  const logins = Number.isSafeInteger(part.logins) && part.logins > 0 ? part.logins : 0;
  if (part.members_only) return { state: 'members_only', empty: !logins, logins, builds: [], unmatched: [], founders: [] };
  const founders = list(part.founders).filter((f) => Number.isSafeInteger(f.holder_id));
  const name = new Map(founders.map((f) => [f.record_id, f.name || 'A founder']));
  const builds = list(part.builds).filter((b) => name.has(b.record_id))
    .map((b) => ({ record_id: b.record_id, name: name.get(b.record_id), repositories: list(b.repositories).filter((r) => typeof r.repository === 'string') }));
  const unmatched = list(part.unmatched).filter((u) => typeof u.login === 'string' && u.login)
    .map((u) => ({ login: u.login, repositories: list(u.repositories).filter((r) => typeof r.repository === 'string') }));
  return { state: 'ok', empty: !builds.length && !unmatched.length, logins, builds, unmatched, founders };
}

/**
 * Company creation's part, cleaned: each repository with where it sits and
 * its licence, the proposals waiting for Accept or Dismiss, and the evidence
 * on the IP assignment step.
 */
export function companyView(part) {
  if (!part || typeof part !== 'object') return { state: 'none', empty: true, repositories: [], proposals: [], evidence: [] };
  if (part.state === 'unreadable') return { state: 'unreadable', empty: false, reason: part.reason || 'What GitHub brought could not be read.', repositories: [], proposals: [], evidence: [] };
  const total = Number.isSafeInteger(part.repositories_total) && part.repositories_total > 0 ? part.repositories_total : 0;
  if (part.members_only) return { state: 'members_only', empty: !total, total, repositories: [], proposals: [], evidence: [] };
  const repositories = list(part.repositories).filter((r) => typeof r.repository === 'string');
  const proposals = list(part.proposals).filter((p) => Number.isSafeInteger(p.id) && typeof p.title === 'string');
  const evidence = list(part.evidence).filter((e) => typeof e.repository === 'string');
  return { state: 'ok', empty: !repositories.length && !proposals.length && !evidence.length, total, repositories, proposals, evidence };
}

/** "A personal account (fay) owns it" or "The acme organisation owns it". */
export function ownerText(repo) {
  const who = typeof repo?.owner === 'string' && repo.owner ? repo.owner : null;
  if (repo?.owner_kind === 'organisation') return who ? `The ${who} organisation owns it` : 'An organisation owns it';
  return who ? `A personal account (${who}) owns it` : 'A personal account owns it';
}

/** The licence as a fact: its SPDX id, or "No licence file". Never advice. */
export function licenceText(repo) {
  return typeof repo?.licence === 'string' && repo.licence ? `Licence: ${repo.licence}` : 'No licence file';
}

/** "3 contributors arrived from GitHub. Only the project's members see who." */
export function membersOnlyText(n, one, many) {
  return `${n} ${n === 1 ? one : many} arrived from GitHub. Only the project’s members see which.`;
}
