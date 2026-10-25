/** D1149: amounts carry the deal's denomination; a missing figure stays missing. */
export function dealMoney(value, currency = 'USD', cents = false) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency,
      minimumFractionDigits: cents ? 2 : 0, ...(cents ? { maximumFractionDigits: 2 } : {}),
    }).format(Number(value) / (cents ? 100 : 1));
  } catch { return null; }
}
export function dealBackLink(role) {
  return role === 'founder' ? { path: '/raise/capital-relationships', label: 'Back to Capital relationships' }
    : { path: '/deals', label: 'Back to Deal Flow' };
}
