/** D7256 (#7256): public error boundaries and bounded diagnostic classifications without exception contents. */
export const PRIVATE_ERROR_DETAIL = 'Internal server error';

/** These are diagnostic shapes, not the ordinary validation sentences routes intentionally return. */
export function privateErrorContext(message: string): boolean {
  return /(?:^|\n)\s*(?:at\s+|(?:Type|Reference|Syntax|Range|Eval|URI|Aggregate)?Error:)/.test(message)
    || /(?:[A-Za-z]:[\\/]|\/(?:home|workspace|tmp|var|opt|Users|private|root|srv|usr)\/)/.test(message)
    || /\b(?:authorization|password|passwd|secret|token|api[-_ ]?key|cookie|signature|sig)[\s"']*[:=]/i.test(message)
    || /\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(message)
    || /https?:\/\/[^\s/:@]*:[^\s/@]+@/i.test(message);
}

/** Native programming errors are never member-facing validation failures. */
export function privateFailure(error: unknown, message: string): boolean {
  return error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError
    || error instanceof RangeError || error instanceof URIError || error instanceof EvalError
    || error instanceof AggregateError || privateErrorContext(message);
}

/** Error names are allowlisted; neither a custom name nor message/stack/cause enters logs. */
export function errorDiagnostic(error: unknown): { kind: string } {
  if (error instanceof TypeError) return { kind: 'type_error' };
  if (error instanceof ReferenceError) return { kind: 'reference_error' };
  if (error instanceof SyntaxError) return { kind: 'syntax_error' };
  if (error instanceof RangeError) return { kind: 'range_error' };
  if (error instanceof URIError) return { kind: 'uri_error' };
  if (error instanceof EvalError) return { kind: 'eval_error' };
  if (error instanceof AggregateError) return { kind: 'aggregate_error' };
  return { kind: error instanceof Error ? 'error' : 'non_error' };
}

export type ErrorEvent = 'edge_unhandled' | 'map_error' | 'schema_mismatch' | 'refusal' | 'import_row' | 'visual_request';

export function reportPrivateError(event: ErrorEvent, error: unknown, code?: string): void {
  let text = '';
  try {
    const value = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
    if (typeof value === 'string') text = value.slice(0, 4096);
  } catch { /* A diagnostic getter must never replace the original failure. */ }
  // Fixed classifications retain actionable provider evidence without copying its response.
  const providerCode = ['card_declined', 'rate_limit_exceeded', 'insufficient_funds'].find(value => text.includes(value));
  console.error('[error]', JSON.stringify({ event, ...errorDiagnostic(error),
    ...(code && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? { code } : {}),
    ...(providerCode ? { provider_code: providerCode } : {}) }));
}

/** Owner/admin provider diagnostics remain useful, but private context is not forwarded even to that audience. */
export function safeUpstreamDiagnostic(text: string): string {
  return privateErrorContext(text) ? 'Provider diagnostic withheld.' : text;
}
