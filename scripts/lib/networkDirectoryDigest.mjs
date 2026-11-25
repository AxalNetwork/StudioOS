/** D7674 part 2 (#7674): the reviewed snapshot's records digest, one function for the offline planner CLI and the Worker's apply route. */
import { canonical } from './networkDirectoryPlan.mjs';

/** SHA-256 (lower-case hex) of the planner's canonical JSON of the record array: an upload's `snapshot.records_sha256`. */
export async function recordsDigest(records) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(records)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
