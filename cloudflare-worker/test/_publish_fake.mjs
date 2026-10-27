/**
 * D1319 (#3480, part 1 of #2400) — an in-process fake publisher, for every
 * publish test (after `_mercury_mcp_fake.mjs`). It is a `ProviderImpl` with
 * the publish methods and a `PUBLISH_TARGETS`-shaped row, registered under
 * its own key. Nothing here reaches the network.
 *
 * Its `mode` decides what `publish` does:
 *   accept           the post is created: an id and a link
 *   reject           a 4xx meaning not created (`validation`)
 *   rate_limited     a 429, not created, with `retry_after`
 *   timeout          the provider accepted the post, then the reply never came
 *   throw_after      the provider accepted it, then the adapter threw a plain error
 * and `deleteMode` what `retract` does: `accept` or `refuse`. `gate`, when
 * set, is awaited inside `publish` so two confirms can be made to overlap.
 * Every call is recorded in `calls`; `posts` holds what was created.
 *
 *   const fake = publishFake();
 *   registerProvider(fake.impl); registerPublishTarget(fake.target);
 */
import { PublishError } from '../src/integrations/registry.ts';

export const FAKE_KEY = 'fakepub';

export function publishFake({ key = FAKE_KEY, retract = 'delete', textLimit = 280 } = {}) {
  const state = { mode: 'accept', deleteMode: 'accept', gate: null, calls: [], posts: [], seq: 0 };
  const target = {
    key, text_limit: textLimit, media_limit: 4, media_types: ['image/png', 'image/jpeg'], audience: 'Public',
    retract, modules: ['product-improvement', 'updates'], verified_on: null,
  };
  const impl = {
    key,
    async connect() { throw new Error('not_used_in_publish_tests'); },
    async listDestinations(_env, row) {
      state.calls.push({ fn: 'listDestinations', integration: row.id });
      return [
        { external_account_id: 'acct-1', display_name: '@northwind_demo', audience_label: 'Public' },
        { external_account_id: 'acct-2', display_name: '[Northwind Notes]', audience_label: null },
      ];
    },
    async publishPreview(_env, _row, input) {
      const used = [...String(input.text)].length;
      const problems = [];
      if (textLimit != null && used > textLimit) problems.push(`${used} of ${textLimit} characters: shorten it for this place.`);
      if (!String(input.text).trim()) problems.push('There is nothing to post.');
      return {
        target: input.destination.display_name, audience: input.destination.audience_label ?? 'Public',
        fields: [{ name: 'text', value: input.text }], counts: [{ name: 'characters', used, limit: textLimit }],
        media: { count: input.media_r2_keys.length, limit: 4, types: target.media_types }, problems,
      };
    },
    async publish(_env, _row, envelope, opts) {
      state.calls.push({ fn: 'publish', key: opts.idempotencyKey });
      if (state.gate) await state.gate;
      const make = () => { state.seq += 1; const id = `post-${state.seq}`; state.posts.push({ id, text: envelope.input.text }); return { external_post_id: id, external_url: `https://fake.example/${id}` }; };
      switch (state.mode) {
        case 'accept': return make();
        case 'reject': throw new PublishError('not_created', 'validation', { httpStatus: 400 });
        case 'rate_limited': throw new PublishError('not_created', 'too_many_posts', { httpStatus: 429, retryAfter: '2026-10-27T14:20:00Z' });
        case 'timeout': make(); throw new PublishError('unknown', 'timeout');
        case 'throw_after': make(); throw new Error('socket hang up');
        default: throw new Error('unknown_mode');
      }
    },
    async retract(_env, _row, id) {
      state.calls.push({ fn: 'retract', id });
      if (state.deleteMode === 'refuse') throw new PublishError('not_created', 'delete_refused', { httpStatus: 403 });
      state.posts = state.posts.filter((p) => p.id !== id);
    },
    async findPublished(_env, _row, envelope) {
      state.calls.push({ fn: 'findPublished' });
      const hit = state.posts.find((p) => p.text === envelope.input.text);
      return hit ? { external_post_id: hit.id, external_url: `https://fake.example/${hit.id}` } : null;
    },
  };
  return { state, target, impl, publishes: () => state.calls.filter((c) => c.fn === 'publish').length };
}
