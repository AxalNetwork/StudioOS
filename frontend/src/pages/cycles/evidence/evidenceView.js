/**
 * D1266 (#3289) — the founder's Evidence view, from `GET /api/cycles/raise/evidence`
 * (D1263's items, proposals and coverage; D1264's claims; D1266's opens). Pure,
 * so `frontend/test/raise_evidence_view_d1266.test.mjs` holds each rule.
 *
 * FACTS BY CODE. A claim's state, a Source label, a strength and a date are the
 * Worker's, read from the record; nothing here sets one. A Typed-only claim is
 * the founder's figure (`founders_figure`) and is never counted as Backed.
 *
 * NEVER A ZERO FOR A MISSING VALUE. A block the read could not answer is
 * `unreadable` (its own Try again); a count over a page that has more says so
 * ("100+"); a figure with no record says "Not recorded".
 */
import { AREAS, CLAIM_STATE, SHARING, SOURCES } from './evidenceModel.js';

/** Where each claim surface lives (D1264 §2), its area and the module that states it. */
export const SURFACES = Object.freeze({
  narrative: { label: 'Investor narrative', area: 'Investor narrative and Pitch deck', href: '/raise/investor-narrative' },
  deck: { label: 'Pitch deck', area: 'Investor narrative and Pitch deck', href: '/raise/pitch' },
  readiness: { label: 'Fundraising readiness', area: 'Fundraising readiness', href: '/raise/fundraising-readiness' },
  use_of_funds: { label: 'Use of funds', area: 'Use of funds', href: '/raise/use-of-funds' },
  cap_table: { label: 'Cap table', area: 'Cap table', href: '/raise/cap-table' },
  capital_model: { label: 'Capital model', area: 'Capital model', href: '/raise/fundraising-readiness' },
});
/** The module an evidence area opens (D1263 `MODULE_FOR`). */
export const AREA_HREF = Object.freeze({
  'Fundraising readiness': '/raise/fundraising-readiness', 'Investor narrative and Pitch deck': '/raise/investor-narrative',
  'Use of funds': '/raise/use-of-funds', 'Data room': '/raise/data-room', 'Cap table': '/raise/cap-table',
  'Capital relationships': '/raise/capital-relationships', Legal: '/raise/fundraising-readiness', 'Capital model': '/raise/fundraising-readiness',
});

/** The Worker's figure words (`raiseCycle.ts` FIGURE_LABEL) and the other claim kinds. */
export const CLAIM_KIND = Object.freeze({
  mrr: 'MRR', arr: 'ARR', paying_customers: 'Paying customers', revenue: 'Monthly revenue', revenue_growth: 'Revenue growth',
  net_burn: 'Net burn', runway: 'Runway', churn: 'Churn', cac: 'CAC', interviews: 'Customer interviews', lois: 'Letters of intent',
  waitlist: 'Waitlist sign-ups', pilots: 'Pilots', headcount: 'Headcount', raise: 'The raise',
  traction_proof: 'Traction proof', team: 'Team', customer_evidence: 'Product-market fit',
  use_of_funds_section: 'Share of spend', holder_shares: 'Founder holding', growth: 'Monthly growth', margin: 'Gross margin',
});
const KIND_UNIT = Object.freeze({
  mrr: 'money', arr: 'money', revenue: 'money', net_burn: 'money', cac: 'money', raise: 'money',
  revenue_growth: 'percent', churn: 'percent', growth: 'percent', margin: 'percent', use_of_funds_section: 'percent',
  runway: 'months', holder_shares: 'shares',
});

