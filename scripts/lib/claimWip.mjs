import { readFileSync } from 'node:fs';
import { claimRef, isExpired, parseClaim } from './claims.mjs';

const states = ['draft', 'red', 'conflicted', 'green', 'waiting'];
const slotPattern = /^slot:(S\d+)$/i;
const slotsFor = labels => labels.map(label => slotPattern.exec(label)?.[1].toUpperCase()).filter(Boolean);

function bodyIssue(pull) {
  const body = (pull.body ?? '').replace(/<!--[^]*?-->/g, '');
  const match = /^\s*(?:Closes|Part of)\s+#([1-9]\d*)\b/im.exec(body);
  return match ? Number(match[1]) : null;
}

function branchIssue(pull) {
  const match = /^agent\/[^/]+\/([1-9]\d*)-/.exec(pull.headRefName ?? '');
  return match ? Number(match[1]) : null;
}

export async function readOpenPulls(graphql, owner, name) {
  const fields = 'number body isDraft mergeable headRefName labels(first:100) { nodes { name } } commits(last:1) { nodes { commit { statusCheckRollup { state } } } }';
  const read = async (firstPage, cursor) => {
    const data = await graphql(`query($owner:String!, $name:String!${firstPage ? '' : ', $cursor:String!'}) {
      repository(owner:$owner,name:$name) {
        first: pullRequests(states:OPEN, first:100${firstPage ? '' : ', after:$cursor'}, orderBy:{field:CREATED_AT,direction:ASC}) {
          totalCount nodes { ${fields} } pageInfo { hasNextPage endCursor }
        }
        ${firstPage ? `last: pullRequests(states:OPEN, last:100, orderBy:{field:CREATED_AT,direction:ASC}) { nodes { ${fields} } }` : ''}
      }
    }`, { owner, name, ...(firstPage ? {} : { cursor }) });
    if (data.errors?.length || !data.data?.repository?.first) throw new Error('GitHub GraphQL could not list open PRs');
    return data.data.repository;
  };

  const { first, last } = await read(true);
  const pulls = new Map([...first.nodes, ...last.nodes].map(pull => [pull.number, pull]));
  // The two ends cover the normal queue in one request. Page the middle only
  // when the queue outgrows both windows.
  let page = first;
  while (pulls.size < first.totalCount && page.pageInfo.hasNextPage) {
    ({ first: page } = await read(false, page.pageInfo.endCursor));
    for (const pull of page.nodes) pulls.set(pull.number, pull);
  }
  return [...pulls.values()];
}

function statusForPull(pull) {
  if (pull.isDraft) return 'draft';
  if (pull.mergeable === 'CONFLICTING') return 'conflicted';
  const state = pull.commits?.nodes[0]?.commit.statusCheckRollup?.state;
  if (state === 'FAILURE' || state === 'ERROR') return 'red';
  return state === 'SUCCESS' && pull.mergeable === 'MERGEABLE' ? 'green' : 'waiting';
}

export function parseWipCap(value) {
  if (value === undefined || value === '') return null;
  const cap = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(cap) || cap < 1) {
    throw new Error('LANDING_WIP_CAP must be a positive integer');
  }
  return cap;
}

export async function readWip({ api, pages, graphql, repo, now, labelsFile }) {
  const names = [...labelsFile.matchAll(/^\s*- name:\s*["']([^"']+)["']/gm)].map(match => match[1]);
  const double = names.includes('needs-session');
  const [owner, name] = repo.split('/');
  const [pulls, inProgress, refs] = await Promise.all([
    readOpenPulls(graphql, owner, name),
    pages(api, 'issues?state=open&labels=state%3Ain-progress'),
    pages(api, 'git/matching-refs/heads/claim/'),
  ]);
  const refByName = new Map(refs.map(ref => [ref.ref, ref.object.sha]));
  const bySlot = new Map([...slotsFor(names), 'unattributed'].map(slot => [slot, { pulls: [], expired: [] }]));
  const row = slot => {
    if (!bySlot.has(slot)) bySlot.set(slot, { pulls: [], expired: [] });
    return bySlot.get(slot);
  };
  const issues = new Map(inProgress.filter(issue => !issue.pull_request).map(issue => [issue.number, issue]));
  const issueNumbers = new Set(pulls.flatMap(pull => [bodyIssue(pull), branchIssue(pull)]).filter(Boolean));
  for (const number of issueNumbers) {
    if (issues.has(number)) continue;
    try {
      const issue = await api('GET', `issues/${number}`);
      if (!issue.pull_request) issues.set(number, issue);
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;
    }
  }

  const issueSlot = number => {
    const slots = slotsFor(issues.get(number)?.labels.map(label => label.name) ?? []);
    return slots.length === 1 ? slots[0] : null;
  };
  for (const pull of pulls.sort((a, b) => a.number - b.number)) {
    const slot = issueSlot(bodyIssue(pull)) ?? issueSlot(branchIssue(pull)) ?? 'unattributed';
    const weight = double && pull.labels?.nodes.some(label => label.name === 'needs-session') ? 2 : 1;
    row(slot).pulls.push({
      number: pull.number, state: statusForPull(pull), weight,
    });
  }
  for (const issue of inProgress) {
    if (issue.pull_request) continue;
    const sha = refByName.get(claimRef(issue.number));
    if (!sha) continue;
    const { message } = await api('GET', `git/commits/${sha}`);
    const claim = parseClaim(message);
    if (!claim || claim.issue !== issue.number || !isExpired(claim, now)) continue;
    row(claim.slot.toUpperCase()).expired.push(issue.number);
  }
  return bySlot;
}

export function localWipLabels() {
  return readFileSync(new URL('../../.github/labels.yml', import.meta.url), 'utf8');
}

export function capBlockers(row = { pulls: [] }, cap) {
  if (cap === null) return [];
  const blockers = row.pulls.filter(pull => pull.state !== 'green');
  return blockers.reduce((total, pull) => total + pull.weight, 0) >= cap ? blockers : [];
}

export function formatWip(bySlot, slot) {
  const rows = slot ? [[slot, bySlot.get(slot) ?? { pulls: [], expired: [] }]]
    : [...bySlot].sort(([a], [b]) => a.localeCompare(b));
  const header = '| Slot | Draft | Red | Conflicted | Green | Waiting | Non-green weight | Expired in-progress issues |';
  const cell = list => list.length ? list.join(', ') : '—';
  return [
    header,
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(([label, { pulls, expired }]) => {
      const groups = states.map(state => cell(pulls.filter(pull => pull.state === state)
        .map(pull => `#${pull.number}${pull.weight === 2 ? ' (×2)' : ''}`)));
      const weighted = pulls.filter(pull => pull.state !== 'green').reduce((sum, pull) => sum + pull.weight, 0);
      return `| ${[label, ...groups, weighted, cell([...expired].sort((a, b) => a - b).map(number => `#${number}`))].join(' | ')} |`;
    }),
  ].join('\n');
}
