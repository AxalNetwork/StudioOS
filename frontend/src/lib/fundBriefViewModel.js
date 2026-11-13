// Fund Brief One-Pager — view model.
//
// Port of the Claude Design export `Fund Brief OnePager.dc.html`, whose
// `renderVals()` carried its own private `F = { target: 20, committed: 6.8,
// lps: 31, graduates: 37, deployed: 1.9, reserveHeld: 2.7, followOns: 2, … }`
// object. That is correct for a design file and wrong for a document a fund
// actually hands to an LP: the same figures already live in the LP & Investor
// Workspace, so two copies would silently diverge the moment either moved, and
// every brief downloaded after that point would misstate the raise.
//
// So there is no `F` here. Every number is read from `spinoutFundModel.js` —
// the module the workspace itself renders from — or derived from it by
// `fundModel()`. Editing a fund fact in one place therefore updates the
// workspace and every brief downloaded afterwards, which is the whole contract
// of this file. `fund_brief_model.test.mjs` fails if a literal creeps back in.
//
// Pure and framework-free on purpose: it takes a clock and a recipient and
// returns data, so the document can be asserted in Node without a browser or a
// PDF engine.
import {
  fundModel, money, FUND, PROGRAM, THESIS, fundTerms, TIERS, COHORT_4,
  SERVICE_PROVIDERS, PROCESS_STEPS,
} from './spinoutFundModel.js'; // explicit extension: node --test imports this directly

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Aug 5, 2026`. Hand-formatted rather than toLocaleDateString so the string
 *  is identical under any ICU build, including a Node runtime without one. */
export function briefDate(d) {
  const date = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

const INK = '#18181b';
const VIOLET = '#6d28d9';
const MUTED = '#71717a';

const SCORE_TONE = (score) => (score >= 70 ? '#15803d' : score >= 55 ? '#b45309' : MUTED);
const IC_PILL = {
  Advance: { bg: '#dcfce7', fg: '#15803d' },
  Watch: { bg: '#fef3c7', fg: '#92400e' },
  Track: { bg: '#f4f4f5', fg: '#52525b' },
};

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
 * @returns {object} sections mirroring the design's `renderVals()`
 */
export function fundBriefModel({ generatedAt, recipient } = {}) {
  const M = fundModel();
  const pctRaised = Math.round((FUND.committed / FUND.target) * 100);

  const meta = {
    issuer: 'Axal VC',
    fundName: 'Axal VC Spin-Out Fund I',
    kicker: 'Fund brief · confidential',
    subtitle: `${FUND.stage} · Vintage ${FUND.vintage} · ${FUND.domicile}`,
    status: FUND.status,
    generated: `Generated ${briefDate(generatedAt)}`,
    preparedFor: recipientLine(recipient),
    headline: THESIS.headline,
    thesis: THESIS.brief,
  };

  const raise = [
    { k: 'Target / hard cap', v: `$${FUND.target}M / $${FUND.hardCap}M`, note: `${FUND.domicile} · ${FUND.termYears}-yr term`, tone: INK },
    { k: 'Committed', v: money.m(FUND.committed * 1000), note: `${pctRaised}% of target · ${FUND.lpCount} LPs`, tone: VIOLET },
    { k: 'Soft-circled', v: money.m(FUND.softCircled * 1000), note: 'Indications, not commitments', tone: INK },
    { k: 'Capacity remaining', v: `$${M.capacityRemainingM}M`, note: `Median ticket ${money.k(FUND.medianTicketK)}`, tone: INK },
    { k: 'First close', v: FUND.firstClose, note: `$${FUND.minCloseM}M minimum · rolling after`, tone: INK },
  ];

  // Twelve rows; Target/hard cap is excluded upstream because the raise strip
  // above already states it.
  const terms = fundTerms().filter((t) => t.brief).map(({ k, v }) => ({ k, v }));

  const tiers = TIERS.map((t) => ({ name: t.name, amount: t.amount, rights: t.rights, hl: !!t.hl }));

  // The workspace's own hero stats and underwriting KPIs, in the design's
  // six-tile grid. `deployed`, `reserve` and `followOns` were literals in the
  // export (1.9 / 2.7 / 2) and are derived from the position list here, so a
  // new position or follow-on moves them without anyone editing the brief.
  const record = [
    { k: 'Graduates to date', v: String(PROGRAM.graduates) },
    { k: 'Incorporated on time', v: `${PROGRAM.onTimeIncorpPct}%` },
    { k: 'Raised by alumni', v: money.m(PROGRAM.alumniRaisedM * 1000) },
    { k: 'Capital deployed', v: money.m(M.investedK) },
    { k: 'Reserve remaining', v: `$${M.reserveCloseM}M` },
    { k: 'Follow-ons completed', v: String(M.followOnCount) },
  ];

  const pipeline = COHORT_4.map((p) => ({
    company: p.company,
    sector: p.sector,
    score: String(p.score),
    scoreTone: SCORE_TONE(p.score),
    revenue: p.revenueK == null ? '—' : `$${p.revenueK}K`,
    ic: p.ic,
    icPill: IC_PILL[p.ic] || IC_PILL.Track,
  }));

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
    // The workspace states this about its fund-level figures; a document that
    // leaves the building has more need of it, not less.
    provenance: 'Fund-level figures are operator-maintained, not live telemetry.',
  };

  return {
    meta,
    raise,
    thesisBody: THESIS.body,
    terms,
    tiers,
    record,
    pipeline,
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