/** The evidence kinds D1263's rules record, in words. */
export const ITEM_KIND = Object.freeze({
  'revenue-receipt': 'Revenue receipt', 'bank-runway': 'Runway from the bank', 'founder-holding': 'Founder holding',
  'vesting-schedule': 'Vesting schedule', 'founder-commits': 'Founder contributions', 'skill-actions': 'Team actions',
  'pain-theme': 'Pain theme', 'consented-quote': 'Quote, with consent', 'icp-fit': 'Interview fit',
  'demand-signal': 'Demand signal', 'experiment-result': 'Experiment result', 'validation-verdict': 'Validation decision',
  'kpi-snapshot': 'KPI snapshot', 'bank-revenue': 'Revenue from the bank', 'roadmap-release': 'Release',
  'must-have-done': 'Must-have delivered', 'mapped-bank-spend': 'Mapped bank spend', 'hiring-plan': 'Planned hire',
  'roadmap-milestone': 'Milestone', 'formation-proof': 'Formation step', 'filed-obligation': 'Filed obligation',
  'signed-document': 'Signed document', 'github-ip-step': 'GitHub IP step', 'bank-statement': 'Bank statement',
  'loi-file': 'Letter of intent', 'revenue-proof': 'Revenue proof', 'accepted-safe': 'Accepted SAFE', 'filed-83b': '83(b) election',
  'signed-founder-equity': 'Founder equity document', 'confirmed-receipt': 'Received from an investor',
  'round-call-response': 'Round-call response', 'typed-commitment': 'Commitment, as entered', 'model-assumption': 'Model assumption',
});
export const itemTitle = (i) => ITEM_KIND[i?.kind] || 'Evidence';

/** The datasets a source block names (D1263), as the founder knows them. */
export const DATASET = Object.freeze({
  bank: 'Mercury', bankSpend: 'Mercury spend', bankDocuments: 'Mercury statements', receipts: 'Mercury receipts', safes: 'Mercury SAFEs',
  revenue: 'Revenue', holders: 'Cap table holders', vesting: 'Vesting', contributors: 'GitHub contributors', releases: 'GitHub releases',
  ipSteps: 'GitHub IP step', skills: 'Team actions', themes: 'Problem discovery', interviews: 'Interviews', signals: 'Demand signals',
  experiments: 'Experiments', verdicts: 'Validation decisions', metrics: 'KPI snapshots', features: 'Solution design', hires: 'Planned hires',
  milestones: 'Roadmap', formation: 'Formation', obligations: 'Entity obligations', documents: 'Documents', filings83b: '83(b) elections',
  responses: 'Round calls', prospects: 'Capital relationships', models: 'Capital model',
});
export const datasetName = (d) => DATASET[d] || 'A source';

const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.key, s.label]));
export const sourceWord = (k) => SOURCE_LABEL[k] || null;
export const sharingWord = (v) => SHARING[v] || null;
export const PROVIDER = Object.freeze({ stripe: 'Stripe', mercury: 'Mercury', github: 'GitHub', notion: 'Notion', google_workspace: 'Google Workspace', vercel: 'Vercel' });
export const providerWord = (p) => (p ? PROVIDER[p] || String(p) : null);

/** A date as the record holds it, "3 Oct 2026"; never the sync's. */
export function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return mon ? `${Number(m[3])} ${mon} ${m[1]}` : null;
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const thousands = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
/** A figure in its unit; null when there is none, never 0. */
export function figure(value, unit, currency = null) {
  const n = num(value);
  if (n == null) return null;
  const cur = currency && String(currency).toUpperCase() !== 'USD' ? `${String(currency).toUpperCase()} ` : '$';
  if (unit === 'cents') return `${cur}${thousands(n / 100)}`;
  if (unit === 'money') return `${cur}${thousands(n)}`;
  if (unit === 'percent') return `${thousands(n)}%`;
  if (unit === 'months') return `${thousands(n)} months`;
  if (unit === 'shares') return `${thousands(n)} shares`;
  if (unit === 'people') return `${thousands(n)} people`;
  if (unit === 'accounts') return `${thousands(n)} accounts`;
  return thousands(n);
}
export const statedFigure = (c) => (c?.record?.stated_shown ?? figure(c?.stated_value, KIND_UNIT[c?.claim_kind] || 'count'));
export const itemFigure = (i) => figure(i?.value_num, i?.value_unit, i?.currency);

