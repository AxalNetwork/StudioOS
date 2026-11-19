// D6137 (#6137): the Spin-Out Fund's figures as the LP pages and the fund brief
// draw them, from one read of GET /api/spinout-lab/fund-metrics.
//
// The workspace, the investor page and the brief PDF used to take target,
// committed capital, the LP count, eleven positions, MOIC and the Cohort 4 list
// from `spinoutFundModel.js`, a port of a design file. Those are not fund facts
// (owner, Q1). Here every fund figure comes from the read, and a figure the read
// does not record is "Not recorded" (or "Unreadable" when the read failed).
//
// The read decides who sees what (owner, Q2): every reader's `fund` block has
// the target and the close status; only a committed LP's has `raise` and
// `portfolio`. So `lp` below is whether those keys are present, never a guess
// from the page's own state, and a visitor's figures have no LP field to draw.
//
// Pure, so the pages and `fundBriefViewModel.js` print the same strings and a
// test can check them in Node.
import { NOT_RECORDED } from './absence.js';
import { FUND_SCHEDULE, formatScheduleDate, schedulePassed } from './spinoutFundModel.js';

export { NOT_RECORDED };
export const UNREADABLE = 'Unreadable';
/** What a visitor's page says where an LP sees a figure. */
export const LP_ONLY = 'Shown to committed LPs';
/** The same, inside a sentence. */
export const LP_ONLY_PHRASE = 'shown to committed LPs';

/** Dollars as `$1.25M`, the workspace's format. */
export const usdM = (d) => `$${Number((d / 1e6).toFixed(2))}M`;
/** Dollars as `$150K`. */
export const usdK = (d) => `$${Math.round(d / 1000)}K`;

const num = (f) => (f && f.available && f.value != null && Number.isFinite(Number(f.value)) ? Number(f.value) : null);
const absent = (f) => (f && f.reason === 'read_failed' ? UNREADABLE : NOT_RECORDED);
const show = (f, fmt) => (num(f) != null ? fmt(num(f)) : absent(f));

/** `2026-09-15` → `Sep 15, 2026`; anything else is Not recorded. */
const asDate = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? formatScheduleDate(String(iso).slice(0, 10)) : NOT_RECORDED);

/**
 * The close status. The first close's date is owner-confirmed (Q3) and no store
 * records whether it happened, so a passed date reads "date passed; outcome not
 * recorded". The read carries it; a failed read falls back to the same date.
 */
function closeFigures(fund, today) {
  const close = fund && fund.close && typeof fund.close === 'object' ? fund.close : null;
  const date = close?.first_close_date || FUND_SCHEDULE.firstClose;
  const passed = close ? !!close.date_passed : schedulePassed(date, today);
  const recordedOutcome = close?.outcome_recorded && close.outcome ? String(close.outcome) : null;
  const label = recordedOutcome
    ? `${formatScheduleDate(date)} · ${recordedOutcome}`
    : passed ? `${formatScheduleDate(date)} (date passed; outcome not recorded)` : formatScheduleDate(date);
  const status = recordedOutcome
    ? `First close · ${recordedOutcome}`
    : passed ? 'First-close date passed · outcome not recorded' : 'First close scheduled';
  return { date, passed, label, status };
}

/**
 * Every fund figure the pages and the brief draw, as strings.
 *
 * @param {object|null} read  the GET /fund-metrics body, or null when it failed
 * @param {{ today?: string }} [opts]  a UTC `YYYY-MM-DD`, for tests
 */
export function fundFigures(read, { today } = {}) {
  const fund = read && read.fund && typeof read.fund === 'object' ? read.fund : null;
  const lp = !!fund && 'raise' in fund && 'portfolio' in fund;
  const target = num(fund?.target);

  const out = {
    readable: !!fund,
    lp,
    target: {
      recorded: target != null && target > 0,
      dollars: target,
      text: fund ? show(fund.target, usdM) : UNREADABLE,
    },
    close: closeFigures(fund, today),
    raise: null,
    portfolio: null,
  };
  if (!lp) return out;

  const r = fund.raise && fund.raise.available ? fund.raise : null;
  const committed = r ? Number(r.committed) : null;
  const rNote = fund.raise && fund.raise.reason === 'read_failed' ? UNREADABLE : NOT_RECORDED;
  const pctOfTarget = r && target ? Math.max(0, Math.min(100, Math.round((committed / target) * 100))) : null;
  out.raise = {
    recorded: !!r,
    committed: r ? usdM(committed) : rNote,
    softCircled: r ? usdM(Number(r.soft_circled) || 0) : rNote,
    lpCount: r ? String(Number(r.lp_count) || 0) : rNote,
    median: r && r.median_commitment != null ? usdK(Number(r.median_commitment)) : rNote,
    capacity: r && target ? usdM(Math.max(0, target - committed)) : rNote,
    pctOfTarget,
  };

  const p = fund.portfolio || {};
  const fo = p.follow_ons || {};
  out.portfolio = {
    recorded: !!p.available,
    positions: show(p.positions, (n) => String(n)),
    invested: show(p.invested, usdM),
    held: show(p.held, usdM),
    followOns: fo.available && fo.count != null ? String(fo.count) : absent(fo),
    followOnAmount: fo.available && fo.amount != null ? usdM(Number(fo.amount)) : absent(fo),
    reserve: show(p.reserve, usdM),
    moic: show(p.gross_moic, (n) => `${n.toFixed(2)}×`),
    asOf: p.as_of && p.as_of.available ? asDate(p.as_of.value) : absent(p.as_of),
  };
  return out;
}

/**
 * The three program figures the workspace hero, the investor page and the brief
 * all print, from the read's program block only (#5513, D5513-p2). There is no
 * fixed fallback: until the block answers `available`, each figure reads
 * "Not recorded" ("Unreadable" when the read itself failed), and so does any
 * single figure the block leaves null.
 *
 * `onTimePct` and `alumniRaisedM` are the numbers behind the strings, for a
 * page that formats them its own way.
 */
export function programFigures(read) {
  const live = read && read.program && read.program.available ? read.program : null;
  const missing = read ? NOT_RECORDED : UNREADABLE;
  const count = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const graduates = live ? count(live.graduates) : null;
  const onTimePct = live ? count(live.on_time_pct) : null;
  const alumniRaised = live ? count(live.alumni_raised) : null;
  return {
    live: !!live,
    graduates: graduates != null ? String(graduates) : missing,
    onTime: onTimePct != null ? `${onTimePct}%` : missing,
    alumni: alumniRaised != null ? usdM(alumniRaised) : missing,
    onTimePct,
    alumniRaisedM: alumniRaised != null ? alumniRaised / 1e6 : null,
  };
}
