/**
 * D8770 (#8770, canvas PTP10) — the template preview's example store: one
 * clearly fictional company, [Larder Lane], drawn over any template's cards
 * in the preview's Example view (owner Q2, option A: one shared company on
 * all 24 templates, keyed by card and layout, not by template).
 *
 * KEPT APART FROM THE STRUCTURE. Nothing here is written into a template's
 * `structure_json`, and nothing reads it but the preview
 * (`templatePreviewModel.previewSlides`). Use this template posts only the
 * template's uid and the venture (`deckTemplatesApi.applyTemplate`), so the
 * Worker builds the proposal from the stored blank structure; Save as my
 * template strips a saved version on the Worker. An example figure therefore
 * cannot reach a live venture draft, and `template_preview_8770.test.mjs`
 * holds both ends of that.
 *
 * Every figure, name and quote is invented. The slide names the company
 * plainly ("Larder Lane"); app text brackets it ("[Larder Lane]"). Each slide
 * carries "Example · fictional figures" and a source line that says
 * "sample, fictional".
 */

export const EXAMPLE_COMPANY = 'Larder Lane';
/** How app text (not the slide) names the example company. */
export const EXAMPLE_NAME = `[${EXAMPLE_COMPANY}]`;
export const EXAMPLE_BADGE = 'Example · fictional figures';
export const EXAMPLE_AS_OF = '30 Nov 2026';
export const EXAMPLE_NOTE = `Example · ${EXAMPLE_NAME} is fictional. These words and figures never enter your deck.`;

const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const series = (label, unit, ys) => ({ label, unit, points: ys.map((y, i) => ({ x: MONTHS[MONTHS.length - ys.length + i], y })) });

const MRR = series('MRR', 'usd', [4200, 5100, 6000, 7400, 8900, 10600]);
const SHOPS = series('Paying shops', 'count', [38, 44, 51, 60, 71, 83]);
const REVENUE = series('Revenue', 'usd', [4100, 5000, 6100, 7300, 8800, 10500]);
const BURN = series('Net burn', 'usd', [41000, 40500, 40000, 39200, 38600, 38000]);

const COMPARISON = {
  head: ['', 'Larder Lane', 'Spreadsheet', 'Chain POS suite'],
  rows: [
    ['Counts stock from the till', 'Yes', 'No', 'Yes'],
    ['Flags what expires this week', 'Yes', 'Partial · by hand', 'No'],
    ['Price for one shop', '$129 a month', 'Free', '$900 a month'],
    ['Set up in a day', 'Yes', 'Yes', 'No'],
  ],
};
/** Use of funds, in US$ thousands: 540 + 360 + 180 + 120 = 1,200. */
const FUNDS = [['Engineering', 540], ['Sales', 360], ['Onboarding', 180], ['Operations', 120]];
const ROADMAP = [['Q1 2027', 'Reorder drafts ship'], ['Q3 2027', '300 paying shops'], ['2028', '1,000 shops in three regions']];

const text = (t) => ({ text: t });
/** A tile's figure and its own label, so no bracketed label sits over an example figure. */
const metric = (value, label) => ({ value, label });
const SCREEN = { image: 'screen', alt: 'Larder Lane’s expiry list on a shop tablet (example screen)' };
const SCENE = { image: 'scene', alt: 'A shop shelf with date labels (example illustration)' };
const PHOTO = { image: null };

const TRACTION_TAKE = 'MRR grew 2.5× in five months';
const SOLUTION_TAKE = 'Nothing on the shelf expires unseen';
const PRODUCT_TAKE = 'What expires this week, on one screen';
const MARKET_TAKE = 'The only stock tool built for small shops';
const FUNDS_TAKE = '$1.2M buys 22 months and 300 shops';
const COPE_TAKE = 'Today: a spreadsheet, or a chain’s software';
const TEAM_TAKE = 'Two shopkeepers and a till engineer';

/**
 * `card·layout` → the areas it fills (by the layout's area ids, H3), the
 * source its figures come from and, for Read this slide, its data.
 */