/** A claim in words: the figure, then where it is stated ("Narrative · v3", "Slide 2"). */
export function claimTitle(c) {
  const kind = CLAIM_KIND[c?.claim_kind] || 'Claim';
  const field = String(c?.field_key || '');
  if (c?.claim_kind === 'use_of_funds_section') return `${kind}: ${field.replace(/^section:/, '').replace(/[_-]+/g, ' ')}`;
  return kind;
}
export function claimWhere(c) {
  const s = SURFACES[c?.surface];
  if (!s) return null;
  const slide = /^slide:(\d+)/.exec(String(c?.field_key || ''));
  const version = c?.surface_version && c.surface_version !== 'current' ? ` · ${c.surface_version}` : '';
  return `${s.label}${version}${slide ? ` · slide ${slide[1]}` : ''}`;
}
export const claimArea = (c) => SURFACES[c?.surface]?.area || null;

/** "Needs you first": a mismatch, then not backed, then a changed or stale record, then the rest. */
export function needRank(c, itemsByUid = new Map()) {
  if (c.state === 'mismatch') return 0;
  if (c.state === 'not_backed') return 1;
  const best = itemsByUid.get(c?.record?.items?.[0]);
  if (best?.source_state === 'changed') return 2;
  if (best?.stale) return 3;
  return 4;
}

/** A count over a page: "100+" when the page has more, never a false total. */
export const countOf = (n, more) => (n == null ? null : more ? `${n}+` : String(n));

const ok = (block) => block && block.state === 'recorded';

/** Everything the view draws, from one read. */
export function viewModel(read) {
  const items = ok(read?.items) ? read.items.rows : null;
  const proposals = ok(read?.proposals) ? read.proposals.rows : null;
  const claims = ok(read?.claims) ? read.claims.rows : null;
  const groups = ok(read?.coverage) ? read.coverage.groups : null;
  const byUid = new Map((items || []).map((i) => [i.uid, i]));
  const tally = (pred) => (claims ? claims.filter(pred).length : null);
  const more = !!read?.claims?.has_more;
  const pinned = groups ? groups.filter((g) => g.state === 'pinned') : null;
  const sum = (rows, pred) => (rows ? rows.filter(pred).reduce((a, g) => a + (Number(g.count) || 0), 0) : null);
  return {
    items, proposals, claims, groups, byUid,
    canDecide: !!read?.permissions?.can_decide,
    tiles: {
      backed: tally((c) => c.state === 'backed'), total: claims ? claims.length : null,
      founders: tally((c) => c.state === 'founders_figure'),
      mismatch: tally((c) => c.state === 'mismatch'), notBacked: tally((c) => c.state === 'not_backed'),
      waiting: proposals ? proposals.length : null, waitingMore: !!read?.proposals?.has_more,
      newestWaiting: proposals ? proposals.map((p) => p.observed_on).filter(Boolean).sort().at(-1) ?? null : null,
      afterNda: sum(pinned, (g) => g.visibility === 'after_nda'), summary: sum(pinned, (g) => g.visibility === 'summary'),
      opens: read?.opens?.state === 'recorded' ? read.opens.count : null, openers: read?.opens?.state === 'recorded' ? read.opens.investors : null,
      more,
    },
    empty: !!(items && proposals && claims && !items.length && !proposals.length && !claims.length),
    unreadableSources: (read?.live_sources || []).filter((b) => b.state === 'unreadable').map((b) => datasetName(b.dataset)),
  };
}

