// T18 — Lightweight error reporter for production.
//
// Replace console.error/console.warn in pages/components with reportError().
// In development this still logs to the console; in production it's a no-op
// (could be wired to Sentry / a /api/csp_report-style endpoint later without
// changing call sites).
//
// Pattern: reportError('PageName:operation', err)

const isDev = typeof import.meta !== 'undefined' && !!import.meta.env && !!import.meta.env.DEV;

export function reportError(scope, err) {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.error(`[${scope}]`, err);
  }
  // Production hook point — wire to telemetry endpoint here when ready.
}

export function reportWarn(scope, msg) {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.warn(`[${scope}]`, msg);
  }
}
