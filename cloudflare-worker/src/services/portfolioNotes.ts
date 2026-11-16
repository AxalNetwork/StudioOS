/**
 * D6212 (#6212): the material for Eadwyn's two Portfolio notes, on Performance (`portfolio/performance`) and the
 * Overview (`portfolio/overview`), built from the recorded reads alone.
 *
 * Each completed quarter-end is read the way `GET /api/positions/analytics?as_of=` reads it: contributions and
 * distributions dated on or before the date, NAV as the latest usable mark per company on or before it, a company
 * with no usable mark carried at cost. Then come the events inside each quarter: the marks, each with its date and
 * basis; the distributions and new cheques, each with its date.
 *
 * TWO KINDS OF GAP ARE NAMED, NEVER SMOOTHED. A quarter-end with no recorded book is a gap, not a zero. A quarter with
 * a book but no recorded mark, distribution or cheque is a gap in the record, not proof the quarter was flat.
 *
 * NOTHING RECORDED IS NOTHING TO EXPLAIN. With no quarter-end holding a book, this returns [] and the draft route
 * answers `nothing_to_draft` before any model is called, so no token is spent.
 */

export interface NotePosition { project_id: number; project_name?: string | null; invested_amount: unknown; position_date?: string | null; created_at?: string | null }
export interface NoteDistribution { project_id: number; project_name?: string | null; amount: unknown; distribution_date?: string | null }
export interface NoteMark { project_id: number; project_name?: string | null; as_of_date?: string | null; fmv: unknown; basis?: string | null; event?: string | null }

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const isoDate = (v: unknown): string | null => {
  const m = ISO.exec(String(v ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const QUARTER_ENDS = ['03-31', '06-30', '09-30', '12-31'];

/** The last `count` completed quarter-ends before `today`, oldest first. */
export function completedQuarterEnds(today: string, count: number): string[] {
  const t = isoDate(today);
  if (!t || !(count > 0)) return [];
  let year = Number(t.slice(0, 4));
  let q = Math.floor((Number(t.slice(5, 7)) - 1) / 3) - 1; // the quarter before today's
  const out: string[] = [];
  while (out.length < count) {
    if (q < 0) { q = 3; year -= 1; }
    out.unshift(`${year}-${QUARTER_ENDS[q]}`);
    q -= 1;
  }
  return out;
}

/** "Q3 2026" for 2026-09-30. */
export function quarterLabel(end: string): string {
  return `Q${QUARTER_ENDS.indexOf(end.slice(5)) + 1} ${end.slice(0, 4)}`;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const ratio = (n: number) => `${n.toFixed(2)}x`;
const name = (r: { project_name?: string | null; project_id: number }) => r.project_name || `company ${r.project_id}`;
const amount = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The note's material, one line per fact. `quarters` is how many completed quarter-ends it reads: 8 for Performance,
 * 2 for the Overview.
 */
export function portfolioNoteMaterial(input: {
  positions: NotePosition[]; distributions: NoteDistribution[]; marks: NoteMark[]; today: string; quarters: number;
}): string[] {
  const ends = completedQuarterEnds(input.today, input.quarters);
  if (!ends.length) return [];
  const cheques = input.positions
    .map((p) => ({ ...p, date: isoDate(p.position_date) || isoDate(p.created_at), amt: amount(p.invested_amount) }))
    .filter((p) => p.amt != null && p.amt > 0);
  const dists = input.distributions
    .map((d) => ({ ...d, date: isoDate(d.distribution_date), amt: amount(d.amount) }))
    .filter((d) => d.date && d.amt != null && d.amt > 0);
  const marks = input.marks
    .map((m) => ({ ...m, date: isoDate(m.as_of_date), fmv: amount(m.fmv) }))
    .filter((m) => m.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const lines: string[] = [];
  let anyBook = false;
  let previous: string | null = null;
  for (const end of ends) {
    const label = `${quarterLabel(end)} (quarter-end ${end})`;
    const book = new Map<number, { invested: number; name: string }>();
    let paidIn = 0;
    for (const p of cheques) {
      if (!p.date || p.date > end) continue;
      paidIn += p.amt as number;
      const held = book.get(p.project_id) || { invested: 0, name: name(p) };
      held.invested += p.amt as number;
      book.set(p.project_id, held);
    }
    if (!book.size) {
      lines.push(`${label}: NO RECORDED BOOK. This quarter-end is a gap, not a zero.`);
      previous = end;
      continue;
    }
    anyBook = true;
    const distributed = dists.filter((d) => (d.date as string) <= end).reduce((s, d) => s + (d.amt as number), 0);
    let nav = 0;
    let unmarked = 0;
    for (const [pid, held] of book) {
      const latest = marks.filter((m) => m.project_id === pid && (m.date as string) <= end).pop();
      const usable = latest && latest.fmv != null && latest.fmv >= 0;
      if (usable) nav += latest.fmv as number;
      else { nav += held.invested; unmarked += 1; }
    }
    lines.push(`${label}: paid-in ${money(paidIn)}; distributed ${money(distributed)}; NAV ${money(nav)}`
      + `; TVPI ${ratio((distributed + nav) / paidIn)}; DPI ${ratio(distributed / paidIn)}`
      + `; ${book.size - unmarked} of ${book.size} position${book.size === 1 ? '' : 's'} carried at a recorded mark`
      + `${unmarked ? `, ${unmarked} at cost` : ''}.`);

    const inQuarter = (d: string | null) => !!d && d <= end && (previous == null || d > previous);
    const events: string[] = [];
    for (const m of marks) {
      if (!inQuarter(m.date) || !book.has(m.project_id)) continue;
      events.push(`  mark: ${name(m)}, ${m.date}, FMV ${m.fmv != null ? money(m.fmv) : 'not recorded'}`
        + `, basis ${m.basis || 'UNRECORDED'}${m.event ? `, event ${m.event}` : ''}`);
    }
    for (const d of dists) if (inQuarter(d.date)) events.push(`  distribution: ${name(d)}, ${d.date}, ${money(d.amt as number)}`);
    for (const p of cheques) if (inQuarter(p.date)) events.push(`  cheque: ${name(p)}, ${p.date}, ${money(p.amt as number)}`);
    if (previous == null) {
      // The first quarter-end read is the starting point: what happened before it is not "in" it, so no event is listed.
      lines.push('  (the first quarter-end read here: the starting point for the quarters below)');
    } else if (!events.length) {
      lines.push(`  no mark, distribution or cheque is recorded in ${quarterLabel(end)}: a gap in the record. Never describe this quarter as flat or steady.`);
    } else lines.push(...events);
    previous = end;
  }
  if (!anyBook) return [];
  return ['Figures are gross of fees and carry. Each quarter-end reads only records dated on or before it.', ...lines];
}

export const PORTFOLIO_NOTE_INSTRUCTION = [
  'Write a short note on what moved across the quarter-ends below, from these lines and nothing else.',
  'Cite every figure with the quarter-end or the event date it comes from. Name the events (marks with their basis, distributions, cheques) that explain each change.',
  'Where a line says a quarter-end has NO RECORDED BOOK, or a quarter has no recorded mark, distribution or cheque, name it as a gap. Never fill it, interpolate across it, or call that quarter flat.',
  'A mark is not cash: never add an unrealised value to a realised one. Keep TVPI and DPI apart and say which is which.',
  'A mark whose basis is UNRECORDED has no stated provenance; say so. A position carried at cost has not been revalued; never call it a gain or a loss.',
  'The figures are gross of fees and carry; say so once. Add no figure the lines do not carry, compute no rate the lines do not state, do not forecast, and do not tell the reader what to do.',
].join(' ');
