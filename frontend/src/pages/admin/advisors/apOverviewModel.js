// D977: adapt only the explicit D973 block states; absent values never become zero.
export const KINDS = { advisor: 'Advisors', operating_partner: 'Operating partners', deck_only: 'Deck-only names' };
export const STAGES = [
  { key: 'active', label: 'Active', tone: 'violet' }, { key: 'onboarding', label: 'Onboarding', tone: 'sky' },
  { key: 'paused', label: 'Paused', tone: 'amber' }, { key: 'ended', label: 'Ended', tone: 'muted' },
  { key: null, label: 'Not recorded', tone: 'muted' },
];
export const count = (n) => Number(n).toLocaleString('en-US');
export const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
export const words = (s) => String(s || 'Not recorded').replaceAll('_', ' ');
export function block(read, value, validate = () => true) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status !== 'ready' || !value || value.available === false) return { state: 'unreadable', reason: value?.reason || 'This block could not be read. Try again.' };
  if (value.recorded === false) return { state: 'notrecorded', reason: value.reason };
  if (value.available !== true || value.recorded !== true || !validate(value.value)) return { state: 'unreadable', reason: 'The answer is incomplete. Try again.' };
  return { state: 'ready', value: value.value };
}
const num = (n) => Number.isSafeInteger(n) && n >= 0;
export function overviewBlocks(read) {
  const d = read?.data || {};
  return {
    people: block(read, d.counts?.people, num),
    kinds: block(read, d.counts?.by_kind, v => Array.isArray(v) && Object.keys(KINDS).every(k => v.some(r => r.kind === k && num(r.count)))),
    stages: block(read, d.counts?.by_stage, (v) => Array.isArray(v) && v.every(r => Object.hasOwn(KINDS, r.kind) && STAGES.some(s => s.key === r.stage) && num(r.count))),
    firms: block(read, d.counts?.firms, v => v && num(v.total) && num(v.listed)),
    hosts: block(read, d.counts?.lab_hosts, v => v && num(v.approved) && num(v.pending)),
    assignments: block(read, d.counts?.cohort_assignments, num),
    sessions: block(read, d.sessions, v => v && num(v.this_month) && Array.isArray(v.weeks) && v.weeks.every(w => typeof w.week === 'string' && Number.isFinite(Date.parse(w.week)) && ['booked', 'completed', 'no_show'].every(k => num(w[k])))),
    deals: block(read, d.deals, v => v && num(v.total) && num(v.ending_soon) && Array.isArray(v.by_type) && v.by_type.every(r => num(r.count))),
    skills: block(read, d.skills, v => v && Array.isArray(v.supply) && v.supply.every(r => typeof r.skill === 'string' && num(r.count))),
    settlements: block(read, d.settlements, v => v && v.currency === 'usd' && num(v.count) && num(v.to_member_cents) && num(v.from_member_cents) && Array.isArray(v.rows)),
  };
}
export function stageChart(b) {
  return { type: 'stackbars', head: 'Kind', parts: STAGES, rows: Object.entries(KINDS).map(([key, label]) => ({ key, label,
    parts: STAGES.map(s => ({ ...s, value: b.value.filter(r => r.kind === key && r.stage === s.key).reduce((n, r) => n + r.count, 0) })),
  })) };
}
export function sessionsChart(b) {
  return { type: 'lines', labels: b.value.weeks.map(w => new Date(w.week + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })), currentIndex: b.value.weeks.findIndex(w => w.partial),
    series: [{ key: 'booked', label: 'Booked', tone: 'violet' }, { key: 'completed', label: 'Completed', tone: 'sky' }, { key: 'no_show', label: 'No-show', tone: 'amber', dash: true }].map(s => ({ ...s, values: b.value.weeks.map(w => w[s.key]) })) };
}
const QUEUES = [
  ['unattached_partners', 'Firm', 'Attach to firm', '/admin/advisors-partners/firms'],
  ['missing_advisor_profiles', 'Profile', 'Open member record', '/admin/accounts'],
  ['ending_deals', 'Deal', 'Open deals', '/admin/partner-invitations/deals'],
  ['pending_hosts', 'Lab hosts', 'Review hosts', '/admin/programs/spinout-lab/hosts'],
  ['missing_deck_photos', 'Deck', 'Edit deck roster', '/admin/advisors-partners/deck'],
  ['settlements', 'Settlement', 'Open in Contracts', '/admin/contracts'],
];
export function overviewNeeds(read) {
  const rows = [], notices = [];
  for (const [key, label, action, to] of QUEUES) {
    const b = block(read, read?.data?.needs_you?.[key], key === 'settlements' ? v => v && v.currency === 'usd' && Array.isArray(v.rows) && v.rows.every(r => num(r.amount_cents) && ['to_member', 'from_member'].includes(r.direction) && typeof r.due_on === 'string') : Array.isArray);
    if (b.state !== 'ready') { notices.push({ key, label, ...b }); continue; }
    const items = key === 'settlements' ? b.value.rows : b.value;
    items.forEach((item, i) => {
      const who = item.name || item.ref || `#${item.id}`;
      let text;
      if (key === 'unattached_partners') text = `${who} has a partner account but no firm.`;
      if (key === 'missing_advisor_profiles') text = `${who} holds an advisor account with no advisor profile.`;
      if (key === 'ending_deals') text = `Partner deal ${who} ends ${item.ends_at ? item.ends_at.slice(0, 10) : 'on a date not recorded'}.`;
      if (key === 'pending_hosts') text = `Office-hours host application ${who} is waiting.`;
      if (key === 'missing_deck_photos') text = `${who} is on the deck slide with no photo.`;
      if (key === 'settlements') text = `A ${money(item.amount_cents)} settlement ${item.direction === 'to_member' ? 'to' : 'from'} a member is due ${item.due_on}.`;
      rows.push({ key: `${key}:${item.ref ?? item.id ?? i}`, label, text, action, to });
    });
  }
  return { rows, notices };
}
export function overviewTiles(b, read) {
  const needs = overviewNeeds(read);
  const kind = key => b.kinds.state === 'ready' && b.kinds.value.find(r => r.kind === key)?.count;
  const tile = (key, label, source, value, sub) => ({ key, label, ...source, text: source.state === 'ready' ? value : null, sub });
  const queueSub = (key, text) => {
    const n = needs.notices.find(r => r.key === key);
    return n ? `${n.label}: ${n.state === 'unreadable' ? 'Unreadable' : n.state === 'loading' ? 'Reading…' : 'Not recorded'}` : text;
  };
  return [
    tile('advisors', 'Advisors', b.kinds, num(kind('advisor')) ? count(kind('advisor')) : 'Not recorded', queueSub('missing_advisor_profiles', `${needs.rows.filter(r => r.label === 'Profile').length} have no advisor profile yet`)),
    tile('partners', 'Operating partners', b.kinds, num(kind('operating_partner')) ? count(kind('operating_partner')) : 'Not recorded', queueSub('unattached_partners', `${needs.rows.filter(r => r.label === 'Firm').length} not attached to a firm`)),
    tile('firms', 'Firms', b.firms, count(b.firms.value?.total), `${count(b.firms.value?.listed)} listed in the public directory`),
    tile('deals', 'Active partner deals', b.deals, count(b.deals.value?.total), `${count(b.deals.value?.ending_soon)} end within 30 days`),
    tile('hosts', 'Lab office-hours hosts', b.hosts, count(b.hosts.value?.approved), `approved · ${count(b.hosts.value?.pending)} waiting`),
    tile('assignments', 'Cohort assignments', b.assignments, count(b.assignments.value), 'active'),
    tile('sessions', 'Sessions this month', b.sessions, count(b.sessions.value?.this_month), 'Advisor and partner office hours · ET month to date'),
    tile('settlements', 'Settlements due in 30 days', b.settlements, `To members ${money(b.settlements.value?.to_member_cents)}`, `From members ${money(b.settlements.value?.from_member_cents)} · across ${count(b.settlements.value?.count)}`),
  ];
}
