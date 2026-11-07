/**
 * #4717 package 6 — The Jobs card: postings by status and the most applications of all time, with days open.
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */
import { daysOpenWords } from './format.js';
import { blockOf, count, countMap, isObj, isText } from './read.js';

export const JOB_PARTS = [
  ['published', 'Published', 'violet'],
  ['pending_review', 'Pending review', 'sky'],
  ['draft', 'Draft', 'amber'],
  ['closed', 'Closed', 'emerald'],
  ['rejected', 'Rejected', 'muted'],
];

export function buildJobs(reads) {
  const reason = 'The job board could not be read. That is not the same as no jobs.';
  const b = blockOf(reads.overview, 'jobs', reason);
  if (b.state === 'loading') return b;
  if (b.state !== 'ready') return { state: 'unreadable', reason: b.reason || reason };
  // #4717 package 3: the read counts every status, zeros included; a status it leaves out is not a zero.
  const by = countMap(b.block.by_status, JOB_PARTS.map(([key]) => key));
  if (!by || !Array.isArray(b.block.most_applied)) return { state: 'unreadable', reason };
  const values = Object.entries(by);
  // #4717 package 3: each most-applied row names its posting and counts its applications in whole numbers.
  if (!b.block.most_applied.every((j) => isObj(j) && isText(j.title) && count(j.applications) !== null)) return { state: 'unreadable', reason };
  const counts = new Map(values);
  const parts = JOB_PARTS.map(([key, label, tone]) => ({ label, tone, value: counts.get(key) || 0 }));
  const total = values.reduce((t, [, v]) => t + v, 0);
  const other = total - parts.reduce((t, x) => t + x.value, 0);
  if (other > 0) parts.push({ label: 'Other', tone: 'muted', value: other });
  const most = b.block.most_applied.map((j) => ({
    id: j.posting_id, title: j.title, company: j.company || null, applications: j.applications, daysOpen: daysOpenWords(j.days_open),
  }));
  return { state: 'ready', total, parts, most };
}
