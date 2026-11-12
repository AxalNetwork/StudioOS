// D5665: idempotent bridge for D5663 delivery intents; queue acceptance is never reported as Slack acknowledgement.
export function healthAdapter({ enqueueIntent, receipt, channelId }) {
  return async intent => {
    if (!/^[CG][A-Z0-9]{2,30}$/.test(channelId || '')) return { state: 'dead', code: 'destination_unapproved' };
    if (!/^health:v1:[\w.-]+\/[\w.-]+:(main-red|queue|queue-stalled|review-blocked|future-clock):[1-9]\d*:(open|recovery)$/.test(intent?.key || '')) return { state: 'dead', code: 'intent_invalid' };
    // The bridge implementation must persist the original key and render allowlisted fields,
    // not forward free text to a dynamic route. Cutover is disabled pending #5668.
    await enqueueIntent({ key: intent.key, kind: intent.kind, phase: intent.phase, issue: intent.issue });
    const result = await receipt(intent.key);
    if (result?.state === 'acknowledged' && result.receipt?.transport === 'adapter' && result.receipt.status === 200 && result.receipt.channel === channelId && /^\d{1,20}\.\d{1,10}$/.test(result.receipt.ts || '')) return result;
    if (['dead', 'ambiguous'].includes(result?.state)) return { state: result.state, code: 'delivery_requires_reconciliation' };
    return { state: 'retry', code: 'provider_unavailable', retryAfterMs: 60_000 };
  };
}
