/**
 * D4814 (#4814, part 7) — what the Approvals pages read, for the browser pass
 * in `approvals.a11y.spec.mjs`: the Studio glance, the inbox, one item, the
 * weekly series, Decided and the three Approvals boards, as the Worker answers
 * them (the shapes the node suites already hold: admin_approvals_d1038 and
 * admin_approvals_v2_4814_part3). Every /api read on 127.0.0.1 is answered
 * here; a read with no fixture (the shell's own) answers {}, and each POST is
 * answered ok and listed in `log`. Every name
 * is made up.
 */
import { NOW } from './_editor.mjs';

const iso = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
export const ADMIN = { id: 7, role: 'admin', is_super_admin: true, name: 'Admin A', email: 'a@example.test', email_verified: true, is_active: true };
const lane = (key, label, count, oldest, sla) => ({ key, label, count, oldest_age_hours: oldest, sla });
export const GLANCE = { tier: 'hq', approvals: { pending_total: null, no_queue: [], lanes: [
  lane('due_diligence', 'Due diligence', 6, 146, 'past'), lane('kyc', 'KYC', 10, 103, 'past'), lane('exploring', 'Exploring', 60, 2, 'ok'),
  lane('partner_profiles', 'Partner profiles', 4, 30, 'due_soon'), lane('events', 'Events', 0, null, 'ok'), lane('jobs', 'Jobs', 3, null, 'unknown'),
  lane('lp', 'LP applications', null, null, 'unknown'), lane('referrals', 'Referrals', 0, null, 'ok'), lane('cohort', 'Cohort applications', 7, 50, 'due_soon'),
  lane('moderation', 'Spinout moderation', 1, 9, 'ok'), lane('best_fit', 'Best-Fit consultations', 1, 20, 'ok'),
  lane('product_testers', 'Product testers', 2, 100, 'past'), lane('comarketing', 'Co-marketing', 1, 26, 'due_soon'), lane('wellbeing_experts', 'Wellbeing experts', 1, 103, 'past'),
  ...['kyb', 'perk_listings', 'strategic_access', 'lab_hosts', 'score_flags', 'articles'].map((k) => lane(k, k, 0, null, 'ok')),
] }, hq: { lanes: [{ key: 'payouts', count: 4, oldest_age_hours: 80 }, { key: 'tickets', count: null }], pending_total: null, unreadable: ['Tickets'] } };
const REVIEWERS = [{ id: 7, name: 'Admin A' }, { id: 8, name: 'Admin B' }, { id: 9, name: 'Chris Long-Named Reviewer' }];
export const INBOX = {
  items: [
    { lane: 'kyc', lane_label: 'KYC', id: 41, who: 'Person A', what: 'Identity check', created_at: iso(103), age_hours: 103, sla: 'past', assignee: { user_id: 7, name: 'Admin A' } },
    { lane: 'wellbeing_experts', lane_label: 'Wellbeing experts', id: 51, who: 'Eva Expert', what: 'Credential review', created_at: iso(900), age_hours: 900, sla: 'past', assignee: null },
    { lane: 'due_diligence', lane_label: 'Due diligence', id: 9, who: 'Company B with a fairly long registered name Ltd', what: 'Seed round', created_at: iso(30), age_hours: 30, sla: 'due_soon', assignee: null },
    { lane: 'jobs', lane_label: 'Jobs', id: 3, who: 'Company C', what: 'Engineer', created_at: null, age_hours: null, sla: 'unknown' },
    { lane: 'exploring', lane_label: 'Exploring', id: 77, who: 'Person E', what: 'Exploring access', created_at: iso(2), age_hours: 2, sla: 'ok', assignee: null },
  ],
  total: 123, unfiltered_total: 123, page: 1, page_size: 25,
  lanes: [
    { key: 'kyc', label: 'KYC', group: 'people', count: 10, bands: { ok: 2, due_soon: 3, past: 5, unknown: 0 } },
    { key: 'due_diligence', label: 'Due diligence', group: 'deals', count: 6, bands: { ok: 0, due_soon: 6, past: 0, unknown: 0 } },
    { key: 'jobs', label: 'Jobs', group: 'community', count: 3, bands: { ok: 0, due_soon: 0, past: 0, unknown: 3 } },
    { key: 'exploring', label: 'Exploring', group: 'programs', count: 104, bands: { ok: 100, due_soon: 4, past: 0, unknown: 0 } },
    { key: 'lp', label: 'LP applications', group: 'deals', count: null, bands: null, bands_reason: 'LP applications could not be read.' },
  ],
  unreadable: ['LP applications'], reason: 'LP applications could not be read.', capped: false,
  tiles: { over_72h: 5, assigned_to_me: 2, unassigned: 70, overdue_unassigned: 3, complete: false, oldest: { age_hours: 900, lane: 'wellbeing_experts', label: 'Wellbeing experts' }, per_admin: [{ id: 7, name: 'Admin A', count: 14 }, { id: 8, name: 'Admin B', count: 3 }] },
  reviewers: REVIEWERS, decides: false, assignments: { available: true },
};
const WEEKS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'];
export const WEEKLY = { weeks: WEEKS.map((w) => ({ week_start: w })), totals: { arrived: [10, 12, 9, 14, 11, 13, 15, 6], decided: [8, 11, 10, 12, 9, 14, 12, 4], arrived_leaves_out: [], decided_leaves_out: ['Exploring'] }, tile: { decided_this_week: 12, median_wait_hours: 33 }, unreadable: [] };
export const ITEM = { item: INBOX.items[0], lane: { key: 'kyc', label: 'KYC', group: 'people', notifies: 'The member, by email', decided_on: '/admin/kyc', hq: false },
  history: { available: true, items: [{ kind: 'assigned', created_at: iso(80), actor_user_id: 8, actor_name: 'Admin B', assignee_user_id: 7, assignee_name: 'Admin A' }] }, decides: false };
