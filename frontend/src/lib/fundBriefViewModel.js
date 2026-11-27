// Fund Brief One-Pager — view model.
//
// Port of the Claude Design export `Fund Brief OnePager.dc.html`, whose
// `renderVals()` carried its own private `F = { target: 20, committed: 6.8,
// lps: 31, graduates: 37, deployed: 1.9, reserveHeld: 2.7, followOns: 2, … }`
// object. A document a fund hands to an LP must not carry its own copy.
//
// D6137 (#6137): the brief prints the same figures as the page it is downloaded
// from. Every fund figure (the target and the close status, and for a committed
// LP the raise and the portfolio) comes from the viewer's own read of
// GET /api/spinout-lab/fund-metrics through `fundFigures()` in
// spinoutFundFigures.js, which the workspace and the investor page also draw
// from. A figure with no record prints "Not recorded"; a visitor's read has no
// LP field, so a visitor's brief prints none. No store records the Cohort 4
// list, so the pipeline prints "Not recorded" until one does. Terms, tiers,
// thesis and providers still come from `spinoutFundModel.js`.
//
// Pure and framework-free on purpose: it takes a clock, a recipient and the
// read and returns data, so the document can be asserted in Node without a
// browser or a PDF engine.
import {
  FUND, THESIS, fundTerms, TIERS, SERVICE_PROVIDERS, PROCESS_STEPS,
} from './spinoutFundModel.js'; // explicit extension: node --test imports this directly
import { fundFigures, programFigures, LP_ONLY_PHRASE } from './spinoutFundFigures.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Aug 5, 2026`. Hand-formatted rather than toLocaleDateString so the string
 *  is identical under any ICU build, including a Node runtime without one. */
export function briefDate(d) {
  const date = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

const INK = '#18181b';
const VIOLET = '#6d28d9';

/** The one line naming who a download was prepared for, or null when unknown. */
function recipientLine(recipient) {
  if (!recipient) return null;
  const who = (recipient.name || recipient.email || '').trim();
  if (!who) return null;
  return recipient.standing ? `Prepared for ${who} · ${recipient.standing}` : `Prepared for ${who}`;
}

/**
 * Build the whole document.
 *
 * @param {object}  [opts]
 * @param {Date}    [opts.generatedAt]  stamped on the masthead; defaults to now
 * @param {object}  [opts.recipient]    { name, email, standing } — the viewer the
 *                                      download was produced for. Optional: the
 *                                      brief is complete without it.
 * @param {object|null} [opts.metrics]  the viewer's GET /fund-metrics body, the
 *                                      one the page drew. Null (not read, or the
 *                                      read failed) prints Unreadable figures.
 * @param {string}  [opts.today]        UTC `YYYY-MM-DD`, for tests
 * @returns {object} sections mirroring the design's `renderVals()`
 */
export function fundBriefModel({ generatedAt, recipient, metrics = null, today } = {}) {
  const F = fundFigures(metrics, { today });
  const P = programFigures(metrics);

  const meta = {
    issuer: 'Axal VC',
    fundName: 'Axal VC Spin-Out Fund I',
    kicker: 'Fund brief · confidential',
    subtitle: `${FUND.stage} · Vintage ${FUND.vintage} · ${FUND.domicile}`,
    status: F.close.status,
    generated: `Generated ${briefDate(generatedAt)}`,
    preparedFor: recipientLine(recipient),
    headline: THESIS.headline,
    thesis: THESIS.brief,
  };

  // The headline every reader sees: the target and the close status. A
  // committed LP's read adds the raise, in the page's own words.
  const targetCell = { k: 'Target', v: F.target.text, note: `${FUND.domicile} · ${FUND.termYears}-yr term`, tone: INK };
  const closeCell = {
    k: 'First close',
    v: F.close.label.replace(/ \(.*$/, ''),
    note: F.close.passed ? 'Date passed; outcome not recorded' : 'Scheduled',
    tone: INK,
  };
  const raise = F.raise
    ? [
      targetCell,
      {
        k: 'Committed',
        v: F.raise.committed,
        note: `${F.raise.pctOfTarget != null ? `${F.raise.pctOfTarget}% of target · ` : ''}${F.raise.lpCount} LPs`,
        tone: VIOLET,
      },
      { k: 'Soft-circled', v: F.raise.softCircled, note: 'Indications, not commitments', tone: INK },
      { k: 'Capacity remaining', v: F.raise.capacity, note: `Median ticket ${F.raise.median}`, tone: INK },
      closeCell,
    ]
    : [targetCell, closeCell];

  // Twelve rows; the target is page-only in the term list because the raise
  // strip above already states it.
  const terms = fundTerms().filter((t) => t.brief).map(({ k, v }) => ({ k, v }));

  const tiers = TIERS.map((t) => ({ name: t.name, amount: t.amount, rights: t.rights, hl: !!t.hl }));

  // The workspace's hero stats, and for a committed LP its underwriting KPIs.
  const record = [
    { k: 'Graduates to date', v: P.graduates },
    { k: 'Incorporated on time', v: P.onTime },
    { k: 'Raised by alumni', v: P.alumni },
    ...(F.portfolio
      ? [
        { k: 'Capital deployed', v: F.portfolio.invested },
        { k: 'Reserve remaining', v: F.portfolio.reserve },
        { k: 'Follow-ons completed', v: F.portfolio.followOns },
      ]
      : []),
  ];

  const providers = SERVICE_PROVIDERS.map(({ k, v }) => ({ k, v }));

  const steps = PROCESS_STEPS.map(([n, label]) => ({ n, label }));

  const footer = {
    legal:
      'Confidential — prepared for curated investors only. Indicative and qualified in its '
      + "entirety by the fund's legal documents. Participation is limited to accredited investors "
      + 'under Rule 501 of Regulation D; KYC/AML verification is required before any capital '
      + 'transfer. Nothing herein is an offer to sell securities; any offering is made solely '
      + "through the fund's subscription documents and private placement memorandum.",
    gpName: 'Guillaume Lauzier · General Partner',
    gpContact: 'guillaume.lauzier@axal.vc · Responds within one business day',
    // A document that leaves the building says where its figures came from.
    provenance: F.portfolio
      ? "Fund figures come from the fund's records; a figure with no record reads Not recorded."
      : `Fund figures come from the fund's records. Committed capital, positions and marks are ${LP_ONLY_PHRASE}.`,
  };

  return {
    meta,
    raise,
    thesisBody: THESIS.body,
    terms,
    tiers,
    record,
    // No store records the Cohort 4 pipeline (D6137), so the brief names no company.
    pipeline: [],
    pipelineEmpty: 'Not recorded — no store holds a Cohort 4 pipeline yet.',
    pipelineHeading: 'Current pipeline · Cohort 4',
    pipelineNote: `Demo day ${FUND.demoDay}`,
    providers,
    steps,
    footer,
  };
}

/** Filename for a download, e.g. `axal-vc-spin-out-fund-i-brief-2026-08-05.pdf`. */
export function fundBriefFilename(generatedAt) {
  const d = generatedAt instanceof Date && !Number.isNaN(generatedAt.getTime()) ? generatedAt : new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `axal-vc-spin-out-fund-i-brief-${iso}.pdf`;
}
