// D5665: at-least-once read-only source relay; intent is durable before cursor advance, with injected observational policy.
export class PublicationRelay {
  constructor({ source, policyFor, outbox, cursors, visibility = 'public' }) {
    if (!['public', 'restricted'].includes(visibility)) throw new Error('visibility_invalid');
    this.source = source; this.policyFor = policyFor; this.outbox = outbox; this.cursors = cursors; this.visibility = visibility;
  }
  async poll() {
    const events = await this.pollStream('history', 'publication');
    const gaps = typeof this.source.gapHistory === 'function' ? await this.pollStream('gapHistory', 'publication-gaps') : null;
    return { ...events, gaps };
  }
  async pollStream(method, prefix) {
    const scope = `${prefix}:v1:${this.visibility}`, after = await this.cursors.get(scope) || 0;
    const rows = await this.source[method]({ visibility: this.visibility, after, limit: 100 });
    if (!Array.isArray(rows) || rows.length > 100) throw new Error('source_batch_invalid');
    let cursor = after, accepted = 0;
    for (const event of rows) {
      if (!Number.isSafeInteger(event.sequence) || event.sequence <= cursor || event.visibility !== this.visibility) throw new Error('source_order_or_visibility_invalid');
      const policy = await this.policyFor(event);
      const result = this.outbox.enqueue(event, policy);
      if (!['pending', 'redacted'].includes(result.state)) throw new Error('intent_not_durable');
      // If this write is interrupted, replay encounters the same unique event/route keys.
      await this.cursors.set(scope, event.sequence); cursor = event.sequence; accepted++;
    }
    return { schema: 1, accepted, cursor, visibility: this.visibility };
  }
}