export const DECIDED = {
  items: [
    { lane: 'kyc', lane_label: 'KYC', item_id: 40, who: 'Person D', outcome: 'approved', outcome_word: 'Approved', decided_at: iso(20), decided_by: { id: 7, name: 'Admin A' }, wait_hours: 33, note: 'Welcome aboard', note_shown: true },
    { lane: 'comarketing', lane_label: 'Co-marketing', item_id: 32, item_uid: 'p2', who: 'Partner B', outcome: 'rejected', outcome_word: 'Declined', decided_at: iso(40), decided_by: { id: 8, name: 'Admin B' }, wait_hours: null, note: 'Off-brand', note_shown: false },
    { lane: 'support', lane_label: 'Support', scope: 'hq', item_id: 5, who: 'Person F', outcome: 'approved', outcome_word: 'Resolved', decided_at: iso(60), decided_by: { id: 7, name: 'Admin A' }, wait_hours: 5, note: null },
  ],
  total: 3, page: 1, page_size: 25,
  lanes: [
    { key: 'kyc', label: 'KYC', recorded: true, since: null, count: 300 },
    { key: 'comarketing', label: 'Co-marketing', recorded: true, since: null, count: 12 },
    { key: 'wellbeing_experts', label: 'Wellbeing experts', recorded: true, since: '2026-10-21', count: 2 },
    { key: 'support', label: 'Support', scope: 'hq', recorded: true, since: null, count: 9 },
    { key: 'exploring', label: 'Exploring', recorded: false, reason: 'Explorers do not record who decided.' },
  ],
  deciders: [{ id: 7, name: 'Admin A' }, { id: 8, name: 'Admin B' }], unreadable: [],
};
export const TESTERS = [
  { id: 1, status: 'applied', applied_at: iso(100), availability: '3 hours a week', consent_email_at: iso(100), consent_version: 'v2', member: { name: 'Gus Demo', email: 'gus@example.test', email_verified: 1, role: 'investor' } },
  { id: 3, status: 'applied', applied_at: iso(30), member: { name: 'Ben Sample', email: 'ben@example.test', email_verified: 1, role: 'founder' } },
  { id: 2, status: 'active', applied_at: iso(900), member: { name: 'Eva Demo', email: 'eva@example.test', email_verified: 1, role: 'advisor' } },
];
export const PITCHES = {
  proposed: [{ id: 31, uid: 'p1', title: 'Hiring your first engineer', summary: 'A webinar on hiring.', asset_type: 'webinar', partner_company: 'Partner A', partner_name: 'Chloé Placeholder', created_at: iso(26), proposed_date: '2026-12-03', target_audience: 'Founders' }],
  approved: [{ id: 32, uid: 'p2', title: 'Fundraising digest', asset_type: 'newsletter', partner_company: 'Partner B', reviewed_at: iso(200), attribution_code: 'CM-1' }],
  published: [],
};
export const EXPERTS = [
  { id: 51, uid: 'e1', name: 'Eva Expert', headline: 'Clinical psychologist', decision_state: 'pending', profile_completion_pct: 92, review_version: 3, created_at: iso(103), credentials: { licence_number: 'PYL-1', issuer: 'Register', expires_on: '2030-01-01', files: [{ uid: 'f1', file_name: 'Licence.pdf', url: '/f1' }] } },
];
const LANE_ITEMS = {
  product_testers: [{ lane: 'product_testers', id: 1, assignee: { user_id: 8, name: 'Admin B' } }, { lane: 'product_testers', id: 3, assignee: null }],
  comarketing: [{ lane: 'comarketing', id: 31, assignee: null }],
  wellbeing_experts: [{ lane: 'wellbeing_experts', id: 51, assignee: { user_id: 7, name: 'Admin A' } }],
};

