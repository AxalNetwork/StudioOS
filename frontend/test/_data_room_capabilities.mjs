/**
 * D5074 (#5074) — the Data room capability maps the Worker's room read
 * returns, one per viewer, for the frontend tests' fixtures. Not a copy kept
 * by hand: `cloudflare-worker/test/data_room_capabilities_5074.test.ts` fails
 * unless `services/dataRoomCapabilities.ts` builds exactly these.
 */
const KEYS = ['upload', 'edit', 'delete_folder', 'set_gate', 'delete', 'share', 'answer_requests',
  'send_nda', 'deck_source', 'download', 'make_current', 'export', 'search_index', 'admin_reason_required'];
const map = (allowed) => Object.freeze(Object.fromEntries(KEYS.map((k) => [k, allowed.includes(k)])));
const MEMBER = ['upload', 'edit', 'delete_folder', 'download', 'make_current', 'export', 'search_index'];

export const ROOM_CAPS = Object.freeze({
  owner: map([...MEMBER, 'set_gate', 'delete', 'share', 'answer_requests', 'send_nda', 'deck_source']),
  cofounder: map(MEMBER),
  support: map([]),
  summary: map(['admin_reason_required']),
});
