/**
 * #4571 R2-09 — the one outcome a sign-in probe run is filed under.
 *
 * A probe that was turned away at the edge has tested nothing about sign-in.
 * Its downstream checks were never run, and a check that was never run is
 * neither a pass nor a measured zero. So every run ends in exactly one of these,
 * printed as `outcome: <NAME>`, and only the mailbox probe that follows the link
 * and asserts a session can ever say VERIFIED_END_TO_END.
 *
 *   EDGE_CHALLENGED            the Cloudflare edge answered (HTML with a cf-ray):
 *                              a WAF or bot rule, not the application. A monitor
 *                              coverage gap, not evidence that sign-in is broken.
 *   APPLICATION_REFUSED        the Worker itself refused (our JSON error shape).
 *   REFUSED_UNATTRIBUTED       refused, and the response does not say by whom.
 *   APPLICATION_FAILED         accepted (or unanswered), then a check that ran failed.
 *   ACCEPTED_NOT_VERIFIED      every check this probe CAN run passed, but it does
 *                              not follow the link or assert a session (the insert
 *                              probe's best result).
 *   VERIFIED_END_TO_END        the link arrived and completed a sign-in.
 *
 * Exit codes are the scripts' own; this names the outcome, it does not replace them.
 */
export const PROBE_OUTCOMES = Object.freeze([
  'EDGE_CHALLENGED',
  'APPLICATION_REFUSED',
  'REFUSED_UNATTRIBUTED',
  'APPLICATION_FAILED',
  'ACCEPTED_NOT_VERIFIED',
  'VERIFIED_END_TO_END',
]);

/**
 * @param {object} run
 * @param {number|null|undefined} run.startStatus  what `/magic/start` answered (undefined: no answer)
 * @param {{origin: 'edge'|'worker'|'unknown'}|null} run.refusal  `describeRefusal`'s reading, when refused
 * @param {Array<{ok: boolean, skipped?: boolean}>} run.rows  the probe's verdict rows
 * @param {boolean} run.endToEnd  whether this probe follows the link and asserts a session
 */
export function probeOutcome({ startStatus, refusal, rows, endToEnd }) {
  const answered = Number.isInteger(startStatus);
  // 202 is the only acceptance. 429 is the probe tripping its own limiter: a refusal by the Worker.
  if (answered && startStatus !== 202) {
    if (refusal?.origin === 'edge') return 'EDGE_CHALLENGED';
    if (refusal?.origin === 'worker' || startStatus === 429) return 'APPLICATION_REFUSED';
    return 'REFUSED_UNATTRIBUTED';
  }
  const list = Array.isArray(rows) ? rows : [];
  // A skipped row never counts: an empty list or one skipped check is not a pass.
  const allRanAndPassed = list.length > 0 && list.every((r) => r && r.ok === true && !r.skipped);
  if (!answered || !allRanAndPassed) return 'APPLICATION_FAILED';
  return endToEnd === true ? 'VERIFIED_END_TO_END' : 'ACCEPTED_NOT_VERIFIED';
}