/** One handler for every /api call; unknown reads answer {} and are listed. */
export async function install(page, { over = {}, log = [] } = {}) {
  await page.addInitScript((u) => { try { localStorage.setItem('user', JSON.stringify(u)); } catch { /* storage off */ } }, ADMIN);
  await page.route((u) => u.hostname === '127.0.0.1' && u.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const x = new URL(req.url());
    const path = x.pathname; const q = x.searchParams;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (over[path]) return json(...[].concat(over[path](q, req)));
    if (req.method() === 'POST') { log.push(`POST ${path}`); return json({ ok: true, assigned: [], notified: true }); }
    if (path === '/api/auth/me') return json(ADMIN);
    if (path === '/api/admin/studio/glance') return json(GLANCE);
    if (path === '/api/admin/approvals') {
      const l = q.get('lane');
      if (l && LANE_ITEMS[l] && !q.get('q')) { const items = LANE_ITEMS[l]; return json({ items, total: items.length, page: 1, page_size: 25, reviewers: REVIEWERS, tiles: { per_admin: [{ id: 7, count: 1 }, { id: 8, count: 4 }] }, assignments: { available: true } }); }
      return json(INBOX);
    }
    if (path === '/api/admin/approvals/decided/weekly') return json(WEEKLY);
    if (path === '/api/admin/approvals/decided') return json(DECIDED);
    if (path.startsWith('/api/admin/approvals/items/')) return json(ITEM);
    if (path === '/api/admin/product-testers') { const s = q.get('status'); const rows = TESTERS.filter((r) => !s || r.status === s); return json({ rows, matching: rows.length, totals: { applied: 2, active: 1, paused: 0, declined: 0, removed: 0 } }); }
    const t = /^\/api\/admin\/product-testers\/(\d+)$/.exec(path);
    if (t) { const row = TESTERS.find((r) => r.id === Number(t[1])); return row ? json({ tester: row, programs: [], events: [] }) : json({ code: 'not_found' }, 404); }
    if (path === '/api/comarketing/admin/queue') { const items = PITCHES[q.get('status')] || []; return json({ items, total: items.length, attribution_30d: { visit: 0, signup: 0 } }); }
    const pm = /^\/api\/comarketing\/admin\/pitches\/([^/]+)$/.exec(path);
    if (pm) { const p = Object.values(PITCHES).flat().find((x) => x.uid === pm[1]); return json({ ...p, status: Object.keys(PITCHES).find((k) => PITCHES[k].includes(p)), decided: null }); }
    if (path === '/api/wellbeing/admin/experts') return json({ items: EXPERTS, total: EXPERTS.length });
    const em = /^\/api\/wellbeing\/admin\/experts\/([^/]+)\/review$/.exec(path);
    if (em) return json({ expert: EXPERTS.find((e) => e.uid === em[1]), history: [] });
    if (path === '/api/licence/mine/requests') return json({ items: [] });
    return json({});
  });
}
