/**
 * D4812 part 4 (#4812, board FA-02) — "Export view": the LP roster as CSV,
 * exactly the rows the roster's filters, search and sort keep, across every
 * page (`GET /api/fund-admin/lps/export`, marked "backend required" on the
 * canvas).
 *
 * THE SAME READ AS THE TABLE. The rows come from `fundAdminLps` with `all`,
 * so a figure no store holds is written as "Not recorded" and one a store
 * could not read as "Unreadable", never as 0, and the read is audited first
 * (surface `fund_admin.lps.export`).
 *
 * LESS THAN THE SCREEN. The file leaves the console, so it carries no email:
 * an LP is named, as everywhere in fund administration. Money is dollars with
 * two decimals. A cell that a spreadsheet would read as a formula (it starts
 * with = + - @, a tab or a carriage return) is prefixed with an apostrophe.
 */
const HEAD = ['LP', 'Fund', 'LP type', 'Commitment ($)', 'Called ($)', 'Received ($)', 'Outstanding ($)', 'Distributed ($)', 'LPA', 'Identity', 'Booklet', 'Last notice'];

const absent = (reason: unknown) => (typeof reason === 'string' && reason.startsWith('Unreadable') ? 'Unreadable' : 'Not recorded');

const dollars = (cents: unknown): string | null =>
  (typeof cents === 'number' && Number.isSafeInteger(cents) ? `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}` : null);

/** One CSV cell: quoted when needed, and never a formula. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function lpsCsv(items: any[]): string {
  const money = (r: any, k: string) => dollars(r[k]) ?? absent(r.unavailable?.[k]);
  const rows = items.map((r) => [
    r.name || 'Name not recorded',
    r.fund_name || 'Not recorded',
    r.lp_type ?? absent(r.unavailable?.lp_type),
    money(r, 'commitment_cents'), money(r, 'called_cents'), money(r, 'received_cents'), money(r, 'outstanding_cents'), money(r, 'distributed_cents'),
    r.lpa_signed ? 'Signed' : 'Pending',
    r.kyc_status ?? absent(r.unavailable?.kyc_status),
    r.booklet?.state ?? absent(r.unavailable?.booklet),
    r.last_notice?.issued_at ? String(r.last_notice.issued_at).slice(0, 10) : absent(r.unavailable?.last_notice),
  ]);
  return [HEAD, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
