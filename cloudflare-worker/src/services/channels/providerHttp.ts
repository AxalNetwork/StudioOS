/**
 * D684 (#1602): one deadline for the provider's headers AND JSON body.
 * Aborting a POST cannot prove it was not accepted; adapters classify a lost
 * send response as send_unknown, and outbound.ts retains its pending claim.
 * withDeadline also bounds providers/mocks that ignore AbortSignal, and
 * consumes a late rejection without extending the request.
 */
import { withDeadline } from '../../util/deadline';

export const PROVIDER_CALL_MS = 10_000;

export async function providerJson(url: string, init: RequestInit = {}): Promise<{ res: Response; data: any }> {
  const controller = new AbortController();
  try {
    return await withDeadline((async () => {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const data = await res.json().catch(() => null);
      return { res, data };
    })(), PROVIDER_CALL_MS, 'channel-provider');
  } finally {
    controller.abort();
  }
}
