/**
 * D898 §8.6 (#3658) — the reference decks for design review: one complete
 * twelve-card deck and its sparse variant, for a SYNTHETIC venture. Every name,
 * figure and date here is made up and labelled so; none is a real venture's
 * evidence, a real customer, a logo or a testimonial.
 *
 * Each card is composed the way the design system says a composer should:
 * the layout its evidence earns (`chooseLayout`), blocks on the layout's
 * ranges, figures as bound metric blocks or bound chart series (never typed
 * into words), and a "Not recorded" value where the record is missing. The
 * sparse deck is the same venture with most records missing, so its cards
 * fall back as `LAYOUT_NEEDS` says.
 *
 * `scripts/pitch-reference-preview.mjs` draws both decks in the three themes
 * at 16:9 and as the phone editor's card list, for the owner's review.
 */
import { chooseLayout, type Evidence } from '../../src/services/decks/designSystem.ts';

export const SYNTHETIC_VENTURE = 'Fernhill Ledger (synthetic)';
const AS_OF = '2026-10-01';
const HASH = 'a1b2c3d4e5f60718293a4b5c';

const bound = (source_key: string, grade = 'Measured') => ({ source_key, record_ref: `fixture:${source_key}`, as_of: AS_OF, grade, snapshot_hash: HASH });
const missing = (source_key: string) => ({ source_key, record_ref: null, as_of: null, grade: 'Not recorded', snapshot_hash: null });
const g = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });
const heading = (text: string, grid = g(1, 12, 1, 1)) => ({ id: 'h', kind: 'text', grid, style: 'heading', text });
const para = (id: string, text: string, grid: any) => ({ id, kind: 'text', grid, style: 'paragraph', text });
const list = (id: string, text: string, grid: any) => ({ id, kind: 'text', grid, style: 'list', text });
const metric = (id: string, label: string, value: string | null, key: string, grid: any) =>
  ({ id, kind: 'metric', grid, label, value, binding: value == null ? missing(key) : bound(key) });

/** The layout a card's evidence earns, so the fixture is held to the same rule as the composer. */
function card(role: string, evidence: Partial<Evidence> & { quotes?: number }, title: string, blocks: any[], notes?: string) {
  const { layout } = chooseLayout(role, evidence);
  return { title, spec_id: `ref:${role}`, role, layout, blocks, fields: [], ...(notes ? { notes } : {}) };
}

const MRR = [['2026-03', 4100], ['2026-04', 5200], ['2026-05', 6900], ['2026-06', 8300], ['2026-07', 10400], ['2026-08', 12900], ['2026-09', 15100]] as const;

