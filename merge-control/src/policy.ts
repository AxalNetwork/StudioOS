/**
 * D5620: the bundled landing-policy classifier and the build's policy_version.
 * `classify` is the same function `scripts/merge-policy.mjs` exports, from
 * `lib/classify.mjs`. No model call. policy_version is the deployed commit,
 * injected by `wrangler deploy --define`; without it this module throws at
 * load, so Worker startup and the upload fail instead of defaulting.
 */
import { classify } from './lib/classify.mjs';
import type { ChangedFile, Classification, Tier } from './lib/classify.mjs';

export { classify };
export type { ChangedFile, Classification, Tier };

declare const MERGE_CONTROL_POLICY_VERSION: string | undefined;

/** Accept only a full lowercase commit SHA; anything else refuses the build. */
export function readPolicyVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error('policy_version is not injected: build refused (D5620)');
  }
  return value;
}

export const POLICY_VERSION: string = readPolicyVersion(
  typeof MERGE_CONTROL_POLICY_VERSION === 'undefined' ? undefined : MERGE_CONTROL_POLICY_VERSION,
);
