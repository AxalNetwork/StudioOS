/**
 * D6888 (#6888): the material for Eadwyn's covering-note proposal on the shareable statement (D6217 PF-13a, PF-13h),
 * built only from the figures the statement prints for the chosen quarter-end.
 *
 * The statement's page 1 (summary, mark coverage, positions at cost) is `GET /api/positions/analytics?as_of=` for the
 * date, and its page 2 (the positions, with the rows marked "Funded after") is `GET /api/positions?as_of=`. The draft
 * route reads those two answers in-process with the caller's own headers (`routes/research.ts`), so this file never
 * computes a figure: it formats the two reads the way the sheet formats them (`pages/portfolio/portfolioModel.js`'s
 * `money`, `multiple`, `rate` and `day`) and names which page each line is on. A read that failed, or a date that
 * holds no book, is [] here, and the route answers `nothing_to_draft` before any model call.
 *
 * NOTHING ELSE REACHES THE MODEL. No quarter-end but the chosen one, no mark history, no forecast input, no fee or
 * carry (the statement is gross and says net returns are Not recorded).
 */

/** The draft surface the sheet's card names (`POST /api/research/drafts`). */
export const STATEMENT_COVER_SURFACE = 'portfolio/statement';

const QUARTER_ENDS = new Set(['03-31', '06-30', '09-30', '12-31']);
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The statement's date from the band's `scope_key`: a quarter-end strictly before `today` (the Worker's date), as the
 * sheet's chooser lists only completed quarter-ends. Anything else is null, and the route drafts nothing.
 */
export function statementDate(scope: unknown, today: string): string | null {
  const s = String(scope ?? '');
  const m = ISO.exec(s);
  if (!m || !QUARTER_ENDS.has(`${m[2]}-${m[3]}`) || !Number.isFinite(Date.parse(s))) return null;
  return s < String(today).slice(0, 10) ? s : null;
}

const isNum = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));

/** `portfolioModel.js` `money`: whole dollars unless the figure has cents. */
export function money(value: unknown): string | null {
  if (!isNum(value)) return null;
  const n = Number(value);
  const cents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}

/** `portfolioModel.js` `multiple`. */
export const multiple = (value: unknown): string | null => (isNum(value) ? `${Number(value).toFixed(2)}×` : null);

/** `portfolioModel.js` `rate`: a fraction as a percentage to one place. */
export function rate(fraction: unknown): string | null {
  if (!isNum(fraction)) return null;
  const pct = Math.round(Number(fraction) * 1000) / 10;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** `portfolioModel.js` `day`: "30 Sep 2026". */
export function day(value: string): string {
  const m = ISO.exec(value);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : value;
}

/**
 * The statement's "Funded after" rule (`statementModel.js` `fundedAfter`): a row the positions read lists but the date
 * does not hold, because its first cheque's year is after the date's year or its only cheque is dated after the date.
 * The same rule as page 2, so the note never names a company page 2 does not mark.
 */
export function fundedAfter(p: { vintage?: unknown; rounds?: unknown; latest_date?: unknown }, date: string): boolean {
  const year = Number(date.slice(0, 4));
  if (Number.isInteger(Number(p.vintage)) && p.vintage != null && Number(p.vintage) > year) return true;
  return Number(p.rounds) === 1 && typeof p.latest_date === 'string' && p.latest_date.slice(0, 10) > date;
}

interface ReturnFigure { state?: string; value?: unknown }

/** A return as page 1 prints it: the figure, or "Unavailable" when the read says no figure is defined. */
function returnLine(figure: ReturnFigure | undefined, flat: unknown, format: (v: unknown) => string | null): string | null {
  if (figure && figure.state === 'unavailable') return 'Unavailable (page 1 prints no figure)';
  if (figure && figure.state === 'total_loss') {
    const v = format(figure.value ?? -1);
    return v ? `${v} (total loss: capital deployed and nothing came back)` : null;
  }
  return format(figure ? figure.value : flat);
}

/**
 * The note's material: one line per figure, each naming the date and the page it is printed on. `analytics` and
 * `positions` are the two reads' JSON bodies for `asOf`, or null when a read failed.
 */
export function statementCoverMaterial(asOf: string, analytics: any, positions: any): string[] {
  if (!analytics || typeof analytics !== 'object' || !positions || !Array.isArray(positions.items)) return [];
  const count = isNum(analytics.position_count) ? Number(analytics.position_count) : null;
  // No book at the date: the sheet cannot produce this statement, so there is nothing to cover.
  if (!count) return [];
  const label = day(asOf);
  const lines: string[] = [
    `Statement as of ${label} (${asOf}). Every figure is gross of fees and carry; net returns are Not recorded.`,
  ];
  const fig = (name: string, value: string | null) => {
    if (value) lines.push(`Page 1, summary: ${name}: ${value}.`);
  };
  const r = (analytics.returns || {}) as Record<string, ReturnFigure>;
  fig(`NAV as of ${label}`, money(analytics.nav));
  fig(`Paid-in to ${label}`, money(analytics.paid_in));
  fig(`Distributed to ${label}`, money(analytics.distributed));
  if (isNum(analytics.nav) && isNum(analytics.distributed)) fig(`Total value as of ${label}`, money(Number(analytics.nav) + Number(analytics.distributed)));
  fig(`TVPI as of ${label}`, returnLine(r.tvpi, analytics.tvpi, multiple));
  fig(`DPI as of ${label}`, returnLine(r.dpi, analytics.dpi, multiple));
  fig(`RVPI as of ${label}`, returnLine(r.rvpi, analytics.rvpi, multiple));
  fig(`IRR to ${label}`, returnLine(r.irr, analytics.irr, rate));

  const unmarked = isNum(analytics.unmarked_position_count) ? Number(analytics.unmarked_position_count) : null;
  const unusable = isNum(analytics.unusable_mark_count) ? Number(analytics.unusable_mark_count) : null;
  if (unmarked != null) {
    lines.push(`Page 1, coverage: ${count - unmarked} of ${count} position${count === 1 ? '' : 's'} held at ${label} carry a usable recorded mark.`);
    const why = unusable != null
      ? ` (${unmarked - unusable} with no mark, ${unusable} whose recorded mark cannot be used)`
      : '';
    lines.push(`Page 1, at cost: ${unmarked} position${unmarked === 1 ? ' is' : 's are'} carried at cost${why}. A position at cost has not been revalued.`);
  }

  const after = (positions.items as any[]).filter((p) => p && fundedAfter(p, asOf));
  if (after.length) {
    for (const p of after) {
      const invested = money(p.total_invested);
      lines.push(`Page 2, Funded after ${label}: ${(p.project && p.project.name) || `Company ${p.project_id}`}`
        + `${invested ? `, ${invested} invested` : ''}. The page 1 summary does not count it.`);
    }
  } else {
    lines.push(`Page 2 marks no company as Funded after ${label}.`);
  }
  return lines;
}

export const STATEMENT_COVER_INSTRUCTION = [
  'Write a short covering note, in the first person, that an investor can send with their own portfolio statement, from the lines below and nothing else.',
  'Use only the figures the lines carry, each with the date it is for. Compute no figure, rate or difference that the lines do not state, and never round a figure differently.',
  'Say once that the figures are gross of fees and carry. Name the positions carried at cost as not revalued, never as a gain or a loss. If a line names a company Funded after the date, say the summary does not count it.',
  'Do not forecast, do not describe performance as good or bad, and do not tell the reader what to do. Mention no other date, period or quarter.',
].join(' ');
