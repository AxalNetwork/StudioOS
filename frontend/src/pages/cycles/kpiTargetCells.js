/** D6102 target cells: recorded direction, zero and unknown reads, without pacing claims (#6102). */
export function kpiTargetCells(row) {
  const target = row.target;
  let word = 'Unreadable';
  if (row.target_state === 'not_set') word = 'Not set';
  else if (row.target_state === 'unsupported') word = 'Not set · not supported in Focus';
  else if (row.target_state === 'recorded' && typeof target?.target_value === 'number' && Number.isFinite(target.target_value)) {
    word = target.target_value.toLocaleString('en-US');
    if (row.unit === 'usd' || ['mrr', 'net_burn'].includes(target.metric_key)) word = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(target.target_value);
    if (row.unit === 'pct' || target.metric_key === 'monthly_churn_pct') word += '%';
  }
  const vs = row.target_state !== 'recorded' || target?.actual == null || target?.met == null ? null
    : target.met ? 'Target met' : target.actual > target.target_value ? 'Above target' : 'Below target';
  return { target: { text: word, href: row.target_href || '/grow/focus', separateLink: true }, vs_target: vs ?? { blank: true } };
}
