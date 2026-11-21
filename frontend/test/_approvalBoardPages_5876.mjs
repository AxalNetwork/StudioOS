/** #5876: model the page and aggregate contracts in mounted approval board tests. */
import { expertState, profileWord, testerRows } from '../src/pages/admin/approvals/approvalsModel.js';

/** The toolbar's filters over the tab's rows, in memory. */
export function filterTesters(rows, f) {
  const needle = String(f.q || '').trim().toLowerCase();
  const out = rows.filter((r) => {
    if (needle.length >= 2 && !`${r.name} ${r.email || ''}`.toLowerCase().includes(needle)) return false;
    if (f.profile && profileWord(f.profile) !== r.profile) return false;
    if (f.verified === 'yes' && !r.emailVerified) return false;
    if (f.verified === 'no' && r.emailVerified) return false;
    if (f.consent === 'yes' && !r.consent) return false;
    if (f.consent === 'no' && r.consent) return false;
    return true;
  });
  if (f.sort === 'newest') return [...out].sort((a, b) => (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity));
  if (f.sort === 'name') return [...out].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}



export function testerSummary(testers) {
  const counts = Object.fromEntries(['applied', 'active', 'paused', 'declined', 'removed'].map((key) =>
    [key, testers.filter((tester) => tester.status === key).length]));
  return { counts, in_programme: 1, recent_by_role: [{ role: 'founder', n: 1 }] };
}

export function testerPage(testers, params) {
  const candidates = testers.filter((tester) => !params.get('status') || tester.status === params.get('status'));
  const matches = filterTesters(testerRows(candidates), {
    q: params.get('q'), profile: params.get('role'), verified: params.get('email_verified'),
    consent: params.get('email_consent'), sort: params.get('sort'),
  });
  const size = Number(params.get('page_size') || 25);
  const offset = (Number(params.get('page') || 1) - 1) * size;
  const byId = new Map(candidates.map((tester) => [tester.id, tester]));
  return { matching: matches.length, rows: matches.slice(offset, offset + size).map(({ id }) => byId.get(id)) };
}

export function expertSummary(experts) {
  return { counts: Object.fromEntries(['verify', 'incomplete', 'verified', 'declined', 'hidden'].map((tab) =>
    [tab, experts.filter((expert) => expertState(expert) === tab).length])) };
}

export function expertPage(experts, params) {
  const tab = params.get('board_tab');
  const rows = experts.filter((expert) => !tab || expertState(expert) === tab);
  const offset = Number(params.get('offset') || 0);
  const limit = Number(params.get('limit') || 25);
  return { total: rows.length, items: rows.slice(offset, offset + limit) };
}

export function pitchSummary(pitches, attribution = { visit: 0, signup: 0 }) {
  return {
    counts: Object.fromEntries(['proposed', 'approved', 'published', 'rejected', 'withdrawn'].map((key) => [key, pitches[key]?.length ?? 0])),
    oldest_approved_at: pitches.approved?.map((pitch) => pitch.reviewed_at).filter(Boolean).sort()[0] ?? null,
    attribution_30d: attribution,
  };
}
