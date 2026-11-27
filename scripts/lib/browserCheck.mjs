// #9038: which Chromium a browser check launches, and whether it may skip. PW_CHROMIUM_PATH first (ci.yml job
// `visual` sets it), then the sandbox path; under CI a missing Playwright or browser is a failure, never "SKIPPED".
//
// Used by scripts/check-workspace-frames.mjs and scripts/check-reload-loop.mjs. A check that cannot run must not
// report success: off CI a missing @playwright/test still skips with exit 0, as it always did, but in CI it exits 1,
// and so does a PW_CHROMIUM_PATH that names no file (a wrong pin must not fall back to another browser).

/** The sandbox's pinned Chromium, used when PW_CHROMIUM_PATH is not set. */
export const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** True when the environment says this is CI (any non-empty value but "false" or "0"). */
export function inCI(env) {
  const v = String(env.CI ?? '').trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== '0';
}

/**
 * What the check should do before it launches.
 * @param {{ env: Record<string, string|undefined>, exists: (p: string) => boolean, playwright: boolean, name: string }} o
 * @returns {{ action: 'run', executablePath: string|null } | { action: 'skip' | 'fail', message: string }}
 */
export function browserPlan({ env, exists, playwright, name }) {
  const ci = inCI(env);
  if (!playwright) {
    return ci
      ? { action: 'fail', message: `${name}: FAILED — @playwright/test is not installed, and CI may not skip a browser check.` }
      : { action: 'skip', message: `${name}: SKIPPED — @playwright/test is not installed.` };
  }
  const pinned = String(env.PW_CHROMIUM_PATH ?? '').trim();
  if (pinned) {
    if (exists(pinned)) return { action: 'run', executablePath: pinned };
    return { action: 'fail', message: `${name}: FAILED — PW_CHROMIUM_PATH names ${pinned}, which does not exist.` };
  }
  return { action: 'run', executablePath: exists(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : null };
}

/** The line printed, and the exit code, when Chromium does not launch: always a failure. */
export function launchFailure(name, error) {
  const first = String(error?.message ?? error ?? '').split('\n')[0];
  return { message: `${name}: FAILED — Chromium did not launch (${first}).`, code: 1 };
}