/** The claims card's filters (VR1: State, Source, Sharing, search) and its sort. */
export function filterClaims(claims, byUid, { state = '', source = '', sharing = '', q = '', sort = 'needs' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const rows = (claims || []).filter((c) => {
    const best = byUid.get(c?.record?.items?.[0]);
    if (state && c.state !== state) return false;
    if (source && c?.record?.source_label !== source) return false;
    if (sharing && best?.visibility !== sharing) return false;
    if (needle && !`${claimTitle(c)} ${claimWhere(c) || ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const sorted = rows.slice().sort(sort === 'checked'
    ? (a, b) => String(b.checked_at || '').localeCompare(String(a.checked_at || ''))
    : (a, b) => needRank(a, byUid) - needRank(b, byUid));
  return sorted;
}

/** Claims by area, in the canvas's order; an area with no claim surface is listed for its items only. */
export function claimsByArea(claims) {
  return AREAS.map((area) => ({ area, claims: (claims || []).filter((c) => claimArea(c) === area) })).filter((a) => a.claims.length);
}
export function itemsByArea(items) {
  return AREAS.map((area) => ({ area, items: (items || []).filter((i) => i.area === area && i.state === 'pinned') })).filter((a) => a.items.length);
}

/** Coverage by area and best source (VR1): pinned items only, each source a share of the area. */
export function coverageByArea(groups) {
  if (!groups) return null;
  return AREAS.map((area) => {
    const own = groups.filter((g) => g.area === area && g.state === 'pinned');
    const by = Object.fromEntries(SOURCES.map((s) => [s.key, own.filter((g) => g.source_label === s.key).reduce((a, g) => a + (Number(g.count) || 0), 0)]));
    return { area, total: Object.values(by).reduce((a, n) => a + n, 0), by };
  });
}

/** "What investors see" (VR1): before the NDA kinds and counts only; after it, values for After NDA, Summary without. */
export function investorsSee(groups) {
  if (!groups) return null;
  const shared = groups.filter((g) => g.state === 'pinned' && g.visibility !== 'private');
  const n = (pred) => shared.filter(pred).reduce((a, g) => a + (Number(g.count) || 0), 0);
  return { shared: n(() => true), withValues: n((g) => g.visibility === 'after_nda'), summary: n((g) => g.visibility === 'summary') };
}

/** VR4: Accept all from one source takes at most 50 per press, and only proposals the read says can be accepted now. */
export const ACCEPT_ALL_CAP = 50;
export function acceptAllPlan(proposals, { source = 'connector', provider = null } = {}) {
  const match = (proposals || []).filter((p) => p.source_label === source && (provider == null || p.provider === provider));
  const ready = match.filter((p) => p.can_accept && p.snapshot_hash);
  return { take: ready.slice(0, ACCEPT_ALL_CAP), left: ready.length - Math.min(ready.length, ACCEPT_ALL_CAP), notReady: match.length - ready.length };
}
/** The biggest group of acceptable proposals by source and provider: the canvas's "Accept all from Connector · Mercury". */
export function acceptAllOffer(proposals) {
  const groups = new Map();
  for (const p of proposals || []) {
    if (!p.can_accept || !p.snapshot_hash) continue;
    const k = JSON.stringify([p.source_label, p.provider ?? null]);
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  const best = [...groups.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const [source, provider] = JSON.parse(best[0]);
  return { source, provider, count: best[1], label: `Accept all from ${sourceWord(source)}${provider ? ` · ${providerWord(provider)}` : ''}` };
}
/** One outcome per proposal pressed, in words (VR4's list after Accept all). */
export function outcomeWord(result) {
  if (result?.ok) return 'Accepted';
  const code = result?.code;
  if (code === 'decided') return 'Already decided';
  if (code === 'changed') return 'The source changed. Look again before accepting it.';
  if (code === 'forbidden') return 'Only this venture’s founders can accept evidence.';
  return 'Not saved. Try again.';
}

/** A change to an item's sharing, in the words its dialog shows (every change opens one). */
export function sharingChange(item, visibility) {
  const to = sharingWord(visibility);
  if (!to || !item) return null;
  const said = {
    private: 'Nobody but this venture’s founders sees it.',
    summary: 'Investors see its kind, source and date, with no figure.',
    after_nda: 'Before an NDA investors see its kind, source and date; after it, its figure too.',
  }[visibility];
  const bank = item.private_reason === 'bank' && visibility !== 'private' ? ' It is shared as a figure only: balances, accounts and bank lines are never shown.' : '';
  const quote = item.private_reason === 'quote' && visibility !== 'private' ? ' A quote shows only while the person’s consent to be quoted stands.' : '';
  return { title: `Share as ${to}?`, says: `${itemTitle(item)} becomes ${to}. ${said}${bank}${quote}` };
}

export const STATE_KEYS = Object.freeze(Object.keys(CLAIM_STATE));
