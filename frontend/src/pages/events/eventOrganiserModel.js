// D567: display only recorded values; a failed read never becomes an empty list.
export const REGISTRATION_TABS = ['Pending', 'Approved', 'Waitlist', 'Declined', 'Cancelled'];
export function registrationTab(row, approvalRequired) {
  if (row.status === 'waitlisted') return 'Waitlist';
  if (row.status === 'declined') return 'Declined';
  if (row.status === 'cancelled') return 'Cancelled';
  if (row.status === 'pending' || (row.status === 'registered' && approvalRequired)) return 'Pending';
  return 'Approved';
}
export function recorded(value, reason) {
  return value === null || value === undefined || value === '' ? `Not recorded — ${reason}` : String(value);
}
export function pageRows(rows, search, page, sort = 'oldest') {
  const filtered = rows.filter(row => `${row.name || ''} ${row.title || ''} ${row.role || ''}`.toLowerCase().includes(search.toLowerCase()));
  if (sort === 'name') filtered.sort((a, b) => String(a.name || a.title || '').localeCompare(String(b.name || b.title || '')));
  if (sort === 'oldest' || sort === 'newest') filtered.sort((a, b) => {
    if (!a.registered_at || !b.registered_at) return a.registered_at ? -1 : b.registered_at ? 1 : 0;
    const order = String(a.registered_at).localeCompare(String(b.registered_at));
    return sort === 'newest' ? -order : order;
  });
  const lastPage = Math.max(1, Math.ceil(filtered.length / 25));
  const current = Math.min(Math.max(1, page), lastPage);
  return { rows: filtered.slice((current - 1) * 25, current * 25), total: filtered.length, current, lastPage, start: filtered.length ? (current - 1) * 25 + 1 : 0, end: Math.min(current * 25, filtered.length) };
}