/** The complete deck: every record present, twelve cards, varied layouts. */
export function fullReferenceDeck() {
  return [
    card('title', {}, 'Title', [
      { id: 'h', kind: 'text', grid: g(1, 12, 2, 3), style: 'heading', text: 'Month-end close in a day, not a fortnight' },
      para('p', `${SYNTHETIC_VENTURE} · Seed round · synthetic reference deck`, g(1, 12, 4, 4)),
    ]),
    card('problem', { quotes: 1, metrics: 2 }, 'Problem', [
      { id: 'h', kind: 'text', grid: g(2, 11, 2, 4), style: 'heading', text: '“We close the books by copying rows between six spreadsheets.”' },
      para('p', 'Finance lead at a synthetic interviewee, from a recorded interview. The top pain theme across the interviews.', g(2, 11, 5, 5)),
    ]),
    card('solution', { images: 1 }, 'Solution', [
      { id: 'i', kind: 'image', grid: g(1, 6, 1, 6), image_url: null, alt: 'Illustration: ledgers flowing into one reconciled book', tag: 'illustration' },
      heading('One ledger that reconciles itself', g(7, 12, 1, 2)),
      para('p', 'Bank feeds, invoices and payroll land in one book. Matches are proposed, a person approves them, and the close report writes itself.', g(7, 12, 3, 6)),
    ]),
    card('product', { metrics: 3, images: 0 }, 'Product', [
      heading('Shipped, and shipping weekly'),
      metric('m1', 'Must-haves done', '9 of 12', 'build.must_haves', g(1, 4, 2, 4)),
      metric('m2', 'Releases in 90 days', '14', 'build.releases_90d', g(5, 8, 2, 4)),
      metric('m3', 'Commits in 90 days', '412', 'build.commits_90d', g(9, 12, 2, 4)),
      para('p', 'The three must-haves left are on the roadmap card, each with its date.', g(1, 12, 5, 6)),
    ]),
    card('traction', { series: 1, metrics: 2 }, 'Traction', [
      heading('Revenue has grown every month since launch'),
      { id: 'c', kind: 'chart', grid: g(1, 8, 2, 6), chart_type: 'line', range: 'all', previous: false, labels: true,
        series: [{ label: 'MRR (synthetic)', binding: bound('grow.mrr'), points: MRR.map(([x, y]) => ({ x, y })) }] },
      list('l', 'Stripe-connected MRR, monthly\nPaying customers: 38\nNet revenue churn under target', g(9, 12, 2, 6)),
    ]),
    card('market', { rows: 4 }, 'Market', [
      heading('Tracked against three named competitors'),
      { id: 't', kind: 'chart', grid: g(1, 12, 2, 5), chart_type: 'comparison_table', range: 'all', previous: false, labels: true,
        series: [{ label: 'Competitors tracked', binding: bound('validate.competitors'), points: [{ x: 'Ledgerly', y: 1 }, { x: 'CloseKit', y: 1 }, { x: 'Spreadsheets and email', y: 1 }] }] },
      para('p', 'Names as recorded in Validate › Competitors. How each compares is the founder’s to write, on the card.', g(1, 12, 6, 6)),
    ]),
    card('business_model', {}, 'Business model', [
      heading('Priced per entity, billed monthly'),
      para('a', 'Teams pay for each entity they close, so revenue grows with the customer’s own structure.', g(1, 6, 2, 6)),
      para('b', 'Onboarding is self-serve; the close report is the moment a team decides to stay.', g(7, 12, 2, 6)),
    ]),
    card('team', { people: 3, images: 3 }, 'Team', [
      heading('Three founders who have closed the books before'),
      { id: 'i1', kind: 'image', grid: g(1, 4, 2, 4), image_url: null, alt: 'A. Rivera, photo shared with consent (synthetic)', tag: 'photo' },
      { id: 'i2', kind: 'image', grid: g(5, 8, 2, 4), image_url: null, alt: 'B. Okafor, photo shared with consent (synthetic)', tag: 'photo' },
      { id: 'i3', kind: 'image', grid: g(9, 12, 2, 4), image_url: null, alt: 'C. Lindqvist, photo shared with consent (synthetic)', tag: 'photo' },
      para('t1', 'A. Rivera · CEO · ran finance ops', g(1, 4, 5, 6)),
      para('t2', 'B. Okafor · CTO · built payments infra', g(5, 8, 5, 6)),
      para('t3', 'C. Lindqvist · Product · accountant turned PM', g(9, 12, 5, 6)),
    ]),
    card('roadmap', { steps: 4 }, 'Roadmap', [
      heading('The next four objectives'),
      { id: 'd', kind: 'graphic', grid: g(1, 12, 2, 5), graphic: 'timeline', ratio: '2x2',
        diagram: { v: 1, type: 'timeline', items: [
          { label: 'Multi-entity close', date: '2026-11', binding: bound('build.roadmap') },
          { label: 'Auditor workspace', date: '2027-01', binding: bound('build.roadmap') },
          { label: 'Payroll feeds', date: '2027-03', binding: bound('build.roadmap') },
          { label: 'Self-serve onboarding', date: '2027-05', binding: bound('build.roadmap') },
        ] } },
      para('p', 'Each objective is a Build roadmap record with its target month.', g(1, 12, 6, 6)),
    ]),
    card('round', { metrics: 3 }, 'The round', [
      heading('Raising a seed round to reach multi-entity'),
      metric('m1', 'Round', '$1,500,000', 'raise.round_target', g(1, 4, 2, 4)),
      metric('m2', 'Instrument', 'SAFE', 'raise.round_terms', g(5, 8, 2, 4)),
      metric('m3', 'Close', '15 Jan 2027', 'raise.round_close', g(9, 12, 2, 4)),
      para('p', 'Terms as recorded in Raise. The use of funds follows.', g(1, 12, 5, 6)),
    ]),
    card('use_of_funds', { steps: 3 }, 'Use of funds', [
      heading('Where the round goes'),
      { id: 'd', kind: 'graphic', grid: g(1, 12, 2, 5), graphic: 'flow', ratio: '2x2',
        diagram: { v: 1, type: 'flow', items: [
          { label: 'Engineering', detail: 'Multi-entity close and auditor workspace' },
          { label: 'Go to market', detail: 'Two finance-ops sellers' },
          { label: 'Operations', detail: 'Security review and SOC 2 groundwork' },
        ] } },
      para('p', 'From the use of funds recorded in Raise; amounts sit on the round card.', g(1, 12, 6, 6)),
    ]),
    card('every_figure', {}, 'Appendix · Every figure', [
      heading('Every figure, with its source'),
      metric('m1', 'MRR', '$15,100', 'grow.mrr', g(1, 3, 2, 3)),
      metric('m2', 'Paying customers', '38', 'grow.paying_customers', g(4, 6, 2, 3)),
      metric('m3', 'Interviews', '46', 'validate.interviews', g(7, 9, 2, 3)),
      metric('m4', 'Must-haves done', '9 of 12', 'build.must_haves', g(10, 12, 2, 3)),
      metric('m5', 'Releases in 90 days', '14', 'build.releases_90d', g(1, 3, 4, 5)),
      metric('m6', 'Commits in 90 days', '412', 'build.commits_90d', g(4, 6, 4, 5)),
      metric('m7', 'Round', '$1,500,000', 'raise.round_target', g(7, 9, 4, 5)),
      metric('m8', 'Instrument', 'SAFE', 'raise.round_terms', g(10, 12, 4, 5)),
    ]),
  ];
}

