// D5984 (#5984): the one public template for a section-incident GitHub bug: the
// fixed cases, the marker, the title, body and labels, the power-of-two count
// milestone and its receipt comment. No episode, Slack or customer field
// reaches it. Owned by `../section-triage.mjs` and
// `cloudflare-worker/src/services/sectionIncidentIssue.ts` (typed by
// `sectionIncidentIssue.d.mts`).
//
// D5984 (#5984): the one public template for a section-incident GitHub bug,
// shared by the operator CLI (`../section-triage.mjs`, D5681) and the Worker
// (`cloudflare-worker/src/services/sectionIncidentIssue.ts`). Pure: no hashing,
// no network. Every word the public issue carries comes from a fixed case below
// and a count; no episode field, Slack reference or customer text reaches it.

// The fixed cases: one source file and one regression test each. Also the
// allowlist of `sectionDraftGate.mjs` (D5985), through section-triage's re-export.
export const cases = new Map([
  ['learning-discovery', Object.freeze({ section: 'all-learning', name: 'Learning discovery list rendering',
    file: 'frontend/src/pages/learning/LearningHome.jsx', test: 'frontend/test/learning_discovery_4648.test.mjs' })],
  ['help-guide-placement', Object.freeze({ section: 'all-help-center', name: 'Help Center guide placement',
    file: 'frontend/src/pages/docs/guidePlacement.js', test: 'frontend/test/help_placement_d626.test.mjs' })],
]);

export const issueLabels = Object.freeze(['bug', 'frontend', 'observability']);

/** The text whose SHA-256 is the episode's public key. The caller hashes it. */
export function issueKeyInput(repo, caseId, episode) {
  return repo + '/ordinary-ui/v1/' + caseId + '/' + episode;
}

export function issueMarker(key) {
  return '<!-- axal-section-incident:v1:' + key + ' -->';
}

/**
 * The public bug. `revision` is a 40-character commit or null; with null the
 * source and test are named as paths instead of links.
 */
export function issueDraft({ repo, caseId, key, count, revision }) {
  const spec = cases.get(caseId);
  if (!spec) throw new Error('Unknown reproduction case');
  if (!/^[0-9a-f]{64}$/.test(key) || !Number.isSafeInteger(count) || count < 1)
    throw new Error('Invalid incident key or count');
  let where = '`' + spec.file + '` · `' + spec.test + '`';
  if (revision != null) {
    if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Invalid source revision');
    const source = 'https://github.com/' + repo + '/blob/' + revision + '/';
    where = '[Source at the observed revision](' + source + spec.file + ') · [Regression test](' + source + spec.test + ')';
  }
  const marker = issueMarker(key);
  const body = [spec.name + ' failed in a controlled reproduction.',
    'Section: ' + spec.section + '. Cumulative observations at filing: ' + count + '.',
    where,
    'S01 triages the incident and authorizes any slot task. Recovery requires a verified release and healthy evidence.', marker].join('\n\n');
  return { marker, spec, title: 'UI regression: ' + spec.name, body, labels: [...issueLabels] };
}

/** The power-of-two milestone a cumulative count has reached (D5681). */
export function countMilestone(count) {
  return 2 ** Math.floor(Math.log2(count));
}

export function milestoneReceipt(key, bucket) {
  return '<!-- axal-section-count:v1:' + key + ':' + bucket + ' -->';
}

export function milestoneComment(key, bucket) {
  return 'Cumulative observations reached at least ' + bucket + '.\n\n' + milestoneReceipt(key, bucket);
}

/** The filing count a public body recorded, or NaN. */
export function filedCount(body) {
  return Number(/Cumulative observations at filing: (\d+)\./.exec(body ?? '')?.[1]);
}
