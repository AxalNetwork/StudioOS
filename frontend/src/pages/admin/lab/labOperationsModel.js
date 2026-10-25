import { parseStamp } from '../../../ui/parseStamp.js';

export const CHECKLIST = [
  ['From the 1st', 'Review as they arrive.', '/applications'],
  ['7 days before the start', 'The pool freezes; decide everyone.', '/applications'],
  ['12 hours before', 'The capacity check runs.', '/cohorts'],
  ['The 1st', 'The cohort starts.', '/cohorts'],
  ['Each deadline', 'Check at risk and grace.', '/participants'],
  ['After Week 4', 'Certificates and formation.', '/graduation'],
];
export const TOOLS = [
  ['Decide applications', 'Admin and Super Admin', '/applications'],
  ['Grace and changes', 'Admin and Super Admin', '/participants'],
  ['Run below the minimum', 'Admin and Super Admin', '/cohorts'],
  ['Open a workspace · recent authenticator code', 'Admin and Super Admin', '/participants'],
  ['Read support sessions', 'Super Admin', '/activity'],
  ['Edit this playbook', 'Super Admin', '/how-it-runs'],
];
export const CALENDAR = [
  'Applications open on the 1st of the month before at 00:00 ET and close 7 days before the start at 23:59 ET.',
  'Cohorts start on the 1st at 00:00 ET. Times are America/New_York.',
  'Reminders go 72 and 24 hours before applications close.',
  'The four weeks end on days 7, 14, 21 and 28, at 23:59 ET. Dates cannot be moved here.',
];
export const MESSAGES = ['Application received', 'Applications close soon', 'Approved', 'Waitlisted', 'Declined', 'Cohorts combined', 'Workspace live', 'Grace given', 'Week passed', 'Week failed'];
export const ACTIVITY_TYPES = [
  ['', 'All types'], ['decisions', 'Decisions'], ['interviews', 'Interviews'], ['cohort', 'Cohort events'],
  ['weeks', 'Week outcomes'], ['messages', 'Messages'], ['hosts', 'Hosts'], ['certificates', 'Certificates'],
  ['formation', 'Formation'], ['playbook', 'Playbook'],
].map(([value, label]) => ({ value, label }));
export const BY = [{ value: '', label: 'By: everyone' }, { value: 'clock', label: 'The Lab’s clock' }, { value: 'admin', label: 'An admin' }];
export const SORT = [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }];
export function stamp(value) {
  const ms = parseStamp(value);
  return ms === null ? 'Not recorded' : `${new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms)} ET`;
}
export function sizeProblem(value) {
  return /^\d+$/.test(String(value).trim()) && Number(value) <= 1000 ? null : 'Enter a whole number between 0 and 1000.';
}
export function sectionsOf(data, draft) {
  const sections = (draft ? data?.draft?.sections : data?.playbook?.sections) || [];
  return (data?.section_catalogue || []).map((s) => ({ ...s, ...(sections.find((x) => x.key === s.key) || {} ) }));
}
export function eventWord(value) {
  const words = {
    applicant_approved: 'Application approved', applicant_rejected: 'Application declined', applicant_waitlisted: 'Application waitlisted',
    applications_closed: 'Applications closed', capacity_ok: 'Capacity checked', cycle_postponed: 'Cohorts combined', cycle_activated: 'Cohort started',
    force_proceed: 'Run below the minimum', settings_updated: 'Cohort size changed',
    'lab_host.approve': 'Host approved', 'lab_host.reject': 'Host declined', 'lab_host.revoke': 'Host removed',
    spinout_certificate_issued: 'Certificate issued', spinout_certificate_revoked: 'Certificate revoked',
    'program.playbook.edit': 'Playbook draft edited', 'program.playbook.publish': 'Playbook published', 'program.registry.update': 'Program updated',
  };
  return words[value] || String(value || 'Not recorded').replaceAll('_', ' ');
}
export const byWord = (by) => by === 'clock' ? 'the Lab’s clock' : 'an admin';
export function supportRows(items, q, sort) {
  const search = q.trim().toLowerCase();
  return items.filter((x) => [x.admin_name, x.target_name, x.reason].some((v) => String(v || '').toLowerCase().includes(search)))
    .slice().sort((a, b) => (sort === 'oldest' ? 1 : -1) * ((parseStamp(a.started_at) || 0) - (parseStamp(b.started_at) || 0)) || Number(b.id) - Number(a.id));
}
export function pageOf(items, page, size = 25) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(page, pages);
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, pages, size, from: items.length ? (p - 1) * size + 1 : 0, to: Math.min(p * size, items.length) };
}

/** An incomplete successful response is unreadable, never an empty history or invented size. */
export function requirePlaybook(data) {
  if (!Array.isArray(data?.section_catalogue) || !Array.isArray(data?.playbook?.sections) || typeof data.playbook.published !== 'boolean') throw new Error('The playbook read was incomplete.');
  return data;
}
export function requireSettings(data) {
  if (!data?.settings || !['min', 'max'].every((k) => Number.isInteger(data.settings[k]) && data.settings[k] >= 0)) throw new Error('The cohort size read was incomplete.');
  return data;
}
export function requireActivity(data) {
  if (!Array.isArray(data?.items) || !Number.isInteger(data.total) || data.total < 0 || typeof data.coverage !== 'string') throw new Error('The activity read was incomplete.');
  return data;
}
export function requireGrants(data) {
  if (!Array.isArray(data?.licences)) throw new Error('The program grants read was incomplete.');
  return data;
}
export function requireSupport(data) {
  if (!Array.isArray(data?.sessions)) throw new Error('The support sessions read was incomplete.');
  return data;
}