/**
 * The same venture with most records missing. Traction has no series and one
 * figure, the team has no photos, the roadmap no dated objectives: each card
 * falls back as its layout's needs say, and every missing figure reads
 * "Not recorded", never 0.
 */
export function sparseReferenceDeck() {
  return [
    card('title', {}, 'Title', [
      { id: 'h', kind: 'text', grid: g(1, 12, 2, 3), style: 'heading', text: 'Month-end close in a day, not a fortnight' },
      para('p', `${SYNTHETIC_VENTURE} · Pre-seed · sparse reference deck`, g(1, 12, 4, 4)),
    ]),
    card('problem', {}, 'Problem', [
      { id: 'h', kind: 'text', grid: g(2, 11, 2, 4), style: 'heading', text: 'Finance teams close the books by hand' },
      para('p', 'No interviews are recorded yet. Record them in Validate and this card quotes the top pain.', g(2, 11, 5, 5)),
    ]),
    card('solution', {}, 'Solution', [
      heading('One ledger that reconciles itself'),
      para('a', 'Bank feeds, invoices and payroll land in one book.', g(1, 6, 2, 6)),
      para('b', 'Matches are proposed and a person approves them.', g(7, 12, 2, 6)),
    ]),
    card('traction', { metrics: 1 }, 'Traction', [
      { id: 'h', kind: 'text', grid: g(2, 11, 1, 4), style: 'heading', text: 'Early pilots, revenue not yet recorded' },
      metric('m1', 'MRR', null, 'grow.mrr', g(2, 5, 5, 6)),
      metric('m2', 'Paying customers', '3', 'grow.paying_customers', g(6, 9, 5, 6)),
    ]),
    card('team', { people: 2, images: 0 }, 'Team', [
      heading('Two founders'),
      para('a', 'A. Rivera · CEO · ran finance ops', g(1, 6, 2, 6)),
      para('b', 'B. Okafor · CTO · built payments infra', g(7, 12, 2, 6)),
    ]),
    card('roadmap', { steps: 1 }, 'Roadmap', [
      heading('What comes next'),
      para('a', 'Multi-entity close is the one objective recorded so far.', g(1, 6, 2, 6)),
      para('b', 'Add objectives with target months in Build and this becomes a timeline.', g(7, 12, 2, 6)),
    ]),
    card('round', { metrics: 1 }, 'The round', [
      { id: 'h', kind: 'text', grid: g(2, 11, 1, 4), style: 'heading', text: 'Raising a pre-seed round' },
      metric('m1', 'Round', null, 'raise.round_target', g(2, 4, 5, 6)),
      metric('m2', 'Instrument', 'SAFE', 'raise.round_terms', g(5, 7, 5, 6)),
      metric('m3', 'Close', null, 'raise.round_close', g(8, 11, 5, 6)),
    ]),
  ];
}