export const EXAMPLES = Object.freeze({
  'title·title': { areas: { T: text(EXAMPLE_COMPANY), S: text('Stock software for independent food shops') } },
  'problem·statement': { source: 'Larder Lane interview log', areas: { S: text('Independent food shops throw away 1 in 12 items they stock') } },
  'problem·quote': { source: 'Larder Lane interview log', areas: { Q: text('“I lose a shelf a week to stock I didn’t see expiring.”'), A: text('Owner of a two-shop deli · interview 14 of 40') } },
  'why_now·statement': { areas: { S: text('Card terminals now log every sale, so stock can be counted without a clipboard') } },
  'solution·image_text': { areas: { I: SCENE, H: text(SOLUTION_TAKE), P: text('Each sale updates the count. Each morning the owner gets the list of what to discount, and decides.') } },
  'solution·two_columns': { areas: { H: text(SOLUTION_TAKE), L: text('Each sale updates the count, so the shelf and the screen agree.'), R: text('A morning list of what to discount\nReorders drafted, never sent unseen') } },
  'solution·statement': { areas: { S: text(SOLUTION_TAKE) } },
  'traction·chart_text': {
    source: 'Larder Lane billing export',
    areas: { H: text(TRACTION_TAKE), C: { series: [MRR, SHOPS] }, L: text('Wholesaler referrals brought 3 in 5 new shops\nChurn stayed under 2% a month\nNo paid marketing yet') },
  },
  'traction·metric_tiles': {
    source: 'Larder Lane billing export',
    areas: { H: text(TRACTION_TAKE), M1: metric('$10.6k', 'MRR'), M2: metric('83', 'Paying shops'), M3: metric('+20% a month', 'Revenue growth'), M4: metric('$127k', 'ARR'), P: text('Wholesaler referrals brought 3 in 5 new shops.') },
  },
  'traction·statement': { source: 'Larder Lane billing export', areas: { S: text('MRR grew 2.5× in five months, to $10.6k from 83 paying shops') } },
  'validation·metric_tiles': {
    source: 'Larder Lane interview log',
    areas: { H: text('Owners asked for this before we built it'), M1: metric('40', 'Interviews'), M2: metric('23', 'Strong-fit shops'), M3: metric('9', 'Letters of intent'), M4: metric('5 of 6', 'Claims validated'), P: text('Expiry, not theft, was the loss owners named most.') },
  },
  'validation·chart_text': {
    source: 'Larder Lane interview log',
    areas: {
      H: text('Owners asked for this before we built it'),
      C: { series: [series('Interviews', 'count', [40]), series('Strong-fit shops', 'count', [23]), series('Letters of intent', 'count', [9])] },
      L: text('Expiry was the loss named most\n9 shops signed letters of intent'),
    },
  },
  'product·image_text': { source: 'Larder Lane product', areas: { I: SCREEN, H: text(PRODUCT_TAKE), P: text('A new shop connects its till first; the count starts that day.') } },
  'product·two_columns': { areas: { H: text(PRODUCT_TAKE), L: text('Shipped: till sync, the expiry list and discount labels.'), R: text('Reorder drafts\nWholesaler price checks\nA view across shops') } },
  'product·metric_tiles': { source: 'Larder Lane release log', areas: { H: text(PRODUCT_TAKE), M1: metric('7 of 9', 'Must-haves shipped'), M2: metric('12', 'Releases, 90 days'), M3: metric('410', 'Commits, 90 days'), M4: text('Connect the till; the count starts that day.'), P: text('Next: reorder drafts in January.') } },
  'market·comparison_table': { source: 'Larder Lane pricing research', areas: { H: text(MARKET_TAKE), C: { table: COMPARISON } } },
  'market·statement': { source: 'Larder Lane market sizing', areas: { S: text('41,000 independent food shops, and none of their tools track expiry') } },
  'competition·comparison_table': { source: 'Larder Lane pricing research', areas: { H: text(COPE_TAKE), C: { table: COMPARISON } } },
  'competition·two_columns': {
    areas: {
      H: text(COPE_TAKE),
      L: text('A weekly hand count costs an owner about 4 hours.'),
      R: { diagram: ['Hand count', '4 hours a week', 'Counted at the till'] },
    },
  },
  'unit_economics·metric_tiles': { source: 'Larder Lane accounts', areas: { H: text('A new shop pays back in 3 months'), M1: metric('$38k a month', 'Net burn'), M2: metric('14 months', 'Runway'), M3: metric('1.8% a month', 'Churn'), M4: metric('$10.5k a month', 'Revenue'), P: text('Onboarding by wholesalers halves the cost of a new shop.') } },
  'unit_economics·chart_text': { source: 'Larder Lane accounts', areas: { H: text('Revenue grows while burn falls'), C: { series: [REVENUE, BURN] }, L: text('Burn fell 7% in five months\nRevenue grew 2.5×') } },
  'team·team_grid': {
    areas: {
      H: text(TEAM_TAKE),
      I1: PHOTO, I2: PHOTO, I3: PHOTO, I4: PHOTO,
      N1: text('Ada Mensah, CEO · ran a deli for six years'), N2: text('Tom Reyes, CTO · built till software'),
      N3: text('Priya Shah, Operations · onboarded 200 shops'), N4: text('[Open role], Sales'),
    },
  },
  'team·two_columns': { areas: { H: text(TEAM_TAKE), L: text('Ada ran a deli for six years; Tom built till software used in 2,000 shops.'), R: text('Shop operations\nTill integrations\nWholesaler relationships') } },
  'roadmap·timeline': { source: 'Larder Lane plan', areas: { H: text('Three steps to 1,000 shops by 2028'), C: { milestones: ROADMAP }, P: text('300 paying shops proves wholesalers refer at scale.') } },
  'round·metric_tiles': { source: 'Larder Lane round plan', areas: { H: text('Raising $1.2M to reach 300 paying shops'), M1: metric('$1.2M', 'Round target'), M2: metric('SAFE', 'Instrument'), M3: metric('Feb 2027', 'Target close'), M4: metric('22 months', 'Runway'), P: text('This round proves wholesaler referral works at 300 shops.') } },
  'round·statement': { source: 'Larder Lane round plan', areas: { S: text('Raising $1.2M on a SAFE to reach 300 paying shops by Q3 2027') } },
  'use_of_funds·timeline': { source: 'Larder Lane round plan', areas: { H: text(FUNDS_TAKE), C: { shares: FUNDS }, P: text('The milestone: 300 paying shops by Q3 2027.') } },
  'use_of_funds·two_columns': { source: 'Larder Lane round plan', areas: { H: text(FUNDS_TAKE), L: text('Engineering $540k\nSales $360k\nOnboarding $180k\nOperations $120k'), R: text('The milestone: 300 paying shops by Q3 2027.') } },
  'use_of_funds·statement': { source: 'Larder Lane round plan', areas: { S: text(FUNDS_TAKE) } },
  'cap_table·metric_tiles': { source: 'Larder Lane cap table', areas: { H: text('Founders hold 82% before the round'), M1: metric('82%', 'Founders hold'), M2: metric('4 years, 1-year cliff', 'Vesting'), M3: metric('3', 'Founders'), M4: text('An option pool of 10% after the round.'), P: text('After the round, founders hold about 68%.') } },
  'cap_table·statement': { source: 'Larder Lane cap table', areas: { S: text('Founders hold 82% before the round') } },
  'every_figure·appendix_table': { source: 'Larder Lane records', areas: { H: text('Every figure, and where it comes from'), L: text('MRR $10.6k · billing export · Nov 2026\nPaying shops 83 · billing export · Nov 2026\nInterviews 40 · interview log · Oct 2026') } },
});

/**
 * The catalogue card a stored card is. `GET /decks/templates/:uid` passes the
 * cards through `sanitizeSlides`, which keeps the title and layout but not
 * the `card` key, so the title (`templateLibrary.titleOf`) names it there.
 */
export const CARD_BY_TITLE = Object.freeze({
  Title: 'title', Problem: 'problem', Team: 'team', Solution: 'solution', 'Why now': 'why_now', Validation: 'validation', Product: 'product',
  Market: 'market', Competition: 'competition', Roadmap: 'roadmap', 'The round': 'round', 'Use of funds': 'use_of_funds', Traction: 'traction',
  'Unit economics': 'unit_economics', 'Appendix · Every figure': 'every_figure', 'Cap table': 'cap_table',
});
export const cardKeyOf = (slide) => (typeof slide?.card === 'string' && slide.card) || CARD_BY_TITLE[String(slide?.title ?? '').trim()] || null;

export const exampleFor = (card, layout) => EXAMPLES[`${card}·${layout}`] || null;

/** The example's use of funds and roadmap, for Read this slide and the tests. */
export const EXAMPLE_FUNDS = FUNDS;
