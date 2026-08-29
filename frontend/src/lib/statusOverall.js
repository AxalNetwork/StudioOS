/**
 * One roll-up rule for `GET /api/public/status`, shared by every surface that
 * shows platform health.
 *
 * Two pages now report it — /status and the Help Center's "Still stuck?"
 * block — and two copies of `services.every(...)` would eventually disagree in
 * front of a user during the exact incident they are trying to read about.
 *
 * The empty case matters as much as the others: `[].every()` is `true`, so the
 * obvious inline version reports a confident "Operational" when the probe
 * returned nothing at all. No services means no evidence, which is 'unknown'.
 */
export function overallStatus(services) {
  if (!Array.isArray(services) || services.length === 0) return 'unknown';
  if (services.every((s) => s?.status === 'operational')) return 'operational';
  if (services.some((s) => s?.status === 'down')) return 'down';
  return 'degraded';
}
